'use strict';

/**
 * MemLocal — canonical store 读写（被 server.js / cli.js / import.js 共用）
 *
 * 默认位置：<memlocal>/data/store.json（项目内、本地优先、进 .gitignore）。
 * 记忆条目 schema：
 *   { id, content, type, source, sourceFile?, createdAt, updatedAt,
 *     confidence?, archived?, stale? }
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const STORE = path.join(DATA_DIR, 'store.json');

function emptyStore() {
  return { version: 1, memories: [], lastImport: null, lastSync: null, lastReflect: null, connections: {} };
}

function loadStore() {
  try {
    return JSON.parse(fs.readFileSync(STORE, 'utf8'));
  } catch (e) {
    return emptyStore();
  }
}

function saveStore(store) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STORE, JSON.stringify(store, null, 2), 'utf8');
  return store;
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

module.exports = { ROOT, DATA_DIR, STORE, loadStore, saveStore, emptyStore, newMemory };
