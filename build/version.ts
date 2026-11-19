// 版名（semver）。正は git のタグ v<major>.<minor>.<patch>。
// 公開（main への反映）ごとに CI がタグを一つ進め、それ以外のビルドは「次の版-dev」と表示する。
import { execFileSync } from 'node:child_process';

export type Bump = 'major' | 'minor' | 'patch';
const TAG = /^v(\d+)\.(\d+)\.(\d+)$/;

/** タグ一覧から最大の版を返す（なければ null） */
export function latest(tags: string[]): [number, number, number] | null {
  let best: [number, number, number] | null = null;
  for (const t of tags) {
    const m = TAG.exec(t.trim());
    if (!m) continue;
    const v: [number, number, number] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (!best || v[0] > best[0] || (v[0] === best[0] && (v[1] > best[1] || (v[1] === best[1] && v[2] > best[2])))) best = v;
  }
  return best;
}

/** 次の版。タグがなければ v0.0.1 から始める */
export function next(tags: string[], bump: Bump): string {
  const v = latest(tags);
  if (!v) return 'v0.0.1';
  const [a, b, c] = v;
  if (bump === 'major') return `v${a + 1}.0.0`;
  if (bump === 'minor') return `v${a}.${b + 1}.0`;
  return `v${a}.${b}.${c + 1}`;
}

/** PR のラベルから上げ幅を決める（semver:major / semver:minor、なければ patch） */
export function bumpFromLabels(labels: string[]): Bump {
  if (labels.includes('semver:major')) return 'major';
  if (labels.includes('semver:minor')) return 'minor';
  return 'patch';
}

/** ビルドに埋め込む版名。APP_VERSION（公開時に CI が渡す）がなければ「次の版-dev」 */
export function appVersion(env: NodeJS.ProcessEnv = process.env): string {
  if (env.APP_VERSION && TAG.test(env.APP_VERSION)) return env.APP_VERSION;
  let tags: string[] = [];
  try {
    tags = execFileSync('git', ['tag', '--list', 'v*'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n');
  } catch {
    // git がない環境では v0.0.1-dev
  }
  return `${next(tags, 'patch')}-dev`;
}
