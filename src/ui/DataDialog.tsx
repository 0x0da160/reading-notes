// 保存状態・書き出し・復元（§7）。「このタブで作業中」「ブラウザー保存済み」「JSONの書き出し」を区別して示す。
import type { StorageStatus } from '../store/useWork';
import { Dialog } from './Dialog';

interface Props {
  open: boolean;
  status: StorageStatus;
  contentRev: number;
  backupRev: number | null;
  /** 書き出したがファイル保存を未確認のスナップショット世代 */
  pendingBackup: number | null;
  count: number;
  offlineReady: boolean;
  onClose: () => void;
  onExportJson: () => void;
  onConfirmBackup: () => void;
  onExportMarkdown: () => void;
  onImportJson: () => void;
}

export const STATUS_TEXT: Record<StorageStatus, string> = {
  loading: '読み込み中',
  saved: 'ブラウザー保存済み',
  pending: 'このタブで作業中（保存待ち）',
  failed: 'このタブで作業中（ブラウザーに保存できませんでした）',
  conflict: 'このタブで作業中（別のタブで更新されたため保存を止めています）',
  detached: 'このタブで作業中（ブラウザーの保存枠には書きません）',
  empty: '原稿なし',
};

export function DataDialog(p: Props) {
  const unbacked = p.backupRev === null ? p.contentRev > 0 : p.contentRev > p.backupRev;
  return (
    <Dialog open={p.open} title="保存と書き出し" onClose={p.onClose}>
      <section className="data-section">
        <h3>保存の状態</h3>
        <p className={`status-line status-${p.status}`} role="status">
          {STATUS_TEXT[p.status]}
        </p>
        <p className="small">{p.offlineReady ? 'オフラインで開き直せます' : 'オフラインで開き直す準備はできていません（このタブは通信なしでも動き続けます）'}</p>
        <p className="small muted">ブラウザーの保存は、次に開いたときまで残ることを保証しません。作業を残すにはJSONを書き出して「ファイル」に保存し、元の原稿と一緒に保管してください。</p>
        <p className="small">
          現在の世代：{p.contentRev}　／　ファイル保存を確認したバックアップ：{p.backupRev ?? 'なし'}
          {unbacked && <strong className="warn">　未バックアップの変更があります</strong>}
        </p>
      </section>
      <section className="data-section">
        <h3>作業再開用 JSON</h3>
        <div className="row">
          <button type="button" className="btn btn-primary" onClick={p.onExportJson}>
            JSONを書き出す
          </button>
          <button type="button" className="btn btn-outline" onClick={p.onImportJson}>
            JSONから復元
          </button>
        </div>
        {p.pendingBackup !== null && (
          <div className="confirm-box">
            <p className="small">世代 {p.pendingBackup} のJSONを書き出しました。「ファイル」に保存されたことを確かめてから押してください。</p>
            <button type="button" className="btn btn-outline" onClick={p.onConfirmBackup}>
              ファイルへの保存を確認した（世代 {p.pendingBackup}）
            </button>
          </div>
        )}
      </section>
      <section className="data-section">
        <h3>AI に渡す検討用 Markdown</h3>
        <p className="small muted">引用とコメントを含みます。原稿ファイルや選んでいない本文は含めません。AI への送信はしません。</p>
        <button type="button" className="btn btn-outline" onClick={p.onExportMarkdown} disabled={!p.count}>
          Markdownを書き出す…
        </button>
      </section>
    </Dialog>
  );
}
