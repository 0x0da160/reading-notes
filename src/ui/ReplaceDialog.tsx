// 原稿の切替・JSON 復元の置換確認（§7）。失われるものを示し、事前に書き出せるようにする。
import { Dialog } from './Dialog';

export interface ReplaceInfo {
  reason: 'open' | 'json';
  current: { title: string; versionId: string; count: number; unbacked: boolean; chapter: string | null };
  incoming: { title: string; versionId: string; count: number; notes: string[] };
}

interface Props {
  info: ReplaceInfo | null;
  busy: boolean;
  error: string | null;
  storageUsable: boolean;
  onExportCurrent: () => void;
  onReplace: () => void;
  onDetached: () => void;
  onClose: () => void;
}

const short = (v: string) => `${v.slice(0, 12)}…`;

export function ReplaceDialog({ info, busy, error, storageUsable, onExportCurrent, onReplace, onDetached, onClose }: Props) {
  return (
    <Dialog
      open={info !== null}
      title={info?.reason === 'json' ? 'JSONから復元' : '別の原稿を開く'}
      onClose={onClose}
      className="dlg-wide"
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={busy}>
            やめる
          </button>
          {storageUsable && (
            <button type="button" className="btn btn-outline" onClick={onDetached} disabled={busy}>
              このタブだけで開く
            </button>
          )}
          <button type="button" className="btn btn-danger" onClick={onReplace} disabled={busy}>
            置き換える
          </button>
        </>
      }
    >
      {info && (
        <>
          <section className="data-section">
            <h3>現在の作業（置き換えると失われます）</h3>
            <p className="small">
              {info.current.title}　版ID {short(info.current.versionId)}
              <br />
              赤入れ {info.current.count}件{info.current.chapter && `、読書位置：${info.current.chapter}`}
              {info.current.unbacked && <strong className="warn">　未バックアップの変更があります</strong>}
            </p>
            <div>
              <button type="button" className="btn btn-outline" onClick={onExportCurrent} disabled={busy}>
                現在の作業をJSONに書き出す
              </button>
            </div>
          </section>
          <section className="data-section">
            <h3>{info.reason === 'json' ? '復元する内容' : '開く原稿'}</h3>
            <p className="small">
              {info.incoming.title}　版ID {short(info.incoming.versionId)}
              <br />
              赤入れ {info.incoming.count}件
            </p>
            {info.incoming.notes.map((n, i) => (
              <p key={i} className="small muted">
                {n}
              </p>
            ))}
          </section>
          <p className="small muted">
            「置き換える」はブラウザーの保存枠も置き換えます。「このタブだけで開く」は保存枠に書かず、現在の保存枠を残したままこのタブで作業します（以後、自動では保存枠に書き戻しません）。自動で合わせること（マージ）はしません。
          </p>
          {error && (
            <p className="small warn" role="alert">
              {error}
            </p>
          )}
        </>
      )}
    </Dialog>
  );
}
