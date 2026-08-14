'use strict';

/**
 * MemLocal — 轻量评测（LOCOMO 思路）
 * 量化核心能力：矛盾消解 / 更新检测 / 无冲突新增 / 实体切换 / 时间推理 / 检索排序 / 反思压缩。
 * 纯确定性，不依赖网络；`node scripts/eval.js` 输出通过率。
 */

const reconcile = require('../core/reconcile');
const retrieve = require('../core/retrieve');
const reflect = require('../core/reflect');

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
