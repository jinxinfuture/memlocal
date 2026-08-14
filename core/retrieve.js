'use strict';

/**
 * MemLocal — 检索打分
 *
 * score = recency × importance × relevance（三者均归一化到 0..1）
 *   - recency:   基于 updatedAt 的时间衰减（半衰期 30 天）
 *   - importance: 类型权重 × 置信度
 *   - relevance: 查询词与记忆关键词的重叠召回率
 *
 * 纯逻辑、无副作用，便于单测。
 */

const reconcile = require('./reconcile');

const TYPE_WEIGHT = { identity: 1.0, preference: 0.9, project: 0.85, context: 0.8, fact: 0.7, summary: 0.6 };

const HALF_LIFE_DAYS = 30;
const DAY = 86400000;

function recencyOf(mem, now) {
  const t = mem.updatedAt || mem.createdAt || now;
  const ageDays = Math.max(0, (now - t) / DAY);
  return Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
}

function importanceOf(mem) {
  const tw = TYPE_WEIGHT[mem.type] != null ? TYPE_WEIGHT[mem.type] : 0.7;
  const conf = mem.confidence != null ? mem.confidence : 0.7;
  return Math.max(0, Math.min(1, tw * 0.6 + conf * 0.4));
}

function relevanceOf(mem, queryKeywords) {
  if (queryKeywords.size === 0) return 1; // 无查询时视为全相关（按其它维度排序）
  const mk = reconcile.keywordsOf(mem.content);
  let hit = 0;
  for (const k of queryKeywords) if (mk.has(k)) hit++;
  return hit / queryKeywords.size;
}

function queryKeywordsOf(q) {
  return reconcile.keywordsOf(q);
}

function scoreMemory(mem, queryKeywords, now) {
  const rec = recencyOf(mem, now);
  const imp = importanceOf(mem);
  const rel = relevanceOf(mem, queryKeywords);
  const score = rec * imp * rel;
  return { score, breakdown: { recency: +rec.toFixed(3), importance: +imp.toFixed(3), relevance: +rel.toFixed(3) } };
}

function search(store, query, opts = {}) {
  const now = opts.now || Date.now();
  const limit = opts.limit || 10;
  const qk = query ? queryKeywordsOf(query) : new Set();
  const ranked = store.memories
    .filter(m => !m.archived)
    .map(m => {
      const r = scoreMemory(m, qk, now);
      return { memory: m, score: +r.score.toFixed(4), breakdown: r.breakdown };
    })
    .sort((a, b) => b.score - a.score);
  return limit ? ranked.slice(0, limit) : ranked;
}

module.exports = { search, scoreMemory, recencyOf, importanceOf, relevanceOf, queryKeywordsOf, TYPE_WEIGHT };
