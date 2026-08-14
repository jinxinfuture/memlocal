# MemLocal 开放格式标准（Open Memory Format）

> 目标：任何 code agent（Claude Code / Cursor / Windsurf / ChatGPT / 通用）都能用**一行命令**
> 把自己的记忆同步进同一份「用户拥有、本地优先」的 canonical store。

## 1. Canonical Store（真相源）

单一 JSON 文件，默认路径 `~/.memlocal/store.json`（可用环境变量 `MEMLOCAL_HOME` 覆盖；旧布局 `<项目>/data/store.json` 自动兼容）：

```jsonc
{
  "version": 1,
  "memories": [
    {
      "id": "m_<hex>",        // 全局唯一
      "content": "用户爱吃牛排", // 一条事实的自然语言文本
      "type": "preference",    // fact | preference | project | identity | context | summary
      "source": "claude",      // 来源平台/手动：manual/claude/cursor/windsurf/chatgpt/generic/reflect
      "sourceFile": "",        // 导入自哪个文件（可选）
      "createdAt": 1700000000000,
      "updatedAt": 1700000000000,
      "confidence": 0.9,       // 0..1，越高越可信
      "archived": false,       // 被反思/压缩归档的零散事实（导出时跳过）
      "stale": false           // 标记过期（对账时忽略）
    }
  ],
  "lastImport": null,
  "lastSync": null,
  "lastReflect": null,
  "connections": {}
}
```

**准入规则**：`content` 为不可再分的事实单元（一句话一条）。结构化字段（type/source/confidence）
是元数据，不是事实本身——可以重新推断、重新打分，不损失信息。

## 2. 平台导出格式

每个 agent 一种适配器，从 canonical 反生成其原生格式：

| 平台 | 文件 | 格式 | 类型字段 |
|------|------|------|----------|
| claude | `CLAUDE.md` | Markdown（按 type 分 `##` 节） | 由 `# 标题` 推断 |
| cursor | `.cursorrules` | Markdown | 同上 |
| windsurf | `.windsurfrules` | Markdown | 同上 |
| chatgpt | `memory.json` | `{ "memories": [{content,type}] }` | 显式 type |
| generic | `MEMORY.md` | Markdown | 由 `# 标题` 推断 |

Markdown 适配器规则：
- 每条事实一行 `- <content>`
- 按 type 归到对应 `## 标题`（身份/偏好/项目/背景/事实）
- `archived:true` 的零散事实不导出（其摘要由 `summary` 类型记忆承载）

## 3. 同步契约（幂等）

- **导入**：解析各平台原生文件 → 归一 `content` → 与 store 去重（精确相同则 skip，矛盾则走对账）。
- **同步**：从 store 渲染各平台格式 → 写回目标目录（默认 `~/.memlocal/writes/`，真实路径在 `~/.memlocal/config.json` 的 `realTargets` 中显式配置后由 `writeback --real` 启用）。
- **对账**：新事实进入时检测矛盾/更新（见 `core/reconcile.js`），返回 plan 由调用方决定 apply。

## 4. CLI 接口（一行命令同步）

```bash
node cli.js serve                       # 启动 HTTP 服务（默认 :4173）
node cli.js import                      # 扫描 samples/ + 工作区，导入到 store
node cli.js sync                        # 从 store 同步到 exports/
node cli.js writeback [--dry-run] [--real]   # 写回（默认沙箱，--real 需配置）
node cli.js export --platform claude    # 打印某平台渲染结果
node cli.js search "喜欢" [--limit 5]   # 检索打分排序
node cli.js reconcile --content "用户现在吃素了" [--apply]  # 提交新事实并对账
node cli.js reflect [--apply]           # 反思/压缩零散事实
```

任何 code agent 只需 `node cli.js import && node cli.js sync` 即可完成跨应用记忆同步。

## 5. 设计原则

- **记忆 ≠ 文档**：文档是传输格式，canonical store 才是真相源。
- **本地优先、用户拥有**：数据文件在用户机器上，不强制上云。
- **可重放、可审计**：每次对账/压缩返回 plan，apply 才落盘；写回前自动 .bak 备份。
