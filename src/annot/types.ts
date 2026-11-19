import type { LogicalRange } from '../model/types';

export type AnnotationKind = 'question' | 'keep' | 'revise';

export const KIND_LABEL: Record<AnnotationKind, string> = {
  question: '疑問',
  keep: '残したい',
  revise: '修正指定',
};
export const KINDS: AnnotationKind[] = ['question', 'keep', 'revise'];

export interface Annotation {
  id: string;
  kind: AnnotationKind;
  comment: string;
  /** 原稿版ID（元ファイルの SHA-256） */
  versionId: string;
  /** 位置未確定なら null（§6.1） */
  range: LogicalRange | null;
  /** 現在の引用 */
  quote: string;
  context: { before: string; after: string };
  /** 記録した章名。章またぎなら開始章と終了章が異なる */
  chapters: { start: string | null; end: string | null };
  /** 再割り当て前の初回の引用（§6.2） */
  originalQuote?: string;
  /** 位置未確定の理由 */
  unresolvedReason?: string;
  /** 位置未確定になる前に記録されていた範囲（候補の並び順に使う。本文には描かない） */
  staleRange?: LogicalRange;
  createdAt: string;
  updatedAt: string;
}

export function newId(): string {
  return crypto.randomUUID();
}
