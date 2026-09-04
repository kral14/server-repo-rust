use sqlx::SqlitePool;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let pool = SqlitePool::connect("sqlite:masterdeploy.db").await?;
    
    let rows: Vec<(String, String)> = sqlx::query_as("SELECT key, value FROM settings")
        .fetch_all(&pool)
        .await?;

    for (k, v) in rows {
        println!("Setting: {} = {}", k, v);
    }

    Ok(())
}
