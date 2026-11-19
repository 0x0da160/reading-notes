// 解析済み XHTML から許可した要素だけを読み取り、中間表現に組み立て直す（§3.1, §8）。
// 原稿由来の文字列を HTML として扱うことはない。
import type { BlockKind, BlockSrc, ImageRef, InlineSrc, InlineStyle } from '../model/types';

export interface XhtmlResolver {
  /** img の src を同梱画像に解決する */
  image(src: string, alt: string): ImageRef;
  /** a の href を収録済み本文の参照先キーに解決する。対象外なら null */
  link(href: string): string | null;
  /** 要素 id の参照先キー */
  anchorKey(id: string): string;
}

const BLOCK = new Set([
  'address', 'article', 'aside', 'blockquote', 'body', 'center', 'dd', 'details', 'dialog', 'div', 'dl', 'dt',
  'fieldset', 'figcaption', 'figure', 'footer', 'form', 'header', 'hgroup', 'li', 'main', 'nav', 'ol', 'p', 'pre',
  'section', 'summary', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'ul', 'html', 'blockquote',
]);
const SKIP = new Set([
  'head', 'script', 'style', 'template', 'noscript', 'title', 'link', 'meta', 'base', 'rp', 'input', 'button',
  'select', 'textarea', 'option', 'source', 'track', 'param', 'map', 'area', 'wbr',
]);
const UNSUPPORTED = new Set(['iframe', 'object', 'embed', 'video', 'audio', 'canvas', 'svg', 'math', 'frame', 'portal']);
const STYLE: Record<string, InlineStyle> = { em: 'em', i: 'em', cite: 'em', dfn: 'em', strong: 'strong', b: 'strong', code: 'code', kbd: 'code', samp: 'code', tt: 'code', sub: 'sub', sup: 'sup' };
const HEADING = /^h([1-6])$/;

interface Ctx {
  styles: InlineStyle[];
  link: string | null;
  pre: boolean;
}

export function extractBlocks(root: Element, r: XhtmlResolver): BlockSrc[] {
  const blocks: BlockSrc[] = [];
  let cur: InlineSrc[] = [];
  let pendingAnchors: string[] = [];

  const hasBody = (xs: InlineSrc[]) => xs.some((x) => x.kind !== 'anchor');
  const flush = (kind: BlockKind = 'paragraph', extra: Partial<BlockSrc> = {}) => {
    if (hasBody(cur)) {
      blocks.push({ kind, content: cur, anchors: pendingAnchors.length ? pendingAnchors : undefined, ...extra });
      pendingAnchors = [];
    } else {
      for (const x of cur) if (x.kind === 'anchor') pendingAnchors.push(x.key);
    }
    cur = [];
  };

  const wrap = (leaf: InlineSrc, ctx: Ctx): InlineSrc => {
    let x = leaf;
    for (let i = ctx.styles.length - 1; i >= 0; i--) x = { kind: 'style', style: ctx.styles[i]!, children: [x] };
    if (ctx.link !== null) x = { kind: 'link', target: ctx.link, children: [x] };
    return x;
  };

  const walk = (node: Node, ctx: Ctx, list?: { ordered: boolean; n: number }): void => {
    if (node.nodeType === 3 || node.nodeType === 4) {
      const text = node.nodeValue ?? '';
      if (ctx.pre && text.includes('\n')) {
        text.split('\n').forEach((part, i) => {
          if (i > 0) cur.push({ kind: 'br' });
          if (part) cur.push(wrap({ kind: 'text', text: part }, ctx));
        });
      } else if (text) cur.push(wrap({ kind: 'text', text }, ctx));
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const name = el.localName.toLowerCase();
    if (SKIP.has(name) || el.hasAttribute('hidden')) return;
    const id = el.getAttribute('id');
    if (UNSUPPORTED.has(name)) {
      if (id) cur.push({ kind: 'anchor', key: r.anchorKey(id) });
      cur.push({ kind: 'unsupported', label: `非対応の要素（${name}）` });
      return;
    }
    if (name === 'br') {
      cur.push({ kind: 'br' });
      return;
    }
    if (name === 'hr') {
      flush();
      blocks.push({ kind: 'break', content: [] });
      return;
    }
    if (name === 'img') {
      if (id) cur.push({ kind: 'anchor', key: r.anchorKey(id) });
      cur.push(wrap({ kind: 'image', image: r.image(el.getAttribute('src') ?? '', el.getAttribute('alt') ?? '') }, { ...ctx, link: null }));
      return;
    }
    if (name === 'ruby') {
      if (id) cur.push({ kind: 'anchor', key: r.anchorKey(id) });
      cur.push(wrap(readRuby(el), ctx));
      return;
    }
    const heading = HEADING.exec(name);
    if (heading || BLOCK.has(name)) {
      flush();
      if (id) pendingAnchors.push(r.anchorKey(id));
      const childCtx: Ctx = { ...ctx, pre: ctx.pre || name === 'pre' };
      if (name === 'ul' || name === 'ol') {
        const sub = { ordered: name === 'ol', n: Number(el.getAttribute('start') ?? '1') || 1 };
        for (const c of Array.from(el.childNodes)) walk(c, childCtx, sub);
        flush();
        return;
      }
      for (const c of Array.from(el.childNodes)) walk(c, childCtx);
      if (heading) flush('heading', { level: Number(heading[1]) });
      else if (name === 'li') {
        const marker = list?.ordered ? `${list.n++}.` : '・';
        flush('listItem', { marker });
      } else if (name === 'figure') flush('figure');
      else flush();
      return;
    }
    // インライン要素（未知の要素も中身の本文だけを残す）
    if (id) cur.push({ kind: 'anchor', key: r.anchorKey(id) });
    let next = ctx;
    const st = STYLE[name];
    if (st) next = { ...ctx, styles: [...ctx.styles, st] };
    if (name === 'a') {
      const href = el.getAttribute('href');
      next = { ...next, link: href ? r.link(href) : null };
    }
    for (const c of Array.from(el.childNodes)) walk(c, next, list);
  };

  for (const c of Array.from(root.childNodes)) walk(c, { styles: [], link: null, pre: false });
  flush();
  if (pendingAnchors.length) blocks.push({ kind: 'break', content: [], anchors: pendingAnchors });
  return blocks;
}

/** ruby の親文字と読みの組。rp と hidden は除く。rb のない複数組にも対応する。 */
function readRuby(el: Element): InlineSrc {
  const pairs: { base: string; rt: string }[] = [];
  let base = '';
  const visit = (n: Node) => {
    if (n.nodeType === 3 || n.nodeType === 4) {
      base += n.nodeValue ?? '';
      return;
    }
    if (n.nodeType !== 1) return;
    const e = n as Element;
    const name = e.localName.toLowerCase();
    if (name === 'rp' || e.hasAttribute('hidden') || SKIP.has(name)) return;
    if (name === 'rt') {
      pairs.push({ base, rt: textOf(e) });
      base = '';
      return;
    }
    if (name === 'rtc') return;
    for (const c of Array.from(e.childNodes)) visit(c);
  };
  for (const c of Array.from(el.childNodes)) visit(c);
  if (base) pairs.push({ base, rt: '' });
  // 読みのない組は通常の文字列に戻す
  return { kind: 'ruby', pairs };
}

function textOf(e: Element): string {
  let s = '';
  e.childNodes.forEach((c) => {
    if (c.nodeType === 3 || c.nodeType === 4) s += c.nodeValue ?? '';
    else if (c.nodeType === 1 && (c as Element).localName !== 'rp') s += textOf(c as Element);
  });
  return s;
}
