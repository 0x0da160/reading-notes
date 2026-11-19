// 赤入れ一覧（§5.1）。確定項目は本文順、位置未確定は末尾に分ける。
import { useEffect, useRef } from 'react';
import { chapterLabel } from '../annot/build';
import { KIND_LABEL, type Annotation } from '../annot/types';
import { Dialog } from './Dialog';

interface Props {
  open: boolean;
  items: Annotation[];
  selectedId: string | null;
  onClose: () => void;
  onJump: (a: Annotation) => void;
  onEdit: (a: Annotation) => void;
  onDelete: (a: Annotation) => void;
  onReassign?: (a: Annotation) => void;
  footer?: React.ReactNode;
}

export function AnnotationList({ open, items, selectedId, onClose, onJump, onEdit, onDelete, onReassign, footer }: Props) {
  const placed = items.filter((a) => a.range);
  const unresolved = items.filter((a) => !a.range);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !selectedId) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(selectedId)}"] .item-main`);
    el?.scrollIntoView({ block: 'center' });
    el?.focus();
  }, [open, selectedId]);

  const row = (a: Annotation) => (
    <li key={a.id} data-id={a.id} className={`ann-item${a.id === selectedId ? ' selected' : ''}`}>
      <div className="item-meta">
        <span className={`kind-badge kind-${a.kind}`}>{KIND_LABEL[a.kind]}</span>
        <span className="small muted">{chapterLabel(a.chapters)}</span>
      </div>
      {a.range ? (
        <button type="button" className="item-main" onClick={() => onJump(a)} aria-label={`本文で見る：${a.quote.slice(0, 40)}`}>
          <span className="item-quote">{a.quote}</span>
        </button>
      ) : (
        <div className="item-main" tabIndex={-1}>
          <span className="item-quote">{a.quote}</span>
        </div>
      )}
      {a.comment && <p className="item-comment">{a.comment}</p>}
      {!a.range && a.unresolvedReason && <p className="small muted">位置未確定：{a.unresolvedReason}</p>}
      <div className="item-actions">
        {!a.range && onReassign && (
          <button type="button" className="btn btn-small" onClick={() => onReassign(a)}>
            位置を指定
          </button>
        )}
        <button type="button" className="btn btn-small" onClick={() => onEdit(a)}>
          編集
        </button>
        <button type="button" className="btn btn-small btn-text-danger" onClick={() => onDelete(a)}>
          削除
        </button>
      </div>
    </li>
  );

  return (
    <Dialog open={open} title={`赤入れ一覧（${items.length}件）`} onClose={onClose} footer={footer} className="dlg-wide">
      <div ref={listRef}>
        {!items.length && <p className="muted">まだ赤入れはありません。本文を長押しして範囲を選び、「赤入れ」を押してください。</p>}
        {placed.length > 0 && <ul className="ann-list">{placed.map(row)}</ul>}
        {unresolved.length > 0 && (
          <>
            <h3 className="list-heading">位置未確定（{unresolved.length}件）</h3>
            <ul className="ann-list">{unresolved.map(row)}</ul>
          </>
        )}
      </div>
    </Dialog>
  );
}
