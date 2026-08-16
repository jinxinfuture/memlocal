# 快速开始（5 分钟）

本指南帮你用最短路径跑通 MemLocal：从安装到把记忆同步回你正在用的 agent。

> 前提：已装 Node ≥ 18（`node -v` 自查）。

## 1. 安装

```bash
npm install -g memlocal      # 全局安装
memlocal --version           # 看到版本号即成功（如 0.5.0）
```

临时试用可跳过安装：`npx memlocal --version`。

## 2. 初始化

```bash
memlocal init                # 在 ~/.memlocal 建好 store + 默认 config
```

## 3. 把你已有的记忆聚拢进来

```bash
memlocal import              # 扫描当前目录 + 用户主目录，聚合 9 平台记忆到 store
memlocal status              # 看一眼聚合到了多少条、支持了哪些平台
```

## 4. 同步回每个 agent（关键一步）

```bash
memlocal sync --dry-run      # 先预览：将要写回哪些平台、写什么（不落盘）
memlocal sync --real         # 真实写回：自动探测各 agent 真实路径 + 写前 .bak 备份
```

`--real` 不往你主目录撒新文件：只对**已存在**的配置文件做更新（详见 README「真实写回路径自动探测」）。
日常只需一句话：

```bash
memlocal import && memlocal sync --real
```

## 5. 让记忆从对话里自动长出

```bash
memlocal extract --text "我叫小王，负责记忆层。我讨厌香菜。" --apply
```

会筛掉提问/指令/语气词，只把「值得记住的原子事实」入库。想用 LLM 增强抽取加 `--llm`（没配 key 自动回退确定性模式）。

## 6. 打开 Web 面板（可选）

```bash
memlocal serve               # 启动 :4173，可视化抽取 / 搜索 / 真实写回预览
```

浏览器开 http://localhost:4173 。

## 7. 进阶三连

```bash
memlocal doctor              # 一键体检：store / 路径探测 / 备份 / LLM / 记忆质量
memlocal git-export          # 记忆版本化：git log 可回溯任意历史版本
memlocal completion zsh --install   # 开 shell 自动补全（bash / zsh）
```

## 数据在哪

- 真相源：`~/.memlocal/store.json`（可用 `MEMLOCAL_HOME` 覆盖，便于 demo / 测试）。
- 真实写回前自动 `.bak`；store 损坏自动备份为 `.corrupt-<时间戳>` 并重建——不静默清空你的记忆。

## 下一步

- [使用教程](usage.md)：每条命令的完整参数与示例
- [架构详解](architecture.md)：canonical store 与同步模型
- [记忆 vs 文档](design-memory-vs-document.md)：为什么是 store 而不是一个文档
- [HTTP API](api.md)：把 MemLocal 接进你自己的工具
