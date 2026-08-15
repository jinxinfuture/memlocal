# MemLocal HTTP API 文档

> `memlocal serve` 启动 Web 面板（默认 `:4173`）时暴露 HTTP API。
> 本地服务，无鉴权——**只监听本机**，任何本地进程可调用。
> 这让 code agent / 脚本 / 其它应用能通过 HTTP 读写统一记忆。

## 通用约定

- Base URL：`http://localhost:4173`
- 全部返回 JSON；错误返回 `{ "error": "..." }` 与对应状态码
- 端口可用环境变量 `PORT` 覆盖

## 端点一览

| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/` | Web 面板 HTML |
| GET | `/api/state` | 全部记忆 + 统计 + 写回目标 + 最近操作时间 |
| POST | `/api/import` | 扫描导入各 agent 记忆（cwd/home/samples） |
| POST | `/api/extract` | 从文本抽取事实（可选 apply） |
| GET | `/api/search?q=&limit=` | 检索打分排序 |
| POST | `/api/memory` | 手动添加记忆 |
| PUT | `/api/memory/:id` | 更新记忆 |
| DELETE | `/api/memory/:id` | 删除记忆 |
| POST | `/api/reconcile` | 提交新事实并对账（可 apply） |
| POST | `/api/reflect` | 反思压缩（可 apply） |
| GET | `/api/audit` | 审计日志 |
| POST | `/api/writeback` | 写回（real/dry-run 参数） |
| POST | `/api/sync` | 同步全部平台（与 CLI sync 一致） |
| GET | `/api/exports/:platform` | 查看某平台渲染结果 |

---

## 1. GET /api/state

```bash
curl http://localhost:4173/api/state
```

```jsonc
{
  "memories": [ { "id": "m_..", "content": "...", "type": "preference", "source": "claude", "confidence": 0.75 } ],
  "connections": {},
  "stats": { "total": 83, "bySource": { "claude": 56 }, "platforms": [ "claude", "cursor", ... ] },
  "lastImport": 1700000000000, "lastSync": null, "lastReflect": null,
  "writeTargets": { "claude": { "file": "/path/CLAUDE.md", "explicit": false, "detected": true }, ... },
  "home": "/Users/you/.memlocal"
}
```

## 2. POST /api/import

```bash
curl -X POST http://localhost:4173/api/import
```

```jsonc
{ "summary": { "imported": 12, "updated": 0, "skipped": 5, "sources": { "claude": 8 } },
  "candidates": [ { "platform": "claude", "label": "Claude Code", "file": "/path/CLAUDE.md" } ] }
```

## 3. POST /api/extract

从文本抽取原子事实。`apply: true` 时写入 store（会先经过对账）。

```bash
curl -X POST http://localhost:4173/api/extract \
  -H 'Content-Type: application/json' \
  -d '{"text":"我叫小王，负责记忆层。我讨厌香菜。","apply":false}'
```

```jsonc
{ "facts": [ { "content": "我叫小王，负责记忆层。", "type": "context" } ],
  "plan": { "adds": 2, "deletes": 0, "needsReview": 0 }, "applied": false }
```

## 4. GET /api/search

```bash
curl "http://localhost:4173/api/search?q=%E5%92%96%E5%95%A1&limit=3"
```

```jsonc
{ "query": "咖啡", "results": [
  { "memory": { "id": "..", "content": "..", "type": ".." },
    "score": 0.84, "breakdown": { "recency": 1, "importance": 0.81, "relevance": 0.7 } } ] }
```

评分 = `recency × importance × relevance`，只返回相关条目（避免整文档注入）。

## 5. memory CRUD

```bash
# 添加
curl -X POST http://localhost:4173/api/memory \
  -H 'Content-Type: application/json' \
  -d '{"content":"用户偏好用 pnpm","type":"preference"}'

# 更新
curl -X PUT http://localhost:4173/api/memory/m_xxx \
  -H 'Content-Type: application/json' \
  -d '{"content":"用户现在偏好用 npm"}'

# 删除
curl -X DELETE http://localhost:4173/api/memory/m_xxx
```

## 6. POST /api/reconcile

```bash
curl -X POST http://localhost:4173/api/reconcile \
  -H 'Content-Type: application/json' \
  -d '{"changes":[{"content":"用户现在吃素了","source":"manual","time":1700000000000}],"apply":true}'
```

```jsonc
{ "plan": { "adds": [...], "deletes": [...], "needsReview": [...], "reasons": [...] }, "applied": true }
```

## 7. POST /api/reflect

```bash
curl -X POST http://localhost:4173/api/reflect -H 'Content-Type: application/json' -d '{"apply":false}'
```

```jsonc
{ "plan": { "archiveIds": [...], "summaries": [...], "groups": [...] }, "applied": false }
```

## 8. GET /api/audit

```bash
curl "http://localhost:4173/api/audit?limit=20"
```

```jsonc
{ "audit": [ { "at": 1700000000000, "action": "import", "detail": "新增 12 条 / ..." } ] }
```

## 9. POST /api/writeback

```bash
# 预览（不落盘）
curl -X POST http://localhost:4173/api/writeback \
  -H 'Content-Type: application/json' -d '{"real":true,"dryRun":true}'

# 真实写回（自动探测路径 + .bak 备份）
curl -X POST http://localhost:4173/api/writeback \
  -H 'Content-Type: application/json' -d '{"real":true}'
```

```jsonc
{ "written": [ { "platform": "claude", "file": "/path/CLAUDE.md", "bytes": 1332, "real": true } ],
  "wouldWrite": [], "backups": ["/path/CLAUDE.md.bak"] }
```

## 10. POST /api/sync

与 CLI `memlocal sync` 行为一致（默认沙箱写 `~/.memlocal/writes/`）。

```bash
curl -X POST http://localhost:4173/api/sync
```

```jsonc
{ "written": [ { "platform": "claude", "file": "~/.memlocal/writes/claude/CLAUDE.md", "bytes": 1332 } ],
  "wouldWrite": [], "backups": [] }
```

---

## Agent 集成示例

**curl 一行检索**（agent 侧可直接用）：

```bash
curl -s "http://localhost:4173/api/search?q=user+preferences&limit=5" | jq -r '.results[].memory.content'
```

**Node.js 集成**：

```js
const res = await fetch('http://localhost:4173/api/search?q=coffee&limit=3');
const { results } = await res.json();
for (const r of results) console.log(r.memory.content, r.score.toFixed(2));
```

**写入记忆**：

```js
await fetch('http://localhost:4173/api/memory', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ content: '用户偏好用 Rust', type: 'preference' }),
});
```
