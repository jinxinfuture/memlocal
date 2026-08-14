# MemLocal — Cross-app, Local-first, User-owned Unified Memory Layer

[![CI](https://github.com/jinxinfuture/memlocal/actions/workflows/ci.yml/badge.svg)](https://github.com/jinxinfuture/memlocal/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[中文版](README.md)

**One shared memory for all your code agents — stored locally, owned by you.**

Claude Code / Cursor / Windsurf / Codex / Gemini / Aider / GitHub Copilot / ChatGPT memories,
**aggregated into one local file** (canonical store), then **synced back** to every agent's native memory file.
Your memory is never locked inside a single platform.

> Design principle: **Don't plant crops in one platform's garden — build the road that connects all gardens.**

---

## Why it exists (moat)

- **Memory ≠ a document**: a document is a *transport format*; the canonical store is the *source of truth*. A plain document collapses when memory scales, is written by multiple agents, or facts change (see `docs/design-memory-vs-document.md`).
- **Local-first, user-owned**: memory lives on your machine (`~/.memlocal/`), no cloud required, auditable and exportable.
- **Cross-platform middleware**: no single agent will ever build compatibility for its competitors' memory — the open-format + local-first "road between gardens" is a position platforms can't kill.
- **Intelligent reconciliation**: automatically detects contradictions / updates / entity switches, resolves by time reasoning + confidence gating (`core/reconcile.js`).
- **Transparent & auditable**: every write operation is logged (`memlocal audit`) — you can always see *why* a memory was kept, changed, or deleted.

---

## Install

```bash
npm install -g memlocal      # or use on the fly: npx memlocal
```

Zero external dependencies, pure Node built-ins (Node ≥ 18).

### Run from source (dev / pre-release)

```bash
git clone https://github.com/jinxinfuture/memlocal.git
cd memlocal
npm test                     # 5 suites, all green
node cli.js init
node cli.js import && node cli.js sync --real
node cli.js serve            # Web panel :4173
```

### Publish to npm (maintainer)

```bash
npm test                     # pre-publish self-check (also run by prepublishOnly)
npm login
npm publish
```

Check `npm pack --dry-run` before publishing (should contain cli.js / core/ / public/ / samples/ / docs, never data/ or exports/).

## One-line sync

```bash
memlocal init                           # init ~/.memlocal (store + default config)
memlocal import                         # scan cwd + home, aggregate all agents' memories
memlocal sync                           # sync to all 9 platforms (sandbox ~/.memlocal/writes/ by default)
memlocal sync --dry-run                 # preview what would be written (nothing touches disk)
memlocal sync --real                    # real write-back: auto-detect each agent's real path + .bak backup
memlocal extract --text "I'm Wang, I own the memory layer. I hate cilantro." --apply   # grow memory from a conversation
```

Daily loop: `memlocal import && memlocal sync --real`

## All commands

| Command | Purpose |
|------|------|
| `memlocal init` | Init `~/.memlocal` (store + default config) |
| `memlocal status` | Store stats, supported platforms, real write-back detection |
| `memlocal import` | Scan cwd + home + samples, aggregate agent memories into store (dedup) |
| `memlocal sync [--dry-run] [--real] [--platforms p1,p2]` | Sync to all 9 platforms. Default sandbox; `--real` auto-detects real paths + `.bak` backup |
| `memlocal extract --text "..." [--file F] [--llm] [--apply]` | Extract atomic facts from a conversation/text (filters questions/commands/filler/temporary events) |
| `memlocal watch [--interval N] [--real]` | Watch agent memory files for changes, auto import + sync |
| `memlocal export --platform claude` | Print rendered output for one platform |
| `memlocal search "<q>" [--limit N]` | Ranked retrieval (`recency × importance × relevance`) |
| `memlocal reconcile --content "..." [--apply] [--llm]` | Submit a new fact and reconcile (optional LLM enhancement) |
| `memlocal reflect [--apply]` | Reflect/compress scattered facts into summaries (intelligent forgetting) |
| `memlocal audit [--limit N]` | View audit log of every write operation |
| `memlocal config get\|set <key> <value>` | View/set config (e.g. `deepseek.apiKey sk-xxx`, `realTargets.claude ~/.claude/CLAUDE.md`) |
| `memlocal backup` / `backups` / `restore --file <backup>` | Create / list / restore backups (gzip, auto safety backup before restore) |
| `memlocal export-all` | Export all memories (merged Markdown + raw JSON, portable) |
| `memlocal serve` | Start Web panel (default `:4173`: extract, search, audit, write-back preview) |

## Data location

- Source of truth: `~/.memlocal/store.json` (override with `MEMLOCAL_HOME` for demo/test; legacy `<project>/data/store.json` auto-compatible).
- Config: `~/.memlocal/config.json` (`realTargets` explicit paths; otherwise `sync --real` auto-detects).
- Backups: `.bak` before every real write; corrupted store.json auto-backed-up as `.corrupt-<timestamp>` and rebuilt — never silently wiped.
- Audit: store keeps `audit` log (max 200 entries) of every import/extract/sync/reconcile/reflect/add/update/delete.

## Real write-back path auto-detection

`memlocal sync --real` needs zero manual config:

| Platform | Detection candidates (priority order) |
|------|------|
| Claude Code | `~/.claude/CLAUDE.md` → `~/.claude/CLAUDE.local.md` (local override) → project `CLAUDE.md` → `CLAUDE.local.md` |
| Cursor | project `.cursor/rules` → `.cursorrules` → `~/.cursor/rules` |
| Windsurf | project `.windsurfrules` → `~/.codeium/windsurf/.windsurfrules` |
| ChatGPT | project `memory.json` |
| Generic | `~/.memlocal/MEMORY.md` → project `MEMORY.md` |
| Codex | project `AGENTS.md` → `~/.codex/AGENTS.md` |
| Gemini | project `GEMINI.md` → `~/.gemini/GEMINI.md` |
| Aider | project `CONVENTIONS.md` → `~/.aider/CONVENTIONS.md` |
| Copilot | `~/.config/github-copilot/instructions.md` → project `.github/copilot-instructions.md` |

**Safety policy**: existing real config files are updated; `~` candidates only match if the file *already exists* (never sprinkle new files into your home); project-level `{cwd}` candidates can be created when the parent dir exists. Explicit `config set <platform> <path>` always wins over auto-detection.

**Cursor special case**: when `.cursor/rules` is detected as a directory, MemLocal writes `memlocal-memory.mdc` (Cursor's native rule format with YAML frontmatter) instead of `.cursorrules`.

**Auto-sync**: `memlocal watch` watches all agent memory files; on change it auto-runs `import` + `sync`, making "agent changed a memory → auto-aggregate → auto-write-back everywhere" a resident workflow.

## Architecture

- `core/store.js` — canonical store (source of truth) + version migration + corruption recovery + audit log
- `core/import.js` — parse (Markdown / .mdc / ChatGPT JSON) + scan real locations + dedup merge (single implementation)
- `core/render.js` — canonical → per-agent formats (9 platforms) + real-path detection (single source of truth)
- `core/reconcile.js` — reconciliation engine (contradiction/update/entity switch + time reasoning + confidence gating) + `core/llm.js` (LLM layer, auto-fallback to deterministic without key)
- `core/extract.js` — text → atomic facts (deterministic fallback + optional LLM), filters questions/commands/temporary events
- `core/retrieve.js` — ranked retrieval (`recency × importance × relevance`)
- `core/reflect.js` — reflection/compression (intelligent forgetting)
- `core/writeback.js` — write-back adapter (sandbox / auto-detect real paths + backup)
- `core/backup.js` — backup / restore / export (gzip)
- `cli.js` — one-line CLI (init/status/import/sync/extract/watch/...)
- `server.js` + `public/index.html` — Web panel (search / extract / audit / write-back preview)
- `samples/` — sample memory files for all 9 platforms (demo)
- `FORMAT.md` — **open format standard** (any agent can integrate)
- `AGENTS.md` — collaboration guide for any code agent entering this repo

## Open format standard

MemLocal defines "memory" as an open JSON spec (`FORMAT.md`) any code agent can read/write with one command.
That's the moat: when all agents recognize this format, MemLocal becomes the "SQLite of memory" — the default location for user data.

## Quality assurance

- `npm test` runs six deterministic suites: `scripts/eval.js` (LOCOMO-style benchmark, incl. extract/migration/mdc/watch) + `scripts/test-reconcile.js` (reconciliation) + `scripts/test-extract.js` (extraction/path detection/registry/LLM tolerance) + `scripts/test-store.js` (migration/corruption/audit) + `scripts/test-writeback.js` (sandbox/real/backup/cursor .mdc/safety) + `scripts/smoke-cli.js` (all 16 CLI commands), CI all green.
- Reconciliation / compression / extraction return a plan; caller decides whether to apply. Write-back auto-backs-up — auditable and rollback-safe.
- `npm pack` verified (includes cli/core/public/samples/docs); `npm install -g` tested — the `memlocal` command works.
- `scripts/eval-llm.js` runs real LLM eval only when `DEEPSEEK_API_KEY` is set; SKIPs otherwise (never fails CI).

## License

[MIT](LICENSE) — free to use, modify, redistribute.
