use std::path::PathBuf;

fn main() {
    let fixture_dir = std::env::args()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../contracts/fixtures")
        });

    if let Err(error) = cdrivecleaner_contracts::verify_contract_fixtures(&fixture_dir) {
        eprintln!("{error}");
        std::process::exit(1);
    }

    println!("Contract fixtures verified: {}", fixture_dir.display());
}
