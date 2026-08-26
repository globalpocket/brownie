use std::process::ExitCode;

fn main() -> ExitCode {
    let output = brownie_cli::run_cli(std::env::args());
    if !output.stdout.is_empty() {
        print!("{}", output.stdout);
    }
    if !output.stderr.is_empty() {
        eprint!("{}", output.stderr);
    }
    ExitCode::from(output.exit_code.as_i32() as u8)
}
