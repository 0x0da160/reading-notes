// 本文表示とページ計算。React の状態から切り離し、入力・テーマ・パネル表示では再組版しない（§2）。
import { BookText } from '../model/bookText';
import type { Book, Pos } from '../model/types';
import { resolveTarget } from '../parse/load';
import { paginate, pageForImage, pageForOffset, type Page } from './paginate';
import { createImageUrls, renderSection, type RenderedSection } from './render';

export interface ReadingLocation {
  pos: Pos;
  /** 画像だけのページの補助アンカー（§6.1） */
  image?: { section: string; index: number };
}

export interface EngineState {
  section: number;
  page: number;
  pageCount: number;
  location: ReadingLocation;
  /** 原稿全体での進捗（0〜1） */
  progress: number;
  atStart: boolean;
  atEnd: boolean;
}

export class ReaderEngine {
  readonly text: BookText;
  readonly list: RenderedSection[] = [];
  readonly byId = new Map<string, RenderedSection>();
  private pages: (Page[] | null)[] = [];
  private cur = { si: 0, pi: 0 };
  /** 読んでいた本文位置。再組版はこの位置を含むページへ戻す（連続した再組版で位置がずれない） */
  private anchor: ReadingLocation | null = null;
  private pageW = 0;
  private pageH = 0;
  private images;
  private listeners = new Set<(s: EngineState) => void>();
  private layoutListeners = new Set<() => void>();
  private ro: ResizeObserver;
  private pendingLayout = false;
  private layoutFrozen = false;

  constructor(
    private readonly area: HTMLElement,
    readonly book: Book,
    private readonly onLink: (target: string) => void,
  ) {
    this.text = new BookText(book.sections);
    this.images = createImageUrls(book);
    for (const s of book.sections) {
      const rs = renderSection(s, (k) => this.images.get(k), (t) => this.onLink(t));
      rs.el.style.visibility = 'hidden';
      this.list.push(rs);
      this.byId.set(s.id, rs);
      area.appendChild(rs.el);
    }
    this.pages = this.list.map(() => null);
    this.measureSize();
    this.ro = new ResizeObserver(() => this.requestLayout());
    this.ro.observe(area);
    for (const img of area.querySelectorAll('img')) img.addEventListener('load', () => this.requestLayout(), { once: true });
  }

  destroy(): void {
    this.ro.disconnect();
    for (const rs of this.list) rs.el.remove();
    this.images.revoke();
    this.listeners.clear();
  }

  subscribe(fn: (s: EngineState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onLayout(fn: () => void): () => void {
    this.layoutListeners.add(fn);
    return () => this.layoutListeners.delete(fn);
  }

  /** 入力中など、再組版を保留する（§2, §4.3） */
  freezeLayout(frozen: boolean): void {
    this.layoutFrozen = frozen;
    if (!frozen && this.pendingLayout) this.requestLayout();
  }

  private measureSize(): boolean {
    const w = Math.floor(this.area.clientWidth);
    const h = Math.floor(this.area.clientHeight);
    if (w === this.pageW && h === this.pageH) return false;
    this.pageW = w;
    this.pageH = h;
    this.area.style.setProperty('--page-h', `${h}px`);
    this.area.style.setProperty('--page-w', `${w}px`);
    return true;
  }

  private layoutTimer = 0;
  requestLayout(force = false): void {
    if (this.layoutFrozen) {
      this.pendingLayout = true;
      return;
    }
    this.pendingLayout = false;
    cancelAnimationFrame(this.layoutTimer);
    this.layoutTimer = requestAnimationFrame(() => this.relayout(force));
  }

  /** 文字設定・画面サイズの変更後、ページ番号ではなく読んでいた本文位置へ戻す */
  relayout(force = true): void {
    const changed = this.measureSize();
    if (!changed && !force) return;
    const loc = this.location();
    this.pages = this.list.map(() => null);
    this.goTo(loc);
    this.anchor = loc;
    for (const fn of this.layoutListeners) fn();
  }

  pagesOf(si: number): Page[] {
    let p = this.pages[si];
    if (!p) {
      p = paginate(this.list[si]!, this.pageW);
      this.pages[si] = p;
    }
    return p;
  }

  get state(): EngineState {
    const pages = this.pagesOf(this.cur.si);
    const loc = this.location();
    const total = this.text.full.length || 1;
    return {
      section: this.cur.si,
      page: this.cur.pi,
      pageCount: pages.length,
      location: loc,
      progress: Math.min(1, this.text.toGlobal(loc.pos) / total),
      atStart: this.cur.si === 0 && this.cur.pi === 0,
      atEnd: this.cur.si === this.list.length - 1 && this.cur.pi === pages.length - 1,
    };
  }

  get current(): { si: number; pi: number } {
    return { ...this.cur };
  }

  currentPage(): Page {
    return this.pagesOf(this.cur.si)[this.cur.pi]!;
  }

  /** 現在ページの読書位置：ページ先頭の本文位置。本文がなければ画像アンカー（§6.1） */
  location(): ReadingLocation {
    if (this.anchor) return this.anchor;
    return this.pageLocation();
  }

  /** 現在ページの先頭の本文位置 */
  pageLocation(): ReadingLocation {
    const rs = this.list[this.cur.si]!;
    const pages = this.pages[this.cur.si];
    const page = pages?.[this.cur.pi];
    if (!page) return { pos: { section: rs.section.id, offset: 0 } };
    if (page.offset !== null) return { pos: { section: rs.section.id, offset: page.offset } };
    // 本文のないページ：次に現れる本文位置と画像アンカー
    let next = rs.section.text.length;
    for (let i = this.cur.pi + 1; i < pages.length; i++) {
      if (pages[i]!.offset !== null) {
        next = pages[i]!.offset!;
        break;
      }
    }
    const loc: ReadingLocation = { pos: { section: rs.section.id, offset: next } };
    if (page.images.length) loc.image = { section: rs.section.id, index: page.images[0]! };
    return loc;
  }

  private show(si: number, pi: number): void {
    const prev = this.list[this.cur.si];
    if (prev && this.cur.si !== si) prev.el.style.visibility = 'hidden';
    this.cur = { si, pi };
    const rs = this.list[si]!;
    const page = this.pagesOf(si)[pi]!;
    const width = rs.el.getBoundingClientRect().width;
    rs.el.style.transform = `translateX(${page.start}px)`;
    rs.el.style.clipPath = `inset(0 ${page.start}px 0 ${Math.max(0, width - page.end)}px)`;
    rs.el.style.visibility = 'visible';
    for (const other of this.list) other.el.toggleAttribute('inert', other !== rs);
    this.emit();
  }

  private emit(): void {
    const s = this.state;
    for (const fn of this.listeners) fn(s);
  }

  goTo(loc: ReadingLocation): void {
    this.anchor = null;
    let si = this.text.indexOf(loc.pos.section);
    if (si < 0) si = 0;
    const pages = this.pagesOf(si);
    let pi = -1;
    if (loc.image) {
      const isi = this.text.indexOf(loc.image.section);
      if (isi >= 0) {
        const ip = pageForImage(this.pagesOf(isi), loc.image.index);
        if (ip >= 0) {
          this.anchor = loc;
          this.show(isi, ip);
          return;
        }
      }
    }
    if (pi < 0) pi = pageForOffset(pages, loc.pos.offset);
    this.anchor = { pos: { section: this.list[si]!.section.id, offset: Math.min(loc.pos.offset, this.list[si]!.section.text.length) } };
    this.show(si, pi);
  }

  goToPos(pos: Pos): void {
    this.goTo({ pos });
  }

  /** 参照先キー（EPUB 内リンク）へ移動。収録済み本文以外は何もしない。 */
  goToTarget(target: string): boolean {
    const t = resolveTarget(this.book.sections, target);
    if (!t) return false;
    this.goToPos({ section: this.list[t.section]!.section.id, offset: t.offset });
    return true;
  }

  goToSectionIndex(si: number, offset = 0): void {
    this.goToPos({ section: this.list[si]!.section.id, offset });
  }

  next(): boolean {
    this.anchor = null;
    const pages = this.pagesOf(this.cur.si);
    if (this.cur.pi + 1 < pages.length) this.show(this.cur.si, this.cur.pi + 1);
    else if (this.cur.si + 1 < this.list.length) this.show(this.cur.si + 1, 0);
    else return false;
    return true;
  }

  prev(): boolean {
    this.anchor = null;
    if (this.cur.pi > 0) this.show(this.cur.si, this.cur.pi - 1);
    else if (this.cur.si > 0) this.show(this.cur.si - 1, this.pagesOf(this.cur.si - 1).length - 1);
    else return false;
    return true;
  }

  /** 位置が現在のページに表示されているか */
  pageContains(pos: Pos): boolean {
    const si = this.text.indexOf(pos.section);
    if (si !== this.cur.si) return false;
    return pageForOffset(this.pagesOf(si), pos.offset) === this.cur.pi;
  }
}
