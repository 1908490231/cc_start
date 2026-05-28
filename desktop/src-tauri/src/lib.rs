use std::env;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};

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
    auth_mode: String,
    base_url: String,
    working_dir: String,
    mode: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    raw_json: String,
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
    raw_json: String,
    #[serde(default)]
    original_alias: Option<String>,
}

#[derive(serde::Deserialize, serde::Serialize, Clone)]
struct TestParams {
    base_url: String,
    auth_value: String,
    auth_mode: String,
    model_id: String,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct TestResult {
    success: bool,
    elapsed_ms: u64,
    status_code: Option<u16>,
    error_kind: Option<String>,
    message: String,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct UserPrefs {
    remember_model: bool,
    last_alias: String,
    #[serde(default)]
    pinned_aliases: Vec<String>,
    #[serde(default)]
    custom_order: Vec<String>,
    // 自动备份频率（小时）。0 表示关闭备份；当前 UI 仅暴露 0/1/6/24，
    // 但保存时不做硬限制，方便后续阶段扩展自定义间隔。
    #[serde(default = "default_backup_interval_hours")]
    backup_interval_hours: u64,
    // 上次自动备份时间，Unix 时间戳（秒）。0 表示从未备份。
    #[serde(default)]
    last_backup_at: i64,
}

fn default_backup_interval_hours() -> u64 {
    24
}

fn default_prefs() -> UserPrefs {
    UserPrefs {
        remember_model: true,
        last_alias: String::new(),
        pinned_aliases: Vec::new(),
        custom_order: Vec::new(),
        backup_interval_hours: default_backup_interval_hours(),
        last_backup_at: 0,
    }
}

fn get_claude_dir() -> PathBuf {
    if let Ok(userprofile) = env::var("USERPROFILE") {
        PathBuf::from(userprofile).join(".claude")
    } else if let Ok(home) = env::var("HOME") {
        PathBuf::from(home).join(".claude")
    } else {
        PathBuf::from("C:\\Users\\Public\\.claude")
    }
}

fn get_models_dir() -> PathBuf {
    get_claude_dir().join("models")
}

fn get_prefs_path() -> PathBuf {
    get_claude_dir().join("cc_start_prefs.json")
}

fn get_common_config_path() -> PathBuf {
    get_claude_dir().join("cc_start_common_config.json")
}

fn get_backups_dir() -> PathBuf {
    get_claude_dir().join("cc_start_backups")
}

fn normalize_alias(alias: &str) -> String {
    alias.trim().to_string()
}

fn contains_cjk(text: &str) -> bool {
    text.chars().any(|ch| {
        ('\u{4E00}'..='\u{9FFF}').contains(&ch)
            || ('\u{3400}'..='\u{4DBF}').contains(&ch)
            || ('\u{F900}'..='\u{FAFF}').contains(&ch)
            || ('\u{3040}'..='\u{30FF}').contains(&ch)
            || ('\u{AC00}'..='\u{D7AF}').contains(&ch)
    })
}

fn validate_alias(alias: &str) -> Result<(), String> {
    if alias.is_empty() {
        return Err("运行简称不能为空".to_string());
    }
    if contains_cjk(alias) {
        return Err("运行简称不能包含中文".to_string());
    }
    Ok(())
}

fn next_copy_alias(models_dir: &PathBuf, alias: &str) -> Result<String, String> {
    let mut new_alias = format!("{}-copy", alias);
    let mut counter = 2usize;

    while models_dir.join(format!("{}.json", new_alias)).exists() {
        if counter > 50 {
            return Err("无法生成可用简称（已有 50 个副本）".to_string());
        }
        new_alias = format!("{}-copy-{}", alias, counter);
        counter += 1;
    }

    Ok(new_alias)
}

fn read_prefs_file() -> UserPrefs {
    let prefs_path = get_prefs_path();
    if !prefs_path.exists() {
        return default_prefs();
    }

    fs::read_to_string(prefs_path)
        .ok()
        .and_then(|content| serde_json::from_str(&content).ok())
        .unwrap_or_else(default_prefs)
}

fn write_prefs_file(prefs: &UserPrefs) -> Result<(), String> {
    let claude_dir = get_claude_dir();
    if !claude_dir.exists() {
        fs::create_dir_all(&claude_dir).map_err(|e| e.to_string())?;
    }

    let content = serde_json::to_string_pretty(prefs).map_err(|e| e.to_string())?;
    fs::write(get_prefs_path(), content).map_err(|e| e.to_string())
}

// 通用配置：将原始 JSON 中不应自动提取的私有字段移除
// 顶层私有：display_name / working_dir / mode
// env 私有：ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / ANTHROPIC_BASE_URL / ANTHROPIC_MODEL
// 以及 ANTHROPIC_DEFAULT_{HAIKU,SONNET,OPUS}_MODEL
// 如果剥离后 env 变成空对象，则同时移除 env
fn strip_excluded_for_common(value: &mut serde_json::Value) {
    let Some(obj) = value.as_object_mut() else { return };

    obj.remove("display_name");
    obj.remove("working_dir");
    obj.remove("mode");

    if let Some(env) = obj.get_mut("env").and_then(|v| v.as_object_mut()) {
        env.remove("ANTHROPIC_API_KEY");
        env.remove("ANTHROPIC_AUTH_TOKEN");
        env.remove("ANTHROPIC_BASE_URL");
        env.remove("ANTHROPIC_MODEL");
        env.remove("ANTHROPIC_DEFAULT_HAIKU_MODEL");
        env.remove("ANTHROPIC_DEFAULT_SONNET_MODEL");
        env.remove("ANTHROPIC_DEFAULT_OPUS_MODEL");
    }

    let env_empty = obj
        .get("env")
        .and_then(|v| v.as_object())
        .map(|m| m.is_empty())
        .unwrap_or(false);
    if env_empty {
        obj.remove("env");
    }
}

fn read_common_config_from(path: &PathBuf) -> String {
    if !path.exists() {
        return "{}".to_string();
    }
    fs::read_to_string(path).unwrap_or_else(|_| "{}".to_string())
}

fn save_common_config_to(path: &PathBuf, content: &str) -> Result<(), String> {
    let value: serde_json::Value = serde_json::from_str(content)
        .map_err(|e| format!("JSON 格式错误: {}", e))?;
    let pretty = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?;

    if let Some(parent) = path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }
    fs::write(path, pretty).map_err(|e| e.to_string())
}

fn extract_common_config_candidate(raw_json: &str) -> Result<String, String> {
    let trimmed = raw_json.trim();
    if trimmed.is_empty() {
        return Ok("{}".to_string());
    }
    let mut value: serde_json::Value = serde_json::from_str(trimmed)
        .map_err(|e| format!("JSON 格式错误: {}", e))?;
    strip_excluded_for_common(&mut value);
    serde_json::to_string_pretty(&value).map_err(|e| e.to_string())
}

fn classify_connectivity_response(status_code: u16, elapsed_ms: u64, message: String) -> TestResult {
    match status_code {
        200 | 201 => TestResult {
            success: true,
            elapsed_ms,
            status_code: Some(status_code),
            error_kind: None,
            message,
        },
        401 => TestResult {
            success: false,
            elapsed_ms,
            status_code: Some(status_code),
            error_kind: Some("auth_failed".to_string()),
            message,
        },
        404 => TestResult {
            success: false,
            elapsed_ms,
            status_code: Some(status_code),
            error_kind: Some("not_found".to_string()),
            message,
        },
        _ => TestResult {
            success: false,
            elapsed_ms,
            status_code: Some(status_code),
            error_kind: Some("other".to_string()),
            message,
        },
    }
}

fn build_test_headers(request: reqwest::RequestBuilder, auth_mode: &str, auth_value: &str) -> reqwest::RequestBuilder {
    match auth_mode {
        "API_KEY" => request
            .header("x-api-key", auth_value)
            .header("anthropic-version", "2023-06-01"),
        _ => request.header("Authorization", format!("Bearer {}", auth_value)),
    }
}

#[tauri::command]
fn get_home_dir() -> String {
    env::var("USERPROFILE")
        .or_else(|_| env::var("HOME"))
        .unwrap_or_else(|_| "C:\\".to_string())
}

#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
fn get_claude_version() -> Result<String, String> {
    let claude_exe = find_claude_exe()
        .ok_or_else(|| "找不到 claude 命令，请确保 Claude Code 已安装并加入 PATH".to_string())?;

    let output = Command::new(claude_exe)
        .arg("--version")
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

#[tauri::command]
fn open_models_dir() -> Result<(), String> {
    let models_dir = get_models_dir();
    if !models_dir.exists() {
        fs::create_dir_all(&models_dir).map_err(|e| e.to_string())?;
    }

    Command::new("explorer.exe")
        .arg(models_dir)
        .spawn()
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn get_prefs() -> Result<UserPrefs, String> {
    Ok(read_prefs_file())
}

#[tauri::command]
fn save_prefs(prefs: UserPrefs) -> Result<(), String> {
    write_prefs_file(&prefs)
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
                    let alias = path.file_stem().and_then(|s| s.to_str()).unwrap_or("unknown").to_string();
                    let display_name = json.get("display_name").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let model_id = json.get("env").and_then(|env| env.get("ANTHROPIC_MODEL")).and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let haiku_model = json.get("env").and_then(|env| env.get("ANTHROPIC_DEFAULT_HAIKU_MODEL")).and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let opus_model = json.get("env").and_then(|env| env.get("ANTHROPIC_DEFAULT_OPUS_MODEL")).and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let sonnet_model = json.get("env").and_then(|env| env.get("ANTHROPIC_DEFAULT_SONNET_MODEL")).and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let api_key = json.get("env").and_then(|env| env.get("ANTHROPIC_API_KEY")).and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let auth_token = json.get("env").and_then(|env| env.get("ANTHROPIC_AUTH_TOKEN")).and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let auth_mode = if !auth_token.is_empty() { "AUTH_TOKEN".to_string() } else if !api_key.is_empty() { "API_KEY".to_string() } else { "AUTH_TOKEN".to_string() };
                    let base_url = json.get("env").and_then(|env| env.get("ANTHROPIC_BASE_URL")).and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let working_dir = json.get("working_dir").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let mode = json.get("mode").and_then(|v| v.as_str()).unwrap_or("normal").to_string();

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
                        raw_json: content,
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
    save_model_config_in_dir(&models_dir, params)
}

fn save_model_config_in_dir(models_dir: &PathBuf, params: SaveModelParams) -> Result<(), String> {
    let alias = normalize_alias(&params.alias);
    validate_alias(&alias)?;

    let auth_value = params.auth_value.trim();
    if auth_value.is_empty() {
        return Err("Key / Token 不能为空".to_string());
    }

    let display_name = if params.display_name.trim().is_empty() {
        alias.to_string()
    } else {
        params.display_name.trim().to_string()
    };

    if !models_dir.exists() {
        fs::create_dir_all(models_dir).map_err(|e| e.to_string())?;
    }

    let original_alias = params.original_alias.as_deref().map(normalize_alias).filter(|value| !value.is_empty());
    if let Some(ref old_alias) = original_alias {
        validate_alias(old_alias)?;
    }

    let config_path = models_dir.join(format!("{}.json", alias));
    let original_path = original_alias.as_ref().map(|old_alias| models_dir.join(format!("{}.json", old_alias)));

    if original_alias.is_none() && config_path.exists() {
        return Err("运行简称已存在".to_string());
    }

    if let Some(ref old_path) = original_path {
        if old_path != &config_path && config_path.exists() {
            return Err("运行简称已存在".to_string());
        }
    }

    let base_config_path = original_path.as_ref().filter(|path| path.exists()).unwrap_or(&config_path);

    let mut config: serde_json::Value = if !params.raw_json.is_empty() {
        serde_json::from_str(&params.raw_json).unwrap_or_else(|_| {
            if base_config_path.exists() {
                fs::read_to_string(base_config_path)
                    .ok()
                    .and_then(|c| serde_json::from_str(&c).ok())
                    .unwrap_or(serde_json::json!({}))
            } else {
                serde_json::json!({})
            }
        })
    } else if base_config_path.exists() {
        let content = fs::read_to_string(base_config_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    if !config.get("env").and_then(|v| v.as_object()).is_some() {
        config["env"] = serde_json::json!({});
    }

    if let Some(obj) = config.as_object_mut() {
        obj.insert("display_name".to_string(), serde_json::json!(display_name));
        if !params.working_dir.is_empty() { obj.insert("working_dir".to_string(), serde_json::json!(params.working_dir)); } else { obj.remove("working_dir"); }
        if params.mode == "skip-permissions" { obj.insert("mode".to_string(), serde_json::json!(params.mode)); } else { obj.remove("mode"); }
    }

    if let Some(env_obj) = config["env"].as_object_mut() {
        if !params.model_id.is_empty() { env_obj.insert("ANTHROPIC_MODEL".to_string(), serde_json::json!(params.model_id)); }
        if !params.haiku_model.is_empty() { env_obj.insert("ANTHROPIC_DEFAULT_HAIKU_MODEL".to_string(), serde_json::json!(params.haiku_model)); }
        if !params.opus_model.is_empty() { env_obj.insert("ANTHROPIC_DEFAULT_OPUS_MODEL".to_string(), serde_json::json!(params.opus_model)); }
        if !params.sonnet_model.is_empty() { env_obj.insert("ANTHROPIC_DEFAULT_SONNET_MODEL".to_string(), serde_json::json!(params.sonnet_model)); }
        if params.auth_mode == "API_KEY" {
            env_obj.insert("ANTHROPIC_API_KEY".to_string(), serde_json::json!(auth_value));
            env_obj.remove("ANTHROPIC_AUTH_TOKEN");
        } else {
            env_obj.insert("ANTHROPIC_AUTH_TOKEN".to_string(), serde_json::json!(auth_value));
            env_obj.remove("ANTHROPIC_API_KEY");
        }
        env_obj.insert("ANTHROPIC_BASE_URL".to_string(), serde_json::json!(params.base_url));
    }

    let content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(&config_path, content).map_err(|e| e.to_string())?;

    if let Some(old_path) = original_path {
        if old_path != config_path && old_path.exists() {
            let old_alias = old_path.file_stem().and_then(|s| s.to_str()).unwrap_or_default().to_string();
            fs::remove_file(&old_path).map_err(|e| e.to_string())?;

            let mut prefs = read_prefs_file();
            let mut prefs_changed = false;
            if prefs.last_alias == old_alias {
                prefs.last_alias = alias.to_string();
                prefs_changed = true;
            }
            // 重命名时同步置顶列表里的旧别名
            for entry in prefs.pinned_aliases.iter_mut() {
                if *entry == old_alias {
                    *entry = alias.to_string();
                    prefs_changed = true;
                }
            }
            // 重命名时同步自定义排序里的旧别名
            for entry in prefs.custom_order.iter_mut() {
                if *entry == old_alias {
                    *entry = alias.to_string();
                    prefs_changed = true;
                }
            }
            if prefs_changed {
                write_prefs_file(&prefs)?;
            }
        }
    }

    Ok(())
}

#[derive(serde::Deserialize)]
struct LaunchParams {
    alias: String,
    working_dir: String,
    skip_permissions: bool,
}

fn find_claude_exe() -> Option<String> {
    // 进程内扫描 PATH，替代 `where claude` 子进程
    // 原因：release 版 cc-start.exe 调用 `Command::new("where").arg("claude").output()`
    // 会稳定卡 5 秒（dev 版无此问题，内核原因未定位）。纯 Rust 扫描可完全绕过
    if let Ok(path_var) = env::var("PATH") {
        let path_ext = env::var("PATHEXT").unwrap_or_else(|_| ".EXE;.CMD;.BAT".to_string());
        let extensions: Vec<String> = path_ext
            .split(';')
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .collect();

        for dir in path_var.split(';') {
            if dir.is_empty() {
                continue;
            }
            let dir_path = PathBuf::from(dir);

            // 先尝试不带扩展名（兼容 npm 全局 claude 这种 shell 脚本形态）
            let base = dir_path.join("claude");
            if base.is_file() {
                return Some(base.to_string_lossy().to_string());
            }
            // 再按 PATHEXT 顺序尝试带扩展名
            for ext in &extensions {
                let with_ext = dir_path.join(format!("claude{}", ext));
                if with_ext.is_file() {
                    return Some(with_ext.to_string_lossy().to_string());
                }
            }
        }
    }

    // fallback: USERPROFILE/.local/bin/claude
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
    let config_path = get_models_dir().join(format!("{}.json", params.alias));
    if !config_path.exists() {
        return Err(format!("配置文件不存在: {}", config_path.display()));
    }

    let claude_exe = find_claude_exe().ok_or_else(|| "找不到 claude 命令，请确保 Claude Code 已安装并加入 PATH".to_string())?;
    let config_path_str = config_path.to_string_lossy().to_string();
    let mut args = vec!["--settings".to_string(), config_path_str];
    if params.skip_permissions {
        args.push("--dangerously-skip-permissions".to_string());
    }

    let wt_result = Command::new("wt.exe")
        .args(["-d", &params.working_dir, "cmd", "/k"])
        .arg(format!("\"{}\" {}", claude_exe, args.join(" ")))
        .spawn();
    if wt_result.is_ok() {
        return Ok(());
    }

    let cmd_result = Command::new("cmd.exe")
        .args(["/c", "start", "CC Start", "cmd", "/k"])
        .arg(format!("cd /d \"{}\" && \"{}\" {}", params.working_dir, claude_exe, args.join(" ")))
        .spawn();
    if cmd_result.is_ok() {
        return Ok(());
    }

    Err("无法启动终端".to_string())
}

#[tauri::command]
async fn test_connectivity(params: TestParams) -> Result<TestResult, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .map_err(|e| e.to_string())?;

    let start = std::time::Instant::now();
    let url = format!("{}/v1/messages", params.base_url.trim_end_matches('/'));
    let body = serde_json::json!({
        "model": params.model_id,
        "messages": [{"role": "user", "content": "ping"}],
        "max_tokens": 5,
    });

    let request = build_test_headers(client.post(url).json(&body), &params.auth_mode, &params.auth_value);
    let response = request.send().await;
    let elapsed_ms = start.elapsed().as_millis() as u64;

    match response {
        Ok(resp) => {
            let status_code = resp.status().as_u16();
            let message = resp.text().await.unwrap_or_else(|_| "请求完成，但读取响应失败".to_string());
            Ok(classify_connectivity_response(status_code, elapsed_ms, message))
        }
        Err(err) => {
            let error_kind = if err.is_timeout() { "timeout" } else if err.is_connect() { "network" } else { "other" };
            Ok(TestResult {
                success: false,
                elapsed_ms,
                status_code: None,
                error_kind: Some(error_kind.to_string()),
                message: err.to_string(),
            })
        }
    }
}

#[tauri::command]
fn copy_model_config(alias: String) -> Result<String, String> {
    let source_alias = normalize_alias(&alias);
    validate_alias(&source_alias)?;

    let models_dir = get_models_dir();
    let source_path = models_dir.join(format!("{}.json", source_alias));
    if !source_path.exists() {
        return Err(format!("源配置文件不存在: {}", source_path.display()));
    }

    let new_alias = next_copy_alias(&models_dir, &source_alias)?;
    let dest_path = models_dir.join(format!("{}.json", new_alias));
    fs::copy(&source_path, &dest_path).map_err(|e| e.to_string())?;
    Ok(new_alias)
}

#[tauri::command]
fn delete_model_config(alias: String) -> Result<(), String> {
    let models_dir = get_models_dir();
    let source_path = models_dir.join(format!("{}.json", alias));
    if !source_path.exists() {
        return Err(format!("配置文件不存在: {}", source_path.display()));
    }

    let trash_dir = models_dir.join(".trash");
    if !trash_dir.exists() {
        fs::create_dir_all(&trash_dir).map_err(|e| e.to_string())?;
    }

    let timestamp = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();
    let dest_path = trash_dir.join(format!("{}.{}.json", alias, timestamp));
    fs::rename(&source_path, &dest_path).map_err(|e| e.to_string())?;
    cleanup_trash(&trash_dir, 10)?;

    // 删除时从置顶列表和自定义排序中移除
    let mut prefs = read_prefs_file();
    let pinned_before = prefs.pinned_aliases.len();
    let order_before = prefs.custom_order.len();
    prefs.pinned_aliases.retain(|a| a != &alias);
    prefs.custom_order.retain(|a| a != &alias);
    if prefs.pinned_aliases.len() != pinned_before
        || prefs.custom_order.len() != order_before
    {
        write_prefs_file(&prefs)?;
    }
    Ok(())
}

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

    entries_with_mtime.sort_by(|a, b| a.1.cmp(&b.1));
    let to_remove = entries_with_mtime.len().saturating_sub(keep);
    for (path, _) in entries_with_mtime.iter().take(to_remove) {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ====== 自动备份 ======

const BACKUP_KEEP_COUNT: usize = 20;

// 在指定目录下创建一份备份（用于测试时传入临时根目录）
fn create_backup_in(claude_dir: &PathBuf, backups_root: &PathBuf) -> Result<PathBuf, String> {
    let timestamp = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();
    let backup_dir = backups_root.join(&timestamp);

    if backup_dir.exists() {
        // 同一秒内重复触发：直接返回已存在目录，避免错误
        return Ok(backup_dir);
    }
    fs::create_dir_all(&backup_dir).map_err(|e| format!("创建备份目录失败: {}", e))?;

    // 备份模型配置 ~/.claude/models/*.json
    let models_dir = claude_dir.join("models");
    if models_dir.exists() {
        let dest_models = backup_dir.join("models");
        fs::create_dir_all(&dest_models).map_err(|e| e.to_string())?;
        if let Ok(entries) = fs::read_dir(&models_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() && path.extension().map_or(false, |ext| ext == "json") {
                    if let Some(filename) = path.file_name() {
                        let _ = fs::copy(&path, dest_models.join(filename));
                    }
                }
            }
        }
    }

    // 备份通用配置
    let common_path = claude_dir.join("cc_start_common_config.json");
    if common_path.exists() {
        let _ = fs::copy(&common_path, backup_dir.join("cc_start_common_config.json"));
    }

    // 备份 GUI 偏好
    let prefs_path = claude_dir.join("cc_start_prefs.json");
    if prefs_path.exists() {
        let _ = fs::copy(&prefs_path, backup_dir.join("cc_start_prefs.json"));
    }

    Ok(backup_dir)
}

fn create_backup() -> Result<PathBuf, String> {
    let claude_dir = get_claude_dir();
    let backups_root = get_backups_dir();
    if !backups_root.exists() {
        fs::create_dir_all(&backups_root).map_err(|e| format!("创建备份根目录失败: {}", e))?;
    }
    create_backup_in(&claude_dir, &backups_root)
}

fn cleanup_old_backups_in(backups_root: &PathBuf, keep: usize) -> Result<(), String> {
    if !backups_root.exists() {
        return Ok(());
    }
    let entries = fs::read_dir(backups_root).map_err(|e| e.to_string())?;
    let mut entries_with_mtime: Vec<(PathBuf, std::time::SystemTime)> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .filter_map(|e| {
            let path = e.path();
            let mtime = e.metadata().ok()?.modified().ok()?;
            Some((path, mtime))
        })
        .collect();

    if entries_with_mtime.len() <= keep {
        return Ok(());
    }

    entries_with_mtime.sort_by(|a, b| a.1.cmp(&b.1));
    let to_remove = entries_with_mtime.len().saturating_sub(keep);
    for (path, _) in entries_with_mtime.iter().take(to_remove) {
        let _ = fs::remove_dir_all(path);
    }
    Ok(())
}

fn cleanup_old_backups(keep: usize) -> Result<(), String> {
    cleanup_old_backups_in(&get_backups_dir(), keep)
}

// 检查并执行一次备份（如果到期）。失败时仅记录到 stderr，不影响其他流程。
fn tick_backup_if_due() {
    let prefs = read_prefs_file();
    if prefs.backup_interval_hours == 0 {
        return;
    }

    let now_secs = chrono::Local::now().timestamp();
    let elapsed = now_secs.saturating_sub(prefs.last_backup_at);
    let interval_secs = prefs.backup_interval_hours as i64 * 3600;
    if elapsed < interval_secs {
        return;
    }

    match create_backup() {
        Ok(_) => {
            let _ = cleanup_old_backups(BACKUP_KEEP_COUNT);
            // 重新读取 prefs，避免覆盖用户在备份期间修改的其他字段
            let mut latest = read_prefs_file();
            latest.last_backup_at = now_secs;
            if let Err(e) = write_prefs_file(&latest) {
                eprintln!("[backup] 更新 last_backup_at 失败: {}", e);
            }
        }
        Err(e) => {
            // 备份失败仅打印日志，不阻塞用户
            eprintln!("[backup] 自动备份失败: {}", e);
        }
    }
}

// 一次性启动后台调度线程：每 60 秒检查是否到期。读取 prefs 决定行为，
// 这样用户调整 backup_interval_hours 后无需重启进程。
static BACKUP_SCHEDULER_STARTED: AtomicBool = AtomicBool::new(false);

fn start_backup_scheduler() {
    if BACKUP_SCHEDULER_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(|| {
        loop {
            std::thread::sleep(std::time::Duration::from_secs(60));
            tick_backup_if_due();
        }
    });
}

#[tauri::command]
fn get_common_config() -> Result<String, String> {
    Ok(read_common_config_from(&get_common_config_path()))
}

#[tauri::command]
fn save_common_config(content: String) -> Result<(), String> {
    save_common_config_to(&get_common_config_path(), &content)
}

#[tauri::command]
fn extract_common_config_from_raw(raw_json: String) -> Result<String, String> {
    extract_common_config_candidate(&raw_json)
}

// 从 ~/.claude/settings.json 提取候选通用配置
// 复用 strip_excluded_for_common() 排除规则，避免把模型供应商专属字段、
// API Key、Base URL、模型 ID 等敏感字段写入通用配置。
#[tauri::command]
fn extract_common_config_from_settings() -> Result<String, String> {
    let settings_path = get_claude_dir().join("settings.json");
    if !settings_path.exists() {
        return Err("未找到 ~/.claude/settings.json".to_string());
    }

    let content = fs::read_to_string(&settings_path)
        .map_err(|e| format!("读取 settings.json 失败: {}", e))?;

    extract_common_config_candidate(&content)
}

// 立即手动触发一次备份并清理旧备份。失败时返回错误，方便前端给出提示。
// 同时把 last_backup_at 更新为当前时间，避免立刻又触发自动备份。
#[tauri::command]
fn run_backup_now() -> Result<String, String> {
    let path = create_backup()?;
    let _ = cleanup_old_backups(BACKUP_KEEP_COUNT);
    let mut prefs = read_prefs_file();
    prefs.last_backup_at = chrono::Local::now().timestamp();
    let _ = write_prefs_file(&prefs);
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn open_backups_dir() -> Result<(), String> {
    let backups_dir = get_backups_dir();
    if !backups_dir.exists() {
        fs::create_dir_all(&backups_dir).map_err(|e| e.to_string())?;
    }

    Command::new("explorer.exe")
        .arg(backups_dir)
        .spawn()
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_401_as_auth_failed() {
        let result = classify_connectivity_response(401, 123, "unauthorized".to_string());
        assert!(!result.success);
        assert_eq!(result.status_code, Some(401));
        assert_eq!(result.error_kind.as_deref(), Some("auth_failed"));
    }

    #[test]
    fn classifies_404_as_not_found() {
        let result = classify_connectivity_response(404, 88, "not found".to_string());
        assert!(!result.success);
        assert_eq!(result.status_code, Some(404));
        assert_eq!(result.error_kind.as_deref(), Some("not_found"));
    }

    #[test]
    fn classifies_200_as_success() {
        let result = classify_connectivity_response(200, 45, "ok".to_string());
        assert!(result.success);
        assert_eq!(result.status_code, Some(200));
        assert_eq!(result.error_kind, None);
    }



    #[test]
    fn rejects_alias_with_chinese_characters() {
        assert!(validate_alias("demo-1").is_ok());
        assert!(validate_alias("配置A").is_err());
    }

    #[test]
    fn creating_with_existing_alias_returns_error() {
        let temp_dir = std::env::temp_dir().join(format!("cc_start_test_create_dup_{}", std::process::id()));
        let _ = fs::remove_dir_all(&temp_dir);
        fs::create_dir_all(&temp_dir).unwrap();

        fs::write(
            temp_dir.join("alpha.json"),
            r#"{"display_name":"Alpha","env":{"ANTHROPIC_AUTH_TOKEN":"token","ANTHROPIC_BASE_URL":"https://example.com","ANTHROPIC_MODEL":"claude"}}"#,
        ).unwrap();

        let params = SaveModelParams {
            alias: "alpha".to_string(),
            display_name: "Alpha New".to_string(),
            model_id: "claude".to_string(),
            haiku_model: "".to_string(),
            opus_model: "".to_string(),
            sonnet_model: "".to_string(),
            auth_value: "token".to_string(),
            auth_mode: "AUTH_TOKEN".to_string(),
            base_url: "https://example.com".to_string(),
            working_dir: "".to_string(),
            mode: "normal".to_string(),
            raw_json: String::new(),
            original_alias: None,
        };

        let result = save_model_config_in_dir(&temp_dir, params);
        assert!(result.is_err());

        let saved = fs::read_to_string(temp_dir.join("alpha.json")).unwrap();
        assert!(saved.contains("\"Alpha\""));
        assert!(!saved.contains("\"Alpha New\""));

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn renaming_to_existing_alias_returns_error() {
        let temp_dir = std::env::temp_dir().join(format!("cc_start_test_dup_{}", std::process::id()));
        let _ = fs::remove_dir_all(&temp_dir);
        fs::create_dir_all(&temp_dir).unwrap();

        fs::write(
            temp_dir.join("alpha.json"),
            r#"{"display_name":"Alpha","env":{"ANTHROPIC_AUTH_TOKEN":"token","ANTHROPIC_BASE_URL":"https://example.com","ANTHROPIC_MODEL":"claude"}}"#,
        ).unwrap();
        fs::write(
            temp_dir.join("beta.json"),
            r#"{"display_name":"Beta","env":{"ANTHROPIC_AUTH_TOKEN":"token","ANTHROPIC_BASE_URL":"https://example.com","ANTHROPIC_MODEL":"claude"}}"#,
        ).unwrap();

        let params = SaveModelParams {
            alias: "beta".to_string(),
            display_name: "Beta".to_string(),
            model_id: "claude".to_string(),
            haiku_model: "".to_string(),
            opus_model: "".to_string(),
            sonnet_model: "".to_string(),
            auth_value: "token".to_string(),
            auth_mode: "AUTH_TOKEN".to_string(),
            base_url: "https://example.com".to_string(),
            working_dir: "".to_string(),
            mode: "normal".to_string(),
            raw_json: String::new(),
            original_alias: Some("alpha".to_string()),
        };

        let result = save_model_config_in_dir(&temp_dir, params);
        assert!(result.is_err());
        assert!(temp_dir.join("alpha.json").exists());
        assert!(temp_dir.join("beta.json").exists());

        let _ = fs::remove_dir_all(&temp_dir);
    }


    // ====== 通用配置：自动提取排除规则 ======

    #[test]
    fn strip_excluded_removes_top_level_private_fields() {
        let mut value: serde_json::Value = serde_json::from_str(
            r#"{"display_name":"x","working_dir":"y","mode":"normal","custom":1}"#
        ).unwrap();
        strip_excluded_for_common(&mut value);
        let obj = value.as_object().unwrap();
        assert!(!obj.contains_key("display_name"));
        assert!(!obj.contains_key("working_dir"));
        assert!(!obj.contains_key("mode"));
        assert_eq!(obj.get("custom"), Some(&serde_json::json!(1)));
    }

    #[test]
    fn strip_excluded_removes_env_private_fields() {
        let mut value: serde_json::Value = serde_json::from_str(
            r#"{"env":{"ANTHROPIC_API_KEY":"a","ANTHROPIC_AUTH_TOKEN":"b","ANTHROPIC_BASE_URL":"c","ANTHROPIC_MODEL":"d","ANTHROPIC_DEFAULT_HAIKU_MODEL":"e","ANTHROPIC_DEFAULT_SONNET_MODEL":"f","ANTHROPIC_DEFAULT_OPUS_MODEL":"g","CUSTOM_VAR":"h"}}"#
        ).unwrap();
        strip_excluded_for_common(&mut value);
        let env = value.get("env").unwrap().as_object().unwrap();
        assert!(!env.contains_key("ANTHROPIC_API_KEY"));
        assert!(!env.contains_key("ANTHROPIC_AUTH_TOKEN"));
        assert!(!env.contains_key("ANTHROPIC_BASE_URL"));
        assert!(!env.contains_key("ANTHROPIC_MODEL"));
        assert!(!env.contains_key("ANTHROPIC_DEFAULT_HAIKU_MODEL"));
        assert!(!env.contains_key("ANTHROPIC_DEFAULT_SONNET_MODEL"));
        assert!(!env.contains_key("ANTHROPIC_DEFAULT_OPUS_MODEL"));
        assert_eq!(env.get("CUSTOM_VAR"), Some(&serde_json::json!("h")));
    }

    #[test]
    fn strip_excluded_removes_env_when_all_fields_excluded() {
        let mut value: serde_json::Value = serde_json::from_str(
            r#"{"env":{"ANTHROPIC_API_KEY":"a","ANTHROPIC_MODEL":"d"},"custom":1}"#
        ).unwrap();
        strip_excluded_for_common(&mut value);
        let obj = value.as_object().unwrap();
        assert!(!obj.contains_key("env"));
        assert_eq!(obj.get("custom"), Some(&serde_json::json!(1)));
    }

    #[test]
    fn strip_excluded_preserves_unknown_top_level_fields() {
        let mut value: serde_json::Value = serde_json::from_str(
            r#"{"customField":"value","theme":"dark","nested":{"a":1}}"#
        ).unwrap();
        strip_excluded_for_common(&mut value);
        let obj = value.as_object().unwrap();
        assert_eq!(obj.get("customField"), Some(&serde_json::json!("value")));
        assert_eq!(obj.get("theme"), Some(&serde_json::json!("dark")));
        assert_eq!(obj.get("nested"), Some(&serde_json::json!({"a":1})));
    }

    #[test]
    fn extract_common_config_invalid_json_returns_error() {
        let result = extract_common_config_candidate("not json");
        assert!(result.is_err());
    }

    #[test]
    fn extract_common_config_empty_input_returns_empty_object() {
        let result = extract_common_config_candidate("").unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&result).unwrap();
        assert_eq!(parsed, serde_json::json!({}));
    }

    #[test]
    fn extract_common_config_strips_all_private_fields() {
        let raw = r#"{
            "display_name": "Test",
            "working_dir": "C:/x",
            "mode": "skip-permissions",
            "env": {
                "ANTHROPIC_API_KEY": "secret",
                "ANTHROPIC_BASE_URL": "https://example.com",
                "ANTHROPIC_MODEL": "claude",
                "CUSTOM_ENV": "kept"
            },
            "customRoot": 42
        }"#;
        let result = extract_common_config_candidate(raw).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&result).unwrap();
        let obj = parsed.as_object().unwrap();
        assert!(!obj.contains_key("display_name"));
        assert!(!obj.contains_key("working_dir"));
        assert!(!obj.contains_key("mode"));
        assert_eq!(obj.get("customRoot"), Some(&serde_json::json!(42)));
        let env = parsed.get("env").unwrap().as_object().unwrap();
        assert!(!env.contains_key("ANTHROPIC_API_KEY"));
        assert!(!env.contains_key("ANTHROPIC_BASE_URL"));
        assert!(!env.contains_key("ANTHROPIC_MODEL"));
        assert_eq!(env.get("CUSTOM_ENV"), Some(&serde_json::json!("kept")));
    }

    // ====== 通用配置：读写 ======

    #[test]
    fn save_common_config_rejects_invalid_json() {
        let temp_dir = std::env::temp_dir().join(format!("cc_start_common_save_invalid_{}", std::process::id()));
        let _ = fs::remove_dir_all(&temp_dir);
        fs::create_dir_all(&temp_dir).unwrap();
        let path = temp_dir.join("common.json");

        let result = save_common_config_to(&path, "not valid json");
        assert!(result.is_err());
        assert!(!path.exists());

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn save_common_config_writes_pretty_json() {
        let temp_dir = std::env::temp_dir().join(format!("cc_start_common_save_pretty_{}", std::process::id()));
        let _ = fs::remove_dir_all(&temp_dir);
        fs::create_dir_all(&temp_dir).unwrap();
        let path = temp_dir.join("common.json");

        let raw = r#"{"a":1,"nested":{"b":2}}"#;
        save_common_config_to(&path, raw).unwrap();
        let content = fs::read_to_string(&path).unwrap();
        assert!(content.contains('\n'), "saved JSON should be pretty-printed");
        let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();
        assert_eq!(parsed, serde_json::json!({"a":1,"nested":{"b":2}}));

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn save_common_config_overwrites_existing_file() {
        let temp_dir = std::env::temp_dir().join(format!("cc_start_common_save_overwrite_{}", std::process::id()));
        let _ = fs::remove_dir_all(&temp_dir);
        fs::create_dir_all(&temp_dir).unwrap();
        let path = temp_dir.join("common.json");

        save_common_config_to(&path, r#"{"a":1}"#).unwrap();
        save_common_config_to(&path, r#"{"b":2}"#).unwrap();
        let content = fs::read_to_string(&path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();
        assert_eq!(parsed, serde_json::json!({"b":2}));

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn read_common_config_returns_empty_object_when_missing() {
        let temp_dir = std::env::temp_dir().join(format!("cc_start_common_read_missing_{}", std::process::id()));
        let _ = fs::remove_dir_all(&temp_dir);
        let path = temp_dir.join("common.json");
        // 文件不存在
        let content = read_common_config_from(&path);
        let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();
        assert_eq!(parsed, serde_json::json!({}));
    }

    #[test]
    fn read_common_config_returns_file_content_when_exists() {
        let temp_dir = std::env::temp_dir().join(format!("cc_start_common_read_exists_{}", std::process::id()));
        let _ = fs::remove_dir_all(&temp_dir);
        fs::create_dir_all(&temp_dir).unwrap();
        let path = temp_dir.join("common.json");
        fs::write(&path, r#"{"foo":"bar"}"#).unwrap();

        let content = read_common_config_from(&path);
        let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();
        assert_eq!(parsed, serde_json::json!({"foo":"bar"}));

        let _ = fs::remove_dir_all(&temp_dir);
    }


    // ====== 自动备份 ======

    fn unique_temp_dir(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        std::env::temp_dir().join(format!("cc_start_backup_{}_{}_{}", tag, std::process::id(), nanos))
    }

    fn setup_fake_claude_dir(claude_dir: &PathBuf) {
        fs::create_dir_all(claude_dir.join("models")).unwrap();
        fs::write(
            claude_dir.join("models").join("alpha.json"),
            r#"{"display_name":"Alpha"}"#,
        ).unwrap();
        fs::write(
            claude_dir.join("models").join("beta.json"),
            r#"{"display_name":"Beta"}"#,
        ).unwrap();
        fs::write(
            claude_dir.join("cc_start_common_config.json"),
            r#"{"hooks":{}}"#,
        ).unwrap();
        fs::write(
            claude_dir.join("cc_start_prefs.json"),
            r#"{"remember_model":true,"last_alias":""}"#,
        ).unwrap();
    }

    #[test]
    fn create_backup_copies_models_common_and_prefs() {
        let claude_dir = unique_temp_dir("create");
        let backups_root = claude_dir.join("cc_start_backups");
        let _ = fs::remove_dir_all(&claude_dir);
        setup_fake_claude_dir(&claude_dir);

        let backup_dir = create_backup_in(&claude_dir, &backups_root).unwrap();
        assert!(backup_dir.exists());
        assert!(backup_dir.join("models").join("alpha.json").exists());
        assert!(backup_dir.join("models").join("beta.json").exists());
        assert!(backup_dir.join("cc_start_common_config.json").exists());
        assert!(backup_dir.join("cc_start_prefs.json").exists());

        let _ = fs::remove_dir_all(&claude_dir);
    }

    #[test]
    fn create_backup_works_when_only_some_files_exist() {
        let claude_dir = unique_temp_dir("partial");
        let backups_root = claude_dir.join("cc_start_backups");
        let _ = fs::remove_dir_all(&claude_dir);
        // 仅存在 models 目录，无通用配置和偏好文件
        fs::create_dir_all(claude_dir.join("models")).unwrap();
        fs::write(
            claude_dir.join("models").join("only.json"),
            r#"{"display_name":"Only"}"#,
        ).unwrap();

        let backup_dir = create_backup_in(&claude_dir, &backups_root).unwrap();
        assert!(backup_dir.join("models").join("only.json").exists());
        assert!(!backup_dir.join("cc_start_common_config.json").exists());
        assert!(!backup_dir.join("cc_start_prefs.json").exists());

        let _ = fs::remove_dir_all(&claude_dir);
    }

    #[test]
    fn cleanup_old_backups_keeps_latest_n() {
        let backups_root = unique_temp_dir("cleanup");
        let _ = fs::remove_dir_all(&backups_root);
        fs::create_dir_all(&backups_root).unwrap();

        // 创建 5 个时间戳目录，模拟历史备份
        let names = ["20260101-000001", "20260102-000001", "20260103-000001", "20260104-000001", "20260105-000001"];
        for name in &names {
            let dir = backups_root.join(name);
            fs::create_dir_all(&dir).unwrap();
            fs::write(dir.join("marker"), name).unwrap();
            // 间隔短暂延迟，让 mtime 顺序与名称顺序一致
            std::thread::sleep(std::time::Duration::from_millis(20));
        }

        cleanup_old_backups_in(&backups_root, 3).unwrap();

        // 仅保留最近 3 个（最新 mtime 的）
        let kept: Vec<String> = fs::read_dir(&backups_root).unwrap()
            .filter_map(|e| e.ok())
            .filter_map(|e| e.file_name().into_string().ok())
            .collect();
        assert_eq!(kept.len(), 3);
        assert!(kept.contains(&"20260103-000001".to_string()));
        assert!(kept.contains(&"20260104-000001".to_string()));
        assert!(kept.contains(&"20260105-000001".to_string()));

        let _ = fs::remove_dir_all(&backups_root);
    }

    #[test]
    fn cleanup_old_backups_no_op_when_under_limit() {
        let backups_root = unique_temp_dir("cleanup_under");
        let _ = fs::remove_dir_all(&backups_root);
        fs::create_dir_all(&backups_root).unwrap();
        fs::create_dir_all(backups_root.join("20260101-000001")).unwrap();
        fs::create_dir_all(backups_root.join("20260102-000001")).unwrap();

        cleanup_old_backups_in(&backups_root, 5).unwrap();

        let count = fs::read_dir(&backups_root).unwrap().count();
        assert_eq!(count, 2);

        let _ = fs::remove_dir_all(&backups_root);
    }

    #[test]
    fn cleanup_old_backups_no_op_when_dir_missing() {
        let backups_root = unique_temp_dir("cleanup_missing");
        let _ = fs::remove_dir_all(&backups_root);
        // 不创建目录
        let result = cleanup_old_backups_in(&backups_root, 5);
        assert!(result.is_ok());
    }

    #[test]
    fn user_prefs_default_backup_interval_is_24() {
        let prefs = default_prefs();
        assert_eq!(prefs.backup_interval_hours, 24);
        assert_eq!(prefs.last_backup_at, 0);
    }

    #[test]
    fn user_prefs_deserialize_legacy_without_backup_fields() {
        // 旧版本 prefs 文件没有 backup_interval_hours，反序列化时应使用默认值
        let legacy = r#"{"remember_model":true,"last_alias":"kimi"}"#;
        let prefs: UserPrefs = serde_json::from_str(legacy).unwrap();
        assert_eq!(prefs.remember_model, true);
        assert_eq!(prefs.last_alias, "kimi");
        assert_eq!(prefs.backup_interval_hours, 24);
        assert_eq!(prefs.last_backup_at, 0);
    }

    #[test]
    fn user_prefs_deserialize_with_backup_off() {
        let json = r#"{"remember_model":false,"last_alias":"","backup_interval_hours":0,"last_backup_at":1700000000}"#;
        let prefs: UserPrefs = serde_json::from_str(json).unwrap();
        assert_eq!(prefs.backup_interval_hours, 0);
        assert_eq!(prefs.last_backup_at, 1700000000);
    }


}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    start_backup_scheduler();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            list_models,
            launch_claude,
            get_home_dir,
            get_app_version,
            get_claude_version,
            open_models_dir,
            get_prefs,
            save_prefs,
            save_model_config,
            delete_model_config,
            copy_model_config,
            test_connectivity,
            get_common_config,
            save_common_config,
            extract_common_config_from_raw,
            extract_common_config_from_settings,
            run_backup_now,
            open_backups_dir
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
