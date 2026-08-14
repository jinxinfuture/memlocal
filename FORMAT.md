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
- **同步**：从 store 渲染全部 9 平台格式 → 写回（默认沙箱 `~/.memlocal/writes/`；`--real` 自动探测各平台真实路径——已存在的真实配置文件优先更新，项目级路径可新建，绝不往用户主目录撒新文件；Cursor 命中 `.cursor/rules` 目录时写 `memlocal-memory.mdc`）。
- **抽取**：从一段对话/文本自动抽出原子事实（`core/extract.js`，过滤提问/指令/语气词/临时日程），可选 LLM 增强。
- **监听**：`memlocal watch` 检测各 agent 记忆文件变化（mtime+size），自动 `import` + `sync`。
- **对账**：新事实进入时检测矛盾/更新（见 `core/reconcile.js`），返回 plan 由调用方决定 apply。

## 4. CLI 接口（一行命令同步）

```bash
memlocal init                           # 初始化 ~/.memlocal（store + config）
memlocal status                         # 统计、已支持平台、真实写回探测
memlocal serve                          # 启动 HTTP 服务（默认 :4173）
memlocal import                         # 扫描 cwd + 用户主目录 + samples/，导入到 store
memlocal sync [--dry-run] [--real] [--platforms p1,p2]   # 同步全部 9 平台（默认沙箱；--real 自动探测真实路径）
memlocal extract --text "..." [--file F] [--llm] [--apply]  # 从文本抽取记忆
memlocal watch [--interval N] [--real]  # 监听变化自动导入+同步
memlocal export --platform claude       # 打印某平台渲染结果
memlocal search "喜欢" [--limit 5]      # 检索打分排序
memlocal reconcile --content "用户现在吃素了" [--apply]  # 提交新事实并对账
memlocal reflect [--apply]              # 反思/压缩零散事实
memlocal backup / backups / restore --file <备份>  # 备份恢复
memlocal export-all                     # 导出全部记忆
```

任何 code agent 只需 `memlocal import && memlocal sync --real` 即可完成跨应用记忆同步。

## 5. 设计原则

- **记忆 ≠ 文档**：文档是传输格式，canonical store 才是真相源。
- **本地优先、用户拥有**：数据文件在用户机器上，不强制上云。
- **可重放、可审计**：每次对账/压缩返回 plan，apply 才落盘；写回前自动 .bak 备份；store 内建 `audit` 日志（最多 200 条）记录所有写操作，`memlocal audit` 可查。
- **容错**：store.json 损坏时自动备份 `.corrupt-<时间戳>` 并重建，绝不静默清空用户记忆；旧版本数据自动迁移（v1 → v2 补 audit）。
