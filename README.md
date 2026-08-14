# MemLocal — 跨应用、本地优先、用户拥有的统一记忆层

[![CI](https://github.com/jinxinfuture/memlocal/actions/workflows/ci.yml/badge.svg)](https://github.com/jinxinfuture/memlocal/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**让所有 code agent 共享同一份属于你、本地优先的公用记忆。**

Claude Code / Cursor / Windsurf / Codex / Gemini / Aider / GitHub Copilot / ChatGPT 的记忆，
一键**聚合到一个本地文件**（canonical store），再从这份「唯一真相源」**反向同步**回每个 Agent。
你的记忆不再锁死在单个平台里。

> 设计原则：**别在单个代码平台的院子里种菜，去种连接所有院子的那条路。**

---

## 为什么是它（护城河）

- **记忆 ≠ 一个文档**：文档是传输格式，canonical store 才是真相源。纯文档在「规模变大 / 多 agent 改写 / 事实会变」时会塌（详见 `docs/design-memory-vs-document.md`）。
- **本地优先、用户拥有数据**：记忆文件在你机器上（`~/.memlocal/`），不强制上云，可审计、可导出。
- **跨平台中间层**：没有任何单一 Agent 会去兼容竞争对手的记忆——开放格式 + 本地优先这条「连接所有院子的路」，是平台干不死的位置。
- **智能对账**：自动检测矛盾 / 更新 / 实体切换，按时间推理 + 置信度门控决定替换还是留待人工（`core/reconcile.js`）。

---

## 安装

```bash
npm install -g memlocal      # 或临时用：npx memlocal
```

零外部依赖，纯 Node 内置模块（Node ≥ 18）。

### 从源码运行（开发 / 未发布时）

```bash
git clone https://github.com/jinxinfuture/memlocal.git
cd memlocal
npm test                     # 先跑测试（4 套，全绿）
node cli.js init             # 或 npm run memlocal -- init
node cli.js import && node cli.js sync --real
node cli.js serve            # Web 面板 :4173
```

### 发布到 npm（维护者）

```bash
npm test                     # 发布前自检（prepublishOnly 也会跑）
npm login                    # 首次需登录 npm
npm publish                  # 发 memlocal@x.y.z
```

发布前建议 `npm pack --dry-run` 检查 tarball 内容（应含 cli.js / core/ / public/ / samples/ / 文档，不含 data/ 与 exports/）。

## 一行命令同步

```bash
memlocal init                           # 初始化 ~/.memlocal（store + 默认 config）
memlocal import                         # 扫描 当前目录 + 用户主目录，聚合各 agent 记忆
memlocal sync                           # 同步到全部 9 平台（默认写 ~/.memlocal/writes/ 沙箱）
memlocal sync --dry-run                 # 预览将要写回的内容（不落盘）
memlocal sync --real                    # 真实写回：自动探测各 agent 真实路径 + 写前 .bak 备份
memlocal extract --text "我叫小王，负责记忆层。我讨厌香菜。" --apply   # 从对话自动长出记忆
```

日常只需：`memlocal import && memlocal sync --real`

## 全部命令

| 命令 | 作用 |
|------|------|
| `memlocal init` | 初始化 `~/.memlocal`（store + 默认 config） |
| `memlocal import` | 扫描 cwd + 用户主目录 + 样例，聚合各 agent 记忆到 store（去重） |
| `memlocal sync [--dry-run] [--real] [--platforms p1,p2]` | 同步到全部 9 平台。默认沙箱 `~/.memlocal/writes/`；`--real` 自动探测各 agent 真实记忆路径（`~/.claude/CLAUDE.md`、项目 `.cursorrules` 等），写前自动 `.bak` 备份；`--platforms` 可只同步指定平台 |
| `memlocal extract --text "..." [--file F] [--llm] [--apply]` | 从一段对话/文本自动抽取「值得记住的原子事实」并入库（过滤提问/指令/语气词/临时日程；`--llm` 用 LLM 抽取，未配 key 自动回退确定性） |
| `memlocal export --platform claude` | 打印某平台的渲染结果 |
| `memlocal search "<q>" [--limit N]` | 检索打分排序（`recency × importance × relevance`） |
| `memlocal reconcile --content "..." [--apply] [--llm]` | 提交新事实并对账（可选 LLM 增强） |
| `memlocal reflect [--apply]` | 反思 / 压缩零散事实为摘要（智能遗忘） |
| `memlocal audit [--limit N]` | 查看记忆操作审计日志（透明可控） |
| `memlocal config get\|set <key> <value>` | 查看/设置配置（如 `deepseek.apiKey sk-xxx`、`realTargets.claude ~/.claude/CLAUDE.md`） |
| `memlocal backup` / `backups` / `restore --file <备份>` | 创建 / 列出 / 恢复备份（gzip 压缩到 `~/.memlocal/backups/`，恢复前自动另存安全备份） |
| `memlocal export-all` | 导出全部记忆（合并 Markdown + 原始 JSON，可迁移到其它工具） |
| `memlocal watch [--interval N] [--real]` | 监听各 agent 记忆文件变化，自动导入 + 同步（Ctrl+C 停止） |
| `memlocal serve` | 启动 Web 面板（默认 `:4173`，含「从文本抽取记忆」+ 搜索 + 真实写回预览） |
| `memlocal status` | 查看 store 统计、已支持 agent、真实写回配置 |

## 数据位置

- 真相源：`~/.memlocal/store.json`（可用环境变量 `MEMLOCAL_HOME` 覆盖，便于 demo / 测试；若旧布局 `<项目>/data/store.json` 已存在则沿用）。
- 配置：`~/.memlocal/config.json`（`realTargets` 显式指定某平台的写回路径；不配置时 `sync --real` 会自动探测）。
- 备份：每次真实写回前自动生成 `.bak`；store.json 损坏时自动备份为 `.corrupt-<时间戳>` 并重建，不静默清空记忆。
- 审计：store 内置 `audit` 日志（最多 200 条），记录每次 导入/抽取/同步/对账/压缩/增删改 操作，`memlocal audit` 或 Web 面板「审计日志」可查看——透明可控是信任基础。

## 真实写回路径自动探测

`memlocal sync --real` 无需手动配置，会自动探测各 agent 的真实记忆位置：

| 平台 | 探测候选（按优先级） |
|------|------|
| Claude Code | `~/.claude/CLAUDE.md` → `~/.claude/CLAUDE.local.md`（本地覆盖记忆）→ 项目 `CLAUDE.md` → `CLAUDE.local.md` |
| Cursor | 项目 `.cursor/rules` → `.cursorrules` → `~/.cursor/rules` |
| Windsurf | 项目 `.windsurfrules` → `~/.codeium/windsurf/.windsurfrules` |
| ChatGPT | 项目 `memory.json` |
| 通用 | `~/.memlocal/MEMORY.md` → 项目 `MEMORY.md` |
| Codex | 项目 `AGENTS.md` → `~/.codex/AGENTS.md` |
| Gemini | 项目 `GEMINI.md` → `~/.gemini/GEMINI.md` |
| Aider | 项目 `CONVENTIONS.md` → `~/.aider/CONVENTIONS.md` |
| Copilot | 项目 `.github/copilot-instructions.md` |

**安全策略**：已存在的真实配置文件会被更新；`~` 开头的候选**只在文件已存在时**命中（绝不往用户主目录撒新文件）；项目级候选（`{cwd}`）父目录存在即可新建。显式 `config set <平台> <路径>` 始终优先于自动探测。

**Cursor 特殊处理**：当探测到 `.cursor/rules` 目录时，写回生成 `memlocal-memory.mdc`（带 YAML frontmatter 的 Cursor 原生规则格式），而非 `.cursorrules`。

**自动同步**：`memlocal watch` 监听各 agent 记忆文件变化，检测到修改自动 `import` + `sync`，让「agent 改了记忆 → 自动聚合 → 自动写回所有平台」成为常驻流程。

## 架构

- `core/store.js` — canonical store 读写（真相源，用户主目录）+ 版本迁移 + 损坏恢复 + 审计日志
- `core/import.js` — 导入解析（Markdown / .mdc / ChatGPT JSON）+ 扫描各 agent 真实位置 + 去重合并（唯一实现）
- `core/render.js` — canonical → 各 agent 原生格式（9 个平台）+ 真实路径自动探测（唯一真相源）
- `core/reconcile.js` — 对账引擎（矛盾 / 更新 / 实体切换 + 时间推理 + 置信度门控）+ `core/llm.js`（LLM 增强层，无 key 自动回退确定性）
- `core/extract.js` — 从文本抽取原子事实（确定性兜底 + 可选 LLM），过滤提问/指令/临时日程
- `core/retrieve.js` — 检索打分（`recency × importance × relevance`）
- `core/reflect.js` — 反思 / 压缩（智能遗忘）
- `core/writeback.js` — 真实写回适配器（沙箱 / 自动探测真实路径 + 自动备份）
- `core/backup.js` — 备份 / 恢复 / 导出（gzip 压缩，用户拥有数据可迁移）
- `cli.js` — 一行命令同步（含 init/status/audit/backup/restore/export-all）
- `server.js` + `public/index.html` — Web 面板（搜索 / 抽取 / 审计 / 真实写回预览）
- `samples/` — 各 agent 的样例记忆文件（demo 用）
- `FORMAT.md` — **开放格式标准**（任何 agent 都能接入）

## 开放格式标准

MemLocal 把「记忆」定义成一份开放 JSON 规范（`FORMAT.md`），任何 code agent 都能一行命令读写。
这正是它的护城河：当所有 agent 都认这份格式，MemLocal 就成为「记忆的 SQLite」——用户数据的默认位置。

## 质量保障

- `npm test` 跑五套确定性评测：`scripts/eval.js`（LOCOMO 思路轻量 benchmark，含抽取/迁移/mdc/watch）+ `scripts/test-reconcile.js`（对账）+ `scripts/test-extract.js`（抽取 / 路径探测 / 注册表统一 / LLM 容错）+ `scripts/test-store.js`（版本迁移 / 损坏恢复 / 审计）+ `scripts/test-writeback.js`（沙箱 / 真实探测 / 备份 / cursor .mdc / 安全策略），CI 全绿。
- 对账 / 压缩 / 抽取均返回 plan，由调用方决定是否 apply；写回前自动备份——可审计、可回滚。
- `npm pack` 发布内容已验证（含 cli/core/public/samples/文档），`npm install -g` 后 `memlocal` 命令可用。
- `samples/` 覆盖全部 9 平台样例，`memlocal import` 演示可聚合 9 个来源（33 条样例记忆）。

## License

[MIT](LICENSE) — 自由使用、修改、再分发。
