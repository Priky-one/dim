use std::env;
use std::error::Error;
use std::fs;
use std::str::FromStr;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let out_dir = env::var("CARGO_TARGET_DIR")
        .or_else(|_| env::var("OUT_DIR").map(|d| {
            // OUT_DIR is something like /path/to/target/debug/build/dim-database-xxx/out
            // We want to get to /path/to/target
            std::path::PathBuf::from(d)
                .parent()
                .and_then(|p| p.parent())
                .and_then(|p| p.parent())
                .and_then(|p| p.parent())
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|| "target".to_string())
        }))
        .unwrap_or_else(|_| "target".to_string());

    let db_file = format!("{out_dir}/dim_dev.db");
    println!("cargo:rustc-env=DATABASE_URL=sqlite://{db_file}");
    println!(
        "cargo:warning=Generating {:?} from latest migrations.",
        db_file
    );

    let _ = fs::remove_file(&db_file);

    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .connect_with(
            sqlx::sqlite::SqliteConnectOptions::from_str(db_file.as_ref())?.create_if_missing(true),
        )
        .await?;

    sqlx::migrate!().run(&pool).await.map_err(|e| {
        println!("cargo:error=Migration failed: {:?}", e);
        e
    })?;

    println!("cargo:warning=Built database {}.", db_file);

    println!("cargo:rerun-if-changed=database/src/build.rs");
    println!("cargo:rerun-if-changed=database/migrations");

    Ok(())
}
