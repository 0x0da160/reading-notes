import { useCallback, useEffect, useRef, useState } from 'react';
import { LoadError } from './limits';
import { chapterAt } from './model/bookText';
import type { Book } from './model/types';
import { loadManuscript } from './parse/load';
import type { EngineState, ReaderEngine } from './reader/engine';
import { Reader } from './reader/Reader';
import { applyTheme, loadSettings, saveSettings, type DisplaySettings } from './settings';
import { subscribeOffline, applyUpdate, type OfflineStatus } from './offline';
import { SettingsDialog } from './ui/SettingsDialog';
import { TocDialog } from './ui/TocDialog';

const ACCEPT = '.md,.markdown,.epub,text/markdown,application/epub+zip';

export function App() {
  const [book, setBook] = useState<Book | null>(null);
  const [state, setState] = useState<EngineState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [settings, setSettings] = useState<DisplaySettings>(loadSettings);
  const [dialog, setDialog] = useState<'toc' | 'settings' | null>(null);
  const [offline, setOffline] = useState<OfflineStatus>({ ready: false, updateWaiting: false });
  const engine = useRef<ReaderEngine | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => subscribeOffline(setOffline), []);
  useEffect(() => applyTheme(settings.theme), [settings.theme]);

  const changeSettings = useCallback((s: DisplaySettings) => {
    setSettings(s);
    saveSettings(s);
  }, []);

  const openFile = async (file: File) => {
    setLoading(true);
    setError(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const b = await loadManuscript(file.name, bytes);
      setBook(b);
    } catch (e) {
      // 読込失敗では既存の作業を保持する（§3, §7）
      setError(e instanceof LoadError ? e.message : `読み込めませんでした：${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  // キーボード：左で次へ、右で前へ。入力中・ダイアログ表示中・選択中は発火させない（§4.1）
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement;
      if (dialog || ev.isComposing || ev.metaKey || ev.ctrlKey || ev.altKey) return;
      if (t.closest('input, textarea, select, [contenteditable], dialog')) return;
      const sel = document.getSelection();
      if (sel && !sel.isCollapsed) return;
      const e = engine.current;
      if (!e) return;
      if (ev.key === 'ArrowLeft' || ev.key === 'PageDown') {
        e.next();
        ev.preventDefault();
      } else if (ev.key === 'ArrowRight' || ev.key === 'PageUp') {
        e.prev();
        ev.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog]);

  const chapterIndex = (() => {
    if (!book || !state) return -1;
    const c = chapterAt(book, state.section, state.location.pos.offset);
    return c ? book.chapters.indexOf(c) : -1;
  })();
  const chapter = chapterIndex >= 0 ? book!.chapters[chapterIndex] : null;

  return (
    <div className="app">
      <header className="bar">
        <button type="button" className="btn" onClick={() => fileInput.current?.click()} disabled={loading}>
          開く
        </button>
        <div className="grow">
          <h1 className="bar-title">{book ? `${book.title}${chapter ? `　${chapter.title}` : ''}` : '初読の赤入れリーダー'}</h1>
        </div>
        {book && (
          <button type="button" className="btn" onClick={() => setDialog('toc')}>
            目次
          </button>
        )}
        <button type="button" className="btn" onClick={() => setDialog('settings')}>
          設定
        </button>
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPT}
          className="visually-hidden"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void openFile(f);
          }}
        />
      </header>

      <main className="stage">
        {(error || loading || offline.updateWaiting) && (
          <div style={{ position: 'absolute', insetInline: 0, top: 0, zIndex: 5 }}>
            {loading && <div className="notice" role="status">読み込み中…</div>}
            {error && (
              <div className="notice notice-error" role="alert">
                <span className="grow">{error}</span>
                <button type="button" className="btn" onClick={() => setError(null)}>
                  閉じる
                </button>
              </div>
            )}
            {offline.updateWaiting && (
              <div className="notice" role="status">
                <span className="grow">新しい版があります。入力中でなければ更新できます。</span>
                <button type="button" className="btn btn-outline" onClick={applyUpdate}>
                  更新
                </button>
              </div>
            )}
          </div>
        )}
        {book ? (
          <Reader book={book} settings={settings} initial={null} gestures={dialog === null} onEngine={(e) => (engine.current = e)} onState={setState} />
        ) : (
          <div className="empty">
            <h1>初読の赤入れリーダー</h1>
            <p>自作の原稿（Markdown または EPUB）を縦書きで読み、気づいた箇所にひと言を残します。原稿はこの端末の中だけで扱い、送信しません。</p>
            <div>
              <button type="button" className="btn btn-primary" onClick={() => fileInput.current?.click()} disabled={loading}>
                原稿を開く
              </button>
            </div>
            {offline.ready && <p className="small">オフラインで開き直せます</p>}
          </div>
        )}
      </main>

      <footer className="bar bar-bottom">
        <button type="button" className="btn page-btn" onClick={() => engine.current?.next()} disabled={!book || state?.atEnd}>
          ← 次へ
        </button>
        <div className="grow progress" aria-live="polite">
          {state ? `${Math.round(state.progress * 100)}%　${state.page + 1} / ${state.pageCount}` : ''}
        </div>
        <button type="button" className="btn page-btn" onClick={() => engine.current?.prev()} disabled={!book || state?.atStart}>
          前へ →
        </button>
      </footer>

      {book && (
        <TocDialog
          open={dialog === 'toc'}
          book={book}
          currentChapter={chapterIndex}
          onClose={() => setDialog(null)}
          onJump={(s, o) => {
            setDialog(null);
            engine.current?.goToSectionIndex(s, o);
          }}
        />
      )}
      <SettingsDialog open={dialog === 'settings'} settings={settings} onChange={changeSettings} onClose={() => setDialog(null)} />
    </div>
  );
}
