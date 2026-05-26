#!/usr/bin/env bash
# Deploy ./prototypes/ to design-prototype.airgms.com via rsync.
#
# Usage:
#   ./deploy.sh                       deploy everything (the whole prototypes/ tree)
#   ./deploy.sh --dry                 dry-run (show what would change, no upload)
#   ./deploy.sh hero01-copperx        deploy a single prototype subfolder
#   ./deploy.sh hero01-copperx --dry  dry-run a single prototype
#
# Notes:
# • Uses ~/.ssh/ec2_proto_deploy_ed25519 (dedicated deploy key).
# • rsync --delete: server side mirrors local; orphan files on server get removed.
# • Single-prototype mode only syncs that folder, so shared/ stays put.

set -euo pipefail

REMOTE_USER="deploy"
REMOTE_HOST_SSH="54.245.205.132"           # IP — stable, used for SSH/rsync
REMOTE_HOST_URL="design-prototype.airgms.com"  # domain — for the URL shown after deploy
REMOTE_ROOT="/var/www/prototypes"
SSH_KEY="${HOME}/.ssh/ec2_proto_deploy_ed25519"

cd "$(dirname "$0")"
SRC_ROOT="$(pwd)/prototypes"

DRY=""
TARGET=""

for arg in "$@"; do
  case "$arg" in
    --dry|-n)     DRY="--dry-run" ;;
    --help|-h)
      sed -n '2,16p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *)
      if [ -d "${SRC_ROOT}/${arg}" ]; then
        TARGET="$arg"
      else
        echo "✗ Unknown prototype: ${arg}"
        echo "  Available:"
        for d in "${SRC_ROOT}"/*/; do
          [ -d "$d" ] && echo "    $(basename "$d")"
        done
        exit 1
      fi
      ;;
  esac
done

if [ -n "$TARGET" ]; then
  SRC="${SRC_ROOT}/${TARGET}/"
  DST="${REMOTE_USER}@${REMOTE_HOST_SSH}:${REMOTE_ROOT}/${TARGET}/"
  URL="https://${REMOTE_HOST_URL}/${TARGET}/"
else
  SRC="${SRC_ROOT}/"
  DST="${REMOTE_USER}@${REMOTE_HOST_SSH}:${REMOTE_ROOT}/"
  URL="https://${REMOTE_HOST_URL}/"
fi

echo "▶ ${SRC}"
echo "→ ${DST}"
[ -n "$DRY" ] && echo "  (dry run — no changes will be applied)"
echo ""

rsync -avz --delete ${DRY} \
  -e "ssh -i ${SSH_KEY} -o BatchMode=yes" \
  --exclude '.DS_Store' \
  --exclude '*.swp' \
  --exclude '*~' \
  "$SRC" "$DST"

echo ""
if [ -n "$DRY" ]; then
  echo "Dry run complete. Re-run without --dry to actually deploy."
else
  echo "✓ Deployed. Open: ${URL}"
fi
