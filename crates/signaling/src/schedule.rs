use serde::{Deserialize, Serialize};
use sqlx::{postgres::PgPoolOptions, FromRow, PgPool};
use std::time::Duration;

/// A scheduled room. Rows are scoped to an opaque client key, so one
/// deployment can serve many users without accounts.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleEntry {
    pub id: String,
    pub title: String,
    #[sqlx(rename = "start_ms")]
    pub start: i64,
    #[sqlx(rename = "duration_min")]
    pub duration: i64,
    pub room: String,
    pub color: String,
}

pub struct ScheduleStore {
    pool: PgPool,
}

impl ScheduleStore {
    pub async fn connect(database_url: &str) -> Result<Self, sqlx::Error> {
        let pool = PgPoolOptions::new()
            .max_connections(5)
            .acquire_timeout(Duration::from_secs(10))
            .connect(database_url)
            .await?;
        let store = Self { pool };
        store.migrate().await?;
        Ok(store)
    }

    async fn migrate(&self) -> Result<(), sqlx::Error> {
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS openmeet_schedule (
                id TEXT PRIMARY KEY,
                owner TEXT NOT NULL,
                title TEXT NOT NULL,
                start_ms BIGINT NOT NULL,
                duration_min INTEGER NOT NULL,
                room TEXT NOT NULL,
                color TEXT NOT NULL,
                created_ms BIGINT NOT NULL
            )",
        )
        .execute(&self.pool)
        .await?;
        sqlx::query(
            "CREATE INDEX IF NOT EXISTS openmeet_schedule_owner
             ON openmeet_schedule (owner, start_ms)",
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn list(&self, owner: &str) -> Result<Vec<ScheduleEntry>, sqlx::Error> {
        let horizon = unix_millis() - 3_600_000;
        sqlx::query_as::<_, ScheduleEntry>(
            "SELECT id, title, start_ms, duration_min, room, color
             FROM openmeet_schedule
             WHERE owner = $1 AND start_ms + (duration_min::bigint * 60000) > $2
             ORDER BY start_ms ASC
             LIMIT 100",
        )
        .bind(owner)
        .bind(horizon)
        .fetch_all(&self.pool)
        .await
    }

    pub async fn create(&self, owner: &str, entry: &ScheduleEntry) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO openmeet_schedule
                (id, owner, title, start_ms, duration_min, room, color, created_ms)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        )
        .bind(&entry.id)
        .bind(owner)
        .bind(&entry.title)
        .bind(entry.start)
        .bind(entry.duration)
        .bind(&entry.room)
        .bind(&entry.color)
        .bind(unix_millis())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn delete(&self, owner: &str, id: &str) -> Result<bool, sqlx::Error> {
        let result = sqlx::query("DELETE FROM openmeet_schedule WHERE id = $1 AND owner = $2")
            .bind(id)
            .bind(owner)
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn healthy(&self) -> bool {
        sqlx::query("SELECT 1").execute(&self.pool).await.is_ok()
    }
}

fn unix_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}
