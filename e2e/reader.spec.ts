import { expect, test } from '@playwright/test';
import { SAMPLE_EPUB, SAMPLE_MD, currentLocation, openFile, watch } from './helpers';

test('EPUB を縦書きで開き、CSP 違反と外部通信がない', async ({ page, baseURL }) => {
  const w = await watch(page);
  await page.goto('./');
  await openFile(page, SAMPLE_EPUB);
  await expect(page.locator('.strip').first()).toHaveCSS('writing-mode', 'vertical-rl');
  await page.getByRole('button', { name: '目次' }).click();
  await page.getByRole('button', { name: '第一章　七階と八階のあいだ' }).click();
  await expect(page.locator('.bar-title')).toContainText('第一章');
  expect(w.violations).toEqual([]);
  const origin = new URL(baseURL!).origin;
  expect(w.requests.filter((u) => !u.startsWith(origin) && !u.startsWith('blob:') && !u.startsWith('data:'))).toEqual([]);
});

test('全ページで行が欠けたり重複したりしない', async ({ page }) => {
  await page.goto('./');
  await openFile(page, SAMPLE_EPUB);
  for (const size of [{ width: 390, height: 700 }, { width: 900, height: 600 }]) {
    await page.setViewportSize(size);
    await page.waitForTimeout(200);
    const problems = await page.evaluate(() => {
      type E = {
        list: { el: HTMLElement; segments: { node: Text }[] }[];
        pagesOf(i: number): { start: number; end: number }[];
      };
      const e = (window as unknown as { __reader: E }).__reader;
      const out: string[] = [];
      e.list.forEach((rs, si) => {
        const pages = e.pagesOf(si);
        const right = rs.el.getBoundingClientRect().right;
        const r = document.createRange();
        r.selectNodeContents(rs.el);
        for (const rect of Array.from(r.getClientRects())) {
          if (!rect.width) continue;
          const a = right - rect.right;
          const b = right - rect.left;
          const inside = pages.filter((p) => a >= p.start - 1 && b <= p.end + 1);
          if (inside.length !== 1) out.push(`section ${si}: [${a.toFixed(1)}, ${b.toFixed(1)}] in ${inside.length} pages`);
        }
        for (let i = 1; i < pages.length; i++) if (pages[i]!.start < pages[i - 1]!.end - 0.5) out.push(`section ${si}: page ${i} overlaps`);
      });
      return out;
    });
    expect(problems).toEqual([]);
  }
});

test('左端タップ・右スワイプで次へ、右端タップ・左スワイプで前へ', async ({ page }) => {
  await page.goto('./');
  await openFile(page, SAMPLE_EPUB);
  const box = (await page.locator('.sheet').boundingBox())!;
  const y = box.y + box.height / 2;
  const at = async () => (await currentLocation(page)).pos;
  const a = await at();
  await page.mouse.click(box.x + 10, y);
  const b = await at();
  expect(b).not.toEqual(a);
  await page.mouse.click(box.x + box.width - 10, y);
  expect(await at()).toEqual(a);
  // スワイプ（タッチの PointerEvent を合成）
  const swipe = (from: number, to: number) =>
    page.locator('.sheet').evaluate(
      (el, [x0, x1, yy]) => {
        const opts = (x: number) => ({ clientX: x, clientY: yy, isPrimary: true, pointerId: 7, pointerType: 'touch', bubbles: true });
        el.dispatchEvent(new PointerEvent('pointerdown', opts(x0!)));
        el.dispatchEvent(new PointerEvent('pointerup', opts(x1!)));
      },
      [from, to, y],
    );
  await swipe(box.x + 80, box.x + 200);
  expect(await at()).toEqual(b);
  await swipe(box.x + 200, box.x + 80);
  expect(await at()).toEqual(a);
  // ボタン・キーボード
  await page.getByRole('button', { name: '← 次へ' }).click();
  expect(await at()).toEqual(b);
  await page.keyboard.press('ArrowRight');
  expect(await at()).toEqual(a);
});

test('文字サイズ・画面サイズを変えても読んでいた本文位置に戻る', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto('./');
  await openFile(page, SAMPLE_EPUB);
  await page.getByRole('button', { name: '目次' }).click();
  await page.getByRole('button', { name: '第二章　数える者' }).click();
  for (let i = 0; i < 5; i++) await page.getByRole('button', { name: '← 次へ' }).click();
  const before = (await currentLocation(page)).pos;
  await page.getByRole('button', { name: '設定' }).click();
  await page.getByRole('button', { name: '文字を大きく' }).click();
  await page.getByRole('button', { name: '文字を大きく' }).click();
  await page.keyboard.press('Escape');
  const check = async () =>
    page.evaluate((pos) => {
      const e = (window as unknown as { __reader: { pageContains(p: unknown): boolean } }).__reader;
      return e.pageContains(pos);
    }, before);
  await expect.poll(check).toBe(true);
  await page.setViewportSize({ width: 700, height: 390 });
  await expect.poll(check).toBe(true);
});

test('Markdown：ルビ・章・生HTMLの扱い', async ({ page }) => {
  await page.goto('./');
  await openFile(page, SAMPLE_MD);
  await expect(page.locator('.bar-title')).toContainText('第一章　駅の階段');
  await expect(page.locator('.strip ruby').first()).toContainText('火星');
  await expect(page.locator('.strip rt').first()).toHaveText('かせい');
  await expect(page.locator('.strip .tcy').first()).toHaveText('12');
  await page.getByRole('button', { name: '目次' }).click();
  await page.getByRole('button', { name: '第二章　改札' }).click();
  await expect(page.locator('.strip[data-section="md-1"]')).toContainText('<b>生のHTMLは文字列のまま</b>');
  await expect(page.locator('.strip b')).toHaveCount(0);
});

test('読み込みエラーでは理由を示し、開いている原稿を保持する', async ({ page }) => {
  await page.goto('./');
  await openFile(page, SAMPLE_MD);
  await page.getByTestId('open-manuscript').setInputFiles({ name: 'broken.epub', mimeType: 'application/epub+zip', buffer: Buffer.from('not a zip') });
  await expect(page.getByRole('alert')).toContainText('EPUB');
  await expect(page.locator('.bar-title')).toContainText('第一章');
  await page.getByTestId('open-manuscript').setInputFiles({ name: 'bad.md', mimeType: 'text/markdown', buffer: Buffer.from([0xff, 0xfe, 0x00]) });
  await expect(page.getByRole('alert')).toContainText('UTF-8');
});

test('幅320pxで横にはみ出さない', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('./');
  await openFile(page, SAMPLE_MD);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('ナビゲーション文書の目次リンクは通信せずに本文内を移動する', async ({ page }) => {
  const w = await watch(page);
  await page.goto('./');
  await openFile(page, SAMPLE_EPUB);
  await page.getByRole('button', { name: '← 次へ' }).click();
  const before = w.requests.length;
  await page.locator('.strip[data-section^="s1:"] .internal-link', { hasText: '第三章' }).click();
  await expect(page.locator('.bar-title')).toContainText('第三章');
  expect(w.requests.length).toBe(before);
});

test('ダイアログは Esc で閉じ、呼び出し元にフォーカスが戻る', async ({ page }) => {
  await page.goto('./');
  const settings = page.getByRole('button', { name: '設定' });
  await settings.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(settings).toBeFocused();
});

test('画面全体は縦にも横にもスクロールしない（本文表示中・一覧を開いた状態）', async ({ page }) => {
  await page.goto('./');
  await openFile(page, SAMPLE_EPUB);
  const root = () =>
    page.evaluate(() => {
      const e = document.scrollingElement!;
      const cs = getComputedStyle(document.documentElement);
      return { overflow: e.scrollHeight - e.clientHeight + (e.scrollWidth - e.clientWidth), x: scrollX, y: scrollY, ov: cs.overflow, osb: cs.overscrollBehaviorY };
    });
  const tryScroll = async () => {
    await page.mouse.move(200, 300);
    await page.mouse.wheel(0, 600);
    await page.evaluate(() => window.scrollTo(0, 500));
    await page.waitForTimeout(100);
  };
  await tryScroll();
  expect(await root()).toEqual({ overflow: 0, x: 0, y: 0, ov: 'hidden', osb: 'none' });
  await page.getByRole('button', { name: '一覧' }).click();
  await tryScroll();
  expect(await root()).toMatchObject({ overflow: 0, x: 0, y: 0 });
});
