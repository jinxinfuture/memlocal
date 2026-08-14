'use strict';

/**
 * MemLocal — LLM 增强层（Issue #4）
 *
 * 提供可选的 LLM 决策函数，供 reconcile 在「确定性核心无法判定」的疑难 case 上调用。
 * 默认不启用：apiKey 缺失时 makeDeepSeekLLM 返回 null，reconcile 自动走确定性回退，
 * 保证「没有 key 也能跑、跑得对」。
 *
 * 接入方式：
 *   const llm = require('./core/llm').makeDeepSeekLLM({ apiKey, model });
 *   await reconcile.reconcileAsync(store, changes, { llmAsync: llm });
 */

const DEFAULT_BASE = 'https://api.deepseek.com/v1';
const DEFAULT_MODEL = 'deepseek-chat';

// 从 ~/.memlocal/config.json 的 deepseek 段读取配置（CLI 未显式传 opts 时兜底）
function configLLMOptions() {
  try {
    const fs = require('fs');
    const path = require('path');
    const { homeDir } = require('./store');
    const cfg = JSON.parse(fs.readFileSync(path.join(homeDir(), 'config.json'), 'utf8'));
    if (cfg && cfg.deepseek && cfg.deepseek.apiKey) {
      return { apiKey: cfg.deepseek.apiKey, baseURL: cfg.deepseek.baseURL, model: cfg.deepseek.model };
    }
  } catch (e) { /* 无 config 或未配置 */ }
  return {};
}

// 兼容模型返回的 markdown 代码块包裹 / 前后杂文本，提取纯 JSON
function extractJSON(text) {
  if (!text) return null;
  let t = String(text).trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  // 从第一个 { 到最后一个 } 截取（容忍前后杂文本）
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  t = t.slice(start, end + 1);
  try { return JSON.parse(t); } catch (e) { return null; }
}

/**
 * 构造一个 async (exMem, incoming) => {winner, confidence, reason} | null
 * - apiKey 缺失 => 直接返回 null（确定性回退）
 * - 调用 DeepSeek OpenAI 兼容 /chat/completions，要求模型返回 JSON
 */
function makeDeepSeekLLM(opts = {}) {
  const cfg = configLLMOptions();
  const merged = { ...cfg, ...opts };
  const apiKey = merged.apiKey || process.env.DEEPSEEK_API_KEY || '';
  if (!apiKey) return null; // 无密钥 => 不启用 LLM
  const baseURL = merged.baseURL || process.env.DEEPSEEK_BASE_URL || DEFAULT_BASE;
  const model = merged.model || process.env.DEEPSEEK_MODEL || DEFAULT_MODEL;
  const timeoutMs = merged.timeoutMs || 15000;

  return async function deepseekDecision(exMem, incoming) {
    const prompt = [
      '你是记忆对账器。判断「新记忆」与「旧记忆」是否为同一维度的矛盾或更新。',
      '若同一维度、新值应取代旧值，返回 winner="incoming"；若旧值仍有效，返回 winner="existing"。',
      'confidence 取 0..1。reason 一句话。只返回 JSON，不要其它内容。',
      '',
      `旧记忆：${exMem ? exMem.content : '(无)'}`,
      `新记忆：${incoming.content}（来源 ${incoming.source}，时间 ${new Date(incoming.time).toISOString()}）`,
      '',
      '返回格式：{"winner":"incoming|existing","confidence":0.0,"reason":"..."}',
    ].join('\n');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(`${baseURL}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0,
          response_format: { type: 'json_object' },
        }),
      });
      if (!resp.ok) return null;
      const json = await resp.json();
      const text = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
      if (!text) return null;
      const parsed = extractJSON(text);
      if (!parsed || (parsed.winner !== 'incoming' && parsed.winner !== 'existing')) return null;
      return {
        winner: parsed.winner,
        confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.7,
        reason: parsed.reason || 'llm',
      };
    } catch (e) {
      return null; // 任何失败都回退确定性
    } finally {
      clearTimeout(timer);
    }
  };
}

/**
 * 构造一个 async (text) => [{content, type}] | null 的事实抽取器。
 * 供 cli extract --llm / server /api/extract 使用。
 * 无 key 时返回 null（调用方回退确定性抽取）。
 */
function makeExtractor(opts = {}) {
  const cfg = configLLMOptions();
  const merged = { ...cfg, ...opts };
  const apiKey = merged.apiKey || process.env.DEEPSEEK_API_KEY || '';
  if (!apiKey) return null;
  const baseURL = merged.baseURL || process.env.DEEPSEEK_BASE_URL || DEFAULT_BASE;
  const model = merged.model || process.env.DEEPSEEK_MODEL || DEFAULT_MODEL;
  const timeoutMs = merged.timeoutMs || 20000;

  return async function deepseekExtract(text) {
    const prompt = [
      '你是记忆抽取器。从用户的这段对话/文本中，抽取「值得长期记住」的原子事实。',
      '规则：只抽取关于用户/其项目/其偏好的持久事实；不抽取一次性任务、寒暄、提问、代码细节。',
      '每条事实独立、去重、去掉"我"之外的多余主语；type 取 identity|preference|project|context|fact 之一。',
      '只返回 JSON：{"facts":[{"content":"...","type":"..."}]}。没有值得记的就返回 {"facts":[]}。',
      '',
      '文本：\n' + String(text).slice(0, 6000),
    ].join('\n');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(`${baseURL}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0,
          response_format: { type: 'json_object' },
        }),
      });
      if (!resp.ok) return null;
      const json = await resp.json();
      const text2 = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
      if (!text2) return null;
      const parsed = extractJSON(text2);
      const facts = parsed && Array.isArray(parsed.facts) ? parsed.facts
        .filter(f => f && typeof f.content === 'string' && f.content.trim().length >= 2)
        .map(f => ({ content: f.content.trim(), type: ['identity', 'preference', 'project', 'context', 'fact'].includes(f.type) ? f.type : 'fact' }))
        : [];
      return facts;
    } catch (e) {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
}

module.exports = { makeDeepSeekLLM, makeExtractor, extractJSON, DEFAULT_BASE, DEFAULT_MODEL };
