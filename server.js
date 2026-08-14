'use strict';

/**
 * MemLocal — 跨应用、本地优先、用户拥有的统一记忆层
 * 纯 Node 内置模块，无外部依赖。canonical store = 本地 JSON 文件。
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const reconcile = require('./core/reconcile');
const { PLATFORM_TARGETS, renderMarkdown, renderChatGPT, renderFor } = require('./core/render');
const { loadStore, saveStore, addAudit } = require('./core/store');
const imp = require('./core/import');
const PLATFORMS = imp.PLATFORMS;
const { normalizeKey, inferType, parsePlatform, scanCandidates, doImport, doSync } = imp;
const retrieve = require('./core/retrieve');
const reflect = require('./core/reflect');
const writeback = require('./core/writeback');
const llmMod = require('./core/llm');
const extractMod = require('./core/extract');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const EXPORTS_DIR = path.join(ROOT, 'exports');
const SAMPLES_DIR = path.join(ROOT, 'samples');
const PUBLIC_DIR = path.join(ROOT, 'public');

const PORT = 4173;

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
          lastImport: store.lastImport, lastSync: store.lastSync, lastReflect: store.lastReflect,
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
      if (p === '/api/extract' && req.method === 'POST') {
        const body = await readBody(req);
        const text = (body.text || '').trim();
        if (!text) return sendJSON(res, 400, { error: 'empty text' });
        const llmExtractor = body.llm ? llmMod.makeExtractor({}) : null;
        const facts = await extractMod.extract(text, { extractor: llmExtractor || undefined });
        const s = loadStore();
        const plan = reconcile.reconcile(s, facts.map(f => ({ content: f.content, type: f.type, source: 'extract', time: Date.now() })), { now: Date.now() });
        if (body.apply) {
          reconcile.applyPlan(s, plan);
          addAudit(s, { action: 'extract', detail: `从文本抽取 ${facts.length} 条（新增 ${plan.adds.length} / 替换 ${plan.deletes.length}）` });
          saveStore(s);
        }
        return sendJSON(res, 200, { facts, plan: { adds: plan.adds.length, deletes: plan.deletes.length, needsReview: plan.needsReview.length }, applied: !!body.apply });
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
        addAudit(store, { action: 'add', detail: `手动添加「${content.slice(0, 50)}」` });
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
        addAudit(store, { action: 'update', detail: `编辑记忆 ${id.slice(0, 12)}` });
        saveStore(store);
        return sendJSON(res, 200, { memory: mem });
      }
      if (p.startsWith('/api/memory/') && req.method === 'DELETE') {
        const id = p.split('/').pop();
        const store = loadStore();
        const mem = store.memories.find(m => m.id === id);
        store.memories = store.memories.filter(m => m.id !== id);
        addAudit(store, { action: 'delete', detail: mem ? `删除「${mem.content.slice(0, 50)}」` : `删除 ${id}` });
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
      if (p === '/api/reconcile' && req.method === 'POST') {
        const body = await readBody(req);
        const changes = Array.isArray(body.changes) ? body.changes : [];
        const apply = !!body.apply;
        const store = loadStore();
        const plan = reconcile.reconcile(store, changes, {
          now: Date.now(),
          confidenceThreshold: body.confidenceThreshold != null ? body.confidenceThreshold : 0.5,
        });
        if (apply) {
          reconcile.applyPlan(store, plan);
          addAudit(store, { action: 'reconcile', detail: `对账 ${changes.length} 条：新增 ${plan.adds.length} / 替换 ${plan.deletes.length} / 待审 ${plan.needsReview.length}` });
          saveStore(store);
        }
        return sendJSON(res, 200, { plan, applied: apply });
      }
      if (p === '/api/reconcile-async' && req.method === 'POST') {
        const body = await readBody(req);
        const changes = Array.isArray(body.changes) ? body.changes : [];
        const apply = !!body.apply;
        const llmFn = llmMod.makeDeepSeekLLM({});
        const plan = await reconcile.reconcileAsync(loadStore(), changes, {
          now: Date.now(),
          confidenceThreshold: body.confidenceThreshold != null ? body.confidenceThreshold : 0.5,
          llmAsync: llmFn || undefined,
        });
        if (apply && llmFn) {
          const store = loadStore();
          reconcile.applyPlan(store, plan);
          saveStore(store);
        }
        return sendJSON(res, 200, { plan, applied: apply && !!llmFn, llmEnabled: !!llmFn });
      }
      if (p === '/api/search' && req.method === 'GET') {
        const q = u.searchParams.get('q') || '';
        const limit = parseInt(u.searchParams.get('limit') || '10', 10);
        const ranked = retrieve.search(loadStore(), q, { limit });
        return sendJSON(res, 200, { query: q, results: ranked });
      }
      if (p === '/api/writeback' && req.method === 'POST') {
        const body = await readBody(req);
        const r = writeback.applyWrites(loadStore(), { real: !!body.real, dryRun: !!body.dryRun, platforms: body.platforms });
        return sendJSON(res, 200, r);
      }
      if (p === '/api/reflect' && req.method === 'POST') {
        const body = await readBody(req);
        const apply = !!body.apply;
        const store = loadStore();
        const plan = reflect.run(store, { apply, now: Date.now() });
        if (apply) {
          addAudit(store, { action: 'reflect', detail: `压缩归档 ${plan.archiveIds.length} 条，生成 ${plan.summaries.length} 条摘要` });
          saveStore(store);
        }
        return sendJSON(res, 200, { plan, applied: apply });
      }
      if (p === '/api/audit' && req.method === 'GET') {
        const store = loadStore();
        const limit = parseInt(u.searchParams.get('limit') || '20', 10);
        return sendJSON(res, 200, { audit: (store.audit || []).slice(-limit).reverse() });
      }
      return sendJSON(res, 404, { error: 'not found' });
    } catch (e) {
      return sendJSON(res, 500, { error: String((e && e.message) || e) });
    }
  }

  res.writeHead(404); res.end('not found');
});

module.exports = server;
server.listen(PORT, () => {
  console.log(`MemLocal running at http://localhost:${PORT}`);
});
