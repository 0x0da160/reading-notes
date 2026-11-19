import { useState } from 'react';
import { firstGraphemes, graphemeCount, lastGraphemes } from '../model/bookText';

const HEAD = 40;
const TAIL = 24;

/** 引用の冒頭と末尾。長い引用は展開して全体を読める（§5.2） */
export function QuotePreview({ quote }: { quote: string }) {
  const [open, setOpen] = useState(false);
  const long = graphemeCount(quote) > HEAD + TAIL + 4;
  return (
    <div className="quote">
      <blockquote className="quote-text">
        {!long || open ? (
          quote
        ) : (
          <>
            {firstGraphemes(quote, HEAD)}
            <span className="muted">　…　</span>
            {lastGraphemes(quote, TAIL)}
          </>
        )}
      </blockquote>
      {long && (
        <button type="button" className="btn btn-small" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? '引用をたたむ' : `引用の全体を表示（${graphemeCount(quote)}字）`}
        </button>
      )}
    </div>
  );
}
