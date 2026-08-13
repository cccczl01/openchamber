#!/usr/bin/env bun
/**
 * Classify baseline matches into replacement domains.
 *
 * Two-phase:
 *   1. Auto-classify: apply refined heuristic rules to mark `pending` matches
 *      as `classified` (with domain) or `skipped_*` where the rule is certain.
 *      Only matches still `unclear` (or explicitly `--status unclear`) go to
 *      phase 2.
 *   2. Interactive review: walk through `unclear` matches one by one, show
 *      context, accept a domain choice (1-6), show more context (8), apply
 *      to whole file (9), or skip (7).
 *
 * Each classification updates `matches.domain_guess` and `matches.status`
 * immediately, so Ctrl+C is safe and the script can be resumed.
 *
 * Usage:
 *   bun run scripts/rebrand/classify.mjs [--auto-only] [--interactive-only]
 *                                        [--file <path>] [--limit <n>]
 *
 * Options:
 *   --auto-only           Run phase 1 only, do not enter interactive mode
 *   --interactive-only    Skip phase 1, go straight to interactive (for unclear)
 *   --file <path>         Restrict to a single file
 *   --limit <n>           Max interactive items (default unlimited)
 *   --help, -h            Show this help
 *
 * Read-only with respect to source files: only updates rebrand.db.
 */

import { Database } from 'bun:sqlite';
import * as readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const SCRIPT_DIR = new URL('./', import.meta.url);
const DB_PATH = new URL('./rebrand.db', SCRIPT_DIR).pathname;
const REPO_ROOT = resolve(new URL('../../', import.meta.url).pathname);

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = {
    autoOnly: false,
    interactiveOnly: false,
    file: null,
    limit: 0,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--auto-only') out.autoOnly = true;
    else if (a === '--interactive-only') out.interactiveOnly = true;
    else if (a === '--file' && argv[i + 1]) out.file = argv[++i];
    else if (a.startsWith('--file=')) out.file = a.slice('--file='.length);
    else if (a === '--limit' && argv[i + 1]) out.limit = parseInt(argv[++i], 10);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(`Usage: bun run scripts/rebrand/classify.mjs [options]

Classify baseline matches into replacement domains.

  --auto-only           Run auto-classification only, no interactive mode
  --interactive-only    Skip auto, go straight to interactive review
  --file <path>         Restrict to a single file
  --limit <n>           Max interactive items (default unlimited)`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Auto-classification rules
// 顺序敏感：更具体的规则先匹配
// ---------------------------------------------------------------------------

const AUTO_RULES = [
  // NOATINWORK_ 域：环境变量常量
  // 只匹配 matched_text 是全大写 OPENCHAMBER 的 submatch，避免 line 测试误分类同行的驼峰/小写变体
  {
    name: 'env-constant',
    domain: 'NOATINWORK_',
    status: 'classified',
    planSection: '§2.3',
    test: (line, matched) =>
      matched === 'OPENCHAMBER' && (
        /process\.env\.OPENCHAMBER_/.test(line) ||
        /\benv\.OPENCHAMBER_/.test(line) ||
        /\benvironment\.OPENCHAMBER_/.test(line) ||
        /\bOPENCHAMBER_[A-Z][A-Z0-9_]*\b/.test(line)
      ),
  },
  // NOATINWORK_ 域：浏览器注入全局
  // 只匹配 matched_text 是全大写 OPENCHAMBER 的 submatch
  {
    name: 'window-global',
    domain: 'NOATINWORK_',
    status: 'classified',
    planSection: '§2.3',
    test: (line, matched) =>
      matched === 'OPENCHAMBER' && (
        /window\.__OPENCHAMBER_/.test(line) || /__OPENCHAMBER_[A-Z_]+__/.test(line)
      ),
  },
  // NOATINWORK_ 域：全大写 OPENCHAMBER 兜底
  // 捕获未被 env-constant / window-global 命中的全大写品牌词（字符串常量、错误码等）
  // 如 `[OMITTED BY OPENCHAMBER]`、`OPENCODE_UPGRADE_MANAGED_BY_OPENCHAMBER`
  {
    name: 'uppercase-constant',
    domain: 'NOATINWORK_',
    status: 'classified',
    planSection: '§2.3',
    test: (line, matched) => matched === 'OPENCHAMBER',
  },
  // NoatinWork 标识层：OpenChamber 后跟大写字母（type/interface/类/组件名）
  // 用 matched 测试（不是 line），避免同一行中其他位置的 OpenChamber 导致误分类
  // 例如 `openChamberHealth: OpenChamberHealthSnapshot` 行中，matched=openChamber 不应被
  // line 中的 OpenChamberHealth 触发误分类为 NoatinWork 域
  {
    name: 'type-identifier',
    domain: 'NoatinWork',
    status: 'classified',
    planSection: '§2.4',
    test: (line, matched) => /OpenChamber[A-Z]/.test(matched),
  },
  // NoatinWork 标识层：camelCase 变体 openChamber（小o大C）
  // 品牌词 OpenChamber 的 camelCase 形式，如 openChamberVersionLabel、openChamberLogo
  // 替换为 noatinWork（NoatinWork 的 camelCase 形式）
  {
    name: 'camelcase-identifier',
    domain: 'NoatinWork',
    status: 'classified',
    planSection: '§2.4',
    test: (line, matched) => matched === 'openChamber',
  },
  // NoatinWork 标识层：非标准大小写 Openchamber（大O小c）
  // 原始代码中的大小写不一致，如 remoteOpenchamber、installOpenchamberIdleProbe
  // 统一替换为标准 PascalCase NoatinWork
  {
    name: 'mixedcase-identifier',
    domain: 'NoatinWork',
    status: 'classified',
    planSection: '§2.4',
    test: (line, matched) => matched === 'Openchamber',
  },
  // noatinwork 域：包名
  // 只匹配 matched_text 是全小写 openchamber 的 submatch
  {
    name: 'package-name',
    domain: 'noatinwork',
    status: 'classified',
    planSection: '§2.2',
    test: (line, matched) => matched === 'openchamber' && /@openchamber\//.test(line),
  },
  // noatinwork 域：深链协议
  // 只匹配 matched_text 是全小写 openchamber 的 submatch
  {
    name: 'deep-link-scheme',
    domain: 'noatinwork',
    status: 'classified',
    planSection: '§2.2',
    test: (line, matched) =>
      matched === 'openchamber' && (/openchamber:\/\//.test(line) || /openchamber-ui:\/\//.test(line)),
  },
  // noatinwork 域：数据目录路径
  // 只匹配 matched_text 是全小写 openchamber 的 submatch
  {
    name: 'data-dir-path',
    domain: 'noatinwork',
    status: 'classified',
    planSection: '§2.2',
    test: (line, matched) =>
      matched === 'openchamber' && (
        /~\/\.config\/openchamber/.test(line) ||
        /\.openchamber\//.test(line) ||
        /\/\.openchamber\b/.test(line)
      ),
  },
  // noatinwork 域：域名（dev.openchamber.* / com.openchamber.*）
  // 只匹配 matched_text 是全小写 openchamber 的 submatch
  {
    name: 'domain-identifier',
    domain: 'noatinwork',
    status: 'classified',
    planSection: '§2.2',
    test: (line, matched) =>
      matched === 'openchamber' && (/dev\.openchamber\./.test(line) || /com\.openchamber\./.test(line)),
  },
  // noatinwork 域：桌面文件名
  // 只匹配 matched_text 是全小写 openchamber 的 submatch
  {
    name: 'desktop-file',
    domain: 'noatinwork',
    status: 'classified',
    planSection: '§2.2',
    test: (line, matched) => matched === 'openchamber' && /openchamber\.desktop/.test(line),
  },
  // NoatinWork 域：独立词（UI 文案、产物名、displayName）
  {
    name: 'brand-word',
    domain: 'NoatinWork',
    status: 'classified',
    planSection: '§2.1',
    test: (line, matched) => /\bOpenChamber\b/.test(matched),
  },
  // noatinwork 域：全小写独立词（命令、文件名、目录名）
  {
    name: 'lowercase-word',
    domain: 'noatinwork',
    status: 'classified',
    planSection: '§2.2',
    test: (line, matched) => /\bopenchamber\b/.test(matched),
  },
];

// §8 合法残留自动匹配（用 file_path 或 context_line 字面匹配）
function matchWhitelist(file_path, context_line, matched_text, whitelist) {
  for (const w of whitelist) {
    if (w.pattern.length === 0) continue;
    // file_path 匹配：跳过整个文件（不论 matched_text 大小写）
    if (file_path.includes(w.pattern)) {
      return w;
    }
    // context_line 匹配：只跳过全小写 openchamber 的 submatch
    if (context_line.includes(w.pattern) && matched_text === 'openchamber') {
      return w;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Phase 1: auto-classify
// ---------------------------------------------------------------------------

function autoClassify(db, fileFilter) {
  const whitelist = db.query('SELECT pattern, reason, plan_section FROM legitimate_remaining').all();
  const fileClause = fileFilter ? 'AND file_path = ?' : '';
  const params = fileFilter ? [fileFilter] : [];

  const pending = db
    .query(
      `SELECT id, file_path, line_no, matched_text, context_line, domain_guess
       FROM matches
       WHERE status IN ('pending', 'unclear') ${fileClause}
       ORDER BY id`
    )
    .all(...params);

  const updateMatch = db.prepare(`
    UPDATE matches SET status = ?, domain_guess = ?, notes = COALESCE(notes, '') || ?
    WHERE id = ?
  `);
  const ensureRule = db.prepare(`
    INSERT INTO rules (name, plan_section, domain, created_at) VALUES (?, ?, ?, ?)
    ON CONFLICT DO NOTHING
  `);
  const findRule = db.prepare(`SELECT id FROM rules WHERE name = ? LIMIT 1`);

  const stats = { classified: 0, skipped_legitimate: 0, unclear: 0, total: pending.length };
  const ruleCache = new Map();

  function getRuleId(name, planSection, domain) {
    if (ruleCache.has(name)) return ruleCache.get(name);
    ensureRule.run(name, planSection, domain, new Date().toISOString());
    const row = findRule.get(name);
    const id = row ? row.id : null;
    ruleCache.set(name, id);
    return id;
  }

  const tx = db.transaction(() => {
    for (const m of pending) {
      // 1. §8 白名单
      const wl = matchWhitelist(m.file_path, m.context_line, m.matched_text, whitelist);
      if (wl) {
        const ruleId = getRuleId(`legitimate:${wl.pattern}`, wl.plan_section, 'noatinwork');
        updateMatch.run('skipped_legitimate', 'noatinwork', ` [auto: §8 whitelist - ${wl.reason}]`, m.id);
        // 注意：domain_guess 不影响 skipped_*，保留原值即可，但这里设为 noatinwork 占位
        stats.skipped_legitimate++;
        continue;
      }
      // 2. AUTO_RULES
      let matched = false;
      for (const rule of AUTO_RULES) {
        if (rule.test(m.context_line, m.matched_text)) {
          const ruleId = getRuleId(rule.name, rule.planSection, rule.domain);
          updateMatch.run(rule.status, rule.domain, ` [auto: ${rule.name}]`, m.id);
          stats.classified++;
          matched = true;
          break;
        }
      }
      if (!matched) {
        // 保持 unclear
        if (m.status !== 'unclear') {
          updateMatch.run('unclear', m.domain_guess || 'unclear', ' [auto: no rule matched]', m.id);
        }
        stats.unclear++;
      }
    }
  });
  tx();

  return stats;
}

// ---------------------------------------------------------------------------
// Phase 2: interactive review
// ---------------------------------------------------------------------------

async function readMoreContext(filePath, lineNo, around = 5) {
  const abs = resolve(REPO_ROOT, filePath);
  if (!existsSync(abs)) {
    return ['(file not found)'];
  }
  const text = await Bun.file(abs).text();
  const lines = text.split('\n');
  const start = Math.max(1, lineNo - around);
  const end = Math.min(lines.length, lineNo + around);
  const out = [];
  for (let i = start; i <= end; i++) {
    const marker = i === lineNo ? '>>>' : '   ';
    out.push(`${marker} ${i.toString().padStart(5)}: ${lines[i - 1] || ''}`);
  }
  return out;
}

async function interactiveReview(db, fileFilter, limit) {
  const fileClause = fileFilter ? 'AND file_path = ?' : '';
  const params = fileFilter ? [fileFilter] : [];
  const limitClause = limit > 0 ? 'LIMIT ?' : '';
  const limitParams = limit > 0 ? [limit] : [];

  const unclear = db
    .query(
      `SELECT id, file_path, line_no, matched_text, context_line, domain_guess
       FROM matches
       WHERE status = 'unclear' ${fileClause}
       ORDER BY file_path, line_no ${limitClause}`
    )
    .all(...params, ...limitParams);

  if (unclear.length === 0) {
    console.log('No unclear matches to review.');
    return 0;
  }

  console.log(`\n=== Interactive review: ${unclear.length} unclear matches ===`);
  console.log('Commands: 1-3 domain, 4-6 skip, 7 skip item, 8 more context, 9 file-batch, 0 quit\n');

  const rl = readline.createInterface({ input: stdin, output: stdout });
  const updateMatch = db.prepare(`
    UPDATE matches SET status = ?, domain_guess = ?, notes = COALESCE(notes, '') || ?
    WHERE id = ?
  `);

  let processed = 0;
  let skipped = 0;

  for (const m of unclear) {
    const guess = m.domain_guess || 'unclear';
    const defaultChoice = guess === 'NoatinWork' ? 1 : guess === 'noatinwork' ? 2 : guess === 'NOATINWORK_' ? 3 : 0;

    console.log(`[${processed + 1}/${unclear.length}] ${m.file_path}:${m.line_no}`);
    console.log(`  domain_guess: ${guess}`);
    console.log(`  matched:      ${m.matched_text}`);
    console.log(`  context:      ${m.context_line.slice(0, 160)}`);
    if (defaultChoice) console.log(`  (suggested: ${defaultChoice})`);
    console.log();

    let ask = true;
    while (ask) {
      const ans = (await rl.question('  choice [1-9, 0=quit]: ')).trim();
      const num = parseInt(ans, 10);
      if (ans === '' || num === 0 || isNaN(num)) {
        if (ans === '' || num === 0) {
          ask = false;
          skipped = 0;
          console.log('  (exit)\n');
          // break outer loop
          processed = unclear.length;
          break;
        }
      }
      switch (num) {
        case 1:
        case 2:
        case 3: {
          const domain = num === 1 ? 'NoatinWork' : num === 2 ? 'noatinwork' : 'NOATINWORK_';
          updateMatch.run('classified', domain, ' [interactive]', m.id);
          processed++;
          ask = false;
          console.log(`  → classified as ${domain}\n`);
          break;
        }
        case 4:
          updateMatch.run('skipped_legitimate', m.domain_guess, ' [interactive: §8 legitimate]', m.id);
          processed++;
          ask = false;
          console.log('  → skipped_legitimate\n');
          break;
        case 5:
          updateMatch.run('skipped_neutral', m.domain_guess, ' [interactive: neutral key]', m.id);
          processed++;
          ask = false;
          console.log('  → skipped_neutral\n');
          break;
        case 6:
          updateMatch.run('skipped_external', m.domain_guess, ' [interactive: external dep]', m.id);
          processed++;
          ask = false;
          console.log('  → skipped_external\n');
          break;
        case 7:
          // 跳过本条，保持 unclear
          ask = false;
          console.log('  (skipped, still unclear)\n');
          break;
        case 8: {
          const more = await readMoreContext(m.file_path, m.line_no, 5);
          console.log(more.join('\n'));
          console.log();
          break;
        }
        case 9: {
          // 本文件全部按当前建议域处理
          const domain =
            defaultChoice === 1 ? 'NoatinWork' : defaultChoice === 2 ? 'noatinwork' : defaultChoice === 3 ? 'NOATINWORK_' : null;
          if (!domain) {
            console.log('  no default choice for this match, cannot batch\n');
            break;
          }
          const res = db
            .prepare(
              `UPDATE matches SET status = 'classified', domain_guess = ?, notes = COALESCE(notes, '') || ' [interactive: file-batch]'
               WHERE file_path = ? AND status = 'unclear'`
            )
            .run(domain, m.file_path);
          console.log(`  → batch-classified ${res.changes} matches in ${m.file_path} as ${domain}\n`);
          processed += res.changes;
          ask = false;
          break;
        }
        default:
          console.log('  invalid choice, try again\n');
      }
    }
  }

  rl.close();
  console.log(`\nInteractive review complete: ${processed} processed.`);
  return processed;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const db = new Database(DB_PATH, { create: true });
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA foreign_keys = ON');
  db.run('PRAGMA synchronous = NORMAL');

  // Phase 1: auto-classify
  if (!args.interactiveOnly) {
    console.log('=== Phase 1: auto-classify ===');
    const stats = autoClassify(db, args.file);
    console.log(`Total scanned:    ${stats.total}`);
    console.log(`Classified:       ${stats.classified}`);
    console.log(`Skipped (legit):  ${stats.skipped_legitimate}`);
    console.log(`Still unclear:    ${stats.unclear}`);
  }

  // Phase 2: interactive review
  if (!args.autoOnly) {
    await interactiveReview(db, args.file, args.limit);
  }

  // 汇总
  const summary = db
    .query(
      `SELECT status, COUNT(*) AS c FROM matches GROUP BY status ORDER BY c DESC`
    )
    .all();
  console.log('\n=== Final state ===');
  for (const r of summary) {
    console.log(`  ${r.status.padEnd(22)} ${r.c}`);
  }

  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
