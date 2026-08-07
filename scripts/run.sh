#!/bin/sh
# run.sh — docker compose run 包装。
# 挂指定仓库为 /repo(rw,gitnexus 写 .gitnexus),容器内 gitnexus 产 evidence,再跑 baize agent。
#
# usage: run.sh <repo-dir> <requirement-text|requirement-file-path> [extra baize args...]
# example: run.sh lws "为 LeaderWorkerSet 增加 subdomain 试过滚动更新"
#          run.sh test-repo-2 ./req.txt
set -eu
REPO="${1:?usage: run.sh <repo-dir> <requirement|req-file> [extra...]}"
shift
REQ="${1:?missing requirement text or requirement-file path}"
shift || true

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
REPO_ABS="$(cd "$REPO" 2>/dev/null && pwd || echo "$ROOT/$REPO")"
REPO_ID="$(basename "$REPO_ABS")"

# requirement-file 在宿主读取后作为 --requirement 传入(避免容器路径挂载)
if [ -f "$REQ" ]; then REQ="$(cat "$REQ")"; fi

docker compose run --rm \
	-v "$REPO_ABS:/repo" \
	baize --repo /repo --repo-id "$REPO_ID" --requirement "$REQ" "$@"
