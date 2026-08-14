# MemLocal 性能基准

> 运行：`node scripts/bench.js [条数]`（默认 1000 条）
> 环境：Node v22.22.2，macOS，纯 Node 内置模块（零依赖）

## 1000 条记忆基准结果（reconcile 缓存优化后）

| 操作 | 耗时 | 说明 |
|------|------|------|
| `loadStore` | 3.7 ms | 读 canonical store JSON |
| `sync` 渲染 9 平台 | 4.8 ms | 全平台写回渲染 |
| `search "咖啡" top5` | 14.2 ms | 带命中检索 |
| `search 无命中词` | 10.4 ms | 全量打分但无命中 |
| `reconcile 新增 100 条` | **91.6 ms** | 批量对账（含冲突检测） |
| `reflect` 压缩聚类 | 26.1 ms | 反思/智能遗忘 |
| `extract` 1KB 文本 | 0.8 ms | 确定性抽取 |
| `detectRealLocation` 9 平台 | 1.0 ms | 真实路径探测 |
| `saveStore` | 3.6 ms | 落盘 |

堆内存：10–12 MB / RSS ~75 MB（1000 条记忆规模）。

## 性能优化记录

**reconcile 从 2466.7ms → 91.6ms（27 倍提升）**，根因与解法：

- **根因**：`detectConflicts` 对每条旧记忆全量调用 `relationOf`，而 `relationOf` 内部每次都重新做分词、bigram 生成、极性/实体/反义域计算——O(N×M×分词) 三重复杂度。100 条 changes × 1000 条旧记忆 = 10 万次重复分词。
- **解法**：
  1. `makeFeatureCache()`：一次 reconcile 内用 `Map` 缓存 `normalize/keywords/polarity/domain/entities` 五个特征的计算结果（内容相同即复用）。
  2. 精确重复检测从 `Array.find` 改为 `Map` 索引（O(1)）。
  3. 交集计算选较小集合迭代。
- **零回归**：对账 19 项 + eval 13 项测试全部通过。

## 扩展性判断

- 1000 条记忆：所有操作 < 100ms，日常使用无感知。
- 预计 10k 条：reconcile 批量对账 ~1s（可接受，因冲突检测理论上仍 O(N) 每条），单条新增 ~10ms；search 全量打分 ~150ms。
- 若未来达到 100k 条级别，建议引入倒排索引（按关键词/实体预索引）替代全量扫描——当前规模无需。

## 结论

**MemLocal 在 1000 条记忆规模下性能充足，达到"日常可用"标准**；reconcile 缓存优化消除了唯一的显著热点。
