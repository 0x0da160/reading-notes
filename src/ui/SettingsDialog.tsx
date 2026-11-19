import { FONT_SIZES, LINE_HEIGHTS, type DisplaySettings, type Theme } from '../settings';
import { Dialog } from './Dialog';

interface Props {
  open: boolean;
  settings: DisplaySettings;
  onChange: (s: DisplaySettings) => void;
  onClose: () => void;
}

const THEMES: { value: Theme; label: string }[] = [
  { value: 'system', label: '端末に合わせる' },
  { value: 'light', label: 'ライト' },
  { value: 'dark', label: 'ダーク' },
];

function step<T>(list: T[], cur: T, d: number): T {
  const i = list.indexOf(cur);
  return list[Math.min(list.length - 1, Math.max(0, i + d))]!;
}

export function SettingsDialog({ open, settings, onChange, onClose }: Props) {
  return (
    <Dialog open={open} title="表示設定" onClose={onClose}>
      <div className="field">
        <fieldset>
          <legend>テーマ</legend>
          {THEMES.map((t) => (
            <label key={t.value} className="seg">
              <input type="radio" name="theme" checked={settings.theme === t.value} onChange={() => onChange({ ...settings, theme: t.value })} />
              {t.label}
            </label>
          ))}
        </fieldset>
      </div>
      <div className="field">
        <span className="small muted" id="fs-label">文字サイズ</span>
        <div className="stepper" role="group" aria-labelledby="fs-label">
          <button type="button" className="btn btn-outline" aria-label="文字を小さく" disabled={settings.fontSize === FONT_SIZES[0]} onClick={() => onChange({ ...settings, fontSize: step(FONT_SIZES, settings.fontSize, -1) })}>
            小
          </button>
          <output aria-live="polite">{settings.fontSize}px</output>
          <button type="button" className="btn btn-outline" aria-label="文字を大きく" disabled={settings.fontSize === FONT_SIZES[FONT_SIZES.length - 1]} onClick={() => onChange({ ...settings, fontSize: step(FONT_SIZES, settings.fontSize, 1) })}>
            大
          </button>
        </div>
      </div>
      <div className="field">
        <span className="small muted" id="lh-label">行間</span>
        <div className="stepper" role="group" aria-labelledby="lh-label">
          <button type="button" className="btn btn-outline" aria-label="行間を狭く" disabled={settings.lineHeight === LINE_HEIGHTS[0]} onClick={() => onChange({ ...settings, lineHeight: step(LINE_HEIGHTS, settings.lineHeight, -1) })}>
            狭
          </button>
          <output aria-live="polite">{settings.lineHeight.toFixed(1)}</output>
          <button type="button" className="btn btn-outline" aria-label="行間を広く" disabled={settings.lineHeight === LINE_HEIGHTS[LINE_HEIGHTS.length - 1]} onClick={() => onChange({ ...settings, lineHeight: step(LINE_HEIGHTS, settings.lineHeight, 1) })}>
            広
          </button>
        </div>
      </div>
    </Dialog>
  );
}
