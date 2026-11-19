import { expect, type Page } from '@playwright/test';
import path from 'node:path';

export const SAMPLE_EPUB = path.resolve('samples/anata-made-sankagetsu.epub');
export const SAMPLE_MD = path.resolve('samples/sample.md');

/** CSP 違反と、アプリ以外への通信を記録する */
export async function watch(page: Page) {
  const violations: string[] = [];
  const requests: string[] = [];
  await page.exposeFunction('__cspViolation', (v: string) => violations.push(v));
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      (window as unknown as { __cspViolation(v: string): void }).__cspViolation(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  page.on('request', (r) => requests.push(r.url()));
  return { violations, requests };
}

export async function openFile(page: Page, file: string) {
  await page.getByTestId('open-manuscript').setInputFiles(file);
  await expect(page.locator('.strip').first()).toBeAttached();
  await page.waitForFunction(() => !!(window as unknown as { __reader?: unknown }).__reader);
}

export async function progressText(page: Page) {
  return (await page.locator('.progress').textContent()) ?? '';
}

/** 現在表示中のページの先頭本文位置 */
export async function currentLocation(page: Page) {
  return page.evaluate(() => {
    const e = (window as unknown as { __reader: { state: { section: number; page: number; location: { pos: { section: string; offset: number } } } } }).__reader;
    return { section: e.state.section, page: e.state.page, pos: e.state.location.pos };
  });
}

/** 表示中ページの本文から、ページ先頭の本文位置を基準に [from, to) を選択する（長押し選択の代わり） */
export async function selectOnPage(page: Page, from: number, to: number) {
  await page.evaluate(
    ([a, b]) => {
      type Seg = { node: Text; start: number; end: number };
      const e = (window as unknown as { __reader: { list: { segments: Seg[] }[]; current: { si: number }; pageLocation(): { pos: { offset: number } } } }).__reader;
      const rs = e.list[e.current.si]!;
      const base = e.pageLocation().pos.offset;
      const find = (off: number) => {
        const s = rs.segments.find((x) => x.start <= off && off <= x.end)!;
        return [s.node, off - s.start] as const;
      };
      const [n1, o1] = find(base + a!);
      const [n2, o2] = find(base + b!);
      document.getSelection()!.setBaseAndExtent(n1, o1, n2, o2);
    },
    [from, to],
  );
}

export async function highlightSizes(page: Page) {
  return page.evaluate(() => {
    const out: Record<string, number> = {};
    for (const n of ['ann-question', 'ann-keep', 'ann-revise', 'ann-preview']) {
      const h = (CSS as unknown as { highlights: Map<string, Set<Range>> }).highlights.get(n);
      out[n] = h ? h.size : 0;
    }
    return out;
  });
}

export async function globalQuote(page: Page, start: { section: string; offset: number }, end: { section: string; offset: number }) {
  return page.evaluate(([s, e]) => {
    const r = (window as unknown as { __reader: { text: { quote(r: unknown): string } } }).__reader;
    return r.text.quote({ start: s, end: e });
  }, [start, end] as const);
}
