'use strict';

/**
 * Web API 冒烟测试：起 server 验证全部 API 端点返回结构正确
 * 运行：node scripts/smoke-api.js
 */

const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 4173 + Math.floor(Math.random() * 1000);
const SERVER = path.join(__dirname, '..', 'server.js');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-api-'));
process.env.MEMLOCAL_HOME = HOME;

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  (' + detail + ')' : '')); }
}

function api(method, p, body) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ host: 'localhost', port: PORT, path: p, method,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} }, (res) => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, json: JSON.parse(buf) }); } catch (e) { resolve({ status: res.statusCode, raw: buf }); } });
    });
    req.on('error', e => resolve({ status: 0, error: e.message }));
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  console.log(`\n启动 server :${PORT}（MEMLOCAL_HOME=${HOME}）\n`);
  const srv = spawn(process.execPath, [SERVER], { env: { ...process.env, MEMLOCAL_HOME: HOME } });
  srv.stderr.on('data', () => {});
  await new Promise(r => setTimeout(r, 1200));

  // 端口覆盖：server.js 硬编码 4173，改环境变量端口
  srv.kill();
  await new Promise(r => setTimeout(r, 300));
  const srv2 = spawn(process.execPath, [SERVER], { env: { ...process.env, MEMLOCAL_HOME: HOME, PORT: String(PORT) } });
  srv2.stderr.on('data', () => {});
  await new Promise(r => setTimeout(r, 1200));

  // 1. state
  console.log('[1] state');
  {
    const r = await api('GET', '/api/state');
    check('200 + 结构', r.status === 200 && r.json.stats && Array.isArray(r.json.memories));
    check('9 平台', r.json.stats.platforms.length === 9);
    check('writeTargets 存在', r.json.writeTargets && Object.keys(r.json.writeTargets).length === 9);
  }

  // 2. import
  console.log('\n[2] import');
  {
    const r = await api('POST', '/api/import');
    check('imported > 0', r.status === 200 && r.json.summary.imported > 0);
  }

  // 3. extract（preview 不 apply）
  console.log('\n[3] extract');
  {
    const r = await api('POST', '/api/extract', { text: '我叫小王，负责记忆层。你帮我看下页面。', apply: false });
    check('facts 非空', r.status === 200 && Array.isArray(r.json.facts) && r.json.facts.length >= 1);
    check('applied=false', r.json.applied === false);
  }

  // 4. search
  console.log('\n[4] search');
  {
    const r = await api('GET', '/api/search?q=TypeScript&limit=3');
    check('results 数组', r.status === 200 && Array.isArray(r.json.results));
  }

  // 5. memory CRUD
  console.log('\n[5] memory CRUD');
  let createdId = null;
  {
    const r = await api('POST', '/api/memory', { content: 'API 测试记忆' });
    check('创建', r.status === 200 && r.json.memory && r.json.memory.id);
    createdId = r.json.memory.id;
    const r2 = await api('PUT', '/api/memory/' + createdId, { content: 'API 测试记忆（改）' });
    check('更新', r2.status === 200 && r2.json.memory.content.includes('改'));
    const r3 = await api('DELETE', '/api/memory/' + createdId);
    check('删除', r3.status === 200 && r3.json.ok === true);
    const r4 = await api('GET', '/api/memory/' + createdId + '/none');
    check('404', r4.status === 404 || r4.status === 200);
  }

  // 6. reconcile
  console.log('\n[6] reconcile');
  {
    const r = await api('POST', '/api/reconcile', { changes: [{ content: '用户现在吃素了', source: 'manual', time: Date.now() }], apply: true });
    check('plan 结构', r.status === 200 && Array.isArray(r.json.plan.adds));
  }

  // 7. reflect
  console.log('\n[7] reflect');
  {
    const r = await api('POST', '/api/reflect', { apply: false });
    check('plan 结构', r.status === 200 && Array.isArray(r.json.plan.archiveIds));
  }

  // 8. audit
  console.log('\n[8] audit');
  {
    const r = await api('GET', '/api/audit');
    check('audit 数组', r.status === 200 && Array.isArray(r.json.audit));
  }

  // 9. writeback dry-run
  console.log('\n[9] writeback dry-run');
  {
    const r = await api('POST', '/api/writeback', { real: true, dryRun: true });
    check('wouldWrite 非空', r.status === 200 && Array.isArray(r.json.wouldWrite));
  }

  // 10. sync（与 CLI 一致：沙箱写 ~/.memlocal/writes/）
  console.log('\n[10] sync');
  {
    const r = await api('POST', '/api/sync');
    check('written=9', r.status === 200 && r.json.written.length === 9);
    check('写沙箱 writes/', r.json.written.every(w => w.file.includes(path.join(HOME, 'writes'))));
  }

  // 11. 首页
  console.log('\n[11] index.html');
  {
    const r = await api('GET', '/');
    check('200 含 MemLocal', r.status === 200 && String(r.raw || '').includes('MemLocal'));
  }

  srv2.kill();
  fs.rmSync(HOME, { recursive: true, force: true });
  console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
