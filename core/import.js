'use strict';

/**
 * MemLocal — 导入 / 同步逻辑（被 server.js 与 cli.js 共用）
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadStore, saveStore } = require('./store');
const { renderFor } = require('./render');

const ROOT = path.join(__dirname, '..');
const EXPORTS_DIR = path.join(ROOT, 'exports');
const SAMPLES_DIR = path.join(ROOT, 'samples');
const WORKSPACE = '/Users/oh3r/maxapp';

const PLATFORMS = {
  claude:   { label: 'Claude Code', files: ['CLAUDE.md', 'AGENTS.md'] },
  cursor:   { label: 'Cursor',      files: ['.cursorrules', '.cursor/rules'] },
  windsurf: { label: 'Windsurf',    files: ['.windsurfrules'] },
  chatgpt:  { label: 'ChatGPT',     files: ['memory.json'] },
  generic:  { label: '通用 Markdown', files: ['MEMORY.md', 'memory.md'] },
};

function normalizeKey(s) {
  return s.toLowerCase().replace(/[\s.,，。！!?？、;；:：'"'\"()（）\[\]【】\-_/\\]/g, '').trim();
}

function inferType(content) {
  const c = content.toLowerCase();
  if (/(喜欢|讨厌|偏好|不用|用 ?\w+? ?不用|爱用|拒绝|坚持|习惯|风格)/.test(c)) return 'preference';
  if (/(项目|在做|负责|产品|创业|公司|团队|客户)/.test(c)) return 'project';
  if (/(叫 ?\w+|名字|称呼|是 ?\w+ ?人|职业|角色)/.test(c)) return 'identity';
  if (/(住|城市|地点|中国|北京|上海|深圳|杭州|广州|成都|macos|windows|linux)/.test(c)) return 'context';
  return 'fact';
}

function parseMarkdown(text) {
  const out = [];
  const lines = text.split(/\r?\n/);
  let section = '';
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    const h = t.match(/^#{1,6}\s+(.*)$/);
    if (h) { section = h[1].trim(); continue; }
    const bullet = t.replace(/^[-*+]\s+/, '').replace(/^\d+\.\s+/, '').trim();
    if (!bullet) continue;
    const clean = section ? `${section}：${bullet}` : bullet;
    if (clean.length >= 2) out.push(clean);
  }
  return out;
}

function parseChatGPT(text) {
  const out = [];
  let data;
  try { data = JSON.parse(text); } catch (e) { return out; }
  const arr = data.memories || data.memory || (Array.isArray(data) ? data : null);
  if (Array.isArray(arr)) {
    for (const m of arr) {
      const c = typeof m === 'string' ? m : (m && (m.content || m.text));
      if (c && c.trim().length >= 2) out.push(c.trim());
    }
  }
  return out;
}

function parsePlatform(platform, text) {
  return platform === 'chatgpt' ? parseChatGPT(text) : parseMarkdown(text);
}

function scanCandidates() {
  const dirs = [
    path.join(SAMPLES_DIR, 'claude'),
    path.join(SAMPLES_DIR, 'cursor'),
    path.join(SAMPLES_DIR, 'windsurf'),
    path.join(SAMPLES_DIR, 'chatgpt'),
    path.join(SAMPLES_DIR, 'generic'),
    WORKSPACE,
  ];
  const found = [];
  for (const dir of dirs) {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { continue; }
    const names = new Set(entries.filter(e => e.isFile()).map(e => e.name));
    for (const [platform, cfg] of Object.entries(PLATFORMS)) {
      for (const f of cfg.files) {
        const base = path.basename(f);
        if (names.has(base)) found.push({ platform, dir, file: path.join(dir, f), label: cfg.label });
      }
      if (platform === 'cursor' && cfg.files.includes('.cursor/rules')) {
        const rulesDir = path.join(dir, '.cursor', 'rules');
        try {
          const mdc = fs.readdirSync(rulesDir).filter(n => n.endsWith('.mdc'));
          for (const m of mdc) found.push({ platform, dir: rulesDir, file: path.join(rulesDir, m), label: cfg.label });
        } catch (e) {}
      }
    }
  }
  const seen = new Set();
  return found.filter(f => { const k = f.file; if (seen.has(k)) return false; seen.add(k); return true; });
}

function doImport() {
  const store = loadStore();
  const candidates = scanCandidates();
  const seen = new Map();
  for (const m of store.memories) seen.set(normalizeKey(m.content), m);

  const summary = { imported: 0, updated: 0, skipped: 0, sources: {} };
  for (const c of candidates) {
    let text;
    try { text = fs.readFileSync(c.file, 'utf8'); } catch (e) { continue; }
    const facts = parsePlatform(c.platform, text);
    for (const fact of facts) {
      const key = normalizeKey(fact);
      if (seen.has(key)) {
        const exist = seen.get(key);
        if (!exist.source.includes(c.platform)) exist.source = exist.source + ',' + c.platform;
        summary.skipped++;
        continue;
      }
      const mem = {
        id: 'm_' + crypto.randomBytes(6).toString('hex'),
        content: fact, type: inferType(fact), source: c.platform,
        sourceFile: c.file, createdAt: Date.now(), updatedAt: Date.now(),
      };
      store.memories.push(mem);
      seen.set(key, mem);
      summary.imported++;
    }
    summary.sources[c.platform] = (summary.sources[c.platform] || 0) + facts.length;
  }
  store.lastImport = Date.now();
  store.connections = {};
  for (const c of candidates) store.connections[c.platform] = { label: c.label, file: c.file, ok: true };
  saveStore(store);
  return { summary, candidates: candidates.map(c => ({ platform: c.platform, label: c.label, file: c.file })) };
}

function doSync() {
  const store = loadStore();
  const targets = [
    { platform: 'claude', filename: 'CLAUDE.md', dir: path.join(EXPORTS_DIR, 'claude') },
    { platform: 'cursor', filename: '.cursorrules', dir: path.join(EXPORTS_DIR, 'cursor') },
    { platform: 'windsurf', filename: '.windsurfrules', dir: path.join(EXPORTS_DIR, 'windsurf') },
    { platform: 'chatgpt', filename: 'memory.json', dir: path.join(EXPORTS_DIR, 'chatgpt') },
    { platform: 'generic', filename: 'MEMORY.md', dir: path.join(EXPORTS_DIR, 'generic') },
  ];
  const written = [];
  for (const t of targets) {
    fs.mkdirSync(t.dir, { recursive: true });
    const content = renderFor(store, t.platform);
    const fp = path.join(t.dir, t.filename);
    fs.writeFileSync(fp, content, 'utf8');
    written.push({ platform: t.platform, label: PLATFORMS[t.platform].label, file: fp, bytes: Buffer.byteLength(content) });
  }
  store.lastSync = Date.now();
  saveStore(store);
  return { written };
}

module.exports = { PLATFORMS, normalizeKey, inferType, parseMarkdown, parseChatGPT, parsePlatform, scanCandidates, doImport, doSync };
