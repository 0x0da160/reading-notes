// ネイティブ <dialog> の showModal() を使う汎用ダイアログ（§2）。Esc で閉じ、閉じると呼び出し元へフォーカスを戻す。
import { useEffect, useRef, type ReactNode } from 'react';

interface Props {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

export function Dialog({ open, title, onClose, children, footer, className }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      opener.current = document.activeElement;
      d.showModal();
    } else if (!open && d.open) {
      d.close();
    }
  }, [open]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const handle = () => {
      const o = opener.current;
      if (o instanceof HTMLElement && o.isConnected) o.focus();
      onCloseRef.current();
    };
    d.addEventListener('close', handle);
    return () => d.removeEventListener('close', handle);
  }, []);

  return (
    <dialog ref={ref} className={`dlg ${className ?? ''}`} aria-label={title}>
      {open && (
        <div className="dlg-inner">
          <div className="dlg-head">
            <h2>{title}</h2>
            <button type="button" className="btn" onClick={() => ref.current?.close()}>
              閉じる
            </button>
          </div>
          <div className="dlg-body">{children}</div>
          {footer && <div className="dlg-foot">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}
