import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { BookText, snapBackward, snapForward } from './bookText';
import { buildSection } from './textModel';
import { parseMarkdown } from '../parse/markdown';
import { extractBlocks } from '../parse/xhtml';
import { loadManuscript } from '../parse/load';
import type { SectionSrc } from './types';

const md = (s: string) => parseMarkdown(s).sections.map((x, i) => buildSection(x, i));
const xhtml = (body: string): SectionSrc => {
  const doc = new DOMParser().parseFromString(
    `<html xmlns="http://www.w3.org/1999/xhtml"><body>${body}</body></html>`,
    'application/xhtml+xml',
  );
  return {
    id: 'x',
    blocks: extractBlocks(doc.getElementsByTagName('body')[0]!, {
      image: (src, alt) => ({ key: src, alt }),
      link: (h) => (h.startsWith('#') ? `x${h}` : null),
      anchorKey: (id) => `x#${id}`,
    }),
  };
};

describe('§6.3 位置モデルの正解例', () => {
  it('セクション連結：境界 LF はどちらのオフセットにも含めない', () => {
    const bt = new BookText([buildSection({ id: 'A', blocks: [{ kind: 'paragraph', content: [{ kind: 'text', text: '甲乙' }] }] }, 0), buildSection({ id: 'B', blocks: [{ kind: 'paragraph', content: [{ kind: 'text', text: '丙丁' }] }] }, 1)]);
    expect(bt.quote({ start: { section: 'A', offset: 1 }, end: { section: 'B', offset: 1 } })).toBe('乙\n丙');
    expect(bt.quote({ start: { section: 'A', offset: 1 }, end: { section: 'B', offset: 0 } })).toBe('乙\n');
  });

  it('ルビは親文字だけ（Markdown と EPUB で同じ論理本文）', () => {
    const a = md('｜火星《かせい》へ')[0]!;
    const b = buildSection(xhtml('<p><ruby>火星<rp>（</rp><rt>かせい</rt><rp>）</rp></ruby>へ</p>'), 0);
    expect(a.text).toBe('火星へ');
    expect(b.text).toBe('火星へ');
    expect(a.text.slice(0, 2)).toBe('火星');
  });

  it('書記素の途中では区切らない', () => {
    const t = 'Á🪐';
    expect(snapBackward(t, 1)).toBe(0);
    expect(snapForward(t, 1)).toBe(2);
    expect(snapBackward(t, 3)).toBe(2);
    expect(snapForward(t, 3)).toBe(4);
  });

  it('空行が複数あっても空段落を作らない', () => {
    expect(md('甲\n\n\n\n乙')[0]!.text).toBe('甲\n乙');
    expect(buildSection(xhtml('<p>甲</p><p></p><p>  </p><p>乙</p>'), 0).text).toBe('甲\n乙');
  });

  it('挿絵は本文に数えないが画像アンカーを持つ', () => {
    const s = buildSection(xhtml('<p>甲</p><figure><img src="a.png" alt="絵"/></figure><p>乙</p>'), 0);
    expect(s.text).toBe('甲\n乙');
    expect(s.images).toEqual([1]);
  });
});

describe('本文抽出の規則', () => {
  it('ASCII 空白をまとめ、行の両端から除き、全角空白は残す', () => {
    expect(buildSection(xhtml('<p>  a \t b  <br/>  c  </p>'), 0).text).toBe('a b\nc');
    expect(buildSection(xhtml('<p>　本文</p>'), 0).text).toBe('　本文');
  });
  it('Markdown の単一改行は半角空白、行末2空白は明示改行', () => {
    expect(md('甲\n乙')[0]!.text).toBe('甲 乙');
    expect(md('甲  \n乙')[0]!.text).toBe('甲\n乙');
  });
  it('rp・hidden・script は表示も計数もしない', () => {
    expect(buildSection(xhtml('<p>甲<span hidden="">隠</span><script>x</script>乙</p><nav hidden=""><p>目次</p></nav>'), 0).text).toBe('甲乙');
  });
  it('入れ子のブロックで区切りを重複させない', () => {
    expect(buildSection(xhtml('<div><div><p>甲</p></div></div><section><p>乙</p></section>'), 0).text).toBe('甲\n乙');
  });
  it('段落字下げは全角空白で始まる段落に付けない', () => {
    const s = buildSection(xhtml('<p>甲</p><p>　乙</p>'), 0);
    expect(s.blocks.map((b) => b.indent)).toEqual([true, false]);
  });
  it('連続する明示改行はそれぞれ LF', () => {
    expect(buildSection(xhtml('<p>甲<br/><br/>乙</p>'), 0).text).toBe('甲\n\n乙');
  });
  it('改行だけの段落は位置を消費しない', () => {
    expect(buildSection(xhtml('<p>甲</p><p><br/></p><p>乙</p>'), 0).text).toBe('甲\n乙');
  });
  it('ルビは rb なしの複数組に対応する', () => {
    const s = buildSection(xhtml('<p><ruby>岩<rp>（</rp><rt>いわ</rt><rp>）</rp>城<rp>（</rp><rt>き</rt><rp>）</rp></ruby>班長</p>'), 0);
    expect(s.text).toBe('岩城班長');
    const run = s.blocks[0]!.runs[0]!;
    expect(run.kind === 'ruby' && run.pairs.map((p) => [p.start, p.base, p.rt])).toEqual([[0, '岩', 'いわ'], [1, '城', 'き']]);
  });
  it('Markdown の生HTMLは文字列のまま、閉じていないルビも文字列', () => {
    expect(md('<b>甲</b>｜乙《')[0]!.text).toBe('<b>甲</b>｜乙《');
  });
  it('Markdown は最も浅い見出しで章を分け、同名見出しも区別する', () => {
    const d = parseMarkdown('前置き\n\n## 章\n本文\n\n### 小\n\n## 章\n次');
    expect(d.sections.map((s) => s.id)).toEqual(['md-0', 'md-1', 'md-2']);
    expect(d.sectionHeadings).toEqual([null, '章', '章']);
    expect(d.subHeadings.map((h) => h.title)).toEqual(['小']);
  });
});

describe('サンプルEPUB', () => {
  it('読書順・目次・章・ルビを読み込む', async () => {
    const bytes = new Uint8Array(readFileSync('samples/anata-made-sankagetsu.epub'));
    const book = await loadManuscript('anata-made-sankagetsu.epub', bytes);
    expect(book.title).toBe('あなたまで三か月');
    expect(book.sections).toHaveLength(18);
    expect(book.toc).toHaveLength(16);
    expect(book.toc.every((t) => t.target)).toBe(true);
    expect(book.chapters[1]!.title).toBe('序章　謝罪');
    const ch1 = book.sections[2]!;
    expect(ch1.text.startsWith('序章　謝罪\n人類と異星文明の最初の会話は、謝罪から始まった。\nただし')).toBe(true);
    expect(ch1.text).toContain('岩城班長が言った。');
    // ナビゲーション文書の hidden な landmarks は数えない
    expect(book.sections[1]!.text).not.toContain('本文');
    expect(book.versionId).toMatch(/^[0-9a-f]{64}$/);
  });
});
