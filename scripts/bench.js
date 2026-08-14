'use strict';

/**
 * MemLocal — 性能基准（1000 条记忆）
 * 验证大规模场景下核心操作耗时：import / sync / search / reconcile / reflect
 * 运行：node scripts/bench.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { performance } = require('perf_hooks');

const N = parseInt(process.argv[3] || '1000', 10);

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-bench-'));
const oldHome = process.env.MEMLOCAL_HOME;
process.env.MEMLOCAL_HOME = home;

const storeMod = require('../core/store');
const reconcile = require('../core/reconcile');
const retrieve = require('../core/retrieve');
const reflect = require('../core/reflect');
const extract = require('../core/extract');
const { renderFor } = require('../core/render');
const writeback = require('../core/writeback');
const imp = require('../core/import');

// 生成 N 条多样化记忆
const TOPICS = ['咖啡', 'TypeScript', 'Rust', '爬山', '北京', 'Python', '跑步', '素食', 'Cursor', 'Vim', 'macOS', 'Linux', '产品', '创业', '学习', '摄影'];
const TYPES = ['preference', 'project', 'context', 'fact', 'identity'];
const mems = [];
for (let i = 0; i < N; i++) {
  mems.push({
    id: 'm_' + i,
    content: `用户${i % 2 ? '偏好' : '习惯'}使用 ${TOPICS[i % TOPICS.length]}（第 ${i} 条示例记忆，用于基准测试）`,
    type: TYPES[i % TYPES.length],
    source: ['claude', 'cursor', 'chatgpt', 'manual'][i % 4],
    createdAt: 1000 + i,
    updatedAt: 1000 + i,
    confidence: 0.5 + (i % 5) * 0.1,
  });
}
storeMod.saveStore({ version: 2, memories: mems, audit: [] });
console.log(`生成 ${N} 条记忆\n`);

function bench(name, fn) {
  const t0 = performance.now();
  const r = fn();
  const ms = (performance.now() - t0).toFixed(1);
  console.log(`  ${name.padEnd(28)} ${ms.padStart(8)} ms`);
  return r;
}

// 1. loadStore
const s = bench('loadStore', () => storeMod.loadStore());

// 2. sync 渲染 9 平台（沙箱）
bench('sync 渲染 9 平台（沙箱）', () => {
  const r = writeback.applyWrites(s, {});
  if (r.written.length !== 9) throw new Error('sync 平台数不对');
});

// 3. search（命中）
bench(`search "${TOPICS[0]}" top5`, () => retrieve.search(s, TOPICS[0], { limit: 5 }));

// 4. search（无命中）
bench('search 无命中词', () => retrieve.search(s, '量子物理', { limit: 5 }));

// 5. reconcile 新增 100 条不冲突事实
bench('reconcile 新增 100 条', () => {
  const changes = [];
  for (let i = 0; i < 100; i++) changes.push({ content: `用户第 ${N + i} 条全新记忆，主题是 ${TOPICS[i % TOPICS.length]} 的变体`, source: 'manual', time: Date.now() });
  return reconcile.reconcile(s, changes, { now: Date.now() });
});

// 6. reflect 压缩（聚类 N 条）
bench('reflect 压缩聚类', () => reflect.run(s, { apply: false }));

// 7. extract 从 1KB 文本抽取
bench('extract 1KB 文本', () => {
  const text = '我叫小王，住在杭州，负责数据产品。'.repeat(60);
  return extract.extractDeterministic(text);
});

// 8. detectRealLocation（9 平台）
bench('detectRealLocation 9 平台', () => {
  const { detectRealLocation } = require('../core/render');
  for (const p of ['claude','cursor','windsurf','chatgpt','generic','codex','gemini','aider','copilot']) detectRealLocation(p, {}, { cwd: os.tmpdir() });
});

// 9. saveStore
bench('saveStore', () => storeMod.saveStore(storeMod.loadStore()));

// 内存占用
const heap = process.memoryUsage();
console.log(`\n  堆内存: ${(heap.heapUsed / 1024 / 1024).toFixed(1)} MB / RSS: ${(heap.rss / 1024 / 1024).toFixed(1)} MB`);

fs.rmSync(home, { recursive: true, force: true });
process.env.MEMLOCAL_HOME = oldHome;
console.log('\n基准完成（规模 ' + N + ' 条）。');
