// 書き出したファイルを iOS の「ファイル」へ保存できるようにする（§7）。共有シートが使えれば共有、なければダウンロード。
export async function saveFile(name: string, text: string, type: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const file = new File([blob], name, { type });
  const nav = navigator as Navigator & { canShare?(d: { files: File[] }): boolean };
  if (nav.canShare?.({ files: [file] }) && matchMedia('(pointer: coarse)').matches) {
    try {
      await nav.share({ files: [file], title: name });
      return 'shared';
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return 'cancelled';
      // 共有できなければダウンロードに切り替える
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  // モーダルの <dialog> が開いていると、その外側は inert になりクリックが効かない
  const host = Array.from(document.querySelectorAll('dialog[open]')).pop() ?? document.body;
  host.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return 'downloaded';
}

export function safeFileName(s: string): string {
  return s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 80) || 'manuscript';
}

export function readFileText(file: File): Promise<string> {
  return file.text();
}
