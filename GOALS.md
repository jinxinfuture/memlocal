# MemLocal 目标

## 一句话
**让所有 code agent 都能轻松同步一份属于用户、本地优先的公用记忆。**

## 为什么不是"一个文档"
文档是记忆的传输格式，不是记忆本身。纯文档在「规模变大 / 多 agent 改写 / 事实会变」时会塌
（详见 `docs/design-memory-vs-document.md`）。我们要的是结构化真相源 + 适配各 agent 的导出。

## 非目标
- 不是 skills 库（skills 是可复用能力，与具体人无关；记忆才跟人绑定）。
- 不做云托管记忆（先本地优先；用户拥有自己的数据文件）。
- 不做通用 RAG 问答（那是红海，被开源/大厂吃掉）。

## 里程碑
- [x] MVP：canonical store + 5 平台适配器 + 一键导入/同步面板（本地可跑）
- [x] 真实写回：`core/writeback.js` + `/api/writeback`，默认安全落 `data/writes/`，真实路径需 `data/config.json` 显式配置 + `--real`，覆盖前自动 .bak 备份
- [x] 检索打分：`core/retrieve.js` + `/api/search`，score = recency × importance × relevance
- [x] 反思/压缩（智能遗忘）：`core/reflect.js` + `/api/reflect`，按共享关键词聚类，≥3 条压成摘要并归档（不物理删除），plan/apply 两模式
- [x] LLM 对账·确定性核心：`core/reconcile.js` + `/api/reconcile`，矛盾(牛排↔素)/更新(喝咖啡↔戒咖啡)/实体切换(Vim↔Cursor)检测 + 时间推理 + 置信度门控 + 主语不误判；LLM 增强层 `core/llm.js`（`makeDeepSeekLLM`，无 key 自动回退确定性）
- [x] 开放格式标准 + CLI：`FORMAT.md` + `cli.js`（serve/import/sync/export/search/reconcile/reflect/writeback），任何 code agent 一行命令同步
- [x] 评测：LOCOMO 思路轻量 benchmark（`scripts/eval.js`，8/8 覆盖矛盾/更新/新增/实体切换/时间推理/主语/检索/压缩）

## 设计原则
别在单个平台的院子里种菜，去种连接所有院子的那条路。
