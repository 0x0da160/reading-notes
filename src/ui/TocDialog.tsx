import type { Book } from '../model/types';
import { Dialog } from './Dialog';

interface Props {
  open: boolean;
  book: Book;
  currentChapter: number;
  onClose: () => void;
  onJump: (section: number, offset: number) => void;
}

export function TocDialog({ open, book, currentChapter, onClose, onJump }: Props) {
  const current = book.chapters[currentChapter];
  return (
    <Dialog open={open} title="目次" onClose={onClose}>
      <ul className="toc-list">
        {book.toc.map((t, i) => (
          <li key={i} style={{ paddingInlineStart: `${t.depth * 1.2}em` }}>
            {t.target ? (
              <button
                type="button"
                aria-current={!!current && t.target.section === current.section && t.target.offset === current.offset}
                onClick={() => onJump(t.target!.section, t.target!.offset)}
              >
                {t.title}
              </button>
            ) : (
              <span className="disabled" aria-disabled="true">
                {t.title}
              </span>
            )}
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
