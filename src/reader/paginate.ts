// 縦書き（vertical-rl）の帯を、行の切れ目でページに分ける。
// 帯の右端からの距離 d で考える。ページ k は [start, end) を表示する。
import { snapForward } from '../model/bookText';
import type { RenderedSection } from './render';

export interface Page {
  start: number;
  end: number;
  /** このページで最初に現れる本文位置。本文のないページは null */
  offset: number | null;
  /** このページに含まれる画像の論理出現順 */
  images: number[];
}

interface Interval {
  r: number;
  l: number;
}

const EPS = 0.5;

export function paginate(rs: RenderedSection, pageWidth: number): Page[] {
  const strip = rs.el;
  const right = strip.getBoundingClientRect().right;
  const d = (x: number) => right - x;

  // 行（列）と画像の占める区間を集め、重なるものをまとめる
  const raw: Interval[] = [];
  const range = document.createRange();
  range.selectNodeContents(strip);
  for (const rect of Array.from(range.getClientRects())) {
    if (rect.width > 0 && rect.height > 0) raw.push({ r: d(rect.right), l: d(rect.left) });
  }
  for (const el of strip.querySelectorAll('.img, .unsupported')) {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0) raw.push({ r: d(rect.right), l: d(rect.left) });
  }
  raw.sort((a, b) => a.r - b.r);
  const cols: Interval[] = [];
  for (const iv of raw) {
    const last = cols[cols.length - 1];
    if (last && iv.r < last.l - EPS) last.l = Math.max(last.l, iv.l);
    else cols.push({ ...iv });
  }

  const pages: Page[] = [];
  if (!cols.length) return [{ start: 0, end: pageWidth, offset: rs.section.text.length ? 0 : null, images: [] }];
  let start = 0;
  let lastFit = 0;
  for (const c of cols) {
    if (c.l - start > pageWidth + EPS && lastFit > start) {
      // 半分の行間を余白に残して次ページを始める
      const next = Math.max(lastFit, c.r - Math.min(8, (c.r - lastFit) / 2));
      pages.push({ start, end: next, offset: null, images: [] });
      start = next;
    }
    lastFit = c.l;
  }
  pages.push({ start, end: Math.max(lastFit, start + 1), offset: null, images: [] });

  const pageAt = (x: number): number => {
    let lo = 0;
    let hi = pages.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (pages[mid]!.start <= x + EPS) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  // 各ページの最初の本文位置
  const charR = (node: Text, i: number): number => {
    range.setStart(node, i);
    range.setEnd(node, Math.min(node.length, i + 1));
    const rects = range.getClientRects();
    const rc = rects[0] ?? range.getBoundingClientRect();
    return d(rc.right);
  };
  for (const seg of rs.segments) {
    if (!seg.node.length) continue;
    range.selectNodeContents(seg.node);
    const rects = Array.from(range.getClientRects()).filter((r) => r.height > 0);
    if (!rects.length) continue;
    const minR = Math.min(...rects.map((r) => d(r.right)));
    const maxL = Math.max(...rects.map((r) => d(r.left)));
    const first = pageAt(minR);
    if (pages[first]!.offset === null) pages[first]!.offset = seg.start;
    for (let j = first + 1; j < pages.length && pages[j]!.start < maxL - EPS; j++) {
      if (pages[j]!.offset !== null) continue;
      // その境界より後に現れる最初の文字を二分探索
      let lo = 0;
      let hi = seg.node.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (charR(seg.node, mid) >= pages[j]!.start - EPS) hi = mid;
        else lo = mid + 1;
      }
      if (lo < seg.node.length) pages[j]!.offset = snapForward(rs.section.text, seg.start + lo);
    }
  }
  rs.images.forEach((el, i) => {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0) pages[pageAt(d(rect.right))]!.images.push(i);
  });
  range.detach();
  return pages;
}

/** 論理位置を含むページ */
export function pageForOffset(pages: Page[], offset: number): number {
  let found = 0;
  for (let i = 0; i < pages.length; i++) {
    const o = pages[i]!.offset;
    if (o !== null && o <= offset) found = i;
    else if (o !== null && o > offset) break;
  }
  return found;
}

export function pageForImage(pages: Page[], image: number): number {
  const i = pages.findIndex((p) => p.images.includes(image));
  return i;
}
