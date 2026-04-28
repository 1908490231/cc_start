# CC Start

在不同窗口中使用不同 AI 模型的 Claude Code 启动器。

## 一句话说明

一个命令切换不同 AI 模型，各窗口独立运行，互不影响。

## 🚀 一分钟安装

> **macOS 用户前置步骤**：macOS 系统自带的 bash 版本为 3.2，不支持本工具所需的关联数组特性（bash 4.0+）。请先通过 Homebrew 安装新版 bash：
> ```bash
> brew install bash
> ```
> Linux 用户无需此步骤，系统自带 bash 版本已满足要求。

```bash
# 克隆项目
git clone https://github.com/wandanan/cc_start.git
cd cc_start

# Windows: 双击运行
install.bat

# Mac/Linux: 一行命令
chmod +x install.sh && ./install.sh
```

安装脚本会自动完成：
- ✅ 检测/创建安装目录
- ✅ 复制脚本到 PATH
- ✅ 创建配置目录
- ✅ 复制模型配置文件
- ✅ 自动添加 PATH（Windows，保留环境变量引用不破坏）
- ✅ 同时创建 `cc` 和 `ccs` 命令
- ✅ 支持上下箭头选择启动模式

> ⚠️ **安装后如果提示 `cc` 或 `ccs` 命令找不到？**
>
> Windows 安装程序会尝试自动添加 PATH，但如果失效，请手动添加：
> `系统属性 → 环境变量 → 编辑用户 PATH → 新建 → 添加 %USERPROFILE%\.local\bin`

### 命令选择：cc 或 ccs

本工具同时支持 `cc` 和 `ccs` 两种命令，功能完全相同：

```bash
# 两种命令等效
cc add         # 添加模型配置
ccs kimi       # 启动 Kimi 模型
cc kimi        # 同样启动 Kimi 模型
```

> **Linux 用户注意**：Linux 系统默认有 `/usr/bin/cc`（C 编译器），如果你需要使用 C 编译器，请确保 PATH 中 C 编译器的路径在 `~/.local/bin` 之前，或使用 `ccs` 命令来避免冲突。

安装完成后，**先添加模型配置**，然后输入 `cc` 或 `ccs` 即可使用：

```bash
$ ccs

╔════════════════════════════════════╗
║     Claude Code 模型选择器         ║
╚════════════════════════════════════╝

  1) kimi        - Kimi K2.5
  2) qwen        - 千问 3.5 Plus
  3) glm         - GLM 5
  4) mini        - MiniMax M2.5

请选择模型 (输入编号或名称): 2

请选择启动模式 (↑↓选择, 回车确认):

  ▶ 1. 普通启动
    2. dangerously-skip-permissions 启动

🚀 启动 Claude Code [千问 3.5 Plus]...
```

选择模型后，用 ↑↓ 方向键切换启动模式，回车确认：

| 模式 | 说明 |
|------|------|
| 普通启动 | 标准模式，Claude Code 会请求权限确认 |
| dangerously-skip-permissions 启动 | 跳过所有权限确认，适合信任的自动化场景 |

## 支持的模型

| 命令 | 模型 |
|------|------|
| `cc kimi` / `ccs kimi` | Kimi K2.5 |
| `cc qwen` / `ccs qwen` | 千问 3.5 Plus |
| `cc glm` / `ccs glm` | GLM 5 |
| `cc mini` / `ccs mini` | MiniMax M2.5 |
| `cc <任意>` / `ccs <任意>` | **其他任意模型** |

> 💡 **想添加自己的模型？** 使用 `cc add` 或 `ccs add` 命令，支持任意兼容 Claude API 的模型。

## 🔧 配置 API Key（必做）

安装后需要添加模型配置才能使用。

### 推荐方式：命令行添加

```bash
cc add
# 或
ccs add
```

按提示输入：
- **启动命令名称**：如 `kimi`（之后用 `cc kimi` 或 `ccs kimi` 启动）
- **模型 ID**：如 `kimi-k2.5`
- **API Key**：你的 API 密钥（输入时不会回显，保护隐私）
- **Base URL**：API 地址，如 `https://api.kimi.com/coding/`

重复 `cc add` 或 `ccs add` 可添加多个模型。

### 删除模型

```bash
cc remove          # 交互式选择（显示编号列表）
cc remove kimi     # 直接指定模型名
```

交互模式下输入编号或名称均可选中，输入 `q` 退出。

### 备选方式：复制修改

```bash
cp ~/.claude/models/kimi.json ~/.claude/models/myai.json
# 编辑文件，修改 API Key
```

然后输入 `cc myai` 或 `ccs myai` 即可启动。

## 使用示例

```bash
cc               # 交互式选择模型
ccs              # 等效命令
cc kimi          # 直接启动 Kimi
ccs kimi         # 等效命令
cc qwen          # 在另一个窗口启动 Qwen
cc myai          # 启动自定义模型
```

**多窗口同时使用**：

```bash
# 终端 1
cc kimi

# 终端 2（同时运行）
cc qwen

# 终端 3（同时运行）
cc glm
```

每个窗口独立使用不同模型，配置互不干扰。

## 手动安装（备选）

如果不想用自动安装脚本，只需两步：

**Step 1: 把脚本放入 PATH**

方案 A - 复制到系统目录：
```bash
mkdir -p ~/.local/bin
cp cc ~/.local/bin/cc                        # Mac/Linux
cp cc.cmd ~/.local/bin/cc.cmd               # Windows
cp cc ~/.local/bin/ccs                       # Mac/Linux（或建软链接）
cp ccs.cmd ~/.local/bin/ccs.cmd             # Windows
# Mac/Linux 推荐用软链接代替复制，ccs 自动指向 cc
ln -sf ~/.local/bin/cc ~/.local/bin/ccs
```

方案 B - 直接把本项目目录加入 PATH：
```bash
# 编辑 ~/.bashrc 或 ~/.zshrc，添加
export PATH="$PATH:/path/to/cc_start"
```

**Step 2: 复制模型配置到 Claude 配置目录**

```bash
mkdir -p ~/.claude/models
cp models/*.json ~/.claude/models/
# 然后编辑这些 json 文件，填入你的 API Key
```

## 配置说明

配置文件格式（`~/.claude/models/任意名称.json`）：

```json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "your-api-key",
    "ANTHROPIC_BASE_URL": "https://api.example.com/anthropic",
    "ANTHROPIC_MODEL": "model-name"
  }
}
```

项目 `models/` 目录包含 4 个预置配置文件，作为参考模板。

## 工作原理

通过 `--settings` 参数为每个 Claude Code 实例指定独立的配置文件：

```bash
claude --settings ~/.claude/models/kimi.json
claude --settings ~/.claude/models/qwen.json
```

每个窗口使用自己的配置，**多窗口同时运行互不干扰**。

> 旧版本使用替换 `settings.json` 的方式，已改为 `--settings` 参数方案，支持多窗口独立运行。

## 更新日志

### 2026-04-28 · v1.0.0

- 发布 CC Start 首个正式版本
- 提供 CLI 多模型启动器
- 新增 Windows 桌面版（GUI）
- CLI 与桌面版共享同一份模型配置
- 支持图形化管理、编辑、复制、删除模型配置
- 支持工作目录选择、一键启动与连通性测试
- 支持原始 JSON 编辑与保存

## 依赖

- [Claude Code](https://claude.ai/code) - 安装命令：`curl -fsSL https://claude.ai/install.sh | bash`
- Git Bash (Windows) 或 Bash 4.0+ (Mac/Linux)
  - **macOS**：系统自带 bash 3.2，需通过 Homebrew 安装：`brew install bash`
  - **Linux**：主流发行版（Ubuntu/Debian/Fedora/CentOS 等）自带 bash 4.x/5.x，无需额外安装

## 桌面版（GUI）

CC Start 也提供图形界面版本，适合不想记命令、希望可视化管理配置的用户。

> **重要说明**：CC Start Desktop 不是独立的 AI 客户端，而是 **Claude Code 的图形启动器**。使用前需先在本机安装 Claude Code。

### 下载安装

1. 先安装 Claude Code
2. 到 [CC Start Desktop Releases](https://github.com/wandanan/cc_start/releases) 页面下载安装包
3. Windows 用户可任选以下安装包：
   - **Setup.exe（推荐）**：更适合普通用户，安装体验更直观
   - **MSI**：适合偏标准化安装场景
4. 安装完成后打开桌面版，即可查看、添加、编辑并启动模型配置

### 当前版本支持

- 可视化查看模型配置列表
- 新增、编辑、复制、删除配置
- 删除到回收站（保留最近删除记录）
- 可视化选择工作目录
- 普通启动 / 跳过权限确认 切换
- 一键启动 Claude Code
- 原始 JSON 编辑
- JSON 语法高亮显示
- 连通性测试（发送最小请求测试，可能消耗少量 token）
- 记住上次启动的配置

### CLI 与桌面版共存

命令行版（CLI）和桌面版可以同时安装，互不影响：

- **CLI**：`cc` / `ccs` 命令，终端操作
- **桌面版**：图形界面，鼠标操作
- **共享配置**：两者读写同一份 `~/.claude/models/*.json`，在任一端添加的模型在另一端立即可见
- **启动原理一致**：两者最终都是通过 `claude --settings <配置文件>` 启动 Claude Code

### 开发模式运行

如果想参与开发或自行编译：

```cmd
cd desktop
npm install
npm run tauri dev
```

### 打包桌面版

Windows 下打包命令：

```cmd
cd desktop
npm install
npm run tauri build
```

打包完成后，安装包通常位于：

```text
desktop/src-tauri/target/release/bundle/
```

常见产物包括：

- `nsis/`：Setup 安装包（推荐给普通用户）
- `msi/`：MSI 安装包

## Star History

如果这个项目对你有帮助，请给个 ⭐ Star！

[![Star History Chart](https://api.star-history.com/svg?repos=wandanan/cc_start&type=Date)](https://star-history.com/#wandanan/cc_start&Date)

## License

MIT
