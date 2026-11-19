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
  await page.locator('input[type=file]').setInputFiles(file);
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
