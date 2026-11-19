// IndexedDB の作業枠（§7）。作業枠は一冊。保存世代（generation）を比べ、競合時は上書きしない。
import type { Annotation } from '../annot/types';
import type { ReadingLocation } from '../reader/engine';
import type { DisplaySettings } from '../settings';

const DB_NAME = 'reading-notes';
const DB_VERSION = 1;
const WORK = 'workspace';
const MS = 'manuscript';
const KEY = 'current';

export interface ManuscriptRecord {
  fileName: string;
  format: 'markdown' | 'epub';
  versionId: string;
  bytes: ArrayBuffer;
}

export interface WorkspaceRecord {
  generation: number;
  versionId: string;
  textModelVersion: number;
  annotations: Annotation[];
  reading: ReadingLocation | null;
  settings: DisplaySettings | null;
  /** 利用者がファイル保存を確認したバックアップの世代 */
  backupGeneration: number | null;
  /** 内容（赤入れ・読書位置）の世代。設定やバックアップ確認の記録では増えない */
  contentRev: number;
  savedAt: string;
}

export class StorageConflict extends Error {
  constructor() {
    super('別のタブで作業枠が更新されています');
  }
}

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e) {
      reject(e);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(WORK)) db.createObjectStore(WORK);
      if (!db.objectStoreNames.contains(MS)) db.createObjectStore(MS);
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB を開けません'));
  }).catch((e) => {
    dbPromise = null;
    throw e;
  });
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB の書き込みに失敗しました'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB の書き込みが中止されました'));
  });
}

function get<T>(store: IDBObjectStore, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const r = store.get(key);
    r.onsuccess = () => resolve(r.result as T | undefined);
    r.onerror = () => reject(r.error);
  });
}

export async function readAll(): Promise<{ work: WorkspaceRecord; manuscript: ManuscriptRecord } | null> {
  const db = await openDb();
  const tx = db.transaction([WORK, MS], 'readonly');
  const [work, manuscript] = await Promise.all([get<WorkspaceRecord>(tx.objectStore(WORK), KEY), get<ManuscriptRecord>(tx.objectStore(MS), KEY)]);
  await done(tx);
  if (!work || !manuscript || work.versionId !== manuscript.versionId) return null;
  return { work, manuscript };
}

export async function readGeneration(): Promise<number | null> {
  const db = await openDb();
  const tx = db.transaction(WORK, 'readonly');
  const w = await get<WorkspaceRecord>(tx.objectStore(WORK), KEY);
  await done(tx);
  return w ? w.generation : null;
}

/**
 * 作業枠を書き換える。保存世代の比較と書き込みを同じ読み書きトランザクションで行い、
 * トランザクション全体の完了後にだけ解決する（§7）。
 * expected：最後に読み書きした世代（作業枠が空なら null）。manuscript を渡すと原稿も置き換える。
 */
export async function commit(expected: number | null, work: WorkspaceRecord, manuscript?: ManuscriptRecord): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([WORK, MS], 'readwrite');
  const ws = tx.objectStore(WORK);
  const finished = done(tx);
  const current = await get<WorkspaceRecord>(ws, KEY);
  const currentGen = current ? current.generation : null;
  if (currentGen !== expected) {
    tx.abort();
    await finished.catch(() => undefined);
    throw new StorageConflict();
  }
  ws.put(work, KEY);
  if (manuscript) tx.objectStore(MS).put(manuscript, KEY);
  await finished;
}

/** 試験・診断用：作業枠を消す */
export async function clearAll(): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([WORK, MS], 'readwrite');
  tx.objectStore(WORK).delete(KEY);
  tx.objectStore(MS).delete(KEY);
  await done(tx);
}
