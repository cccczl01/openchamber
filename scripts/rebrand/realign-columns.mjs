#!/usr/bin/env bun
/**
 * Realign column positions for remaining matches after section replacements.
 *
 * After a section replacement (e.g., §2.1: OpenChamber→NoatinWork), the
 * character length may change, causing column positions of subsequent
 * matches on the same line to shift. This script reads replacements from
 * a specified exec_batch and adjusts column_start/column_end for remaining
 * (non-replaced) matches accordingly.
 *
 * Workflow position:
 *   scan.mjs → classify.mjs → §2.1 replace → realign → §2.2 replace → realign → ...
 *
 * Usage:
 *   bun run scripts/rebrand/realign-columns.mjs --batch <exec_batch_id>
 *   bun run scripts/rebrand/realign-columns.mjs --batch <exec_batch_id> --dry-run
 *   bun run scripts/rebrand/realign-columns.mjs --latest
 *
 * Options:
 *   --batch <id>    Exec batch ID to realign against (required unless --latest)
 *   --latest        Use the most recent completed exec_batch
 *   --dry-run       Preview adjustments without modifying DB
 *   --help, -h      Show this help
 */

import { Database } from 'bun:sqlite';

const SCRIPT_DIR = new URL('./', import.meta.url);
const DB_PATH = new URL('./rebrand.db', SCRIPT_DIR).pathname;

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { batch: null, latest: false, dryRun: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--latest') out.latest = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--batch' && argv[i + 1]) out.batch = parseInt(argv[++i], 10);
    else if (a.startsWith('--batch=')) out.batch = parseInt(a.slice('--batch='.length), 10);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(`Usage: bun run scripts/rebrand/realign-columns.mjs [options]

Realign column positions for remaining matches after section replacements.

  --batch <id>    Exec batch ID to realign against
  --latest        Use the most recent completed exec_batch
  --dry-run       Preview adjustments without modifying DB`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const db = new Database(DB_PATH);
db.run('PRAGMA journal_mode = WAL');

// Determine batch ID
let batchId = args.batch;
if (!batchId && args.latest) {
  const row = db
    .query("SELECT id FROM exec_batches WHERE status = 'completed' ORDER BY id DESC LIMIT 1")
    .get();
  if (!row) {
    console.error('Error: no completed exec_batch found');
    process.exit(1);
  }
  batchId = row.id;
}
if (!batchId) {
  console.error('Error: --batch <id> or --latest required');
  process.exit(1);
}

// Verify batch exists
const batch = db
  .query('SELECT id, description, status, total_replacements FROM exec_batches WHERE id = ?')
  .get(batchId);
if (!batch) {
  console.error(`Error: exec_batch #${batchId} not found`);
  process.exit(1);
}

console.log(`=== Realign columns for exec_batch #${batchId} ===`);
console.log(`Description: ${batch.description}`);
console.log(`Status: ${batch.status}, Total replacements: ${batch.total_replacements || 0}`);
console.log('');

// Get all replacements for this batch, joined with matches for column positions
const replacements = db
  .query(
    `
    SELECT
      m.id as match_id,
      m.file_path,
      m.line_no,
      m.column_start,
      m.column_end,
      r.old_text,
      r.new_text
    FROM replacements r
    JOIN matches m ON r.match_id = m.id
    WHERE r.exec_batch_id = ?
    ORDER BY m.file_path, m.line_no, m.column_start
  `
  )
  .all(batchId);

if (replacements.length === 0) {
  console.log('No replacements found for this batch. Nothing to realign.');
  db.close();
  process.exit(0);
}

// Calculate offset for each replacement (skip NULL columns)
const validReplacements = replacements.filter(
  (r) => r.column_start != null && r.column_end != null
);
for (const r of validReplacements) {
  r.offset = r.new_text.length - r.old_text.length;
}

// Count replacements with non-zero offset
const nonZeroOffset = validReplacements.filter((r) => r.offset !== 0);
console.log(`Replacements: ${replacements.length} total, ${validReplacements.length} with column info, ${nonZeroOffset.length} with non-zero offset`);

if (nonZeroOffset.length === 0) {
  console.log('All replacements have zero offset (same length). Nothing to realign.');
  db.close();
  process.exit(0);
}

// Group non-zero-offset replacements by file_path + line_no
const replByFileLine = new Map();
for (const r of nonZeroOffset) {
  const key = `${r.file_path}\x00${r.line_no}`;
  if (!replByFileLine.has(key)) replByFileLine.set(key, []);
  replByFileLine.get(key).push(r);
}

console.log(`Lines with non-zero offset replacements: ${replByFileLine.size}`);
console.log('');

// For each group, find remaining matches and calculate adjustments
const adjustments = [];

for (const [key, repls] of replByFileLine) {
  const [file_path, line_no_str] = key.split('\x00');
  const line_no = parseInt(line_no_str, 10);

  // Get remaining (non-replaced) matches on this line
  const remaining = db
    .query(
      `
      SELECT id, column_start, column_end, matched_text, status
      FROM matches
      WHERE file_path = ? AND line_no = ? AND status != 'replaced'
        AND column_start IS NOT NULL AND column_end IS NOT NULL
      ORDER BY column_start
    `
    )
    .all(file_path, line_no);

  for (const m of remaining) {
    // Calculate cumulative offset from all replacements that END before this match STARTS
    let cumulativeOffset = 0;
    for (const r of repls) {
      if (r.column_end < m.column_start) {
        cumulativeOffset += r.offset;
      }
    }

    if (cumulativeOffset !== 0) {
      adjustments.push({
        match_id: m.id,
        file_path,
        line_no,
        old_start: m.column_start,
        old_end: m.column_end,
        new_start: m.column_start + cumulativeOffset,
        new_end: m.column_end + cumulativeOffset,
        offset: cumulativeOffset,
        matched_text: m.matched_text,
      });
    }
  }
}

// Output / apply adjustments
if (adjustments.length === 0) {
  console.log('No adjustments needed. All remaining matches are correctly positioned.');
  db.close();
  process.exit(0);
}

if (args.dryRun) {
  console.log(`=== Dry run: ${adjustments.length} adjustments would be made ===\n`);
} else {
  const updateMatch = db.prepare(
    'UPDATE matches SET column_start = ?, column_end = ? WHERE id = ?'
  );
  const tx = db.transaction(() => {
    for (const a of adjustments) {
      updateMatch.run(a.new_start, a.new_end, a.match_id);
    }
  });
  tx();
  console.log(`=== Applied ${adjustments.length} column adjustments ===\n`);
}

// Show sample adjustments (first 30)
const sample = adjustments.slice(0, 30);
for (const a of sample) {
  console.log(
    `  ${a.file_path}:${a.line_no} match #${a.match_id} [${a.matched_text}] ` +
      `${a.old_start}-${a.old_end} → ${a.new_start}-${a.new_end} (offset ${a.offset >= 0 ? '+' : ''}${a.offset})`
  );
}
if (adjustments.length > 30) {
  console.log(`  ... and ${adjustments.length - 30} more`);
}

console.log('');
console.log(`Total adjustments: ${adjustments.length}`);
db.close();
