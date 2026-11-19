// CI 用：次の版名を標準出力に出す。引数は上げ幅（major / minor / patch）。
// 規則は build/version.ts にまとめてある（Node 22 は型注釈を取り除いて .ts を読み込める）。
import { execFileSync } from 'node:child_process';
const { next } = await import('../build/version.ts');
const bump = process.argv[2] ?? 'patch';
const tags = execFileSync('git', ['tag', '--list', 'v*'], { encoding: 'utf8' }).split('\n');
process.stdout.write(next(tags, bump));
