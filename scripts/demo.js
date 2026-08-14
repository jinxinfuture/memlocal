'use strict';

/**
 * MemLocal — 端到端演示（全功能闭环）
 *
 * 一条龙跑通：init → import → extract → reconcile(冲突) → reflect → sync →
 * backup → restore → export-all → audit，每步断言，输出演示报告。
 * 全程使用临时 MEMLOCAL_HOME，不碰真实数据。
 *
 * 运行：node scripts/demo.js
 */

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CLI = path.join(__dirname, '..', 'cli.js');
const NODE = process.execPath;
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-demo-'));
process.env.MEMLOCAL_HOME = HOME;

const report = [];
let pass = 0, fail = 0;

function run(args, opts = {}) {
  const env = { ...process.env, MEMLOCAL_HOME: opts.home || HOME };
  try {
    return execSync(`${NODE} ${CLI} ${args}`, { env, encoding: 'utf8', timeout: 30000 }).trim();
  } catch (e) {
    return (e.stdout || '') + (e.stderr || '');
  }
}

function step(name, out, cond) {
  const ok = !!cond;
  if (ok) pass++; else fail++;
  report.push(`  ${ok ? '✅' : '❌'} ${name}`);
  if (!ok) report.push(`     ↳ ${String(out).slice(0, 200)}`);
}

report.push('# MemLocal 端到端演示');
report.push(`\n临时数据目录：${HOME}\n`);

// 1. init
report.push('## 1. 初始化');
step('init 创建 store+config', run('init'), fs.existsSync(path.join(HOME, 'store.json')));

// 2. import
report.push('\n## 2. 导入（聚合 9 平台样例）');
const imp = run('import');
step('import 成功', imp, imp.includes('导入完成'));
const importedMatch = imp.match(/"imported":(\d+)/);
const importedCount = importedMatch ? parseInt(importedMatch[1]) : 0;
step(`聚合 ${importedCount} 条记忆`, imp, importedCount >= 20);

// 3. extract
report.push('\n## 3. 抽取（从对话长出记忆）');
const ex = run('extract --text "我叫小王，负责记忆层。我讨厌香菜，最近在学 Rust。你帮我看下这个 bug。明天开会。" --apply');
step('抽取 2 条事实', ex, ex.includes('2 条事实') || (ex.includes('[project]') && ex.includes('[preference]')));
step('过滤提问/日程', ex, !ex.includes('bug') && !ex.includes('开会'));

// 4. reconcile（冲突消解）
report.push('\n## 4. 对账（矛盾消解：牛排→素）');
run('reconcile --content "用户爱吃牛排" --apply') // 预置冲突方
const rc = run('reconcile --content "用户现在吃素了" --apply');
step('对账产生替换', rc, rc.includes('replace') || rc.includes('delete=1') || rc.includes('delete=1'));
step('对账摘要输出', rc, rc.includes('add=') || rc.includes('对账'));

// 5. reflect
report.push('\n## 5. 反思压缩');
const rf = run('reflect --apply');
step('反思完成', rf, rf.includes('反思') && rf.includes('归档'));

// 6. sync（沙箱 9 平台）
report.push('\n## 6. 同步（沙箱 9 平台）');
const sy = run('sync');
step('同步 9 平台', sy, sy.includes('written=9'));
step('生成 CLAUDE.md', sy, /writes[\\/]claude[\\/]CLAUDE\.md/.test(sy));

// 7. search
report.push('\n## 7. 检索');
const se = run('search "Rust" --limit 3');
step('检索返回结果', se, se.includes('检索') && !se.includes('EXIT_FAILED'));

// 8. backup + export-all
report.push('\n## 8. 备份与导出');
const bk = run('backup');
step('备份创建', bk, bk.includes('备份已创建'));
const exp = run('export-all');
step('导出完成', exp, exp.includes('导出完成'));
const mdFiles = fs.readdirSync(path.join(HOME, 'backups')).filter(f => f.endsWith('.md'));
step('导出 Markdown 存在', exp, mdFiles.length >= 1);

// 9. restore（先破坏再恢复）
report.push('\n## 9. 恢复（损坏恢复）');
const backups = fs.readdirSync(path.join(HOME, 'backups')).filter(f => f.endsWith('.json.gz'));
fs.writeFileSync(path.join(HOME, 'store.json'), '{broken');
const stBefore = run('status');
step('损坏后自动重建（0 条）', stBefore, stBefore.includes('0 条记忆') || stBefore.includes('memories'));
const rs = backups.length ? run(`restore --file ${path.join(HOME, 'backups', backups[0])}`) : 'NO_BACKUP';
step('从备份恢复', rs, rs.includes('恢复完成'));
const stAfter = run('status');
step('恢复后记忆回来', stAfter, !stAfter.includes('0 条记忆') || stAfter.includes('> 0'));

// 10. audit
report.push('\n## 10. 审计');
const au = run('audit --limit 10');
const auditActions = ['init', 'import', 'extract', 'reconcile', 'reflect', 'sync', 'backup', 'restore'];
let auditPass = 0;
for (const a of auditActions) if (au.includes(a) || au.includes({ init: '初始化' }[a] || a)) auditPass++;
step(`审计记录多种操作（${auditPass} 类）`, au, auditPass >= 3);

// 11. watch 快速验证（不常驻，改文件触发一轮）
report.push('\n## 11. watch（变化检测）');
{
  const projDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-demo-proj-'));
  const md = path.join(projDir, 'CLAUDE.md');
  fs.writeFileSync(md, '# 项目\n\n- 用户在做演示项目\n');
  const watchOut = '/tmp/ml-demo-watch.log';
  const child = require('child_process').spawn(NODE, [CLI, 'watch', '--interval', '2'], {
    env: { ...process.env, MEMLOCAL_HOME: HOME }, cwd: projDir, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logBuf = '';
  child.stdout.on('data', d => { logBuf += d; });
  setTimeout(() => {
    fs.writeFileSync(md, '# 项目\n\n- 用户在做演示项目\n- 用户偏好用 Rust\n');
    setTimeout(() => {
      child.kill();
      step('watch 检测变化并同步', logBuf, logBuf.includes('检测到变化') || logBuf.includes('导入完成'));
      report.push('');
      report.push(`## 结果：${pass} 通过 / ${fail} 失败`);
      report.push('\n> 演示报告由 `node scripts/demo.js` 生成。');
      console.log(report.join('\n'));
      fs.rmSync(HOME, { recursive: true, force: true });
      fs.rmSync(projDir, { recursive: true, force: true });
      process.exit(fail === 0 ? 0 : 1);
    }, 5000);
  }, 2500);
}
