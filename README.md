# MemLocal — 跨应用、本地优先、用户拥有的统一记忆层

把 Claude Code / Cursor / Windsurf / ChatGPT / 通用 Markdown 的记忆**聚合到一个本地文件**，
再从这份「唯一真相源」**反向同步**回每个 Agent。你的记忆不再锁死在单个平台里。

## 跑起来
```bash
node server.js          # 监听 http://localhost:4173
```
无外部依赖，纯 Node 内置模块。打开 http://localhost:4173 即可。

## 核心流程
1. **一键导入** — 扫描 `samples/` 与各已知目录，命中 `CLAUDE.md` / `.cursorrules` /
   `.windsurfrules` / `memory.json` / `MEMORY.md`，解析成原子事实并去重合并进
   `data/store.json`（canonical store）。
2. **同步到所有 Agent** — 从 canonical store 重新生成每个平台的记忆文件，写入
   `exports/<platform>/`，可直接拷回对应 Agent 的配置位置。
3. **手动增删改** — 在面板里直接维护统一记忆，LLM 对账（ADD/UPDATE/DELETE）留作 pro 升级位。

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
