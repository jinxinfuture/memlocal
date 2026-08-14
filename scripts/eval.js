'use strict';

/**
 * MemLocal — 轻量评测（LOCOMO 思路）
 * 量化核心能力：矛盾消解 / 更新检测 / 无冲突新增 / 实体切换 / 时间推理 / 检索排序 / 反思压缩 / 抽取 / store 迁移。
 * 纯确定性，不依赖网络；`node scripts/eval.js` 输出通过率。
 */

const reconcile = require('../core/reconcile');
const retrieve = require('../core/retrieve');
const reflect = require('../core/reflect');
const extract = require('../core/extract');
const fs = require('fs');
const os = require('os');
const path = require('path');

const N = (id, content, over = {}) => ({ id, content, type: 'fact', source: 'manual', createdAt: 1, updatedAt: 1, confidence: 0.9, ...over });

const CASES = [];
function test(name, fn) { CASES.push({ name, fn }); }

// 1. 矛盾：牛排 <-> 素
test('矛盾消解(牛排->素)', () => {
  const store = { version: 1, memories: [N('a', '用户爱吃牛排')], lastImport: null, lastSync: null, connections: {} };
  const plan = reconcile.reconcile(store, [{ content: '用户现在吃素了', source: 'manual', time: 2 }], { now: 2 });
  return { pass: plan.deletes.some(d => d.id === 'a') && plan.adds.length === 1, detail: `dels=${plan.deletes.length}, adds=${plan.adds.length}` };
});

// 2. 更新：喝咖啡 -> 戒咖啡
test('更新检测(咖啡->戒)', () => {
  const store = { version: 1, memories: [N('a', '每天喝咖啡')], lastImport: null, lastSync: null, connections: {} };
  const plan = reconcile.reconcile(store, [{ content: '最近戒了咖啡', source: 'manual', time: 2 }], { now: 2 });
  return { pass: plan.deletes.some(d => d.id === 'a') && plan.reasons[0].relation === 'update', detail: `relation=${plan.reasons[0].relation}` };
});

// 3. 无冲突新增
test('无冲突新增', () => {
  const store = { version: 1, memories: [N('a', '用户爱吃牛排')], lastImport: null, lastSync: null, connections: {} };
  const plan = reconcile.reconcile(store, [{ content: '用户喜欢爬山', source: 'manual', time: 2 }], { now: 2 });
  return { pass: plan.adds.length === 1 && plan.deletes.length === 0, detail: `adds=${plan.adds.length}, dels=${plan.deletes.length}` };
});

// 4. 实体切换：Vim -> Cursor（同槽位不同取值）
test('实体切换(Vim->Cursor)', () => {
  const store = { version: 1, memories: [N('a', '用户用 Vim')], lastImport: null, lastSync: null, connections: {} };
  const plan = reconcile.reconcile(store, [{ content: '用户现在用 Cursor', source: 'manual', time: 2 }], { now: 2 });
  return { pass: plan.deletes.some(d => d.id === 'a') && plan.reasons[0].relation === 'update', detail: `relation=${plan.reasons[0].relation}` };
});

// 5. 时间推理：旧值不覆盖新值（冲突但 incoming 更旧 => 保留 existing）
test('时间推理(旧值被拒)', () => {
  const store = { version: 1, memories: [N('a', '用户现在用 Cursor', { updatedAt: 9000 })], lastImport: null, lastSync: null, connections: {} };
  const plan = reconcile.reconcile(store, [{ content: '用户以前用 Vim', source: 'manual', time: 1000 }], { now: 9000 });
  return { pass: plan.adds.length === 0 && plan.reasons[0].action === 'keep-existing', detail: `action=${plan.reasons[0].action}` };
});

// 6. 主语不误判：用户吃素 不应删 用户喜欢爬山
test('主语不误冲突', () => {
  const store = { version: 1, memories: [N('a', '用户喜欢爬山')], lastImport: null, lastSync: null, connections: {} };
  const plan = reconcile.reconcile(store, [{ content: '用户现在吃素了', source: 'manual', time: 2 }], { now: 2 });
  return { pass: !plan.deletes.some(d => d.id === 'a') && plan.adds.length === 1, detail: `dels=${plan.deletes.length}, adds=${plan.adds.length}` };
});

// 7. 检索排序：咖啡查询应把咖啡记忆排在最前
test('检索排序(咖啡优先)', () => {
  const store = { version: 1, memories: [
    N('a', '用户每天喝咖啡', { type: 'preference' }),
    N('b', '用户喜欢爬山', { type: 'preference' }),
    N('c', '项目用 TypeScript', { type: 'project' }),
  ], lastImport: null, lastSync: null, connections: {} };
  const ranked = retrieve.search(store, '咖啡', { limit: 3 });
  return { pass: ranked.length > 0 && ranked[0].memory.id === 'a', detail: `top=${ranked[0] && ranked[0].memory.id}` };
});

// 8. 反思压缩：3 条咖啡相关 -> 1 条摘要 + 归档
test('反思压缩(同簇归档)', () => {
  const store = { version: 1, memories: [
    N('a', '用户每天喝咖啡'), N('b', '用户戒了咖啡'), N('c', '用户偏爱美式咖啡'),
  ], lastImport: null, lastSync: null, connections: {} };
  const plan = reflect.run(store, { apply: false });
  return { pass: plan.archiveIds.length >= 3 && plan.summaries.length >= 1, detail: `archive=${plan.archiveIds.length}, summary=${plan.summaries.length}` };
});

// 9. 抽取：从对话抽出持久事实，过滤提问/日程/语气词
test('抽取(对话->事实)', () => {
  const text = '我叫小王，负责记忆层。我们下周发版。你帮我看看这个 bug。嗯好的。我讨厌香菜。';
  const facts = extract.extractDeterministic(text);
  const contents = facts.map(f => f.content).join('|');
  return { pass: contents.includes('小王') && contents.includes('记忆层') && contents.includes('香菜')
    && !contents.includes('发版') && !contents.includes('bug') && !contents.includes('好的'),
    detail: `facts=${facts.length}: ${contents.slice(0, 60)}` };
});

// 10. 抽取：临时日程（明天开会）不进记忆
test('抽取(临时日程过滤)', () => {
  const facts = extract.extractDeterministic('用户明天要开会。用户喜欢 Rust。');
  return { pass: facts.length === 1 && facts[0].content.includes('Rust'), detail: `facts=${JSON.stringify(facts.map(f => f.content))}` };
});

// 11. store 迁移：v1 -> v2 补 audit 且不丢记忆
test('store 迁移(v1->v2)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-eval-'));
  const oldHome = process.env.MEMLOCAL_HOME;
  process.env.MEMLOCAL_HOME = tmp;
  try {
    const storeMod = require('../core/store');
    fs.writeFileSync(storeMod.storePath(), JSON.stringify({ version: 1, memories: [{ id: 'a', content: '用户吃素' }] }));
    const s = storeMod.loadStore();
    return { pass: s.version === 2 && Array.isArray(s.audit) && s.memories.length === 1, detail: `v=${s.version}, mem=${s.memories.length}` };
  } finally {
    process.env.MEMLOCAL_HOME = oldHome;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// 12. cursor .mdc 渲染：带 YAML frontmatter
test('cursor mdc 渲染(frontmatter)', () => {
  const { renderMdc } = require('../core/render');
  const store = { memories: [N('a', '用户偏好用 TypeScript', { type: 'preference' })] };
  const out = renderMdc(store, { name: 'x', globs: '**/*.ts' });
  return { pass: out.startsWith('---\n') && out.includes('globs:') && out.includes('TypeScript'), detail: out.split('\n').slice(0, 5).join('|') };
});

// 13. watch 签名：snapshotSignatures 能检测文件变化
test('watch 签名检测变化', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-eval-watch-'));
  const fp = path.join(tmp, 'CLAUDE.md');
  fs.writeFileSync(fp, '- a\n');
  const oldHome = process.env.MEMLOCAL_HOME;
  process.env.MEMLOCAL_HOME = tmp;
  try {
    const imp = require('../core/import');
    const sig1 = imp.snapshotSignatures({ cwd: tmp, home: tmp });
    const key = Object.keys(sig1).find(k => k.endsWith('CLAUDE.md'));
    fs.writeFileSync(fp, '- a\n- b\n');
    const sig2 = imp.snapshotSignatures({ cwd: tmp, home: tmp });
    const changed = key && sig2[key] && (sig1[key].mtimeMs !== sig2[key].mtimeMs || sig1[key].size !== sig2[key].size);
    return { pass: !!changed, detail: `key=${!!key}, size1=${key ? sig1[key].size : '-'}, size2=${key ? sig2[key].size : '-'}` };
  } finally {
    process.env.MEMLOCAL_HOME = oldHome;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// 运行
let pass = 0;
for (const c of CASES) {
  let out;
  try { out = c.fn(); } catch (e) { out = { pass: false, detail: 'ERR ' + (e && e.message) }; }
  if (out.pass) pass++;
  console.log(`${out.pass ? '✅' : '❌'} ${c.name}  ${out.detail || ''}`);
}
console.log(`\n通过率：${pass}/${CASES.length} (${Math.round(pass / CASES.length * 100)}%)`);
process.exit(pass === CASES.length ? 0 : 1);
