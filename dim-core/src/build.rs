use std::env;
use std::path::Path;

fn main() {
    let out_dir = env::var("CARGO_TARGET_DIR")
        .or_else(|_| env::var("OUT_DIR").map(|d| {
            // OUT_DIR is something like /path/to/target/debug/build/dim-core-xxx/out
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

    if Path::new("../ui/build").exists() {
        println!("cargo:rustc-cfg=feature=\"embed_ui\"");
    } else {
        println!("cargo:warning=`ui/build` does not exist.");
        println!("cargo:warning=If you wish to embed the webui, run `yarn build` in `ui`.");
    }

    println!("cargo:rerun-if-changed=ui/build");
    println!("cargo:rerun-if-changed=build.rs");
}
