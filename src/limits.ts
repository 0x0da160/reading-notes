// 読み込み上限（§3）。実機試作（§9.1）で確定するまでの暫定値。確定したら verification.md と README を同時に更新する。
export const LIMITS = {
  /** 入力ファイルの最大サイズ */
  inputBytes: 50 * 1024 * 1024,
  /** EPUB 展開後の累計サイズ */
  expandedBytes: 200 * 1024 * 1024,
  /** EPUB 内のファイル数 */
  entries: 5000,
  /** 画像1点のサイズ */
  imageBytes: 10 * 1024 * 1024,
  /** 画像1点の画素数 */
  imagePixels: 40_000_000,
  /** 本文 XHTML 1ファイルのサイズ */
  documentBytes: 8 * 1024 * 1024,
} as const;

export class LoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoadError';
  }
}

export function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${Math.round((n / 1024 / 1024) * 10) / 10} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}
