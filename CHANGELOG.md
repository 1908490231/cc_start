# 更新日志

本项目使用 GitHub Releases 发布桌面端安装包，版本号建议和
`desktop/src-tauri/tauri.conf.json` 中的 `version` 保持一致。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号参考
[Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [1.0.0] - 2026-05-21

### Added

- 发布 CC Start 桌面端 Windows 安装包。
- 桌面端安装包内置 `cc` / `ccs` 命令行启动器。
- 支持通过 GitHub Releases 下载桌面端安装包。

### Fixed

- 修复 Windows 下 `cc <model>` 启动后可能出现 `SessionStart:startup hook error`
  和 `UnexpectedToken session-start` 的问题。
- 调整 Windows 启动脚本的 Git Bash 发现逻辑，优先使用 MSYS `usr/bin/bash.exe`。

## 版本管理约定

- 每次正式发布前，先更新 `desktop/src-tauri/tauri.conf.json` 的 `version`。
- 同步更新本文件，记录本次版本新增、修复、变更或移除的内容。
- 使用相同版本号创建 GitHub Release，例如 `v1.0.0`。
- 桌面端安装包不提交到 Git 仓库，只上传到 GitHub Release 附件。

常用版本号规则：

- `1.0.1`：修复 bug 或小改动。
- `1.1.0`：新增功能，但兼容旧版本。
- `2.0.0`：有不兼容旧版本的重大变化。
