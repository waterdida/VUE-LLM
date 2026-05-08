#!/bin/bash
# 将项目打包为压缩包，仅包含必要文件，便于他人下载使用

set -e
PROJECT_NAME="vue-llm"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_FOLDER="$(basename "$PROJECT_DIR")"
PARENT_DIR="$(dirname "$PROJECT_DIR")"
cd "$PARENT_DIR"

# 压缩包输出到项目父目录，避免打包时包含自身
ARCHIVE_TAR="${PARENT_DIR}/${PROJECT_NAME}-release.tar.gz"
ARCHIVE_ZIP="${PARENT_DIR}/${PROJECT_NAME}-release.zip"

echo "正在打包 $PROJECT_NAME..."

# 使用 tar 排除不需要的文件（从父目录打包，解压后得到项目文件夹）
tar --exclude="${PROJECT_FOLDER}/node_modules" \
    --exclude="${PROJECT_FOLDER}/.pnpm-store" \
    --exclude="${PROJECT_FOLDER}/.git" \
    --exclude="${PROJECT_FOLDER}/.cursor" \
    --exclude="${PROJECT_FOLDER}/dist" \
    --exclude="${PROJECT_FOLDER}/test-results" \
    --exclude="${PROJECT_FOLDER}/*.log" \
    --exclude="${PROJECT_FOLDER}/.DS_Store" \
    --exclude="${PROJECT_FOLDER}/.vite" \
    --exclude="${PROJECT_FOLDER}/*.tar.gz" \
    --exclude="${PROJECT_FOLDER}/*.zip" \
    --exclude="${PROJECT_FOLDER}/src/config/deepseekKey.js" \
    -czvf "$ARCHIVE_TAR" \
    "$PROJECT_FOLDER"

# 同时生成 zip 格式（Windows 用户友好）
if command -v zip &>/dev/null; then
  cd "$PARENT_DIR"
  zip -rq "$ARCHIVE_ZIP" "$PROJECT_FOLDER" \
    -x "*node_modules*" \
    -x "*.pnpm-store*" \
    -x "*.git*" \
    -x "*.cursor*" \
    -x "*dist*" \
    -x "*test-results*" \
    -x "*.log" \
    -x "*.DS_Store" \
    -x "*.vite*" \
    -x "*.tar.gz" \
    -x "*.zip" \
    -x "*deepseekKey.js"
  echo "已生成: $ARCHIVE_TAR"
  echo "已生成: $ARCHIVE_ZIP"
else
  echo "已生成: $ARCHIVE_TAR"
fi
