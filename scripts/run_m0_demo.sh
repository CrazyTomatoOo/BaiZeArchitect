set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
PILOT_REPO="$ROOT_DIR/pilot-backend"
JAVA_CLASSES_DIR="/var/folders/l9/f_bwssk92970slrgk7h686z40000gn/T/opencode/pilot-classes"

printf "M0 demo starting\n"
printf "workspace: %s\n" "$ROOT_DIR"

printf "\n[1/5] pilot repository commit\n"
git -C "$PILOT_REPO" rev-parse --short=12 HEAD

printf "\n[2/5] validate M0 baseline with default local repository\n"
uv run "$ROOT_DIR/scripts/validate_m0.py"

printf "\n[3/5] validate M0 baseline with explicit repository mapping\n"
uv run "$ROOT_DIR/scripts/validate_m0.py" --repo-root "pilot-backend=$PILOT_REPO"

printf "\n[4/5] validate M0 design package\n"
uv run "$ROOT_DIR/scripts/validate_m0_package.py"

printf "\n[5/5] compile Java pilot evidence files\n"
mkdir -p "$JAVA_CLASSES_DIR"
javac -d "$JAVA_CLASSES_DIR" "$PILOT_REPO"/src/main/java/example/*.java

printf "\nM0 demo passed\n"
