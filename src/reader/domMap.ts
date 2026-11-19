// DOM の位置と論理本文の位置の相互変換（§6.1）。
import { snapBackward, snapForward } from '../model/bookText';
import type { LogicalRange, Pos } from '../model/types';
import { textIndex, type RenderedSection, type Segment } from './render';

/** DOM 上の点を論理位置へ。bias 'start' は後ろの本文へ、'end' は前の本文へ寄せる。 */
export function domPointToOffset(rs: RenderedSection, node: Node, offset: number, bias: 'start' | 'end'): number {
  if (node.nodeType === 3) {
    const hit = textIndex.get(node as Text);
    if (hit && hit.rs === rs) return hit.seg.start + Math.min(offset, hit.seg.node.length);
    const rt = rs.rtMap.get(node as Text);
    if (rt) return bias === 'start' ? rt.start : rt.end;
  }
  // rt 要素の内部
  const rtEl = (node.nodeType === 1 ? (node as Element) : node.parentElement)?.closest('rt');
  if (rtEl?.firstChild && rs.rtMap.get(rtEl.firstChild as Text)) {
    const rt = rs.rtMap.get(rtEl.firstChild as Text)!;
    return bias === 'start' ? rt.start : rt.end;
  }
  const segs = rs.segments;
  if (!segs.length) return 0;
  const probe = document.createRange();
  probe.setStart(node, offset);
  // 点より後ろにある最初のセグメント
  let lo = 0;
  let hi = segs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (probe.comparePoint(segs[mid]!.node, 0) > 0) hi = mid;
    else lo = mid + 1;
  }
  probe.detach();
  if (bias === 'start') return lo < segs.length ? segs[lo]!.start : rs.section.text.length;
  return lo > 0 ? segs[lo - 1]!.end : 0;
}

export function sectionOfNode(node: Node, sections: Map<string, RenderedSection>): RenderedSection | null {
  const el = (node.nodeType === 1 ? (node as Element) : node.parentElement)?.closest<HTMLElement>('.strip');
  return el ? (sections.get(el.dataset.section ?? '') ?? null) : null;
}

/** 選択範囲を論理範囲へ。書記素境界にそろえる。 */
export function rangeToLogical(range: Range, sections: Map<string, RenderedSection>): LogicalRange | null {
  const a = sectionOfNode(range.startContainer, sections);
  const b = sectionOfNode(range.endContainer, sections);
  if (!a || !b) return null;
  const s = snapBackward(a.section.text, domPointToOffset(a, range.startContainer, range.startOffset, 'start'));
  const e = snapForward(b.section.text, domPointToOffset(b, range.endContainer, range.endOffset, 'end'));
  const start: Pos = { section: a.section.id, offset: s };
  const end: Pos = { section: b.section.id, offset: e };
  if (a === b && e <= s) return null;
  return { start, end };
}

function findSeg(segs: Segment[], off: number, bias: 'start' | 'end'): { seg: Segment; at: number } | null {
  if (!segs.length) return null;
  // off を含むセグメント。境界上では bias で前後を選ぶ。
  let lo = 0;
  let hi = segs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segs[mid]!.start <= off) lo = mid;
    else hi = mid - 1;
  }
  let seg = segs[lo]!;
  if (bias === 'start') {
    if (off >= seg.end) {
      const next = segs[lo + 1];
      if (!next) return { seg, at: seg.node.length };
      return { seg: next, at: 0 };
    }
    if (off < seg.start) return { seg, at: 0 };
    return { seg, at: off - seg.start };
  }
  if (off <= seg.start && lo > 0) {
    seg = segs[lo - 1]!;
    return { seg, at: seg.node.length };
  }
  if (off < seg.start) return { seg, at: 0 };
  return { seg, at: Math.min(off - seg.start, seg.node.length) };
}

/** セクション内の論理範囲 [s, e) に対応する DOM Range */
export function offsetsToRange(rs: RenderedSection, s: number, e: number): Range | null {
  if (e <= s) return null;
  const a = findSeg(rs.segments, s, 'start');
  const b = findSeg(rs.segments, e, 'end');
  if (!a || !b) return null;
  const r = document.createRange();
  r.setStart(a.seg.node, a.at);
  r.setEnd(b.seg.node, b.at);
  if (r.collapsed) return null;
  return r;
}
