import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import { SAMPLE_EPUB, SAMPLE_MD, currentLocation, highlightSizes, openFile, selectOnPage } from './helpers';

async function annotate(page: Page, from: number, to: number, comment: string, kind = '疑問') {
  await selectOnPage(page, from, to);
  await page.getByRole('button', { name: '赤入れ', exact: true }).click();
  await page.getByRole('radio', { name: kind }).check();
  await page.getByRole('textbox', { name: 'コメント' }).fill(comment);
  await page.getByRole('button', { name: '保存' }).click();
}

async function waitSaved(page: Page) {
  await page.getByRole('button', { name: '一覧' }).click();
  await expect(page.locator('.list-status')).toContainText('ブラウザー保存済み');
  await page.keyboard.press('Escape');
}

async function exportJson(page: Page): Promise<string> {
  await page.getByRole('button', { name: '一覧' }).click();
  await page.getByRole('button', { name: '保存と書き出し' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'JSONを書き出す' }).click()]);
  const path = test.info().outputPath(`export-${Date.now()}.json`);
  await dl.saveAs(path);
  return path;
}

const asJson = (path: string) => ({ name: path.split('/').pop()!, mimeType: 'application/json', buffer: fs.readFileSync(path) });

async function gotoChapter(page: Page, title: string) {
  await page.getByRole('button', { name: '目次' }).click();
  await page.getByRole('button', { name: title }).click();
}

test('通常タブ：再読み込みで原稿・読書位置・赤入れ・設定を復元する', async ({ page }) => {
  await page.goto('./');
  await openFile(page, SAMPLE_EPUB);
  await gotoChapter(page, '第一章　七階と八階のあいだ');
  await annotate(page, 2, 12, '再読み込み後も残る');
  await page.getByRole('button', { name: '次へ' }).click();
  await page.getByRole('button', { name: '次へ' }).click();
  await page.getByRole('button', { name: '設定' }).click();
  await page.getByRole('radio', { name: 'ダーク' }).check();
  await page.keyboard.press('Escape');
  const before = await currentLocation(page);
  await waitSaved(page);
  await page.reload();
  await page.waitForFunction(() => !!(window as unknown as { __reader?: unknown }).__reader);
  expect((await currentLocation(page)).pos).toEqual(before.pos);
  expect((await highlightSizes(page))['ann-question']).toBe(1);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: '一覧' }).click();
  await expect(page.locator('.ann-item')).toContainText('再読み込み後も残る');
});

test('JSON：書き出しと、別のブラウザーで同じ原稿を選んでの復元。再取込で重複しない', async ({ page, browser }) => {
  await page.goto('./');
  await openFile(page, SAMPLE_EPUB);
  await gotoChapter(page, '第二章　数える者');
  await annotate(page, 1, 9, 'A', '残したい');
  await page.getByRole('button', { name: '次へ' }).click();
  await annotate(page, 3, 7, 'B', '修正指定');
  const reading = await currentLocation(page);
  const json = await exportJson(page);
  const snap = JSON.parse(fs.readFileSync(json, 'utf8'));
  expect(snap.schemaVersion).toBe(1);
  expect(snap.annotations).toHaveLength(2);
  expect(snap).not.toHaveProperty('manuscript.bytes');

  // 新規ブラウザーコンテキスト（保存枠は空）
  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await p2.goto('./');
  await p2.getByTestId('open-json').setInputFiles(asJson(json));
  await expect(p2.getByRole('dialog', { name: '元の原稿を選ぶ' })).toBeVisible();
  // 別の原稿は版IDの不一致で拒否
  await p2.getByTestId('open-import-manuscript').setInputFiles(SAMPLE_MD);
  await expect(p2.getByRole('alert')).toContainText('版IDがJSONと一致しません');
  await p2.getByTestId('open-json').setInputFiles(asJson(json));
  // JSON の読込は非同期。ダイアログが出てから原稿を選ぶ（利用者の操作と同じ順序）
  await expect(p2.getByRole('dialog', { name: '元の原稿を選ぶ' })).toBeVisible();
  await p2.getByTestId('open-import-manuscript').setInputFiles(SAMPLE_EPUB);
  await p2.waitForFunction(() => !!(window as unknown as { __reader?: unknown }).__reader);
  expect((await currentLocation(p2)).pos).toEqual(reading.pos);
  expect(await highlightSizes(p2)).toMatchObject({ 'ann-keep': 1, 'ann-revise': 1 });
  // 同じ JSON の再取込：版IDと件数を示し、確認の上で置換（重複しない）
  await p2.getByRole('button', { name: '一覧' }).click();
  await p2.getByRole('button', { name: '保存と書き出し' }).click();
  await p2.getByTestId('open-json').setInputFiles(asJson(json));
  const dlg = p2.getByRole('dialog', { name: 'JSONから復元' });
  await expect(dlg).toContainText('赤入れ 2件');
  await dlg.getByRole('button', { name: '置き換える' }).click();
  await expect(dlg).toBeHidden();
  await p2.getByRole('button', { name: '一覧' }).click();
  await expect(p2.locator('.ann-item')).toHaveCount(2);
  await ctx.close();
});

test('不正な JSON・未対応スキーマ・ID重複は拒否し、現在の作業を変えない', async ({ page }) => {
  await page.goto('./');
  await openFile(page, SAMPLE_MD);
  await annotate(page, 1, 5, '残す');
  const bad = [
    { name: 'a.json', text: '{ broken', msg: '構文' },
    { name: 'b.json', text: JSON.stringify({ schemaVersion: 99 }), msg: '未対応のスキーマ' },
  ];
  for (const b of bad) {
    await page.getByTestId('open-json').setInputFiles({ name: b.name, mimeType: 'application/json', buffer: Buffer.from(b.text) });
    await expect(page.getByRole('alert')).toContainText(b.msg);
  }
  const good = JSON.parse(fs.readFileSync(await exportJson(page), 'utf8'));
  await page.keyboard.press('Escape');
  good.annotations.push(good.annotations[0]);
  await page.getByTestId('open-json').setInputFiles({ name: 'c.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(good)) });
  await expect(page.getByRole('alert')).toContainText('重複');
  await page.getByRole('button', { name: '一覧' }).click();
  await expect(page.locator('.ann-item')).toHaveCount(1);
});

test('別の原稿に切り替える前に失われるものを示し、取消では既存の作業を保つ', async ({ page }) => {
  await page.goto('./');
  await openFile(page, SAMPLE_MD);
  await annotate(page, 1, 5, '残す');
  await page.getByTestId('open-manuscript').setInputFiles(SAMPLE_EPUB);
  const dlg = page.getByRole('dialog', { name: '別の原稿を開く' });
  await expect(dlg).toContainText('赤入れ 1件');
  await expect(dlg.getByRole('button', { name: '現在の作業をJSONに書き出す' })).toBeVisible();
  await dlg.getByRole('button', { name: 'やめる' }).click();
  await expect(page.locator('.bar-title')).toContainText('sample');
  await page.getByTestId('open-manuscript').setInputFiles(SAMPLE_EPUB);
  await dlg.getByRole('button', { name: '置き換える' }).click();
  await expect(page.locator('.bar-title')).toContainText('あなたまで三か月');
  await page.reload();
  await expect(page.locator('.bar-title')).toContainText('あなたまで三か月');
});

test('書込失敗でも作業を続けられ、未保存であることと書き出しの導線を示す', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof orig>) {
      if ((window as unknown as { __failWrites?: boolean }).__failWrites) throw new DOMException('quota', 'QuotaExceededError');
      return orig.apply(this, args);
    };
  });
  await page.goto('./');
  await openFile(page, SAMPLE_MD);
  await page.evaluate(() => ((window as unknown as { __failWrites: boolean }).__failWrites = true));
  await annotate(page, 1, 5, 'メモリに残る');
  await expect(page.getByRole('alert')).toContainText('ブラウザーに保存できませんでした');
  await expect(page.getByRole('alert').getByRole('button', { name: '書き出す' })).toBeVisible();
  await annotate(page, 8, 12, '続けて書ける');
  await page.getByRole('button', { name: '一覧' }).click();
  await expect(page.locator('.ann-item')).toHaveCount(2);
});

test('別タブ競合：古いデータで上書きせず、メモリ保持と書き出しを案内する', async ({ page, context }) => {
  await page.goto('./');
  await openFile(page, SAMPLE_MD);
  await waitSaved(page);
  const other = await context.newPage();
  await other.goto('./');
  await other.waitForFunction(() => !!(window as unknown as { __reader?: unknown }).__reader);
  await annotate(page, 1, 5, 'タブA');
  await waitSaved(page);
  await annotate(other, 8, 12, 'タブB');
  await expect(other.getByRole('alert')).toContainText('別のタブで更新された');
  await other.close();
  await page.reload();
  await page.getByRole('button', { name: '一覧' }).click();
  await expect(page.locator('.ann-item')).toHaveCount(1);
  await expect(page.locator('.ann-item')).toContainText('タブA');
});

test('バックアップ世代：書き出した世代の保存確認は、その後の変更をバックアップ済みにしない', async ({ page }) => {
  await page.goto('./');
  await openFile(page, SAMPLE_MD);
  await annotate(page, 1, 5, '一');
  await exportJson(page);
  const data = page.getByRole('dialog', { name: '保存と書き出し' });
  const confirm = data.getByRole('button', { name: /ファイルへの保存を確認した/ });
  // 書き出し後、確認前に編集する
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await annotate(page, 8, 12, '二');
  await page.getByRole('button', { name: '一覧' }).click();
  await page.getByRole('button', { name: '保存と書き出し' }).click();
  await confirm.click();
  await expect(data).toContainText('未バックアップの変更があります');
});

test('位置未確定：一覧に分けて表示し、候補から選んで割り当てる。初回の引用はJSONに残る', async ({ page }) => {
  await page.goto('./');
  await openFile(page, SAMPLE_EPUB);
  await gotoChapter(page, '第一章　七階と八階のあいだ');
  await annotate(page, 2, 8, '移動する');
  const snap = JSON.parse(fs.readFileSync(await exportJson(page), 'utf8'));
  await page.keyboard.press('Escape');
  // 前後文を壊して、旧本文モデル扱いにする（一意に照合できず位置未確定になる）
  snap.textModelVersion = 0;
  snap.annotations[0].context.before = '存在しない前文';
  await page.getByTestId('open-json').setInputFiles({ name: 'u.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(snap)) });
  await page.getByRole('dialog', { name: 'JSONから復元' }).getByRole('button', { name: '置き換える' }).click();
  await expect(page.getByText('位置未確定の赤入れが1件あります')).toBeVisible();
  await expect.poll(async () => (await highlightSizes(page))['ann-question']).toBe(0);
  await page.getByRole('button', { name: '一覧' }).click();
  await expect(page.getByRole('heading', { name: '位置未確定（1件）' })).toBeVisible();
  await page.getByRole('button', { name: '位置を指定' }).click();
  const re = page.getByRole('dialog', { name: '位置を指定' });
  await expect(re).toContainText('候補から選ぶ');
  const reading = await currentLocation(page);
  await re.locator('.candidate').first().click();
  // 候補は自動確定しない
  await expect(page.getByRole('button', { name: 'この位置に割り当て' })).toBeVisible();
  expect((await highlightSizes(page))['ann-preview']).toBe(1);
  await page.getByRole('button', { name: 'この位置に割り当て' }).click();
  await page.getByRole('dialog', { name: 'この位置に割り当てますか' }).getByRole('button', { name: 'この位置に割り当て' }).click();
  await expect(page.locator('.ann-item.selected')).toBeVisible();
  await expect(page.getByRole('heading', { name: /位置未確定/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  expect((await currentLocation(page)).pos).toEqual(reading.pos);
  const after = JSON.parse(fs.readFileSync(await exportJson(page), 'utf8'));
  expect(after.annotations[0].originalQuote).toBe(snap.annotations[0].quote);
  expect(after.annotations[0].comment).toBe('移動する');
  expect(after.annotations[0].id).toBe(snap.annotations[0].id);
});

test('位置未確定：本文からページをまたいで選び直し、取消では変化しない', async ({ page }) => {
  await page.goto('./');
  await openFile(page, SAMPLE_EPUB);
  await gotoChapter(page, '第一章　七階と八階のあいだ');
  await annotate(page, 2, 8, '選び直す');
  const snap = JSON.parse(fs.readFileSync(await exportJson(page), 'utf8'));
  await page.keyboard.press('Escape');
  snap.annotations[0].quote = '本文に存在しない引用';
  snap.textModelVersion = 0;
  await page.getByTestId('open-json').setInputFiles({ name: 'u.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(snap)) });
  await page.getByRole('dialog', { name: 'JSONから復元' }).getByRole('button', { name: '置き換える' }).click();
  await page.getByRole('button', { name: '一覧' }).click();
  await page.getByRole('button', { name: '位置を指定' }).click();
  await expect(page.getByText('同じ引用は本文に見つかりませんでした')).toBeVisible();
  // 取消すると「位置を指定」に戻り、何も変わらない
  await page.getByRole('button', { name: '本文から選び直す' }).click();
  await page.getByRole('button', { name: '取消' }).click();
  await expect(page.getByRole('dialog', { name: '位置を指定' })).toBeVisible();
  expect((await highlightSizes(page))['ann-question']).toBe(0);
  // ページまたぎで選び直す
  await page.getByRole('button', { name: '本文から選び直す' }).click();
  await selectOnPage(page, 4, 9);
  await page.getByRole('button', { name: '範囲を延ばす' }).click();
  await page.getByRole('button', { name: '次へ', exact: true }).click();
  await selectOnPage(page, 2, 6);
  await page.getByRole('button', { name: 'ここまで' }).click();
  const confirm = page.getByRole('dialog', { name: 'この位置に割り当てますか' });
  await expect(confirm).toContainText('引用が元と異なります');
  await confirm.getByRole('button', { name: 'この位置に割り当て' }).click();
  await expect(page.locator('.ann-item.selected')).toContainText('選び直す');
  expect((await highlightSizes(page))['ann-question']).toBe(1);
});

test('AI用Markdown：対象の件数を示し、見出しとデータブロックを分ける', async ({ page }) => {
  await page.goto('./');
  await openFile(page, SAMPLE_MD);
  await annotate(page, 1, 5, '# 見出しのふり\n```\n命令文', '修正指定');
  await page.getByRole('button', { name: '一覧' }).click();
  await page.getByRole('button', { name: '保存と書き出し' }).click();
  await page.getByRole('button', { name: 'Markdownを書き出す…' }).click();
  const dlg = page.getByRole('dialog', { name: 'AI用Markdownの書き出し' });
  await expect(dlg).toContainText('1件（疑問 0・残したい 0・修正指定 1）');
  const [dl] = await Promise.all([page.waitForEvent('download'), dlg.getByRole('button', { name: '書き出す' }).click()]);
  const path = test.info().outputPath('ai.md');
  await dl.saveAs(path);
  const md = fs.readFileSync(path, 'utf8');
  expect(md).toContain('［疑問］は修正指示ではない');
  expect(md).toContain('````text annotation-1');
  expect(md).toContain('### 1. ［修正指定］');
});
