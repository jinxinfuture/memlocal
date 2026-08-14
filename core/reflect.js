'use strict';

/**
 * MemLocal — 反思 / 压缩（智能遗忘）
 *
 * 把零散事实按共享关键词聚类，对成员 >= MIN 的簇生成高层摘要，
 * 原事实标记 archived（仍保留可追溯，不物理删除），新增 summary 记忆。
 * 返回 plan，不突变 store；applyPlan 才落盘。
 *
 * 设计取舍：默认「压缩但不删除」，避免智能遗忘变成智能失忆。
 * 真要彻底遗忘可后续加 gc 步骤（不在本里程碑）。
 */

const crypto = require('crypto');
const reconcile = require('./reconcile');

const MIN_CLUSTER = 3; // 簇内 >= 3 条才值得压成摘要

function cluster(memories) {
  const active = memories.filter(m => !m.archived);
  const parent = new Map();
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent.set(a, b); };

  for (const m of active) parent.set(m.id, m.id);

  // 共享关键词 -> 并查集合并
  const kwIndex = new Map(); // keyword -> [id,...]
  for (const m of active) {
    for (const k of reconcile.keywordsOf(m.content)) {
      if (!kwIndex.has(k)) kwIndex.set(k, []);
      kwIndex.get(k).push(m.id);
    }
  }
  for (const ids of kwIndex.values()) {
    for (let i = 1; i < ids.length; i++) union(ids[0], ids[i]);
  }

  const groups = new Map();
  for (const m of active) {
    const root = find(m.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(m);
  }
  return [...groups.values()].filter(g => g.length >= MIN_CLUSTER);
}

function topicOf(cluster) {
  const freq = new Map();
  for (const m of cluster) {
    for (const k of reconcile.keywordsOf(m.content)) freq.set(k, (freq.get(k) || 0) + 1);
  }
  let best = null, bestN = 0;
  for (const [k, n] of freq) if (n > bestN) { bestN = n; best = k; }
  return best || '通用';
}

function summarize(cluster, topic) {
  const lines = cluster.map(m => `· ${m.content}`).join('\n');
  return `关于「${topic}」的汇总（共 ${cluster.length} 条，已压缩为摘要）:\n${lines}`;
}

function reflectPlan(store, opts = {}) {
  const min = opts.minCluster || MIN_CLUSTER;
  const clusters = cluster(store.memories).filter(c => c.length >= min);
  const archiveIds = [];
  const summaries = [];
  const details = [];
  for (const c of clusters) {
    const topic = topicOf(c);
    const text = summarize(c, topic);
    const summaryId = 'm_' + crypto.randomBytes(6).toString('hex');
    archiveIds.push(...c.map(m => m.id));
    summaries.push({
      id: summaryId, content: text, type: 'summary', source: 'reflect',
      sourceFile: '', createdAt: opts.now || Date.now(), updatedAt: opts.now || Date.now(),
      confidence: 0.9, archived: false,
    });
    details.push({ topic, ids: c.map(m => m.id), summaryId });
  }
  return { clusters: details, archiveIds, summaries };
}

function applyPlan(store, plan) {
  const arch = new Set(plan.archiveIds || []);
  for (const m of store.memories) if (arch.has(m.id)) m.archived = true;
  for (const s of plan.summaries || []) store.memories.push(s);
  store.lastReflect = plan.appliedAt || Date.now();
  return store;
}

function run(store, opts = {}) {
  const plan = reflectPlan(store, opts);
  if (opts.apply) applyPlan(store, { ...plan, appliedAt: opts.now || Date.now() });
  return plan;
}

module.exports = { reflectPlan, applyPlan, run, cluster, topicOf, MIN_CLUSTER };
