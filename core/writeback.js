'use strict';

/**
 * MemLocal — 真实写回适配器（Issue #1）
 *
 * 把 canonical 记忆渲染后写回目标路径。
 *
 * 安全模型（默认不碰个人文件）：
 *   - 默认目标目录 = <memlocal>/data/writes/（项目内沙箱，进 .gitignore，不污染个人配置）
 *   - 「真实写回各 agent 配置路径」需显式开启：opts.real=true 且 data/config.json 里
 *     realTargets 配置了目标路径。默认 realTargets 为空 => 真实模式也不会动任何个人文件。
 *   - 覆盖前自动备份（.bak），可用 listBackups / restore 回滚。
 *   - dryRun=true 只列出将要写的内容，不落盘。
 */

const fs = require('fs');
const path = require('path');
const storeMod = require('./store');
const { PLATFORM_TARGETS, renderFor } = require('./render');

function loadConfig() {
  return storeMod.loadConfig();
}

function defaultTargetDir() {
  return path.join(storeMod.homeDir(), 'writes');
}

function backupFile(fp) {
  if (!fs.existsSync(fp)) return null;
  const bak = fp + '.bak';
  fs.copyFileSync(fp, bak);
  return bak;
}

/**
 * @param {object} store  canonical store
 * @param {object} opts   { targetDir?, real?, dryRun?, platforms? }
 * @returns {object} { written:[], wouldWrite:[], backups:[] }
 */
function applyWrites(store, opts = {}) {
  const targetDir = opts.targetDir || defaultTargetDir();
  const dryRun = !!opts.dryRun;
  const platforms = opts.platforms || Object.keys(PLATFORM_TARGETS);

  const written = [];
  const wouldWrite = [];
  const backups = [];

  for (const platform of platforms) {
    const t = PLATFORM_TARGETS[platform];
    if (!t) continue;
    const content = renderFor(store, platform);
    const fp = path.join(targetDir, t.dir, t.filename);
    wouldWrite.push({ platform, file: fp, bytes: Buffer.byteLength(content) });
    if (dryRun) continue;
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    const bak = backupFile(fp);
    if (bak) backups.push(bak);
    fs.writeFileSync(fp, content, 'utf8');
    written.push({ platform, file: fp, bytes: Buffer.byteLength(content) });
  }

  // 真实写回：仅当 opts.real 且 config 显式配置
  if (opts.real) {
    const cfg = loadConfig();
    const realTargets = cfg.realTargets || {};
    for (const [platform, realPath] of Object.entries(realTargets)) {
      const t = PLATFORM_TARGETS[platform];
      if (!t) continue;
      const content = renderFor(store, platform);
      const fp = realPath;
      wouldWrite.push({ platform, file: fp, bytes: Buffer.byteLength(content), real: true });
      if (dryRun) continue;
      fs.mkdirSync(path.dirname(fp), { recursive: true });
      const bak = backupFile(fp);
      if (bak) backups.push(bak);
      fs.writeFileSync(fp, content, 'utf8');
      written.push({ platform, file: fp, bytes: Buffer.byteLength(content), real: true });
    }
  }

  return { written, wouldWrite, backups };
}

function listBackups(targetDir) {
  const base = targetDir || defaultTargetDir();
  const out = [];
  try {
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const fp = path.join(dir, e.name);
        if (e.isDirectory()) walk(fp);
        else if (e.name.endsWith('.bak')) out.push(fp);
      }
    };
    walk(base);
  } catch (e) {}
  return out;
}

function restore(backupPath) {
  if (!backupPath || !fs.existsSync(backupPath)) return false;
  const target = backupPath.replace(/\.bak$/, '');
  fs.copyFileSync(backupPath, target);
  return true;
}

module.exports = { applyWrites, listBackups, restore, defaultTargetDir, loadConfig };
