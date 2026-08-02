#!/bin/sh
# ponytail: host 跑,归档 Design Package 到 git(容器无 git)。
set -e
cd "$(dirname "$0")/.." || exit 1
git add out/*.md 2>/dev/null || true
if git diff --cached --quiet; then
	echo "[archive] 无新 Design Package"
else
	msg="design: $(ls -t out/*.md | head -1 | sed 's#.*/design-package-##; s#\.md$##')"
	git -c user.name="baize" -c user.email="baize@local" commit -m "$msg" 2>&1 | tail -2
fi
