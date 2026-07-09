use sqlx::SqlitePool;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let pool = SqlitePool::connect("sqlite:masterdeploy.db").await?;
    
    // Yoxlayaq görək "plugins" cədvəli varmı və strukturu necədir
    let res = sqlx::query("SELECT id, name, description, installed, version FROM plugins")
        .fetch_all(&pool)
        .await;

    match res {
        Ok(rows) => println!("Success! Fetched {} plugins", rows.len()),
        Err(e) => println!("Error fetching plugins: {:?}", e),
    }
    Ok(())
}




