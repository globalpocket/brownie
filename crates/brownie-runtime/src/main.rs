fn main() -> anyhow::Result<()> {
    let status = brownie_runtime::runtime_status();
    println!("{}", serde_json::to_string(&status)?);
    Ok(())
}
