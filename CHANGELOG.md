# Changelog

本项目遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

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
