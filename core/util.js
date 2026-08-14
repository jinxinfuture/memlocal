'use strict';

/**
 * MemLocal — 公共工具：归一化、类型推断、ID。
 * server.js / core/adapters.js 共用，避免重复实现。
 */

const crypto = require('crypto');

function normalizeKey(s) {
  return (s || '').toLowerCase().replace(/[\s.,，。！!?？、;；:：'"'\"()（）\[\]【】\-_/\\]/g, '').trim();
}

// 轻量类型推断：决定导出时放进哪个分组
function inferType(content) {
  const c = content.toLowerCase();
  if (/(喜欢|讨厌|偏好|不用|用 ?\w+? ?不用|爱用|拒绝|坚持|习惯|风格|爱吃|爱喝)/.test(c)) return 'preference';
  if (/(项目|在做|负责|产品|创业|公司|团队|客户|创业中)/.test(c)) return 'project';
  if (/(叫 ?\w+|名字|称呼|是 ?\w+ ?人|职业|角色|身份)/.test(c)) return 'identity';
  if (/(住|城市|地点|中国|北京|上海|深圳|杭州|广州|成都|macos|windows|linux|坐标)/.test(c)) return 'context';
  return 'fact';
}

function newId() {
  return 'm_' + crypto.randomBytes(6).toString('hex');
}

module.exports = { normalizeKey, inferType, newId };
