# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

`cc_start` 是一个 Claude Code 多模型启动器，分为两部分：

- 仓库根目录的 CLI 启动器：`cc`、`cc.cmd`、`ccs.cmd`、`install.sh`、`install.bat`
- `desktop/` 下的桌面版：基于 Tauri 2 + 原生 HTML/CSS/JavaScript 的 Windows GUI

核心模型配置统一存放在 `~/.claude/models/*.json`。CLI 和桌面版共享这批配置文件；桌面版不是独立配置系统，而是这些 JSON 的可视化编辑器和启动器。

## 重要文档

- 根目录 `README.md`：用户安装、CLI 用法、桌面版开发入口
- `PRD/2026-04-21-cc-start-desktop-v1-prd.md`：桌面版 V1 权威需求，明确“纯启动器”定位、CLI/GUI 共存、共享 `~/.claude/models/*.json`
- `Plans/2026-04-24-frontend-restructure-and-config-editing.md`：桌面版前端改造成当前列表式启动页、详情页编辑、原始 JSON 双向同步的阶段性实现说明

## 开发命令

### CLI（仓库根目录）

- 运行安装脚本（Windows）：`./install.bat`
- 运行安装脚本（macOS/Linux）：`chmod +x install.sh && ./install.sh`
- 直接运行 CLI：`./cc`
- 指定模型启动：`./cc kimi`
- 交互式添加模型：`./cc add`

### 桌面版（`desktop/`）

先进入目录：`cd desktop`

- 安装前端依赖：`npm install`
- 开发模式启动 Tauri：`npm run tauri dev`
- 构建桌面安装包：`npm run tauri build`
- 仅运行 Tauri CLI 帮助：`npx tauri --help`

### Rust 后端测试（`desktop/src-tauri/`）

先进入目录：`cd desktop/src-tauri`

- 运行全部 Rust 测试：`cargo test`
- 运行单个测试：`cargo test classifies_401_as_auth_failed`
- 检查编译：`cargo check`

## 架构总览

### 1. CLI 与桌面版的职责边界

CLI 和桌面版都不保存会话状态，只负责“选择一份模型配置，然后启动 `claude --settings <config>`”。

- CLI：bash/cmd 启动器，适合命令行用户
- 桌面版：可视化配置管理与一键启动
- 两端共享 `~/.claude/models/*.json`，所以改任何一端都会立刻影响另一端

如果你修改配置格式，必须优先考虑与现有 CLI 的兼容性；桌面版后端当前就是围绕现有 JSON 结构做读写，而不是定义新 schema。

### 2. 桌面版前后端分层

桌面版分成两层：

- 前端：`desktop/src/`
  - `index.html`：单页应用骨架，包含列表页、详情页、设置页三个视图容器
  - `main.js`：全部前端状态、渲染与事件绑定逻辑
  - `styles.css`：完整样式
- 后端：`desktop/src-tauri/src/`
  - `main.rs`：Tauri 入口，仅调用 `cc_start_lib::run()`
  - `lib.rs`：实际命令实现、配置文件读写、Claude 启动、连通性测试、偏好存储、测试代码

Tauri 配置在 `desktop/src-tauri/tauri.conf.json`，前端静态资源目录直接指向 `../src`，没有额外前端构建框架。

### 3. 前端主数据流

前端没有组件框架，`desktop/src/main.js` 采用“全局状态 + 手工渲染”的方式组织：

- `models` 保存当前配置列表
- `prefs` 保存 GUI 偏好（如是否记住上次模型）
- `currentView` 控制列表页 / 详情页 / 设置页切换
- `currentEditingModel` 保存当前详情页正在编辑的对象

关键流程：

- `loadModels()` 通过 Tauri `list_models` 拉取模型配置，然后调用 `renderConfigList()` 重绘列表（`desktop/src/main.js:54`）
- 列表页每一行支持直接修改 alias、working_dir、mode，变更通过 `handleFieldChange()` 立即落盘到 JSON（`desktop/src/main.js:153`）
- 每行“启动”按钮通过 `handleLaunch()` 按当前行的可见值启动 Claude，而不是读全局表单（`desktop/src/main.js:193`）
- “修改”进入详情页，`openEditForModel()` 会把模型对象和原始 JSON 一起带入编辑态（`desktop/src/main.js:229`）
- 详情页由 `renderDetailForm()` 生成，既包含结构化字段，也包含原始 JSON 编辑区，前者与后者双向同步（`desktop/src/main.js:486`）
- 设置页由 `renderSettingsPage()` 生成，目前是轻量 GUI 偏好，不是 Claude 全局 settings.json（`desktop/src/main.js:600`）

这意味着前端改动通常集中在 `main.js`，不是拆成多个模块；做功能修改时先确认当前状态变量是否已覆盖你的场景，避免重复引入第二套状态源。

### 4. Rust 后端职责

`desktop/src-tauri/src/lib.rs` 是桌面版核心：

- `list_models()`：扫描 `~/.claude/models/*.json`，把现有 JSON 解析成前端所需字段，同时保留 `raw_json` 供详情页编辑（`desktop/src-tauri/src/lib.rs:249`）
- `save_model_config_in_dir()`：保存或重命名配置；会尽量基于原始 JSON 修改并保留未知字段，而不是只重建最小字段集合（`desktop/src-tauri/src/lib.rs:305`）
- `launch_claude()`：优先尝试 `wt.exe`，失败后回退到 `cmd.exe`；本质命令仍是 `claude --settings <config>`（`desktop/src-tauri/src/lib.rs:440`）
- `test_connectivity()`：用 `/v1/messages` 发最小请求测试 Base URL、模型 ID 和凭证是否可用（`desktop/src-tauri/src/lib.rs:473`）
- `copy_model_config()`：复制现有配置并自动生成 `-copy` 后缀别名（`desktop/src-tauri/src/lib.rs:511`）
- `delete_model_config()`：软删除到 `~/.claude/models/.trash/`，并清理到最近 10 个（`desktop/src-tauri/src/lib.rs:528`）
- `run()`：统一注册所有 Tauri commands（`desktop/src-tauri/src/lib.rs:687`）

用户偏好不放在项目目录，而是写入 `~/.claude/cc_start_prefs.json`。如果你在做“记住上次选择”之类功能，先看现有 prefs 结构，不要把这类状态塞回模型配置文件。

### 5. 配置文件模型

当前共享配置文件的关键结构来自 README 中定义的 JSON：

```json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "...",
    "ANTHROPIC_BASE_URL": "https://...",
    "ANTHROPIC_MODEL": "..."
  }
}
```

桌面版还会在顶层读写这些附加字段：

- `display_name`
- `working_dir`
- `mode`

并兼容这些高级模型字段：

- `ANTHROPIC_DEFAULT_HAIKU_MODEL`
- `ANTHROPIC_DEFAULT_SONNET_MODEL`
- `ANTHROPIC_DEFAULT_OPUS_MODEL`

认证方式兼容两种：

- `ANTHROPIC_AUTH_TOKEN`
- `ANTHROPIC_API_KEY`

因此，修改配置读写逻辑时要注意两点：

1. 不能假设所有文件都只有最小字段
2. 不能在保存时误删前端未暴露但用户已有的字段

### 6. CLI 侧实现特点

根目录 `cc` 是 Bash 启动器，`ccs` 在安装时由脚本创建或复制。它会扫描 `~/.claude/models/*.json` 作为可选模型来源，而不是维护单独注册表。

这也是为什么 `.gitignore` 只忽略仓库内 `models/*.json` 模板，而真正用户数据在 `~/.claude/models/`。修改 CLI 时，优先保持“扫描配置目录即得模型列表”的机制。

## 关键约束

- 桌面版当前只面向 Windows；`launch_claude()` 明确依赖 `wt.exe` / `cmd.exe`
- 前端是原生 JS 单文件逻辑，没有框架、状态库或打包器抽象
- `README.md` 中桌面版开发命令是事实来源：`cd desktop && npm install && npm run tauri dev`
- `.gitignore` 当前忽略 `PRD/`、`Plans/`、`docs/`，这些文档在本地有价值，但默认不会进入版本控制
- 仓库当前没有 Cursor rules、`.cursorrules` 或 `.github/copilot-instructions.md`，不需要额外继承这些规则
