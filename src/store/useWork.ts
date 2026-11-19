// 作業（原稿・赤入れ・読書位置）と保存状態の管理（§7）。
// 保存できなくても作業はメモリに保ち、読む・赤入れ・書き出しを続けられるようにする。
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Annotation } from '../annot/types';
import { BookText } from '../model/bookText';
import { TEXT_MODEL_VERSION } from '../model/textModel';
import type { Book } from '../model/types';
import { loadManuscript } from '../parse/load';
import type { ReadingLocation } from '../reader/engine';
import type { DisplaySettings } from '../settings';
import { StorageConflict, commit, readAll, type ManuscriptRecord, type WorkspaceRecord } from './db';
import { relocateAll } from './relocate';
import { fromSnapshotAnnotation, type Snapshot } from './snapshot';

export type StorageStatus =
  /** 起動時の読込中 */
  | 'loading'
  /** ブラウザー保存済み（トランザクション完了後） */
  | 'saved'
  /** 未保存の変更あり（保存待ち） */
  | 'pending'
  /** 保存できなかった（メモリに保持） */
  | 'failed'
  /** 別タブで更新された（メモリに保持、自動保存を止める） */
  | 'conflict'
  /** このタブだけの作業（保存枠に書かない） */
  | 'detached'
  /** 原稿なし */
  | 'empty';

export interface Work {
  book: Book;
  bytes: Uint8Array;
  annotations: Annotation[];
  reading: ReadingLocation | null;
  /** 内容（赤入れ・読書位置）の世代。JSON の generation とバックアップ確認に使う */
  contentRev: number;
  backupRev: number | null;
}

export interface Prepared {
  book: Book;
  bytes: Uint8Array;
  annotations: Annotation[];
  reading: ReadingLocation | null;
  /** 利用者に示す補足（位置未確定の件数、読書位置を戻せなかった理由など） */
  notes: string[];
  contentRev: number;
}

function validReading(book: Book, bt: BookText, loc: ReadingLocation | null): { loc: ReadingLocation | null; note: string | null } {
  if (!loc) return { loc: null, note: null };
  if (bt.isValid(loc.pos)) return { loc, note: null };
  if (loc.image && bt.section(loc.image.section) && (bt.section(loc.image.section)!.images.length ?? 0) > loc.image.index) {
    return { loc: { pos: { section: loc.image.section, offset: 0 }, image: loc.image }, note: null };
  }
  const first = book.sections[0];
  return { loc: first ? { pos: { section: first.id, offset: 0 } } : null, note: '読書位置を本文で確認できなかったため、原稿の先頭に戻しました。' };
}

/** 保存枠やJSONから読んだ赤入れと読書位置を、原稿に照らして検証する（§6.1, §7.1） */
export function prepare(book: Book, bytes: Uint8Array, annotations: Annotation[], reading: ReadingLocation | null, textModelVersion: number, contentRev: number): Prepared {
  const bt = new BookText(book.sections);
  const r = relocateAll(book, bt, annotations, textModelVersion === TEXT_MODEL_VERSION);
  const v = validReading(book, bt, reading);
  const notes: string[] = [];
  if (r.unresolved) notes.push(`位置未確定の赤入れが${r.unresolved}件あります。一覧から位置を指定できます。`);
  if (v.note) notes.push(v.note);
  return { book, bytes, annotations: r.list, reading: v.loc, notes, contentRev };
}

export async function prepareFromSnapshot(snap: Snapshot, book: Book, bytes: Uint8Array): Promise<Prepared> {
  if (snap.manuscript.versionId !== book.versionId) throw new Error('原稿の版IDがJSONと一致しません。JSONを書き出したときと同じ原稿ファイルを選んでください。');
  return prepare(book, bytes, snap.annotations.map(fromSnapshotAnnotation), snap.reading, snap.textModelVersion, snap.generation);
}

function toRecord(w: Work, generation: number, settings: DisplaySettings | null): WorkspaceRecord {
  return {
    generation,
    versionId: w.book.versionId,
    textModelVersion: TEXT_MODEL_VERSION,
    annotations: w.annotations,
    reading: w.reading,
    settings,
    backupGeneration: w.backupRev,
    savedAt: new Date().toISOString(),
    contentRev: w.contentRev,
  };
}

function toManuscript(w: Work): ManuscriptRecord {
  const copy = new Uint8Array(w.bytes);
  return { fileName: w.book.fileName, format: w.book.format, versionId: w.book.versionId, bytes: copy.buffer };
}

export function useWork(settings: DisplaySettings) {
  const [work, setWork] = useState<Work | null>(null);
  const [status, setStatus] = useState<StorageStatus>('loading');
  const [restoreNotes, setRestoreNotes] = useState<string[]>([]);
  /** 保存枠の世代（最後に読み書きしたもの）。null は空の作業枠 */
  const storedGen = useRef<number | null>(null);
  const storageUsable = useRef(true);
  const statusRef = useRef(status);
  statusRef.current = status;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const workRef = useRef(work);
  const writing = useRef(false);
  const dirty = useRef(false);

  // 起動時：通常タブでは保存枠から復元する
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const saved = await readAll();
        if (cancelled) return;
        if (!saved) {
          storedGen.current = null;
          // 空の作業枠でも世代を確かめておく
          setStatus('empty');
          return;
        }
        storedGen.current = saved.work.generation;
        const bytes = new Uint8Array(saved.manuscript.bytes);
        const book = await loadManuscript(saved.manuscript.fileName, bytes);
        if (book.versionId !== saved.work.versionId) throw new Error('保存された原稿の版IDが一致しません');
        const contentRev = saved.work.contentRev ?? saved.work.generation;
        const p = prepare(book, bytes, saved.work.annotations, saved.work.reading, saved.work.textModelVersion, contentRev);
        if (cancelled) return;
        const restored = { book, bytes, annotations: p.annotations, reading: p.reading, contentRev, backupRev: saved.work.backupGeneration };
        workRef.current = restored;
        setWork(restored);
        setRestoreNotes(p.notes);
        setStatus('saved');
      } catch (e) {
        if (cancelled) return;
        // 読み出せない：保存を使わずに作業できるようにする
        storageUsable.current = false;
        setStatus('empty');
        setRestoreNotes([`ブラウザーの保存領域を使えません（${(e as Error).message}）。このタブの中で作業できます。終える前にJSONを書き出してください。`]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const flush = useCallback(async () => {
    const w = workRef.current;
    if (!w || writing.current) return;
    const st = statusRef.current;
    if (st === 'conflict' || st === 'detached' || st === 'loading') return;
    if (!storageUsable.current) {
      setStatus('failed');
      return;
    }
    writing.current = true;
    dirty.current = false;
    const next = (storedGen.current ?? 0) + 1;
    try {
      await commit(storedGen.current, toRecord(w, next, settingsRef.current));
      storedGen.current = next;
      setStatus(dirty.current ? 'pending' : 'saved');
    } catch (e) {
      setStatus(e instanceof StorageConflict ? 'conflict' : 'failed');
    } finally {
      writing.current = false;
    }
    if (dirty.current && statusRef.current !== 'conflict') void flush();
  }, []);

  // 変更を保存枠へ（短く待ってまとめる）
  const timer = useRef(0);
  const schedule = useCallback(() => {
    dirty.current = true;
    const st = statusRef.current;
    if (st === 'conflict' || st === 'detached') return;
    setStatus((s) => (s === 'failed' ? s : 'pending'));
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), 400);
  }, [flush]);

  const update = useCallback(
    (fn: (w: Work) => Work) => {
      const cur = workRef.current;
      if (!cur) return;
      const n = fn(cur);
      // 変更がなければ書き込まない（別タブで開いただけで世代を進めない）
      if (n === cur) return;
      const next = { ...n, contentRev: cur.contentRev + 1 };
      workRef.current = next;
      setWork(next);
      schedule();
    },
    [schedule],
  );

  const setAnnotations = useCallback((fn: (list: Annotation[]) => Annotation[]) => update((w) => ({ ...w, annotations: fn(w.annotations) })), [update]);

  const setReading = useCallback(
    (loc: ReadingLocation) =>
      update((w) =>
        w.reading && w.reading.pos.section === loc.pos.section && w.reading.pos.offset === loc.pos.offset && w.reading.image?.index === loc.image?.index
          ? w
          : { ...w, reading: loc },
      ),
    [update],
  );

  /** 設定の変更も保存枠に反映する（世代差分には数えない） */
  useEffect(() => {
    if (workRef.current && statusRef.current === 'saved') schedule();
  }, [settings, schedule]);

  /**
   * 原稿の切替・JSON 復元の確定（§7）。現在の保存枠を比較してから、原稿・位置・赤入れを同じトランザクションで置き換える。
   * 失敗時は保存枠も表示中の作業も変更しない。
   */
  const replace = useCallback(async (p: Prepared): Promise<{ ok: true } | { ok: false; reason: string }> => {
    const w: Work = { book: p.book, bytes: p.bytes, annotations: p.annotations, reading: p.reading, contentRev: p.contentRev, backupRev: null };
    if (storageUsable.current && statusRef.current !== 'conflict') {
      const next = (storedGen.current ?? 0) + 1;
      try {
        await commit(storedGen.current, toRecord(w, next, settingsRef.current), toManuscript(w));
        storedGen.current = next;
        workRef.current = w;
        setWork(w);
        setStatus('saved');
        setRestoreNotes(p.notes);
        return { ok: true };
      } catch (e) {
        if (e instanceof StorageConflict) {
          setStatus('conflict');
          return { ok: false, reason: '別のタブで作業枠が更新されていたため、置き換えませんでした。現在の作業はこのタブに残っています。' };
        }
        return { ok: false, reason: `ブラウザーに保存できなかったため、置き換えませんでした（${(e as Error).message}）。` };
      }
    }
    // 元から保存不能：メモリ作業として開く
    workRef.current = w;
    setWork(w);
    setStatus('failed');
    setRestoreNotes(p.notes);
    return { ok: true };
  }, []);

  /** 保存枠に書かず、このタブだけの作業として開く（以後自動で書き戻さない） */
  const openDetached = useCallback((p: Prepared) => {
    const w: Work = { book: p.book, bytes: p.bytes, annotations: p.annotations, reading: p.reading, contentRev: p.contentRev, backupRev: null };
    workRef.current = w;
    setWork(w);
    setStatus('detached');
    setRestoreNotes(p.notes);
  }, []);

  const confirmBackup = useCallback(
    (rev: number) => {
      const cur = workRef.current;
      if (!cur) return;
      const next = { ...cur, backupRev: Math.max(rev, cur.backupRev ?? 0) };
      workRef.current = next;
      setWork(next);
      schedule();
    },
    [schedule],
  );

  return {
    work,
    status,
    storageUsable: storageUsable.current,
    restoreNotes,
    clearNotes: () => setRestoreNotes([]),
    setAnnotations,
    setReading,
    replace,
    openDetached,
    confirmBackup,
  };
}
