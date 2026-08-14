'use strict';

/**
 * MemLocal — 事实抽取器：从一段对话/文本中抽出「值得记住」的原子事实
 *
 * 两条路径：
 *   - 确定性（默认，零依赖）：按句子切分 + 规则过滤（有主语、有信息量、非提问/指令）
 *   - LLM 增强（可选）：core/llm.js 的 makeExtractor，把整段文本交给模型抽取结构化事实
 *
 * 被 cli.js 的 `extract` 命令使用：extract -> reconcile -> apply -> save。
 */

// 语气词 / 无信息量内容过滤
const NOISE_RE = /^(嗯|哦|好的|ok|好|行|没问题|了解|明白了|收到|谢谢|多谢|辛苦|加油|对了|那个|这个|然后|就是说|其实|感觉|好像|应该|可能|大概|也许|回头|下次|改天|待会|一会儿|马上|等等|稍等)/i;

// 提问 / 指令 / 闲聊标记：这类句子不该进记忆
const QUESTION_RE = /[?？]$|[吗么呢吧]$|^请|^帮我|^你帮我|^帮我|^给|^可以|^能不能|^请问|^如何|^怎么|^什么|^为什么|^哪|^多少|^什么时候|^是不是|^有没有|^你(觉得|认为|知道|看|说|听|会|能)|\b(please|can you|could you|would you|help me|how do|what is|why|should i|do you)\b/i;

// 临时日程/事件：过完就失效，不是长期记忆（如「明天开会」「周末聚餐」「下周发版」）
const EVENT_RE = /(明天|后天|今天|今晚|周末|下周|下个月|待会|稍后|马上|这次|下次|昨天).*(开会|聚餐|吃饭|聚会|见面|出差|旅游|休假|请假|睡觉|起床|加班|通勤|发布|发版|上线|截止|deadline)/;

// 真正值得记的主语 / 身份线索：没有这些的句子大概率不是「关于用户的持久事实」
const SUBJECT_HINTS = ['我', '用户', '我们', '我的', '我喜', '我讨', '我经', '我住', '我在', '我负', '我正', '我打', '我写', '我学', '我买', '我换', '我用', '我觉', '我想', '我计划', '我们团队', '本公司', '本人',
  'i ', 'i\'m', 'i am', 'my ', 'we ', 'we\'re', 'our ', 'user ', 'the user', 'he ', 'she '];

// 明显是个人偏好/项目/身份的关键词（即使没主语也值得记）
const STRONG_HINTS = ['喜欢', '讨厌', '偏好', '爱用', '习惯', '风格', '负责', '在做', '创业', '产品', '项目', '公司', '团队', '名字', '住', '城市', '职业', '角色', '用 ', '不用', '拒绝', '坚持', '目标是', '最近在',
  'like', 'love', 'hate', 'prefer', 'enjoy', 'work on', 'working on', 'build', 'building', 'live in', 'based in', 'name is', 'my name', 'favorite', 'favourite', 'use ', 'uses ', 'using '];

function splitSentences(text) {
  // 中文按 。！？；切，英文按 . ! ? 切（句点后跟空格或句尾）；保留分隔符避免信息丢失
  const parts = String(text || '')
    .replace(/\r/g, '')
    .split(/(?<=[。！？；!?;])\s*|(?<=\.)\s+|\n+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
  return parts;
}

/**
 * 确定性抽取：文本 -> [{content, type}]
 */
function extractDeterministic(text, opts = {}) {
  const out = [];
  const seen = new Set();
  for (const sent of splitSentences(text)) {
    const clean = sent.trim();
    if (clean.length < 4) continue;                       // 太短
    if (clean.length > 200) continue;                     // 太长（可能是整段话）
    if (NOISE_RE.test(clean)) continue;                   // 语气词
    if (QUESTION_RE.test(clean)) continue;                // 提问/指令
    if (EVENT_RE.test(clean)) continue;                   // 临时日程/事件
    if (/^\s*(refactor|fix|feat|todo|TODO|测试|调试|报错|error|bug)\b/i.test(clean)) continue; // 纯技术动作
    const hasSubject = SUBJECT_HINTS.some(h => clean.includes(h));
    const hasStrong = STRONG_HINTS.some(h => clean.toLowerCase().includes(h));
    if (!hasSubject && !hasStrong) continue;              // 与用户无关
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const { inferType } = require('./util');
    out.push({ content: clean, type: inferType(clean) });
  }
  return out;
}

/**
 * 统一入口：text -> [{content, type}]
 * opts.extractor 为可选 async (text) => [{content,type}] | null（来自 llm.makeExtractor）
 */
async function extract(text, opts = {}) {
  const llmExtractor = opts.extractor || null;
  if (llmExtractor) {
    try {
      const facts = await llmExtractor(text);
      if (Array.isArray(facts) && facts.length) return facts;
    } catch (e) { /* 回退确定性 */ }
  }
  return extractDeterministic(text, opts);
}

module.exports = { extract, extractDeterministic, splitSentences };
