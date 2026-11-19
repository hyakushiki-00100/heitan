/**
 * ビルドしたゲームを Playwright で開き、各シナリオの場面を out/screenshots/ に保存する(CLAUDE.md §9-2)。
 * 使い方: npm run screenshots
 * 撮る場面: 1 軍議(開始時) / 2 出陣中 / 3 撤退直前(決戦直前) / 4 撤退中 / 5 結果。
 * 画面は PC・スマホ横向き(主に遊ぶ向き)で全場面、スマホ縦向きで 1・2・5 を撮る
 * 場面を進めるため、全隊を自動にし「帰路分を残す」を入れて動かす(シードは 1 に固定)
 * 撮った画像は Claude が Read で開き、表示崩れ・文字の切れ・はみ出し・線の重なり・真っ黒な画面がないかを確かめる
 */
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium, devices, type Page } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const outDir = root + 'out/screenshots/';
const PORT = 4179;
const BASE = `http://localhost:${PORT}/`;

/** 作品ごとのシナリオID(games/作品/data/ の scenario-○○.json から集める) */
function scenarioIds(game: string): string[] {
  const dir = `${root}games/${game}/data/`;
  return readdirSync(dir)
    .filter((f) => /^scenario-.*\.json$/.test(f))
    .sort()
    .map((f) => (JSON.parse(readFileSync(dir + f, 'utf8')) as { id: string }).id);
}

const day = async (p: Page) => Number(((await p.textContent('#clock')) ?? '').match(/第\s*([\d.]+)\s*日/)?.[1] ?? 0);
const resultShown = (p: Page) => p.evaluate(() => !document.getElementById('result')!.hidden);
const running = async (p: Page) => ((await p.textContent('#btn-play')) ?? '').includes('止める');

/** 時を進め、until が真になったら止める。自動の一時停止がかかったら進め直す。結果が出たら終わる */
async function runUntil(p: Page, until: () => Promise<boolean>, timeoutMs = 120_000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await resultShown(p)) return;
    if (await until()) {
      if (await running(p)) await p.click('#btn-play');
      return;
    }
    // 遠征が終わった直後はボタンが押せなくなっている(結果の表示が次の確認で見つかる)
    if (!(await running(p)) && (await p.isEnabled('#btn-play'))) await p.click('#btn-play');
    await p.waitForTimeout(25);
  }
  throw new Error('時間内に場面に着かなかった');
}

async function shoot(p: Page, name: string, errors: string[]): Promise<void> {
  // ボタンを押したときにページがスクロールしていることがあるので、先頭(地図)に戻してから撮る
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.waitForTimeout(150);
  await p.screenshot({ path: `${outDir}${name}.png` });
  // 真っ黒・真っ白の画面に気づけるよう、地図のキャンバスに何か描かれているかを調べる
  const blank = await p.evaluate(() => {
    const c = document.getElementById('map') as HTMLCanvasElement;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    const first = [d[0], d[1], d[2]];
    for (let i = 0; i < d.length; i += 4 * 97) if (d[i] !== first[0] || d[i + 1] !== first[1] || d[i + 2] !== first[2]) return false;
    return true;
  });
  if (blank) errors.push(`${name}: 地図が一色(何も描かれていない)`);
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  if (overflow) errors.push(`${name}: 横にはみ出している`);
}

async function main(): Promise<void> {
  execSync('npx vite build games/b-kakuu', { cwd: root, stdio: 'ignore' });
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const server = spawn('npx', ['vite', 'preview', 'games/b-kakuu', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' });
  const errors: string[] = [];
  try {
    for (let i = 0; i < 50; i++) {
      try {
        await fetch(BASE);
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    const browser = await chromium.launch();
    for (const id of scenarioIds('b-kakuu')) {
      for (const [device, opts] of [
        ['pc', { viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 }],
        ['phone', devices['iPhone 13 landscape']],
        ['portrait', devices['iPhone 13']],
      ] as const) {
        const ctx = await browser.newContext(opts);
        const p = await ctx.newPage();
        p.on('pageerror', (e) => errors.push(`${id}/${device}: ${e.message}`));
        p.on('console', (m) => m.type() === 'error' && errors.push(`${id}/${device}: ${m.text()}`));
        p.on('dialog', (d) => {
          errors.push(`${id}/${device}: 予期しないダイアログ「${d.message()}」`);
          void d.dismiss();
        });
        await p.goto(`${BASE}?s=${id}&seed=1`);
        const name = (n: string) => `${id}-${n}-${device}`;
        await shoot(p, name('1-plan'), errors);
        await p.click('#btn-all-auto');
        await p.click('[data-card="kiro"]');
        await p.click('#btn-speed');
        await p.click('#btn-speed');
        await runUntil(p, async () => (await day(p)) >= 3);
        await shoot(p, name('2-moving'), errors);
        if (device !== 'portrait') {
          await runUntil(p, async () => (await day(p)) >= 19.5);
          await shoot(p, name('3-before-retreat'), errors);
          await runUntil(p, async () => (await day(p)) >= 22);
          await shoot(p, name('4-retreat'), errors);
        }
        await runUntil(p, async () => false);
        await shoot(p, name('5-result'), errors);
        await ctx.close();
      }
    }
    await browser.close();
  } finally {
    server.kill();
  }
  const files = readdirSync(outDir).sort();
  console.log(`out/screenshots/ に ${files.length} 枚:\n  ` + files.join('\n  '));
  if (errors.length) {
    console.error(`\n問題 ${errors.length} 件:\n  ` + errors.join('\n  '));
    process.exit(1);
  }
}

void main();
