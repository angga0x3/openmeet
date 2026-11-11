use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub room: String,
    pub started_at: i64,
    pub duration_secs: i64,
    pub participants: i64,
}

fn database_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir.join("history.db"))
}

fn open(app: &AppHandle) -> Result<Connection, String> {
    let path = database_path(app)?;
    let connection = Connection::open(&path).map_err(|error| error.to_string())?;
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS meetings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                room TEXT NOT NULL,
                started_at INTEGER NOT NULL,
                duration_secs INTEGER NOT NULL,
                participants INTEGER NOT NULL
            );",
        )
        .map_err(|error| error.to_string())?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }

    Ok(connection)
}

#[tauri::command]
pub fn list_history(app: AppHandle) -> Result<Vec<HistoryEntry>, String> {
    let connection = open(&app)?;
    let mut statement = connection
        .prepare(
            "SELECT room, started_at, duration_secs, participants
             FROM meetings ORDER BY started_at DESC LIMIT 20",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(HistoryEntry {
                room: row.get(0)?,
                started_at: row.get(1)?,
                duration_secs: row.get(2)?,
                participants: row.get(3)?,
            })
        })
        .map_err(|error| error.to_string())?;

    let mut entries = Vec::new();
    for row in rows {
        entries.push(row.map_err(|error| error.to_string())?);
    }
    Ok(entries)
}

#[tauri::command]
pub fn add_history(app: AppHandle, mut entry: HistoryEntry) -> Result<(), String> {
    if entry.room.is_empty()
        || entry.room.len() > 64
        || !entry
            .room
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
    {
        return Err("invalid room code".to_string());
    }
    entry.duration_secs = entry.duration_secs.clamp(0, 86_400);
    entry.participants = entry.participants.clamp(0, 128);
    entry.started_at = entry.started_at.max(0);

    let connection = open(&app)?;
    connection
        .execute(
            "INSERT INTO meetings (room, started_at, duration_secs, participants)
             VALUES (?1, ?2, ?3, ?4)",
            params![
                entry.room,
                entry.started_at,
                entry.duration_secs,
                entry.participants
            ],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "DELETE FROM meetings WHERE id NOT IN
             (SELECT id FROM meetings ORDER BY id DESC LIMIT 100)",
            [],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}
