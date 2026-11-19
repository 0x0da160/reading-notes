// DRMなし・リフロー型 EPUB 3 の読み込み（§3, §3.1）。
import { unzipSync } from 'fflate';
import { LIMITS, LoadError, formatBytes } from '../limits';
import type { ImageRef, SectionSrc } from '../model/types';
import { hasParseError, parseXml } from './domParser';
import { sniffImage } from './imageInfo';
import { extractBlocks } from './xhtml';

export interface EpubDoc {
  title: string | null;
  sections: SectionSrc[];
  /** 目次（ナビゲーション文書、なければ NCX）。target は `パス#id` またはパス */
  toc: { title: string; depth: number; href: string | null }[];
  images: Map<string, Blob>;
}

const XHTML_TYPES = new Set(['application/xhtml+xml', 'text/html']);
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const FONT_OBFUSCATION = new Set(['http://www.idpf.org/2008/embedding', 'http://ns.adobe.com/pdf/enc#RC']);

export function resolvePath(base: string, href: string): { path: string; fragment: string } | null {
  let u: URL;
  try {
    u = new URL(href, `http://epub.invalid/${base}`);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' || u.host !== 'epub.invalid') return null;
  let path: string;
  try {
    path = decodeURIComponent(u.pathname.slice(1));
  } catch {
    return null;
  }
  const fragment = u.hash ? decodeURIComponent(u.hash.slice(1)) : '';
  return { path, fragment };
}

function unzip(bytes: Uint8Array): Record<string, Uint8Array> {
  let total = 0;
  let count = 0;
  try {
    return unzipSync(bytes, {
      filter(f) {
        count++;
        total += f.originalSize;
        if (count > LIMITS.entries) throw new LoadError(`EPUB内のファイル数が上限（${LIMITS.entries}）を超えています。`);
        if (total > LIMITS.expandedBytes)
          throw new LoadError(`EPUBの展開後のサイズが上限（${formatBytes(LIMITS.expandedBytes)}）を超えています。`);
        return true;
      },
    });
  } catch (e) {
    if (e instanceof LoadError) throw e;
    throw new LoadError('EPUBを展開できません。ファイルが壊れている可能性があります。');
  }
}

const utf8 = new TextDecoder('utf-8', { fatal: true });
function text(files: Record<string, Uint8Array>, path: string, what: string): string {
  const b = files[path];
  if (!b) throw new LoadError(`EPUBに必要なファイルがありません：${what}（${path}）`);
  try {
    return utf8.decode(b);
  } catch {
    throw new LoadError(`UTF-8として読み込めないファイルがあります：${path}`);
  }
}

function xml(files: Record<string, Uint8Array>, path: string, what: string, type: DOMParserSupportedType = 'application/xml'): Document {
  const doc = parseXml(text(files, path, what), type);
  if (hasParseError(doc)) throw new LoadError(`EPUB内のファイルを解析できません：${what}（${path}）`);
  return doc;
}

const byLocal = (root: Document | Element, name: string): Element[] =>
  Array.from(root.getElementsByTagName('*')).filter((e) => e.localName === name);

export function parseEpub(bytes: Uint8Array): EpubDoc {
  const files = unzip(bytes);
  const container = xml(files, 'META-INF/container.xml', 'container.xml');
  const rootfile = byLocal(container, 'rootfile')[0]?.getAttribute('full-path');
  if (!rootfile) throw new LoadError('EPUBのパッケージ文書が見つかりません。');

  // DRM：フォント難読化以外の暗号化があれば拒否
  if (files['META-INF/encryption.xml']) {
    const enc = xml(files, 'META-INF/encryption.xml', 'encryption.xml');
    const methods = byLocal(enc, 'EncryptionMethod').map((m) => m.getAttribute('Algorithm') ?? '');
    if (methods.some((m) => !FONT_OBFUSCATION.has(m))) throw new LoadError('DRMで保護されたEPUBは開けません。');
  }
  if (files['META-INF/rights.xml']) throw new LoadError('DRMで保護されたEPUBは開けません。');

  const opf = xml(files, rootfile, 'パッケージ文書');
  const meta = byLocal(opf, 'meta');
  if (meta.some((m) => m.getAttribute('property') === 'rendition:layout' && m.textContent?.trim() === 'pre-paginated'))
    throw new LoadError('固定レイアウトのEPUBには対応していません。');
  const title = byLocal(opf, 'title')[0]?.textContent?.trim() || null;

  const manifest = new Map<string, { path: string; type: string; props: string[] }>();
  const byPath = new Map<string, { id: string; type: string }>();
  for (const item of byLocal(opf, 'item')) {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    if (!id || !href) continue;
    const r = resolvePath(rootfile, href);
    if (!r) continue;
    const type = item.getAttribute('media-type') ?? '';
    manifest.set(id, { path: r.path, type, props: (item.getAttribute('properties') ?? '').split(/\s+/) });
    byPath.set(r.path, { id, type });
  }

  const spineEl = byLocal(opf, 'spine')[0];
  if (!spineEl) throw new LoadError('EPUBの読書順（spine）がありません。');
  const spine = byLocal(spineEl, 'itemref')
    .filter((ref) => ref.getAttribute('linear') !== 'no')
    .map((ref) => manifest.get(ref.getAttribute('idref') ?? ''))
    .filter((m): m is NonNullable<typeof m> => !!m && XHTML_TYPES.has(m.type));
  if (!spine.length) throw new LoadError('EPUBに読める本文がありません。');
  const spinePaths = new Set(spine.map((s) => s.path));

  // 画像は参照されたものだけ、検査してから Blob にする
  const images = new Map<string, Blob>();
  const imageCache = new Map<string, boolean>();
  const loadImage = (path: string): boolean => {
    const cached = imageCache.get(path);
    if (cached !== undefined) return cached;
    let ok = false;
    const m = byPath.get(path);
    const data = files[path];
    if (m && IMAGE_TYPES.has(m.type) && data && data.length <= LIMITS.imageBytes) {
      const info = sniffImage(data);
      if (info && info.width * info.height <= LIMITS.imagePixels && info.width > 0 && info.height > 0) {
        images.set(path, new Blob([data as Uint8Array<ArrayBuffer>], { type: info.type }));
        ok = true;
      }
    }
    imageCache.set(path, ok);
    return ok;
  };

  const sections: SectionSrc[] = spine.map((item, i) => {
    const data = files[item.path];
    if (!data) throw new LoadError(`EPUBに必要な本文ファイルがありません：${item.path}`);
    if (data.length > LIMITS.documentBytes) throw new LoadError(`本文ファイルが上限（${formatBytes(LIMITS.documentBytes)}）を超えています：${item.path}`);
    const doc = xml(files, item.path, '本文', 'application/xhtml+xml');
    const body = byLocal(doc, 'body')[0];
    const blocks = body
      ? extractBlocks(body, {
          image(src, alt): ImageRef {
            const r = resolvePath(item.path, src);
            return r && loadImage(r.path) ? { key: r.path, alt } : { key: null, alt };
          },
          link(href) {
            const r = resolvePath(item.path, href);
            if (!r || !spinePaths.has(r.path)) return null;
            return r.fragment ? `${r.path}#${r.fragment}` : r.path;
          },
          anchorKey: (id) => `${item.path}#${id}`,
        })
      : [];
    return { id: `s${i}:${item.path}`, path: item.path, blocks };
  });

  // 目次：EPUB 3 ナビゲーション文書を正とし、無い場合だけ NCX
  let toc: EpubDoc['toc'] = [];
  const navItem = [...manifest.values()].find((m) => m.props.includes('nav'));
  if (navItem && files[navItem.path]) {
    const nav = xml(files, navItem.path, 'ナビゲーション文書', 'application/xhtml+xml');
    const tocNav = byLocal(nav, 'nav').find((n) =>
      (n.getAttributeNS('http://www.idpf.org/2007/ops', 'type') ?? n.getAttribute('epub:type') ?? '').split(/\s+/).includes('toc'),
    );
    if (tocNav) {
      const visit = (ol: Element, depth: number) => {
        for (const li of Array.from(ol.children).filter((c) => c.localName === 'li')) {
          const a = Array.from(li.children).find((c) => c.localName === 'a' || c.localName === 'span');
          if (a) {
            const href = a.localName === 'a' ? a.getAttribute('href') : null;
            const r = href ? resolvePath(navItem.path, href) : null;
            toc.push({
              title: (a.textContent ?? '').replace(/[ \t\n\r\f]+/g, ' ').trim(),
              depth,
              href: r ? (r.fragment ? `${r.path}#${r.fragment}` : r.path) : null,
            });
          }
          const sub = Array.from(li.children).find((c) => c.localName === 'ol');
          if (sub) visit(sub, depth + 1);
        }
      };
      const ol = Array.from(tocNav.children).find((c) => c.localName === 'ol');
      if (ol) visit(ol, 0);
    }
  }
  if (!toc.length) {
    const ncxId = spineEl.getAttribute('toc');
    const ncxItem = (ncxId && manifest.get(ncxId)) || [...manifest.values()].find((m) => m.type === 'application/x-dtbncx+xml');
    if (ncxItem && files[ncxItem.path]) {
      const ncx = xml(files, ncxItem.path, 'NCX');
      const visit = (parent: Element, depth: number) => {
        for (const np of Array.from(parent.children).filter((c) => c.localName === 'navPoint')) {
          const label = byLocal(np, 'text')[0]?.textContent ?? '';
          const src = Array.from(np.children).find((c) => c.localName === 'content')?.getAttribute('src');
          const r = src ? resolvePath(ncxItem.path, src) : null;
          toc.push({ title: label.replace(/[ \t\n\r\f]+/g, ' ').trim(), depth, href: r ? (r.fragment ? `${r.path}#${r.fragment}` : r.path) : null });
          visit(np, depth + 1);
        }
      };
      const navMap = byLocal(ncx, 'navMap')[0];
      if (navMap) visit(navMap, 0);
    }
  }
  toc = toc.filter((t) => t.title);
  return { title, sections, toc, images };
}
