#!/usr/bin/env bash
# MemLocal 新项目接入示例（可执行）
# 用法：bash examples/workflow.sh
set -e

echo "==> 1/5 初始化（隔离环境演示用 MEMLOCAL_HOME，实际使用无需设置）"
export MEMLOCAL_HOME="$(mktemp -d)"
memlocal init 2>/dev/null || node cli.js init

echo "==> 2/5 导入现有记忆"
memlocal import 2>/dev/null || node cli.js import

echo "==> 3/5 从对话抽取记忆"
memlocal extract --text "我叫小王，负责记忆层。我讨厌香菜，最近在学 Rust。" --apply 2>/dev/null \
  || node cli.js extract --text "我叫小王，负责记忆层。我讨厌香菜，最近在学 Rust。" --apply

echo "==> 4/5 检索"
memlocal search "Rust" --limit 3 2>/dev/null || node cli.js search "Rust" --limit 3

echo "==> 5/5 审计（透明可控）"
memlocal audit --limit 5 2>/dev/null || node cli.js audit --limit 5

echo ""
echo "✅ 示例完成。真实使用：memlocal init && memlocal import && memlocal sync --real"
