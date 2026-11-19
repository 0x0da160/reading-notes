// 本文のハイライトをタップしたときに、その赤入れのコメントを見せる（重なっていれば前面から順に並べる）。
import { Pencil, Trash2 } from 'lucide-react';
import { chapterLabel } from '../annot/build';
import { KIND_LABEL, type Annotation } from '../annot/types';
import { Dialog } from './Dialog';
import { IconLabel } from './IconButton';

interface Props {
  items: Annotation[];
  onClose: () => void;
  onEdit: (a: Annotation) => void;
  onDelete: (a: Annotation) => void;
}

export function AnnotationPeek({ items, onClose, onEdit, onDelete }: Props) {
  return (
    <Dialog open={items.length > 0} title={items.length > 1 ? `赤入れ（${items.length}件）` : '赤入れ'} onClose={onClose}>
      <ul className="ann-list">
        {items.map((a) => (
          <li key={a.id} className="ann-item peek-item">
            <div className="item-meta">
              <span className={`kind-badge kind-${a.kind}`}>{KIND_LABEL[a.kind]}</span>
              <span className="small muted">{chapterLabel(a.chapters)}</span>
            </div>
            <p className="item-quote peek-quote">{a.quote}</p>
            {a.comment ? <p className="item-comment">{a.comment}</p> : <p className="small muted">コメントはありません</p>}
            <div className="item-actions">
              <button type="button" className="btn btn-small" onClick={() => onEdit(a)}>
                <IconLabel icon={Pencil}>編集</IconLabel>
              </button>
              <button type="button" className="btn btn-small btn-text-danger" onClick={() => onDelete(a)}>
                <IconLabel icon={Trash2}>削除</IconLabel>
              </button>
            </div>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
