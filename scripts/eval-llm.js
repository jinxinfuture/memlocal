'use strict';

/**
 * MemLocal — 真实 LLM 评测（可选运行）
 *
 * 若配置了 DEEPSEEK_API_KEY，则真实调用 LLM 评测：
 *   1) extract --llm 的抽取质量（是否比确定性抽取更准）
 *   2) reconcile --llm 的矛盾决策质量（对账是否更聪明）
 * 未配置 key 时输出 SKIP 并正常退出（不破坏 CI）。
 *
 * 运行：DEEPSEEK_API_KEY=xxx node scripts/eval-llm.js
 * 结果会打印到控制台；可重定向到 docs/llm-eval.md。
 */

const llmMod = require('../core/llm');
const extractMod = require('../core/extract');
const reconcile = require('../core/reconcile');

const EXTRACT_CASES = [
  '我叫小李，住在杭州，负责数据产品。我们团队下周发版。你帮我看下这个页面。我讨厌香菜。',
  '用户偏好用 Rust 写后端，最近在学分布式系统。明天早上开会讨论架构。',
  '我计划下个月搬去深圳，喜欢徒步和摄影。帮我订下周六的机票。',
];

const RECONCILE_CASES = [
  { existing: '用户爱吃牛排', incoming: '用户现在吃素了' },
  { existing: '用户每天喝咖啡', incoming: '用户最近戒了咖啡' },
  { existing: '用户用 Vim', incoming: '用户现在用 Cursor' },
  { existing: '用户喜欢爬山', incoming: '用户现在吃素了' }, // 不应冲突
];

async function main() {
  if (!process.env.DEEPSEEK_API_KEY) {
    console.log('SKIP：未配置 DEEPSEEK_API_KEY，跳过真实 LLM 评测（不视为失败）');
    process.exit(0);
  }

  const extractor = llmMod.makeExtractor({});
  const decider = llmMod.makeDeepSeekLLM({});

  console.log('# MemLocal LLM 评测\n');

  // ---- extract ----
  console.log('## 1. extract --llm 抽取质量\n');
  let extractGood = 0;
  for (const text of EXTRACT_CASES) {
    const llmFacts = extractor ? await extractMod.extract(text, { extractor }) : [];
    const detFacts = extractMod.extractDeterministic(text);
    const llmStr = llmFacts.map(f => f.content).join(' | ');
    const detStr = detFacts.map(f => f.content).join(' | ');
    // 简单启发式：LLM 应抽出更多有效事实（如"讨厌香菜"/"搬去深圳"），且不抽提问/日程
    const llmHasKey = /香菜|深圳|Rust|分布式|徒步|摄影|数据产品/.test(llmStr);
    const detHasKey = /香菜|深圳|Rust|分布式|徒步|摄影|数据产品/.test(detStr);
    const llmNoNoise = !/帮我|机票|发版/.test(llmStr);
    const detNoise = /帮我|机票|发版/.test(detStr);
    const llmGood = llmHasKey && llmNoise;
    const detGood = detHasKey && !detNoise;
    if (llmGood) extractGood++;
    console.log(`- 输入：${text.slice(0, 30)}...`);
    console.log(`  - LLM: ${llmStr || '(空)'} ${llmGood ? '✅' : '⚠️'}`);
    console.log(`  - 确定: ${detStr || '(空)'} ${detGood ? '✅' : '⚠️'}`);
  }
  console.log(`\nLLM 抽取通过 ${extractGood}/${EXTRACT_CASES.length}\n`);

  // ---- reconcile ----
  console.log('## 2. reconcile --llm 矛盾决策\n');
  let recGood = 0;
  for (const c of RECONCILE_CASES) {
    const store = { memories: [{ id: 'e', content: c.existing, source: 'manual', createdAt: 1, updatedAt: 1, confidence: 0.9 }] };
    const plan = await reconcile.reconcileAsync(store, [{ content: c.incoming, source: 'manual', time: 2 }], { now: 2, llmAsync: decider || undefined });
    const replaced = plan.deletes.length > 0;
    const shouldReplace = !(c.existing === '用户喜欢爬山' && c.incoming === '用户现在吃素了');
    const ok = replaced === shouldReplace;
    if (ok) recGood++;
    console.log(`- [${c.existing}] + [${c.incoming}] → ${replaced ? '替换' : '保留'} ${ok ? '✅' : '⚠️'}（LLM: ${plan.reasons[0] ? plan.reasons[0].reason : '-'}）`);
  }
  console.log(`\nLLM 对账通过 ${recGood}/${RECONCILE_CASES.length}\n`);

  const total = EXTRACT_CASES.length + RECONCILE_CASES.length;
  const got = extractGood + recGood;
  console.log(`总分：${got}/${total}`);
  console.log('\n> 本报告由 `node scripts/eval-llm.js` 生成，需 DEEPSEEK_API_KEY。');
  process.exit(0); // LLM 评测失败不阻塞 CI（质量参考而非门禁）
}

main().catch(e => { console.error('评测出错：', e.message); process.exit(0); });
