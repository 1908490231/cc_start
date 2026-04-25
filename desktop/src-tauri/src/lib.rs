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
}

fn default_prefs() -> UserPrefs {
    UserPrefs {
        remember_model: true,
        last_alias: String::new(),
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
            if prefs.last_alias == old_alias {
                prefs.last_alias = alias.to_string();
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


}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
            test_connectivity
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
