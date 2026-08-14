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

/**
 * 构造一个 async (exMem, incoming) => {winner, confidence, reason} | null
 * - apiKey 缺失 => 直接返回 null（确定性回退）
 * - 调用 DeepSeek OpenAI 兼容 /chat/completions，要求模型返回 JSON
 */
function makeDeepSeekLLM(opts = {}) {
  const apiKey = opts.apiKey || process.env.DEEPSEEK_API_KEY || '';
  if (!apiKey) return null; // 无密钥 => 不启用 LLM
  const baseURL = opts.baseURL || process.env.DEEPSEEK_BASE_URL || DEFAULT_BASE;
  const model = opts.model || process.env.DEEPSEEK_MODEL || DEFAULT_MODEL;
  const timeoutMs = opts.timeoutMs || 15000;

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
      const parsed = JSON.parse(text);
      if (parsed.winner !== 'incoming' && parsed.winner !== 'existing') return null;
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

module.exports = { makeDeepSeekLLM, DEFAULT_BASE, DEFAULT_MODEL };
