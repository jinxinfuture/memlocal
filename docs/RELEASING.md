# MemLocal 发布检查清单

> 维护者发布新版本的标准流程。每一步都应在发布前完成。

## 1. 预检（每次发布前）

```bash
# 全部测试（7 套：eval/reconcile/extract/store/writeback/smoke-cli/demo）
npm test

# 性能基准（确认无回归）
node scripts/bench.js

# 打包内容验证
npm pack --dry-run
```

**通过标准**：
- [ ] `npm test` 全部通过（当前 136 项）
- [ ] `bench` 全部操作 < 100ms（1000 条记忆）
- [ ] tarball 包含 `cli.js` / `core/` / `public/` / `samples/` / `docs/` / `FORMAT.md` / `README*.md` / `AGENTS.md` / `LICENSE`
- [ ] tarball **不含** `data/` / `exports/` / 测试产生的记忆文件

## 2. 版本号与 CHANGELOG

```bash
# 语义化版本：bugfix 补丁号 / 新功能次版本号 / 破坏性大版本号
npm version patch   # 或 minor / major（自动更新 package.json + 打 tag）
```

- [ ] `CHANGELOG.md` 更新（unreleased → 新版本，记录所有变更）
- [ ] `package.json` version 与 CHANGELOG 一致
- [ ] tag 已创建（`npm version` 自动）

## 3. 发布到 npm

```bash
npm login                    # 首次需要（npm whoami 确认已登录）
npm publish                  # prepublishOnly 会自动重跑 npm test
```

- [ ] 发布成功（npm 显示 `+ memlocal@x.y.z`）
- [ ] 用干净环境验证：`npm install -g memlocal && memlocal --help`
- [ ] `npx memlocal` 也能跑

## 4. GitHub Release

```bash
gh release create v0.x.0 --title "v0.x.0" --notes "见 CHANGELOG.md"
```

- [ ] Release 创建，标题为版本号
- [ ] 说明链接到 CHANGELOG

## 5. 发布后验证

```bash
# 真机冒烟（临时环境）
MEMLOCAL_HOME=/tmp/verify memlocal init
MEMLOCAL_HOME=/tmp/verify memlocal import
MEMLOCAL_HOME=/tmp/verify memlocal sync --dry-run

# 确认 CI 对新 tag 绿
gh run list --limit 3
```

- [ ] 安装后的 CLI 全流程可用
- [ ] CI 全绿（含 mac/win/linux × node 20/22 矩阵）

## 版本历史

| 版本 | 日期 | 重点 |
|------|------|------|
| 0.3.0 | 2026-08-15 | reconcile 27x 性能、完整文档、CI 矩阵 |
| 0.2.0 | 2026-08-15 | 备份/审计/watch/.mdc 写回/store 健壮性 |
| 0.1.0 | 2026-08-15 | 初始 MVP（9 平台 + 核心引擎） |
