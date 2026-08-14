'use strict';

/**
 * CLI 冒烟测试：自动化跑全部子命令并断言输出
 * 运行：node scripts/smoke-cli.js
 * 用临时 MEMLOCAL_HOME 隔离，不碰真实数据。
 */

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CLI = path.join(__dirname, '..', 'cli.js');
const NODE = process.execPath;

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  (' + detail + ')' : '')); }
}

function run(args, opts = {}) {
  const env = { ...process.env, MEMLOCAL_HOME: opts.home || HOME };
  try {
    return execSync(`${NODE} ${CLI} ${args}`, { env, encoding: 'utf8', timeout: 30000 }).trim();
  } catch (e) {
    return (e.stdout || '') + (e.stderr || '') || 'EXIT_FAILED';
  }
}

// 隔离 HOME（Linux 下 os.tmpdir 可能不含真实 home；直接用一个固定临时目录）
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-smoke-'));
process.env.MEMLOCAL_HOME = HOME;

console.log('\n[1] init');
{
  const out = run('init');
  check('输出初始化路径', out.includes(HOME));
  check('store.json 已创建', fs.existsSync(path.join(HOME, 'store.json')));
  check('config.json 已创建', fs.existsSync(path.join(HOME, 'config.json')));
}

console.log('\n[2] status');
{
  const out = run('status');
  check('显示 store 路径', out.includes(HOME));
  check('列出 9 平台', ['claude','cursor','windsurf','chatgpt','generic','codex','gemini','aider','copilot'].every(p => out.includes(p)));
}

console.log('\n[3] import（扫样例）');
{
  const out = run('import');
  check('导入成功', out.includes('导入完成'));
}

console.log('\n[4] search');
{
  const out = run('search "TypeScript" --limit 3');
  check('返回检索结果', out.includes('检索') && !out.includes('EXIT_FAILED'));
}

console.log('\n[5] extract --apply');
{
  const out = run('extract --text "我叫小王，负责记忆层。你帮我看下页面。" --apply');
  check('抽取 1 条', out.includes('抽取到 1 条事实') || out.includes('[project]'));
  check('已写入 store', out.includes('已写入 store') || out.includes('--apply'));
}

console.log('\n[6] reconcile');
{
  const out = run('reconcile --content "用户现在吃素了" --apply');
  check('对账输出', out.includes('对账') || out.includes('add='));
}

console.log('\n[7] reflect');
{
  const out = run('reflect');
  check('反思输出', out.includes('反思'));
}

console.log('\n[8] audit');
{
  const out = run('audit');
  check('有审计记录', out.includes('[import]') || out.includes('[extract]'));
}

console.log('\n[9] sync（沙箱）');
{
  const out = run('sync');
  check('同步 9 平台', out.includes('written=9'));
}

console.log('\n[10] backup + backups + export-all');
{
  const b1 = run('backup');
  check('备份创建', b1.includes('备份已创建'));
  const b2 = run('backups');
  check('列出备份', b2.includes('.json.gz'));
  const e1 = run('export-all');
  check('导出完成', e1.includes('导出完成'));
}

console.log('\n[11] config set/get');
{
  run('config set deepseek.apiKey sk-test');
  const g = run('config get deepseek.apiKey');
  check('config 读写', g.includes('sk-test'));
}

console.log('\n[12] export --platform claude');
{
  const out = run('export --platform claude');
  check('渲染 CLAUDE.md 格式', out.includes('记忆（由 MemLocal'));
}

console.log('\n[13] 帮助文本');
{
  const out = run('');
  check('帮助含全部命令', ['init','status','import','sync','extract','search','reconcile','reflect','audit','backup','restore','export-all','watch','config','serve'].every(c => out.includes(c)));
}

console.log('\n[14] --version / --help');
{
  const v = run('--version');
  check('--version 输出版本号', /^\d+\.\d+\.\d+$/.test(v));
  const h = run('--help');
  check('--help 输出帮助', h.includes('MemLocal CLI'));
}

// 清理
fs.rmSync(HOME, { recursive: true, force: true });

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail === 0 ? 0 : 1);
