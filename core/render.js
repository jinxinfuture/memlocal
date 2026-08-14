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
const PLATFORM_TARGETS = {
  claude:   { label: 'Claude Code',    filename: 'CLAUDE.md',               dir: 'claude',   format: 'md',   locations: ['CLAUDE.md', '.claude/CLAUDE.md', 'AGENTS.md'] },
  cursor:   { label: 'Cursor',         filename: '.cursorrules',           dir: 'cursor',   format: 'md',   locations: ['.cursorrules', '.cursor/rules'] },
  windsurf: { label: 'Windsurf',       filename: '.windsurfrules',         dir: 'windsurf', format: 'md',   locations: ['.windsurfrules'] },
  chatgpt:  { label: 'ChatGPT',        filename: 'memory.json',            dir: 'chatgpt',  format: 'json', locations: ['memory.json'] },
  generic:  { label: '通用 Markdown',   filename: 'MEMORY.md',              dir: 'generic',  format: 'md',   locations: ['MEMORY.md', 'memory.md'] },
  codex:    { label: 'Codex CLI',      filename: 'AGENTS.md',               dir: 'codex',    format: 'md',   locations: ['AGENTS.md'] },
  gemini:   { label: 'Gemini CLI',     filename: 'GEMINI.md',              dir: 'gemini',   format: 'md',   locations: ['GEMINI.md'] },
  aider:    { label: 'Aider',          filename: 'CONVENTIONS.md',          dir: 'aider',    format: 'md',   locations: ['CONVENTIONS.md', '.aider.conf.yml'] },
  copilot:  { label: 'GitHub Copilot', filename: 'copilot-instructions.md', dir: 'copilot',  format: 'md',   locations: ['.github/copilot-instructions.md'] },
};

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

module.exports = { PLATFORM_TARGETS, renderMarkdown, renderChatGPT, renderFor, headerFor, TYPE_ORDER, TYPE_TITLE };
