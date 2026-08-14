'use strict';

/**
 * MemLocal — 导入侧适配器：把各 agent 原生记忆文件解析进 canonical store。
 *
 * 解析（parse*）+ 扫描（scanCandidates）+ 去重合并（runImport）三步。
 * 与 core/render.js 的「导出」对称：导入是读路径，导出是写路径。
 */

const fs = require('fs');
const path = require('path');
const { normalizeKey, inferType, newId } = require('./util');
const { PLATFORM_TARGETS } = require('./render');

const JSON_FORMATS = new Set(['chatgpt']);

// ---------------------------------------------------------------------------
// 解析
// ---------------------------------------------------------------------------
function parseMarkdown(text) {
  const out = [];
  const lines = (text || '').split(/\r?\n/);
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
  return JSON_FORMATS.has(platform) ? parseChatGPT(text) : parseMarkdown(text);
}

// ---------------------------------------------------------------------------
// 扫描：在给定目录里找出各 agent 的主记忆文件
// ---------------------------------------------------------------------------
function scanCandidates(opts = {}) {
  const bases = [];
  if (opts.cwd) bases.push(opts.cwd);
  if (opts.home) bases.push(opts.home);
  if (Array.isArray(opts.extraDirs)) bases.push(...opts.extraDirs);

  const found = [];
  for (const base of bases) {
    for (const [platform, cfg] of Object.entries(PLATFORM_TARGETS)) {
      // 1) 各 agent 真实存放位置（如 ~/.claude/CLAUDE.md、.cursor/rules 目录）
      for (const loc of (cfg.locations || [cfg.filename])) {
        const fp = path.join(base, loc);
        let stat = null;
        try { stat = fs.statSync(fp); } catch (e) { continue; }
        if (stat.isDirectory()) {
          let files = [];
          try { files = fs.readdirSync(fp).filter(n => n.endsWith('.mdc') || n.endsWith('.md')); } catch (e) {}
          for (const f of files) found.push({ platform, dir: fp, file: path.join(fp, f), label: cfg.label });
        } else if (stat.isFile()) {
          found.push({ platform, dir: base, file: fp, label: cfg.label });
        }
      }
      // 2) 嵌套子目录布局（如 samples/claude/CLAUDE.md、project/.claude/CLAUDE.md）
      const nested = path.join(base, cfg.dir, cfg.filename);
      if (nested !== path.join(base, cfg.filename)) {
        try { if (fs.statSync(nested).isFile()) found.push({ platform, dir: base, file: nested, label: cfg.label }); } catch (e) {}
      }
    }
  }
  const seen = new Set();
  return found.filter(f => { if (seen.has(f.file)) return false; seen.add(f.file); return true; });
}

// ---------------------------------------------------------------------------
// 去重合并进 store（不写盘，由调用方 save）
// ---------------------------------------------------------------------------
function runImport(store, dirs, opts = {}) {
  const candidates = scanCandidates(dirs);
  const seen = new Map();
  for (const m of store.memories) seen.set(normalizeKey(m.content), m);

  const summary = { imported: 0, skipped: 0, sources: {} };
  for (const c of candidates) {
    let text;
    try { text = fs.readFileSync(c.file, 'utf8'); } catch (e) { continue; }
    const facts = parsePlatform(c.platform, text);
    for (const fact of facts) {
      const key = normalizeKey(fact);
      if (seen.has(key)) { summary.skipped++; continue; }
      const mem = {
        id: newId(),
        content: fact,
        type: inferType(fact),
        source: c.platform,
        sourceFile: c.file,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        confidence: 0.75,
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
  return { summary, candidates };
}

module.exports = { parseMarkdown, parseChatGPT, parsePlatform, scanCandidates, runImport };
