# AGENTS.md — 给任何 code agent 的 MemLocal 协作指南

> 本文件让进入仓库的 code agent（Claude Code / Cursor / Copilot / 等）第一时间知道：
> 这是什么、怎么跑、改哪里、如何提交。**请先读我，再动手。**

## 这是什么

MemLocal 是**跨应用、本地优先、用户拥有的统一记忆层**：Claude Code / Cursor / Windsurf / Codex / Gemini / Aider / Copilot / ChatGPT 的记忆
一键聚合到一份本地 canonical store（`~/.memlocal/store.json`），再反向同步回每个 agent 的原生记忆文件。

设计原则：**别在单个代码平台的院子里种菜，去种连接所有院子的那条路。**（护城河 = 跨平台中间层 + 本地优先 + 开放格式）

## 快速开始

```bash
npm test                     # 4 套确定性评测，必须全绿
node cli.js init             # 初始化 ~/.memlocal
node cli.js import           # 扫描 cwd + 主目录 + samples，聚合各 agent 记忆
node cli.js sync --dry-run   # 预览写回
node cli.js sync --real      # 真实写回（自动探测各平台路径 + .bak 备份）
node cli.js serve            # Web 面板 :4173
```

## 架构（改代码前必读）

| 文件 | 职责 | 注意 |
|------|------|------|
| `core/store.js` | canonical store 读写、版本迁移(v1→v2)、损坏恢复、审计日志 | `addAudit` 与 `saveStore` 必须操作**同一 store 实例** |
| `core/render.js` | **平台注册表唯一真相源**（9 平台）+ 渲染 + 真实路径探测 | 新增平台只改这里；`detectRealLocation` 安全策略见下 |
| `core/import.js` | 导入解析（Markdown/.mdc/JSON）+ 扫描 + 去重 + `snapshotSignatures` | 与 render.js 共享 PLATFORM_TARGETS |
| `core/reconcile.js` | 对账引擎（矛盾/更新/实体切换 + 时间推理 + 置信度门控） | 返回 plan 不突变 store |
| `core/extract.js` | 文本→原子事实抽取（确定性兜底 + LLM 增强） | 过滤提问/指令/临时日程 |
| `core/retrieve.js` | 检索打分 recency×importance×relevance | |
| `core/reflect.js` | 反思/压缩（智能遗忘） | |
| `core/writeback.js` | 写回适配器（沙箱/真实 + 备份 + cursor .mdc） | |
| `core/backup.js` | 备份/恢复/导出 | |
| `core/llm.js` | LLM 增强层（DeepSeek，无 key 回退确定性） | config `deepseek.apiKey` 或环境变量 |
| `cli.js` | CLI 入口（init/status/import/sync/extract/...） | |
| `server.js` + `public/` | Web 面板 | |

**唯一真相源铁律**：平台列表、路径、格式只定义在 `core/render.js`，其余模块一律 require 引用，禁止复制粘贴。

## 安全策略（写回/探测必须遵守）

- `~` 开头的候选路径**只在文件已存在时**命中——绝不因目录存在就往用户 home 撒新文件。
- `{cwd}` 项目级候选：父目录存在即可新建（项目级记忆文件）。
- `config.realTargets` 显式配置始终优先于自动探测。
- 覆盖前自动 `.bak` 备份；写回只动探测到的目标，探测不到就跳过。
- **测试时绝不在仓库根目录跑 `sync --real`**（会把 CLAUDE.md 等写进 repo）；用临时目录 + `MEMLOCAL_HOME`。

## 测试

```bash
npm test    # eval.js(11) + test-reconcile.js(19) + test-extract.js(32) + test-store.js(17) = 79 项
```

- 新增功能必须带确定性单测（不依赖网络/LLM）。
- LLM 相关测试放 `scripts/eval-llm.js`（有 DEEPSEEK_API_KEY 才跑，无 key SKIP 不炸 CI）。

## 提交约定（issue 驱动）

- 分支：`feat/<issue号>-<slug>`
- 提交：`feat: 描述 (fixes #<issue号>)` — 自动关 issue
- 进度：`refs #<issue号>` 关联不关闭
- 看板：仓库 Projects tab →「MemLocal Roadmap」（Todo / In Progress / Done）

## 常见操作

```bash
node cli.js audit                              # 看操作审计
node cli.js config set deepseek.apiKey sk-xxx  # 配置 LLM
node cli.js backup / restore --file <备份>      # 备份恢复
node cli.js watch --real                       # 监听变化自动同步
node cli.js extract --text "我叫小王，负责记忆层。" --apply  # 从文本长记忆
```

## 发布

`npm version patch && npm publish`（`prepublishOnly` 自动跑测试；发布前 `npm pack --dry-run` 检查内容）。
