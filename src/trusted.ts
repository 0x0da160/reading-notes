// Trusted Types（§8 の CSP: require-trusted-types-for 'script'）。
// 許可するのは次の2つだけ：原稿の解析用 DOMParser 入力と、自アプリの Service Worker の URL。
interface TTPolicy {
  createHTML?(s: string): unknown;
  createScriptURL?(s: string): unknown;
}
interface TTFactory {
  createPolicy(name: string, rules: { createHTML?(s: string): string; createScriptURL?(s: string): string }): TTPolicy;
}
const tt = (globalThis as { trustedTypes?: TTFactory }).trustedTypes;

let parsePolicy: TTPolicy | null = null;
let swPolicy: TTPolicy | null = null;

/** DOMParser に渡す原稿文字列。解析結果は表示に使わず、許可要素だけを DOM API で組み立て直す。 */
export function parserInput(text: string): string {
  if (!tt) return text;
  parsePolicy ??= tt.createPolicy('manuscript-parse', { createHTML: (s) => s });
  return parsePolicy.createHTML!(text) as string;
}

export function serviceWorkerUrl(url: string): string {
  if (!tt) return url;
  swPolicy ??= tt.createPolicy('service-worker', {
    createScriptURL: (s) => {
      if (s !== url) throw new TypeError('unexpected script URL');
      return s;
    },
  });
  return swPolicy.createScriptURL!(url) as string;
}
