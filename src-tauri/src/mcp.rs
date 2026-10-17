//! Local MCP (Model Context Protocol) endpoint.
//!
//! This module is only the transport: a small HTTP server on 127.0.0.1 that
//! accepts MCP "Streamable HTTP" POSTs, checks the Host/Origin (and the bearer
//! token, when one is required), and forwards
//! each JSON-RPC message to the frontend as an `mcp-request` event. The
//! frontend (`src/mcp/handler.ts`) runs the request against the live document
//! and answers through the `mcp_respond` command.

use std::collections::HashMap;
use std::io::Read;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Emitter, State};
use tiny_http::{Header, Method, Request, Response, Server};

const MAX_BODY_BYTES: u64 = 16 * 1024 * 1024;
const RESPONSE_TIMEOUT: Duration = Duration::from_secs(60);

type Pending = Arc<Mutex<HashMap<u64, mpsc::Sender<String>>>>;

#[derive(Default)]
pub struct McpState {
    server: Mutex<Option<Arc<Server>>>,
    pending: Pending,
    next_id: Arc<AtomicU64>,
}

#[derive(Clone, serde::Serialize)]
struct McpRequestEvent {
    id: u64,
    body: String,
}

/// Starts (or restarts) the endpoint at `http://127.0.0.1:<port>/mcp`.
/// With `token` set, requests must send `Authorization: Bearer <token>`;
/// with `None`, any local program may connect.
#[tauri::command]
pub fn mcp_start(app: AppHandle, state: State<McpState>, port: u16, token: Option<String>) -> Result<(), String> {
    stop(&state);
    if token.as_ref().is_some_and(|t| t.len() < 16) {
        return Err("The access token is too short.".into());
    }
    let server = Server::http(("127.0.0.1", port))
        .map_err(|e| format!("Could not listen on 127.0.0.1:{port}: {e}"))?;
    let server = Arc::new(server);
    let listener = server.clone();
    let pending = state.pending.clone();
    let next_id = state.next_id.clone();
    thread::spawn(move || {
        for request in listener.incoming_requests() {
            let app = app.clone();
            let pending = pending.clone();
            let next_id = next_id.clone();
            let token = token.clone();
            thread::spawn(move || handle(request, &app, &pending, &next_id, token.as_deref()));
        }
    });
    *state.server.lock().unwrap() = Some(server);
    Ok(())
}

#[tauri::command]
pub fn mcp_stop(state: State<McpState>) {
    stop(&state);
}

/// The frontend's answer to an `mcp-request` event. An empty string means
/// "no response body" (the message was a notification).
#[tauri::command]
pub fn mcp_respond(state: State<McpState>, id: u64, response: String) {
    if let Some(tx) = state.pending.lock().unwrap().remove(&id) {
        let _ = tx.send(response);
    }
}

fn stop(state: &McpState) {
    if let Some(server) = state.server.lock().unwrap().take() {
        server.unblock();
    }
}

fn header(request: &Request, name: &'static str) -> Option<String> {
    request
        .headers()
        .iter()
        .find(|h| h.field.equiv(name))
        .map(|h| h.value.as_str().to_string())
}

fn reply(request: Request, status: u16, body: &str, json: bool) {
    let content_type = if json { "application/json" } else { "text/plain; charset=utf-8" };
    let response = Response::from_string(body)
        .with_status_code(status)
        .with_header(Header::from_bytes("Content-Type", content_type).unwrap());
    let _ = request.respond(response);
}

/// Browsers send an Origin header; only allow local pages so a website
/// cannot drive the endpoint (DNS-rebinding protection).
fn origin_allowed(origin: &str) -> bool {
    let o = origin.to_ascii_lowercase();
    o == "null"
        || o.starts_with("http://127.0.0.1")
        || o.starts_with("http://localhost")
        || o.starts_with("tauri://")
        || o.starts_with("http://tauri.localhost")
}

/// The Host header must name this machine. A web page using DNS rebinding
/// reaches us under its own domain name, so this rejects it even without a token.
fn host_allowed(host: &str) -> bool {
    let h = host.to_ascii_lowercase();
    let name = h.rsplit_once(':').map_or(h.as_str(), |(n, _)| n);
    matches!(name, "127.0.0.1" | "localhost" | "[::1]")
}

fn handle(mut request: Request, app: &AppHandle, pending: &Pending, next_id: &AtomicU64, token: Option<&str>) {
    let path = request.url().split('?').next().unwrap_or("").to_string();
    if path != "/mcp" {
        return reply(request, 404, "Not found. The MCP endpoint is /mcp.", false);
    }
    if !header(&request, "Host").is_some_and(|h| host_allowed(&h)) {
        return reply(request, 403, "Host not allowed.", false);
    }
    if let Some(origin) = header(&request, "Origin") {
        if !origin_allowed(&origin) {
            return reply(request, 403, "Origin not allowed.", false);
        }
    }
    if let Some(token) = token {
        let expected = format!("Bearer {token}");
        if header(&request, "Authorization").as_deref() != Some(expected.as_str()) {
            return reply(request, 401, "Missing or invalid access token.", false);
        }
    }
    match request.method() {
        Method::Post => {}
        Method::Get | Method::Delete => {
            // No server-initiated stream and no sessions.
            let response = Response::from_string("Method not allowed")
                .with_status_code(405)
                .with_header(Header::from_bytes("Allow", "POST").unwrap());
            let _ = request.respond(response);
            return;
        }
        _ => return reply(request, 405, "Method not allowed", false),
    }

    let mut body = String::new();
    if request
        .as_reader()
        .take(MAX_BODY_BYTES)
        .read_to_string(&mut body)
        .is_err()
    {
        return reply(request, 400, "Request body must be UTF-8 JSON.", false);
    }

    let id = next_id.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = mpsc::channel();
    pending.lock().unwrap().insert(id, tx);
    if app.emit("mcp-request", McpRequestEvent { id, body }).is_err() {
        pending.lock().unwrap().remove(&id);
        return reply(request, 503, "GDDesigner is not ready.", false);
    }

    match rx.recv_timeout(RESPONSE_TIMEOUT) {
        Ok(response) if response.is_empty() => {
            let _ = request.respond(Response::empty(202));
        }
        Ok(response) => reply(request, 200, &response, true),
        Err(_) => {
            pending.lock().unwrap().remove(&id);
            reply(request, 504, "GDDesigner did not answer in time.", false);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{host_allowed, origin_allowed};

    #[test]
    fn hosts() {
        assert!(host_allowed("127.0.0.1:3917"));
        assert!(host_allowed("localhost:3917"));
        assert!(host_allowed("LOCALHOST"));
        assert!(host_allowed("[::1]:3917"));
        assert!(!host_allowed("evil.example:3917"));
        assert!(!host_allowed("127.0.0.1.evil.example"));
    }

    #[test]
    fn origins() {
        assert!(origin_allowed("http://localhost:1420"));
        assert!(origin_allowed("tauri://localhost"));
        assert!(!origin_allowed("https://evil.example"));
    }
}
