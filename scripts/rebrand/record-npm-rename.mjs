#!/usr/bin/env node
/**
 * 记录 §7 npm 组织名变更 (@noatinwork/ → @noatinwork-app/) 到 manual_fixes 表
 *
 * 由于 npm 组织名 "noatinwork" 已被占用，注册为 "noatinwork-app"，
 * 批量替换项目中所有 @noatinwork/ 为 @noatinwork-app/。
 *
 * 此脚本扫描所有包含 @noatinwork-app/ 的文件，
 * 将每一处修改记录到 manual_fixes 表，使用 category="other"。
 */
import { Database } from 'bun:sqlite';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const PATTERN = /@noatinwork-app\//g;

// 需要排除的目录
const EXCLUDE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.turbo', '.cache',
  'scripts/rebrand', // 跳过 rebrand 工具自身
]);

// 需要排除的文件
const EXCLUDE_FILES = new Set([
  'docs/REBRAND_PLAN.md', // 文档说明，非替换
  'bun.lock', // 自动生成文件
]);

// 递归扫描目录
function scanDir(dir, results = []) {
  const entries = readdirSync(dir);
  for (const name of entries) {
    const fullPath = join(dir, name);
    const relPath = relative(ROOT, fullPath);

    // 跳过排除的目录
    if (EXCLUDE_DIRS.has(relPath) || EXCLUDE_DIRS.has(name)) {
      continue;
    }

    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      scanDir(fullPath, results);
    } else if (stat.isFile()) {
      // 跳过排除的文件
      if (EXCLUDE_FILES.has(relPath)) {
        continue;
      }
      // 跳过二进制文件和超大文件
      if (stat.size > 5 * 1024 * 1024) continue;
      // 只扫描文本文件
      if (!/\.(js|mjs|ts|tsx|json|md|sh|svg|xml|yaml|yml|toml|lock|css|html)$/.test(name) && name !== 'bun.lock') {
        continue;
      }

      try {
        const content = readFileSync(fullPath, 'utf8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (PATTERN.test(lines[i])) {
            PATTERN.lastIndex = 0; // reset regex
            results.push({
              filePath: relPath,
              lineNo: i + 1,
              content: lines[i],
            });
          }
          PATTERN.lastIndex = 0;
        }
      } catch {
        // 跳过无法读取的文件
      }
    }
  }
  return results;
}

console.log('扫描项目中包含 @noatinwork-app/ 的文件...');
const matches = scanDir(ROOT);
console.log(`找到 ${matches.length} 处 @noatinwork-app/ 引用，涉及 ${new Set(matches.map(m => m.filePath)).size} 个文件\n`);

const db = new Database('scripts/rebrand/rebrand.db');

// 获取最新的 exec_batch_id
const latestBatch = db.query("SELECT id FROM exec_batches ORDER BY id DESC LIMIT 1").get();
const execBatchId = latestBatch?.id || 14;

// 准备插入语句
const insertStmt = db.prepare(`
  INSERT INTO manual_fixes (file_path, line_no, old_text, new_text, reason, category, exec_batch_id, match_id, fixed_at, notes)
  VALUES (?, ?, ?, ?, ?, 'other', ?, NULL, datetime('now'), ?)
`);

// 记录统计
let inserted = 0;
const errors = [];

for (const { filePath, lineNo, content } of matches) {
  // old_text: 将行中的 @noatinwork-app/ 替换回 @noatinwork/
  const oldText = content.replace(/@noatinwork-app\//g, '@noatinwork/').trim();
  // new_text: 当前行内容（包含 @noatinwork-app/）
  const newText = content.trim();

  try {
    insertStmt.run(
      filePath,
      lineNo,
      oldText,
      newText,
      '§7: npm org name "noatinwork" 已被占用, 注册为 "noatinwork-app", 批量替换 @noatinwork/ → @noatinwork-app/',
      execBatchId,
      'Step 2: npm org noatinwork-app registered'
    );
    inserted++;
  } catch (err) {
    errors.push({ filePath, lineNo, error: err.message });
  }
}

console.log(`已插入 ${inserted} 条记录`);
if (errors.length > 0) {
  console.log(`\n错误 ${errors.length} 条:`);
  errors.slice(0, 5).forEach(e => console.log(`  ${e.filePath}:${e.lineNo} - ${e.error}`));
}

// 验证
const count = db.query("SELECT COUNT(*) as count FROM manual_fixes WHERE notes LIKE '%noatinwork-app%'").get();
console.log(`\n数据库中 noatinwork-app 相关记录数: ${count.count}`);

// 按文件分组统计
const byFile = db.query(`
  SELECT file_path, COUNT(*) as count
  FROM manual_fixes
  WHERE notes LIKE '%noatinwork-app%'
  GROUP BY file_path
  ORDER BY count DESC
  LIMIT 10
`).all();
console.log('\n按文件分组 (前10):');
byFile.forEach(f => console.log(`  ${f.count} - ${f.file_path}`));

db.close();
