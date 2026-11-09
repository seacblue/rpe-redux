//! Local LAN bridge for the collaboration room.
//!
//! The embedded Go room server stays loopback-only on its configured port. This
//! module exposes the same WebSocket endpoint on a configurable interface so
//! guests on the same LAN, or a user-managed tunnel/port forward, can reach it.
//! The bridge is a byte-level TCP forwarder; it never interprets room messages.

use std::{
    collections::HashMap,
    io,
    net::{IpAddr, Shutdown, TcpListener, TcpStream, UdpSocket},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::Duration,
};

use tauri::{AppHandle, Manager};

/// Idle wait between non-blocking accept polls.
const ACCEPT_POLL: Duration = Duration::from_millis(80);

/// Monotonic id used to track relayed clients.
static NEXT_CLIENT: AtomicU64 = AtomicU64::new(1);

/// A running listener with its stop flag, clients, and accept thread.
struct Bridge {
    port: u16,
    url: String,
    stop: Arc<AtomicBool>,
    clients: Arc<Mutex<HashMap<u64, TcpStream>>>,
    handle: JoinHandle<()>,
}

/// Managed owner for the optional LAN listener.
#[derive(Default)]
pub struct LanBridge {
    inner: Mutex<Option<Bridge>>,
}

/// Signal the accept loop, close every client, and wait for the listener thread.
fn stop_bridge(bridge: Bridge) {
    bridge.stop.store(true, Ordering::SeqCst);
    if let Ok(clients) = bridge.clients.lock() {
        for stream in clients.values() {
            let _ = stream.shutdown(Shutdown::Both);
        }
    }
    let _ = bridge.handle.join();
}

/// Whether an address is a private or link-local IPv4 address.
fn private_ipv4(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(address) => address.is_private() || address.is_link_local(),
        IpAddr::V6(_) => false,
    }
}

/// Return the best local IPv4 address for a LAN invitation.
///
/// Public and private broadcast destinations are both probed so an isolated LAN
/// still resolves a route; a private address is preferred over a public one.
fn local_ip() -> Result<String, String> {
    let targets = [
        "8.8.8.8:80",
        "1.1.1.1:80",
        "192.168.255.255:9",
        "10.255.255.255:9",
        "172.31.255.255:9",
    ];
    let mut fallback: Option<IpAddr> = None;
    for target in targets {
        let Ok(socket) = UdpSocket::bind("0.0.0.0:0") else {
            continue;
        };
        // Private probes use broadcast addresses, which require SO_BROADCAST
        // even though connect only performs a route lookup.
        let _ = socket.set_broadcast(true);
        if socket.connect(target).is_err() {
            continue;
        }
        let Ok(address) = socket.local_addr() else {
            continue;
        };
        let ip = address.ip();
        if ip.is_loopback() {
            continue;
        }
        if private_ipv4(ip) {
            return Ok(ip.to_string());
        }
        fallback.get_or_insert(ip);
    }
    fallback
        .map(|ip| ip.to_string())
        .ok_or_else(|| "No LAN address is available. Connect to a network first.".to_string())
}

/// Copy bytes both ways between one guest and the room server.
fn relay(client: TcpStream, upstream: TcpStream) {
    let (Ok(client_read), Ok(upstream_write)) = (client.try_clone(), upstream.try_clone()) else {
        return;
    };
    let client_to_room = thread::spawn(move || {
        let mut source = client_read;
        let mut target = upstream_write;
        let _ = io::copy(&mut source, &mut target);
        let _ = target.shutdown(Shutdown::Write);
    });
    let mut source = upstream;
    let mut target = client;
    let _ = io::copy(&mut source, &mut target);
    let _ = target.shutdown(Shutdown::Write);
    let _ = client_to_room.join();
}

/// Accept guests until `stop` is set, relaying each to the room server.
fn accept_loop(
    listener: TcpListener,
    stop: Arc<AtomicBool>,
    clients: Arc<Mutex<HashMap<u64, TcpStream>>>,
    room_origin: String,
) {
    while !stop.load(Ordering::SeqCst) {
        match listener.accept() {
            Ok((client, _)) => {
                let Ok(upstream) = TcpStream::connect(&room_origin) else {
                    continue;
                };
                // Force blocking sockets so both copy directions run to completion.
                let _ = client.set_nonblocking(false);
                let _ = upstream.set_nonblocking(false);
                let Ok(watch) = client.try_clone() else {
                    continue;
                };
                let id = NEXT_CLIENT.fetch_add(1, Ordering::Relaxed);
                if let Ok(mut entries) = clients.lock() {
                    entries.insert(id, watch);
                }
                let owned = clients.clone();
                thread::spawn(move || {
                    relay(client, upstream);
                    if let Ok(mut entries) = owned.lock() {
                        entries.remove(&id);
                    }
                });
            }
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                thread::sleep(ACCEPT_POLL);
            }
            Err(_) => break,
        }
    }
}

/// Start (or reuse) the LAN bridge and return the address guests should use.
#[tauri::command]
pub fn start_lan_bridge(app: AppHandle, port: u16) -> Result<String, String> {
    let ports = crate::services::server::read_runtime_ports(app.clone())?;
    if port < 1024 || port == ports.backend_port || port == ports.collab_port {
        return Err(format!(
            "Choose a port between 1024 and 65535; {} and {} are reserved.",
            ports.backend_port, ports.collab_port
        ));
    }
    let room_origin = format!("127.0.0.1:{}", ports.collab_port);
    let state = app.state::<LanBridge>();
    let mut guard = state.inner.lock().map_err(|error| error.to_string())?;
    if let Some(current) = guard.as_ref() {
        if current.port == port {
            return Ok(current.url.clone());
        }
    }
    if let Some(previous) = guard.take() {
        stop_bridge(previous);
    }
    let listener = TcpListener::bind(("0.0.0.0", port))
        .map_err(|error| format!("Could not listen on LAN port {port}: {error}"))?;
    listener
        .set_nonblocking(true)
        .map_err(|error| format!("Could not prepare LAN port {port}: {error}"))?;
    let ip = local_ip()?;
    let url = format!("ws://{ip}:{port}");
    let stop = Arc::new(AtomicBool::new(false));
    let clients = Arc::new(Mutex::new(HashMap::new()));
    let handle = {
        let stop = stop.clone();
        let clients = clients.clone();
        thread::spawn(move || accept_loop(listener, stop, clients, room_origin))
    };
    *guard = Some(Bridge {
        port,
        url: url.clone(),
        stop,
        clients,
        handle,
    });
    Ok(url)
}

/// Stop the LAN bridge and close every active guest connection.
#[tauri::command]
pub fn stop_lan_bridge(app: AppHandle) {
    if let Some(state) = app.try_state::<LanBridge>() {
        if let Ok(mut guard) = state.inner.lock() {
            if let Some(bridge) = guard.take() {
                stop_bridge(bridge);
            }
        }
    }
}

impl Drop for LanBridge {
    fn drop(&mut self) {
        if let Ok(guard) = self.inner.get_mut() {
            if let Some(bridge) = guard.take() {
                stop_bridge(bridge);
            }
        }
    }
}
