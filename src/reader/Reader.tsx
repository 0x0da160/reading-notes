import { useEffect, useLayoutEffect, useRef } from 'react';
import type { Book } from '../model/types';
import type { DisplaySettings } from '../settings';
import { ReaderEngine, type EngineState, type ReadingLocation } from './engine';

interface Props {
  book: Book;
  settings: DisplaySettings;
  initial: ReadingLocation | null;
  /** 通常のページ送りジェスチャーを受け付けるか（範囲指定・入力中は無効） */
  gestures: boolean;
  onEngine: (e: ReaderEngine | null) => void;
  onState: (s: EngineState) => void;
  /** 本文のタップ。true を返すとページ送りしない（ハイライトのコメント表示に使う） */
  onTap?: (x: number, y: number) => boolean;
}

const EDGE_GUARD = 24; // Safari の端ジェスチャーと衝突しないよう、画面端からのスワイプ開始は無視する
const TAP_ZONE = 0.3;

export function Reader({ book, settings, initial, gestures, onEngine, onState, onTap }: Props) {
  const sheet = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const engine = useRef<ReaderEngine | null>(null);
  const gesturesRef = useRef(gestures);
  gesturesRef.current = gestures;
  const onTapRef = useRef(onTap);
  onTapRef.current = onTap;

  useLayoutEffect(() => {
    const el = area.current!;
    el.style.setProperty('--body-size', `${settings.fontSize}px`);
    el.style.setProperty('--body-leading', String(settings.lineHeight));
    const e = new ReaderEngine(el, book, (t) => e.goToTarget(t));
    engine.current = e;
    const off = e.subscribe(onState);
    if (initial) e.goTo(initial);
    else e.goToSectionIndex(0);
    onEngine(e);
    // 自動テスト・診断用
    (window as unknown as { __reader?: ReaderEngine }).__reader = e;
    return () => {
      off();
      onEngine(null);
      e.destroy();
      engine.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book]);

  // 文字設定の変更だけ再組版する（テーマ変更では再組版しない）
  const first = useRef(true);
  useLayoutEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const el = area.current!;
    el.style.setProperty('--body-size', `${settings.fontSize}px`);
    el.style.setProperty('--body-leading', String(settings.lineHeight));
    engine.current?.relayout(true);
  }, [settings.fontSize, settings.lineHeight]);

  // タップ・スワイプ（§3）
  useEffect(() => {
    const el = sheet.current!;
    let down: { x: number; y: number; t: number; id: number; selected: boolean } | null = null;
    const selectionActive = () => {
      const s = document.getSelection();
      return !!s && !s.isCollapsed && s.rangeCount > 0;
    };
    const onDown = (ev: PointerEvent) => {
      if (!ev.isPrimary || ev.button > 0) return;
      down = { x: ev.clientX, y: ev.clientY, t: performance.now(), id: ev.pointerId, selected: selectionActive() };
    };
    const onUp = (ev: PointerEvent) => {
      const d = down;
      down = null;
      if (!d || d.id !== ev.pointerId || !gesturesRef.current) return;
      if ((ev.target as Element).closest('.internal-link, button, a')) return;
      // 選択中・選択直後・長押しはページ送りにしない（§5.1）
      if (d.selected || selectionActive()) return;
      const dt = performance.now() - d.t;
      const dx = ev.clientX - d.x;
      const dy = ev.clientY - d.y;
      const e = engine.current;
      if (!e) return;
      const rect = el.getBoundingClientRect();
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5 && dt < 800) {
        if (d.x < EDGE_GUARD || d.x > window.innerWidth - EDGE_GUARD) return;
        // 右スワイプで次へ、左スワイプで前へ
        if (dx > 0) e.next();
        else e.prev();
        return;
      }
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10 && dt < 350) {
        if (onTapRef.current?.(ev.clientX, ev.clientY)) return;
        const rx = (ev.clientX - rect.left) / rect.width;
        if (rx < TAP_ZONE) e.next();
        else if (rx > 1 - TAP_ZONE) e.prev();
      }
    };
    const onCancel = () => {
      down = null;
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onCancel);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onCancel);
    };
  }, []);

  return (
    <div className="sheet" ref={sheet}>
      <div className="page-area" ref={area} aria-label="本文" role="document" />
    </div>
  );
}
