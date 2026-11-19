// 原稿の中間表現と、論理本文（§6.1）にもとづく描画用モデル。

/** 解析直後のインライン要素。文字列はまだ正規化していない。 */
export type InlineSrc =
  | { kind: 'text'; text: string }
  | { kind: 'br' }
  | { kind: 'ruby'; pairs: { base: string; rt: string }[] }
  | { kind: 'style'; style: InlineStyle; children: InlineSrc[] }
  | { kind: 'link'; target: string | null; children: InlineSrc[] }
  | { kind: 'anchor'; key: string }
  | { kind: 'image'; image: ImageRef }
  | { kind: 'unsupported'; label: string };

export type InlineStyle = 'em' | 'strong' | 'code' | 'sub' | 'sup';

export interface ImageRef {
  /** 同梱画像のキー（EPUB内パス）。null なら代替表示のみ。 */
  key: string | null;
  alt: string;
}

export type BlockKind = 'heading' | 'paragraph' | 'listItem' | 'figure' | 'break';

export interface BlockSrc {
  kind: BlockKind;
  level?: number;
  /** listItem の行頭記号（表示のみ。論理本文に数えない） */
  marker?: string;
  content: InlineSrc[];
  /** ブロック先頭に置く参照先キー（id 等） */
  anchors?: string[];
}

export interface SectionSrc {
  /** 読書順の出現単位の識別子（§6.1） */
  id: string;
  /** EPUB 内パス等、リンク解決用 */
  path?: string;
  blocks: BlockSrc[];
}

/** 描画用インライン。text/ruby の start は論理本文中の UTF-16 オフセット。 */
export type Run =
  | { kind: 'text'; start: number; text: string; styles: InlineStyle[]; link: string | null }
  | { kind: 'ruby'; styles: InlineStyle[]; pairs: { start: number; base: string; rt: string }[] }
  | { kind: 'br'; offset: number }
  | { kind: 'image'; image: ImageRef; index: number; offset: number }
  | { kind: 'unsupported'; label: string };

export interface Block {
  kind: BlockKind;
  level?: number;
  marker?: string;
  /** 段落の1字下げ（全角空白で始まる段落には付けない） */
  indent: boolean;
  runs: Run[];
  start: number;
  end: number;
}

export interface Section {
  id: string;
  index: number;
  path?: string;
  blocks: Block[];
  /** 論理本文 */
  text: string;
  /** 参照先キー → オフセット */
  anchors: Map<string, number>;
  /** 画像の論理出現順 → オフセット */
  images: number[];
  /** 最初の見出しの文字列 */
  heading: string | null;
}

export interface Chapter {
  title: string;
  section: number;
  offset: number;
}

export interface TocEntry {
  title: string;
  depth: number;
  target: { section: number; offset: number } | null;
}

export interface Book {
  format: 'markdown' | 'epub';
  fileName: string;
  title: string;
  /** 元ファイルの SHA-256（16進） */
  versionId: string;
  sections: Section[];
  chapters: Chapter[];
  toc: TocEntry[];
  /** 画像キー → Blob */
  images: Map<string, Blob>;
}

export interface Pos {
  section: string;
  offset: number;
}

export interface LogicalRange {
  start: Pos;
  end: Pos;
}
