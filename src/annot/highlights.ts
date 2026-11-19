// CSS Custom Highlight API で描画し、本文の DOM を書き換えない（§6.1）。
import type { LogicalRange } from '../model/types';
import { offsetsToRange } from '../reader/domMap';
import type { ReaderEngine } from '../reader/engine';
import type { Annotation, AnnotationKind } from './types';

// 確定注釈同士の重なり順を固定する（修正指定 > 疑問 > 残したい）。仮表示は最前面。
const PRIORITY: Record<AnnotationKind, number> = { keep: 1, question: 2, revise: 3 };
const NAMES = { question: 'ann-question', keep: 'ann-keep', revise: 'ann-revise', preview: 'ann-preview' } as const;

type HighlightCtor = new (...ranges: Range[]) => { priority: number };
const registry = (globalThis as { CSS?: { highlights?: Map<string, unknown> } }).CSS?.highlights;
const HighlightImpl = (globalThis as { Highlight?: HighlightCtor }).Highlight;

export const highlightSupported = !!registry && !!HighlightImpl;

/** 論理範囲を、各セクションとの交差部分ごとの DOM Range に分ける */
export function domRanges(engine: ReaderEngine, r: LogicalRange): Range[] {
  const bt = engine.text;
  const si = bt.indexOf(r.start.section);
  const ei = bt.indexOf(r.end.section);
  if (si < 0 || ei < 0) return [];
  const out: Range[] = [];
  for (let i = si; i <= ei; i++) {
    const rs = engine.list[i]!;
    const s = i === si ? r.start.offset : 0;
    const e = i === ei ? r.end.offset : rs.section.text.length;
    const range = offsetsToRange(rs, s, e);
    if (range) out.push(range);
  }
  return out;
}

export function paintAnnotations(engine: ReaderEngine | null, list: Annotation[], hidden: boolean): void {
  if (!registry || !HighlightImpl) return;
  for (const kind of ['question', 'keep', 'revise'] as AnnotationKind[]) {
    const ranges =
      engine && !hidden ? list.filter((a) => a.kind === kind && a.range).flatMap((a) => domRanges(engine, a.range!)) : [];
    const h = new HighlightImpl(...ranges);
    h.priority = PRIORITY[kind];
    registry.set(NAMES[kind], h);
  }
}

/** 操作中の仮表示。確定ハイライトの非表示設定の影響を受けない。 */
export function paintPreview(engine: ReaderEngine | null, range: LogicalRange | null): void {
  if (!registry || !HighlightImpl) return;
  const h = new HighlightImpl(...(engine && range ? domRanges(engine, range) : []));
  h.priority = 10;
  registry.set(NAMES.preview, h);
}
