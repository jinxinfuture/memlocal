# MemLocal 发布检查清单

> 维护者发布新版本的标准流程。

## 0. 一次性配置（首次）

```bash
# 1. npm 官方源登录（本机 registry 默认是 npmmirror，发布必须切官方源）
npm config set registry https://registry.npmjs.org/
npm login

# 2. 生成 npm 自动化 token（npm 官网 → Access Tokens → Generate New Token → 选「Automation」）
#    然后在 GitHub 仓库 Settings → Secrets and variables → Actions 添加：
#    NPM_TOKEN = <生成的 token>
```

## 1. 发布（日常工作流：打 tag 即发布）

```bash
npm version patch|minor|major          # 更新 package.json + 打 tag
git push && git push --tags            # 触发 CI + Release 工作流
```

**`.github/workflows/release.yml` 自动完成**：跑全套测试 → `npm publish` → `npm install -g` 验证 → 建 GitHub Release。

**本地预检（可选）**：

```bash
npm test                     # 全量测试（当前 190+ 项）
npm pack --dry-run           # 确认打包内容（37 文件，无 data/exports 泄漏）
```

## 2. 发布后验证

```bash
npm install -g memlocal && memlocal --version   # 应输出新版本号
npx memlocal                                   # 临时调用
MEMLOCAL_HOME=/tmp/verify memlocal doctor      # 诊断健康
```

- [ ] 安装后的 CLI 全流程可用
- [ ] CI 全绿（mac/win/linux × node 20/22）
- [ ] Release 页有正确标题与 CHANGELOG 链接

## 版本历史

| 版本 | 日期 | 重点 |
|------|------|------|
| 0.4.0 | 2026-08-15 | doctor / 记忆新鲜度 / HTTP API 文档 |
| 0.3.0 | 2026-08-15 | reconcile 27x 性能、完整文档、CI 矩阵 |
| 0.2.0 | 2026-08-15 | 备份/审计/watch/.mdc 写回/store 健壮性 |
| 0.1.0 | 2026-08-15 | 初始 MVP（9 平台 + 核心引擎） |
