import { rangeChapters, type BookText } from '../model/bookText';
import type { Book, LogicalRange } from '../model/types';
import type { Annotation, AnnotationKind } from './types';
import { newId } from './types';

export interface Draft {
  range: LogicalRange;
  quote: string;
  context: { before: string; after: string };
  chapters: { start: string | null; end: string | null };
}

export function makeDraft(book: Book, bt: BookText, range: LogicalRange): Draft {
  const ch = rangeChapters(book, bt, range);
  return {
    range,
    quote: bt.quote(range),
    context: bt.context(range),
    chapters: { start: ch.start?.title ?? null, end: ch.end?.title ?? null },
  };
}

export function createAnnotation(book: Book, d: Draft, kind: AnnotationKind, comment: string): Annotation {
  const now = new Date().toISOString();
  return {
    id: newId(),
    kind,
    comment,
    versionId: book.versionId,
    range: d.range,
    quote: d.quote,
    context: d.context,
    chapters: d.chapters,
    createdAt: now,
    updatedAt: now,
  };
}

/** 本文順（開始位置順、同位置は終了位置・作成日時・ID の順で固定）。位置未確定は末尾（§7.2） */
export function sortAnnotations(list: Annotation[], bt: BookText): Annotation[] {
  const key = (a: Annotation) => (a.range && bt.section(a.range.start.section) ? [bt.toGlobal(a.range.start), bt.toGlobal(a.range.end)] : null);
  return [...list].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (!ka && !kb) return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
    if (!ka) return 1;
    if (!kb) return -1;
    return ka[0]! - kb[0]! || ka[1]! - kb[1]! || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
  });
}

export function chapterLabel(c: { start: string | null; end: string | null }): string {
  if (!c.start && !c.end) return '';
  if (c.start === c.end || !c.end) return c.start ?? '';
  return `${c.start ?? ''}〜${c.end}`;
}
