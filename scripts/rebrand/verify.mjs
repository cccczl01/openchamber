#!/usr/bin/env bun
/**
 * Zero-verification: re-scans the worktree for `openchamber` and compares
 * against the baseline + classification state in rebrand.db.
 *
 * - Occurrences whose baseline match is `replaced` are anomalies (should be gone).
 * - Occurrences whose baseline match is `skipped_*` are legitimate remaining.
 * - Occurrences whose baseline match is `pending`/`classified` are unprocessed.
 * - Occurrences whose baseline match is `deleted_with_file` are skipped (file deleted).
 * - Occurrences matching `legitimate_remaining` whitelist are legitimate.
 * - Occurrences not in baseline are new (introduced post-baseline).
 *
 * Records a `zero_checks` row and prints a report.
 *
 * Usage:
 *   bun run scripts/rebrand/verify.mjs [--exec-batch-id <id>] [--limit <n>]
 *
 * Options:
 *   --exec-batch-id <id>  Associate the check with an exec batch (optional)
 *   --limit <n>           Limit unaccounted list output (default 50)
 *   --help, -h            Show this help
 *
 * Read-only: does not modify any source file or the database beyond inserting
 * a `zero_checks` row.
 */

import { Database } from 'bun:sqlite';

const SCRIPT_DIR = new URL('./', import.meta.url);
const DB_PATH = new URL('./rebrand.db', SCRIPT_DIR).pathname;

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { execBatchId: null, limit: 50, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--exec-batch-id' && argv[i + 1]) out.execBatchId = parseInt(argv[++i], 10);
    else if (a === '--limit' && argv[i + 1]) out.limit = parseInt(argv[++i], 10);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(`Usage: bun run scripts/rebrand/verify.mjs [--exec-batch-id <id>] [--limit <n>]

Zero-verification: re-scans for openchamber and compares against baseline.

  --exec-batch-id <id>  Associate the check with an exec batch (optional)
  --limit <n>           Limit unaccounted list output (default 50)`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** 同 scan.mjs 的 glob 排除规则，保证口径一致。 */
const RG_ARGS = [
  '--json',
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
  // 排除品牌替换工具脚本自身：与 scan.mjs 保持一致
  '--glob',
  '!scripts/rebrand/**',
  '.',
];

async function runRg() {
  const proc = Bun.spawn(['rg', ...RG_ARGS], {
    stdout: 'pipe',
    stderr: 'pipe',
    cwd: process.cwd(),
  });
  const text = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0 && exitCode !== 1) {
    const errText = await new Response(proc.stderr).text();
    throw new Error(`rg exited with ${exitCode}: ${errText}`);
  }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (obj.type !== 'match') continue;
    const d = obj.data;
    const rawPath = d.path?.text ?? '';
    const filePath = rawPath.startsWith('./') ? rawPath.slice(2) : rawPath;
    const contextLine = (d.lines?.text ?? '').replace(/\n$/, '');
    // 遍历所有 submatches，与 baseline 的 matches 行对齐
    const submatches = d.submatches ?? [];
    if (submatches.length === 0) {
      out.push({
        file_path: filePath,
        line_no: d.line_number ?? 0,
        column_start: 0,
        column_end: 0,
        matched_text: '',
        context_line: contextLine,
      });
      continue;
    }
    for (const sm of submatches) {
      out.push({
        file_path: filePath,
        line_no: d.line_number ?? 0,
        column_start: sm?.start ?? 0,
        column_end: sm?.end ?? 0,
        matched_text: sm?.match?.text ?? '',
        context_line: contextLine,
      });
    }
  }
  return out;
}

/** 字面子串匹配（避免 SQL LIKE 的 _ 通配符陷阱） */
function containsLiteral(haystack, needle) {
  return needle.length > 0 && haystack.includes(needle);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const db = new Database(DB_PATH, { readonly: false, create: true });
  db.run('PRAGMA foreign_keys = ON');

  console.log('Scanning worktree for openchamber...');
  const currentMatches = await runRg();
  console.log(`Found ${currentMatches.length} occurrences.\n`);

  // 加载白名单
  const whitelist = db.query('SELECT pattern, reason, plan_section FROM legitimate_remaining').all();

  // 加载已删除文件集合
  const deletedFiles = new Set(
    db.query('SELECT DISTINCT file_path FROM deleted_files').all().map((r) => r.file_path)
  );

  // 加载 baseline matches 索引（file_path:line_no:column_start -> match 记录）
  // 只取最新 scan_batch 的记录
  const latestBatch = db
    .query('SELECT id FROM scan_batches ORDER BY id DESC LIMIT 1')
    .get();
  const baselineRows = latestBatch
    ? db.query('SELECT id, file_path, line_no, column_start, status, domain_guess FROM matches WHERE scan_batch_id = ?').all(latestBatch.id)
    : [];
  const baselineMap = new Map();
  for (const m of baselineRows) {
    // 用 file_path:line_no:column_start 作为 key，精确对齐
    const key = `${m.file_path}:${m.line_no}:${m.column_start}`;
    baselineMap.set(key, m);
  }
  // 同时建立行级索引：file_path:line_no -> 该行所有 matches 的状态数组
  const baselineByLine = new Map();
  for (const m of baselineRows) {
    const lineKey = `${m.file_path}:${m.line_no}`;
    if (!baselineByLine.has(lineKey)) baselineByLine.set(lineKey, []);
    baselineByLine.get(lineKey).push(m);
  }

  // 分类当前剩余
  let legitimate = 0;
  let unaccounted = 0;
  let newOccurrences = 0;
  const unaccountedList = [];

  for (const m of currentMatches) {
    // 1. 文件已被删除 → 不应再出现，但若出现说明删除不彻底或 git stash 残留
    if (deletedFiles.has(m.file_path)) {
      unaccounted++;
      unaccountedList.push({ ...m, reason: 'file_should_be_deleted' });
      continue;
    }

    // 2. 命中 §8 白名单（pattern 同时匹配 file_path 和 context_line）
    const hitWhitelist = whitelist.find(
      (w) => containsLiteral(m.file_path, w.pattern) || containsLiteral(m.context_line, w.pattern)
    );
    if (hitWhitelist) {
      legitimate++;
      continue;
    }

    // 3. 关联 baseline：优先按 column 精确对齐，找不到则按行级 fallback
    const colKey = `${m.file_path}:${m.line_no}:${m.column_start}`;
    const baseline = baselineMap.get(colKey);
    if (baseline) {
      // 精确对齐成功
      switch (baseline.status) {
        case 'replaced':
          unaccounted++;
          unaccountedList.push({ ...m, reason: 'expected_replaced_but_present' });
          break;
        case 'skipped_legitimate':
        case 'skipped_neutral':
        case 'skipped_external':
          legitimate++;
          break;
        case 'pending':
        case 'classified':
        case 'unclear':
          unaccounted++;
          unaccountedList.push({ ...m, reason: `baseline_${baseline.status}` });
          break;
        case 'deleted_with_file':
          unaccounted++;
          unaccountedList.push({ ...m, reason: 'baseline_deleted_but_file_present' });
          break;
        default:
          unaccounted++;
          unaccountedList.push({ ...m, reason: `unknown_status_${baseline.status}` });
      }
      continue;
    }

    // 4. column 对齐失败，看行级是否有 baseline 记录
    const lineKey = `${m.file_path}:${m.line_no}`;
    const lineMatches = baselineByLine.get(lineKey);
    if (lineMatches) {
      // 该行有 baseline 记录但 column 不对齐——可能 baseline 漏了某个 submatch
      // 检查该行是否所有 baseline matches 都是 replaced/skipped_*
      const allHandled = lineMatches.every(
        (mm) =>
          mm.status === 'replaced' ||
          mm.status.startsWith('skipped_') ||
          mm.status === 'deleted_with_file'
      );
      if (allHandled) {
        // 该行所有已知 matches 都已处理，但还有额外的 openchamber——新增或漏记
        unaccounted++;
        unaccountedList.push({ ...m, reason: 'baseline_line_all_handled_but_extra' });
      } else {
        // 该行有未处理的 matches
        const firstUnhandled = lineMatches.find(
          (mm) => !['replaced', 'skipped_legitimate', 'skipped_neutral', 'skipped_external', 'deleted_with_file'].includes(mm.status)
        );
        unaccounted++;
        unaccountedList.push({ ...m, reason: `baseline_line_${firstUnhandled?.status || 'mixed'}` });
      }
      continue;
    }

    // 5. 既无 column 对齐也无行级记录 → 新增
    newOccurrences++;
    unaccounted++;
    unaccountedList.push({ ...m, reason: 'not_in_baseline' });
  }

  const isClean = unaccounted === 0 ? 1 : 0;
  const scannedAt = new Date().toISOString();

  // 插入 zero_checks
  db.prepare(
    `INSERT INTO zero_checks
       (exec_batch_id, scanned_at, total_occurrences, legitimate_remaining_count, unaccounted_remaining, is_clean)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    args.execBatchId,
    scannedAt,
    currentMatches.length,
    legitimate,
    unaccounted,
    isClean
  );

  // 报告
  console.log('=== Zero verification ===');
  console.log(`Scanned at:              ${scannedAt}`);
  if (args.execBatchId) console.log(`Exec batch:             ${args.execBatchId}`);
  console.log(`Total occurrences:       ${currentMatches.length}`);
  console.log(`Legitimate remaining:   ${legitimate} (whitelist + skipped_*)`);
  console.log(`Unaccounted:             ${unaccounted}`);
  console.log(`  - new (not baseline): ${newOccurrences}`);
  console.log(`  - baseline pending:   ${unaccountedList.filter((m) => m.reason === 'baseline_pending').length}`);
  console.log(`  - baseline classified:${unaccountedList.filter((m) => m.reason === 'baseline_classified').length}`);
  console.log(`  - should be replaced: ${unaccountedList.filter((m) => m.reason === 'expected_replaced_but_present').length}`);
  console.log(`  - file should delete: ${unaccountedList.filter((m) => m.reason === 'file_should_be_deleted').length}`);
  console.log(`Is clean:                ${isClean ? 'YES ✓' : 'NO ✗'}`);

  if (unaccountedList.length > 0) {
    console.log(`\nUnaccounted (first ${Math.min(args.limit, unaccountedList.length)} of ${unaccountedList.length}):`);
    for (const m of unaccountedList.slice(0, args.limit)) {
      console.log(`  ${m.file_path}:${m.line_no} [${m.reason}]`);
      console.log(`    ${m.context_line.slice(0, 120)}`);
    }
    if (unaccountedList.length > args.limit) {
      console.log(`... and ${unaccountedList.length - args.limit} more`);
    }
  }

  db.close();
  process.exit(isClean ? 0 : 2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
