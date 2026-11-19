// 保存済みの位置を検証し、必要なら引用と文脈で照合し直す（§6.1）。推測で貼らない。
import type { Annotation } from '../annot/types';
import { BookText, rangeChapters } from '../model/bookText';
import type { Book, LogicalRange } from '../model/types';

export interface RelocateInput {
  range: LogicalRange | null;
  quote: string;
  context: { before: string; after: string };
}

export type RelocateResult =
  | { ok: true; range: LogicalRange; moved: boolean }
  | { ok: false; reason: string };

function rangeValid(bt: BookText, r: LogicalRange): boolean {
  return bt.isValid(r.start) && bt.isValid(r.end) && bt.compare(r.start, r.end) < 0;
}

export function relocate(book: Book, bt: BookText, a: RelocateInput, sameModel: boolean): RelocateResult {
  // 同一本文モデル：保存範囲の両端が有効で、引用と前後文が一致すればその位置を採用（重複引用でも未確定にしない）
  if (sameModel && a.range && rangeValid(bt, a.range)) {
    const q = bt.quote(a.range);
    const c = bt.context(a.range);
    if (q === a.quote && c.before === a.context.before && c.after === a.context.after) return { ok: true, range: a.range, moved: false };
  }
  if (!a.range) return { ok: false, reason: '位置の記録がありません' };
  if (!a.quote) return { ok: false, reason: '引用が空です' };
  // 旧オフセットは採用しない。元セクション（対応を確認できた連続区間）で引用・前後文を照合する。
  const si = bt.indexOf(a.range.start.section);
  const ei = bt.indexOf(a.range.end.section);
  if (si < 0 || ei < 0 || ei < si) return { ok: false, reason: '元のセクションが見つかりません' };
  const from = bt.starts[si]!;
  const lastSec = book.sections[ei]!;
  const to = bt.starts[ei]! + lastSec.text.length;
  const hay = bt.full.slice(from, to);
  const hits: LogicalRange[] = [];
  for (let i = hay.indexOf(a.quote); i >= 0; i = hay.indexOf(a.quote, i + 1)) {
    const r: LogicalRange = { start: bt.fromGlobal(from + i), end: bt.fromGlobal(from + i + a.quote.length) };
    // 開始が境界 LF 上に解決されないよう、終端が前セクション末尾になる場合だけ次セクション先頭に寄せる
    if (bt.toGlobal(r.end) !== from + i + a.quote.length) continue;
    if (!rangeValid(bt, r)) continue;
    const c = bt.context(r);
    if (c.before === a.context.before && c.after === a.context.after) hits.push(r);
  }
  if (hits.length === 1) {
    const h = hits[0]!;
    const same = bt.compare(h.start, a.range.start) === 0 && bt.compare(h.end, a.range.end) === 0;
    return { ok: true, range: h, moved: !same };
  }
  if (hits.length === 0) return { ok: false, reason: '引用と前後の文が一致する箇所がありません' };
  return { ok: false, reason: `引用と前後の文が一致する箇所が${hits.length}か所あります` };
}

/** 同一原稿版の完全一致候補（§6.2）。元のセクション付近を先に並べる。 */
export function findCandidates(book: Book, bt: BookText, quote: string, near: LogicalRange | null) {
  const out: { range: LogicalRange; chapter: string; before: string; after: string; distance: number }[] = [];
  if (!quote) return out;
  const nearG = near && bt.section(near.start.section) ? bt.toGlobal({ section: near.start.section, offset: 0 }) : 0;
  for (let i = bt.full.indexOf(quote); i >= 0 && out.length < 200; i = bt.full.indexOf(quote, i + 1)) {
    const start = bt.fromGlobal(i);
    if (bt.toGlobal(start) !== i) continue; // 境界 LF から始まる一致は除く
    const range: LogicalRange = { start, end: bt.fromGlobal(i + quote.length) };
    if (bt.toGlobal(range.end) !== i + quote.length) {
      // 境界 LF で終わる一致：次セクションの先頭を排他的終端にする
      const ni = bt.indexOf(range.end.section) + 1;
      if (ni >= book.sections.length) continue;
      range.end = { section: book.sections[ni]!.id, offset: 0 };
    }
    if (!rangeValid(bt, range)) continue;
    const c = bt.context(range);
    const ch = rangeChapters(book, bt, range);
    const label = ch.start?.title === ch.end?.title || !ch.end ? (ch.start?.title ?? '') : `${ch.start?.title ?? ''}〜${ch.end.title}`;
    out.push({ range, chapter: label, before: c.before, after: c.after, distance: Math.abs(i - nearG) });
  }
  return out.sort((a, b) => a.distance - b.distance);
}

/** 復元した赤入れ一式に位置検証を適用する。既に位置未確定のものは未確定のまま。 */
export function relocateAll(book: Book, bt: BookText, list: Annotation[], sameModel: boolean): { list: Annotation[]; unresolved: number; moved: number } {
  let unresolved = 0;
  let moved = 0;
  const out = list.map((a) => {
    if (!a.range) {
      unresolved++;
      return a;
    }
    const r = relocate(book, bt, a, sameModel);
    if (r.ok) {
      if (r.moved) moved++;
      return r.moved ? { ...a, range: r.range } : a;
    }
    unresolved++;
    return { ...a, staleRange: a.range, range: null, unresolvedReason: r.reason };
  });
  return { list: out, unresolved, moved };
}
