// コメント入力パネル（§4.1, §4.3, §5.1）。Enter は改行のみ。保存はボタンと ⌘／Ctrl+Enter。
import { useEffect, useId, useRef, useState } from 'react';
import { chapterLabel } from '../annot/build';
import { KINDS, KIND_LABEL, type AnnotationKind } from '../annot/types';
import { QuotePreview } from './QuotePreview';
import { useVisualViewport } from './useVisualViewport';

interface Props {
  title: string;
  quote: string;
  chapters: { start: string | null; end: string | null };
  initialKind: AnnotationKind;
  initialComment: string;
  /** ブラウザー保存に失敗したなどの補足 */
  note?: string | null;
  onSave: (kind: AnnotationKind, comment: string) => void;
  onCancel: () => void;
}

export function AnnotationPanel({ title, quote, chapters, initialKind, initialComment, note, onSave, onCancel }: Props) {
  const [kind, setKind] = useState<AnnotationKind>(initialKind);
  const [comment, setComment] = useState(initialComment);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const vv = useVisualViewport(true);
  const id = useId();

  useEffect(() => {
    // 自動フォーカスが効かない環境では入力欄を直接タップして開始できる
    textarea.current?.focus({ preventScroll: true });
  }, []);

  const save = () => onSave(kind, comment);
  const label = chapterLabel(chapters);

  return (
    <div
      className={`panel-layer${vv?.keyboard ? ' kb-open' : ''}`}
      style={vv ? { top: vv.top, left: vv.left, width: vv.width, height: vv.height } : undefined}
    >
      <section
        className="panel"
        role="dialog"
        aria-modal="false"
        aria-labelledby={`${id}-t`}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
      >
        <header className="panel-head">
          <h2 id={`${id}-t`}>{title}</h2>
          {label && <span className="small muted chapter-label">{label}</span>}
        </header>
        <div className="panel-body">
          <QuotePreview quote={quote} />
          <fieldset className="kinds">
            <legend className="visually-hidden">種別</legend>
            {KINDS.map((k) => (
              <label key={k} className={`seg kind-${k}`}>
                <input type="radio" name={`${id}-kind`} checked={kind === k} onChange={() => setKind(k)} />
                {KIND_LABEL[k]}
              </label>
            ))}
          </fieldset>
          <label className="visually-hidden" htmlFor={`${id}-c`}>
            コメント
          </label>
          <textarea
            id={`${id}-c`}
            ref={textarea}
            className="comment"
            rows={3}
            placeholder="ひと言（任意）"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => {
              // Enter は改行のみ。変換確定と区別できないため保存に割り当てない（§4.3）
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
                e.preventDefault();
                save();
              }
            }}
          />
          {note && <p className="small panel-note" role="status">{note}</p>}
        </div>
        <footer className="panel-foot">
          <span className="small muted hint">⌘／Ctrl+Enterでも保存</span>
          <button type="button" className="btn btn-outline" onClick={onCancel}>
            取消
          </button>
          <button type="button" className="btn btn-primary" onClick={save}>
            保存
          </button>
        </footer>
      </section>
    </div>
  );
}
