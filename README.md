# MemLocal — 跨应用、本地优先、用户拥有的统一记忆层

把 Claude Code / Cursor / Windsurf / ChatGPT / 通用 Markdown 的记忆**聚合到一个本地文件**，
再从这份「唯一真相源」**反向同步**回每个 Agent。你的记忆不再锁死在单个平台里。

## 跑起来
```bash
node server.js          # 监听 http://localhost:4173
```
无外部依赖，纯 Node 内置模块。打开 http://localhost:4173 即可。

## CLI（任何 code agent 一行命令同步）
```bash
node cli.js import                        # 扫描并导入各 agent 记忆到 store
node cli.js sync                          # 从 store 同步到 exports/
node cli.js export --platform claude      # 打印某平台渲染结果
node cli.js search "咖啡" --limit 5       # 检索打分排序（recency×importance×relevance）
node cli.js reconcile --content "用户现在吃素了" --apply   # 提交新事实并对账
node cli.js reflect --apply               # 反思/压缩零散事实为摘要
node cli.js writeback --dry-run [--real]  # 写回（默认沙箱 data/writes/，--real 需配置）
```
开放格式规范见 `FORMAT.md`。

## 核心流程
1. **一键导入** — 扫描 `samples/` 与各已知目录，命中 `CLAUDE.md` / `.cursorrules` /
   `.windsurfrules` / `memory.json` / `MEMORY.md`，解析成原子事实并去重合并进
   `data/store.json`（canonical store）。
2. **同步到所有 Agent** — 从 canonical store 重新生成每个平台的记忆文件，写入
   `exports/<platform>/`，可直接拷回对应 Agent 的配置位置。
3. **手动增删改** — 在面板里直接维护统一记忆，或用 CLI。
4. **智能对账** — 提交新记忆时调 `/api/reconcile`（或 `cli.js reconcile`），自动检测与现有记忆的
   **矛盾**（如「爱吃牛排」→「现在吃素了」）、**更新**（如「每天喝咖啡」→「最近戒了咖啡」）、
   **实体切换**（如「用 Vim」→「用 Cursor」），按**时间推理**（新的胜出）与**置信度门控**决定替换或
   `needsReview`。引擎在 `core/reconcile.js`，纯逻辑、可单测（`node scripts/test-reconcile.js`，19/19 通过）。
5. **检索打分** — `core/retrieve.js`：`score = recency × importance × relevance`，导出时按需取相关条目。
6. **反思/压缩（智能遗忘）** — `core/reflect.js`：按共享关键词聚类，≥3 条压成摘要并归档（不物理删除）。
7. **评测** — `node scripts/eval.js`（LOCOMO 思路轻量 benchmark，8/8 通过）。

## 架构
- `data/store.json` — 唯一真相源，每条 `{id, content, type, source, sourceFile, createdAt, updatedAt, confidence, archived}`
- `core/store.js` — store 读写（真相源）
- `core/import.js` — 各平台导入解析 / 导出生成 + 扫描
- `core/render.js` — canonical → 各 agent 原生格式
- `core/reconcile.js` — 对账引擎（矛盾/更新/实体切换 + 时间推理 + 置信度门控）+ `core/llm.js`（LLM 增强层，无 key 回退确定性）
- `core/retrieve.js` — 检索打分
- `core/reflect.js` — 反思/压缩
- `core/writeback.js` — 真实写回适配器（默认沙箱，真实路径需配置 + 自动 .bak 备份）
- `cli.js` — 一行命令同步
- `server.js` — 内置 http 服务 + 面板 `public/index.html`
- `samples/` — 各 Agent 的样例记忆文件（demo 用）

## 架构
- `data/store.json` — 唯一真相源，每条 `{id, content, type, source, sourceFile, time}`
- `server.js` — 内置 http 服务 + 适配器（导入解析 / 导出生成）+ 导入扫描 + 同步
- `public/index.html` — 本地优先风格记忆面板
- `samples/` — 各 Agent 的样例记忆文件（demo 用，真实使用替换为你的实际配置目录）

## 下一步（真护城河方向）
- 把导出直接写回各 Agent 的真实配置路径（而非 `exports/`），实现真·一键同步
- LLM 对账：冲突解决（"现在吃素了" vs "爱牛排"）、时间推理、来源标注、置信度门控
- 开放本地格式标准，做成「记忆的 SQLite」——任何 App 都能读
- 记忆评测：量化"记对了没、更新了没"

> 设计原则：别在单个代码平台的院子里种菜，去种连接所有院子的那条路。
