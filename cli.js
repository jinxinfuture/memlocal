#!/usr/bin/env node
'use strict';

/**
 * MemLocal CLI — 任何 code agent 一行命令同步记忆
 *
 * 用法见 FORMAT.md。所有子命令直接调用 core/*，不依赖 HTTP 服务。
 */

const store = require('./core/store');
const path = require('path');
const fs = require('fs');
const imp = require('./core/import');
const reconcile = require('./core/reconcile');
const retrieve = require('./core/retrieve');
const reflect = require('./core/reflect');
const writeback = require('./core/writeback');
const llmMod = require('./core/llm');
const extractMod = require('./core/extract');
const backupMod = require('./core/backup');
const { renderFor, PLATFORM_TARGETS, detectRealLocation } = require('./core/render');
const { addAudit } = store;

function log(...a) { console.log(...a); }
function getArg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}
function hasFlag(name) { return process.argv.includes(name); }

function printHelp() {
  log('MemLocal CLI v' + require('./package.json').version);
  log('  memlocal init                          初始化 ~/.memlocal（store + config）');
  log('  memlocal status                        查看统计、已支持平台、真实写回探测');
  log('  memlocal serve                        启动 HTTP 服务 (:4173)');
  log('  memlocal import                       扫描并导入各 agent 记忆到 store');
  log('  memlocal sync [--dry-run] [--real] [--platforms p1,p2]  同步（默认沙箱全部 9 平台；--real 自动探测真实路径+备份）');
  log('  memlocal extract --text "..." [--file F] [--llm] [--apply]  从文本抽取记忆并入 store');
  log('  memlocal export --platform <p>        打印某平台渲染结果');
  log('  memlocal search "<q>" [--limit N]     检索打分排序');
  log('  memlocal reconcile --content "..." [--apply] [--llm]  提交新事实并对账');
  log('  memlocal reflect [--apply]            反思/压缩零散事实');
  log('  memlocal config get|set <key> <value> 查看/设置配置（deepseek.apiKey / realTargets.*）');
  log('  memlocal audit [--limit N]            查看记忆操作审计日志');
  log('  memlocal backup                       创建备份（压缩到 ~/.memlocal/backups/）');
  log('  memlocal backups                      列出可用备份');
  log('  memlocal restore --file <备份>         从备份恢复（当前状态先另存安全备份）');
  log('  memlocal export-all                   导出记忆（合并 Markdown + 原始 JSON）');
  log('  memlocal watch [--interval N] [--real]  监听各 agent 记忆文件变化，自动导入+同步');
  log('  memlocal writeback [--dry-run] [--real]  写回（默认沙箱）');
  log('  memlocal --version / --help           版本 / 帮助');
  log('  memlocal doctor                       诊断：store/路径/备份/LLM/质量 健康检查');
}

async function main() {
  const cmd = process.argv[2];

  // --version / -v
  if (cmd === '--version' || cmd === '-v') {
    log(require('./package.json').version);
    return;
  }
  // --help / -h
  if (cmd === '--help' || cmd === '-h') {
    printHelp();
    return;
  }

  switch (cmd) {
    case 'init': {
      const s = store.loadStore();
      store.saveStore(s); // 确保目录与 store.json 存在
      const cfg = store.loadConfig();
      store.saveConfig(cfg); // 确保 config.json 存在
      log(`已初始化 ${store.storePath()}`);
      return;
    }
    case 'status': {
      const s = store.loadStore();
      const { PLATFORM_TARGETS } = require('./core/render');
      const cfg = store.loadConfig();
      log(`store: ${store.storePath()} (${s.memories.length} 条记忆)`);
      log(`平台支持: ${Object.keys(PLATFORM_TARGETS).join(', ')}`);
      log('真实写回目标:');
      for (const p of Object.keys(PLATFORM_TARGETS)) {
        const detected = require('./core/render').detectRealLocation(p, cfg, { cwd: process.cwd() });
        const explicit = cfg.realTargets && cfg.realTargets[p];
        if (explicit || detected) log(`  ${p.padEnd(10)} -> ${explicit ? '[config] ' : ''}${detected || '(未探测到)'}`);
      }
      return;
    }
    case 'serve': {
      require('./server.js');
      return;
    }
    case 'import': {
      const r = imp.doImport();
      log('导入完成：', JSON.stringify(r.summary));
      return;
    }
    case 'sync': {
      const dryRun = hasFlag('--dry-run');
      const real = hasFlag('--real');
      const platforms = getArg('--platforms') ? getArg('--platforms').split(',').map(s => s.trim()).filter(Boolean) : undefined;
      const s = store.loadStore();
      const r = writeback.applyWrites(s, { real, dryRun, platforms, cwd: process.cwd() });
      if (dryRun) {
        log('[dry-run] 将要写回：');
        for (const w of r.wouldWrite) log(`  ${w.real ? '[真实] ' : ''}${w.file} (${w.bytes}B)`);
      } else {
        if (r.written.length) {
          addAudit(s, { action: real ? 'sync-real' : 'sync', detail: `写回 ${r.written.length} 个平台${real ? '（真实路径）' : '（沙箱）'}，备份 ${r.backups.length}` });
          store.saveStore(s);
        }
        log(`同步完成：written=${r.written.length}, backups=${r.backups.length}`);
        for (const w of r.written) log(`  ${w.real ? '[真实] ' : ''}${w.file} (${w.bytes}B)`);
      }
      return;
    }
    case 'watch': {
      const interval = parseInt(getArg('--interval') || '10', 10) * 1000;
      const real = hasFlag('--real');
      log(`MemLocal watch 已启动（每 ${interval / 1000}s 检测一次，${real ? '真实写回' : '沙箱写回'}）。Ctrl+C 停止。`);
      let prev = imp.snapshotSignatures();
      const tick = async () => {
        const cur = imp.snapshotSignatures();
        const changed = Object.keys(cur).filter(f => {
          const p = prev[f];
          return !p || p.mtimeMs !== cur[f].mtimeMs || p.size !== cur[f].size;
        });
        const removed = Object.keys(prev).filter(f => !cur[f]);
        if (changed.length || removed.length) {
          log(`[${new Date().toLocaleTimeString()}] 检测到变化：新增/修改 ${changed.length} 个，移除 ${removed.length} 个`);
          for (const f of changed) log(`  ~ ${f}`);
          try {
            const r = imp.doImport();
            log(`  导入完成：新增 ${r.summary.imported} 条，跳过 ${r.summary.skipped} 条`);
            const w = writeback.applyWrites(store.loadStore(), { real, cwd: process.cwd() });
            log(`  同步完成：${w.written.length} 个文件${real ? '（真实）' : '（沙箱）'}`);
          } catch (e) {
            log('  同步出错：' + (e && e.message));
          }
          prev = imp.snapshotSignatures();
        }
      };
      setInterval(tick, interval);
      return;
    }
    case 'export': {
      const platform = getArg('--platform') || 'generic';
      const s = store.loadStore();
      const content = renderFor(s, platform);
      log(content);
      return;
    }
    case 'doctor': {
      const s = store.loadStore();
      const cfg = store.loadConfig();
      const results = [];
      const check = (name, ok, detail) => results.push({ name, ok, detail });

      // 1. store 健康
      check('store 可读且为 v' + s.version, !!s && Array.isArray(s.memories), `${(s.memories || []).length} 条记忆`);
      check('audit 日志', Array.isArray(s.audit) && s.audit.length > 0, `${(s.audit || []).length} 条记录`);

      // 2. 9 平台真实路径探测
      const detected = [];
      for (const p of Object.keys(PLATFORM_TARGETS)) {
        const fp = detectRealLocation(p, cfg, { cwd: process.cwd(), home: store.homeDir() });
        if (fp) detected.push({ p, fp });
      }
      check('真实写回路径探测', detected.length >= 3, `${detected.length}/9 平台探测到：${detected.slice(0, 3).map(d => d.p).join(', ')}${detected.length > 3 ? '...' : ''}`);

      // 3. 备份状态
      const bks = backupMod.listBackups();
      check('备份存在', bks.length > 0, `${bks.length} 个备份${bks[0] ? '（最新 ' + path.basename(bks[0].file) + '）' : ''}`);

      // 4. LLM 配置
      const hasLLM = !!(cfg.deepseek && cfg.deepseek.apiKey) || !!process.env.DEEPSEEK_API_KEY;
      check('LLM 配置', hasLLM, hasLLM ? '已配置（extract/reconcile --llm 可用）' : '未配置（确定性模式，--llm 自动回退）');

      // 5. 数据目录
      const home = store.homeDir();
      let size = 0;
      try {
        const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const fp = path.join(d, e.name); if (e.isDirectory()) walk(fp); else size += fs.statSync(fp).size; } };
        walk(home);
      } catch (e) {}
      check('数据目录', fs.existsSync(home), `${home}（${(size / 1024).toFixed(1)} kB）`);

      // 6. 记忆质量
      const mems = s.memories || [];
      const lowConf = mems.filter(m => (m.confidence || 0) < 0.6).length;
      const expired = mems.filter(m => m.expiresAt && m.expiresAt < Date.now()).length;
      check('记忆质量', lowConf === 0 && expired === 0, `低置信 ${lowConf} 条，已过期 ${expired} 条`);

      for (const r of results) {
        log(`  ${r.ok ? '✅' : '⚠️'} ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
      }
      const okCount = results.filter(r => r.ok).length;
      log(`\n诊断完成：${okCount}/${results.length} 项正常。${okCount === results.length ? '一切就绪！' : '详情见上（非致命项不影响使用）。'}`);
      return;
    }
    case 'config': {
      const action = process.argv[3]; // get | set
      if (action === 'set') {
        const key = process.argv[4];
        const value = process.argv[5];
        if (!key || value === undefined) { log('用法: memlocal config set <key> <value>（如 deepseek.apiKey sk-xxx、realTargets.claude ~/.claude/CLAUDE.md）'); return; }
        const s = store.loadConfig();
        const parts = key.split('.');
        let cur = s;
        for (let i = 0; i < parts.length - 1; i++) {
          if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
          cur = cur[parts[i]];
        }
        cur[parts[parts.length - 1]] = value;
        store.saveConfig(s);
        log(`已设置 ${key} = ${value}`);
        return;
      }
      if (action === 'get') {
        const key = process.argv[4];
        const s = store.loadConfig();
        if (!key) { log('当前配置：'); log(JSON.stringify(s, null, 2)); return; }
        const parts = key.split('.');
        let cur = s;
        for (const p of parts) { if (cur && typeof cur === 'object') cur = cur[p]; else { cur = undefined; break; } }
        log(key + ' = ' + (cur === undefined ? '(未设置)' : JSON.stringify(cur)));
        return;
      }
      log('用法: memlocal config get [key] | set <key> <value>');
      return;
    }
    case 'audit': {
      const s = store.loadStore();
      const limit = parseInt(getArg('--limit') || '20', 10);
      const rows = (s.audit || []).slice(-limit).reverse();
      if (!rows.length) { log('（暂无审计记录）'); return; }
      for (const r of rows) {
        log(`  ${new Date(r.at).toLocaleString()}  [${r.action}] ${r.detail}`);
      }
      return;
    }
    case 'backup': {
      const fp = backupMod.createBackup();
      const s = store.loadStore();
      addAudit(s, { action: 'backup', detail: `创建备份 ${path.basename(fp)}` });
      store.saveStore(s);
      log('备份已创建：' + fp);
      return;
    }
    case 'backups': {
      const list = backupMod.listBackups();
      if (!list.length) { log('（暂无备份）'); return; }
      log('可用备份：');
      for (const b of list) log(`  ${path.basename(b.file)}  ${(b.size / 1024).toFixed(1)}kB  ${new Date(b.time).toLocaleString()}`);
      return;
    }
    case 'restore': {
      const file = getArg('--file');
      const list = backupMod.listBackups();
      if (!file && list.length) {
        log('用法: memlocal restore --file <备份文件>');
        log('最近备份：');
        for (const b of list.slice(0, 5)) log(`  ${b.file}`);
        return;
      }
      const ok = backupMod.restoreBackup(file);
      log(ok ? '恢复完成（当前状态已另存为安全备份）。' : '恢复失败：文件不存在或格式非法。');
      return;
    }
    case 'export-all': {
      const r = backupMod.exportAll();
      log(`导出完成：${r.total} 条记忆`);
      log('  Markdown: ' + r.mdFile);
      log('  JSON:     ' + r.jsonFile);
      return;
    }
    case 'extract': {
      const text = getArg('--text') || process.argv[3] || '';
      const file = getArg('--file');
      let src = text;
      if (file) {
        try { src = require('fs').readFileSync(file, 'utf8'); }
        catch (e) { log('读取文件失败：' + e.message); return; }
      }
      if (!src || !src.trim()) { log('用法: memlocal extract --text "对话内容" [--file 文件] [--llm] [--apply]'); return; }
      const llmExtractor = llmMod.makeExtractor({});
      if (hasFlag('--llm') && !llmExtractor) log('（未配置 DEEPSEEK_API_KEY，使用确定性抽取）');
      const keepEvents = hasFlag('--events');
      const facts = await extractMod.extract(src, { extractor: llmExtractor || undefined, keepEvents });
      log(`抽取到 ${facts.length} 条事实：`);
      const ttl = extractMod.EVENT_TTL_MS;
      const changes = facts.map(f => {
        const ch = { content: f.content, type: f.type, source: 'extract', time: Date.now() };
        if (f.event) ch.expiresAt = Date.now() + ttl; // 事件记忆短 TTL
        return ch;
      });
      const s = store.loadStore();
      const plan = reconcile.reconcile(s, changes, { now: Date.now() });
      for (const f of facts) log(`  [${f.type}] ${f.content}`);
      if (plan.deletes.length) log(`  对账：替换 ${plan.deletes.length} 条旧记忆`);
      if (hasFlag('--apply')) {
        reconcile.applyPlan(s, plan);
        addAudit(s, { action: 'extract', detail: `从文本抽取 ${facts.length} 条（新增 ${plan.adds.length} / 替换 ${plan.deletes.length}）` });
        store.saveStore(s);
        log('已写入 store（--apply）。执行 memlocal sync 同步到各 agent。');
      } else {
        log('（未 --apply，仅预览。加 --apply 入库。）');
      }
      return;
    }
    case 'search': {
      const q = getArg('search') || process.argv[3] || '';
      const limit = parseInt(getArg('--limit') || '5', 10);
      const ranked = retrieve.search(store.loadStore(), q, { limit });
      log(`检索「${q}」top${ranked.length}:`);
      for (const r of ranked) log(`  [${r.score}] ${r.memory.content}  (rec=${r.breakdown.recency}, imp=${r.breakdown.importance}, rel=${r.breakdown.relevance})`);
      return;
    }
    case 'reconcile': {
      const content = getArg('--content') || process.argv[3];
      if (!content) { log('用法: memlocal reconcile --content "..." [--apply] [--llm]'); return; }
      const apply = hasFlag('--apply');
      const changes = [{ content, source: 'manual', time: Date.now() }];
      const s = store.loadStore();
      if (hasFlag('--llm')) {
        const llmFn = llmMod.makeDeepSeekLLM({});
        if (!llmFn) { log('未配置 DEEPSEEK_API_KEY（或 config deepseek.apiKey），回退确定性对账'); }
        const plan = await reconcile.reconcileAsync(s, changes, { llmAsync: llmFn || undefined });
        if (apply && llmFn) {
          reconcile.applyPlan(s, plan);
          addAudit(s, { action: 'reconcile-llm', detail: `LLM 对账「${content.slice(0, 40)}」：新增 ${plan.adds.length} / 替换 ${plan.deletes.length}` });
          store.saveStore(s);
        }
        log(`LLM 对账：add=${plan.adds.length}, delete=${plan.deletes.length}, needsReview=${plan.needsReview.length}`);
        for (const r of plan.reasons) log(`  ${r.action}: ${r.content.slice(0, 40)}${r.reason ? '（' + r.reason + '）' : ''}`);
        if (apply && llmFn) log('已应用（--apply）');
      } else {
        const plan = reconcile.reconcile(s, changes, { now: Date.now() });
        if (apply) {
          reconcile.applyPlan(s, plan);
          addAudit(s, { action: 'reconcile', detail: `对账「${content.slice(0, 40)}」：新增 ${plan.adds.length} / 替换 ${plan.deletes.length}` });
          store.saveStore(s);
        }
        log(`对账：add=${plan.adds.length}, delete=${plan.deletes.length}, needsReview=${plan.needsReview.length}`);
        for (const r of plan.reasons) log(`  ${r.action}: ${r.content.slice(0, 40)}${r.reason ? '（' + r.reason + '）' : ''}`);
        if (apply) log('已应用（--apply）');
      }
      return;
    }
    case 'reflect': {
      const apply = hasFlag('--apply');
      const s = store.loadStore();
      const plan = reflect.run(s, { apply, now: Date.now() });
      if (apply) {
        addAudit(s, { action: 'reflect', detail: `压缩归档 ${plan.archiveIds.length} 条，生成 ${plan.summaries.length} 条摘要` });
        store.saveStore(s);
      }
      log(`反思/压缩：归档 ${plan.archiveIds.length} 条，生成 ${plan.summaries.length} 条摘要`);
      for (const c of plan.clusters) log(`  簇「${c.topic}」(${c.ids.length} 条) -> ${c.summaryId}`);
      return;
    }
    case 'writeback': {
      const dryRun = hasFlag('--dry-run');
      const real = hasFlag('--real');
      const s = store.loadStore();
      const r = writeback.applyWrites(s, { real, dryRun, cwd: process.cwd() });
      if (dryRun) {
        log('[dry-run] 将要写回：');
        for (const w of r.wouldWrite) log(`  ${w.real ? '[真实] ' : ''}${w.file} (${w.bytes}B)`);
      } else {
        if (r.written.length) {
          addAudit(s, { action: real ? 'sync-real' : 'sync', detail: `写回 ${r.written.length} 个平台${real ? '（真实路径）' : '（沙箱）'}，备份 ${r.backups.length}` });
          store.saveStore(s);
        }
        log(`写回完成：written=${r.written.length}, backups=${r.backups.length}`);
        for (const w of r.written) log(`  ${w.real ? '[真实] ' : ''}${w.file} (${w.bytes}B)`);
      }
      return;
    }
    default:
      printHelp();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
