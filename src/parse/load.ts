// ファイルから Book を作る。失敗時は理由つきの LoadError を投げ、呼び出し側の作業は変更しない。
import { LIMITS, LoadError, formatBytes } from '../limits';
import { buildSection } from '../model/textModel';
import type { Book, Chapter, Section, TocEntry } from '../model/types';
import { parseEpub } from './epub';
import { parseMarkdown } from './markdown';

export type ManuscriptFormat = 'markdown' | 'epub';

export function detectFormat(name: string): ManuscriptFormat | null {
  const n = name.toLowerCase();
  if (n.endsWith('.md') || n.endsWith('.markdown')) return 'markdown';
  if (n.endsWith('.epub')) return 'epub';
  return null;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 長い処理を区切り、入力への応答を妨げない（§2） */
export function yieldToMain(): Promise<void> {
  const s = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (s?.yield) return s.yield();
  return new Promise((r) => setTimeout(r, 0));
}

export async function loadManuscript(name: string, bytes: Uint8Array): Promise<Book> {
  const format = detectFormat(name);
  if (!format) throw new LoadError('対応していない形式です。Markdown（.md / .markdown）かEPUB（.epub）を選んでください。');
  if (bytes.length > LIMITS.inputBytes) throw new LoadError(`ファイルが上限（${formatBytes(LIMITS.inputBytes)}）を超えています。`);
  const versionId = await sha256Hex(bytes);
  return format === 'markdown' ? loadMarkdown(name, bytes, versionId) : loadEpub(name, bytes, versionId);
}

async function loadMarkdown(fileName: string, bytes: Uint8Array, versionId: string): Promise<Book> {
  let source: string;
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new LoadError('UTF-8として読み込めません。文字コードをUTF-8にして保存し直してください。');
  }
  const md = parseMarkdown(source);
  const sections: Section[] = [];
  for (let i = 0; i < md.sections.length; i++) {
    sections.push(buildSection(md.sections[i]!, i));
    if (i % 8 === 7) await yieldToMain();
  }
  const chapters: Chapter[] = sections.map((_s, i) => ({ title: md.sectionHeadings[i] ?? `セクション ${i + 1}`, section: i, offset: 0 }));
  const toc: TocEntry[] = [];
  sections.forEach((s, i) => {
    toc.push({ title: chapters[i]!.title, depth: 0, target: { section: i, offset: 0 } });
    for (const h of md.subHeadings.filter((h) => h.section === i)) {
      toc.push({ title: h.title, depth: h.depth, target: { section: i, offset: s.anchors.get(h.anchor) ?? 0 } });
    }
  });
  return {
    format: 'markdown',
    fileName,
    title: fileName.replace(/\.(md|markdown)$/i, ''),
    versionId,
    sections,
    chapters,
    toc,
    images: new Map(),
  };
}

async function loadEpub(fileName: string, bytes: Uint8Array, versionId: string): Promise<Book> {
  const epub = parseEpub(bytes);
  await yieldToMain();
  const sections: Section[] = [];
  for (let i = 0; i < epub.sections.length; i++) {
    sections.push(buildSection(epub.sections[i]!, i));
    if (i % 4 === 3) await yieldToMain();
  }
  const resolve = (href: string | null): { section: number; offset: number } | null => resolveTarget(sections, href);
  const toc: TocEntry[] = epub.toc.map((t) => ({ title: t.title, depth: t.depth, target: resolve(t.href) }));

  // 章：目次の有効な章境界 → 本文見出し → 「セクション n」
  let chapters: Chapter[] = dedupeChapters(
    toc.filter((t) => t.target).map((t) => ({ title: t.title, section: t.target!.section, offset: t.target!.offset })),
  );
  if (!chapters.length) {
    const levels = sections.flatMap((s) => s.blocks.filter((b) => b.kind === 'heading').map((b) => b.level ?? 9));
    const top = Math.min(...levels);
    chapters = sections.flatMap((s) =>
      s.blocks
        .filter((b) => b.kind === 'heading' && b.level === top && b.end > b.start)
        .map((b) => ({ title: s.text.slice(b.start, b.end).replace(/\n/g, ' '), section: s.index, offset: b.start })),
    );
  }
  if (!chapters.length) chapters = sections.map((_s, i) => ({ title: `セクション ${i + 1}`, section: i, offset: 0 }));
  if (chapters[0] && (chapters[0].section > 0 || chapters[0].offset > 0)) {
    // 最初の章より前の部分も章区間に含める
    chapters.unshift({ title: sections[0]?.heading ?? 'セクション 1', section: 0, offset: 0 });
  }
  return {
    format: 'epub',
    fileName,
    title: epub.title ?? fileName.replace(/\.epub$/i, ''),
    versionId,
    sections,
    chapters,
    toc,
    images: epub.images,
  };
}

export function resolveTarget(sections: Section[], href: string | null): { section: number; offset: number } | null {
  if (!href) return null;
  const [path, frag] = href.split('#') as [string, string | undefined];
  const s = sections.find((x) => x.path === path);
  if (!s) return null;
  if (!frag) return { section: s.index, offset: 0 };
  const off = s.anchors.get(href);
  return off === undefined ? { section: s.index, offset: 0 } : { section: s.index, offset: off };
}

function dedupeChapters(cs: Chapter[]): Chapter[] {
  const sorted = [...cs].sort((a, b) => a.section - b.section || a.offset - b.offset);
  return sorted.filter((c, i) => i === 0 || c.section !== sorted[i - 1]!.section || c.offset !== sorted[i - 1]!.offset);
}
