#!/bin/bash
# 创建 GitHub Release 并上传资产
# 用法: ./tools/create-release.sh <tag> <zip路径> [标题] [说明文件]
set -e
TAG="$1"
ASSET="$2"
TITLE="${3:-$TAG}"
BODY_FILE="${4:-/dev/null}"

# 从 git 凭据管理器拿 token（不回显）
TOKEN=$(printf "protocol=https\nhost=github.com\n" | git credential fill | grep '^password=' | cut -d= -f2-)
if [ -z "$TOKEN" ]; then echo "ERROR: no github token in credential manager"; exit 1; fi

REPO="2436136932/Slack_Away"

# 1. 创建 release
echo "[1/2] Creating release $TAG ..."
BODY=$(jq -Rs . < "$BODY_FILE" 2>/dev/null || echo '""')
RESP=$(curl -sS -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/$REPO/releases" \
  -d "{\"tag_name\":\"$TAG\",\"target_commitish\":\"main\",\"name\":\"$TITLE\",\"body\":$BODY,\"draft\":false,\"prerelease\":false}")

REL_ID=$(echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null)
if [ -z "$REL_ID" ]; then
  echo "ERROR: release create failed:"; echo "$RESP" | head -20; exit 1
fi
echo "  release id=$REL_ID"

# 2. 上传资产
NAME=$(basename "$ASSET")
echo "[2/2] Uploading $NAME ($(du -h "$ASSET" | cut -f1)) ..."
UP=$(curl -sS -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/zip" \
  --data-binary "@$ASSET" \
  "https://uploads.github.com/repos/$REPO/releases/$REL_ID/assets?name=$NAME")
BROWSER_URL=$(echo "$UP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('browser_download_url',''))" 2>/dev/null)
if [ -z "$BROWSER_URL" ]; then
  echo "ERROR: asset upload failed:"; echo "$UP" | head -20; exit 1
fi
echo "DONE: $BROWSER_URL"
