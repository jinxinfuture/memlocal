'use strict';

/**
 * MemLocal — 跨应用、本地优先、用户拥有的统一记忆层
 * 纯 Node 内置模块，无外部依赖。canonical store = 本地 JSON 文件。
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const STORE = path.join(DATA_DIR, 'store.json');
const EXPORTS_DIR = path.join(ROOT, 'exports');
const SAMPLES_DIR = path.join(ROOT, 'samples');
const PUBLIC_DIR = path.join(ROOT, 'public');
const WORKSPACE = '/Users/oh3r/maxapp';

const PORT = 4173;

// ---------------------------------------------------------------------------
// canonical store
// ---------------------------------------------------------------------------
function loadStore() {
  try {
    const raw = fs.readFileSync(STORE, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return { version: 1, memories: [], lastImport: null, lastSync: null, connections: {} };
  }
}
function saveStore(store) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STORE, JSON.stringify(store, null, 2), 'utf8');
}

// ---------------------------------------------------------------------------
// 适配器：每个 agent 一种。导入把其格式解析成事实；导出把 canonical 反生成。
// ---------------------------------------------------------------------------
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

// 轻量类型推断
function inferType(content) {
  const c = content.toLowerCase();
  if (/(喜欢|讨厌|偏好|不用|用 ?\w+? ?不用|爱用|拒绝|坚持|习惯|风格)/.test(c)) return 'preference';
  if (/(项目|在做|负责|产品|创业|公司|团队|客户)/.test(c)) return 'project';
  if (/(叫 ?\w+|名字|称呼|是 ?\w+ ?人|职业|角色)/.test(c)) return 'identity';
  if (/(住|城市|地点|中国|北京|上海|深圳|杭州|广州|成都|macos|windows|linux)/.test(c)) return 'context';
  return 'fact';
}

// 解析 markdown 风格记忆文件 -> 字符串数组（每条事实）
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

// 解析 ChatGPT 导出 memory.json -> 字符串数组
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
  if (platform === 'chatgpt') return parseChatGPT(text);
  return parseMarkdown(text);
}

// ---------------------------------------------------------------------------
// 扫描目录，找出各 agent 的记忆文件
// ---------------------------------------------------------------------------
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
        if (names.has(base)) {
          found.push({ platform, dir, file: path.join(dir, f), label: cfg.label });
        }
      }
      // cursor 规则目录 .cursor/rules/*.mdc
      if (platform === 'cursor' && cfg.files.includes('.cursor/rules')) {
        const rulesDir = path.join(dir, '.cursor', 'rules');
        try {
          const mdc = fs.readdirSync(rulesDir).filter(n => n.endsWith('.mdc'));
          for (const m of mdc) found.push({ platform, dir: rulesDir, file: path.join(rulesDir, m), label: cfg.label });
        } catch (e) {}
      }
    }
  }
  // 去重（同文件）
  const seen = new Set();
  return found.filter(f => { const k = f.file; if (seen.has(k)) return false; seen.add(k); return true; });
}

// ---------------------------------------------------------------------------
// 一键导入
// ---------------------------------------------------------------------------
function doImport() {
  const store = loadStore();
  const candidates = scanCandidates();
  const seen = new Map(); // normalizedKey -> memory
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
        content: fact,
        type: inferType(fact),
        source: c.platform,
        sourceFile: c.file,
        createdAt: Date.now(),
        updatedAt: Date.now(),
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

// ---------------------------------------------------------------------------
// 一键同步：从 canonical 反生成各 agent 记忆文件
// ---------------------------------------------------------------------------
function renderMarkdown(store, platform) {
  const headerMap = {
    claude: '# Project Memory (managed by MemLocal)\n\n',
    cursor: '# Cursor Rules (managed by MemLocal)\n\n',
    windsurf: '# Windsurf Rules (managed by MemLocal)\n\n',
    generic: '# Memory (managed by MemLocal)\n\n',
  };
  const lists = { preference: [], project: [], identity: [], context: [], fact: [] };
  for (const m of store.memories) {
    const arr = lists[m.type] || lists.fact;
    arr.push(`- ${m.content}`);
  }
  let out = headerMap[platform] || headerMap.generic;
  const order = ['identity', 'preference', 'project', 'context', 'fact'];
  for (const t of order) {
    if (lists[t].length) {
      const title = { preference: '## 偏好', project: '## 项目', identity: '## 身份', context: '## 背景', fact: '## 事实' }[t];
      out += `\n${title}\n` + lists[t].join('\n') + '\n';
    }
  }
  return out;
}

function renderChatGPT(store) {
  const memories = store.memories.map(m => ({ content: m.content, type: m.type }));
  return JSON.stringify({ memories }, null, 2);
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
    const content = t.platform === 'chatgpt' ? renderChatGPT(store) : renderMarkdown(store, t.platform);
    const fp = path.join(t.dir, t.filename);
    fs.writeFileSync(fp, content, 'utf8');
    written.push({ platform: t.platform, label: PLATFORMS[t.platform].label, file: fp, bytes: Buffer.byteLength(content) });
  }
  store.lastSync = Date.now();
  saveStore(store);
  return { written };
}

// ---------------------------------------------------------------------------
// HTTP 服务
// ---------------------------------------------------------------------------
function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { resolve({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  const p = u.pathname;

  // 静态首页
  if (p === '/' || p === '/index.html') {
    const fp = path.join(PUBLIC_DIR, 'index.html');
    fs.readFile(fp, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  if (p.startsWith('/api/')) {
    try {
      if (p === '/api/state' && req.method === 'GET') {
        const store = loadStore();
        const bySource = {};
        for (const m of store.memories) for (const s of m.source.split(',')) bySource[s] = (bySource[s] || 0) + 1;
        return sendJSON(res, 200, {
          memories: store.memories,
          connections: store.connections || {},
          stats: { total: store.memories.length, bySource, platforms: Object.keys(PLATFORMS) },
          lastImport: store.lastImport, lastSync: store.lastSync,
        });
      }
      if (p === '/api/import' && req.method === 'POST') {
        const r = doImport();
        return sendJSON(res, 200, r);
      }
      if (p === '/api/sync' && req.method === 'POST') {
        const r = doSync();
        return sendJSON(res, 200, r);
      }
      if (p === '/api/memory' && req.method === 'POST') {
        const body = await readBody(req);
        const content = (body.content || '').trim();
        if (!content) return sendJSON(res, 400, { error: 'empty' });
        const store = loadStore();
        const mem = {
          id: 'm_' + crypto.randomBytes(6).toString('hex'),
          content, type: inferType(content), source: 'manual',
          sourceFile: '', createdAt: Date.now(), updatedAt: Date.now(),
        };
        store.memories.push(mem);
        saveStore(store);
        return sendJSON(res, 200, { memory: mem });
      }
      if (p.startsWith('/api/memory/') && req.method === 'PUT') {
        const id = p.split('/').pop();
        const body = await readBody(req);
        const store = loadStore();
        const mem = store.memories.find(m => m.id === id);
        if (!mem) return sendJSON(res, 404, { error: 'not found' });
        if (body.content != null) mem.content = body.content.trim();
        if (body.type != null) mem.type = body.type;
        mem.updatedAt = Date.now();
        saveStore(store);
        return sendJSON(res, 200, { memory: mem });
      }
      if (p.startsWith('/api/memory/') && req.method === 'DELETE') {
        const id = p.split('/').pop();
        const store = loadStore();
        store.memories = store.memories.filter(m => m.id !== id);
        saveStore(store);
        return sendJSON(res, 200, { ok: true });
      }
      if (p.startsWith('/api/exports/') && req.method === 'GET') {
        const platform = p.split('/').pop();
        if (!PLATFORMS[platform]) return sendJSON(res, 404, { error: 'unknown' });
        const store = loadStore();
        const content = platform === 'chatgpt' ? renderChatGPT(store) : renderMarkdown(store, platform);
        return sendJSON(res, 200, { platform, content });
      }
      return sendJSON(res, 404, { error: 'not found' });
    } catch (e) {
      return sendJSON(res, 500, { error: String(e && e.message || e) });
    }
  }

  res.writeHead(404); res.end('not found');
});

server.listen(PORT, () => {
  console.log(`MemLocal running at http://localhost:${PORT}`);
});
