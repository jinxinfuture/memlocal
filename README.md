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

## 一行命令同步

```bash
memlocal init                           # 初始化 ~/.memlocal（store + 默认 config）
memlocal import                         # 扫描 当前目录 + 用户主目录，聚合各 agent 记忆
memlocal config set claude ~/.claude/CLAUDE.md   # 告诉它真实写回路径（每个 agent 一次）
memlocal writeback --real              # 把统一记忆同步回所有已配置 agent
memlocal writeback --dry-run           # 预览将要写回的内容（不落盘）
```

日常只需：`memlocal import && memlocal writeback --real`

## 全部命令

| 命令 | 作用 |
|------|------|
| `memlocal init` | 初始化 `~/.memlocal`（store + 默认 config） |
| `memlocal import` | 扫描 cwd + 用户主目录 + 样例，聚合各 agent 记忆到 store（去重） |
| `memlocal writeback [--dry-run] [--real]` | 写回（默认沙箱 `~/.memlocal/writes/`；`--real` 写回 `config.json` 中配置的真实路径，写前自动 `.bak` 备份） |
| `memlocal sync` | demo：从 store 生成各平台文件到 `exports/`（便于查看） |
| `memlocal export --platform claude` | 打印某平台的渲染结果 |
| `memlocal search "<q>" [--limit N]` | 检索打分排序（`recency × importance × relevance`） |
| `memlocal reconcile --content "..." [--apply] [--llm]` | 提交新事实并对账（可选 LLM 增强） |
| `memlocal reflect [--apply]` | 反思 / 压缩零散事实为摘要（智能遗忘） |
| `memlocal serve` | 启动 Web 面板（默认 `:4173`） |
| `memlocal status` | 查看 store 统计、已支持 agent、真实写回配置 |

## 数据位置

- 真相源：`~/.memlocal/store.json`（可用环境变量 `MEMLOCAL_HOME` 覆盖，便于 demo / 测试；若旧布局 `<项目>/data/store.json` 已存在则沿用）。
- 配置：`~/.memlocal/config.json`（`realTargets` 映射各 agent 的真实写回路径）。
- 备份：每次真实写回前自动生成 `.bak`。

## 架构

- `core/store.js` — canonical store 读写（真相源，用户主目录）
- `core/adapters.js` — 导入解析（Markdown / ChatGPT JSON）+ 扫描各 agent 真实位置 + 去重合并
- `core/render.js` — canonical → 各 agent 原生格式（9 个平台）
- `core/reconcile.js` — 对账引擎（矛盾 / 更新 / 实体切换 + 时间推理 + 置信度门控）+ `core/llm.js`（LLM 增强层，无 key 自动回退确定性）
- `core/retrieve.js` — 检索打分（`recency × importance × relevance`）
- `core/reflect.js` — 反思 / 压缩（智能遗忘）
- `core/writeback.js` — 真实写回适配器（沙箱 / 真实路径 + 自动备份）
- `cli.js` — 一行命令同步
- `server.js` + `public/index.html` — Web 面板（可视化）
- `samples/` — 各 agent 的样例记忆文件（demo 用）
- `FORMAT.md` — **开放格式标准**（任何 agent 都能接入）

## 开放格式标准

MemLocal 把「记忆」定义成一份开放 JSON 规范（`FORMAT.md`），任何 code agent 都能一行命令读写。
这正是它的护城河：当所有 agent 都认这份格式，MemLocal 就成为「记忆的 SQLite」——用户数据的默认位置。

## 质量保障

- `npm test` 跑两套确定性评测：`scripts/eval.js`（LOCOMO 思路轻量 benchmark）+ `scripts/test-reconcile.js`，CI 全绿。
- 对账 / 压缩均返回 plan，由调用方决定是否 apply；写回前自动备份——可审计、可回滚。

## License

[MIT](LICENSE) — 自由使用、修改、再分发。
