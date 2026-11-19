// 表示設定。テーマは初回描画前に読むため localStorage に置く（§4.2）。保存できなくても動作を続ける。
export type Theme = 'system' | 'light' | 'dark';

export interface DisplaySettings {
  theme: Theme;
  fontSize: number;
  lineHeight: number;
  /** 確定ハイライトを隠す（§4.2） */
  hideHighlights: boolean;
}

export const DEFAULT_SETTINGS: DisplaySettings = { theme: 'system', fontSize: 18, lineHeight: 1.8, hideHighlights: false };
export const FONT_SIZES = [14, 15, 16, 17, 18, 20, 22, 24, 26, 28];
export const LINE_HEIGHTS = [1.5, 1.6, 1.7, 1.8, 1.9, 2.0, 2.2];

const KEY = 'reading-notes:settings';
const THEME_KEY = 'reading-notes:theme';

export function loadSettings(): DisplaySettings {
  try {
    const raw = localStorage.getItem(KEY);
    const s = raw ? (JSON.parse(raw) as Partial<DisplaySettings>) : {};
    const theme = localStorage.getItem(THEME_KEY);
    return {
      theme: theme === 'light' || theme === 'dark' ? theme : 'system',
      fontSize: FONT_SIZES.includes(s.fontSize as number) ? (s.fontSize as number) : DEFAULT_SETTINGS.fontSize,
      lineHeight: LINE_HEIGHTS.includes(s.lineHeight as number) ? (s.lineHeight as number) : DEFAULT_SETTINGS.lineHeight,
      hideHighlights: s.hideHighlights === true,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: DisplaySettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ fontSize: s.fontSize, lineHeight: s.lineHeight, hideHighlights: s.hideHighlights }));
    if (s.theme === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, s.theme);
  } catch {
    /* 保存できなくても表示は続ける */
  }
}

export function applyTheme(theme: Theme): void {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
}
