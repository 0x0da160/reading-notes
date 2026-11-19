// UTF-8 Markdown の読み込み（§3.1）。生HTMLは文字列のまま、画像は代替テキストのみ。
import type { BlockSrc, InlineSrc, SectionSrc } from '../model/types';

export interface MarkdownDoc {
  title: string | null;
  sections: SectionSrc[];
  /** セクションごとの先頭見出し（章名）。見出しで始まらない前置き部分は null */
  sectionHeadings: (string | null)[];
  /** 目次用：セクション内の見出し（章見出しより深いもの） */
  subHeadings: { section: number; depth: number; title: string; anchor: string }[];
}

interface RawBlock {
  block: BlockSrc;
  headingLevel?: number;
  headingText?: string;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const LIST = /^( {0,3})([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;
const QUOTE = /^ {0,3}>[ \t]?(.*)$/;

export function parseMarkdown(source: string): MarkdownDoc {
  const lines = source.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  const raw: RawBlock[] = [];
  let para: string[] = [];
  let paraKind: 'paragraph' | 'listItem' = 'paragraph';
  let marker: string | undefined;

  const flush = () => {
    if (para.length) {
      raw.push({ block: { kind: paraKind, marker, content: parseInlineLines(para) } });
    }
    para = [];
    paraKind = 'paragraph';
    marker = undefined;
  };

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]!;
    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      const close = fence[1]!;
      const body: string[] = [];
      for (i++; i < lines.length; i++) {
        if (lines[i]!.trimStart().startsWith(close)) break;
        body.push(lines[i]!);
      }
      const content: InlineSrc[] = [];
      body.forEach((b, j) => {
        if (j > 0) content.push({ kind: 'br' });
        content.push({ kind: 'style', style: 'code', children: [{ kind: 'text', text: b }] });
      });
      raw.push({ block: { kind: 'paragraph', content } });
      continue;
    }
    if (/^[ \t]*$/.test(line)) {
      flush();
      continue;
    }
    const atx = ATX.exec(line);
    if (atx) {
      flush();
      const text = atx[2] ?? '';
      raw.push({
        block: { kind: 'heading', level: atx[1]!.length, content: parseInline(text) },
        headingLevel: atx[1]!.length,
        headingText: text,
      });
      continue;
    }
    if (HR.test(line)) {
      flush();
      raw.push({ block: { kind: 'break', content: [] } });
      continue;
    }
    const q = QUOTE.exec(line);
    if (q) line = q[1]!;
    const li = LIST.exec(line);
    if (li) {
      flush();
      paraKind = 'listItem';
      marker = /\d/.test(li[2]!) ? li[2]! : '・';
      para.push(li[3]!);
      continue;
    }
    para.push(line);
  }
  flush();

  // 原稿中で最も浅い見出しレベルで章（セクション）を区切る
  const levels = raw.filter((r) => r.headingLevel).map((r) => r.headingLevel!);
  const top = levels.length ? Math.min(...levels) : 0;
  const sections: SectionSrc[] = [];
  const sectionHeadings: (string | null)[] = [];
  const subHeadings: MarkdownDoc['subHeadings'] = [];
  let cur: BlockSrc[] | null = null;
  let title: string | null = null;
  for (const r of raw) {
    if (r.headingLevel === top || cur === null) {
      if (cur === null || r.headingLevel === top) {
        cur = [];
        sections.push({ id: `md-${sections.length}`, blocks: cur });
        sectionHeadings.push(r.headingLevel === top ? plain(r.headingText!) : null);
        if (r.headingLevel === top && title === null) title = plain(r.headingText!);
      }
    }
    if (r.headingLevel && r.headingLevel !== top) {
      const anchor = `h-${sections.length - 1}-${cur.length}`;
      r.block.anchors = [anchor];
      subHeadings.push({ section: sections.length - 1, depth: 1, title: plain(r.headingText!), anchor });
    }
    cur.push(r.block);
  }
  return { title, sections, sectionHeadings, subHeadings };
}

function plain(s: string): string {
  return flatten(parseInline(s)).replace(/[ \t\n\r\f]+/g, ' ').trim();
}

function flatten(xs: InlineSrc[]): string {
  return xs
    .map((x) => {
      switch (x.kind) {
        case 'text':
          return x.text;
        case 'ruby':
          return x.pairs.map((p) => p.base).join('');
        case 'style':
        case 'link':
          return flatten(x.children);
        default:
          return '';
      }
    })
    .join('');
}

/** 段落の行を結合。行末の2つ以上の空白か `\` は明示改行、それ以外の単一改行は空白。 */
function parseInlineLines(lines: string[]): InlineSrc[] {
  const out: InlineSrc[] = [];
  lines.forEach((l, i) => {
    const last = i === lines.length - 1;
    let hard = false;
    let text = l;
    if (!last && / {2,}$/.test(text)) {
      hard = true;
      text = text.replace(/ +$/, '');
    } else if (!last && /\\$/.test(text)) {
      hard = true;
      text = text.slice(0, -1);
    }
    out.push(...parseInline(text));
    if (!last) out.push(hard ? { kind: 'br' } : { kind: 'text', text: '\n' });
  });
  return out;
}

const ESCAPABLE = '\\`*_{}[]()#+-.!|<>~';

/** インライン記法。閉じていない記法は通常の文字列として残す。 */
export function parseInline(s: string): InlineSrc[] {
  const out: InlineSrc[] = [];
  let buf = '';
  const push = (x: InlineSrc) => {
    if (buf) out.push({ kind: 'text', text: buf });
    buf = '';
    out.push(x);
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (c === '\\' && i + 1 < s.length && ESCAPABLE.includes(s[i + 1]!)) {
      buf += s[i + 1];
      i += 2;
      continue;
    }
    if (c === '`') {
      const m = /^(`+)([\s\S]*?[^`])\1(?!`)/.exec(s.slice(i));
      if (m) {
        push({ kind: 'style', style: 'code', children: [{ kind: 'text', text: m[2]! }] });
        i += m[0].length;
        continue;
      }
    }
    if (c === '｜') {
      const m = /^｜([^｜《》\n]+)《([^《》\n]+)》/.exec(s.slice(i));
      if (m) {
        push({ kind: 'ruby', pairs: [{ base: m[1]!, rt: m[2]! }] });
        i += m[0].length;
        continue;
      }
    }
    if (c === '!' && s[i + 1] === '[') {
      const m = /^!\[([^\]]*)\]\(([^)]*)\)/.exec(s.slice(i));
      if (m) {
        push({ kind: 'image', image: { key: null, alt: m[1]! } });
        i += m[0].length;
        continue;
      }
    }
    if (c === '[') {
      const m = /^\[([^\]]+)\]\(([^)]*)\)/.exec(s.slice(i));
      if (m) {
        // 外部URLへは移動しない。表示文字列だけを残す。
        push({ kind: 'link', target: null, children: parseInline(m[1]!) });
        i += m[0].length;
        continue;
      }
    }
    if (c === '*' || c === '_') {
      const strong = s[i + 1] === c;
      const d = strong ? c + c : c;
      const rest = s.slice(i + d.length);
      if (rest && !/^\s/.test(rest)) {
        const close = findClose(rest, d);
        if (close > 0) {
          push({ kind: 'style', style: strong ? 'strong' : 'em', children: parseInline(rest.slice(0, close)) });
          i += d.length * 2 + close;
          continue;
        }
      }
    }
    buf += c;
    i++;
  }
  if (buf) out.push({ kind: 'text', text: buf });
  return out;
}

function findClose(rest: string, d: string): number {
  let j = 0;
  while ((j = rest.indexOf(d, j)) > 0) {
    if (!/\s/.test(rest[j - 1]!) && (d.length === 2 || rest[j + 1] !== d)) return j;
    j += d.length;
  }
  return -1;
}
