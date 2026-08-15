'use strict';

/**
 * Web UI 运行时验证：用 jsdom 实际执行 public/index.html 的 JS，
 * 断言 DOM 渲染结果（stats/chips/记忆列表/类型 tabs/写回目标/审计）。
 * 运行：NODE_PATH=/Users/oh3r/.workbuddy/binaries/node/workspace/node_modules \
 *       node scripts/verify-ui.js
 */

const fs = require('fs');
const path = require('path');

// jsdom 非项目依赖（保持零依赖原则）：自动探测常见安装位置，找不到时 SKIP（与 eval-llm 的 key 策略一致）
let JSDOM = null;
const jsdomCandidates = [
  'jsdom',
  require('path').join(process.env.HOME || '', '.workbuddy/binaries/node/workspace/node_modules/jsdom'),
];
for (const c of jsdomCandidates) {
  try { JSDOM = require(c).JSDOM; break; } catch (e) { /* next */ }
}
if (!JSDOM) {
  console.log('SKIP: jsdom 未安装（npm i -g jsdom 后运行）。UI 验证跳过，不视为失败。');
  process.exit(0);
}

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

// 提取页面 <script>（不含 src= 外部脚本）
const scripts = [];
const re = /<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g;
let m;
while ((m = re.exec(html))) scripts.push(m[1]);
if (scripts.length === 0) { console.error('未找到内联脚本'); process.exit(1); }

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  (' + detail + ')' : '')); }
}

// 构造模拟 server 响应（与真实 /api/state 等返回结构一致）
const MOCK_STATE = {
  memories: [
    { id: 'm1', content: '用户偏好用 TypeScript', type: 'preference', source: 'cursor', confidence: 0.9, createdAt: 1, updatedAt: 1 },
    { id: 'm2', content: '用户住在北京', type: 'context', source: 'claude', confidence: 0.8, createdAt: 1, updatedAt: 1 },
    { id: 'm3', content: '项目约定用 pnpm', type: 'project', source: 'manual', confidence: 0.7, createdAt: 1, updatedAt: 1 },
    { id: 'm4', content: '用户叫小王', type: 'identity', source: 'manual', confidence: 0.95, createdAt: 1, updatedAt: 1 },
  ],
  stats: {
    total: 4,
    bySource: { cursor: 1, claude: 1, manual: 2 },
    platforms: ['claude', 'cursor', 'windsurf', 'chatgpt', 'generic', 'codex', 'gemini', 'aider', 'copilot'],
  },
  lastImport: 1700000000000, lastSync: 1700000000000, lastReflect: null,
  writeTargets: {
    claude: { file: '/tmp/CLAUDE.md', explicit: false, detected: true },
    cursor: { file: '/tmp/.cursorrules', explicit: false, detected: true },
    windsurf: { file: null, explicit: false, detected: false },
  },
  home: '/tmp/.memlocal',
};

const MOCK_AUDIT = { audit: [
  { at: 1700000000000, action: 'import', detail: '新增 4 条' },
  { at: 1700000000001, action: 'sync', detail: '写回 9 个平台' },
] };

async function main() {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost:4173/', pretendToBeVisual: true });  const { window } = dom;

  // mock fetch：按 path 返回与 server 一致的 JSON
  window.fetch = async (p, opts = {}) => {
    const pathname = String(p).split('?')[0];
    let data;
    if (pathname === '/api/state') data = MOCK_STATE;
    else if (pathname === '/api/audit') data = MOCK_AUDIT;
    else if (pathname === '/api/search') data = { query: 'x', results: [{ memory: MOCK_STATE.memories[0], score: 0.9, breakdown: { recency: 1, importance: 0.9, relevance: 0.9 } }] };
    else if (pathname === '/api/import') data = { summary: { imported: 4 } };
    else if (pathname === '/api/sync') data = { written: [], wouldWrite: [] };
    else if (pathname === '/api/writeback') data = { wouldWrite: [{ platform: 'claude', file: '/tmp/CLAUDE.md', real: true }] };
    else if (pathname.startsWith('/api/extract')) data = { facts: [{ content: '我叫小王。', type: 'context' }], plan: { adds: 1, deletes: 0, needsReview: 0 }, applied: false };
    else if (pathname.startsWith('/api/memory/')) data = { ok: true };
    else if (pathname === '/api/memory') data = { memory: MOCK_STATE.memories[0] };
    else if (pathname === '/api/reflect') data = { plan: { archiveIds: [] } };
    else data = { ok: true };
    return { json: async () => data, ok: true, status: 200 };
  };

  // 执行页面脚本（页面 JS 顶层会调用 refresh() 渲染）
  for (const code of scripts) {
    try { window.eval(code); } catch (e) { check('脚本执行无异常: ' + (e.message || '').slice(0, 60), false, e.message); }
  }
  // 等页面 JS 的 async 渲染完成
  await new Promise(r => setTimeout(r, 600));

  const doc = window.document;
  const text = (id) => { const el = doc.getElementById(id); return el ? el.textContent : null; };

  console.log('\n[1] 统计区渲染');
  check('stats 显示记忆数', (text('stats') || '').includes('4 条记忆'), text('stats'));
  check('stats 显示来源数', (text('stats') || '').includes('3 个 Agent'), text('stats'));

  console.log('\n[2] 记忆列表渲染');
  const memList = doc.getElementById('memList');
  const memCount = memList ? memList.querySelectorAll('.mem').length : 0;
  check('记忆列表 4 条', memCount === 4, 'count=' + memCount);
  check('记忆内容出现', (memList ? memList.textContent : '').includes('TypeScript') && (memList ? memList.textContent : '').includes('北京'));
  check('置信度徽标渲染', memList ? memList.querySelectorAll('.mem .tag').length >= 8 : false, 'tags=' + (memList ? memList.querySelectorAll('.mem .tag').length : 0)); // 4 条 × (类型+来源+置信)

  console.log('\n[3] 平台 chips');
  const chips = doc.querySelectorAll('#chips .chip').length;
  check('9 平台 chips', chips === 9, 'count=' + chips);

  console.log('\n[4] 类型 tabs');
  const tabs = doc.querySelectorAll('#typeTabs .tabbtn').length;
  check('类型筛选 tabs ≥ 6', tabs >= 6, 'count=' + tabs);

  console.log('\n[5] 写回目标展示');
  const wt = doc.getElementById('writeTargets');
  const syncItems = wt ? wt.querySelectorAll('.syncitem').length : 0;
  check('写回目标条目渲染', syncItems >= 3, 'items=' + syncItems); // 3 平台 + 数据目录行
  check('显示自动探测标记', wt && (wt.textContent || '').includes('自动探测'));
  check('显示数据目录', wt && (wt.textContent || '').includes('数据目录'));
  console.log('\n[6] 审计日志');
  const au = doc.getElementById('auditLog');
  const auItems = au ? au.querySelectorAll('.syncitem').length : 0;
  check('审计条目渲染', auItems >= 2, 'items=' + auItems);
  check('审计映射中文动作', au && (au.textContent || '').includes('导入'));

  console.log('\n[7] 按钮存在');
  for (const id of ['btnImport', 'btnSync', 'btnSyncPreview', 'btnExtract', 'btnSearch', 'btnAdd']) {
    check('#' + id, !!doc.getElementById(id));
  }

  console.log('\n[8] 页面标题');
  check('标题含 MemLocal', (doc.title || '').includes('MemLocal'), doc.title);

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
