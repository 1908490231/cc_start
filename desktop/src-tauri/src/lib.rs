use std::env;
use std::fs;
use std::path::PathBuf;
use std::process::Command;

#[derive(serde::Serialize)]
struct ModelInfo {
    alias: String,
    model_id: String,
    base_url: String,
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

                    let model_id = json.get("env")
                        .and_then(|env| env.get("ANTHROPIC_MODEL"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();

                    let base_url = json.get("env")
                        .and_then(|env| env.get("ANTHROPIC_BASE_URL"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();

                    models.push(ModelInfo {
                        alias,
                        model_id,
                        base_url,
                    });
                }
            }
        }
    }

    Ok(models)
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![list_models, launch_claude, get_home_dir])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
