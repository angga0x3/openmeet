use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    pub display_name: String,
    pub server_url: String,
    pub camera_id: String,
    pub mic_id: String,
    pub speaker_id: String,
    pub start_muted: bool,
    pub start_video_off: bool,
    pub noise_suppression: bool,
    pub server_url_custom: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            display_name: String::new(),
            server_url: "wss://openmeet.garox.my.id".to_string(),
            camera_id: String::new(),
            mic_id: String::new(),
            speaker_id: String::new(),
            start_muted: false,
            start_video_off: false,
            noise_suppression: true,
            server_url_custom: false,
        }
    }
}

fn config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(config_dir(app)?.join("settings.json"))
}

fn clamp(value: String, max: usize) -> String {
    value.chars().take(max).collect()
}

#[tauri::command]
pub fn load_settings(app: AppHandle) -> Result<Settings, String> {
    let path = settings_path(&app)?;
    match fs::read(&path) {
        Ok(bytes) => {
            serde_json::from_slice(&bytes).map_err(|error| format!("invalid settings.json: {error}"))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Settings::default()),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub fn save_settings(app: AppHandle, mut settings: Settings) -> Result<(), String> {
    settings.display_name = clamp(settings.display_name.trim().to_string(), 64);
    settings.server_url = clamp(settings.server_url.trim().to_string(), 512);
    settings.camera_id = clamp(settings.camera_id, 256);
    settings.mic_id = clamp(settings.mic_id, 256);
    settings.speaker_id = clamp(settings.speaker_id, 256);

    if settings.server_url.is_empty() {
        settings.server_url = Settings::default().server_url;
    }

    let path = settings_path(&app)?;
    let data = serde_json::to_vec_pretty(&settings).map_err(|error| error.to_string())?;
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, data).map_err(|error| error.to_string())?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&temporary, fs::Permissions::from_mode(0o600))
            .map_err(|error| error.to_string())?;
    }

    fs::rename(&temporary, &path).map_err(|error| error.to_string())
}
