#!/usr/bin/env node
import { Database } from 'bun:sqlite';

const db = new Database('scripts/rebrand/rebrand.db');

const latestBatch = db.query("SELECT id FROM exec_batches ORDER BY id DESC LIMIT 1").get();
const execBatchId = latestBatch?.id || 14;

const insertStmt = db.prepare(`
  INSERT INTO manual_fixes (file_path, line_no, old_text, new_text, reason, category, exec_batch_id, match_id, fixed_at, notes)
  VALUES (?, ?, ?, ?, ?, 'other', ?, NULL, datetime('now'), ?)
`);

// GitHub 仓库改名 + remote URL 更新
insertStmt.run(
  '.git/config',
  0,
  'url = https://github.com/cccczl01/openchamber.git',
  'url = https://github.com/cccczl01/noatinwork.git',
  '§4.1: GitHub 仓库重命名 cccczl01/openchamber → cccczl01/noatinwork (gh repo rename), 更新本地 origin remote URL',
  execBatchId,
  'Step 3: GitHub repo renamed + local remote URL updated'
);

// REBRAND_PLAN.md 更新
insertStmt.run(
  'docs/REBRAND_PLAN.md',
  145,
  'GitHub 远端仓库重命名为 noatinwork（Settings → Rename；GitHub 自动重定向旧 URL，我方无用户，无影响），随后 git remote set-url origin 更新',
  '✅ GitHub 远端仓库已重命名为 noatinwork（gh repo rename noatinwork --repo cccczl01/openchamber），本地 git remote set-url origin 已更新',
  '§4.1: REBRAND_PLAN.md 更新远端仓库重命名状态为已完成',
  execBatchId,
  'Step 3: GitHub repo renamed + local remote URL updated'
);

// 验证
const count = db.query("SELECT COUNT(*) as count FROM manual_fixes WHERE notes LIKE '%GitHub repo renamed%'").get();
console.log(`已插入 ${count.count} 条记录`);

const remote = db.query("SELECT * FROM manual_fixes WHERE notes LIKE '%GitHub repo renamed%' ORDER BY id DESC").all();
console.log(JSON.stringify(remote, null, 2));

db.close();
