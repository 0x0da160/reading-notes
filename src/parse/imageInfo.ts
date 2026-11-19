// 同梱画像の形式と寸法をヘッダーから判定する（静止PNG・JPEG・静止WebPのみ対応）。
export interface ImageInfo {
  type: 'image/png' | 'image/jpeg' | 'image/webp';
  width: number;
  height: number;
}

export function sniffImage(b: Uint8Array): ImageInfo | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  // PNG
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    // APNG（acTL チャンク）は動画扱いで対象外
    if (findAscii(b, 'acTL', 8, Math.min(b.length, 4096))) return null;
    return { type: 'image/png', width: dv.getUint32(16), height: dv.getUint32(20) };
  }
  // JPEG
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1]!;
      if (marker === 0xff) {
        i++;
        continue;
      }
      const len = dv.getUint16(i + 2);
      if ((marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)) {
        return { type: 'image/jpeg', height: dv.getUint16(i + 5), width: dv.getUint16(i + 7) };
      }
      i += 2 + len;
    }
    return null;
  }
  // WebP
  if (b.length > 30 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') {
    const chunk = ascii(b, 12, 4);
    if (chunk === 'VP8X') {
      const animated = (b[20]! & 0x02) !== 0;
      if (animated) return null;
      const w = 1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16));
      const h = 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16));
      return { type: 'image/webp', width: w, height: h };
    }
    if (chunk === 'VP8 ') {
      return { type: 'image/webp', width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff };
    }
    if (chunk === 'VP8L') {
      const bits = dv.getUint32(21, true);
      return { type: 'image/webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
  }
  return null;
}

function ascii(b: Uint8Array, at: number, n: number): string {
  return String.fromCharCode(...b.subarray(at, at + n));
}

function findAscii(b: Uint8Array, s: string, from: number, to: number): boolean {
  outer: for (let i = from; i + s.length <= to; i++) {
    for (let j = 0; j < s.length; j++) if (b[i + j] !== s.charCodeAt(j)) continue outer;
    return true;
  }
  return false;
}
