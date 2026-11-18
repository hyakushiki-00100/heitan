/**
 * 公開用の zip を作る(CLAUDE.md §9-8 公開)。itch.io の HTML5 ゲームは「zip のいちばん上に index.html」が要る。
 * 使い方: npm run package → out/release/hyoro-b-kakuu-<版>.zip
 * 作った zip の中身を確かめ、index.html がいちばん上にない・ファイルが多すぎる・大きすぎる場合は失敗にする
 * (上限は itch.io のフォーラムの書き込みにあった値。公式の最新値は公開前に要確認)
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const version = (JSON.parse(readFileSync(root + 'package.json', 'utf8')) as { version: string }).version;
const outDir = root + 'out/release/';
const zipPath = `${outDir}hyoro-b-kakuu-${version}.zip`;
/** 未確認の上限(フォーラムの書き込み): ファイル数 1000、容量 1GB。余裕を見て小さめに確かめる */
const MAX_FILES = 500;
const MAX_BYTES = 100 * 1024 * 1024;

execFileSync('npx', ['vite', 'build', 'games/b-kakuu'], { cwd: root, stdio: 'ignore' });
mkdirSync(outDir, { recursive: true });
rmSync(zipPath, { force: true });
// dist の「中身」を zip にする(dist フォルダごと入れると index.html がいちばん上に来ない)
execFileSync('zip', ['-r', '-X', '-q', zipPath, '.'], { cwd: root + 'games/b-kakuu/dist' });

const list = execFileSync('unzip', ['-Z1', zipPath]).toString().trim().split('\n');
const files = list.filter((f) => !f.endsWith('/'));
const problems: string[] = [];
if (!files.includes('index.html')) problems.push('zip のいちばん上に index.html がない');
if (files.length > MAX_FILES) problems.push(`ファイルが多すぎる(${files.length})`);
const bytes = statSync(zipPath).size;
if (bytes > MAX_BYTES) problems.push(`zip が大きすぎる(${bytes} バイト)`);
console.log(`${zipPath.replace(root, '')} を作った(${files.length}ファイル・${(bytes / 1024).toFixed(1)}KB)`);
for (const f of files) console.log('  ' + f);
if (problems.length) {
  console.error('問題: ' + problems.join(' / '));
  process.exit(1);
}
