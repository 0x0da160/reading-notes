// docs/knowledge/ のOKF v0.2規約を検証する（§11）。依存なしで `node scripts/check-knowledge.mjs` で実行。
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve, relative } from "node:path";

const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
const kdir = join(root, "docs/knowledge");
const errors = [];
const err = (file, msg) => errors.push(`${relative(root, file)}: ${msg}`);
const read = (f) => readFileSync(f, "utf8");

function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return null;
  const fm = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([A-Za-z_]+):\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2].replace(/^"(.*)"$/, "$1").trim();
  }
  return fm;
}

// 見出しのGitHub風スラッグと、明示アンカー（<a name> / id）
function anchors(text) {
  const set = new Set();
  for (const m of text.matchAll(/<a\s+(?:name|id)="([^"]+)"/g)) set.add(m[1]);
  for (const m of text.matchAll(/^#{1,6}\s+(.+)$/gm)) {
    set.add(m[1].trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s/g, "-"));
  }
  return set;
}

function links(text) {
  const body = text.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
  return [...body.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]);
}

const concepts = readdirSync(kdir).filter((f) => f.endsWith(".md") && f !== "index.md" && f !== "log.md");

// index.md
const indexPath = join(kdir, "index.md");
const indexFm = frontmatter(read(indexPath));
if (indexFm?.okf_version !== "0.2") err(indexPath, 'okf_version: "0.2" がない');

// コンセプトのメタデータ
for (const f of concepts) {
  const p = join(kdir, f);
  const fm = frontmatter(read(p));
  if (!fm) { err(p, "YAML frontmatterがない"); continue; }
  for (const key of ["type", "title", "description", "status"]) if (!fm[key]) err(p, `${key} が空`);
}

// リンク（バンドル全体とREADME）
const targets = [...readdirSync(kdir).map((f) => join(kdir, f)), join(root, "README.md")];
const reached = new Set();
for (const p of targets) {
  for (const href of links(read(p))) {
    if (/^[a-z]+:/i.test(href)) {
      if (/github\.com/.test(href)) err(p, `GitHubの絶対URLは使わない: ${href}`);
      continue;
    }
    if (href.startsWith("/")) { err(p, `先頭 / のリンクは使わない: ${href}`); continue; }
    const [file, anchor] = href.split("#");
    const dest = file ? resolve(dirname(p), file) : p;
    if (file && !file.endsWith(".md")) err(p, `ファイルへのリンクは .md まで書く: ${href}`);
    if (!existsSync(dest)) { err(p, `リンク先がない: ${href}`); continue; }
    if (anchor && !anchors(read(dest)).has(anchor)) err(p, `アンカーがない: ${href}`);
    if (p === indexPath) reached.add(dest);
  }
}
for (const f of concepts) if (!reached.has(join(kdir, f))) err(join(kdir, f), "index.md から到達できない");

// log.md の日付見出しは新しい順
const logPath = join(kdir, "log.md");
const dates = [...read(logPath).matchAll(/^## (.+)$/gm)].map((m) => m[1].trim());
dates.forEach((d, i) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) err(logPath, `見出しが YYYY-MM-DD でない: ${d}`);
  if (i > 0 && d >= dates[i - 1]) err(logPath, `日付が新しい順でない: ${d}`);
});

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`OK: ${concepts.length} concepts`);
