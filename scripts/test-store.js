'use strict';

/**
 * 确定性单测：store 版本迁移 + 审计日志 + 损坏恢复 + import 死代码统一
 * 运行：node scripts/test-store.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}

// 隔离测试目录（每个用例独立 MEMLOCAL_HOME）
function withHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-store-'));
  const oldHome = process.env.MEMLOCAL_HOME;
  process.env.MEMLOCAL_HOME = home;
  try { fn(home); } finally {
    process.env.MEMLOCAL_HOME = oldHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
}

console.log('\n[1] v1 store 迁移到 v2：自动补 audit 数组');
withHome(() => {
  const storeMod = require('../core/store');
  fs.mkdirSync(storeMod.homeDir(), { recursive: true });
  fs.writeFileSync(storeMod.storePath(), JSON.stringify({ version: 1, memories: [{ id: 'a', content: 'x' }] }));
  const s = storeMod.loadStore();
  check('version 升到 2', s.version === 2);
  check('audit 数组已创建', Array.isArray(s.audit));
  check('旧记忆保留', s.memories.length === 1 && s.memories[0].content === 'x');
  check('旧记忆补默认字段', s.memories[0].type === 'fact' && s.memories[0].source === 'manual' && typeof s.memories[0].confidence === 'number');
});

console.log('\n[2] 无 version 的极老数据也能加载');
withHome(() => {
  const storeMod = require('../core/store');
  fs.mkdirSync(storeMod.homeDir(), { recursive: true });
  fs.writeFileSync(storeMod.storePath(), JSON.stringify({ memories: ['不是对象', '内容'] }));
  const s = storeMod.loadStore();
  check('能加载且 memories 是数组', Array.isArray(s.memories) && s.memories.length === 2);
  check('非对象条目被字符串化', s.memories.every(m => typeof m.content === 'string'));
});

console.log('\n[3] store.json 损坏：自动备份 + 重建空 store');
withHome(() => {
  const storeMod = require('../core/store');
  fs.mkdirSync(storeMod.homeDir(), { recursive: true });
  fs.writeFileSync(storeMod.storePath(), '{ not valid json !!!');
  const s = storeMod.loadStore();
  check('返回空 store', Array.isArray(s.memories) && s.memories.length === 0);
  const corrupts = fs.readdirSync(storeMod.homeDir()).filter(n => n.includes('.corrupt-'));
  check('损坏原文件已备份 .corrupt-*', corrupts.length === 1);
});

console.log('\n[4] 审计日志：追加、上限 200、先进先出');
withHome(() => {
  const storeMod = require('../core/store');
  let s = storeMod.emptyStore();
  for (let i = 0; i < 205; i++) storeMod.addAudit(s, { action: 't', detail: String(i) });
  check('上限 200', s.audit.length === 200);
  check('丢弃最旧保留最新', s.audit[0].detail === '5' && s.audit[199].detail === '204');
});

console.log('\n[5] import.js 统一：parseMdc 剥离 frontmatter 解析 .mdc');
{
  const { parseMdc, parseMarkdown, scanCandidates, runImport } = require('../core/import');
  const mdc = '---\ndescription: 用户偏好用 pnpm\nglobs: "**/*.js"\nalwaysApply: false\n---\n\n# 规则\n\n- 用户喜欢 TypeScript\n- 用 pnpm 安装依赖\n';
  const facts = parseMdc(mdc);
  check('frontmatter description 进记忆', facts.some(f => f.includes('pnpm')));
  check('正文 bullet 进记忆', facts.some(f => f.includes('TypeScript')));
  check('frontmatter 原始行不进', !facts.some(f => f.includes('globs')));

  check('parseMarkdown 兜底可用', parseMarkdown('- 用户喜欢咖啡\n- 用户住在北京\n').length === 2);
  check('scanCandidates 导出', typeof scanCandidates === 'function');
  check('runImport 导出', typeof runImport === 'function');
}

console.log('\n[6] import.js 死代码统一：adapters.js 已不存在');
{
  check('core/adapters.js 已删除', !fs.existsSync(path.join(__dirname, '..', 'core', 'adapters.js')));
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail === 0 ? 0 : 1);
