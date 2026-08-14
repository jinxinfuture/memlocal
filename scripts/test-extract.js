'use strict';

/**
 * 确定性单测：extract 抽取器 + 真实路径自动探测 + 平台注册表统一性
 * 运行：node scripts/test-extract.js
 */

const { extractDeterministic, splitSentences } = require('../core/extract');
const { PLATFORM_TARGETS, detectRealLocation, expandRealLocation } = require('../core/render');
const imp = require('../core/import');
const fs = require('fs');
const os = require('os');
const path = require('path');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}

console.log('\n[1] 确定性抽取：抽出值得记的事实，过滤提问/语气词/纯技术动作/临时日程');
{
  const text = '我叫小王，住在杭州。我们团队在做 MemLocal 这个项目，我负责记忆层。我讨厌香菜，最近在学 Rust。你能帮我看看这个 bug 吗？嗯好的谢谢。顺便说一句我明天开会。你帮我看下这个页面。';
  const facts = extractDeterministic(text);
  check('抽出 3 条', facts.length === 3);
  check('含身份/项目/偏好', facts.some(f => f.content.includes('小王')) && facts.some(f => f.content.includes('MemLocal')) && facts.some(f => f.content.includes('香菜')));
  check('不含提问', !facts.some(f => f.content.includes('bug')));
  check('不含语气词', !facts.some(f => f.content.includes('谢谢')));
  check('不含闲聊(明天开会)', !facts.some(f => f.content.includes('开会')));
  check('不含指令(帮我看下)', !facts.some(f => f.content.includes('看下')));
}

console.log('\n[2] 分句：中英文标点都切');
{
  const s = splitSentences('我喜欢 Rust。I like coffee! 你呢?');
  check('切成 3 句', s.length === 3);
  check('保留英文句', s.some(x => x.includes('coffee')));
}

console.log('\n[3] 平台注册表统一：import.PLATFORMS 与 render.PLATFORM_TARGETS 平台数一致且覆盖 9 平台');
{
  const impKeys = Object.keys(imp.PLATFORMS).sort();
  const renderKeys = Object.keys(PLATFORM_TARGETS).sort();
  check('平台数 = 9', renderKeys.length === 9);
  check('两表一致', JSON.stringify(impKeys) === JSON.stringify(renderKeys));
  check('含 codex/gemini/aider/copilot', ['codex', 'gemini', 'aider', 'copilot'].every(k => renderKeys.includes(k)));
  check('每平台有 label/filename/format/locations', Object.values(PLATFORM_TARGETS).every(t => t.label && t.filename && t.format && Array.isArray(t.locations)));
}

console.log('\n[4] 路径探测：~ 与 {cwd} 展开');
{
  check('~ 展开到 home', expandRealLocation('~/x.md').startsWith(os.homedir()));
  check('{cwd} 展开到 cwd', expandRealLocation('{cwd}/x.md', { cwd: '/tmp' }) === '/tmp/x.md');
}

console.log('\n[5] 路径探测安全：~ 候选文件不存在时绝不自动创建（防污染 home）');
{
  const fakeConfig = {};
  // 模拟全新环境：home 无 ~/.claude/CLAUDE.md、cwd 为空项目
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-detect-'));
  const cwd = path.join(tmpHome, 'proj');
  fs.mkdirSync(cwd);
  const loc = detectRealLocation('claude', fakeConfig, { cwd });
  // claude realLocations: ~/.claude/CLAUDE.md(不存在) -> ~/.claude/CLAUDE.local.md(不存在) -> {cwd}/CLAUDE.md(父目录存在)
  check('探测到 cwd 项目级路径', loc === path.join(cwd, 'CLAUDE.md'));
  check('未在 home 创建文件', !fs.existsSync(path.join(os.homedir(), '.claude', 'CLAUDE.md')) && !fs.existsSync(path.join(os.homedir(), '.claude')));
  // 清理临时目录
  fs.rmSync(tmpHome, { recursive: true, force: true });
}

console.log('\n[6] 路径探测：已存在 ~/.claude/CLAUDE.md 时优先更新它（真实已装 agent）');
{
  const realClaudeDir = path.join(os.homedir(), '.claude');
  const realClaudeFile = path.join(realClaudeDir, 'CLAUDE.md');
  const created = !fs.existsSync(realClaudeFile);
  try {
    fs.mkdirSync(realClaudeDir, { recursive: true });
    fs.writeFileSync(realClaudeFile, '# existing\n');
    const loc = detectRealLocation('claude', {}, { cwd: '/tmp' });
    check('优先命中 ~/.claude/CLAUDE.md', loc === realClaudeFile);
  } finally {
    if (created) {
      try { fs.unlinkSync(realClaudeFile); fs.rmdirSync(realClaudeDir); } catch (e) {}
    }
  }
}

console.log('\n[7] 路径探测：config.realTargets 显式配置 > 自动探测');
{
  const loc = detectRealLocation('claude', { realTargets: { claude: '/custom/CLAUDE.md' } }, { cwd: '/tmp' });
  check('config 优先', loc === '/custom/CLAUDE.md');
}

console.log('\n[8] doSync 覆盖全部 9 平台（渲染无异常）');
{
  const store = { memories: [{ id: 'a', content: '用户喜欢 Rust', type: 'preference', source: 'manual', createdAt: 1, updatedAt: 1 }] };
  const { renderFor } = require('../core/render');
  for (const p of Object.keys(PLATFORM_TARGETS)) {
    const out = renderFor(store, p);
    check(`渲染 ${p} 非空且含记忆`, out && out.length > 10 && out.includes('Rust'));
  }
}

console.log('\n[9] llm.js extractJSON 容错：markdown 包裹 / 前后杂文本');
{
  const { extractJSON } = require('../core/llm');
  check('纯 JSON', extractJSON('{"winner":"incoming"}').winner === 'incoming');
  check('markdown 代码块包裹', extractJSON('```json\n{"winner":"existing"}\n```').winner === 'existing');
  check('前后杂文本', extractJSON('好的，结果如下：{"winner":"incoming"} 请查收').winner === 'incoming');
  check('非法输入返回 null', extractJSON('not json at all') === null);
  check('空输入返回 null', extractJSON('') === null);
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail === 0 ? 0 : 1);
