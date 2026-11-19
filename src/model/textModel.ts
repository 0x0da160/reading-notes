// 論理本文の抽出（§6.1）。抽出規則を変えたら TEXT_MODEL_VERSION を上げる。
import type { Block, BlockSrc, InlineSrc, InlineStyle, Run, Section, SectionSrc } from './types';

export const TEXT_MODEL_VERSION = 1;

const ASCII_WS = /[ \t\n\r\f]/;

class LineWriter {
  out = '';
  /** 現在の行（ブロック内の明示改行で区切った単位）に本文があるか */
  private lineHasContent = false;
  private pendingSpace = false;

  /** 正規化しながら文字列を書き、書いた部分の開始位置と文字列を返す */
  write(raw: string): { start: number; text: string } {
    let text = '';
    let start = -1;
    for (const ch of raw) {
      if (ASCII_WS.test(ch)) {
        if (this.lineHasContent) this.pendingSpace = true;
        continue;
      }
      if (start < 0) start = this.out.length + text.length;
      if (this.pendingSpace) {
        text += ' ';
        this.pendingSpace = false;
      }
      text += ch;
      this.lineHasContent = true;
    }
    if (start < 0) start = this.out.length;
    this.out += text;
    return { start, text };
  }

  lineBreak(): number {
    const offset = this.out.length;
    this.out += '\n';
    this.lineHasContent = false;
    this.pendingSpace = false;
    return offset;
  }

  newBlock(): void {
    this.lineHasContent = false;
    this.pendingSpace = false;
  }

  get position(): number {
    return this.out.length;
  }
}

export function buildSection(src: SectionSrc, index: number): Section {
  const w = new LineWriter();
  const blocks: Block[] = [];
  const anchors = new Map<string, number>();
  const images: number[] = [];
  let heading: string | null = null;
  let prevHadText = false;

  for (const b of src.blocks) {
    // 本文を持つ隣接ブロック間に LF を1つ。空ブロックは位置を消費しない。
    const probe = blockHasText(b);
    if (probe && prevHadText) w.out += '\n';
    w.newBlock();
    const start = w.position;
    for (const key of b.anchors ?? []) if (!anchors.has(key)) anchors.set(key, start);
    const runs: Run[] = [];
    emitInlines(b.content, [], null, w, runs, anchors, images, probe);
    // 行末の明示改行は残す（明示改行は連続していてもそれぞれ LF）。
    const end = w.position;
    if (probe) prevHadText = true;
    const text = w.out.slice(start, end);
    if (b.kind === 'heading' && heading === null && text.trim()) heading = text.replace(/\n/g, ' ');
    blocks.push({
      kind: b.kind,
      level: b.level,
      marker: b.marker,
      indent: b.kind === 'paragraph' && text.length > 0 && !text.startsWith('　'),
      runs,
      start,
      end,
    });
  }
  return { id: src.id, index, path: src.path, blocks, text: w.out, anchors, images, heading };
}

function blockHasText(b: BlockSrc): boolean {
  const has = (xs: InlineSrc[]): boolean =>
    xs.some((x) => {
      switch (x.kind) {
        case 'text':
          return /[^ \t\n\r\f]/.test(x.text);
        case 'ruby':
          return x.pairs.some((p) => /[^ \t\n\r\f]/.test(p.base));
        case 'style':
        case 'link':
          return has(x.children);
        default:
          return false;
      }
    });
  return has(b.content);
}

function emitInlines(
  xs: InlineSrc[],
  styles: InlineStyle[],
  link: string | null,
  w: LineWriter,
  runs: Run[],
  anchors: Map<string, number>,
  images: number[],
  allowBr: boolean,
): void {
  for (const x of xs) {
    switch (x.kind) {
      case 'text': {
        const { start, text } = w.write(x.text);
        if (text) runs.push({ kind: 'text', start, text, styles, link });
        break;
      }
      case 'br':
        // 本文のないブロック（改行だけの段落など）は位置を消費しない
        if (allowBr) runs.push({ kind: 'br', offset: w.lineBreak() });
        break;
      case 'ruby': {
        const pairs: { start: number; base: string; rt: string }[] = [];
        for (const p of x.pairs) {
          const { start, text } = w.write(p.base);
          if (text) pairs.push({ start, base: text, rt: p.rt.trim() });
        }
        if (pairs.length) runs.push({ kind: 'ruby', styles, pairs });
        break;
      }
      case 'style':
        emitInlines(x.children, [...styles, x.style], link, w, runs, anchors, images, allowBr);
        break;
      case 'link':
        emitInlines(x.children, styles, x.target, w, runs, anchors, images, allowBr);
        break;
      case 'anchor':
        if (!anchors.has(x.key)) anchors.set(x.key, w.position);
        break;
      case 'image':
        runs.push({ kind: 'image', image: x.image, index: images.length, offset: w.position });
        images.push(w.position);
        break;
      case 'unsupported':
        runs.push({ kind: 'unsupported', label: x.label });
        break;
    }
  }
}
