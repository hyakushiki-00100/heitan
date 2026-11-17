import data from '../data/glossary.json';

export interface Term {
  term: string;
  reading: string;
  /** word=一般的な言葉 / game=このゲームでの決まり・呼び名 */
  kind: 'word' | 'game';
  body: string;
}

export const TERMS: Term[] = (data as { terms: Term[] }).terms;
const byTerm = new Map(TERMS.map((x) => [x.term, x]));

/**
 * 用語に説明を付けた HTML を返す。text を省くと用語そのものを表示する。
 * 用語集にない言葉を渡したら、書き間違いに気づけるよう例外を投げる。
 */
export function t(term: string, text: string = term): string {
  if (!byTerm.has(term)) throw new Error(`用語集にない言葉: ${term}`);
  return `<span class="term" tabindex="0" role="button" data-term="${term}">${text}</span>`;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function tipHtml(x: Term): string {
  const kind = x.kind === 'game' ? '<span class="tip-kind">このゲームでの決まり</span>' : '';
  return `<b>${esc(x.term)}</b><span class="tip-reading">(${esc(x.reading)})</span>${kind}<br>${esc(x.body)}`;
}

/** 用語の説明(マウスを乗せる・フォーカス・タップで表示)と、用語集の一覧を動かす */
export function setupGlossary(tip: HTMLElement, dialog: HTMLDialogElement, openBtn: HTMLElement): void {
  let pinned: HTMLElement | null = null;

  const show = (el: HTMLElement) => {
    const x = byTerm.get(el.dataset.term ?? '');
    if (!x) return;
    tip.innerHTML = tipHtml(x);
    tip.hidden = false;
    const r = el.getBoundingClientRect();
    const w = tip.offsetWidth;
    const gutter = 16;
    const left = Math.max(gutter, Math.min(r.left, window.innerWidth - w - gutter));
    let top = r.bottom + 6;
    if (top + tip.offsetHeight > window.innerHeight - 8) top = Math.max(8, r.top - tip.offsetHeight - 6);
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  };
  const hide = () => {
    tip.hidden = true;
    pinned = null;
  };
  const termOf = (e: Event) => (e.target instanceof Element ? (e.target.closest('.term') as HTMLElement | null) : null);

  document.addEventListener('mouseover', (e) => {
    const el = termOf(e);
    if (el && !pinned) show(el);
  });
  document.addEventListener('mouseout', (e) => {
    if (termOf(e) && !pinned) tip.hidden = true;
  });
  document.addEventListener('focusin', (e) => {
    const el = termOf(e);
    if (el) show(el);
  });
  document.addEventListener('focusout', (e) => {
    if (termOf(e) && !pinned) tip.hidden = true;
  });
  // タップ(クリック)で固定表示。もう一度押すか、ほかの所を押すと消える
  document.addEventListener('click', (e) => {
    const el = termOf(e);
    if (el) {
      if (pinned === el) return hide();
      show(el);
      pinned = el;
      return;
    }
    if (pinned) hide();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hide();
    const el = termOf(e);
    if (el && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      el.click();
    }
  });
  window.addEventListener('scroll', () => hide(), { passive: true });

  const list = dialog.querySelector<HTMLElement>('.glossary-list')!;
  list.innerHTML = TERMS.map(
    (x) =>
      `<dt>${esc(x.term)}<span class="tip-reading">(${esc(x.reading)})</span>${x.kind === 'game' ? '<span class="tip-kind">このゲームでの決まり</span>' : ''}</dt><dd>${esc(x.body)}</dd>`,
  ).join('');
  openBtn.onclick = () => {
    hide();
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    // 先頭から見せる(閉じるボタンにフォーカスが移ると一覧の下端までスクロールされるため)
    dialog.querySelector<HTMLElement>('h2')?.focus();
    dialog.scrollTop = 0;
  };
  dialog.querySelector<HTMLButtonElement>('.glossary-close')!.onclick = () => dialog.close();
}
