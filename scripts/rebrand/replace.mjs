#!/usr/bin/env bun
/**
 * Execute brand replacement for a given REBRAND_PLAN section.
 *
 * Loads `classified` matches whose `domain_guess` matches the section's
 * domain, then performs byte-precise replacement at each recorded
 * (file_path, line_no, column_start, column_end) location. Each replacement
 * is recorded in the `replacements` table and the corresponding `matches`
 * row is marked `replaced`.
 *
 * The script does NOT auto-commit. Review the diff and commit manually.
 *
 * Usage:
 *   bun run scripts/rebrand/replace.mjs --section <id> [--dry-run] [--limit <n>]
 *
 * Sections (REBRAND_PLAN §2 mapping):
 *   2.1  NoatinWork (display name)        OpenChamber → NoatinWork
 *   2.2  noatinwork (technical identifier) openchamber → noatinwork
 *   2.3  NOATINWORK_ (constants)          OPENCHAMBER → NOATINWORK
 *   2.4  NoatinWork (code identifiers)    OpenChamber* type names → NoatinWork*
 *
 * Options:
 *   --section <id>   Plan section id (required, e.g. "2.1")
 *   --dry-run        Show diff without writing
 *   --limit <n>      Max files to process (default unlimited)
 *   --help, -h       Show this help
 *
 * Modifies source files (unless --dry-run). Always updates rebrand.db.
 */

import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const SCRIPT_DIR = new URL('./', import.meta.url);
const DB_PATH = new URL('./rebrand.db', SCRIPT_DIR).pathname;
const REPO_ROOT = resolve(new URL('../../', import.meta.url).pathname);

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { section: '', dryRun: false, limit: 0, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--section' && argv[i + 1]) out.section = argv[++i];
    else if (a.startsWith('--section=')) out.section = a.slice('--section='.length);
    else if (a === '--limit' && argv[i + 1]) out.limit = parseInt(argv[++i], 10);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(`Usage: bun run scripts/rebrand/replace.mjs --section <id> [--dry-run] [--limit <n>]

Execute brand replacement for a REBRAND_PLAN section.

  --section <id>   Plan section id (required, e.g. "2.1", "2.2", "2.3", "2.4")
  --dry-run        Show diff without writing
  --limit <n>      Max files to process (default unlimited)`);
  process.exit(0);
}
if (!args.section) {
  console.error('Error: --section <id> is required (e.g. "2.1")');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Section definitions (REBRAND_PLAN §2 mapping)
// ---------------------------------------------------------------------------

const SECTIONS = {
  '2.1': {
    name: 'Display name layer (NoatinWork)',
    domain: 'NoatinWork',
    from: 'OpenChamber',
    to: 'NoatinWork',
    planSection: '§2.1',
    // iOS .pbxproj 推迟到 §2.4 统一处理（文件改名 + 引用同步），避免工程引用断裂
    excludeGlobs: ['packages/mobile/ios/**'],
  },
  '2.2': {
    name: 'Technical identifier layer (noatinwork)',
    domain: 'noatinwork',
    from: 'openchamber',
    to: 'noatinwork',
    planSection: '§2.2',
    excludeGlobs: [],
  },
  '2.3': {
    name: 'Constants layer (NOATINWORK_)',
    domain: 'NOATINWORK_',
    from: 'OPENCHAMBER',
    to: 'NOATINWORK',
    planSection: '§2.3',
    excludeGlobs: [],
  },
  '2.4': {
    name: 'Code identifier layer (NoatinWork)',
    domain: 'NoatinWork',
    from: 'OpenChamber',
    to: 'NoatinWork',
    planSection: '§2.4',
    excludeGlobs: [],
  },
};

const section = SECTIONS[args.section];
if (!section) {
  console.error(
    `Error: unknown section "${args.section}". Supported: ${Object.keys(SECTIONS).join(', ')}`
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Transform
// ---------------------------------------------------------------------------

/**
 * 按域替换 matchedText 中的对应变体。
 * 保留 matchedText 中除品牌词外的其他字符（如 OpenChamberConfig 中的 Config）。
 *
 * 大小写变体处理：
 *   OpenChamber  → NoatinWork   (PascalCase，§2.1/§2.4 标准)
 *   openChamber  → noatinWork   (camelCase，§2.4 变体如 openChamberVersionLabel)
 *   Openchamber  → NoatinWork   (非标准大小写，统一修正为 PascalCase)
 *   openchamber  → noatinwork   (全小写，§2.2)
 *   OPENCHAMBER  → NOATINWORK   (全大写，§2.3)
 */
function transformMatch(matchedText, domain) {
  switch (domain) {
    case 'NoatinWork':
      // camelCase 变体：openChamber → noatinWork
      if (matchedText === 'openChamber') return 'noatinWork';
      // 非标准大小写：Openchamber → NoatinWork（修正为标准 PascalCase）
      if (matchedText === 'Openchamber') return 'NoatinWork';
      // 标准 PascalCase：OpenChamber → NoatinWork（含 OpenChamberConfig 等复合标识符）
      return matchedText.split('OpenChamber').join('NoatinWork');
    case 'noatinwork':
      return matchedText.split('openchamber').join('noatinwork');
    case 'NOATINWORK_':
      return matchedText.split('OPENCHAMBER').join('NOATINWORK');
    default:
      throw new Error(`Unknown domain: ${domain}`);
  }
}

// ---------------------------------------------------------------------------
// UTF-8 safe line slicing
// rg --json submatches.start/end are byte offsets within the line.
// ---------------------------------------------------------------------------

function sliceLineByteSafe(line, byteStart, byteEnd) {
  // Fast path: pure ASCII line (common case)
  let isAscii = true;
  for (let i = 0; i < line.length; i++) {
    if (line.charCodeAt(i) > 127) {
      isAscii = false;
      break;
    }
  }
  if (isAscii) {
    return {
      before: line.slice(0, byteStart),
      matched: line.slice(byteStart, byteEnd),
      after: line.slice(byteEnd),
    };
  }
  // Slow path: convert to bytes, slice, convert back
  const buf = Buffer.from(line, 'utf8');
  return {
    before: buf.subarray(0, byteStart).toString('utf8'),
    matched: buf.subarray(byteStart, byteEnd).toString('utf8'),
    after: buf.subarray(byteEnd).toString('utf8'),
  };
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

function getGitHead() {
  try {
    const r = Bun.spawnSync(['git', 'rev-parse', 'HEAD'], {
      cwd: REPO_ROOT,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    if (r.exitCode === 0) return r.stdout.toString().trim();
  } catch {}
  return null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const db = new Database(DB_PATH, { create: true });
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA foreign_keys = ON');
  db.run('PRAGMA synchronous = NORMAL');

  console.log(`=== Replace section ${args.section}: ${section.name} ===`);
  console.log(`Domain: ${section.domain}  Replacement: ${section.from} → ${section.to}`);
  if (args.dryRun) console.log('Mode: DRY RUN (no files will be modified)');
  console.log();

  // 加载所有 classified 且 domain 匹配的 matches，排除已删除文件
  let matches = db
    .query(
      `SELECT id, file_path, line_no, column_start, column_end, matched_text, context_line, domain_guess
       FROM matches
       WHERE status = 'classified' AND domain_guess = ?
         AND file_path NOT IN (SELECT file_path FROM deleted_files)
       ORDER BY file_path, line_no, column_start`
    )
    .all(section.domain);

  // 应用章节级排除规则（如 iOS .pbxproj 推迟到 §2.4）
  if (section.excludeGlobs && section.excludeGlobs.length > 0) {
    const before = matches.length;
    const { Glob } = require('bun');
    const globs = section.excludeGlobs.map((p) => new Glob(p));
    matches = matches.filter((m) => !globs.some((g) => g.match(m.file_path)));
    const excluded = before - matches.length;
    if (excluded > 0) {
      console.log(`Excluded by section rules: ${excluded} matches (deferred to later section)`);
    }
  }

  if (matches.length === 0) {
    console.log('No classified matches for this section. Run classify.mjs first.');
    db.close();
    return 0;
  }

  // 按文件分组
  const byFile = new Map();
  for (const m of matches) {
    if (!byFile.has(m.file_path)) byFile.set(m.file_path, []);
    byFile.get(m.file_path).push(m);
  }

  console.log(`Files to process:    ${byFile.size}`);
  console.log(`Matches to replace:  ${matches.length}`);
  if (args.limit > 0 && byFile.size > args.limit) {
    console.log(`Limiting to first ${args.limit} files (--limit)`);
  }
  console.log();

  // dry-run 模式下完全不碰数据库，只收集 diff 并输出
  // 非 dry-run 模式：先计算所有替换，再统一写文件 + 写数据库
  const headBefore = getGitHead();
  let filesProcessed = 0;
  let replacementsDone = 0;
  let filesSkipped = 0;
  let matchSkipped = 0;
  const diffs = [];
  const allFileResults = []; // [{matchId, oldText, newText, filePath, lineNo}]

  for (const [filePath, fileMatches] of byFile) {
    if (args.limit > 0 && filesProcessed >= args.limit) break;
    const abs = resolve(REPO_ROOT, filePath);
    if (!existsSync(abs)) {
      filesSkipped++;
      continue;
    }
    const content = await Bun.file(abs).text();
    const lines = content.split('\n');

    // 按行号分组，同行按 column 倒序替换避免偏移
    const byLine = new Map();
    for (const m of fileMatches) {
      if (!byLine.has(m.line_no)) byLine.set(m.line_no, []);
      byLine.get(m.line_no).push(m);
    }
    for (const lineMatches of byLine.values()) {
      lineMatches.sort((a, b) => b.column_start - a.column_start);
    }

    let fileReplacements = 0;
    const fileDiffs = [];

    for (const [lineNo, lineMatches] of byLine) {
      for (const m of lineMatches) {
        const lineIdx = lineNo - 1;
        if (lineIdx < 0 || lineIdx >= lines.length) {
          matchSkipped++;
          continue;
        }
        const line = lines[lineIdx];
        const { before, matched, after } = sliceLineByteSafe(
          line,
          m.column_start,
          m.column_end
        );
        // 校验：matched_text 应与数据库记录一致
        if (matched !== m.matched_text) {
          matchSkipped++;
          fileDiffs.push(
            `  ! mismatch ${filePath}:${lineNo} expected ${JSON.stringify(m.matched_text)} got ${JSON.stringify(matched)}`
          );
          continue;
        }
        const newMatched = transformMatch(matched, section.domain);
        if (newMatched === matched) {
          // 无变化（domain 与实际大小写不匹配）
          matchSkipped++;
          continue;
        }
        lines[lineIdx] = before + newMatched + after;
        if (args.dryRun) {
          fileDiffs.push(
            `  ${filePath}:${lineNo}\n    - ${line}\n    + ${lines[lineIdx]}`
          );
        }
        allFileResults.push({ matchId: m.id, oldText: matched, newText: newMatched, filePath, lineNo });
        fileReplacements++;
        replacementsDone++;
      }
    }

    if (fileReplacements > 0) {
      if (!args.dryRun) {
        const newContent = lines.join('\n');
        await Bun.write(abs, newContent);
      }
      filesProcessed++;
      if (fileDiffs.length > 0) diffs.push(...fileDiffs);
    }
  }

  // 数据库写入（仅非 dry-run）
  let batchId = null;
  if (!args.dryRun && allFileResults.length > 0) {
    const now = new Date().toISOString();
    const batchRes = db
      .prepare(
        `INSERT INTO exec_batches (description, started_at, status, commit_hash_before)
         VALUES (?, ?, 'running', ?)`
      )
      .run(`Replace section ${args.section}: ${section.name}`, now, headBefore);
    batchId = Number(batchRes.lastInsertRowid);

    const insertReplacement = db.prepare(`
      INSERT INTO replacements (match_id, exec_batch_id, old_text, new_text, replaced_at, commit_hash)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const updateMatch = db.prepare(`
      UPDATE matches SET status = 'replaced', notes = COALESCE(notes, '') || ?
      WHERE id = ?
    `);

    const tx = db.transaction(() => {
      const ts = new Date().toISOString();
      for (const r of allFileResults) {
        insertReplacement.run(r.matchId, batchId, r.oldText, r.newText, ts, headBefore);
        updateMatch.run(` [replaced: section ${args.section}]`, r.matchId);
      }
    });
    tx();

    db.prepare(
      `UPDATE exec_batches
       SET completed_at = ?, status = 'completed', total_replacements = ?, commit_hash_after = ?
       WHERE id = ?`
    ).run(new Date().toISOString(), replacementsDone, getGitHead(), batchId);
  }

  // 报告
  console.log('=== Replace complete ===');
  console.log(`Exec batch:        ${batchId === null ? '(dry-run, no db write)' : batchId}`);
  console.log(`Files processed:   ${filesProcessed}`);
  console.log(`Files skipped:     ${filesSkipped} (not found)`);
  console.log(`Replacements done: ${replacementsDone}`);
  console.log(`Matches skipped:   ${matchSkipped} (mismatch or no change)`);

  if (args.dryRun) {
    // dry-run: 完整 diff 写入文件，终端只显示摘要
    const diffFile = `scripts/rebrand/dry-run-section-${args.section}.diff`;
    const diffPath = resolve(REPO_ROOT, diffFile);
    const header = `# Dry-run diff for section ${args.section}: ${section.name}\n` +
      `# Domain: ${section.domain}  Replacement: ${section.from} → ${section.to}\n` +
      `# Files: ${filesProcessed}  Replacements: ${replacementsDone}\n` +
      `# Generated: ${new Date().toISOString()}\n\n`;
    await Bun.write(diffPath, header + diffs.join('\n'));
    console.log(`\nFull diff written to: ${diffFile}`);
    console.log(`Review with: less ${diffFile} or code ${diffFile}`);

    // 终端预览前 30 条
    if (diffs.length > 0) {
      console.log(`\n=== Preview (first 30 of ${diffs.length}) ===`);
      for (const d of diffs.slice(0, 30)) console.log(d);
      if (diffs.length > 30) console.log(`... and ${diffs.length - 30} more (see ${diffFile})`);
    }
  } else {
    // 实际执行：显示数据库状态
    const remaining = db
      .query(
        `SELECT status, COUNT(*) AS c FROM matches GROUP BY status ORDER BY c DESC`
      )
      .all();
    console.log('\nMatch status summary:');
    for (const r of remaining) {
      console.log(`  ${r.status.padEnd(22)} ${r.c}`);
    }

    console.log('\nNext steps:');
    console.log('  1. Review changes: git diff');
    console.log('  2. Run verify:    bun run scripts/rebrand/verify.mjs --exec-batch-id ' + batchId);
    console.log('  3. If clean, commit manually');
  }

  db.close();
  return 0;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
