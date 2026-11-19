import { serviceWorkerUrl } from './trusted';

// 通常タブのオフライン再起動（§8）。Service Worker が使えない環境でも、表示済みのタブは追加通信なしで動く。
type Listener = (s: OfflineStatus) => void;
export interface OfflineStatus {
  /** 現在の版の Service Worker が制御し、必要資産がそろった */
  ready: boolean;
  /** 新しい版が待機中 */
  updateWaiting: boolean;
}

let status: OfflineStatus = { ready: false, updateWaiting: false };
const listeners = new Set<Listener>();
let waiting: ServiceWorker | null = null;

function set(s: Partial<OfflineStatus>) {
  status = { ...status, ...s };
  for (const l of listeners) l(status);
}

export function subscribeOffline(l: Listener): () => void {
  listeners.add(l);
  l(status);
  return () => listeners.delete(l);
}

export function registerServiceWorker(): void {
  if (import.meta.env.DEV || !('serviceWorker' in navigator)) return;
  const sw = navigator.serviceWorker;
  sw.addEventListener('message', (e: MessageEvent) => {
    if (e.data?.type === 'status') set({ ready: !!e.data.ready && !!sw.controller });
  });
  const ask = () => sw.controller?.postMessage('status');
  sw.addEventListener('controllerchange', ask);
  sw.register(serviceWorkerUrl(`${import.meta.env.BASE_URL}sw.js`), { scope: import.meta.env.BASE_URL })
    .then((reg) => {
      const track = (w: ServiceWorker | null) => {
        if (!w) return;
        w.addEventListener('statechange', () => {
          if (w.state === 'installed' && sw.controller) {
            waiting = w;
            set({ updateWaiting: true });
          }
          if (w.state === 'activated') ask();
        });
      };
      if (reg.waiting && sw.controller) {
        waiting = reg.waiting;
        set({ updateWaiting: true });
      }
      track(reg.installing);
      reg.addEventListener('updatefound', () => track(reg.installing));
      ask();
    })
    .catch(() => {
      /* 登録できなくても現在のタブは動き続ける */
    });
}

/** 利用者が明示的に更新を選んだときだけ新しい版へ切り替える（入力中の強制更新を避ける） */
export function applyUpdate(): void {
  if (!waiting) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
  waiting.postMessage('skip-waiting');
}
