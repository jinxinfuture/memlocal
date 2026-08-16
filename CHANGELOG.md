# Changelog

本项目遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [0.5.0] - 2026-08-16

### 新增功能
- **自动发布工作流**（`.github/workflows/release.yml`）：`push v*` tag → 自动跑测试 → `npm publish` → 安装验证 → 建 GitHub Release。发布流程简化为「打 tag 即发布」（首次需在 GitHub 配置 `NPM_TOKEN` secret）。
- **shell 自动补全**：`memlocal completion bash|zsh [--install]`，支持命令与 flag 补全（zsh/bash 语法均验证通过）。
- **记忆版本化**：`memlocal git-export [--repo]` 把 store 快照提交到 git 仓库，`git log` 可回溯任意历史版本——「用户拥有数据」的极致落地。

### 文档
- `docs/RELEASING.md` 重写为「打 tag 即发布」简化流程（含 NPM_TOKEN 一次性配置）。

### 测试
- smoke-cli 扩到 26 项（completion/git-export 断言）；**194 项全绿**（9 套）。

## [0.4.0] - 2026-08-15

### 新增功能
- **`memlocal doctor` 诊断命令**：一键检查 store 健康 / 9 平台真实写回路径 / 备份状态 / LLM 配置 / 数据目录 / 记忆质量（✅/⚠️/❌ 报告）。
- **记忆新鲜度（过期/降权）**：记忆支持 `expiresAt` 字段；`extract --events` 保留临时事件（7 天 TTL 自动过期）；`reflect` 自动归档过期记忆（不参与聚类摘要）。记忆不再永久腐化。
- **`memlocal --version` / `--help`**：标准 CLI 版本号与完整帮助。
- **HTTP API 文档** `docs/api.md`：13 个端点的完整参考 + curl/Node 集成示例，任何 agent 可通过 HTTP 读写统一记忆。

### 改进
- **server/CLI 同步行为统一**：`/api/sync` 改走 `writeback.applyWrites`（沙箱 `~/.memlocal/writes/`，与 CLI 一致），支持 real/dry-run/platforms；清理 server.js 死代码（DATA_DIR/EXPORTS_DIR/doSync）。
- **extract 英文支持**：`splitSentences` 支持英文句点切分（修复英文整句被当一条导致误过滤）；英文主语/偏好/提问模式。
- **Web 面板**：顶部显示上次导入/同步时间。
- **examples/**：真实使用示例（workflow.sh 可执行 + 7 个场景）。
- **npm 发布打包**：files 补 docs/CHANGELOG，37 文件 47.7kB。

### 测试
- **171 项全绿**（eval 13 + reconcile 19 + extract 48 + store 17 + writeback 15 + smoke-cli 22 + demo 19 + smoke-api 18）。
- **CI 平台矩阵**：macOS / Windows / Linux × Node 20/22 全绿（修 Windows 路径分隔符与测试 home 注入）。

## [0.3.0] - 2026-08-15

### 性能
- **reconcile 对账引擎 27 倍提速**（1000 条记忆批量对账 2466ms → 92ms）：特征缓存（normalize/keywords/polarity/domain/entities 复用）+ 精确重复 Map 索引 + 小集合交集。
- 新增性能基准 `node scripts/bench.js`（1000 条记忆全部操作 <100ms），结果见 `docs/bench.md`。

### 新增功能
- **CLI 冒烟测试** `scripts/smoke-cli.js`：16 个子命令全自动断言（纳入 `npm test`）。
- **英文 README** `README.en.md`（中英互链）。
- **文档**：`docs/usage.md` 使用教程、`docs/architecture.md` 架构详解、`docs/bench.md` 性能基准。

### 修复
- `samples/` 补全 codex/gemini/aider/copilot 样例，import 演示覆盖 9 平台。
- samples 扫描精确化（修复 copilot `.github` 子路径未命中）。
- claude 平台移除 `AGENTS.md`（避免仓库根规范文件被误导入）。

## [0.2.0] - 2026-08-15

### 新增功能
- **writeback 专项测试** `scripts/test-writeback.js`：沙箱/dry-run/.bak 备份/config 优先/防 home 污染/cursor .mdc/restore 回滚（15 项）。
- **备份/恢复/导出**：`core/backup.js` + `memlocal backup/backups/restore/export-all`（gzip 压缩，用户拥有数据可迁移）。
- **真实写回路径自动探测**：9 平台内置 `realLocations`，`sync --real` 零配置可用（`~` 候选不撒 home、`{cwd}` 项目级可新建、config 显式优先）。
- **Cursor `.cursor/rules/*.mdc` 写回**：探测到目录时生成带 YAML frontmatter 的 `memlocal-memory.mdc`。
- **审计日志**：所有写操作（import/extract/sync/reconcile/reflect/add/update/delete）记审计，`memlocal audit` 可查，Web 面板展示。
- **store 健壮性**：version 迁移（v1→v2 补 audit）、损坏自动备份 `.corrupt-*` 重建、非对象记忆归一化。
- **`extract` 抽取命令**：从对话/文本自动长出记忆（过滤提问/指令/语气词/临时日程），可选 LLM 增强。
- **`watch` 自动同步**：监听各 agent 记忆文件变化自动 import + sync。
- **CLI `config` 命令**：`memlocal config get/set`（deepseek.apiKey、realTargets.*）。
- **CLI `init`/`status`**：初始化与状态查看（含真实写回探测展示）。
- **LLM 增强容错**：`extractJSON` 兼容 markdown 包裹/杂文本；config 支持 `deepseek` 段。
- **Web 面板升级**：搜索框、真实写回目标展示、类型筛选 tabs、抽取先预览 plan 再确认、置信度徽标。
- **AGENTS.md**：仓库协作规范（任何 code agent 进仓库即知架构/安全策略/测试/提交约定）。

### 修复
- 平台注册表统一（import.js 5 平台 → render.js 9 平台唯一真相源）。
- `sync --real` 曾把测试数据写入用户真实 `~/.memlocal/MEMORY.md`（`~` 候选改为仅文件存在时命中）。
- backup 审计因 loadStore 两次未保存（addAudit 与 saveStore 须同一实例）。
- EVENT_RE 补"发版/上线/截止"，临时日程过滤更全。

### 测试
- 测试套件从 3 套扩到 6 套：eval(13) + reconcile(19) + extract(34) + store(17) + writeback(15) + smoke-cli(19) = **117 项全绿**，CI 全绿。

## [0.1.0] - 2026-08-15

### 初始 MVP
- 跨应用、本地优先、用户拥有的统一记忆层核心架构。
- 9 平台适配器（claude/cursor/windsurf/chatgpt/generic/codex/gemini/aider/copilot）。
- canonical store（`~/.memlocal/store.json`）+ 导入聚合 + 同步写回。
- 对账引擎（矛盾/更新/实体切换 + 时间推理 + 置信度门控 + 可选 LLM）。
- 检索打分（recency × importance × relevance）。
- 反思压缩（智能遗忘）。
- CLI（serve/import/sync/export/search/reconcile/reflect/writeback）+ Web 面板。
- 开放格式标准（FORMAT.md）。
- npm 发布就绪（`npx memlocal` 可用）。
