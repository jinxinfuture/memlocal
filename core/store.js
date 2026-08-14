'use strict';

/**
 * MemLocal — canonical store 读写（被 server.js / cli.js / import.js / writeback.js 共用）
 *
 * 数据位置（用户拥有、本地优先）：
 *   1) 环境变量 MEMLOCAL_HOME（便于 demo / 测试 / 自定义）
 *   2) 兼容旧布局：若 <包>/data/store.json 已存在，沿用项目内 data/（迁移平滑）
 *   3) 默认 ~/.memlocal/store.json（全局安装后记忆跟随用户，不写进只读安装目录）
 *
 * 记忆条目 schema：
 *   { id, content, type, source, sourceFile?, createdAt, updatedAt,
 *     confidence?, archived?, stale? }
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');

function homeDir() {
  if (process.env.MEMLOCAL_HOME) return process.env.MEMLOCAL_HOME;
  const legacy = path.join(ROOT, 'data');
  if (fs.existsSync(path.join(legacy, 'store.json'))) return legacy; // 迁移兼容
  return path.join(os.homedir(), '.memlocal');
}

function dataDir() { return homeDir(); }
function storePath() { return path.join(dataDir(), 'store.json'); }
function configPath() { return path.join(dataDir(), 'config.json'); }

function emptyStore() {
  return { version: 2, memories: [], lastImport: null, lastSync: null, lastReflect: null, connections: {}, audit: [] };
}

/**
 * 追加审计日志（最多保留 MAX_AUDIT 条，先进先出）
 * entry: { action, detail?, at? }
 */
const MAX_AUDIT = 200;
function addAudit(store, entry) {
  if (!store.audit) store.audit = [];
  store.audit.push({
    at: entry.at || Date.now(),
    action: entry.action || 'unknown',
    detail: entry.detail || '',
  });
  if (store.audit.length > MAX_AUDIT) store.audit = store.audit.slice(-MAX_AUDIT);
  return store;
}

/**
 * 加载 store（含 schema 校验与版本迁移，损坏时自动备份并重建）
 * - v1：memories 直接用；迁移到 v2 增加 audit 数组
 * - 结构非法（memories 非数组等）：备份为 store.json.corrupt-<ts> 后重建空 store
 */
function loadStore() {
  let raw = null;
  try {
    raw = JSON.parse(fs.readFileSync(storePath(), 'utf8'));
  } catch (e) {
    raw = null; // 不存在或损坏
  }
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.memories)) {
    // 损坏：备份后重建（避免用户记忆被静默清空；能救则救）
    try {
      const corrupt = fs.readFileSync(storePath(), 'utf8');
      if (corrupt && corrupt.trim()) {
        fs.writeFileSync(storePath() + '.corrupt-' + Date.now(), corrupt, 'utf8');
      }
    } catch (e) { /* 无原文件可备份 */ }
    return emptyStore();
  }
  // 版本迁移
  const v = raw.version || 1;
  if (v < 2) {
    raw.version = 2;
    if (!Array.isArray(raw.audit)) raw.audit = [];
  }
  // 逐条补默认字段，容忍旧数据缺字段 / 混入原始字符串
  raw.memories = raw.memories.map((m) => {
    if (!m || typeof m !== 'object') return newMemory(String(m || ''), { source: 'manual' });
    const base = newMemory(m.content, { source: m.source || 'manual' });
    return {
      ...base,
      id: m.id || base.id,
      content: String(m.content || '').trim(),
      type: m.type || 'fact',
      source: m.source || 'manual',
      sourceFile: m.sourceFile || '',
      createdAt: typeof m.createdAt === 'number' ? m.createdAt : base.createdAt,
      updatedAt: typeof m.updatedAt === 'number' ? m.updatedAt : (typeof m.createdAt === 'number' ? m.createdAt : base.updatedAt),
      confidence: typeof m.confidence === 'number' ? m.confidence : 0.7,
    };
  });
  return raw;
}

function saveStore(store) {
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(storePath(), JSON.stringify(store, null, 2), 'utf8');
  return store;
}

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8')) || {};
  } catch (e) {
    return {};
  }
}

function saveConfig(cfg) {
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2), 'utf8');
}

function newMemory(content, opts = {}) {
  const now = opts.now || Date.now();
  return {
    id: 'm_' + crypto.randomBytes(6).toString('hex'),
    content: content.trim(),
    type: opts.type || 'fact',
    source: opts.source || 'manual',
    sourceFile: opts.sourceFile || '',
    createdAt: now,
    updatedAt: now,
    confidence: opts.confidence != null ? opts.confidence : 0.7,
    archived: false,
  };
}

module.exports = {
  ROOT, DATA_DIR: dataDir(), STORE: storePath(),
  homeDir, storePath, configPath,
  loadStore, saveStore, loadConfig, saveConfig,
  emptyStore, newMemory, addAudit, MAX_AUDIT,
};
