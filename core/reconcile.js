'use strict';

/**
 * MemLocal — LLM 对账引擎（确定性核心 + 可选 LLM 增强）
 *
 * 解决「同一维度的矛盾 / 过期事实」：
 *   - 矛盾：如「用户爱吃牛排」(+食物) vs 「用户现在吃素了」(−食物)
 *   - 更新：如「每天喝咖啡」 vs 「最近戒了咖啡」（共享关键词 + 状态反转词）
 *
 * 设计：纯逻辑、无 fs 依赖，便于单测与在 server.js 中 require。
 * 默认走确定性启发式；若传入 opts.llm，则对疑难 case 交由 LLM 决策
 * （LLM 应返回 { winner, confidence, reason }）。
 */

const crypto = require('crypto');

// ---------------------------------------------------------------------------
// 词表
// ---------------------------------------------------------------------------
const POS_WORDS = ['喜欢', '爱', '爱用', '坚持', '偏好', '享受', '爱吃', '爱喝', '常用', '依赖', '信赖',
  'like', 'love', 'enjoy', 'prefer', 'use', 'uses', 'used', 'trust'];
const NEG_WORDS = ['讨厌', '不用', '拒绝', '戒', '不吃', '禁食', '远离', '放弃', '停用', '拉黑',
  'hate', 'dislike', 'avoid', 'quit', 'stop', 'stopped', 'never', 'ban', 'dropped'];
const REVERSAL_WORDS = ['现在', '改', '变成', '转', '最近', '如今', '已经', '搬到', '移', '换',
  'now', 'switched', 'changed', 'recently', 'currently', 'these days', 'moved'];

// 反义域：连接「看似不重叠但语义相反」的词（如 牛排 ↔ 素）
const ANTONYM_DOMAINS = [
  { dim: 'diet',     pos: ['牛排', '肉', '荤', '荤菜', '肉食', '烤肉', '牛羊肉'], neg: ['素', '素菜', '素食', '斋', '清淡', '吃素', '蔬食'] },
  { dim: 'caffeine', pos: ['咖啡', '浓茶', '能量饮料'], neg: ['茶', '水', '戒咖啡', '无咖啡因'] },
];

// 实体组：同一「槽位」的不同取值（如编辑器：Vim ↔ Cursor）。提及同组不同成员 =>
// 视为同一事实的新取值（切换），走 update / 替换，而非无关新事实。
const ENTITY_GROUPS = [
  { dim: 'editor', members: ['vim', 'emacs', 'neovim', 'cursor', 'vscode', 'code', 'jetbrains', 'sublime', 'idea', 'webstorm'] },
  { dim: 'os',     members: ['macos', 'mac', 'osx', 'windows', 'win', 'linux', 'ubuntu', 'arch'] },
  { dim: 'lang',   members: ['python', 'javascript', 'typescript', 'go', 'golang', 'rust', 'java', 'c++', 'cpp', 'ruby'] },
];

const ENTITY_LOOKUP = (() => {
  const m = new Map();
  for (const g of ENTITY_GROUPS) for (const mem of g.members) m.set(mem, g.dim);
  return m;
})();

const STOP = new Set(['用户', '我', '他', '她', '它', '我们', '你们', '他们', '这', '那', '的', '了', '也', '都', '就',
  '很', '非常', '比较', '有点', '目前', '平时', '一般', '通常', '总是', '经常', '偶尔', '从来', '一直', '还是',
  '不', '没', '有', '是', '在', '会', '要', '想', '说', '做', '去', '上', '下', '中', '和', '与', '及']);

// 主语 gram：只表示"谁"，不构成话题重叠（否则「用户喜欢爬山」会与「用户吃素」误判矛盾）
const SUBJECT_GRAMS = new Set(['用户', '我们', '你们', '他们', '她们', '大家', '本人']);

// ---------------------------------------------------------------------------
// 基础工具
// ---------------------------------------------------------------------------
function normalize(s) {
  return (s || '').toLowerCase().replace(/[\s.,，。！!?？、;；:：'"'\"()（）\[\]【】\-_/\\]/g, '').trim();
}

function splitTokens(s) {
  const n = normalize(s);
  const tokens = [];
  const ascii = n.match(/[a-z0-9]+/g) || [];
  tokens.push(...ascii);
  const cjk = n.replace(/[a-z0-9]+/g, ' ').replace(/\s+/g, '').split('');
  tokens.push(...cjk);
  return tokens.filter(t => t.length);
}

function polarityOf(s) {
  let p = 0;
  for (const w of POS_WORDS) if (s.includes(w)) p += 1;
  for (const w of NEG_WORDS) if (s.includes(w)) p -= 1;
  if (p !== 0) return p > 0 ? 1 : -1;
  // 反义域推断极性
  const d = domainOf(s);
  if (d) {
    if (d.pos.some(w => s.includes(w))) return 1;
    if (d.neg.some(w => s.includes(w))) return -1;
  }
  return 0;
}

function hasReversal(s) {
  return REVERSAL_WORDS.some(w => s.includes(w));
}

function keywordsOf(s) {
  let t = s;
  for (const w of [...POS_WORDS, ...NEG_WORDS, ...REVERSAL_WORDS]) t = t.split(w).join(' ');
  const toks = splitTokens(t).filter(tok => tok.length >= 1 && !STOP.has(tok));
  const grams = new Set();
  const cjk = normalize(s).replace(/[a-z0-9]+/g, ' ').replace(/\s+/g, '');
  for (let i = 0; i < cjk.length - 1; i++) {
    const g = cjk.slice(i, i + 2);
    if (SUBJECT_GRAMS.has(g)) continue;
    grams.add(g);
  }
  for (const a of toks) if (/[a-z0-9]/.test(a)) grams.add(a);
  return grams;
}

function domainOf(s) {
  for (const d of ANTONYM_DOMAINS) {
    const all = [...d.pos, ...d.neg];
    if (all.some(w => s.includes(w))) return d;
  }
  return null;
}

// 实体槽位识别：返回 [{dim, member}]（小写匹配）
function entitiesOf(s) {
  const n = normalize(s);
  const out = [];
  for (const [member, dim] of ENTITY_LOOKUP) {
    if (n.includes(member)) out.push({ dim, member });
  }
  return out;
}

// 同槽位不同取值 => 切换（如 vim -> cursor）
function entitySwitchOf(a, b) {
  const ea = entitiesOf(a), eb = entitiesOf(b);
  const mapA = new Map(ea.map(e => [e.dim, e.member]));
  const mapB = new Map(eb.map(e => [e.dim, e.member]));
  for (const [dim, member] of mapA) {
    if (mapB.has(dim) && mapB.get(dim) !== member) return dim;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 关系判定：null | 'contradiction' | 'update'
// ---------------------------------------------------------------------------
function relationOf(a, b) {
  const pa = polarityOf(a), pb = polarityOf(b);
  const ka = keywordsOf(a), kb = keywordsOf(b);
  let overlap = false;
  for (const k of ka) if (kb.has(k)) { overlap = true; break; }

  const da = domainOf(a), db = domainOf(b);
  const sameDomain = da && da === db;

  // 矛盾：反向极性 + (关键词重叠 或 同反义域异侧)
  if (pa !== 0 && pb !== 0 && pa * pb < 0) {
    // 反向极性 + 关键词重叠 + 状态反转词 => 同一事实的状态翻转（如 喝咖啡→戒咖啡），判为 update
    if (overlap && (hasReversal(a) || hasReversal(b))) return 'update';
    if (overlap) return 'contradiction';
    if (sameDomain) {
      const aSide = da.pos.some(w => a.includes(w)) ? 'pos' : da.neg.some(w => a.includes(w)) ? 'neg' : null;
      const bSide = db.pos.some(w => b.includes(w)) ? 'pos' : db.neg.some(w => b.includes(w)) ? 'neg' : null;
      if (aSide && bSide && aSide !== bSide) return 'contradiction';
    }
  }

  // 更新：共享关键词 + 任一方含状态反转词（同一事实的新值）
  if (overlap && (hasReversal(a) || hasReversal(b))) return 'update';

  // 更新：同实体槽位不同取值（如 vim -> cursor / macos -> windows），视为切换
  if (entitySwitchOf(a, b)) return 'update';

  return null;
}

// 异步版本：支持 await opts.llmAsync(exMem, incoming) 做疑难决策
async function reconcileAsync(store, changes, opts = {}) {
  const now = opts.now || Date.now();
  const confThresh = opts.confidenceThreshold != null ? opts.confidenceThreshold : 0.5;
  const llm = opts.llmAsync || null; // async (exMem, incoming) => {winner,confidence,reason} | null
  const adds = [], deletes = [], needsReview = [], reasons = [];
  const existing = store.memories || [];
  const cache = makeFeatureCache();
  const exactIndex = new Map();
  for (const m of existing) {
    if (m.stale) continue;
    const k = cache.norm(m.content);
    if (!exactIndex.has(k)) exactIndex.set(k, m);
  }

  for (const ch of changes) {
    const content = (ch.content || '').trim();
    if (!content) continue;
    const time = ch.time != null ? ch.time : now;
    const source = ch.source || 'manual';

    const exact = exactIndex.get(cache.norm(content));
    if (exact) { reasons.push({ content, action: 'skip-exact', id: exact.id }); continue; }

    const conflicts = detectConflicts(existing, content, cache);
    if (conflicts.length === 0) {
      const conf = sourceWeight(source);
      if (conf < confThresh) {
        needsReview.push({ content, source, suggested: 'add', reason: 'low-confidence' });
        reasons.push({ content, action: 'needsReview' });
        continue;
      }
      const mem = { id: newId(), content, type: ch.type || 'fact', source, sourceFile: ch.sourceFile || '', createdAt: time, updatedAt: time, confidence: conf };
      adds.push(mem);
      exactIndex.set(cache.norm(content), mem);
      reasons.push({ content, action: 'add', confidence: conf });
      continue;
    }

    let decision = null;
    if (llm) {
      const exMem = existing.find(m => m.id === conflicts[0].existingId);
      try { decision = await llm(exMem, { content, source, time }); } catch (e) { decision = null; }
    }
    if (!decision) {
      const exMem = existing.find(m => m.id === conflicts[0].existingId);
      const exTime = exMem.updatedAt || exMem.createdAt || 0;
      const incomingNewer = time >= exTime;
      decision = {
        winner: incomingNewer ? 'incoming' : 'existing',
        confidence: incomingNewer ? sourceWeight(source) : (exMem.confidence || 0.7),
        reason: incomingNewer ? 'incoming-is-newer' : 'existing-is-newer',
      };
    }

    if (decision.winner === 'incoming') {
      const conf = decision.confidence != null ? decision.confidence : sourceWeight(source);
      if (conf < confThresh) {
        needsReview.push({ content, source, conflicts, suggested: 'update', reason: 'low-confidence-conflict' });
        reasons.push({ content, action: 'needsReview' });
        continue;
      }
      for (const c of conflicts) deletes.push({ id: c.existingId, reason: 'superseded-by-incoming', relation: c.relation });
      const mem = { id: newId(), content, type: ch.type || 'fact', source, sourceFile: ch.sourceFile || '', createdAt: time, updatedAt: time, confidence: conf };
      adds.push(mem);
      exactIndex.set(cache.norm(content), mem);
      reasons.push({ content, action: 'replace', replaces: conflicts.map(c => c.existingId), relation: conflicts[0].relation, confidence: conf, reason: decision.reason });
    } else {
      needsReview.push({ content, source, conflicts, suggested: 'skip', reason: 'existing-wins' });
      reasons.push({ content, action: 'keep-existing', reason: decision.reason });
    }
  }
  return { adds, deletes, needsReview, reasons };
}

// ---------------------------------------------------------------------------
// 冲突检测（带一次性预计算缓存，避免大规模下 O(N×M×分词) 重复开销）
// ---------------------------------------------------------------------------
function detectConflicts(memories, incomingContent, cache = null) {
  const conflicts = [];
  const incNorm = cache ? cache.norm(incomingContent) : normalize(incomingContent);
  const incKeywords = cache ? cache.keywords(incomingContent) : keywordsOf(incomingContent);
  const incEntities = cache ? cache.entities(incomingContent) : entitiesOf(incomingContent);
  const incDomain = cache ? cache.domain(incomingContent) : domainOf(incomingContent);
  for (const m of memories) {
    if (m.stale) continue;
    const mNorm = cache ? cache.norm(m.content) : normalize(m.content);
    if (mNorm === incNorm) continue; // 精确重复交给 import
    const rel = relationCached(m.content, incomingContent, cache, { incNorm, incKeywords, incEntities, incDomain });
    if (rel) conflicts.push({ existingId: m.id, existingContent: m.content, relation: rel });
  }
  return conflicts;
}

// relationOf 的缓存版本：预计算 incoming 侧特征，只对每条 m 算一次 m 侧特征
function relationCached(a, b, cache, incoming = {}) {
  const pa = cache ? cache.polarity(a) : polarityOf(a);
  const pb = cache ? cache.polarity(b) : polarityOf(b);
  const ka = cache ? cache.keywords(a) : keywordsOf(a);
  const kb = incoming.incKeywords;
  let overlap = false;
  // 小集合交集：选更小的迭代
  const [small, big] = ka.size <= kb.size ? [ka, kb] : [kb, ka];
  for (const k of small) if (big.has(k)) { overlap = true; break; }

  const da = cache ? cache.domain(a) : domainOf(a);
  const db = incoming.incDomain;
  const sameDomain = da && da === db;

  if (pa !== 0 && pb !== 0 && pa * pb < 0) {
    if (overlap && (hasReversal(a) || hasReversal(b))) return 'update';
    if (overlap) return 'contradiction';
    if (sameDomain) {
      const aSide = da.pos.some(w => a.includes(w)) ? 'pos' : da.neg.some(w => a.includes(w)) ? 'neg' : null;
      const bSide = db.pos.some(w => b.includes(w)) ? 'pos' : db.neg.some(w => b.includes(w)) ? 'neg' : null;
      if (aSide && bSide && aSide !== bSide) return 'contradiction';
    }
  }

  if (overlap && (hasReversal(a) || hasReversal(b))) return 'update';

  // 实体切换：incoming 侧预计算，m 侧只查一次
  if (incoming.incEntities && incoming.incEntities.length) {
    const em = cache ? cache.entities(a) : entitiesOf(a);
    const mapA = new Map(em.map(e => [e.dim, e.member]));
    for (const e of incoming.incEntities) {
      if (mapA.has(e.dim) && mapA.get(e.dim) !== e.member) return 'update';
    }
  }

  return null;
}

// 轻量缓存：单次 reconcile 内复用 normalize/keywords/polarity/domain/entities 结果
function makeFeatureCache() {
  const normMap = new Map(), kwMap = new Map(), polMap = new Map(), domMap = new Map(), entMap = new Map();
  return {
    norm: (s) => { let v = normMap.get(s); if (v === undefined) { v = normalize(s); normMap.set(s, v); } return v; },
    keywords: (s) => { let v = kwMap.get(s); if (!v) { v = keywordsOf(s); kwMap.set(s, v); } return v; },
    polarity: (s) => { let v = polMap.get(s); if (v === undefined) { v = polarityOf(s); polMap.set(s, v); } return v; },
    domain: (s) => { let v = domMap.get(s); if (v === undefined) { v = domainOf(s); domMap.set(s, v); } return v; },
    entities: (s) => { let v = entMap.get(s); if (!v) { v = entitiesOf(s); entMap.set(s, v); } return v; },
  };
}

// ---------------------------------------------------------------------------
// 置信度
// ---------------------------------------------------------------------------
function sourceWeight(source) {
  if (source === 'manual') return 0.9;
  if (source === 'generic') return 0.6;
  return 0.75; // claude / cursor / windsurf / chatgpt 导入
}

function newId() {
  return 'm_' + crypto.randomBytes(6).toString('hex');
}

// ---------------------------------------------------------------------------
// 核心：reconcile —— 返回 plan，不修改 store
// ---------------------------------------------------------------------------
function reconcile(store, changes, opts = {}) {
  const now = opts.now || Date.now();
  const confThresh = opts.confidenceThreshold != null ? opts.confidenceThreshold : 0.5;
  const llm = opts.llm || null;
  const adds = [], deletes = [], needsReview = [], reasons = [];
  const existing = store.memories || [];
  const cache = makeFeatureCache();
  const exactIndex = new Map();
  for (const m of existing) {
    if (m.stale) continue;
    const k = cache.norm(m.content);
    if (!exactIndex.has(k)) exactIndex.set(k, m);
  }

  for (const ch of changes) {
    const content = (ch.content || '').trim();
    if (!content) continue;
    const time = ch.time != null ? ch.time : now;
    const source = ch.source || 'manual';

    // 精确重复（Map 索引 O(1)）
    const exact = exactIndex.get(cache.norm(content));
    if (exact) { reasons.push({ content, action: 'skip-exact', id: exact.id }); continue; }

    const conflicts = detectConflicts(existing, content, cache);
    if (conflicts.length === 0) {
      const conf = sourceWeight(source);
      if (conf < confThresh) {
        needsReview.push({ content, source, suggested: 'add', reason: 'low-confidence' });
        reasons.push({ content, action: 'needsReview' });
        continue;
      }
      const mem = { id: newId(), content, type: ch.type || 'fact', source, sourceFile: ch.sourceFile || '', createdAt: time, updatedAt: time, confidence: conf };
      adds.push(mem);
      exactIndex.set(cache.norm(content), mem);
      reasons.push({ content, action: 'add', confidence: conf });
      continue;
    }

    // 有矛盾/更新：时间推理 + 可选 LLM
    let decision = null;
    if (llm) {
      const exMem = existing.find(m => m.id === conflicts[0].existingId);
      decision = llm(exMem, { content, source, time });
    }
    if (!decision) {
      const exMem = existing.find(m => m.id === conflicts[0].existingId);
      const exTime = exMem.updatedAt || exMem.createdAt || 0;
      const incomingNewer = time >= exTime;
      decision = {
        winner: incomingNewer ? 'incoming' : 'existing',
        confidence: incomingNewer ? sourceWeight(source) : (exMem.confidence || 0.7),
        reason: incomingNewer ? 'incoming-is-newer' : 'existing-is-newer',
      };
    }

    if (decision.winner === 'incoming') {
      const conf = decision.confidence != null ? decision.confidence : sourceWeight(source);
      if (conf < confThresh) {
        needsReview.push({ content, source, conflicts, suggested: 'update', reason: 'low-confidence-conflict' });
        reasons.push({ content, action: 'needsReview' });
        continue;
      }
      for (const c of conflicts) deletes.push({ id: c.existingId, reason: 'superseded-by-incoming', relation: c.relation });
      const mem = { id: newId(), content, type: ch.type || 'fact', source, sourceFile: ch.sourceFile || '', createdAt: time, updatedAt: time, confidence: conf };
      adds.push(mem);
      exactIndex.set(cache.norm(content), mem);
      reasons.push({ content, action: 'replace', replaces: conflicts.map(c => c.existingId), relation: conflicts[0].relation, confidence: conf, reason: decision.reason });
    } else {
      needsReview.push({ content, source, conflicts, suggested: 'skip', reason: 'existing-wins' });
      reasons.push({ content, action: 'keep-existing', reason: decision.reason });
    }
  }

  return { adds, deletes, needsReview, reasons };
}

// ---------------------------------------------------------------------------
// 应用 plan（修改 store）
// ---------------------------------------------------------------------------
function applyPlan(store, plan) {
  const delIds = new Set(plan.deletes.map(d => d.id));
  store.memories = (store.memories || []).filter(m => !delIds.has(m.id));
  for (const a of plan.adds) store.memories.push(a);
  return store;
}

module.exports = { reconcile, reconcileAsync, applyPlan, detectConflicts, relationOf, polarityOf, keywordsOf, domainOf, entitiesOf, entitySwitchOf, sourceWeight, makeFeatureCache, relationCached };
