// AI提出用 Markdown の対象確認（§7.2）。合計・種別ごとの件数と、引用が含まれることを示す。
import { useEffect, useState } from 'react';
import { chapterLabel } from '../annot/build';
import { KINDS, KIND_LABEL, type Annotation } from '../annot/types';
import { Dialog } from './Dialog';
import { QuotePreview } from './QuotePreview';

interface Props {
  open: boolean;
  items: Annotation[];
  onClose: () => void;
  onExport: (selected: Annotation[]) => void;
}

export function MarkdownExportDialog({ open, items, onClose, onExport }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (open) setSelected(new Set(items.map((a) => a.id)));
  }, [open, items]);
  const chosen = items.filter((a) => selected.has(a.id));
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  return (
    <Dialog
      open={open}
      title="AI用Markdownの書き出し"
      onClose={onClose}
      className="dlg-wide"
      footer={
        <>
          <span className="small grow">
            {chosen.length}件（{KINDS.map((k) => `${KIND_LABEL[k]} ${chosen.filter((a) => a.kind === k).length}`).join('・')}）
            {chosen.some((a) => !a.range) && `・位置未確定 ${chosen.filter((a) => !a.range).length}`}
          </span>
          <button type="button" className="btn btn-primary" disabled={!chosen.length} onClick={() => onExport(chosen)}>
            書き出す
          </button>
        </>
      }
    >
      <p className="small">書き出すファイルには、選んだ赤入れの引用とコメントがそのまま含まれます。</p>
      <div className="row">
        <button type="button" className="btn btn-small" onClick={() => setSelected(new Set(items.map((a) => a.id)))}>
          すべて選ぶ
        </button>
        <button type="button" className="btn btn-small" onClick={() => setSelected(new Set())}>
          選択を解除
        </button>
      </div>
      <ul className="ann-list">
        {items.map((a) => (
          <li key={a.id} className="ann-item">
            <label className="item-meta check">
              <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggle(a.id)} />
              <span className={`kind-badge kind-${a.kind}`}>{KIND_LABEL[a.kind]}</span>
              <span className="small muted">{a.range ? chapterLabel(a.chapters) : '位置未確定'}</span>
            </label>
            <QuotePreview quote={a.quote} />
            {a.comment && <p className="item-comment">{a.comment}</p>}
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
