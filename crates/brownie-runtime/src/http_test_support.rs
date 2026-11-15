//! Bounded HTTP framing for the single-request provider test fixture.

use std::io::{self, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::thread;
use std::time::{Duration, Instant};

const MAX_HEADER_BYTES: usize = 16 * 1024;
const MAX_BODY_BYTES: usize = 16 * 1024 * 1024;
const REQUEST_DEADLINE: Duration = Duration::from_secs(15);

fn invalid(message: &'static str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}

fn remaining(deadline: Instant) -> io::Result<Duration> {
    deadline
        .checked_duration_since(Instant::now())
        .filter(|duration| !duration.is_zero())
        .ok_or_else(|| io::Error::new(io::ErrorKind::TimedOut, "mock HTTP deadline expired"))
}

fn accept(listener: &TcpListener, deadline: Instant) -> io::Result<TcpStream> {
    listener.set_nonblocking(true)?;
    loop {
        remaining(deadline)?;
        match listener.accept() {
            Ok((stream, _)) => {
                stream.set_nonblocking(false)?;
                return Ok(stream);
            }
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(1));
            }
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
            Err(error) => return Err(error),
        }
    }
}

fn content_length(headers: &str) -> io::Result<usize> {
    let mut length = None;
    for line in headers
        .split("\r\n")
        .skip(1)
        .filter(|line| !line.is_empty())
    {
        let (name, value) = line
            .split_once(':')
            .ok_or_else(|| invalid("malformed mock HTTP header"))?;
        if name.eq_ignore_ascii_case("transfer-encoding") {
            return Err(invalid("mock HTTP transfer encoding is unsupported"));
        }
        if name.eq_ignore_ascii_case("content-length") {
            let value = value.trim();
            if length.is_some() || value.is_empty() || !value.bytes().all(|c| c.is_ascii_digit()) {
                return Err(invalid("invalid or duplicate mock HTTP content length"));
            }
            let parsed = value
                .parse::<usize>()
                .map_err(|_| invalid("invalid mock HTTP content length"))?;
            if parsed > MAX_BODY_BYTES {
                return Err(invalid("mock HTTP body exceeds fixed byte limit"));
            }
            length = Some(parsed);
        }
    }
    length.ok_or_else(|| invalid("mock HTTP content length is required"))
}

fn read_request(stream: &mut TcpStream, deadline: Instant) -> io::Result<(String, Vec<u8>)> {
    let mut bytes = Vec::new();
    let mut framing = None;
    loop {
        stream.set_read_timeout(Some(remaining(deadline)?))?;
        let mut chunk = [0_u8; 4096];
        let count = match stream.read(&mut chunk) {
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(error)
                if matches!(
                    error.kind(),
                    io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut
                ) =>
            {
                return Err(io::Error::new(
                    io::ErrorKind::TimedOut,
                    "mock HTTP deadline expired",
                ));
            }
            result => result?,
        };
        if count == 0 {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "mock HTTP request ended before its declared body",
            ));
        }
        bytes.extend_from_slice(&chunk[..count]);
        if framing.is_none() {
            if let Some(end) = bytes.windows(4).position(|part| part == b"\r\n\r\n") {
                let end = end + 4;
                if end > MAX_HEADER_BYTES {
                    return Err(invalid("mock HTTP headers exceed fixed byte limit"));
                }
                let headers = std::str::from_utf8(&bytes[..end])
                    .map_err(|_| invalid("mock HTTP headers are not UTF-8"))?;
                framing = Some((end, content_length(headers)?));
            } else if bytes.len() >= MAX_HEADER_BYTES {
                return Err(invalid("mock HTTP headers exceed fixed byte limit"));
            }
        }
        if let Some((end, length)) = framing {
            let expected = end + length;
            if bytes.len() > expected {
                return Err(invalid("mock HTTP request exceeds its declared body"));
            }
            if bytes.len() == expected {
                let body = bytes.split_off(end);
                let headers = String::from_utf8(bytes)
                    .map_err(|_| invalid("mock HTTP headers are not UTF-8"))?;
                return Ok((headers, body));
            }
        }
    }
}

pub(super) fn spawn_mock(
    status: &str,
    body: &'static str,
) -> (String, thread::JoinHandle<serde_json::Value>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock HTTP listener");
    let addr = listener.local_addr().expect("mock HTTP address");
    let status = status.to_string();
    let deadline = Instant::now() + REQUEST_DEADLINE;
    let handle = thread::spawn(move || {
        let mut stream = accept(&listener, deadline).expect("accept bounded mock HTTP request");
        let (headers, request_body) =
            read_request(&mut stream, deadline).expect("read bounded mock HTTP request");
        assert!(headers.starts_with("POST /v1/chat/completions HTTP/1.1"));
        assert!(headers.lines().any(|line| line
            .to_ascii_lowercase()
            .starts_with("authorization: bearer ")));
        let json: serde_json::Value =
            serde_json::from_slice(&request_body).expect("mock request JSON");
        assert_eq!(json["model"], "mock-model");
        let messages = json["messages"].as_array().expect("messages");
        assert!(messages.iter().any(|m| m["role"] == "system"));
        assert!(messages.iter().any(|m| m["role"] == "user"));
        let response = format!(
            "HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\n\r\n{}",
            body.len(),
            body
        );
        stream
            .set_write_timeout(Some(remaining(deadline).expect("mock response deadline")))
            .expect("set mock response deadline");
        stream
            .write_all(response.as_bytes())
            .expect("write mock HTTP response");
        json
    });
    (format!("http://{addr}/v1"), handle)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::Shutdown;

    fn exchange(parts: &[&[u8]]) -> io::Result<(String, Vec<u8>)> {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let worker = thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(2);
            let mut stream = accept(&listener, deadline)?;
            read_request(&mut stream, deadline)
        });
        let mut client = TcpStream::connect(addr).unwrap();
        client
            .set_write_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        for part in parts {
            if client.write_all(part).is_err() {
                break;
            }
        }
        let _ = client.shutdown(Shutdown::Write);
        worker.join().unwrap()
    }

    fn request_headers(length: usize) -> String {
        format!("POST /v1/chat/completions HTTP/1.1\r\nauthorization: Bearer synthetic-fixture\r\ncontent-length: {length}\r\n\r\n")
    }

    #[test]
    fn small_and_large_requests_preserve_actual_fixture_assertions() {
        for content in ["small".to_string(), "あ".repeat(4000)] {
            let expected = serde_json::json!({"model":"mock-model","messages":[
                {"role":"system","content":"fixture"},{"role":"user","content":content}
            ]});
            let body = serde_json::to_vec(&expected).unwrap();
            let (base_url, worker) = spawn_mock("200 OK", "{}");
            let mut client = TcpStream::connect(
                base_url
                    .trim_start_matches("http://")
                    .trim_end_matches("/v1"),
            )
            .unwrap();
            client
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            client
                .write_all(request_headers(body.len()).as_bytes())
                .unwrap();
            client.write_all(&body).unwrap();
            let mut response = String::new();
            client.read_to_string(&mut response).unwrap();
            assert!(response.starts_with("HTTP/1.1 200 OK\r\n"));
            let observed = worker.join().unwrap();
            assert_eq!(observed, expected);
            println!(
                "HTTP_MOCK_OBSERVATION:{}",
                serde_json::json!({
                    "case": "decoded_request",
                    "user_content_bytes": observed["messages"][1]["content"].as_str().unwrap().len(),
                    "received_json_bytes": serde_json::to_vec(&observed).unwrap().len(),
                })
            );
        }
    }

    #[test]
    fn reads_fragmented_headers_and_body_on_actual_socket() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let worker = thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(2);
            let mut stream = accept(&listener, deadline).unwrap();
            read_request(&mut stream, deadline).unwrap()
        });
        let mut client = TcpStream::connect(addr).unwrap();
        client.set_nodelay(true).unwrap();
        for part in [
            b"POST / HTTP/1.1\r\nContent-Len".as_slice(),
            b"gth: 9\r\n\r",
            b"\n{",
            b"\"a\":",
            b"123}",
        ] {
            client.write_all(part).unwrap();
            thread::sleep(Duration::from_millis(10));
        }
        let received = worker.join().unwrap().1;
        assert_eq!(received, b"{\"a\":123}");
        println!(
            "HTTP_MOCK_OBSERVATION:{}",
            serde_json::json!({"case": "fragmented_request", "received_body_bytes": received.len()})
        );
    }

    #[test]
    fn rejects_missing_duplicate_malformed_and_unsupported_framing() {
        for headers in [
            "POST / HTTP/1.1\r\n\r\n",
            "POST / HTTP/1.1\r\nContent-Length: 0\r\ncontent-length: 0\r\n\r\n",
            "POST / HTTP/1.1\r\nContent-Length: +3\r\n\r\n",
            "POST / HTTP/1.1\r\nContent-Length: 999999999999999999999999999999\r\n\r\n",
            "POST / HTTP/1.1\r\nTransfer-Encoding: chunked\r\nContent-Length: 0\r\n\r\n",
            "POST / HTTP/1.1\r\nnot-a-header\r\nContent-Length: 0\r\n\r\n",
        ] {
            assert_eq!(
                exchange(&[headers.as_bytes()]).unwrap_err().kind(),
                io::ErrorKind::InvalidData
            );
        }
    }

    #[test]
    fn rejects_oversized_headers_and_declared_bodies_before_allocation() {
        let headers = format!(
            "POST / HTTP/1.1\r\nX: {}\r\nContent-Length: 0\r\n\r\n",
            "x".repeat(MAX_HEADER_BYTES)
        );
        assert_eq!(
            exchange(&[headers.as_bytes()]).unwrap_err().kind(),
            io::ErrorKind::InvalidData
        );
        assert_eq!(
            exchange(&[request_headers(MAX_BODY_BYTES + 1).as_bytes()])
                .unwrap_err()
                .kind(),
            io::ErrorKind::InvalidData
        );
    }

    #[test]
    fn rejects_premature_header_and_body_eof() {
        for parts in [
            vec![b"POST / HTTP/1.1\r\nContent-Length: 3".as_slice()],
            vec![b"POST / HTTP/1.1\r\nContent-Length: 9\r\n\r\n", b"{}"],
        ] {
            assert_eq!(
                exchange(&parts).unwrap_err().kind(),
                io::ErrorKind::UnexpectedEof
            );
        }
    }

    #[test]
    fn bounds_accept_when_no_client_connects() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let started = Instant::now();
        let error = accept(&listener, started + Duration::from_millis(100)).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::TimedOut);
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn bounds_total_read_deadline_even_with_partial_progress() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let worker = thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_millis(120);
            let mut stream = accept(&listener, deadline).unwrap();
            read_request(&mut stream, deadline).unwrap_err()
        });
        let mut client = TcpStream::connect(addr).unwrap();
        client
            .set_write_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        let started = Instant::now();
        for _ in 0..20 {
            if client.write_all(b"P").is_err() {
                break;
            }
            thread::sleep(Duration::from_millis(20));
        }
        assert_eq!(worker.join().unwrap().kind(), io::ErrorKind::TimedOut);
        assert!(started.elapsed() < Duration::from_secs(5));
    }
}
