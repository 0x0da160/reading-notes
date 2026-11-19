import { expect, test, type Page } from '@playwright/test';
import { SAMPLE_EPUB, currentLocation, highlightSizes, openFile, selectOnPage } from './helpers';

async function openChapter(page: Page, title: string) {
  await page.goto('./');
  await openFile(page, SAMPLE_EPUB);
  await page.getByRole('button', { name: '目次' }).click();
  await page.getByRole('button', { name: title }).click();
}

const panel = (page: Page) => page.getByRole('dialog', { name: /赤入れ/ });

test('単ページ：選択して赤入れ、Enter は改行のみ、保存で元の位置に戻る', async ({ page }) => {
  await openChapter(page, '第一章　七階と八階のあいだ');
  await page.getByRole('button', { name: '← 次へ' }).click();
  const before = await currentLocation(page);
  await selectOnPage(page, 2, 12);
  await page.getByRole('button', { name: '赤入れ', exact: true }).click();
  await expect(panel(page)).toBeVisible();
  await expect(page.getByRole('radio', { name: '疑問' })).toBeChecked();
  expect((await highlightSizes(page))['ann-preview']).toBeGreaterThan(0);
  const box = page.getByRole('textbox', { name: 'コメント' });
  await box.fill('ここは');
  await box.press('Enter');
  await expect(panel(page)).toBeVisible();
  await box.pressSequentially('誰の視点？');
  await box.press('ControlOrMeta+Enter');
  await expect(panel(page)).toBeHidden();
  const sizes = await highlightSizes(page);
  expect(sizes['ann-question']).toBe(1);
  expect(sizes['ann-preview']).toBe(0);
  expect(await currentLocation(page)).toEqual(before);
  await page.getByRole('button', { name: '一覧' }).click();
  await expect(page.getByRole('dialog', { name: '赤入れ一覧（1件）' })).toContainText('ここは\n誰の視点？');
});

test('取消は仮表示だけを消す', async ({ page }) => {
  await openChapter(page, '第一章　七階と八階のあいだ');
  await selectOnPage(page, 3, 8);
  await page.getByRole('button', { name: '赤入れ', exact: true }).click();
  await page.getByRole('button', { name: '取消' }).click();
  expect(await highlightSizes(page)).toEqual({ 'ann-question': 0, 'ann-keep': 0, 'ann-revise': 0, 'ann-preview': 0 });
});

test('ページまたぎ：途中ページを含む範囲を一件として保存し、最初のページへ戻る', async ({ page }) => {
  await openChapter(page, '第二章　数える者');
  await page.getByRole('button', { name: '← 次へ' }).click();
  const startLoc = await currentLocation(page);
  await selectOnPage(page, 5, 9);
  await page.getByRole('button', { name: '範囲を延ばす' }).click();
  await expect(page.getByText('終点を選択中')).toBeVisible();
  await expect(page.getByRole('button', { name: 'ここまで' })).toBeDisabled();
  // 通常ジェスチャーは無効（左端タップでは進まない）
  const box = (await page.locator('.sheet').boundingBox())!;
  await page.mouse.click(box.x + 8, box.y + box.height / 2);
  expect((await currentLocation(page)).page).toBe(startLoc.page);
  await page.getByRole('button', { name: '← 次', exact: true }).click();
  await page.getByRole('button', { name: '← 次', exact: true }).click();
  const endPageLoc = await currentLocation(page);
  await selectOnPage(page, 1, 6);
  await page.getByRole('button', { name: 'ここまで' }).click();
  await expect(panel(page)).toBeVisible();
  await page.getByRole('radio', { name: '修正指定' }).check();
  await page.getByRole('button', { name: '保存' }).click();
  expect(await currentLocation(page)).toEqual(startLoc);
  // 開始ページ・途中ページ・終了ページのいずれにも描画用の範囲がある（一件の論理範囲）
  expect((await highlightSizes(page))['ann-revise']).toBe(1);
  await page.getByRole('button', { name: '一覧' }).click();
  const item = page.locator('.ann-item');
  await expect(item).toHaveCount(1);
  await expect(item.locator('.kind-badge')).toHaveText('修正指定');
  const quote = (await item.locator('.item-quote').textContent())!;
  expect(quote.length).toBeGreaterThan(endPageLoc.pos.offset - startLoc.pos.offset - 5);
});

test('章（本文ファイル）またぎ：開始章〜終了章を表示する', async ({ page }) => {
  await openChapter(page, '第三章　外縁分館');
  // 前の章の最終ページへ
  await page.getByRole('button', { name: '前へ →' }).click();
  const n = await page.evaluate(() => {
    const e = (window as unknown as { __reader: { pageLocation(): { pos: { offset: number } }; list: { section: { text: string } }[]; current: { si: number } } }).__reader;
    return e.list[e.current.si]!.section.text.length - e.pageLocation().pos.offset;
  });
  await selectOnPage(page, Math.max(0, n - 6), n - 1);
  await page.getByRole('button', { name: '範囲を延ばす' }).click();
  await page.getByRole('button', { name: '← 次', exact: true }).click();
  await selectOnPage(page, 0, 10);
  await page.getByRole('button', { name: 'ここまで' }).click();
  await expect(panel(page)).toContainText('第二章　数える者〜第三章　外縁分館');
  await page.getByRole('button', { name: '保存' }).click();
  await page.getByRole('button', { name: '一覧' }).click();
  await expect(page.locator('.ann-item .item-quote')).toContainText('\n第三章　外縁分館');
});

test('終点が始点以前なら確定しない', async ({ page }) => {
  await openChapter(page, '第二章　数える者');
  await page.getByRole('button', { name: '← 次へ' }).click();
  await selectOnPage(page, 20, 30);
  await page.getByRole('button', { name: '範囲を延ばす' }).click();
  await selectOnPage(page, 2, 8);
  await page.getByRole('button', { name: 'ここまで' }).click();
  await expect(page.getByText('終点が始点より前です')).toBeVisible();
  await expect(panel(page)).toBeHidden();
});

test('重なる赤入れの片方だけを削除できる', async ({ page }) => {
  await openChapter(page, '第一章　七階と八階のあいだ');
  for (const [a, b, kind] of [[2, 12, '疑問'], [6, 20, '残したい']] as const) {
    await selectOnPage(page, a, b);
    await page.getByRole('button', { name: '赤入れ', exact: true }).click();
    await page.getByRole('radio', { name: kind }).check();
    await page.getByRole('button', { name: '保存' }).click();
  }
  expect(await highlightSizes(page)).toMatchObject({ 'ann-question': 1, 'ann-keep': 1 });
  await page.getByRole('button', { name: '一覧' }).click();
  await page.locator('.ann-item').filter({ hasText: '残したい' }).getByRole('button', { name: '削除' }).click();
  await page.getByRole('button', { name: '削除する' }).click();
  await expect(page.locator('.ann-item')).toHaveCount(1);
  expect(await highlightSizes(page)).toMatchObject({ 'ann-question': 1, 'ann-keep': 0 });
});

test('一覧からの移動は読書位置を変えず、戻ると元の位置と項目に復帰する', async ({ page }) => {
  await openChapter(page, '第一章　七階と八階のあいだ');
  await selectOnPage(page, 2, 12);
  await page.getByRole('button', { name: '赤入れ', exact: true }).click();
  await page.getByRole('button', { name: '保存' }).click();
  await page.getByRole('button', { name: '目次' }).click();
  await page.getByRole('button', { name: '第五章　待つことの家賃' }).click();
  const reading = await currentLocation(page);
  await page.getByRole('button', { name: '一覧' }).click();
  await page.locator('.ann-item .item-main').first().click();
  await expect(page.locator('.bar-title')).toContainText('第一章');
  await page.getByRole('button', { name: '一覧に戻る' }).click();
  await expect(page.locator('.ann-item.selected')).toHaveCount(1);
  await page.keyboard.press('Escape');
  expect(await currentLocation(page)).toEqual(reading);
});

test('ハイライトを隠しても仮表示には影響しない', async ({ page }) => {
  await openChapter(page, '第一章　七階と八階のあいだ');
  await selectOnPage(page, 2, 12);
  await page.getByRole('button', { name: '赤入れ', exact: true }).click();
  await page.getByRole('button', { name: '保存' }).click();
  await page.getByRole('button', { name: '一覧' }).click();
  await page.getByLabel('本文のハイライトを隠す').check();
  await page.keyboard.press('Escape');
  expect((await highlightSizes(page))['ann-question']).toBe(0);
  await selectOnPage(page, 20, 25);
  await page.getByRole('button', { name: '赤入れ', exact: true }).click();
  expect((await highlightSizes(page))['ann-preview']).toBe(1);
});

test('範囲指定の途中で回転しても、取消後は開始時のアンカーを含むページへ戻る', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await openChapter(page, '第二章　数える者');
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: '← 次へ' }).click();
  const anchor = (await currentLocation(page)).pos;
  await selectOnPage(page, 5, 9);
  await page.getByRole('button', { name: '範囲を延ばす' }).click();
  await page.getByRole('button', { name: '← 次', exact: true }).click();
  await page.setViewportSize({ width: 700, height: 390 });
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: '取消' }).click();
  await expect
    .poll(() => page.evaluate((p) => (window as unknown as { __reader: { pageContains(p: unknown): boolean } }).__reader.pageContains(p), anchor))
    .toBe(true);
});
