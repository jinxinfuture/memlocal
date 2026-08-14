'use strict';

/**
 * MemLocal — 渲染层：canonical store -> 各 agent 原生格式
 *
 * 覆盖的主流 code agent（导入/导出双向）：
 *   claude / cursor / windsurf / chatgpt / generic / codex / gemini / aider / copilot
 *
 * 被 core/writeback.js 与 server.js 共用，单一真相源。
 */

// locations: 导入扫描时在各 base 目录下尝试的相对路径（含各 agent 真实存放位置）
// realLocations: 真实写回时自动探测的候选路径（~ 展开为用户主目录，{cwd} 展开为当前工作目录）。
//   按顺序探测：第一个「已存在」的路径胜出；都探测不到则取第一个父目录可写的路径，保证 sync --real 零配置可用。
const PLATFORM_TARGETS = {
  claude:   { label: 'Claude Code',    filename: 'CLAUDE.md',               dir: 'claude',   format: 'md',   locations: ['CLAUDE.md', '.claude/CLAUDE.md', 'AGENTS.md'], realLocations: ['~/.claude/CLAUDE.md', '~/.claude/CLAUDE.local.md', '{cwd}/CLAUDE.md', '{cwd}/AGENTS.md'] },
  cursor:   { label: 'Cursor',         filename: '.cursorrules',           dir: 'cursor',   format: 'md',   locations: ['.cursorrules', '.cursor/rules'], realLocations: ['{cwd}/.cursor/rules', '{cwd}/.cursorrules', '~/.cursor/rules'] },
  windsurf: { label: 'Windsurf',       filename: '.windsurfrules',         dir: 'windsurf', format: 'md',   locations: ['.windsurfrules'], realLocations: ['{cwd}/.windsurfrules', '~/.codeium/windsurf/.windsurfrules'] },
  chatgpt:  { label: 'ChatGPT',        filename: 'memory.json',            dir: 'chatgpt',  format: 'json', locations: ['memory.json'], realLocations: ['{cwd}/memory.json'] },
  generic:  { label: '通用 Markdown',   filename: 'MEMORY.md',              dir: 'generic',  format: 'md',   locations: ['MEMORY.md', 'memory.md'], realLocations: ['~/.memlocal/MEMORY.md', '{cwd}/MEMORY.md'] },
  codex:    { label: 'Codex CLI',      filename: 'AGENTS.md',               dir: 'codex',    format: 'md',   locations: ['AGENTS.md'], realLocations: ['{cwd}/AGENTS.md', '~/.codex/AGENTS.md'] },
  gemini:   { label: 'Gemini CLI',     filename: 'GEMINI.md',              dir: 'gemini',   format: 'md',   locations: ['GEMINI.md'], realLocations: ['{cwd}/GEMINI.md', '~/.gemini/GEMINI.md'] },
  aider:    { label: 'Aider',          filename: 'CONVENTIONS.md',          dir: 'aider',    format: 'md',   locations: ['CONVENTIONS.md', '.aider.conf.yml'], realLocations: ['{cwd}/CONVENTIONS.md', '~/.aider/CONVENTIONS.md'] },
  copilot:  { label: 'GitHub Copilot', filename: 'copilot-instructions.md', dir: 'copilot',  format: 'md',   locations: ['.github/copilot-instructions.md'], realLocations: ['{cwd}/.github/copilot-instructions.md'] },
};

// 把 ~ 与 {cwd} 展开成绝对路径
function expandRealLocation(loc, opts = {}) {
  const cwd = opts.cwd || process.cwd();
  let p = String(loc).replace('{cwd}', cwd);
  if (p.startsWith('~/')) p = require('os').homedir() + p.slice(1);
  return p;
}

// 自动探测某平台的真实记忆路径（安全策略：绝不往用户主目录撒新文件）
//   1) config.realTargets 显式配置 > 优先
//   2) 候选文件「已存在」=> 返回（覆盖 ~/.claude/CLAUDE.md、~/.cursor/rules 等已装 agent 的真实配置）
//   3) 仅 {cwd} 开头的候选：父目录存在即可返回（在项目目录生成项目级记忆文件）
//   ~ 开头的候选绝不因「父目录存在」而自动创建，避免把文件撒进用户 home
function detectRealLocation(platform, config = {}, opts = {}) {
  const t = PLATFORM_TARGETS[platform];
  if (!t) return null;
  if (config.realTargets && config.realTargets[platform]) return config.realTargets[platform];
  const fs = require('fs');
  const path = require('path');
  const candidates = (t.realLocations || []).map(loc => ({ loc, p: expandRealLocation(loc, opts) }));
  // 1) 已存在的真实配置 -> 更新它（~ 或 {cwd} 都认）
  for (const { p } of candidates) {
    if (fs.existsSync(p)) return p;
  }
  // 2) {cwd} 候选：父目录存在即可（项目级记忆文件，允许新建）
  for (const { loc, p } of candidates) {
    if (!loc.startsWith('{cwd}')) continue;
    try {
      if (fs.existsSync(path.dirname(p))) return p;
    } catch (e) { /* 忽略 */ }
  }
  return null;
}

const TYPE_ORDER = ['identity', 'preference', 'project', 'context', 'fact', 'summary'];
const TYPE_TITLE = {
  identity: '身份', preference: '偏好', project: '项目',
  context: '背景', fact: '事实', summary: '摘要',
};

function headerFor(platform) {
  const t = PLATFORM_TARGETS[platform];
  const name = t ? t.label : 'Memory';
  return `# ${name} 记忆（由 MemLocal 统一管理 · 请勿手改，改动请走 memlocal）\n\n`;
}

function renderMarkdown(store, platform) {
  const lists = { identity: [], preference: [], project: [], context: [], fact: [], summary: [] };
  for (const m of store.memories) {
    if (m.archived) continue; // 已压缩归档的零散事实不进散列导出
    const arr = lists[m.type] || lists.fact;
    arr.push(`- ${m.content}`);
  }
  let out = headerFor(platform);
  for (const t of TYPE_ORDER) {
    if (lists[t].length) {
      out += `\n## ${TYPE_TITLE[t]}\n` + lists[t].join('\n') + '\n';
    }
  }
  return out;
}

function renderChatGPT(store) {
  const memories = store.memories
    .filter(m => !m.archived)
    .map(m => ({ content: m.content, type: m.type }));
  return JSON.stringify({ memories }, null, 2);
}

// 按需检索：只导出与 query 相关的条目（避免整文档注入导致长上下文退化）
function renderFor(store, platform, opts = {}) {
  const t = PLATFORM_TARGETS[platform];
  if (!t) return renderMarkdown(store, 'generic');
  if (t.format === 'json') return renderChatGPT(store);
  return renderMarkdown(store, platform);
}

module.exports = { PLATFORM_TARGETS, renderMarkdown, renderChatGPT, renderFor, headerFor, TYPE_ORDER, TYPE_TITLE, expandRealLocation, detectRealLocation };
