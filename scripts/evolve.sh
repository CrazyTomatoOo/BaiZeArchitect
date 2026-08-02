#!/bin/sh
# evolve.sh — 工作流跑完后沉淀经验 (#9 + #9c):
#   (1) manage_adr(update) 存 Design Package 为 ADR → evidence.sh 取回注入(历史决策复用)
#   (2) distill-gene 蒸馏 gene 到 ./evolver-home(与容器共享)→ 容器 evolver_recall 命中
# 这是 Evolver 对 BaiZe 的真实价值: 工作流自经验沉淀→下次复用。
set -eu
REPO_PATH="${1:?usage: evolve.sh <repo-path> [design-package.md]}"
PKG="${2:-}"
CBMEM="${CBMEM:-/Users/crazytomatooo/.local/bin/codebase-memory-mcp}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ABS="$(cd "$REPO_PATH" && pwd)"
REPO_ID="$(basename "$ABS")"
PROJ="${ABS#/}"; PROJ="${PROJ//\//-}"   # 与 evidence.sh 一致

[ -n "$PKG" ] || PKG="$(ls -t "$ROOT"/out/design-package-"$REPO_ID"-*.md 2>/dev/null | head -1)"
[ -n "$PKG" ] || { echo "[evolve] no design package for $REPO_ID in $ROOT/out"; exit 1; }

# (1) ADR 沉淀
python3 - "$CBMEM" "$PROJ" "$PKG" <<'PY'
import sys, json, subprocess
cbmem, proj, pkg = sys.argv[1:4]
content = open(pkg, encoding="utf-8").read()
r = subprocess.run([cbmem, "cli", "manage_adr"],
                   input=json.dumps({"project": proj, "mode": "update", "content": content}),
                   capture_output=True, text=True)
ok = r.returncode == 0
try:
    res = json.loads(r.stdout) if r.stdout else {}
except Exception:
    res = {}
print(f"[evolve] manage_adr update {'OK' if ok else 'FAIL'} "
      f"project={proj} pkg={pkg} status={res.get('status', '?')}")
if not ok:
    sys.stderr.write(r.stderr[:500])
    sys.exit(1)
PY

# (2) gene 蒸馏 → ./evolver-home(与容器 /evolver-home 同 store;非致命)
echo "[evolve] distilling gene -> $ROOT/evolver-home ..."
( cd "$ROOT/agent-runtime" && EVOLVER_HOME="$ROOT/evolver-home" \
    npx tsx distill-gene.ts "$PKG" 2>&1 | grep -v '^time=' | tail -3 ) \
    || echo "[evolve] distill 失败(非致命,ADR 已存)"
