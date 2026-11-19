// Section を DOM API だけで組み立てる（§8：innerHTML 等の HTML 文字列挿入をしない）。
// 本文の Text ノードは論理本文の部分文字列と完全に一致させ、オフセット変換を単純にする。
import type { Book, Run, Section } from '../model/types';

export interface Segment {
  node: Text;
  start: number;
  end: number;
}

export interface RenderedSection {
  section: Section;
  el: HTMLElement;
  segments: Segment[];
  /** ルビの読みの Text → 親文字の範囲 */
  rtMap: WeakMap<Text, { start: number; end: number }>;
  images: HTMLElement[];
}

/** Text ノード → 所属セクションと開始位置 */
export const textIndex = new WeakMap<Text, { rs: RenderedSection; seg: Segment }>();

// 1〜2字の半角英数字、単独の !? !! ?! を縦中横にする（表示のみ）
const TCY = /(?<![A-Za-z0-9])[A-Za-z0-9]{1,2}(?![A-Za-z0-9])|(?<![!?])(?:!\?|!!|\?!)(?![!?])/g;

export function renderSection(section: Section, imageUrl: (key: string) => string | null, onLink: (target: string) => void): RenderedSection {
  const el = document.createElement('div');
  el.className = 'strip';
  el.lang = 'ja';
  el.dataset.section = section.id;
  const rs: RenderedSection = { section, el, segments: [], rtMap: new WeakMap(), images: [] };

  const addText = (parent: Node, text: string, start: number, tcy = true) => {
    if (!tcy) {
      pushText(parent, text, start);
      return;
    }
    let last = 0;
    for (const m of text.matchAll(TCY)) {
      const i = m.index!;
      if (i > last) pushText(parent, text.slice(last, i), start + last);
      const span = document.createElement('span');
      span.className = 'tcy';
      pushText(span, m[0], start + i);
      parent.appendChild(span);
      last = i + m[0].length;
    }
    if (last < text.length) pushText(parent, text.slice(last), start + last);
  };
  const pushText = (parent: Node, text: string, start: number) => {
    const node = document.createTextNode(text);
    const seg = { node, start, end: start + text.length };
    rs.segments.push(seg);
    textIndex.set(node, { rs, seg });
    parent.appendChild(node);
  };

  const wrapStyles = (parent: HTMLElement, styles: string[]): HTMLElement => {
    let p = parent;
    for (const s of styles) {
      const tag = s === 'em' ? 'em' : s === 'strong' ? 'strong' : s === 'code' ? 'code' : s === 'sub' ? 'sub' : 'sup';
      const e = document.createElement(tag);
      p.appendChild(e);
      p = e;
    }
    return p;
  };

  const renderRun = (parent: HTMLElement, run: Run) => {
    switch (run.kind) {
      case 'text': {
        let host = parent;
        if (run.link) {
          const a = document.createElement('span');
          a.className = 'internal-link';
          a.setAttribute('role', 'link');
          a.tabIndex = 0;
          const target = run.link;
          a.addEventListener('click', (e) => {
            e.stopPropagation();
            onLink(target);
          });
          a.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') onLink(target);
          });
          parent.appendChild(a);
          host = a;
        }
        addText(wrapStyles(host, run.styles), run.text, run.start, !run.styles.includes('code'));
        break;
      }
      case 'ruby': {
        const ruby = document.createElement('ruby');
        for (const p of run.pairs) {
          pushText(ruby, p.base, p.start);
          if (p.rt) {
            const rt = document.createElement('rt');
            const t = document.createTextNode(p.rt);
            rs.rtMap.set(t, { start: p.start, end: p.start + p.base.length });
            rt.appendChild(t);
            ruby.appendChild(rt);
          }
        }
        wrapStyles(parent, run.styles).appendChild(ruby);
        break;
      }
      case 'br':
        parent.appendChild(document.createElement('br'));
        break;
      case 'image': {
        const fig = document.createElement('span');
        fig.className = 'img';
        fig.dataset.image = String(run.index);
        const url = run.image.key ? imageUrl(run.image.key) : null;
        if (url) {
          const img = document.createElement('img');
          img.src = url;
          img.alt = run.image.alt;
          img.decoding = 'async';
          fig.appendChild(img);
        } else {
          fig.classList.add('img-missing');
          fig.setAttribute('aria-hidden', 'false');
          fig.dataset.label = run.image.alt ? `［画像：${run.image.alt}］` : '［非対応の画像］';
          fig.setAttribute('role', 'img');
          fig.setAttribute('aria-label', fig.dataset.label);
        }
        rs.images.push(fig);
        parent.appendChild(fig);
        break;
      }
      case 'unsupported': {
        const s = document.createElement('span');
        s.className = 'unsupported';
        s.dataset.label = `［${run.label}］`;
        s.setAttribute('role', 'img');
        s.setAttribute('aria-label', run.label);
        parent.appendChild(s);
        break;
      }
    }
  };

  for (const b of section.blocks) {
    const tag = b.kind === 'heading' ? `h${Math.min(6, Math.max(1, b.level ?? 2))}` : b.kind === 'break' ? 'hr' : 'p';
    const be = document.createElement(tag);
    be.className = `blk blk-${b.kind}${b.indent ? ' indent' : ''}`;
    if (b.marker) be.dataset.marker = b.marker;
    for (const r of b.runs) renderRun(be, r);
    el.appendChild(be);
  }
  return rs;
}

export function createImageUrls(book: Book): { get(key: string): string | null; revoke(): void } {
  const urls = new Map<string, string>();
  return {
    get(key) {
      const blob = book.images.get(key);
      if (!blob) return null;
      let u = urls.get(key);
      if (!u) {
        u = URL.createObjectURL(blob);
        urls.set(key, u);
      }
      return u;
    },
    revoke() {
      for (const u of urls.values()) URL.revokeObjectURL(u);
      urls.clear();
    },
  };
}
