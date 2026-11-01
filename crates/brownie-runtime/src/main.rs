use std::io::{self, BufRead, IsTerminal, Write};

fn main() -> anyhow::Result<()> {
    if std::env::args().skip(1).eq(["--build-provenance"]) {
        println!("{}", brownie_runtime::build_provenance());
        return Ok(());
    }
    if io::stdin().is_terminal() {
        let status = brownie_runtime::runtime_status();
        println!("{}", serde_json::to_string(&status)?);
        return Ok(());
    }

    let stdin = io::stdin();
    let mut stdout = io::stdout().lock();

    for line in stdin.lock().lines() {
        if let Some(response) = brownie_runtime::handle_jsonrpc_input_line(&line?) {
            writeln!(stdout, "{response}")?;
            stdout.flush()?;
        }
    }

    Ok(())
}
