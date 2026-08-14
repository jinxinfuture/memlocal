'use strict';

/**
 * MemLocal — 导入 / 同步逻辑（被 server.js 与 cli.js 共用）
 *
 * 唯一真相源：core/render.js 的 PLATFORM_TARGETS（9 平台）。
 * 解析/扫描能力吸收自早期 core/adapters.js（嵌套目录、.cursor/rules/*.mdc、runImport 不写盘）。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { loadStore, saveStore, addAudit } = require('./store');
const { renderFor } = require('./render');
const { PLATFORM_TARGETS } = require('./render');
const { normalizeKey, inferType, newId } = require('./util');

const ROOT = path.join(__dirname, '..');
const EXPORTS_DIR = path.join(ROOT, 'exports');
const SAMPLES_DIR = path.join(ROOT, 'samples');

// 平台注册表唯一真相源：render.js 的 PLATFORM_TARGETS（9 平台）
// PLATFORMS 保持导出以兼容 server.js（files = locations 相对路径，供导入扫描）
const PLATFORMS = Object.fromEntries(
  Object.entries(PLATFORM_TARGETS).map(([k, v]) => [k, { label: v.label, files: v.locations }])
);

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

// .cursor/rules/*.mdc：剥离 YAML frontmatter（description/globs/alwaysApply）再按 Markdown 解析
function parseMdc(text) {
  const m = String(text || '').match(/^\s*---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (m) {
    const meta = {};
    for (const line of m[1].split(/\r?\n/)) {
      const kv = line.match(/^([\w-]+)\s*:\s*(.*)$/);
      if (kv) meta[kv[1].trim()] = kv[2].trim().replace(/^["']|["']$/g, '');
    }
    const body = parseMarkdown(m[2]);
    // frontmatter 里的描述也可能是记忆（如 "用户偏好 X"）
    if (meta.description && meta.description.length >= 2) body.unshift(meta.description);
    return body;
  }
  return parseMarkdown(text);
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

function parsePlatform(platform, text, file) {
  if (JSON_FORMATS.has(platform)) return parseChatGPT(text);
  if (file && file.endsWith('.mdc')) return parseMdc(text);
  return parseMarkdown(text);
}

// ---------------------------------------------------------------------------
// 扫描：cwd + 用户主目录 + 额外目录 + 样例，覆盖嵌套布局与 .cursor/rules/*.mdc
// ---------------------------------------------------------------------------
function scanCandidates(opts = {}) {
  const bases = [];
  if (opts.cwd) bases.push(opts.cwd);
  if (opts.home) bases.push(opts.home);
  if (Array.isArray(opts.extraDirs)) bases.push(...opts.extraDirs);
  if (!opts.cwd && !opts.home && !opts.extraDirs) {
    bases.push(process.cwd(), os.homedir());
  }
  if (fs.existsSync(SAMPLES_DIR)) bases.push(SAMPLES_DIR);

  const found = [];
  for (const base of bases) {
    for (const [platform, cfg] of Object.entries(PLATFORM_TARGETS)) {
      // 1) locations 相对路径（文件或目录，如 .cursor/rules 目录下的 .mdc/.md）
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
      // 2) 嵌套子目录布局（samples/<platform>/<file>、project/.claude/CLAUDE.md）
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
// 去重合并进 store（不写盘，由调用方 save；opts.audit 回调可记录审计）
// ---------------------------------------------------------------------------
function runImport(store, dirs, opts = {}) {
  const candidates = scanCandidates(dirs || {});
  const seen = new Map();
  for (const m of store.memories) seen.set(normalizeKey(m.content), m);

  const summary = { imported: 0, updated: 0, skipped: 0, sources: {} };
  for (const c of candidates) {
    let text;
    try { text = fs.readFileSync(c.file, 'utf8'); } catch (e) { continue; }
    const facts = parsePlatform(c.platform, text, c.file);
    for (const fact of facts) {
      const key = normalizeKey(fact);
      if (seen.has(key)) {
        const exist = seen.get(key);
        if (!exist.source.includes(c.platform)) { exist.source = exist.source + ',' + c.platform; summary.updated++; }
        summary.skipped++;
        continue;
      }
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
  if (opts.audit) opts.audit({ action: 'import', detail: summary, files: candidates.length });
  return { summary, candidates };
}

function doImport(opts = {}) {
  const store = loadStore();
  const r = runImport(store, opts);
  addAudit(store, { action: 'import', detail: `新增 ${r.summary.imported} 条 / 更新来源 ${r.summary.updated} 条 / 跳过 ${r.summary.skipped} 条 / 命中 ${r.candidates.length} 个文件` });
  saveStore(store);
  return { summary: r.summary, candidates: r.candidates.map(c => ({ platform: c.platform, label: c.label, file: c.file })) };
}

function doSync(opts = {}) {
  const store = loadStore();
  const written = [];
  for (const [platform, t] of Object.entries(PLATFORM_TARGETS)) {
    const dir = path.join(EXPORTS_DIR, t.dir);
    fs.mkdirSync(dir, { recursive: true });
    const content = renderFor(store, platform);
    const fp = path.join(dir, t.filename);
    fs.writeFileSync(fp, content, 'utf8');
    written.push({ platform, label: t.label, file: fp, bytes: Buffer.byteLength(content) });
  }
  store.lastSync = Date.now();
  addAudit(store, { action: 'sync', detail: `写回 ${written.length} 个平台到沙箱 exports/` });
  saveStore(store);
  return { written };
}

module.exports = { PLATFORMS, normalizeKey, inferType, parseMarkdown, parseMdc, parseChatGPT, parsePlatform, scanCandidates, runImport, doImport, doSync };
