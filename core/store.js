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
  return { version: 1, memories: [], lastImport: null, lastSync: null, lastReflect: null, connections: {} };
}

function loadStore() {
  try {
    return JSON.parse(fs.readFileSync(storePath(), 'utf8'));
  } catch (e) {
    return emptyStore();
  }
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
  emptyStore, newMemory,
};
