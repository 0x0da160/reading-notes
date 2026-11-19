import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { chapterLabel, createAnnotation, makeDraft, sortAnnotations, type Draft } from './annot/build';
import { Check, ChevronLeft, ChevronRight, FolderOpen, Highlighter, ListTree, MessageSquareText, MoveHorizontal, Settings, X } from 'lucide-react';
import { IconButton, IconLabel } from './ui/IconButton';
import { APP_VERSION } from './version';
import { annotationsAt, highlightSupported, paintAnnotations, paintPreview } from './annot/highlights';
import { AnnotationPeek } from './ui/AnnotationPeek';
import type { Annotation, AnnotationKind } from './annot/types';
import { LoadError } from './limits';
import { chapterAt } from './model/bookText';
import type { LogicalRange, Pos } from './model/types';
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
import { DataDialog, STATUS_TEXT } from './ui/DataDialog';
import { MarkdownExportDialog } from './ui/MarkdownExportDialog';
import { ReassignConfirmDialog, ReassignDialog, type Candidate } from './ui/ReassignDialog';
import { ReplaceDialog, type ReplaceInfo } from './ui/ReplaceDialog';
import { useWork, prepare, prepareFromSnapshot, type Prepared } from './store/useWork';
import { parseSnapshot, toSnapshot, SnapshotError, type Snapshot } from './store/snapshot';
import { buildAiMarkdown } from './store/aiMarkdown';
import { saveFile, safeFileName } from './store/files';
import { findCandidates } from './store/relocate';
import { TEXT_MODEL_VERSION } from './model/textModel';

const ACCEPT = '.md,.markdown,.epub,text/markdown,application/epub+zip';
const ACCEPT_JSON = '.json,application/json';

type Mode =
  | { kind: 'read' }
  /** ページまたぎ：始点を固定し、終点を選択中（§5.2） */
  | { kind: 'extend'; start: Pos; startRange: LogicalRange; anchor: ReadingLocation; reassignId?: string }
  /** コメント入力。保存・取消後は anchor へ戻る */
  | { kind: 'edit'; draft: Draft; editing: Annotation | null; anchor: ReadingLocation; backToList: boolean }
  /** 一覧からの一時プレビュー。読書再開位置を更新しない（§5.1） */
  | { kind: 'preview'; id: string; anchor: ReadingLocation }
  /** 再割り当て：候補の仮表示（自動確定しない） */
  | { kind: 'reassign-preview'; id: string; range: LogicalRange; anchor: ReadingLocation }
  /** 再割り当て：本文から選び直す */
  | { kind: 'reassign-select'; id: string; anchor: ReadingLocation };

type DialogKind = 'toc' | 'settings' | 'list' | 'data' | 'markdown' | 'reassign' | 'peek' | null;

export function App() {
  const [settings, setSettings] = useState<DisplaySettings>(loadSettings);
  const w = useWork(settings);
  const work = w.work;
  const book = work?.book ?? null;
  const annotations = work?.annotations ?? [];
  const [engine, setEngine] = useState<ReaderEngine | null>(null);
  const [state, setState] = useState<EngineState | null>(null);
  const [readerKey, setReaderKey] = useState(0);
  const [mode, setMode] = useState<Mode>({ kind: 'read' });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [listSelected, setListSelected] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Annotation | null>(null);
  const [peekIds, setPeekIds] = useState<string[]>([]);
  const [offline, setOffline] = useState<OfflineStatus>({ ready: false, updateWaiting: false });
  const [hasSel, setHasSel] = useState(false);
  const [pendingBackup, setPendingBackup] = useState<number | null>(null);
  const [replaceInfo, setReplaceInfo] = useState<ReplaceInfo | null>(null);
  const [replaceBusy, setReplaceBusy] = useState(false);
  const [replaceError, setReplaceError] = useState<string | null>(null);
  const pendingPrepared = useRef<Prepared | null>(null);
  const [importSnap, setImportSnapState] = useState<Snapshot | null>(null);
  const importSnapRef = useRef<Snapshot | null>(null);
  const setImportSnap = (s: Snapshot | null) => {
    importSnapRef.current = s;
    setImportSnapState(s);
  };
  const [reassignId, setReassignId] = useState<string | null>(null);
  const [reassignConfirm, setReassignConfirm] = useState<{ id: string; range: LogicalRange; anchor: ReadingLocation } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const jsonInput = useRef<HTMLInputElement>(null);
  const importManuscriptInput = useRef<HTMLInputElement>(null);
  const lastSel = useRef<Range | null>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const setReading = w.setReading;

  useEffect(() => subscribeOffline(setOffline), []);
  useEffect(() => applyTheme(settings.theme), [settings.theme]);

  const changeSettings = useCallback((s: DisplaySettings) => {
    setSettings(s);
    saveSettings(s);
  }, []);

  /** 通常の読書再開位置（一覧からのプレビューや範囲指定中は更新しない） */
  const onState = useCallback(
    (s: EngineState) => {
      setState(s);
      if (modeRef.current.kind === 'read') setReading(s.location);
    },
    [setReading],
  );
  const readingNow = (): ReadingLocation | null => work?.reading ?? engine?.location() ?? null;

  const sorted = useMemo(() => (engine ? sortAnnotations(annotations, engine.text) : annotations), [annotations, engine]);
  const target = (id: string | null) => (id ? (annotations.find((a) => a.id === id) ?? null) : null);

  // ハイライト（§4.2, §6.1）
  useEffect(() => paintAnnotations(engine, annotations, settings.hideHighlights), [engine, annotations, settings.hideHighlights]);
  useEffect(() => {
    let r: LogicalRange | null = null;
    if (mode.kind === 'extend') r = mode.startRange;
    else if (mode.kind === 'edit') r = mode.draft.range;
    else if (mode.kind === 'preview') r = target(mode.id)?.range ?? null;
    else if (mode.kind === 'reassign-preview') r = mode.range;
    else if (reassignConfirm) r = reassignConfirm.range;
    paintPreview(engine, r);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, mode, annotations, reassignConfirm]);
  useEffect(() => engine?.freezeLayout(mode.kind === 'edit'), [engine, mode.kind]);

  // 本文の選択状態（選択の操作は本文外の下部バーに出す）
  useEffect(() => {
    let hideTimer = 0;
    const onSel = () => {
      const s = document.getSelection();
      const node = s?.anchorNode;
      const el = node ? (node.nodeType === 1 ? (node as Element) : node.parentElement) : null;
      const inside = !!s && s.rangeCount > 0 && !s.isCollapsed && !!el?.closest('.page-area');
      clearTimeout(hideTimer);
      if (inside) {
        lastSel.current = s!.getRangeAt(0).cloneRange();
        setHasSel(true);
      } else {
        // ボタンのタップで選択が解除されても押下を受け付けられるよう、少し遅らせて隠す
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

  // --- 原稿の切替・JSON 復元（§7） ---
  const currentInfo = (): ReplaceInfo['current'] | null => {
    if (!work) return null;
    const c = state ? chapterAt(work.book, state.section, state.location.pos.offset) : null;
    return {
      title: work.book.title,
      versionId: work.book.versionId,
      count: work.annotations.length,
      unbacked: work.backupRev === null ? work.annotations.length > 0 : work.contentRev > work.backupRev,
      chapter: c?.title ?? null,
    };
  };
  const applyPrepared = async (p: Prepared, detached: boolean) => {
    setReplaceBusy(true);
    setReplaceError(null);
    let ok = true;
    if (detached) w.openDetached(p);
    else {
      const r = await w.replace(p);
      if (!r.ok) {
        ok = false;
        setReplaceError(r.reason);
      }
    }
    setReplaceBusy(false);
    if (!ok) return;
    setReplaceInfo(null);
    pendingPrepared.current = null;
    setDialog(null);
    setMode({ kind: 'read' });
    setReaderKey((k) => k + 1);
  };
  const offerReplace = (p: Prepared, reason: 'open' | 'json') => {
    const cur = currentInfo();
    // 作業枠が空、または同じ原稿で既存の赤入れがない場合は確認なしで開く
    if (!cur || (reason === 'json' && cur.versionId === p.book.versionId && cur.count === 0)) {
      void applyPrepared(p, w.status === 'detached');
      return;
    }
    pendingPrepared.current = p;
    setReplaceError(null);
    setReplaceInfo({
      reason,
      current: cur,
      incoming: { title: p.book.title, versionId: p.book.versionId, count: p.annotations.length, notes: p.notes },
    });
  };

  const openFile = async (file: File) => {
    setLoading(true);
    setError(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const b = await loadManuscript(file.name, bytes);
      offerReplace(prepare(b, bytes, [], null, TEXT_MODEL_VERSION, 0), 'open');
    } catch (e) {
      // 読込失敗では既存の作業を保持する（§3, §7）
      setError(e instanceof LoadError ? e.message : `読み込めませんでした：${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  const importJson = async (file: File) => {
    setError(null);
    let snap: Snapshot;
    try {
      snap = parseSnapshot(await file.text());
    } catch (e) {
      setError(`JSONを復元できません：${e instanceof SnapshotError ? e.message : (e as Error).message}。現在の作業は変更していません。`);
      return;
    }
    if (work && work.book.versionId === snap.manuscript.versionId) {
      offerReplace(await prepareFromSnapshot(snap, work.book, work.bytes), 'json');
    } else {
      // 元の原稿ファイルを再選択してもらう
      setImportSnap(snap);
    }
  };
  const importWithManuscript = async (file: File) => {
    const snap = importSnapRef.current;
    if (!snap) return;
    setLoading(true);
    setError(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const b = await loadManuscript(file.name, bytes);
      if (b.versionId !== snap.manuscript.versionId) throw new Error('選んだ原稿の版IDがJSONと一致しません（SHA-256 不一致）。JSONを書き出したときと同じ原稿ファイルを選んでください');
      setImportSnap(null);
      offerReplace(await prepareFromSnapshot(snap, b, bytes), 'json');
    } catch (e) {
      setImportSnap(null);
      setError(`復元できません：${(e as Error).message}。現在の作業は変更していません。`);
    } finally {
      setLoading(false);
    }
  };

  // --- 書き出し（§7.1, §7.2） ---
  const exportJson = async () => {
    if (!work) return;
    const rev = work.contentRev;
    const snap = toSnapshot({ versionId: work.book.versionId, fileName: work.book.fileName, format: work.book.format }, sorted, work.reading, rev);
    const name = `${safeFileName(work.book.title)}-赤入れ-${rev}.json`;
    const r = await saveFile(name, JSON.stringify(snap, null, 2), 'application/json');
    if (r !== 'cancelled') setPendingBackup(rev);
  };
  const exportMarkdown = async (items: Annotation[]) => {
    if (!work || !engine) return;
    const md = buildAiMarkdown({ fileName: work.book.fileName, title: work.book.title, versionId: work.book.versionId }, sortAnnotations(items, engine.text));
    await saveFile(`${safeFileName(work.book.title)}-検討用.md`, md, 'text/markdown');
    setDialog('data');
  };

  // --- 赤入れの操作 ---
  const startAnnotate = () => {
    const r = selectedRange();
    if (!book || !engine || !r) return;
    const anchor = readingNow() ?? engine.location();
    clearSelection();
    setMode({ kind: 'edit', draft: makeDraft(book, engine.text, r), editing: null, anchor, backToList: false });
  };
  const startExtend = (reassign?: string) => {
    const r = selectedRange();
    if (!engine || !r) return;
    const anchor = mode.kind === 'reassign-select' ? mode.anchor : (readingNow() ?? engine.location());
    clearSelection();
    setMode({ kind: 'extend', start: r.start, startRange: r, anchor, reassignId: reassign });
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
    if (mode.reassignId) {
      setReassignConfirm({ id: mode.reassignId, range, anchor: mode.anchor });
      return;
    }
    setMode({ kind: 'edit', draft: makeDraft(book, engine.text, range), editing: null, anchor: mode.anchor, backToList: false });
  };
  const returnTo = (anchor: ReadingLocation, backToList: string | null) => {
    engine?.freezeLayout(false);
    engine?.goTo(anchor);
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
      w.setAnnotations((list) => list.map((a) => (a.id === id ? { ...a, kind, comment, updatedAt: new Date().toISOString() } : a)));
      returnTo(mode.anchor, mode.backToList ? id : null);
    } else {
      const a = createAnnotation(book, mode.draft, kind, comment);
      w.setAnnotations((list) => [...list, a]);
      returnTo(mode.anchor, null);
    }
  };
  const cancelDraft = () => {
    if (mode.kind === 'edit') returnTo(mode.anchor, mode.backToList && mode.editing ? mode.editing.id : null);
    else if (mode.kind === 'extend') {
      clearSelection();
      setNotice(null);
      returnTo(mode.anchor, mode.reassignId ?? null);
    }
  };

  // --- 一覧 ---
  const jumpFromList = (a: Annotation) => {
    if (!engine || !a.range) return;
    const anchor = readingNow() ?? engine.location();
    setDialog(null);
    setMode({ kind: 'preview', id: a.id, anchor });
    engine.goToPos(a.range.start);
  };
  // 本文のハイライトをタップしたら、その赤入れを見せる（ページ送りしない）
  const onTapText = (x: number, y: number): boolean => {
    if (!engine || mode.kind !== 'read' || settings.hideHighlights || !highlightSupported) return false;
    const hits = annotationsAt(engine, annotations, x, y);
    if (!hits.length) return false;
    setPeekIds(hits.map((a) => a.id));
    setDialog('peek');
    return true;
  };
  const editFromList = (a: Annotation, backToList = true) => {
    if (!engine) return;
    const anchor = mode.kind === 'preview' ? mode.anchor : (readingNow() ?? engine.location());
    setDialog(null);
    setMode({
      kind: 'edit',
      draft: { range: a.range!, quote: a.quote, context: a.context, chapters: a.chapters },
      editing: a,
      anchor,
      backToList,
    });
  };
  const deleteAnnotation = (a: Annotation) => {
    w.setAnnotations((list) => list.filter((x) => x.id !== a.id));
    setConfirmDelete(null);
    if (mode.kind === 'preview' && mode.id === a.id) returnTo(mode.anchor, null);
  };

  // --- 再割り当て（§6.2） ---
  const candidates: Candidate[] = useMemo(() => {
    const t = target(reassignId);
    if (!t || !book || !engine) return [];
    return findCandidates(book, engine.text, t.quote, t.staleRange ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reassignId, book, engine]);
  const openReassign = (a: Annotation) => {
    setReassignId(a.id);
    setDialog('reassign');
  };
  const previewCandidate = (c: Candidate) => {
    if (!engine || !reassignId) return;
    const anchor = readingNow() ?? engine.location();
    setDialog(null);
    setMode({ kind: 'reassign-preview', id: reassignId, range: c.range, anchor });
    engine.goToPos(c.range.start);
  };
  const selectInText = () => {
    if (!engine || !reassignId) return;
    const anchor = readingNow() ?? engine.location();
    setDialog(null);
    setMode({ kind: 'reassign-select', id: reassignId, anchor });
  };
  const backToReassign = (id: string, anchor: ReadingLocation) => {
    engine?.goTo(anchor);
    setMode({ kind: 'read' });
    setReassignId(id);
    setDialog('reassign');
  };
  const confirmReassign = () => {
    if (!reassignConfirm || !book || !engine) return;
    const { id, range, anchor } = reassignConfirm;
    const d = makeDraft(book, engine.text, range);
    w.setAnnotations((list) =>
      list.map((a) => {
        if (a.id !== id) return a;
        const { unresolvedReason: _r, staleRange: _s, ...rest } = a;
        void _r;
        void _s;
        return { ...rest, range: d.range, quote: d.quote, context: d.context, chapters: d.chapters, originalQuote: a.originalQuote ?? a.quote, updatedAt: new Date().toISOString() };
      }),
    );
    setReassignConfirm(null);
    setReassignId(null);
    returnTo(anchor, id);
  };
  const cancelReassignConfirm = () => {
    if (!reassignConfirm) return;
    const { id, anchor } = reassignConfirm;
    setReassignConfirm(null);
    returnTo(anchor, id);
  };

  // キーボード：左で次へ、右で前へ。入力中・ダイアログ表示中・選択中は発火させない（§4.1）
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement;
      if (dialog || replaceInfo || ev.isComposing || ev.metaKey || ev.ctrlKey || ev.altKey) return;
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
  }, [dialog, mode.kind, engine, replaceInfo]);

  const chapterIndex = (() => {
    if (!book || !state || !engine) return -1;
    const c = chapterAt(book, state.section, engine.pageLocation().pos.offset);
    return c ? book.chapters.indexOf(c) : -1;
  })();
  const chapter = chapterIndex >= 0 ? book!.chapters[chapterIndex] : null;
  const keepSel = (e: React.MouseEvent) => e.preventDefault();
  const reassignTarget = target(reassignId) ?? (reassignConfirm ? target(reassignConfirm.id) : null);
  const confirmDraft = reassignConfirm && book && engine ? makeDraft(book, engine.text, reassignConfirm.range) : null;

  const navButtons = (
    <>
      <IconButton icon={ChevronLeft} label="次へ" className="page-btn" onClick={() => engine?.next()} disabled={!book || state?.atEnd} />
      <div className="grow progress" aria-live="polite">
        {state ? `${Math.round(state.progress * 100)}%　${state.page + 1} / ${state.pageCount}` : ''}
      </div>
      <IconButton icon={ChevronRight} label="前へ" className="page-btn" onClick={() => engine?.prev()} disabled={!book || state?.atStart} />
    </>
  );

  let footer = navButtons;
  if (mode.kind === 'read' && hasSel && book) {
    footer = (
      <div className="actionbar" role="toolbar" aria-label="選択した範囲の操作">
        <button type="button" className="btn btn-primary" onMouseDown={keepSel} onClick={startAnnotate}>
          <IconLabel icon={Highlighter}>赤入れ</IconLabel>
        </button>
        <button type="button" className="btn btn-outline" onMouseDown={keepSel} onClick={() => startExtend()}>
          <IconLabel icon={MoveHorizontal}>範囲を延ばす</IconLabel>
        </button>
        <span className="status">選択中</span>
      </div>
    );
  } else if (mode.kind === 'extend') {
    footer = (
      <div className="actionbar" role="toolbar" aria-label="ページまたぎの範囲指定">
        <IconButton icon={ChevronLeft} label="次へ" className="btn-outline page-btn" onMouseDown={keepSel} onClick={() => engine?.next()} disabled={state?.atEnd} />
        <span className="status">終点を選択中</span>
        <IconButton icon={ChevronRight} label="前へ" className="btn-outline page-btn" onMouseDown={keepSel} onClick={() => engine?.prev()} disabled={state?.atStart} />
        <button type="button" className="btn btn-outline" onMouseDown={keepSel} onClick={cancelDraft}>
          <IconLabel icon={X}>取消</IconLabel>
        </button>
        <button type="button" className="btn btn-primary" onMouseDown={keepSel} onClick={finishExtend} disabled={!hasSel}>
          <IconLabel icon={Check}>ここまで</IconLabel>
        </button>
      </div>
    );
  } else if (mode.kind === 'preview') {
    footer = (
      <div className="actionbar">
        <button type="button" className="btn btn-outline" onClick={() => returnTo(mode.anchor, mode.id)}>
          一覧に戻る
        </button>
        <span className="status">一覧から表示中（読書位置は変わりません）</span>
      </div>
    );
  } else if (mode.kind === 'reassign-preview') {
    footer = (
      <div className="actionbar">
        <button type="button" className="btn btn-outline" onClick={() => backToReassign(mode.id, mode.anchor)}>
          候補に戻る
        </button>
        <span className="status">候補を表示中</span>
        <button type="button" className="btn btn-primary" onClick={() => setReassignConfirm({ id: mode.id, range: mode.range, anchor: mode.anchor })}>
          この位置に割り当て
        </button>
      </div>
    );
  } else if (mode.kind === 'reassign-select') {
    footer = (
      <div className="actionbar" role="toolbar" aria-label="位置の指定">
        <button type="button" className="btn btn-outline" onMouseDown={keepSel} onClick={() => backToReassign(mode.id, mode.anchor)}>
          取消
        </button>
        {hasSel ? (
          <>
            <button
              type="button"
              className="btn btn-primary"
              onMouseDown={keepSel}
              onClick={() => {
                const r = selectedRange();
                if (!r) return;
                clearSelection();
                setReassignConfirm({ id: mode.id, range: r, anchor: mode.anchor });
              }}
            >
              この範囲を指定
            </button>
            <button type="button" className="btn btn-outline" onMouseDown={keepSel} onClick={() => startExtend(mode.id)}>
              範囲を延ばす
            </button>
          </>
        ) : (
          <>
            <IconButton icon={ChevronLeft} label="次へ" className="page-btn" onClick={() => engine?.next()} disabled={state?.atEnd} />
            <span className="status">割り当てる範囲を長押しで選択</span>
            <IconButton icon={ChevronRight} label="前へ" className="page-btn" onClick={() => engine?.prev()} disabled={state?.atStart} />
          </>
        )}
      </div>
    );
  }

  const storageWarning = w.status === 'failed' || w.status === 'conflict';
  const busyMode = mode.kind === 'edit' || mode.kind === 'extend' || mode.kind === 'reassign-select' || mode.kind === 'reassign-preview';

  return (
    <div className="app">
      <header className="bar">
        <IconButton icon={FolderOpen} label="開く" onClick={() => fileInput.current?.click()} disabled={loading || mode.kind !== 'read'} />
        <div className="grow">
          <h1 className="bar-title">{book ? `${book.title}${chapter ? `　${chapter.title}` : ''}` : '初読の赤入れリーダー'}</h1>
        </div>
        {book && (
          <>
            <IconButton icon={ListTree} label="目次" onClick={() => setDialog('toc')} disabled={mode.kind === 'edit'} />
            <IconButton icon={MessageSquareText} label="一覧" onClick={() => setDialog('list')} disabled={busyMode} />
          </>
        )}
        <IconButton icon={Settings} label="設定" onClick={() => setDialog('settings')} />
        <input ref={fileInput} type="file" accept={ACCEPT} className="visually-hidden" tabIndex={-1} aria-hidden="true" data-testid="open-manuscript"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void openFile(f);
          }}
        />
        <input ref={jsonInput} type="file" accept={ACCEPT_JSON} className="visually-hidden" tabIndex={-1} aria-hidden="true" data-testid="open-json"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void importJson(f);
          }}
        />
        <input ref={importManuscriptInput} type="file" accept={ACCEPT} className="visually-hidden" tabIndex={-1} aria-hidden="true" data-testid="open-import-manuscript"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void importWithManuscript(f);
          }}
        />
      </header>

      <main className="stage">
        {(error || notice || loading || storageWarning || w.restoreNotes.length > 0 || (offline.updateWaiting && mode.kind === 'read')) && (
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
            {storageWarning && (
              <div className="notice notice-error" role="alert">
                <span className="grow">{STATUS_TEXT[w.status]}。作業はこのタブに残っています。JSONを書き出してください。</span>
                <button type="button" className="btn btn-outline" onClick={() => void exportJson()}>
                  書き出す
                </button>
              </div>
            )}
            {w.restoreNotes.length > 0 && (
              <div className="notice" role="status">
                <span className="grow">{w.restoreNotes.join(' ')}</span>
                <button type="button" className="btn" onClick={w.clearNotes}>
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
        {book && work ? (
          <Reader
            key={`${book.versionId}-${readerKey}`}
            book={book}
            settings={settings}
            initial={work.reading}
            gestures={dialog === null && (mode.kind === 'read' || mode.kind === 'preview' || mode.kind === 'reassign-preview')}
            onEngine={setEngine}
            onState={onState}
            onTap={onTapText}
          />
        ) : (
          <div className="empty">
            <h1>初読の赤入れリーダー</h1>
            <p>自作の原稿（Markdown または EPUB）を縦書きで読み、気づいた箇所にひと言を残します。原稿はこの端末の中だけで扱い、送信しません。</p>
            <div className="row" style={{ justifyContent: 'center' }}>
              <button type="button" className="btn btn-primary" onClick={() => fileInput.current?.click()} disabled={loading || w.status === 'loading'}>
                原稿を開く
              </button>
              <button type="button" className="btn btn-outline" onClick={() => jsonInput.current?.click()} disabled={loading || w.status === 'loading'}>
                JSONから復元
              </button>
            </div>
            {offline.ready && <p className="small">オフラインで開き直せます</p>}
            <p className="small muted version">{APP_VERSION}</p>
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
      <AnnotationPeek
        items={dialog === 'peek' ? peekIds.map((id) => annotations.find((a) => a.id === id)).filter((a): a is Annotation => !!a) : []}
        onClose={() => setDialog(null)}
        onEdit={(a) => editFromList(a, false)}
        onDelete={(a) => {
          setDialog(null);
          setConfirmDelete(a);
        }}
      />
      <AnnotationList
        open={dialog === 'list'}
        items={sorted}
        selectedId={listSelected}
        onClose={() => setDialog(null)}
        onJump={jumpFromList}
        onEdit={editFromList}
        onDelete={(a) => setConfirmDelete(a)}
        onReassign={openReassign}
        status={work ? STATUS_TEXT[w.status] : null}
        unbacked={!!work && (work.backupRev === null ? work.contentRev > 0 && annotations.length > 0 : work.contentRev > work.backupRev)}
        footer={
          <>
            <label className="seg">
              <input type="checkbox" checked={settings.hideHighlights} onChange={(e) => changeSettings({ ...settings, hideHighlights: e.target.checked })} />
              本文のハイライトを隠す
            </label>
            <button type="button" className="btn btn-outline" onClick={() => setDialog('data')}>
              保存と書き出し
            </button>
          </>
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
      {work && (
        <DataDialog
          open={dialog === 'data'}
          status={w.status}
          contentRev={work.contentRev}
          backupRev={work.backupRev}
          pendingBackup={pendingBackup}
          count={annotations.length}
          offlineReady={offline.ready}
          onClose={() => setDialog(null)}
          onExportJson={() => void exportJson()}
          onConfirmBackup={() => {
            if (pendingBackup !== null) w.confirmBackup(pendingBackup);
            setPendingBackup(null);
          }}
          onExportMarkdown={() => setDialog('markdown')}
          onImportJson={() => jsonInput.current?.click()}
        />
      )}
      <MarkdownExportDialog open={dialog === 'markdown'} items={sorted} onClose={() => setDialog(null)} onExport={(items) => void exportMarkdown(items)} />
      <ReassignDialog
        open={dialog === 'reassign'}
        target={target(reassignId)}
        candidates={candidates}
        onClose={() => {
          setDialog(null);
          if (reassignId) {
            setListSelected(reassignId);
            setReassignId(null);
            setDialog('list');
          }
        }}
        onPreview={previewCandidate}
        onSelectInText={selectInText}
      />
      <ReassignConfirmDialog
        open={reassignConfirm !== null}
        target={reassignTarget}
        newQuote={confirmDraft?.quote ?? ''}
        newChapter={confirmDraft ? chapterLabel(confirmDraft.chapters) : ''}
        onConfirm={confirmReassign}
        onClose={cancelReassignConfirm}
      />
      <ReplaceDialog
        info={replaceInfo}
        busy={replaceBusy}
        error={replaceError}
        storageUsable={w.storageUsable}
        onExportCurrent={() => void exportJson()}
        onReplace={() => pendingPrepared.current && void applyPrepared(pendingPrepared.current, false)}
        onDetached={() => pendingPrepared.current && void applyPrepared(pendingPrepared.current, true)}
        onClose={() => {
          if (replaceBusy) return;
          setReplaceInfo(null);
          pendingPrepared.current = null;
        }}
      />
      <ConfirmDialog
        open={importSnap !== null}
        title="元の原稿を選ぶ"
        confirmLabel="原稿ファイルを選ぶ"
        onConfirm={() => importManuscriptInput.current?.click()}
        onClose={() => setImportSnap(null)}
      >
        <p>JSONには原稿本体が含まれません。JSONを書き出したときと同じ原稿ファイルを選んでください（版IDを照合します）。</p>
        {importSnap && <p className="small muted">{importSnap.manuscript.fileName}　赤入れ {importSnap.annotations.length}件</p>}
      </ConfirmDialog>
      <SettingsDialog open={dialog === 'settings'} settings={settings} onChange={changeSettings} onClose={() => setDialog(null)} />
    </div>
  );
}
