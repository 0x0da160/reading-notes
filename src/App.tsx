import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createAnnotation, makeDraft, sortAnnotations, type Draft } from './annot/build';
import { highlightSupported, paintAnnotations, paintPreview } from './annot/highlights';
import type { Annotation, AnnotationKind } from './annot/types';
import { LoadError } from './limits';
import { chapterAt } from './model/bookText';
import type { Book, LogicalRange, Pos } from './model/types';
import { applyUpdate, subscribeOffline, type OfflineStatus } from './offline';
import { loadManuscript } from './parse/load';
import { rangeToLogical } from './reader/domMap';
import type { EngineState, ReaderEngine, ReadingLocation } from './reader/engine';
import { Reader } from './reader/Reader';
import { applyTheme, loadSettings, saveSettings, type DisplaySettings } from './settings';
import { AnnotationList } from './ui/AnnotationList';
import { AnnotationPanel } from './ui/AnnotationPanel';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { SettingsDialog } from './ui/SettingsDialog';
import { TocDialog } from './ui/TocDialog';

const ACCEPT = '.md,.markdown,.epub,text/markdown,application/epub+zip';

type Mode =
  | { kind: 'read' }
  /** ページまたぎ：始点を固定し、終点を選択中（§5.2） */
  | { kind: 'extend'; start: Pos; startRange: LogicalRange; anchor: ReadingLocation }
  /** コメント入力。保存・取消後は anchor へ戻る */
  | { kind: 'edit'; draft: Draft; editing: Annotation | null; anchor: ReadingLocation; backToList: boolean }
  /** 一覧からの一時プレビュー。読書再開位置を更新しない（§5.1） */
  | { kind: 'preview'; id: string; anchor: ReadingLocation };

type DialogKind = 'toc' | 'settings' | 'list' | null;

export function App() {
  const [book, setBook] = useState<Book | null>(null);
  const [engine, setEngine] = useState<ReaderEngine | null>(null);
  const [state, setState] = useState<EngineState | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [mode, setMode] = useState<Mode>({ kind: 'read' });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [settings, setSettings] = useState<DisplaySettings>(loadSettings);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [listSelected, setListSelected] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Annotation | null>(null);
  const [offline, setOffline] = useState<OfflineStatus>({ ready: false, updateWaiting: false });
  const [hasSel, setHasSel] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const lastSel = useRef<Range | null>(null);
  /** 通常の読書再開位置 */
  const readingLoc = useRef<ReadingLocation | null>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  useEffect(() => subscribeOffline(setOffline), []);
  useEffect(() => applyTheme(settings.theme), [settings.theme]);

  const changeSettings = useCallback((s: DisplaySettings) => {
    setSettings(s);
    saveSettings(s);
  }, []);

  const onState = useCallback((s: EngineState) => {
    setState(s);
    if (modeRef.current.kind === 'read') readingLoc.current = s.location;
  }, []);

  const sorted = useMemo(() => (engine ? sortAnnotations(annotations, engine.text) : annotations), [annotations, engine]);

  // ハイライト（§4.2, §6.1）
  useEffect(() => paintAnnotations(engine, annotations, settings.hideHighlights), [engine, annotations, settings.hideHighlights]);
  useEffect(() => {
    let r: LogicalRange | null = null;
    if (mode.kind === 'extend') r = mode.startRange;
    else if (mode.kind === 'edit') r = mode.draft.range;
    else if (mode.kind === 'preview') r = annotations.find((a) => a.id === mode.id)?.range ?? null;
    paintPreview(engine, r);
  }, [engine, mode, annotations]);
  useEffect(() => engine?.freezeLayout(mode.kind === 'edit'), [engine, mode.kind]);

  // 本文の選択状態（選択の操作は本文外の下部バーに出す）
  useEffect(() => {
    let hideTimer = 0;
    const onSel = () => {
      const s = document.getSelection();
      const inside = !!s && s.rangeCount > 0 && !s.isCollapsed && !!(s.anchorNode && (s.anchorNode.parentElement ?? (s.anchorNode as Element)).closest?.('.page-area'));
      if (inside) {
        clearTimeout(hideTimer);
        lastSel.current = s!.getRangeAt(0).cloneRange();
        setHasSel(true);
      } else {
        // ボタンのタップで選択が解除されても押下を受け付けられるよう、少し遅らせて隠す
        clearTimeout(hideTimer);
        hideTimer = window.setTimeout(() => {
          lastSel.current = null;
          setHasSel(false);
        }, 600);
      }
    };
    document.addEventListener('selectionchange', onSel);
    return () => {
      document.removeEventListener('selectionchange', onSel);
      clearTimeout(hideTimer);
    };
  }, []);

  const selectedRange = (): LogicalRange | null => {
    if (!engine) return null;
    const s = document.getSelection();
    const r = s && s.rangeCount && !s.isCollapsed ? s.getRangeAt(0) : lastSel.current;
    return r ? rangeToLogical(r, engine.byId) : null;
  };
  const clearSelection = () => {
    document.getSelection()?.removeAllRanges();
    lastSel.current = null;
    setHasSel(false);
  };

  const openFile = async (file: File) => {
    setLoading(true);
    setError(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const b = await loadManuscript(file.name, bytes);
      setMode({ kind: 'read' });
      setAnnotations([]);
      setBook(b);
    } catch (e) {
      // 読込失敗では既存の作業を保持する（§3, §7）
      setError(e instanceof LoadError ? e.message : `読み込めませんでした：${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  // --- 赤入れの操作 ---
  const startAnnotate = () => {
    const r = selectedRange();
    if (!book || !engine || !r) return;
    const anchor = readingLoc.current ?? engine.location();
    clearSelection();
    setMode({ kind: 'edit', draft: makeDraft(book, engine.text, r), editing: null, anchor, backToList: false });
  };
  const startExtend = () => {
    const r = selectedRange();
    if (!engine || !r) return;
    const anchor = readingLoc.current ?? engine.location();
    clearSelection();
    setMode({ kind: 'extend', start: r.start, startRange: r, anchor });
  };
  const finishExtend = () => {
    if (!book || !engine || mode.kind !== 'extend') return;
    const r = selectedRange();
    if (!r) return;
    if (engine.text.compare(r.end, mode.start) <= 0) {
      setNotice('終点が始点より前です。始点より後ろを選び直してください。');
      return;
    }
    const range = { start: mode.start, end: r.end };
    clearSelection();
    setNotice(null);
    setMode({ kind: 'edit', draft: makeDraft(book, engine.text, range), editing: null, anchor: mode.anchor, backToList: false });
  };
  const returnTo = (anchor: ReadingLocation, backToList: string | null) => {
    engine?.freezeLayout(false);
    engine?.goTo(anchor);
    readingLoc.current = anchor;
    setMode({ kind: 'read' });
    if (backToList) {
      setListSelected(backToList);
      setDialog('list');
    }
  };
  const saveDraft = (kind: AnnotationKind, comment: string) => {
    if (!book || mode.kind !== 'edit') return;
    if (mode.editing) {
      const id = mode.editing.id;
      setAnnotations((list) => list.map((a) => (a.id === id ? { ...a, kind, comment, updatedAt: new Date().toISOString() } : a)));
      returnTo(mode.anchor, mode.backToList ? id : null);
    } else {
      const a = createAnnotation(book, mode.draft, kind, comment);
      setAnnotations((list) => [...list, a]);
      returnTo(mode.anchor, null);
    }
  };
  const cancelDraft = () => {
    if (mode.kind === 'edit') returnTo(mode.anchor, mode.backToList && mode.editing ? mode.editing.id : null);
    else if (mode.kind === 'extend') {
      clearSelection();
      setNotice(null);
      returnTo(mode.anchor, null);
    }
  };

  // --- 一覧 ---
  const jumpFromList = (a: Annotation) => {
    if (!engine || !a.range) return;
    const anchor = readingLoc.current ?? engine.location();
    setDialog(null);
    setMode({ kind: 'preview', id: a.id, anchor });
    engine.goToPos(a.range.start);
  };
  const backToList = () => {
    if (mode.kind !== 'preview') return;
    returnTo(mode.anchor, mode.id);
  };
  const editFromList = (a: Annotation) => {
    if (!engine) return;
    const anchor = mode.kind === 'preview' ? mode.anchor : (readingLoc.current ?? engine.location());
    setDialog(null);
    setMode({
      kind: 'edit',
      draft: { range: a.range!, quote: a.quote, context: a.context, chapters: a.chapters },
      editing: a,
      anchor,
      backToList: true,
    });
  };
  const deleteAnnotation = (a: Annotation) => {
    setAnnotations((list) => list.filter((x) => x.id !== a.id));
    setConfirmDelete(null);
    if (mode.kind === 'preview' && mode.id === a.id) returnTo(mode.anchor, null);
  };

  // キーボード：左で次へ、右で前へ。入力中・ダイアログ表示中・選択中は発火させない（§4.1）
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement;
      if (dialog || ev.isComposing || ev.metaKey || ev.ctrlKey || ev.altKey) return;
      if (mode.kind === 'edit') return;
      if (t.closest('input, textarea, select, [contenteditable], dialog, .panel')) return;
      const sel = document.getSelection();
      if (sel && !sel.isCollapsed) return;
      if (!engine) return;
      if (ev.key === 'ArrowLeft' || ev.key === 'PageDown') {
        engine.next();
        ev.preventDefault();
      } else if (ev.key === 'ArrowRight' || ev.key === 'PageUp') {
        engine.prev();
        ev.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog, mode.kind, engine]);

  const chapterIndex = (() => {
    if (!book || !state) return -1;
    const c = chapterAt(book, state.section, engine?.pageLocation().pos.offset ?? state.location.pos.offset);
    return c ? book.chapters.indexOf(c) : -1;
  })();
  const chapter = chapterIndex >= 0 ? book!.chapters[chapterIndex] : null;
  const keepSel = (e: React.MouseEvent) => e.preventDefault();

  const navButtons = (
    <>
      <button type="button" className="btn page-btn" onClick={() => engine?.next()} disabled={!book || state?.atEnd}>
        ← 次へ
      </button>
      <div className="grow progress" aria-live="polite">
        {state ? `${Math.round(state.progress * 100)}%　${state.page + 1} / ${state.pageCount}` : ''}
      </div>
      <button type="button" className="btn page-btn" onClick={() => engine?.prev()} disabled={!book || state?.atStart}>
        前へ →
      </button>
    </>
  );

  let footer = navButtons;
  if (mode.kind === 'read' && hasSel && book) {
    footer = (
      <div className="actionbar" role="toolbar" aria-label="選択した範囲の操作">
        <button type="button" className="btn btn-primary" onMouseDown={keepSel} onClick={startAnnotate}>
          赤入れ
        </button>
        <button type="button" className="btn btn-outline" onMouseDown={keepSel} onClick={startExtend}>
          範囲を延ばす
        </button>
        <span className="status">選択中</span>
      </div>
    );
  } else if (mode.kind === 'extend') {
    footer = (
      <div className="actionbar" role="toolbar" aria-label="ページまたぎの範囲指定">
        <button type="button" className="btn btn-outline page-btn" onMouseDown={keepSel} onClick={() => engine?.next()} disabled={state?.atEnd}>
          ← 次
        </button>
        <span className="status">終点を選択中</span>
        <button type="button" className="btn btn-outline page-btn" onMouseDown={keepSel} onClick={() => engine?.prev()} disabled={state?.atStart}>
          前 →
        </button>
        <button type="button" className="btn btn-outline" onMouseDown={keepSel} onClick={cancelDraft}>
          取消
        </button>
        <button type="button" className="btn btn-primary" onMouseDown={keepSel} onClick={finishExtend} disabled={!hasSel}>
          ここまで
        </button>
      </div>
    );
  } else if (mode.kind === 'preview') {
    footer = (
      <div className="actionbar">
        <button type="button" className="btn btn-outline" onClick={backToList}>
          一覧に戻る
        </button>
        <span className="status">一覧から表示中（読書位置は変わりません）</span>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="bar">
        <button type="button" className="btn" onClick={() => fileInput.current?.click()} disabled={loading || mode.kind !== 'read'}>
          開く
        </button>
        <div className="grow">
          <h1 className="bar-title">{book ? `${book.title}${chapter ? `　${chapter.title}` : ''}` : '初読の赤入れリーダー'}</h1>
        </div>
        {book && (
          <>
            <button type="button" className="btn" onClick={() => setDialog('toc')} disabled={mode.kind === 'edit'}>
              目次
            </button>
            <button type="button" className="btn" onClick={() => setDialog('list')} disabled={mode.kind === 'edit' || mode.kind === 'extend'}>
              一覧
            </button>
          </>
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
        {(error || notice || loading || offline.updateWaiting) && (
          <div className="notices">
            {loading && <div className="notice" role="status">読み込み中…</div>}
            {error && (
              <div className="notice notice-error" role="alert">
                <span className="grow">{error}</span>
                <button type="button" className="btn" onClick={() => setError(null)}>
                  閉じる
                </button>
              </div>
            )}
            {notice && (
              <div className="notice" role="status">
                <span className="grow">{notice}</span>
                <button type="button" className="btn" onClick={() => setNotice(null)}>
                  閉じる
                </button>
              </div>
            )}
            {offline.updateWaiting && mode.kind === 'read' && (
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
          <Reader
            book={book}
            settings={settings}
            initial={null}
            gestures={dialog === null && (mode.kind === 'read' || mode.kind === 'preview')}
            onEngine={setEngine}
            onState={onState}
          />
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

      <footer className="bar bar-bottom">{footer}</footer>

      {mode.kind === 'edit' && (
        <AnnotationPanel
          key={mode.editing?.id ?? 'new'}
          title={mode.editing ? '赤入れを編集' : '赤入れ'}
          quote={mode.draft.quote}
          chapters={mode.draft.chapters}
          initialKind={mode.editing?.kind ?? 'question'}
          initialComment={mode.editing?.comment ?? ''}
          note={highlightSupported ? null : 'このブラウザーはハイライト表示に対応していません。赤入れは保存・書き出しできます。'}
          onSave={saveDraft}
          onCancel={cancelDraft}
        />
      )}

      {book && (
        <TocDialog
          open={dialog === 'toc'}
          book={book}
          currentChapter={chapterIndex}
          onClose={() => setDialog(null)}
          onJump={(s, o) => {
            setDialog(null);
            engine?.goToSectionIndex(s, o);
          }}
        />
      )}
      <AnnotationList
        open={dialog === 'list'}
        items={sorted}
        selectedId={listSelected}
        onClose={() => setDialog(null)}
        onJump={jumpFromList}
        onEdit={editFromList}
        onDelete={(a) => setConfirmDelete(a)}
        footer={
          <label className="seg">
            <input type="checkbox" checked={settings.hideHighlights} onChange={(e) => changeSettings({ ...settings, hideHighlights: e.target.checked })} />
            本文のハイライトを隠す
          </label>
        }
      />
      <ConfirmDialog
        open={confirmDelete !== null}
        title="赤入れを削除"
        confirmLabel="削除する"
        danger
        onConfirm={() => confirmDelete && deleteAnnotation(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
      >
        <p>この赤入れを削除します。重なっている他の赤入れには影響しません。</p>
        {confirmDelete && <blockquote className="quote-text">{confirmDelete.quote.slice(0, 120)}</blockquote>}
      </ConfirmDialog>
      <SettingsDialog open={dialog === 'settings'} settings={settings} onChange={changeSettings} onClose={() => setDialog(null)} />
    </div>
  );
}
