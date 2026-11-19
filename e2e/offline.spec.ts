import type { BrowserContext } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { SAMPLE_EPUB, SAMPLE_MD, highlightSizes, openFile, selectOnPage, watch } from './helpers';

// §8・§9.2：オンラインでは EPUB を一度も開かず、遮断後に初めて開く。
// 遮断は、ページからのすべての通信を失敗させるルートで表す（Service Worker が返す応答はネットワークに出ない）。
const cutNetwork = (context: BrowserContext) => context.route('**/*', (r) => r.abort('internetdisconnected'));

test('通常タブ：「オフラインで開き直せる」の後、通信を切って開き直し、初めての EPUB を読んで赤入れできる', async ({ page, context, browserName }) => {
  // Playwright の WebKit では、ルートで遮断したナビゲーションが Service Worker に届く前に止められる
  // （page.reload: Blocked by Web Inspector）。iPhone 実機の確認は device-checklist.md の項目 7 で行う。
  test.skip(browserName === 'webkit', 'Playwright WebKit では Service Worker 経由のオフライン再読み込みを再現できない');
  await page.goto('./');
  await expect(page.getByText('オフラインで開き直せます')).toBeVisible({ timeout: 20_000 });
  await cutNetwork(context);
  await page.reload();
  await expect(page.getByRole('button', { name: '原稿を開く' })).toBeVisible();
  await openFile(page, SAMPLE_EPUB);
  await page.getByRole('button', { name: '← 次へ' }).click();
  await page.getByRole('button', { name: '← 次へ' }).click();
  await selectOnPage(page, 2, 8);
  await page.getByRole('button', { name: '赤入れ', exact: true }).click();
  await page.getByRole('button', { name: '保存' }).click();
  expect((await highlightSizes(page))['ann-question']).toBe(1);
  // 機内モードのまま再読み込みしても作業を復元する
  await page.getByRole('button', { name: '一覧' }).click();
  await expect(page.locator('.list-status')).toContainText('ブラウザー保存済み');
  await page.keyboard.press('Escape');
  await page.reload();
  await page.waitForFunction(() => !!(window as unknown as { __reader?: unknown }).__reader);
  await expect.poll(async () => (await highlightSizes(page))['ann-question']).toBe(1);
});

test.describe('Service Worker なし（プライベートブラウズ相当）', () => {
  test.use({ serviceWorkers: 'block' });
  test('表示後に通信を切っても、同じタブで両形式を初めて開いて読む・赤入れ・書き出しができ、追加取得がない', async ({ page, context }) => {
    const w = await watch(page);
    await page.goto('./');
    await expect(page.getByRole('button', { name: '原稿を開く' })).toBeVisible();
    const loaded = w.requests.length;
    await cutNetwork(context);
    await openFile(page, SAMPLE_EPUB);
    await selectOnPage(page, 0, 4);
    await page.getByRole('button', { name: '赤入れ', exact: true }).click();
    await page.getByRole('button', { name: '保存' }).click();
    await page.getByTestId('open-manuscript').setInputFiles(SAMPLE_MD);
    await page.getByRole('dialog', { name: '別の原稿を開く' }).getByRole('button', { name: '置き換える' }).click();
    await expect(page.locator('.bar-title')).toContainText('sample');
    await selectOnPage(page, 1, 5);
    await page.getByRole('button', { name: '赤入れ', exact: true }).click();
    await page.getByRole('button', { name: '保存' }).click();
    await page.getByRole('button', { name: '一覧' }).click();
    await page.getByRole('button', { name: '保存と書き出し' }).click();
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'JSONを書き出す' }).click()]);
    expect(dl).toBeTruthy();
    // 実行時の追加取得がゼロ（blob: の画像と書き出しを除く）
    expect(w.requests.slice(loaded).filter((u) => !u.startsWith('blob:') && !u.startsWith('data:'))).toEqual([]);
    expect(w.violations).toEqual([]);
  });
});
