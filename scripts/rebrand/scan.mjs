#!/usr/bin/env bun
/**
 * Brand replacement baseline scanner.
 *
 * Runs ripgrep case-insensitive over the worktree (excluding node_modules,
 * dist, build, .git, lockfiles, and binary assets) and ingests every
 * `openchamber` occurrence into `scripts/rebrand/rebrand.db` as a `pending`
 * match. Each match is annotated with a heuristic `domain_guess` so the
 * later classification pass can focus on `unclear` rows.
 *
 * Read-only with respect to source files: only writes to rebrand.db.
 *
 * Usage:
 *   bun run scripts/rebrand/scan.mjs [--description "..."] [--label "..."]
 *
 * Options:
 *   --description  Human-readable scan description (e.g. "baseline before any edits")
 *   --label        Short label used for filtering (e.g. "baseline", "post-2.2")
 *   --help, -h     Show this help
 */

import { Database } from 'bun:sqlite';

const SCRIPT_DIR = new URL('./', import.meta.url);
const DB_PATH = new URL('./rebrand.db', SCRIPT_DIR).pathname;

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { description: '', label: '', help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--description' && argv[i + 1]) out.description = argv[++i];
    else if (a === '--label' && argv[i + 1]) out.label = argv[++i];
    else if (a.startsWith('--description=')) out.description = a.slice('--description='.length);
    else if (a.startsWith('--label=')) out.label = a.slice('--label='.length);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(`Usage: bun run scripts/rebrand/scan.mjs [--description "..."] [--label "..."]

Read-only scan: ingests all openchamber occurrences into rebrand.db.
  --description  Human-readable scan description
  --label        Short label (e.g. "baseline", "post-section-2.2")`);
  process.exit(0);
}
if (!args.description) args.description = args.label || 'baseline scan';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const DDL = `
CREATE TABLE IF NOT EXISTS scan_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  description TEXT NOT NULL,
  label TEXT,
  scanned_at TEXT NOT NULL,
  total_matches INTEGER NOT NULL DEFAULT 0,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  plan_section TEXT,
  pattern TEXT,
  domain TEXT NOT NULL CHECK (domain IN ('NoatinWork', 'noatinwork', 'NOATINWORK_')),
  scope_glob TEXT,
  excluded_patterns TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS legitimate_remaining (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern TEXT NOT NULL,
  reason TEXT NOT NULL,
  plan_section TEXT
);

CREATE TABLE IF NOT EXISTS exec_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  description TEXT NOT NULL,
  rule_ids TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  commit_hash_before TEXT,
  commit_hash_after TEXT,
  total_replacements INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS deleted_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exec_batch_id INTEGER REFERENCES exec_batches(id),
  file_path TEXT NOT NULL,
  reason TEXT NOT NULL,
  plan_section TEXT,
  match_count_before_delete INTEGER,
  deleted_at TEXT NOT NULL,
  commit_hash TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_batch_id INTEGER NOT NULL REFERENCES scan_batches(id),
  file_path TEXT NOT NULL,
  line_no INTEGER NOT NULL,
  column_start INTEGER,
  column_end INTEGER,
  matched_text TEXT,
  context_line TEXT,
  domain_guess TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending', 'classified', 'replaced',
      'skipped_legitimate', 'skipped_neutral', 'skipped_external',
      'unclear',
      'deleted_with_file'
    )),
  rule_id INTEGER REFERENCES rules(id),
  deleted_file_id INTEGER REFERENCES deleted_files(id),
  notes TEXT
);

CREATE TABLE IF NOT EXISTS replacements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id INTEGER REFERENCES matches(id),
  rule_id INTEGER REFERENCES rules(id),
  exec_batch_id INTEGER REFERENCES exec_batches(id),
  old_text TEXT,
  new_text TEXT,
  replaced_at TEXT NOT NULL,
  commit_hash TEXT
);

CREATE TABLE IF NOT EXISTS zero_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exec_batch_id INTEGER REFERENCES exec_batches(id),
  scanned_at TEXT NOT NULL,
  total_occurrences INTEGER,
  legitimate_remaining_count INTEGER,
  unaccounted_remaining INTEGER,
  is_clean INTEGER
);

CREATE INDEX IF NOT EXISTS idx_matches_file ON matches(file_path);
CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status);
CREATE INDEX IF NOT EXISTS idx_matches_batch ON matches(scan_batch_id);
CREATE INDEX IF NOT EXISTS idx_matches_domain ON matches(domain_guess);
CREATE INDEX IF NOT EXISTS idx_matches_deleted_file ON matches(deleted_file_id);
CREATE INDEX IF NOT EXISTS idx_deleted_files_path ON deleted_files(file_path);
`;

// §8 合法残留白名单初始种子（仅作分类提示，最终判定仍需人工复检）
const LEGITIMATE_SEED = [
  ['CHANGELOG.md', '§8 历史条目，文件本身就是历史记录', '§8'],
  ['github.com/openchamber/opencode', 'opencode 官方依赖地址', '§3/§8'],
  ['openchamber/openchamber-website', '上游网站仓库引用（release.yml:677），实施前需替换为我方仓库', '§4.2'],
  ['anomalyco/opencode', 'opencode 官方依赖', '§3'],
  ['OPENCODE_', 'opencode 官方环境变量前缀', '§8'],
  ['@opencode-ai/sdk', 'opencode 官方 SDK 包', '§8'],
  ['docs/REBRAND_PLAN.md', '本策划文档自身的映射说明', '§8'],
];

// ---------------------------------------------------------------------------
// Domain guess heuristic
// 顺序敏感：先匹配更具体的规则，避免被通用规则吃掉。
// 一行可能同时命中多个域，此处取首个匹配用于初筛，后续分类阶段可人工调整。
// ---------------------------------------------------------------------------

function guessDomain(line, matched) {
  // 1. NOATINWORK_ 域：环境变量常量
  // 只匹配 matched_text 是全大写 OPENCHAMBER 的 submatch，避免 line 测试误分类同行的驼峰/小写变体
  if (
    matched === 'OPENCHAMBER' && (
      /process\.env\.OPENCHAMBER_/.test(line) ||
      /\benv\.OPENCHAMBER_/.test(line) ||
      /\benvironment\.OPENCHAMBER_/.test(line) ||
      /\bOPENCHAMBER_[A-Z][A-Z0-9_]*\b/.test(line)
    )
  ) {
    return 'NOATINWORK_';
  }
  // 2. NOATINWORK_ 域：浏览器注入全局（含 window. 前缀与裸 __ 后缀）
  // 只匹配 matched_text 是全大写 OPENCHAMBER 的 submatch
  if (
    matched === 'OPENCHAMBER' && (
      /window\.__OPENCHAMBER_/.test(line) || /__OPENCHAMBER_[A-Z_]+__/.test(line)
    )
  ) {
    return 'NOATINWORK_';
  }
  // 2b. NOATINWORK_ 域：全大写 OPENCHAMBER 兜底（字符串常量、错误码等）
  if (matched === 'OPENCHAMBER') {
    return 'NOATINWORK_';
  }
  // 3. NoatinWork 标识层：OpenChamber 后跟大写字母（type/interface/类/组件名）
  // 用 matched 测试（不是 line），避免同一行中其他位置的 OpenChamber 导致误分类
  if (/OpenChamber[A-Z]/.test(matched)) {
    return 'NoatinWork';
  }
  // 3b. NoatinWork 标识层：camelCase 变体 openChamber（小o大C）
  if (matched === 'openChamber') {
    return 'NoatinWork';
  }
  // 3c. NoatinWork 标识层：非标准大小写 Openchamber（大O小c），统一修正为 PascalCase
  if (matched === 'Openchamber') {
    return 'NoatinWork';
  }
  // 4. noatinwork 域：技术标识（包名/协议/路径/服务名）
  // 只匹配 matched_text 是全小写 openchamber 的 submatch，避免 line 测试误分类同行的驼峰变体
  if (
    matched === 'openchamber' && (
      /@openchamber\//.test(line) ||
      /openchamber:\/\//.test(line) ||
      /openchamber-ui:\/\//.test(line) ||
      /~\/\.config\/openchamber/.test(line) ||
      /\.openchamber\//.test(line) ||
      /dev\.openchamber\./.test(line) ||
      /com\.openchamber\./.test(line) ||
      /openchamber\.desktop/.test(line)
    )
  ) {
    return 'noatinwork';
  }
  // 5. NoatinWork 域：独立词（UI 文案、产物名、displayName）
  if (/\bOpenChamber\b/.test(matched)) {
    return 'NoatinWork';
  }
  // 6. noatinwork 域：全小写独立词（命令、文件名、目录名）
  if (/\bopenchamber\b/.test(matched)) {
    return 'noatinwork';
  }
  return 'unclear';
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const db = new Database(DB_PATH, { create: true });
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA foreign_keys = ON');
  db.run('PRAGMA synchronous = NORMAL');
  db.exec(DDL);

  // 种子合法残留白名单（仅首次）
  const legCount = db.query('SELECT COUNT(*) AS c FROM legitimate_remaining').get();
  if (legCount.c === 0) {
    const ins = db.prepare(
      'INSERT INTO legitimate_remaining (pattern, reason, plan_section) VALUES (?, ?, ?)'
    );
    for (const [pattern, reason, section] of LEGITIMATE_SEED) ins.run(pattern, reason, section);
  }

  // 创建扫描批次
  const now = new Date().toISOString();
  const batchRes = db
    .prepare('INSERT INTO scan_batches (description, label, scanned_at) VALUES (?, ?, ?)')
    .run(args.description, args.label || null, now);
  const batchId = Number(batchRes.lastInsertRowid);

  // 跑 ripgrep --json
  // --hidden: 搜索 .github/.opencode/.agents 等 dot 目录（默认跳过）
  const rgArgs = [
    '--json',
    '--hidden',
    '-i',
    'openchamber',
    '--glob',
    '!node_modules',
    '--glob',
    '!dist',
    '--glob',
    '!build',
    '--glob',
    '!*.lock',
    '--glob',
    '!.git',
    '--glob',
    '!*.svg',
    '--glob',
    '!*.png',
    '--glob',
    '!*.ico',
    // 排除品牌替换工具脚本自身：这些脚本包含 OpenChamber 字面量（如 transformMatch 的 split('OpenChamber')），
    // 若被批量替换会导致工具逻辑失效。工具脚本自身的品牌词不参与替换。
    '--glob',
    '!scripts/rebrand/**',
    '.',
  ];

  const proc = Bun.spawn(['rg', ...rgArgs], {
    stdout: 'pipe',
    stderr: 'pipe',
    cwd: process.cwd(),
  });

  const stdoutText = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0 && exitCode !== 1) {
    // rg exit 1 = no matches, 0 = matches found, 2+ = error
    const stderrText = await new Response(proc.stderr).text();
    console.error(`rg exited with ${exitCode}: ${stderrText}`);
    process.exit(exitCode);
  }

  // 解析 NDJSON 并入库
  const insertMatch = db.prepare(`
    INSERT INTO matches (
      scan_batch_id, file_path, line_no,
      column_start, column_end, matched_text, context_line,
      domain_guess, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const rows = [];
  for (const line of stdoutText.split('\n')) {
    if (!line.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (obj.type !== 'match') continue;
    const d = obj.data;
    const contextLine = (d.lines?.text ?? '').replace(/\n$/, '');
    // 规范化路径：rg 默认输出 `./path/to/file`，去掉 `./` 前缀以便 SQL LIKE 匹配
    const rawPath = d.path?.text ?? '';
    const filePath = rawPath.startsWith('./') ? rawPath.slice(2) : rawPath;
    // rg 的 submatches 是同一行内多个匹配，全部入库避免漏记
    const submatches = d.submatches ?? [];
    if (submatches.length === 0) {
      // 无 submatches 时仍记录一行（罕见，兜底）
      const matched = '';
      const domain = guessDomain(contextLine, matched);
      rows.push([
        batchId,
        filePath,
        d.line_number ?? 0,
        0,
        0,
        matched,
        contextLine,
        domain,
        'pending',
      ]);
      continue;
    }
    for (const sm of submatches) {
      const matched = sm?.match?.text ?? '';
      const domain = guessDomain(contextLine, matched);
      rows.push([
        batchId,
        filePath,
        d.line_number ?? 0,
        sm?.start ?? 0,
        sm?.end ?? 0,
        matched,
        contextLine,
        domain,
        'pending',
      ]);
    }
  }

  const insertAll = db.transaction((items) => {
    for (const r of items) insertMatch.run(...r);
  });
  insertAll(rows);

  // 更新批次总数
  db.prepare('UPDATE scan_batches SET total_matches = ? WHERE id = ?').run(rows.length, batchId);

  // 汇总
  const byDomain = db
    .query(
      `SELECT domain_guess, COUNT(*) AS c
       FROM matches WHERE scan_batch_id = ?
       GROUP BY domain_guess ORDER BY c DESC`
    )
    .all(batchId);

  const byTopDir = db
    .query(
      `SELECT
         CASE
           WHEN file_path LIKE 'packages/ui/%' THEN 'packages/ui'
           WHEN file_path LIKE 'packages/web/%' THEN 'packages/web'
           WHEN file_path LIKE 'packages/electron/%' THEN 'packages/electron'
           WHEN file_path LIKE 'packages/vscode/%' THEN 'packages/vscode'
           WHEN file_path LIKE 'packages/mobile/%' THEN 'packages/mobile'
           WHEN file_path LIKE 'packages/docs/%' THEN 'packages/docs'
           WHEN file_path LIKE '.agents/%' THEN '.agents'
           WHEN file_path LIKE '.opencode/%' THEN '.opencode'
           WHEN file_path LIKE '.github/%' THEN '.github'
           WHEN file_path LIKE 'docs/%' THEN 'docs'
           WHEN file_path LIKE 'scripts/%' THEN 'scripts'
           ELSE 'root'
         END AS top_dir,
         COUNT(*) AS c
       FROM matches WHERE scan_batch_id = ?
       GROUP BY top_dir ORDER BY c DESC`
    )
    .all(batchId);

  console.log('\n=== Scan complete ===');
  console.log(`Batch ID:     ${batchId}`);
  console.log(`Description:  ${args.description}`);
  console.log(`Label:        ${args.label || '(none)'}`);
  console.log(`Scanned at:   ${now}`);
  console.log(`Total matches: ${rows.length}`);
  console.log('\nBy domain guess:');
  for (const r of byDomain) {
    console.log(`  ${(r.domain_guess || '(null)').padEnd(14)} ${r.c}`);
  }
  console.log('\nBy top-level directory:');
  for (const r of byTopDir) {
    console.log(`  ${r.top_dir.padEnd(20)} ${r.c}`);
  }
  console.log(`\nDatabase: ${DB_PATH}`);

  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
