# MemLocal 使用教程

> 完整上手指南：从安装到日常使用，覆盖所有命令与真实场景。

## 1. 安装

```bash
# 方式一：全局安装（推荐）
npm install -g memlocal

# 方式二：临时使用（不安装）
npx memlocal

# 方式三：从源码（开发）
git clone https://github.com/jinxinfuture/memlocal.git
cd memlocal && npm test && node cli.js init
```

## 2. 首次初始化

```bash
memlocal init
# 已初始化 ~/.memlocal/store.json
```

`~/.memlocal/` 是你的记忆家园：
- `store.json` — 唯一真相源（所有记忆）
- `config.json` — 配置（真实写回路径、LLM key）
- `backups/` — 自动备份
- `writes/` — 沙箱写回目录

## 3. 导入现有记忆（一次性聚合）

```bash
memlocal import
```

扫描三个来源，去重合并进 store：
1. **当前目录**（项目级：`CLAUDE.md`、`.cursor/rules/`、`AGENTS.md`、`GEMINI.md` 等）
2. **用户主目录**（全局：`~/.claude/CLAUDE.md`、`~/.config/github-copilot/instructions.md` 等）
3. **样例**（`samples/`，9 个平台，演示用）

## 4. 同步到所有 Agent

```bash
# 先预览（不落盘）
memlocal sync --dry-run

# 真实写回（自动探测各平台路径 + .bak 备份）
memlocal sync --real
```

`--real` 自动探测每个 agent 的真实记忆位置（如 `~/.claude/CLAUDE.md`），已存在的配置文件被更新，绝不往用户主目录撒新文件。Cursor 命中 `.cursor/rules` 目录时生成 `memlocal-memory.mdc`。

只同步部分平台：

```bash
memlocal sync --real --platforms claude,cursor
```

## 5. 从对话长出新记忆（核心玩法）

```bash
memlocal extract --text "我叫小王，负责记忆层。我讨厌香菜，最近在学 Rust。你帮我看下这个 bug。明天开会。" --apply
```

输出：
```
抽取到 3 条事实：
  [context] 我叫小王，负责记忆层。
  [preference] 我讨厌香菜，最近在学 Rust。
已写入 store（--apply）。
```

**抽取器的智能过滤**：自动跳过提问（"帮我看下"）、指令、语气词（"嗯好的"）、临时日程（"明天开会"）。

从文件抽取：

```bash
memlocal extract --file conversation.txt --apply
```

用 LLM 增强抽取（更准，需要 key）：

```bash
memlocal config set deepseek.apiKey sk-xxx
memlocal extract --text "..." --llm --apply
```

## 6. 检索记忆

```bash
memlocal search "Rust"
```

按 `recency × importance × relevance` 打分排序返回最相关记忆——只取相关条目，不整文档注入（避免长上下文退化）。

## 7. 对账（矛盾处理）

```bash
# 提交新事实，检测与旧记忆的矛盾
memlocal reconcile --content "用户现在吃素了"

# 预览对账 plan 后应用
memlocal reconcile --content "用户现在吃素了" --apply

# 用 LLM 做疑难决策（比确定性启发式更聪明）
memlocal reconcile --content "用户现在吃素了" --llm --apply
```

对账引擎自动处理：矛盾（牛排→素）、更新（喝咖啡→戒咖啡）、实体切换（Vim→Cursor）、时间推理（新值胜旧值）、置信度门控（低置信进待审）。

## 8. 反思压缩（智能遗忘）

```bash
memlocal reflect --apply
```

把零散的相关事实聚类压缩成摘要并归档（不物理删除，可审计）。

## 9. 审计与透明

```bash
memlocal audit
#  8/15/2026 4:06:49 AM  [sync-real] 写回 18 个平台（真实路径），备份 9
#  8/15/2026 4:06:48 AM  [extract] 从文本抽取 3 条（新增 3 / 替换 0）
```

每个写操作都记审计——你永远知道记忆从哪来、被怎么改过。

## 10. 备份与恢复

```bash
memlocal backup                 # 创建备份（gzip 到 ~/.memlocal/backups/）
memlocal backups                # 列出备份
memlocal restore --file <备份>   # 恢复（当前状态先另存安全备份）
memlocal export-all             # 导出（Markdown + JSON，可迁移）
```

## 11. 自动同步（watch 模式）

```bash
memlocal watch --real
# MemLocal watch 已启动（每 10s 检测一次，真实写回）。Ctrl+C 停止。
```

监听各 agent 记忆文件变化，检测到修改自动 `import` + `sync`——"agent 改了记忆 → 自动聚合 → 自动写回所有平台"的常驻流程。

## 12. Web 面板

```bash
memlocal serve
# 打开 http://localhost:4173
```

可视化面板：一键导入、抽取（先预览 plan 再确认）、搜索、真实写回目标展示、审计日志、类型筛选。

## 13. 配置速查

```bash
memlocal config get                      # 查看全部配置
memlocal config set deepseek.apiKey sk-xxx     # LLM key
memlocal config set deepseek.model deepseek-chat
memlocal config set realTargets.claude ~/.claude/CLAUDE.md   # 显式写回路径
memlocal status                          # 统计 + 真实写回探测
```

## 14. 真实场景示例

**场景 A：新项目开始**——把既有 agent 记忆带过来：

```bash
cd my-project
memlocal import && memlocal sync --real
```

**场景 B：每轮对话后沉淀**——把重要事实存进记忆：

```bash
memlocal extract --text "$(pbcopy)" --apply   # 从剪贴板抽取
```

**场景 C：长期常驻**——agent 记忆自动同步：

```bash
memlocal watch --real &
```

**场景 D：隐私迁移**——换电脑时带走全部记忆：

```bash
# 旧机器
memlocal backup && memlocal export-all
# 新机器
memlocal restore --file <备份文件>
```

## 15. 常见问题

**Q：`sync --real` 会动我的个人文件吗？**
不会乱动。只更新"已存在的 agent 配置文件"（如 `~/.claude/CLAUDE.md`）或项目级文件；`~` 开头的候选仅文件已存在时命中，绝不新建。写前自动 `.bak`，可 `memlocal restore` 回滚。

**Q：没有 LLM key 能用吗？**
完全能。所有功能都有确定性实现，`--llm` 只是可选增强，无 key 自动回退。

**Q：记忆存在哪？会上传吗？**
全在 `~/.memlocal/`，纯本地，零上传。你的记忆属于你。

**Q：支持哪些 agent？**
Claude Code / Cursor / Windsurf / ChatGPT / Codex / Gemini / Aider / GitHub Copilot / 通用 Markdown——9 个平台，双向同步。
