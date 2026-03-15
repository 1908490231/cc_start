#!/bin/bash

# CC Star 自动安装脚本 (Mac/Linux)

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}╔════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     CC Star 安装程序               ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════╝${NC}"
echo ""

# 检测安装目录
INSTALL_DIR=""

if [[ -d "$HOME/.local/bin" ]]; then
    INSTALL_DIR="$HOME/.local/bin"
elif [[ -d "/usr/local/bin" ]]; then
    INSTALL_DIR="/usr/local/bin"
else
    echo "未找到标准安装目录"
    read -p "请输入安装目录 (直接回车使用 ~/.local/bin): " custom_dir
    INSTALL_DIR="${custom_dir:-$HOME/.local/bin}"
    mkdir -p "$INSTALL_DIR"
fi

echo "安装目录: $INSTALL_DIR"

# 检查是否已安装
if [[ -f "$INSTALL_DIR/cc" ]]; then
    echo -e "${YELLOW}⚠️  CC Star 已安装${NC}"
    read -p "是否覆盖? (y/N): " confirm
    if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
        echo "取消安装"
        exit 0
    fi
fi

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 复制主脚本
cp "$SCRIPT_DIR/cc" "$INSTALL_DIR/cc"
chmod +x "$INSTALL_DIR/cc"

echo -e "${GREEN}✅ 主脚本已安装${NC}"

# 创建模型配置目录
mkdir -p "$HOME/.claude/models"
echo -e "${GREEN}✅ 配置目录已创建: ~/.claude/models${NC}"

# 复制示例配置
if [[ -d "$SCRIPT_DIR/models" ]]; then
    cp "$SCRIPT_DIR/models"/example-*.json "$HOME/.claude/models/" 2>/dev/null || true
    echo -e "${GREEN}✅ 示例配置已复制${NC}"
fi

# 检查 PATH
echo ""
if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
    echo -e "${YELLOW}⚠️  $INSTALL_DIR 不在 PATH 中${NC}"
    echo ""
    echo "请手动添加以下行到你的 shell 配置文件:"
    echo ""

    SHELL_NAME=$(basename "$SHELL")
    if [[ "$SHELL_NAME" == "zsh" ]]; then
        echo "echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.zshrc"
        echo "source ~/.zshrc"
    else
        echo "echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.bashrc"
        echo "source ~/.bashrc"
    fi
    echo ""
else
    echo -e "${GREEN}✅ PATH 检查通过${NC}"
fi

echo ""
echo -e "${GREEN}🎉 安装完成!${NC}"
echo ""
echo "使用方法:"
echo "  cc              - 交互式选择模型"
echo "  cc <模型名>     - 直接启动指定模型"
echo "  cc add          - 添加新模型配置"
echo ""
echo "请编辑 ~/.claude/models/ 下的配置文件，填入你的 API Key"
