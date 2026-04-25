use std::env;
use std::fs;
use std::path::PathBuf;
use std::process::Command;

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct ModelInfo {
    alias: String,
    display_name: String,
    model_id: String,
    haiku_model: String,
    opus_model: String,
    sonnet_model: String,
    api_key: String,
    auth_token: String,
    auth_mode: String, // "API_KEY" or "AUTH_TOKEN"
    base_url: String,
    working_dir: String,
    mode: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    raw_json: String, // 原始 JSON 字符串
}

#[derive(serde::Deserialize)]
struct SaveModelParams {
    alias: String,
    display_name: String,
    model_id: String,
    haiku_model: String,
    opus_model: String,
    sonnet_model: String,
    auth_value: String,
    auth_mode: String,
    base_url: String,
    working_dir: String,
    mode: String,
    #[serde(default)]
    raw_json: String, // 用户在文本框中编辑的完整 JSON，作为保留未知字段的基础
}

#[tauri::command]
fn get_home_dir() -> String {
    env::var("USERPROFILE")
        .or_else(|_| env::var("HOME"))
        .unwrap_or_else(|_| "C:\\".to_string())
}

fn get_models_dir() -> PathBuf {
    if let Ok(userprofile) = env::var("USERPROFILE") {
        PathBuf::from(userprofile).join(".claude").join("models")
    } else if let Ok(home) = env::var("HOME") {
        PathBuf::from(home).join(".claude").join("models")
    } else {
        PathBuf::from("C:\\Users\\Public\\.claude\\models")
    }
}

#[tauri::command]
fn list_models() -> Result<Vec<ModelInfo>, String> {
    let models_dir = get_models_dir();
    if !models_dir.exists() {
        return Ok(vec![]);
    }

    let mut models = Vec::new();
    let entries = fs::read_dir(&models_dir).map_err(|e| e.to_string())?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().map_or(false, |ext| ext == "json") {
            if let Ok(content) = fs::read_to_string(&path) {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                    let alias = path.file_stem()
                        .and_then(|s| s.to_str())
                        .unwrap_or("unknown")
                        .to_string();

                    let display_name = json.get("display_name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();

                    let model_id = json.get("env")
                        .and_then(|env| env.get("ANTHROPIC_MODEL"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();

                    let haiku_model = json.get("env")
                        .and_then(|env| env.get("ANTHROPIC_DEFAULT_HAIKU_MODEL"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();

                    let opus_model = json.get("env")
                        .and_then(|env| env.get("ANTHROPIC_DEFAULT_OPUS_MODEL"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();

                    let sonnet_model = json.get("env")
                        .and_then(|env| env.get("ANTHROPIC_DEFAULT_SONNET_MODEL"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();

                    let api_key = json.get("env")
                        .and_then(|env| env.get("ANTHROPIC_API_KEY"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();

                    let auth_token = json.get("env")
                        .and_then(|env| env.get("ANTHROPIC_AUTH_TOKEN"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();

                    // 检测使用哪个 auth 字段
                    let auth_mode = if !auth_token.is_empty() {
                        "AUTH_TOKEN".to_string()
                    } else if !api_key.is_empty() {
                        "API_KEY".to_string()
                    } else {
                        "AUTH_TOKEN".to_string() // 默认
                    };

                    let base_url = json.get("env")
                        .and_then(|env| env.get("ANTHROPIC_BASE_URL"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();

                    let working_dir = json.get("working_dir")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();

                    let mode = json.get("mode")
                        .and_then(|v| v.as_str())
                        .unwrap_or("normal")
                        .to_string();

                    models.push(ModelInfo {
                        alias,
                        display_name,
                        model_id,
                        haiku_model,
                        opus_model,
                        sonnet_model,
                        api_key,
                        auth_token,
                        auth_mode,
                        base_url,
                        working_dir,
                        mode,
                        raw_json: content, // 保存原始 JSON 字符串
                    });
                }
            }
        }
    }

    Ok(models)
}

#[tauri::command]
fn save_model_config(params: SaveModelParams) -> Result<(), String> {
    let models_dir = get_models_dir();

    // 确保目录存在
    if !models_dir.exists() {
        fs::create_dir_all(&models_dir).map_err(|e| e.to_string())?;
    }

    let config_path = models_dir.join(format!("{}.json", params.alias));

    // 基础配置对象的来源优先级：
    // 1) 前端传来的 raw_json（用户在文本框中编辑过的完整 JSON）—— 保留所有未知字段
    // 2) 现有文件内容 —— 兜底
    // 3) 空对象 —— 新建
    let mut config: serde_json::Value = if !params.raw_json.is_empty() {
        serde_json::from_str(&params.raw_json).unwrap_or_else(|_| {
            // raw_json 非法时退回读现有文件
            if config_path.exists() {
                fs::read_to_string(&config_path)
                    .ok()
                    .and_then(|c| serde_json::from_str(&c).ok())
                    .unwrap_or(serde_json::json!({}))
            } else {
                serde_json::json!({})
            }
        })
    } else if config_path.exists() {
        let content = fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    // 确保 env 对象存在
    if !config.get("env").and_then(|v| v.as_object()).is_some() {
        config["env"] = serde_json::json!({});
    }

    // 顶层非 env 字段：display_name / working_dir / mode
    // 方案 A：与 env 同级写入，claude --settings 会忽略不认识的顶层字段
    if let Some(obj) = config.as_object_mut() {
        // display_name：有值写入，空则删除
        if !params.display_name.is_empty() {
            obj.insert("display_name".to_string(), serde_json::json!(params.display_name));
        } else {
            obj.remove("display_name");
        }

        // working_dir：有值写入，空则删除
        if !params.working_dir.is_empty() {
            obj.insert("working_dir".to_string(), serde_json::json!(params.working_dir));
        } else {
            obj.remove("working_dir");
        }

        // mode：仅 skip-permissions 才写入，normal 或空则删除
        if params.mode == "skip-permissions" {
            obj.insert("mode".to_string(), serde_json::json!(params.mode));
        } else {
            obj.remove("mode");
        }
    }

    // env 字段
    if let Some(env_obj) = config["env"].as_object_mut() {
        // 4个模型字段：只更新有值的
        if !params.model_id.is_empty() {
            env_obj.insert("ANTHROPIC_MODEL".to_string(), serde_json::json!(params.model_id));
        }
        if !params.haiku_model.is_empty() {
            env_obj.insert("ANTHROPIC_DEFAULT_HAIKU_MODEL".to_string(), serde_json::json!(params.haiku_model));
        }
        if !params.opus_model.is_empty() {
            env_obj.insert("ANTHROPIC_DEFAULT_OPUS_MODEL".to_string(), serde_json::json!(params.opus_model));
        }
        if !params.sonnet_model.is_empty() {
            env_obj.insert("ANTHROPIC_DEFAULT_SONNET_MODEL".to_string(), serde_json::json!(params.sonnet_model));
        }
        // AUTH：只插入用户选择的那个
        if params.auth_mode == "API_KEY" {
            env_obj.insert("ANTHROPIC_API_KEY".to_string(), serde_json::json!(params.auth_value));
            env_obj.remove("ANTHROPIC_AUTH_TOKEN");
        } else {
            env_obj.insert("ANTHROPIC_AUTH_TOKEN".to_string(), serde_json::json!(params.auth_value));
            env_obj.remove("ANTHROPIC_API_KEY");
        }
        // BASE_URL
        env_obj.insert("ANTHROPIC_BASE_URL".to_string(), serde_json::json!(params.base_url));
    }

    // 写入文件
    let content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(&config_path, content).map_err(|e| e.to_string())?;

    Ok(())
}

#[derive(serde::Deserialize)]
struct LaunchParams {
    alias: String,
    working_dir: String,
    skip_permissions: bool,
}

fn find_claude_exe() -> Option<String> {
    // 先用 where / where.exe 找 claude
    if let Ok(output) = Command::new("where").arg("claude").output() {
        if output.status.success() {
            if let Ok(path_str) = String::from_utf8(output.stdout) {
                let first_line = path_str.lines().next().unwrap_or("").trim().to_string();
                if !first_line.is_empty() {
                    return Some(first_line);
                }
            }
        }
    }

    // fallback 到 USERPROFILE/.local/bin/claude
    if let Ok(userprofile) = env::var("USERPROFILE") {
        let local_bin = PathBuf::from(userprofile).join(".local").join("bin").join("claude");
        if local_bin.exists() {
            return Some(local_bin.to_string_lossy().to_string());
        }
        let local_bin_exe = local_bin.with_extension("exe");
        if local_bin_exe.exists() {
            return Some(local_bin_exe.to_string_lossy().to_string());
        }
    }

    None
}

#[tauri::command]
fn launch_claude(params: LaunchParams) -> Result<(), String> {
    let config_path = get_models_dir()
        .join(format!("{}.json", params.alias));

    if !config_path.exists() {
        return Err(format!("配置文件不存在: {}", config_path.display()));
    }

    let claude_exe = find_claude_exe()
        .ok_or_else(|| "找不到 claude 命令，请确保 Claude Code 已安装并加入 PATH".to_string())?;

    let config_path_str = config_path.to_string_lossy().to_string();

    // 构建命令参数
    let mut args = vec!["--settings".to_string(), config_path_str];
    if params.skip_permissions {
        args.push("--dangerously-skip-permissions".to_string());
    }

    // 先尝试 Windows Terminal (wt.exe)
    let wt_result = Command::new("wt.exe")
        .args(["-d", &params.working_dir, "cmd", "/k"])
        .arg(format!("\"{}\" {}", claude_exe, args.join(" ")))
        .spawn();

    if wt_result.is_ok() {
        return Ok(());
    }

    // fallback 到 cmd.exe
    let cmd_result = Command::new("cmd.exe")
        .args(["/c", "start", "CC Start", "cmd", "/k"])
        .arg(format!(
            "cd /d \"{}\" && \"{}\" {}",
            params.working_dir, claude_exe, args.join(" ")
        ))
        .spawn();

    if cmd_result.is_ok() {
        return Ok(());
    }

    Err("无法启动终端".to_string())
}

// 软删除：把配置移入回收站，并保留最近 N 个
#[tauri::command]
fn delete_model_config(alias: String) -> Result<(), String> {
    let models_dir = get_models_dir();
    let source_path = models_dir.join(format!("{}.json", alias));

    if !source_path.exists() {
        return Err(format!("配置文件不存在: {}", source_path.display()));
    }

    // 创建回收站目录
    let trash_dir = models_dir.join(".trash");
    if !trash_dir.exists() {
        fs::create_dir_all(&trash_dir).map_err(|e| e.to_string())?;
    }

    // 生成带时间戳的目标文件名 <alias>.<YYYYMMDD-HHMMSS>.json
    let timestamp = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();
    let dest_path = trash_dir.join(format!("{}.{}.json", alias, timestamp));

    // 移动文件
    fs::rename(&source_path, &dest_path).map_err(|e| e.to_string())?;

    // 轮循清理：保留最近 10 个
    cleanup_trash(&trash_dir, 10)?;

    Ok(())
}

// 扫描回收站，按 mtime 升序排序，超过 keep 则删除最早的若干个
fn cleanup_trash(trash_dir: &PathBuf, keep: usize) -> Result<(), String> {
    let entries = fs::read_dir(trash_dir).map_err(|e| e.to_string())?;

    let mut entries_with_mtime: Vec<(PathBuf, std::time::SystemTime)> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().map_or(false, |ext| ext == "json"))
        .filter_map(|e| {
            let path = e.path();
            let mtime = e.metadata().ok()?.modified().ok()?;
            Some((path, mtime))
        })
        .collect();

    if entries_with_mtime.len() <= keep {
        return Ok(());
    }

    // 升序：最早的在前
    entries_with_mtime.sort_by(|a, b| a.1.cmp(&b.1));

    let to_remove = entries_with_mtime.len().saturating_sub(keep);
    for (path, _) in entries_with_mtime.iter().take(to_remove) {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![list_models, launch_claude, get_home_dir, save_model_config, delete_model_config])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
