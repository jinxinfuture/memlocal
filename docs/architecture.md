# MemLocal 架构详解

> 深入理解 MemLocal 的设计：数据流、核心模块、安全模型、扩展指南。

## 1. 总览

```
                ┌─────────────────────────────────────────────┐
                │             用户（你，拥有数据）                │
                └──────────────┬──────────────────────────────┘
                               │ CLI / Web 面板
                               ▼
┌──────────┐   import    ┌──────────┐   render    ┌──────────┐
│  9 个    │ ───────────► │ canonical│ ───────────►│  9 个    │
│ Agent 的 │   解析去重    │  store   │   写回渲染   │ Agent 的 │
│ 记忆文件 │ ◄─────────── │ JSON     │ ◄───────────│ 记忆文件 │
└──────────┘   sync --real└──────────┘  sync --real└──────────┘
                （真实路径    │  ~/.memlocal/         （真实路径
                  自动探测）  │  store.json            自动探测）
                            │
                            ▼
                    ┌─────────────────┐
                    │ 核心引擎（纯逻辑）│
                    │ reconcile 对账   │
                    │ extract 抽取     │
                    │ retrieve 检索    │
                    │ reflect 反思     │
                    │ audit 审计       │
                    │ backup 备份      │
                    └─────────────────┘
```

## 2. 核心概念

### Canonical Store（真相源）

单文件 JSON（`~/.memlocal/store.json`），每条记忆：

```jsonc
{
  "id": "m_<hex>",
  "content": "用户偏好用 TypeScript",   // 原子事实
  "type": "preference",                // identity|preference|project|context|fact|summary
  "source": "cursor",                  // 来自哪个 agent / manual
  "sourceFile": "/path/to/.cursorrules",
  "createdAt": 1700000000000,
  "updatedAt": 1700000000000,
  "confidence": 0.75,                  // 0..1
  "archived": false                    // 被反思归档（导出时跳过）
}
```

### 平台注册表（唯一真相源）

`core/render.js` 的 `PLATFORM_TARGETS` 是**唯一**定义 9 个平台的地方：

- `filename`：写回文件名
- `dir`：沙箱目录
- `format`：md | json
- `locations`：导入扫描的相对路径
- `realLocations`：真实写回探测候选（`~` 和 `{cwd}` 占位符）

**铁律**：其它模块一律 require 引用，禁止复制粘贴平台定义。

## 3. 数据流

### 读路径（导入）

```
agent 记忆文件 ──parseMarkdown/parseMdc/parseChatGPT──► 原子事实
    ──normalizeKey 去重──► 合并进 store.memories
```

### 写路径（同步）

```
store.memories ──renderFor(platform)──► 各平台格式
    ──detectRealLocation──► 真实路径（config 优先 > 已存在 > 项目级）
    ──写前 .bak 备份──► 落盘
```

### 对账路径（新增事实）

```
新事实 ──detectConflicts──► 无冲突→add / 有冲突→时间推理+置信度门控（可选 LLM）→ replace
    ──applyPlan──► store 变更
```

### 抽取路径（文本→记忆）

```
对话文本 ──分句 + 规则过滤（提问/指令/语气词/临时日程）──► 原子事实
    （可选）LLM 抽取 ──► 更准
    ──reconcile──► store
```

## 4. 核心模块职责

| 模块 | 职责 | 关键设计 |
|------|------|---------|
| `core/store.js` | store 读写 | 版本迁移(v1→v2)、损坏自动备份重建、审计日志(上限200) |
| `core/render.js` | 平台注册表 + 渲染 + 路径探测 | 唯一真相源；`~` 候选不撒 home |
| `core/import.js` | 解析 + 扫描 + 去重 | samples 精确扫描；显式 cwd 不扫样例 |
| `core/reconcile.js` | 对账引擎 | 纯逻辑无 fs 依赖；返回 plan 不突变；特征缓存(27x 性能提升) |
| `core/extract.js` | 文本抽取 | 确定性兜底 + LLM 增强；EVENT_RE 过滤日程 |
| `core/retrieve.js` | 检索打分 | recency × importance × relevance |
| `core/reflect.js` | 反思压缩 | 关键词聚类 + 摘要归档 |
| `core/writeback.js` | 写回适配器 | 沙箱/真实 + .bak + cursor .mdc |
| `core/backup.js` | 备份恢复 | gzip + 恢复前安全备份 |
| `core/llm.js` | LLM 增强 | DeepSeek；无 key 回退确定性；extractJSON 容错 |

## 5. 安全模型（最重要）

写回 / 探测的**安全铁律**：

1. **`~` 候选仅文件已存在时命中**——绝不因目录存在就往用户 home 撒新文件（曾踩坑：generic 探测命中 `~/.memlocal/MEMORY.md` 污染用户数据，已修复）。
2. **`{cwd}` 项目级候选**：父目录存在即可新建（项目级记忆文件合理）。
3. **config 显式优先**：`realTargets` 配置 > 自动探测。
4. **覆盖前 .bak**：可审计、可回滚。
5. **损坏不静默清空**：store.json 损坏自动备份 `.corrupt-*` 后重建。

## 6. 扩展指南

### 新增一个平台

1. 在 `core/render.js` 的 `PLATFORM_TARGETS` 加一条（filename/dir/format/locations/realLocations）。
2. 若格式非 md/json，在 `renderFor` 加渲染分支。
3. `samples/<platform>/` 放样例文件。
4. 测试：test-extract.js 注册表断言自动覆盖（平台数变化会触发）。

### 新增 CLI 命令

在 `cli.js` 的 switch 加 case，帮助文本同步加一行；`scripts/smoke-cli.js` 加断言。

### 新增评测

- 确定性：`scripts/eval.js` 或新 test 文件，纳入 `npm test`。
- LLM：`scripts/eval-llm.js`（有 key 才跑）。

### 性能注意

`reconcile` 的冲突检测是 O(N)（N=记忆条数），1000 条 ~1ms/条。若到 100k 条需引入倒排索引（见 `docs/bench.md`）。

## 7. 设计取舍

- **纯 Node 内置模块**：零依赖、可离线、易审计——代价是不能用向量数据库（当前规模用关键词打分足够）。
- **启发式对账**：确定性、可测、免费——代价是复杂语义矛盾判不准（用 `--llm` 增强兜底）。
- **单文件 store**：简单、透明、可手改——代价是并发写需小心（CLI 单进程设计无冲突）。
- **plan 模式**：所有变更返回 plan 由调用方决定 apply——可审计、可回滚，符合"用户拥有数据"原则。
