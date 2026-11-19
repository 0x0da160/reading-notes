// 書記素境界、セクション連結、引用・文脈（§6.1）。
import type { Book, Chapter, LogicalRange, Pos, Section } from './types';

const segmenter = new Intl.Segmenter('ja', { granularity: 'grapheme' });

export const CONTEXT_GRAPHEMES = 32;

/** off 以下で最大の書記素境界 */
export function snapBackward(text: string, off: number): number {
  if (off <= 0) return 0;
  if (off >= text.length) return text.length;
  const seg = segmenter.segment(text).containing(off);
  return seg ? seg.index : off;
}

/** off 以上で最小の書記素境界 */
export function snapForward(text: string, off: number): number {
  if (off <= 0) return 0;
  if (off >= text.length) return text.length;
  const seg = segmenter.segment(text).containing(off);
  if (!seg || seg.index === off) return off;
  return seg.index + seg.segment.length;
}

export function isBoundary(text: string, off: number): boolean {
  return snapBackward(text, off) === off;
}

export function lastGraphemes(s: string, n: number): string {
  const parts = [...segmenter.segment(s)];
  return parts.slice(Math.max(0, parts.length - n)).map((p) => p.segment).join('');
}

export function firstGraphemes(s: string, n: number): string {
  let out = '';
  let i = 0;
  for (const p of segmenter.segment(s)) {
    if (i++ >= n) break;
    out += p.segment;
  }
  return out;
}

export function graphemeCount(s: string): number {
  let i = 0;
  for (const _ of segmenter.segment(s)) i++;
  return i;
}

/** 原稿全体を「セクション本文を LF 1つで連結した文字列」として扱う */
export class BookText {
  readonly full: string;
  readonly starts: number[];
  private readonly byId = new Map<string, number>();

  constructor(readonly sections: Section[]) {
    const starts: number[] = [];
    let acc = 0;
    const parts: string[] = [];
    sections.forEach((s, i) => {
      starts.push(acc);
      parts.push(s.text);
      acc += s.text.length + 1;
      this.byId.set(s.id, i);
    });
    this.starts = starts;
    this.full = parts.join('\n');
  }

  indexOf(sectionId: string): number {
    return this.byId.get(sectionId) ?? -1;
  }

  section(id: string): Section | undefined {
    const i = this.indexOf(id);
    return i < 0 ? undefined : this.sections[i];
  }

  /** 位置が有効か（範囲内かつ書記素境界） */
  isValid(p: Pos): boolean {
    const s = this.section(p.section);
    return !!s && Number.isInteger(p.offset) && p.offset >= 0 && p.offset <= s.text.length && isBoundary(s.text, p.offset);
  }

  toGlobal(p: Pos): number {
    const i = this.indexOf(p.section);
    if (i < 0) throw new Error(`unknown section ${p.section}`);
    return this.starts[i]! + p.offset;
  }

  /** 連結文字列上の位置をセクション位置に。境界 LF 上の位置は前セクションの末尾とする。 */
  fromGlobal(g: number): Pos {
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid]! <= g) lo = mid;
      else hi = mid - 1;
    }
    const s = this.sections[lo]!;
    return { section: s.id, offset: Math.min(g - this.starts[lo]!, s.text.length) };
  }

  compare(a: Pos, b: Pos): number {
    return this.toGlobal(a) - this.toGlobal(b);
  }

  quote(r: LogicalRange): string {
    return this.full.slice(this.toGlobal(r.start), this.toGlobal(r.end));
  }

  context(r: LogicalRange): { before: string; after: string } {
    const gs = this.toGlobal(r.start);
    const ge = this.toGlobal(r.end);
    // 32書記素を確実に含む長さを切り出してから数える
    const span = CONTEXT_GRAPHEMES * 16;
    return {
      before: lastGraphemes(this.full.slice(Math.max(0, gs - span), gs), CONTEXT_GRAPHEMES),
      after: firstGraphemes(this.full.slice(ge, ge + span), CONTEXT_GRAPHEMES),
    };
  }
}

/** 位置が属する章。章区間の前なら null。 */
export function chapterAt(book: Book, sectionIndex: number, offset: number): Chapter | null {
  let found: Chapter | null = null;
  for (const c of book.chapters) {
    if (c.section < sectionIndex || (c.section === sectionIndex && c.offset <= offset)) found = c;
    else break;
  }
  return found;
}

/** 範囲の章表示。終了章は排他的終端ではなく最後に含む本文の章。 */
export function rangeChapters(book: Book, bt: BookText, r: LogicalRange): { start: Chapter | null; end: Chapter | null } {
  const si = bt.indexOf(r.start.section);
  const start = chapterAt(book, si, r.start.offset);
  let endPos = r.end;
  const gEnd = bt.toGlobal(r.end);
  const gStart = bt.toGlobal(r.start);
  if (gEnd > gStart) endPos = bt.fromGlobal(gEnd - 1);
  const end = chapterAt(book, bt.indexOf(endPos.section), endPos.offset);
  return { start, end };
}
