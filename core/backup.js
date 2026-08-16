'use strict';

/**
 * MemLocal — 备份 / 恢复 / 导出（用户拥有数据承诺落地）
 *
 * - backup：把 store + config + audit 打成时间戳命名的 JSON 备份到 <home>/backups/
 * - restore：从指定备份回滚 store
 * - exportAll：导出为可移植格式（合并 Markdown + 原始 JSON），方便迁移到其它工具
 *
 * 纯 Node 内置模块（zlib 压缩），零依赖。
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const storeMod = require('./store');

function backupsDir() {
  return path.join(storeMod.homeDir(), 'backups');
}

/**
 * 创建备份
 * @returns {string} 备份文件绝对路径
 */
function createBackup() {
  const dir = backupsDir();
  fs.mkdirSync(dir, { recursive: true });
  const store = storeMod.loadStore();
  const cfg = storeMod.loadConfig();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const fp = path.join(dir, `memlocal-${stamp}.json.gz`);
  const payload = JSON.stringify({ type: 'memlocal-backup', version: 2, createdAt: Date.now(), store, config: cfg }, null, 2);
  fs.writeFileSync(fp, zlib.gzipSync(payload, { level: 9 }));
  return fp;
}

/**
 * 列出所有备份
 * @returns {Array<{file, size, time}>}
 */
function listBackups() {
  const dir = backupsDir();
  const out = [];
  let files = [];
  try { files = fs.readdirSync(dir).filter(n => n.endsWith('.json.gz')); } catch (e) { return out; }
  for (const f of files) {
    const fp = path.join(dir, f);
    const st = fs.statSync(fp);
    out.push({ file: fp, size: st.size, time: st.mtimeMs });
  }
  return out.sort((a, b) => b.time - a.time);
}

/**
 * 从备份恢复 store（备份里含 config 一并恢复）
 * @param {string} backupFile 备份文件绝对路径
 * @returns {boolean}
 */
function restoreBackup(backupFile) {
  if (!backupFile || !fs.existsSync(backupFile)) return false;
  let data;
  try {
    data = JSON.parse(zlib.gunzipSync(fs.readFileSync(backupFile)).toString('utf8'));
  } catch (e) {
    return false;
  }
  if (!data || !data.store || !Array.isArray(data.store.memories)) return false;
  // 写前备份当前状态，避免恢复失败丢数据
  const safety = createBackup();
  storeMod.saveStore(data.store);
  if (data.config && typeof data.config === 'object') storeMod.saveConfig(data.config);
  storeMod.addAudit(storeMod.loadStore(), { action: 'restore', detail: `从备份恢复 ${path.basename(backupFile)}（当前状态已另存 ${path.basename(safety)}）` });
  storeMod.saveStore(storeMod.loadStore());
  return true;
}

/**
 * 导出全部记忆为可移植格式
 * @returns {{mdFile, jsonFile}}
 */
function exportAll() {
  const dir = backupsDir();
  fs.mkdirSync(dir, { recursive: true });
  const store = storeMod.loadStore();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  // 合并 Markdown（按类型分组，人类可读）
  const TYPE_TITLE = { identity: '身份', preference: '偏好', project: '项目', context: '背景', fact: '事实', summary: '摘要' };
  const order = ['identity', 'preference', 'project', 'context', 'fact', 'summary'];
  const lists = { identity: [], preference: [], project: [], context: [], fact: [], summary: [] };
  for (const m of store.memories) {
    if (m.archived) continue;
    (lists[m.type] || lists.fact).push(`- ${m.content}  （来源: ${m.source}, 置信: ${Math.round((m.confidence || 0.7) * 100)}%）`);
  }
  let md = `# MemLocal 记忆导出（${new Date().toLocaleString()}）\n\n共 ${store.memories.length} 条记忆\n`;
  for (const t of order) {
    if (lists[t].length) md += `\n## ${TYPE_TITLE[t]}\n` + lists[t].join('\n') + '\n';
  }
  const mdFile = path.join(dir, `memlocal-export-${stamp}.md`);
  fs.writeFileSync(mdFile, md, 'utf8');

  // 原始 JSON（可回灌）
  const jsonFile = path.join(dir, `memlocal-export-${stamp}.json`);
  fs.writeFileSync(jsonFile, JSON.stringify({ type: 'memlocal-export', version: 2, exportedAt: Date.now(), memories: store.memories }, null, 2), 'utf8');

  return { mdFile, jsonFile, total: store.memories.length };
}

/**
 * 记忆版本化（git 导出）
 * 把 store 快照提交到 git 仓库（默认 <home>/memory-repo），每次调用产生一个 commit，
 * 支持 `git log` 回溯任意历史版本。零依赖（调用系统 git）。
 * @returns {{repo, commit, total}}
 */
function gitExport(opts = {}) {
  const { execSync } = require('child_process');
  const repo = opts.repo || path.join(storeMod.homeDir(), 'memory-repo');
  fs.mkdirSync(repo, { recursive: true });

  // 若目录非 git 仓库则初始化
  if (!fs.existsSync(path.join(repo, '.git'))) {
    execSync('git init -q', { cwd: repo });
    execSync('git config user.email memlocal@local', { cwd: repo });
    execSync('git config user.name memlocal', { cwd: repo });
  }

  // 快照文件：store.json + 可读 memories.md + 索引
  const store = storeMod.loadStore();
  const active = (store.memories || []).filter(m => !m.archived);
  fs.writeFileSync(path.join(repo, 'store.json'), JSON.stringify(store, null, 2));
  const TYPE_TITLE = { identity: '身份', preference: '偏好', project: '项目', context: '背景', fact: '事实', summary: '摘要' };
  const order = ['identity', 'preference', 'project', 'context', 'fact', 'summary'];
  const lists = { identity: [], preference: [], project: [], context: [], fact: [], summary: [] };
  for (const m of active) (lists[m.type] || lists.fact).push(`- ${m.content}`);
  let md = `# MemLocal 记忆快照\n\n> ${new Date().toISOString()} · ${active.length} 条活跃记忆\n`;
  for (const t of order) if (lists[t].length) md += `\n## ${TYPE_TITLE[t]}\n` + lists[t].join('\n') + '\n';
  fs.writeFileSync(path.join(repo, 'memories.md'), md, 'utf8');
  fs.writeFileSync(path.join(repo, 'index.json'), JSON.stringify({ exportedAt: Date.now(), total: active.length, version: store.version }, null, 2));

  execSync('git add -A', { cwd: repo });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const out = execSync(`git commit -q -m "记忆快照 ${stamp}" --allow-empty && git rev-parse --short HEAD`, { cwd: repo, encoding: 'utf8' });
  return { repo, commit: out.trim(), total: active.length };
}

module.exports = { createBackup, listBackups, restoreBackup, exportAll, gitExport, backupsDir };
