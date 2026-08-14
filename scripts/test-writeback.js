'use strict';

/**
 * 确定性单测：writeback 写回适配器（沙箱 / 真实探测 / 备份 / cursor .mdc / 安全策略）
 * 运行：node scripts/test-writeback.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}

function makeStore() {
  return { version: 2, memories: [
    { id: 'a', content: '用户偏好用 TypeScript', type: 'preference', source: 'manual', createdAt: 1, updatedAt: 1, confidence: 0.9 },
    { id: 'b', content: '用户住在北京', type: 'context', source: 'claude', createdAt: 1, updatedAt: 1, confidence: 0.75 },
  ], audit: [] };
}

function withHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-wb-'));
  const oldHome = process.env.MEMLOCAL_HOME;
  process.env.MEMLOCAL_HOME = home;
  try { return fn(home); } finally {
    process.env.MEMLOCAL_HOME = oldHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
}

console.log('\n[1] 沙箱写回：默认写 ~/.memlocal/writes/ 且 9 平台全覆盖');
withHome(() => {
  const { applyWrites } = require('../core/writeback');
  const r = applyWrites(makeStore(), {});
  check('写入 9 个平台', r.written.length === 9);
  check('路径在 writes/ 下', r.written.every(w => w.file.includes(path.join(process.env.MEMLOCAL_HOME, 'writes'))));
  check('无真实标记', r.written.every(w => !w.real));
});

console.log('\n[2] dry-run：不落盘');
withHome(() => {
  const { applyWrites } = require('../core/writeback');
  const r = applyWrites(makeStore(), { dryRun: true });
  check('wouldWrite 9 个', r.wouldWrite.length === 9);
  check('written 为 0', r.written.length === 0);
  check('磁盘无文件', !fs.existsSync(path.join(process.env.MEMLOCAL_HOME, 'writes')));
});

console.log('\n[3] 覆盖前自动 .bak 备份');
withHome(() => {
  const { applyWrites } = require('../core/writeback');
  const writesDir = path.join(process.env.MEMLOCAL_HOME, 'writes');
  fs.mkdirSync(writesDir + '/claude', { recursive: true });
  fs.writeFileSync(writesDir + '/claude/CLAUDE.md', '# 旧内容\n');
  const r = applyWrites(makeStore(), {});
  const bak = r.backups.find(b => b.includes('CLAUDE.md'));
  check('产生 .bak', !!bak);
  check('备份内容为旧内容', bak && fs.readFileSync(bak, 'utf8').includes('旧内容'));
});

console.log('\n[4] 真实写回：config.realTargets 显式 > 自动探测');
withHome(() => {
  const storeMod = require('../core/store');
  storeMod.saveConfig({ realTargets: { claude: '/tmp/ml-custom/CLAUDE.md' } });
  fs.mkdirSync('/tmp/ml-custom', { recursive: true });
  const { applyWrites } = require('../core/writeback');
  const r = applyWrites(makeStore(), { real: true, cwd: os.tmpdir() });
  const claude = r.written.find(w => w.platform === 'claude' && w.real);
  check('claude 写到显式路径', claude && claude.file === '/tmp/ml-custom/CLAUDE.md');
  fs.rmSync('/tmp/ml-custom', { recursive: true, force: true });
});

console.log('\n[5] 安全策略：无 config 时 ~ 候选不因目录存在而命中（防污染 home）');
withHome(() => {
  const { applyWrites } = require('../core/writeback');
  const tmpProj = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-proj-'));
  // 项目目录存在但 home 无 .claude：真实写回应只命中 {cwd} 项目级，不写 home
  const r = applyWrites(makeStore(), { real: true, cwd: tmpProj });
  const allReal = r.wouldWrite.filter(w => w.real);
  check('真实目标都在项目目录', allReal.every(w => w.file.startsWith(tmpProj)));
  check('home 未被写入', !fs.existsSync(path.join(os.homedir(), '.claude', 'CLAUDE.md')));
  fs.rmSync(tmpProj, { recursive: true, force: true });
});

console.log('\n[6] cursor 目录目标 -> .mdc 文件');
withHome(() => {
  const { applyWrites } = require('../core/writeback');
  const tmpProj = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-mdc-'));
  fs.mkdirSync(path.join(tmpProj, '.cursor', 'rules'), { recursive: true });
  const r = applyWrites(makeStore(), { real: true, cwd: tmpProj });
  const cursor = r.written.find(w => w.platform === 'cursor' && w.real);
  check('cursor 写到 memlocal-memory.mdc', cursor && cursor.file.endsWith('memlocal-memory.mdc'));
  if (cursor) {
    const content = fs.readFileSync(cursor.file, 'utf8');
    check('.mdc 含 YAML frontmatter', content.startsWith('---\n') && content.includes('globs:'));
  }
  fs.rmSync(tmpProj, { recursive: true, force: true });
});

console.log('\n[7] restore 回滚 .bak');
withHome(() => {
  const { applyWrites, restore } = require('../core/writeback');
  const writesDir = path.join(process.env.MEMLOCAL_HOME, 'writes');
  fs.mkdirSync(writesDir + '/claude', { recursive: true });
  fs.writeFileSync(writesDir + '/claude/CLAUDE.md', '# 原始\n');
  const r = applyWrites(makeStore(), {});
  const bak = r.backups.find(b => b.includes('CLAUDE.md'));
  check('恢复成功', bak && restore(bak));
  check('内容回到原始', bak && fs.readFileSync(bak.replace(/\.bak$/, ''), 'utf8').includes('原始'));
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail === 0 ? 0 : 1);
