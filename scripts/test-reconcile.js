'use strict';

/**
 * 确定性单测：LLM 对账引擎（无 LLM、无服务）
 * 运行：node scripts/test-reconcile.js
 */

const { reconcile, applyPlan } = require('../core/reconcile');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}

function baseStore() {
  const t0 = 1000, t1 = 2000;
  return {
    memories: [
      { id: 'old_meat', content: '用户爱吃牛排', type: 'preference', source: 'claude', createdAt: t0, updatedAt: t0, confidence: 0.7 },
      { id: 'loc_bj',   content: '用户住在北京', type: 'context',    source: 'manual', createdAt: t1, updatedAt: t1, confidence: 0.9 },
      { id: 'coffee',   content: '用户每天喝咖啡', type: 'fact',     source: 'chatgpt', createdAt: t1, updatedAt: t1, confidence: 0.75 },
    ],
  };
}

console.log('\n[1] 饮食矛盾：新「吃素」应替换旧「爱吃牛排」');
{
  const store = baseStore();
  const plan = reconcile(store, [{ content: '用户现在吃素了', source: 'manual', time: 5000 }], { now: 5000 });
  check('产生 1 个 add', plan.adds.length === 1);
  check('add 内容为吃素', plan.adds[0].content.includes('吃素'));
  check('删除旧牛排', plan.deletes.some(d => d.id === 'old_meat'));
  check('reason 为 replace', plan.reasons[0].action === 'replace');
  const applied = applyPlan(JSON.parse(JSON.stringify(store)), plan);
  check('应用后 store 含吃素不含牛排', applied.memories.some(m => m.content.includes('吃素')) && !applied.memories.some(m => m.content.includes('牛排')));
}

console.log('\n[2] 精确重复：应跳过不重复加');
{
  const store = baseStore();
  const plan = reconcile(store, [{ content: '用户住在北京', source: 'manual', time: 9000 }], { now: 9000 });
  check('无 add', plan.adds.length === 0);
  check('action 为 skip-exact', plan.reasons[0].action === 'skip-exact');
}

console.log('\n[3] 无冲突：应直接新增');
{
  const store = baseStore();
  const plan = reconcile(store, [{ content: '用户喜欢爬山', source: 'manual', time: 9000 }], { now: 9000 });
  check('add 1 条', plan.adds.length === 1);
  check('无删除', plan.deletes.length === 0);
}

console.log('\n[4] 工具偏好极性矛盾（共享关键词 cursor）');
{
  const store = { memories: [{ id: 'c1', content: '用户喜欢用 Cursor', type: 'preference', source: 'cursor', createdAt: 1000, updatedAt: 1000, confidence: 0.75 }] };
  const plan = reconcile(store, [{ content: '用户讨厌用 Cursor', source: 'manual', time: 9000 }], { now: 9000 });
  check('检测到矛盾并替换', plan.adds.length === 1 && plan.deletes.length === 1);
}

console.log('\n[5] 旧值不应覆盖新值（共享对象词 + 反转词）：应保留新的、拒绝旧的');
{
  const store = { memories: [{ id: 'new_fact', content: '用户现在喝咖啡', type: 'fact', source: 'manual', createdAt: 9000, updatedAt: 9000, confidence: 0.9 }] };
  const plan = reconcile(store, [{ content: '用户以前不喝咖啡', source: 'manual', time: 1000 }], { now: 9000 });
  check('无 add（拒绝旧值）', plan.adds.length === 0);
  check('无删除（保留新值）', plan.deletes.length === 0);
  check('进入 needsReview / keep-existing', plan.reasons[0].action === 'keep-existing' || plan.needsReview.length > 0);
}

console.log('\n[6] 低置信（generic + 高阈值）应进 needsReview');
{
  const store = { memories: [{ id: 'x', content: '用户爱吃牛排', type: 'preference', source: 'claude', createdAt: 1000, updatedAt: 1000, confidence: 0.7 }] };
  const plan = reconcile(store, [{ content: '用户现在吃素了', source: 'generic', time: 9000 }], { now: 9000, confidenceThreshold: 0.8 });
  check('add 被门控（无 add）', plan.adds.length === 0);
  check('进入 needsReview', plan.needsReview.length === 1);
}

console.log('\n[7] 状态反转更新（共享关键词 + 反转词）：咖啡→戒咖啡');
{
  const store = baseStore();
  const plan = reconcile(store, [{ content: '用户最近戒了咖啡', source: 'manual', time: 8000 }], { now: 8000 });
  check('替换旧咖啡记录', plan.deletes.some(d => d.id === 'coffee') && plan.adds.length === 1);
  check('relation 为 contradiction/update（均走替换）', ['contradiction', 'update'].includes(plan.reasons[0].relation));
}

console.log('\n[8] 主语不应造成误冲突：用户喜欢爬山 不应被 用户现在吃素了 删除');
{
  const store = { memories: [{ id: 'hike', content: '用户喜欢爬山', type: 'preference', source: 'manual', createdAt: 1000, updatedAt: 1000, confidence: 0.9 }] };
  const plan = reconcile(store, [{ content: '用户现在吃素了', source: 'manual', time: 9000 }], { now: 9000 });
  check('无删除（爬山保留）', plan.deletes.length === 0);
  check('吃素作为新增加入', plan.adds.length === 1);
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail === 0 ? 0 : 1);
