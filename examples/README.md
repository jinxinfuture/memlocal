# MemLocal 真实使用示例

> 可复制粘贴的真实工作流。所有命令都用 `memlocal`（`npm install -g memlocal` 后可用；
> 未安装时用 `node cli.js` 替代）。

## 示例 1：新项目接入（5 分钟）

把既有 agent 记忆带进新项目，并让所有 agent 共享：

```bash
# 1. 初始化
memlocal init

# 2. 聚合所有 agent 已有记忆（扫当前目录 + ~/.claude 等全局位置 + 样例）
memlocal import

# 3. 预览将要写回哪些真实路径
memlocal sync --dry-run

# 4. 真实写回（自动探测 ~/.claude/CLAUDE.md、.cursor/rules 等 + .bak 备份）
memlocal sync --real
```

## 示例 2：每轮对话后沉淀记忆

```bash
# 直接输入
memlocal extract --text "我叫小王，负责记忆层。我讨厌香菜，最近在学 Rust。" --apply

# 或从剪贴板抽取（macOS）
memlocal extract --text "$(pbpaste)" --apply

# 从文件抽取
memlocal extract --file notes.txt --apply

# 用 LLM 增强抽取（先配 key）
memlocal config set deepseek.apiKey sk-xxx
memlocal extract --text "..." --llm --apply
```

## 示例 3：处理事实矛盾

```bash
# 用户改吃素了，旧记忆是"爱吃牛排"
memlocal reconcile --content "用户现在吃素了" --apply
# 自动检测矛盾 → 替换旧记忆（审计可查）

# 编辑器从 Vim 换 Cursor
memlocal reconcile --content "用户现在用 Cursor" --apply
```

## 示例 4：常驻自动同步

```bash
# 监听各 agent 记忆文件变化，自动导入 + 同步（真实写回）
memlocal watch --real
```

## 示例 5：数据安全

```bash
# 定期备份
memlocal backup

# 查看备份
memlocal backups

# 换机器迁移
memlocal export-all          # Markdown + JSON 双格式
memlocal backup              # 完整压缩备份（含 config）
# 新机器上：
memlocal restore --file <备份文件>
```

## 示例 6：让 agent 消费记忆

MemLocal 的产出是各 agent 原生格式文件（`CLAUDE.md`、`.cursorrules`、`AGENTS.md`...）。
同步完成后，你的 code agent 下次会话就会自动读到统一记忆。

也可以主动检索：

```bash
memlocal search "Rust"        # recency×importance×relevance 排序
memlocal search "咖啡" --limit 5
```

## 示例 7：Web 可视化

```bash
memlocal serve
# 打开 http://localhost:4173：导入/抽取/搜索/审计/写回预览 全可视化
```

## 完整演示

`node scripts/demo.js` 跑一条龙端到端演示（init → import → extract → reconcile → reflect → sync → backup → restore → audit → watch），19 步全闭环断言。
