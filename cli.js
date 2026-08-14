#!/usr/bin/env node
'use strict';

/**
 * MemLocal CLI — 任何 code agent 一行命令同步记忆
 *
 * 用法见 FORMAT.md。所有子命令直接调用 core/*，不依赖 HTTP 服务。
 */

const store = require('./core/store');
const imp = require('./core/import');
const reconcile = require('./core/reconcile');
const retrieve = require('./core/retrieve');
const reflect = require('./core/reflect');
const writeback = require('./core/writeback');
const llmMod = require('./core/llm');
const extractMod = require('./core/extract');
const { renderFor } = require('./core/render');

function log(...a) { console.log(...a); }
function getArg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}
function hasFlag(name) { return process.argv.includes(name); }

async function main() {
  const cmd = process.argv[2];

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
      const r = writeback.applyWrites(store.loadStore(), { real, dryRun, platforms, cwd: process.cwd() });
      if (dryRun) {
        log('[dry-run] 将要写回：');
        for (const w of r.wouldWrite) log(`  ${w.real ? '[真实] ' : ''}${w.file} (${w.bytes}B)`);
      } else {
        log(`同步完成：written=${r.written.length}, backups=${r.backups.length}`);
        for (const w of r.written) log(`  ${w.real ? '[真实] ' : ''}${w.file} (${w.bytes}B)`);
      }
      return;
    }
    case 'export': {
      const platform = getArg('--platform') || 'generic';
      const s = store.loadStore();
      const content = renderFor(s, platform);
      log(content);
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
      const facts = await extractMod.extract(src, { extractor: llmExtractor || undefined });
      log(`抽取到 ${facts.length} 条事实：`);
      const changes = facts.map(f => ({ content: f.content, type: f.type, source: 'extract', time: Date.now() }));
      const s = store.loadStore();
      const plan = reconcile.reconcile(s, changes, { now: Date.now() });
      for (const f of facts) log(`  [${f.type}] ${f.content}`);
      if (plan.deletes.length) log(`  对账：替换 ${plan.deletes.length} 条旧记忆`);
      if (hasFlag('--apply')) {
        reconcile.applyPlan(s, plan);
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
      if (!content) { log('用法: node cli.js reconcile --content "..." [--apply] [--llm]'); return; }
      const apply = hasFlag('--apply');
      const changes = [{ content, source: 'manual', time: Date.now() }];
      const s = store.loadStore();
      if (hasFlag('--llm')) {
        const llmFn = llmMod.makeDeepSeekLLM({});
        if (!llmFn) { log('未配置 DEEPSEEK_API_KEY，回退确定性对账'); }
        const plan = await reconcile.reconcileAsync(s, changes, { llmAsync: llmFn || undefined });
        if (apply && llmFn) { reconcile.applyPlan(s, plan); store.saveStore(s); }
        log(JSON.stringify(plan, null, 2));
      } else {
        const plan = reconcile.reconcile(s, changes, { now: Date.now() });
        if (apply) { reconcile.applyPlan(s, plan); store.saveStore(s); }
        log(JSON.stringify(plan, null, 2));
      }
      return;
    }
    case 'reflect': {
      const apply = hasFlag('--apply');
      const plan = reflect.run(store.loadStore(), { apply, now: Date.now() });
      if (apply) store.saveStore(store.loadStore());
      log(`反思/压缩：归档 ${plan.archiveIds.length} 条，生成 ${plan.summaries.length} 条摘要`);
      for (const c of plan.clusters) log(`  簇「${c.topic}」(${c.ids.length} 条) -> ${c.summaryId}`);
      return;
    }
    case 'writeback': {
      const dryRun = hasFlag('--dry-run');
      const real = hasFlag('--real');
      const r = writeback.applyWrites(store.loadStore(), { real, dryRun });
      if (dryRun) {
        log('[dry-run] 将要写回：');
        for (const w of r.wouldWrite) log(`  ${w.real ? '[真实] ' : ''}${w.file} (${w.bytes}B)`);
      } else {
        log(`写回完成：written=${r.written.length}, backups=${r.backups.length}`);
        for (const w of r.written) log(`  ${w.real ? '[真实] ' : ''}${w.file} (${w.bytes}B)`);
      }
      return;
    }
    default:
      log('MemLocal CLI');
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
      log('  memlocal writeback [--dry-run] [--real]  写回（默认沙箱）');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
