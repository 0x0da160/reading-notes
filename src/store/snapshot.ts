// 復元用 JSON（§7.1）。原稿本体は含めない。
import type { Annotation, AnnotationKind } from '../annot/types';
import { TEXT_MODEL_VERSION } from '../model/textModel';
import type { LogicalRange, Pos } from '../model/types';
import type { ReadingLocation } from '../reader/engine';

export const SCHEMA_VERSION = 1;

export interface Snapshot {
  schemaVersion: 1;
  textModelVersion: number;
  app: 'reading-notes';
  manuscript: { versionId: string; fileName: string; format: 'markdown' | 'epub' };
  generation: number;
  exportedAt: string;
  reading: ReadingLocation | null;
  annotations: SnapshotAnnotation[];
}

export interface SnapshotAnnotation {
  id: string;
  kind: AnnotationKind;
  comment: string;
  versionId: string;
  range: LogicalRange | null;
  quote: string;
  context: { before: string; after: string };
  chapters: { start: string | null; end: string | null };
  originalQuote?: string;
  unresolved?: { reason: string; staleRange?: LogicalRange };
  createdAt: string;
  updatedAt: string;
}

export function toSnapshot(
  meta: { versionId: string; fileName: string; format: 'markdown' | 'epub' },
  annotations: Annotation[],
  reading: ReadingLocation | null,
  generation: number,
): Snapshot {
  return {
    schemaVersion: SCHEMA_VERSION,
    textModelVersion: TEXT_MODEL_VERSION,
    app: 'reading-notes',
    manuscript: meta,
    generation,
    exportedAt: new Date().toISOString(),
    reading,
    annotations: annotations.map((a) => {
      const out: SnapshotAnnotation = {
        id: a.id,
        kind: a.kind,
        comment: a.comment,
        versionId: a.versionId,
        range: a.range,
        quote: a.quote,
        context: a.context,
        chapters: a.chapters,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
      };
      if (a.originalQuote !== undefined) out.originalQuote = a.originalQuote;
      if (!a.range) out.unresolved = { reason: a.unresolvedReason ?? '位置未確定', ...(a.staleRange ? { staleRange: a.staleRange } : {}) };
      return out;
    }),
  };
}

export function fromSnapshotAnnotation(s: SnapshotAnnotation): Annotation {
  const a: Annotation = {
    id: s.id,
    kind: s.kind,
    comment: s.comment,
    versionId: s.versionId,
    range: s.range,
    quote: s.quote,
    context: s.context,
    chapters: s.chapters,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
  if (s.originalQuote !== undefined) a.originalQuote = s.originalQuote;
  if (s.unresolved) {
    a.range = null;
    a.unresolvedReason = s.unresolved.reason;
    if (s.unresolved.staleRange) a.staleRange = s.unresolved.staleRange;
  }
  return a;
}

export class SnapshotError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

function checkPos(v: unknown, where: string): Pos {
  if (!isObj(v) || !isStr(v.section) || !isInt(v.offset)) throw new SnapshotError(`${where} の位置の形式が正しくありません`);
  return { section: v.section, offset: v.offset };
}
function checkRange(v: unknown, where: string): LogicalRange {
  if (!isObj(v)) throw new SnapshotError(`${where} の範囲の形式が正しくありません`);
  return { start: checkPos(v.start, where), end: checkPos(v.end, where) };
}

/** 構文・必須項目・型・ID の重複・スキーマ版を検査する。位置の妥当性はここでは見ない。 */
export function parseSnapshot(text: string): Snapshot {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new SnapshotError('JSONの構文が正しくありません');
  }
  if (!isObj(data)) throw new SnapshotError('JSONの形式が正しくありません');
  if (data.schemaVersion !== SCHEMA_VERSION)
    throw new SnapshotError(typeof data.schemaVersion === 'number' ? `未対応のスキーマです（schemaVersion ${data.schemaVersion}）` : 'schemaVersion がありません');
  if (!isInt(data.textModelVersion)) throw new SnapshotError('textModelVersion がありません');
  const m = data.manuscript;
  if (!isObj(m) || !isStr(m.versionId) || !/^[0-9a-f]{64}$/.test(m.versionId) || !isStr(m.fileName) || (m.format !== 'markdown' && m.format !== 'epub'))
    throw new SnapshotError('原稿の情報が正しくありません');
  if (!isInt(data.generation)) throw new SnapshotError('generation がありません');
  if (!Array.isArray(data.annotations)) throw new SnapshotError('annotations がありません');
  const ids = new Set<string>();
  const annotations = data.annotations.map((x, i): SnapshotAnnotation => {
    const w = `${i + 1}件目`;
    if (!isObj(x)) throw new SnapshotError(`${w} の形式が正しくありません`);
    if (!isStr(x.id) || !x.id) throw new SnapshotError(`${w} の id がありません`);
    if (ids.has(x.id)) throw new SnapshotError(`id が重複しています（${x.id}）`);
    ids.add(x.id);
    if (x.kind !== 'question' && x.kind !== 'keep' && x.kind !== 'revise') throw new SnapshotError(`${w} の種別が正しくありません`);
    if (!isStr(x.comment) || !isStr(x.quote) || !isStr(x.versionId) || !isStr(x.createdAt) || !isStr(x.updatedAt))
      throw new SnapshotError(`${w} の必須項目が足りません`);
    if (x.versionId !== m.versionId) throw new SnapshotError(`${w} の原稿版IDが原稿と一致しません`);
    if (!isObj(x.context) || !isStr(x.context.before) || !isStr(x.context.after)) throw new SnapshotError(`${w} の文脈が正しくありません`);
    if (!isObj(x.chapters) || !(x.chapters.start === null || isStr(x.chapters.start)) || !(x.chapters.end === null || isStr(x.chapters.end)))
      throw new SnapshotError(`${w} の章が正しくありません`);
    if (x.originalQuote !== undefined && !isStr(x.originalQuote)) throw new SnapshotError(`${w} の初回の引用が正しくありません`);
    let unresolved: SnapshotAnnotation['unresolved'];
    if (x.unresolved !== undefined) {
      if (!isObj(x.unresolved) || !isStr(x.unresolved.reason)) throw new SnapshotError(`${w} の位置未確定情報が正しくありません`);
      unresolved = { reason: x.unresolved.reason };
      if (x.unresolved.staleRange !== undefined) unresolved.staleRange = checkRange(x.unresolved.staleRange, w);
    }
    const range = x.range === null ? null : checkRange(x.range, w);
    if (!range && !unresolved) throw new SnapshotError(`${w} の範囲がありません`);
    const out: SnapshotAnnotation = {
      id: x.id,
      kind: x.kind,
      comment: x.comment,
      versionId: x.versionId,
      range: unresolved ? null : range,
      quote: x.quote,
      context: { before: x.context.before, after: x.context.after },
      chapters: { start: x.chapters.start as string | null, end: x.chapters.end as string | null },
      createdAt: x.createdAt,
      updatedAt: x.updatedAt,
    };
    if (x.originalQuote !== undefined) out.originalQuote = x.originalQuote as string;
    if (unresolved) out.unresolved = unresolved;
    return out;
  });
  let reading: ReadingLocation | null = null;
  if (data.reading !== null && data.reading !== undefined) {
    if (!isObj(data.reading)) throw new SnapshotError('読書位置の形式が正しくありません');
    reading = { pos: checkPos(data.reading.pos, '読書位置') };
    const img = data.reading.image;
    if (img !== undefined) {
      if (!isObj(img) || !isStr(img.section) || !isInt(img.index)) throw new SnapshotError('読書位置の画像アンカーが正しくありません');
      reading.image = { section: img.section, index: img.index };
    }
  }
  return {
    schemaVersion: 1,
    textModelVersion: data.textModelVersion,
    app: 'reading-notes',
    manuscript: { versionId: m.versionId, fileName: m.fileName, format: m.format },
    generation: data.generation,
    exportedAt: isStr(data.exportedAt) ? data.exportedAt : '',
    reading,
    annotations,
  };
}
