#!/bin/sh
# evidence.sh — 宿主: codebase-memory-mcp → evidence/<repo-id>.json
#
# 取 get_architecture(hotspots/boundaries/clusters/layers/entry_points) + manage_adr(get
# 历史决策,#9 复用注入)。容器挂 /evidence:ro,cli.ts architect prompt 注入结构化证据。
# agent 不直接调 mcp(容器 linux 跑不了 mac binary),用宿主预产的结构化证据。
#
# ponytail: 走 binary 的 `cli <tool>` 子命令 + stdin 传参(positional JSON 已 deprecated)。
# JSON 合并用 python3(宿主 mac 自带)。
set -eu
REPO_PATH="${1:?usage: evidence.sh <repo-path> [repo-id]}"
REPO_ID="${2:-$(basename "$REPO_PATH")}"
CBMEM="${CBMEM:-/Users/crazytomatooo/.local/bin/codebase-memory-mcp}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EVIDENCE_DIR="${BAIZE_EVIDENCE_DIR:-$ROOT/evidence}"
OUT="$EVIDENCE_DIR/$REPO_ID.json"
mkdir -p "$EVIDENCE_DIR"

ABS="$(cd "$REPO_PATH" && pwd)"
PROJ="${ABS#/}"; PROJ="${PROJ//\//-}"   # codebase-memory-mcp project key = abs path 的 / → -

ASPECTS='["overview","entry_points","hotspots","boundaries","layers","clusters"]'

python3 - "$CBMEM" "$OUT" "$REPO_ID" "$PROJ" "$ABS" "$ASPECTS" <<'PY'
import sys, json, subprocess
cbmem, out, repo_id, proj, abspath, aspects = sys.argv[1:7]
aspects = json.loads(aspects)

def call(tool, args):
    # stdin 传参(positional JSON 形式已 deprecated)
    r = subprocess.run([cbmem, "cli", tool], input=json.dumps(args),
                       capture_output=True, text=True)
    if r.returncode != 0:
        sys.stderr.write(r.stderr[:500])
        return None
    try:
        return json.loads(r.stdout)
    except Exception as e:
        sys.stderr.write(f"[evidence] {tool} parse failed: {e}\n")
        return None

arch = call("get_architecture", {"project": proj, "aspects": aspects})
if arch is None:
    print(f"[evidence] {proj} 未索引 → index_repository (mode=fast)")
    call("index_repository", {"repo_path": abspath, "mode": "fast"})
    arch = call("get_architecture", {"project": proj, "aspects": aspects}) or {}
adr = call("manage_adr", {"project": proj, "mode": "get"}) or {}

doc = {
    "repositoryId": repo_id,
    "project": proj,
    "repoPath": abspath,
    "architecture": arch,
    "priorAdr": {"content": adr.get("content", ""), "status": adr.get("status", "")},
}
with open(out, "w") as f:
    json.dump(doc, f, ensure_ascii=False)

hs = len(arch.get("hotspots", []))
bd = len(arch.get("boundaries", []))
print(f"[evidence] wrote {out} (nodes={arch.get('total_nodes')} "
      f"hotspots={hs} boundaries={bd} adr={adr.get('status', '?')})")
PY
