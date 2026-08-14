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
      const r = imp.doSync();
      log('同步完成：');
      for (const w of r.written) log(`  ${w.label.padEnd(12)} -> ${w.file} (${w.bytes}B)`);
      return;
    }
    case 'export': {
      const platform = getArg('--platform') || 'generic';
      const s = store.loadStore();
      const content = renderFor(s, platform);
      log(content);
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
      log('  node cli.js serve                        启动 HTTP 服务 (:4173)');
      log('  node cli.js import                       扫描并导入各 agent 记忆到 store');
      log('  node cli.js sync                         从 store 同步到 exports/');
      log('  node cli.js export --platform <p>        打印某平台渲染结果');
      log('  node cli.js search "<q>" [--limit N]     检索打分排序');
      log('  node cli.js reconcile --content "..." [--apply] [--llm]  提交新事实并对账');
      log('  node cli.js reflect [--apply]            反思/压缩零散事实');
      log('  node cli.js writeback [--dry-run] [--real]  写回（默认沙箱）');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
