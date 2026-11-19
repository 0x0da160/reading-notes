// 位置未確定の赤入れの再割り当て（§6.2）。候補は一件でも自動確定しない。
import { chapterLabel } from '../annot/build';
import { KIND_LABEL, type Annotation } from '../annot/types';
import type { LogicalRange } from '../model/types';
import { Dialog } from './Dialog';
import { QuotePreview } from './QuotePreview';

export interface Candidate {
  range: LogicalRange;
  chapter: string;
  before: string;
  after: string;
}

interface Props {
  open: boolean;
  target: Annotation | null;
  candidates: Candidate[];
  onClose: () => void;
  onPreview: (c: Candidate) => void;
  onSelectInText: () => void;
}

export function ReassignDialog({ open, target, candidates, onClose, onPreview, onSelectInText }: Props) {
  return (
    <Dialog open={open} title="位置を指定" onClose={onClose} className="dlg-wide">
      {target && (
        <>
          <section className="data-section">
            <div className="item-meta">
              <span className={`kind-badge kind-${target.kind}`}>{KIND_LABEL[target.kind]}</span>
              <span className="small muted">記録された章：{chapterLabel(target.chapters) || '不明'}</span>
            </div>
            <QuotePreview quote={target.originalQuote ?? target.quote} />
            {target.comment && <p className="item-comment">{target.comment}</p>}
          </section>
          <section className="data-section">
            <h3>候補から選ぶ（{candidates.length}件）</h3>
            {candidates.length === 0 && <p className="small muted">同じ引用は本文に見つかりませんでした。本文から選び直してください。</p>}
            <ul className="ann-list">
              {candidates.map((c, i) => (
                <li key={i}>
                  <button type="button" className="ann-item candidate" onClick={() => onPreview(c)}>
                    <span className="small muted">{c.chapter || '章不明'}</span>
                    <span className="cand-context">
                      <span className="muted">…{c.before.slice(-16)}</span>
                      <mark>{target.quote.length > 24 ? `${target.quote.slice(0, 24)}…` : target.quote}</mark>
                      <span className="muted">{c.after.slice(0, 16)}…</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <section className="data-section">
            <h3>本文から選び直す</h3>
            <p className="small muted">目次や前後の移動で該当箇所を開き、長押しで選びます。ページをまたぐ範囲も指定できます。</p>
            <div>
              <button type="button" className="btn btn-outline" onClick={onSelectInText}>
                本文から選び直す
              </button>
            </div>
          </section>
        </>
      )}
    </Dialog>
  );
}

interface ConfirmProps {
  open: boolean;
  target: Annotation | null;
  newQuote: string;
  newChapter: string;
  onConfirm: () => void;
  onClose: () => void;
}

export function ReassignConfirmDialog({ open, target, newQuote, newChapter, onConfirm, onClose }: ConfirmProps) {
  const old = target ? (target.originalQuote ?? target.quote) : '';
  const differs = !!target && newQuote !== target.quote;
  return (
    <Dialog
      open={open}
      title="この位置に割り当てますか"
      onClose={onClose}
      className="dlg-wide"
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={onClose}>
            やめる
          </button>
          <button type="button" className="btn btn-primary" onClick={onConfirm}>
            この位置に割り当て
          </button>
        </>
      }
    >
      <section className="data-section">
        <h3>元の引用</h3>
        <QuotePreview quote={old} />
      </section>
      <section className="data-section">
        <h3>新しい引用{newChapter && <span className="small muted">　{newChapter}</span>}</h3>
        <QuotePreview quote={newQuote} />
        {differs && <p className="small warn">引用が元と異なります。割り当てると、書き出しには新しい引用を使い、元の引用はJSONに残します。</p>}
      </section>
    </Dialog>
  );
}
