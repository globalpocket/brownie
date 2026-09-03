use std::{env, fs, process};

fn usage() -> &'static str {
    "usage: brownie-protocol-semantic-contract [--write PATH | --check PATH]"
}

fn main() {
    let contract = brownie_protocol::semantic_contract::runtime_semantic_protocol_contract();
    let rendered =
        serde_json::to_string_pretty(&contract).expect("semantic contract serializes") + "\n";

    let mut args = env::args().skip(1);
    match args.next().as_deref() {
        None => {
            print!("{rendered}");
        }
        Some("--write") => {
            let path = args.next().unwrap_or_else(|| {
                eprintln!("{}", usage());
                process::exit(2);
            });
            if args.next().is_some() {
                eprintln!("{}", usage());
                process::exit(2);
            }
            fs::write(path, rendered).expect("write semantic contract artifact");
        }
        Some("--check") => {
            let path = args.next().unwrap_or_else(|| {
                eprintln!("{}", usage());
                process::exit(2);
            });
            if args.next().is_some() {
                eprintln!("{}", usage());
                process::exit(2);
            }
            let existing = fs::read_to_string(&path).expect("read semantic contract artifact");
            if existing != rendered {
                eprintln!(
                    "semantic protocol contract is stale; regenerate with `cargo run -p brownie-protocol --bin brownie-protocol-semantic-contract -- --write {path}`"
                );
                process::exit(1);
            }
        }
        Some(_) => {
            eprintln!("{}", usage());
            process::exit(2);
        }
    }
}
