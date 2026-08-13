#!/usr/bin/env bun
/**
 * Delete files (or directories) per a JSON manifest and record the deletions
 * in rebrand.db. Every deleted file's existing `matches` rows are marked
 * `deleted_with_file` so they no longer count against zero-verification while
 * remaining fully traceable.
 *
 * Usage:
 *   bun run scripts/rebrand/delete-files.mjs --manifest <path> [--dry-run]
 *
 * Manifest format (JSON):
 *   {
 *     "description": "Delete 9 i18n language files per REBRAND_PLAN §1",
 *     "plan_section": "§1",
 *     "reason": "i18n only keeps en + zh-CN per §1",
 *     "files": ["packages/ui/src/lib/i18n/messages/de.ts", ...],
 *     "dirs":  ["packages/docs/content/docs/de/", ...]
 *   }
 *
 * Options:
 *   --manifest <path>  Path to manifest JSON (required)
 *   --dry-run          List what would be deleted without deleting
 *   --help, -h         Show this help
 *
 * Read-only with respect to source files when --dry-run is set.
 */

import { Database } from 'bun:sqlite';
import { existsSync, statSync, rmSync, readdirSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';

const SCRIPT_DIR = new URL('./', import.meta.url);
const DB_PATH = new URL('./rebrand.db', SCRIPT_DIR).pathname;
const REPO_ROOT = resolve(new URL('../../', import.meta.url).pathname);

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { manifest: '', dryRun: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--manifest' && argv[i + 1]) out.manifest = argv[++i];
    else if (a.startsWith('--manifest=')) out.manifest = a.slice('--manifest='.length);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(`Usage: bun run scripts/rebrand/delete-files.mjs --manifest <path> [--dry-run]

Delete files per a JSON manifest and record deletions in rebrand.db.

  --manifest <path>  Path to manifest JSON
  --dry-run          List what would be deleted without deleting`);
  process.exit(0);
}
if (!args.manifest) {
  console.error('Error: --manifest <path> is required');
  process.exit(1);
}

const manifestPath = isAbsolute(args.manifest) ? args.manifest : resolve(process.cwd(), args.manifest);
if (!existsSync(manifestPath)) {
  console.error(`Error: manifest not found: ${manifestPath}`);
  process.exit(1);
}

const manifest = JSON.parse(await Bun.file(manifestPath).text());
if (!manifest.files && !manifest.dirs) {
  console.error('Error: manifest must contain "files" and/or "dirs" array');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** 展开目录为内部所有文件（递归），返回 repo-relative 路径列表。 */
function expandDir(dirRel) {
  const abs = resolve(REPO_ROOT, dirRel);
  if (!existsSync(abs)) return [];
  const out = [];
  const walk = (p, rel) => {
    const ents = readdirSync(p, { withFileTypes: true });
    for (const e of ents) {
      const childAbs = resolve(p, e.name);
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(childAbs, childRel);
      else out.push(childRel);
    }
  };
  walk(abs, dirRel);
  return out;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const db = new Database(DB_PATH, { create: true });
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA foreign_keys = ON');
  db.run('PRAGMA synchronous = NORMAL');

  // 收集所有待删文件（目录展开）
  const filesToDelete = new Set();
  for (const f of manifest.files || []) filesToDelete.add(f);
  for (const d of manifest.dirs || []) {
    for (const f of expandDir(d)) filesToDelete.add(f);
  }
  const sortedFiles = [...filesToDelete].sort();

  // 预查询每个文件的 match_count
  const fileMatchCount = new Map();
  for (const f of sortedFiles) {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS c FROM matches
         WHERE file_path = ? AND status NOT IN ('deleted_with_file')`
      )
      .get(f);
    fileMatchCount.set(f, row.c);
  }

  const totalMatchCount = [...fileMatchCount.values()].reduce((a, b) => a + b, 0);

  // 汇总待删
  console.log('=== Delete plan ===');
  console.log(`Manifest:     ${manifestPath}`);
  console.log(`Description:  ${manifest.description || '(none)'}`);
  console.log(`Plan section: ${manifest.plan_section || '(none)'}`);
  console.log(`Reason:       ${manifest.reason || '(none)'}`);
  console.log(`Files:        ${sortedFiles.length}`);
  console.log(`Dirs:         ${(manifest.dirs || []).length}`);
  console.log(`Matches:      ${totalMatchCount} (will be marked deleted_with_file)`);
  console.log();

  if (sortedFiles.length > 0 && sortedFiles.length <= 50) {
    console.log('Files to delete:');
    for (const f of sortedFiles) {
      console.log(`  ${(fileMatchCount.get(f) || 0).toString().padStart(4)}  ${f}`);
    }
    console.log();
  } else if (sortedFiles.length > 50) {
    console.log(`(showing first 50 of ${sortedFiles.length} files)`);
    for (const f of sortedFiles.slice(0, 50)) {
      console.log(`  ${(fileMatchCount.get(f) || 0).toString().padStart(4)}  ${f}`);
    }
    console.log(`... and ${sortedFiles.length - 50} more`);
    console.log();
  }

  if (args.dryRun) {
    console.log('Dry run: no files deleted.');
    db.close();
    return 0;
  }

  // 执行删除 + 记录
  const now = new Date().toISOString();
  const commitHash = null; // 不自动 commit，由用户手动 commit 后回填

  const batchRes = db
    .prepare(
      `INSERT INTO exec_batches (description, started_at, status, commit_hash_before)
       VALUES (?, ?, 'running', ?)`
    )
    .run(
      `Delete files: ${manifest.description || manifestPath}`,
      now,
      getGitHead()
    );
  const batchId = Number(batchRes.lastInsertRowid);

  const insertDeletedFile = db.prepare(`
    INSERT INTO deleted_files (exec_batch_id, file_path, reason, plan_section, match_count_before_delete, deleted_at, commit_hash, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateMatches = db.prepare(`
    UPDATE matches
    SET status = 'deleted_with_file', deleted_file_id = ?, notes = COALESCE(notes, '') || ' [deleted: ' || ? || ']'
    WHERE file_path = ? AND status NOT IN ('deleted_with_file')
  `);

  let deletedCount = 0;
  let missingCount = 0;
  const tx = db.transaction(() => {
    for (const f of sortedFiles) {
      const abs = resolve(REPO_ROOT, f);
      if (!existsSync(abs)) {
        missingCount++;
        continue;
      }
      const matchCount = fileMatchCount.get(f) || 0;
      const deletedRes = insertDeletedFile.run(
        batchId,
        f,
        manifest.reason || 'per manifest',
        manifest.plan_section || null,
        matchCount,
        now,
        commitHash,
        manifest.description || null
      );
      const deletedFileId = Number(deletedRes.lastInsertRowid);
      // 标记该文件所有未删除的 matches
      updateMatches.run(deletedFileId, manifest.reason || 'per manifest', f);
      // 物理删除
      rmSync(abs, { force: true });
      deletedCount++;
    }
  });
  tx();

  // 完成 exec_batch
  db.prepare(
    `UPDATE exec_batches SET completed_at = ?, status = 'completed', total_replacements = ?, commit_hash_after = ?
     WHERE id = ?`
  ).run(new Date().toISOString(), deletedCount, getGitHead(), batchId);

  console.log('=== Delete complete ===');
  console.log(`Exec batch:   ${batchId}`);
  console.log(`Deleted:      ${deletedCount} files`);
  if (missingCount > 0) console.log(`Missing:      ${missingCount} files (already absent, skipped)`);
  console.log(`Matches:     ${totalMatchCount} marked deleted_with_file`);
  console.log(`Remaining pending matches: ${db.query("SELECT COUNT(*) AS c FROM matches WHERE status = 'pending'").get().c}`);

  db.close();
  return 0;
}

function getGitHead() {
  try {
    const proc = Bun.spawnSync(['git', 'rev-parse', 'HEAD'], { cwd: REPO_ROOT, stdout: 'pipe', stderr: 'pipe' });
    if (proc.exitCode === 0) return proc.stdout.toString().trim();
  } catch {}
  return null;
}

process.exit(main());
