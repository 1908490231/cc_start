# CC Star

在不同窗口中使用不同 AI 模型的 Claude Code 启动器。

## 一句话说明

安装后，输入 `cc` 选择模型，或 `cc kimi` / `cc qwen` 直接启动对应模型。

```bash
$ cc

╔════════════════════════════════════╗
║     Claude Code 模型选择器         ║
╚════════════════════════════════════╝

  1) kimi        - Kimi K2.5
  2) qwen        - 千问 3.5 Plus
  3) glm         - GLM 5
  4) mini        - MiniMax M2.5

请选择模型 (输入编号或名称): 2
🚀 启动 Claude Code [千问 3.5 Plus]...
```

## 支持的模型

| 命令 | 模型 |
|------|------|
| `cc kimi` | Kimi K2.5 |
| `cc qwen` | 千问 3.5 Plus |
| `cc glm` | GLM 5 |
| `cc mini` | MiniMax M2.5 |
| `cc <任意>` | **其他任意模型** |

> 💡 **想添加自己的模型？** 看下面的「快速开始」第 2 步，支持任意兼容 Claude API 的模型。

## 快速开始

### 方式一：自动安装（推荐）

**Windows:**
```cmd
# 克隆项目后，在项目目录运行
install.bat
```

**Mac/Linux:**
```bash
# 克隆项目后，在项目目录运行
chmod +x install.sh
./install.sh
```

## 配置说明

`~/.claude/models/kimi.json` 示例：

```json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "your-api-key",
    "ANTHROPIC_BASE_URL": "https://api.kimi.com/coding/",
    "ANTHROPIC_MODEL": "kimi-k2.5"
  }
}
```

项目 `models/` 目录包含 4 个示例配置文件，按需复制修改即可。

## 快速开始

### 第一步：安装

**自动安装（推荐）**
```bash
# Windows: 双击运行 install.bat
# Mac/Linux: chmod +x install.sh && ./install.sh
```

**手动安装**
把 `cc`（和 `cc.cmd`）复制到 PATH 目录（如 `~/.local/bin/`），然后：
```bash
mkdir -p ~/.claude/models
cp models/*.json ~/.claude/models/
```

### 第二步：配置 API Key

**方法 A：命令行快速添加（适合新模型）**

```bash
cc add
```

然后按提示填写：
```
模型别名: deepseek          # 启动命令用：cc deepseek
模型显示名称: DeepSeek V3   # 菜单里显示的名字
API Key: sk-xxxxxxxx
Base URL: https://api.deepseek.com/v1
模型 ID: deepseek-chat      # 可选，直接回车用别名
```

✅ 完成！配置文件自动创建，立即可用。

**方法 B：复制现有配置（适合改参）**

```bash
# 1. 复制一份现有配置
cp ~/.claude/models/kimi.json ~/.claude/models/myai.json

# 2. 用编辑器修改 API Key
notepad ~/.claude/models/myai.json    # Windows
# 或
code ~/.claude/models/myai.json       # VS Code
```

### 第三步：启动使用

```bash
cc              # 交互式选择
cc deepseek     # 直接启动指定模型
```

## 工作原理

通过替换 `~/.claude/settings.json` 来切换模型。首次使用会备份原配置到 `settings.json.backup`。

## 依赖

- [Claude Code](https://claude.ai/code) - 安装命令：`curl -fsSL https://claude.ai/install.sh | bash`
- Git Bash (Windows) 或 Bash (Mac/Linux)

## Star History

如果这个项目对你有帮助，请给个 ⭐ Star！

[![Star History Chart](https://api.star-history.com/svg?repos=wandanan/cc_start&type=Date)](https://star-history.com/#wandanan/cc_start&Date)

## License

MIT
