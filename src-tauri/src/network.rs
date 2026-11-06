//! Reports cost-aware desktop network state for bandwidth-sensitive tasks.
//!
//! Windows exposes the adapter interface type and operational state through
//! `GetAdaptersAddresses`. Linux prefers NetworkManager's metered state, then
//! the XDG NetworkMonitor portal, and finally `nmcli` for a connection-type
//! fallback. The frontend never inspects network names or addresses.

use serde::Serialize;

/// The host-level network facts used by automatic update-download policy.
#[derive(Debug, Serialize)]
pub struct NetworkStatus {
    /// The best available connection-type classification.
    pub kind: String,
    /// Whether a default route is available for traffic.
    pub available: bool,
    /// `Some(true)` or `Some(false)` when the host reports cost; `None` means
    /// the caller must use the connection type as a conservative fallback.
    pub metered: Option<bool>,
}

/// Return the best available network facts for automatic downloads.
#[tauri::command]
pub fn network_connection_status() -> NetworkStatus {
    #[cfg(windows)]
    {
        return windows_network_status();
    }
    #[cfg(target_os = "linux")]
    {
        return linux_network_status();
    }
    #[cfg(not(any(windows, target_os = "linux")))]
    {
        NetworkStatus::unknown()
    }
}

impl NetworkStatus {
    /// Build the fail-closed result used when no supported host signal exists.
    fn unknown() -> Self {
        Self {
            kind: "unknown".to_owned(),
            available: false,
            metered: None,
        }
    }
}

#[cfg(windows)]
fn windows_network_status() -> NetworkStatus {
    use std::mem::size_of;
    use windows_sys::Win32::Foundation::ERROR_BUFFER_OVERFLOW;
    use windows_sys::Win32::NetworkManagement::IpHelper::{
        GetAdaptersAddresses, GAA_FLAG_INCLUDE_PREFIX, IF_TYPE_ETHERNET_CSMACD, IF_TYPE_IEEE80211,
        IF_TYPE_WWANPP, IF_TYPE_WWANPP2, IP_ADAPTER_ADDRESSES_LH,
    };
    use windows_sys::Win32::NetworkManagement::Ndis::NET_IF_OPER_STATUS_UP;
    use windows_sys::Win32::Networking::WinSock::AF_UNSPEC;

    let mut size = 15_000u32;
    loop {
        let count = (size as usize).div_ceil(size_of::<IP_ADAPTER_ADDRESSES_LH>());
        let mut adapters = vec![IP_ADAPTER_ADDRESSES_LH::default(); count.max(1)];
        let result = unsafe {
            GetAdaptersAddresses(
                AF_UNSPEC as u32,
                GAA_FLAG_INCLUDE_PREFIX,
                std::ptr::null(),
                adapters.as_mut_ptr(),
                &mut size,
            )
        };
        if result == ERROR_BUFFER_OVERFLOW {
            continue;
        }
        if result != 0 {
            return NetworkStatus::unknown();
        }

        let mut current = adapters.as_ptr();
        let mut has_cellular = false;
        let mut has_ethernet = false;
        while !current.is_null() {
            let adapter = unsafe { &*current };
            if adapter.OperStatus == NET_IF_OPER_STATUS_UP {
                match adapter.IfType {
                    IF_TYPE_IEEE80211 => {
                        return NetworkStatus {
                            kind: "wifi".to_owned(),
                            available: true,
                            metered: None,
                        };
                    }
                    IF_TYPE_WWANPP | IF_TYPE_WWANPP2 => has_cellular = true,
                    IF_TYPE_ETHERNET_CSMACD => has_ethernet = true,
                    _ => {}
                }
            }
            current = adapter.Next;
        }
        let kind = if has_cellular {
            "cellular"
        } else if has_ethernet {
            "ethernet"
        } else {
            "offline"
        };
        return NetworkStatus {
            kind: kind.to_owned(),
            available: kind != "offline",
            metered: None,
        };
    }
}

#[cfg(target_os = "linux")]
fn linux_network_status() -> NetworkStatus {
    if let Some(mut status) = network_manager_status() {
        if status.available && status.metered.is_none() && status.kind == "other" {
            if let Some(fallback) = nmcli_network_status() {
                status.kind = fallback.kind;
            }
        }
        return status;
    }
    if let Some(status) = portal_network_status() {
        return status;
    }
    nmcli_network_status().unwrap_or_else(NetworkStatus::unknown)
}

#[cfg(target_os = "linux")]
fn network_manager_status() -> Option<NetworkStatus> {
    let metered = busctl_property(
        false,
        "org.freedesktop.NetworkManager",
        "/org/freedesktop/NetworkManager",
        "org.freedesktop.NetworkManager",
        "Metered",
    )
    .and_then(parse_metered);
    let state = busctl_property(
        false,
        "org.freedesktop.NetworkManager",
        "/org/freedesktop/NetworkManager",
        "org.freedesktop.NetworkManager",
        "State",
    )
    .and_then(parse_u32);
    let primary = busctl_property(
        false,
        "org.freedesktop.NetworkManager",
        "/org/freedesktop/NetworkManager",
        "org.freedesktop.NetworkManager",
        "PrimaryConnection",
    )
    .and_then(parse_object_path)
    .filter(|path| path != "/");
    let kind = primary
        .as_deref()
        .and_then(|path| {
            busctl_property(
                false,
                "org.freedesktop.NetworkManager",
                path,
                "org.freedesktop.NetworkManager.Connection.Active",
                "Type",
            )
        })
        .map(|value| network_manager_type(&value))
        .unwrap_or("unknown");
    let available = state.map(|value| value >= 50).unwrap_or(primary.is_some());

    if metered.is_none() && state.is_none() && primary.is_none() {
        return None;
    }
    Some(NetworkStatus {
        kind: if available && kind == "unknown" {
            "other"
        } else if available {
            kind
        } else {
            "offline"
        }
        .to_owned(),
        available,
        metered,
    })
}

#[cfg(target_os = "linux")]
fn portal_network_status() -> Option<NetworkStatus> {
    let available = busctl_call_bool(
        true,
        "org.freedesktop.portal.Desktop",
        "/org/freedesktop/portal/desktop",
        "org.freedesktop.portal.NetworkMonitor",
        "GetAvailable",
    );
    let metered = busctl_call_bool(
        true,
        "org.freedesktop.portal.Desktop",
        "/org/freedesktop/portal/desktop",
        "GetMetered",
    );
    if available.is_none() && metered.is_none() {
        return None;
    }
    let online = available.unwrap_or(true);
    Some(NetworkStatus {
        kind: if online { "unknown" } else { "offline" }.to_owned(),
        available: online,
        metered,
    })
}

#[cfg(target_os = "linux")]
fn nmcli_network_status() -> Option<NetworkStatus> {
    let output = std::process::Command::new("nmcli")
        .args(["-t", "-f", "DEVICE,TYPE,STATE", "device"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8(output.stdout).ok()?;
    let mut kind = None;
    for line in text.lines() {
        let mut fields = line.splitn(3, ':');
        let _device = fields.next();
        let device_type = fields.next();
        let state = fields.next();
        if state.is_some_and(|value| value.starts_with("connected")) {
            kind = device_type.and_then(nmcli_type);
            if kind == Some("wifi") {
                break;
            }
        }
    }
    let kind = kind?;
    Some(NetworkStatus {
        kind: kind.to_owned(),
        available: true,
        metered: None,
    })
}

#[cfg(target_os = "linux")]
fn busctl_property(
    user_bus: bool,
    service: &str,
    path: &str,
    interface: &str,
    property: &str,
) -> Option<String> {
    let mut args = vec!["get-property", service, path, interface, property];
    if user_bus {
        args.insert(0, "--user");
    }
    run_busctl(args)
}

#[cfg(target_os = "linux")]
fn busctl_call_bool(
    user_bus: bool,
    service: &str,
    path: &str,
    interface: &str,
    method: &str,
) -> Option<bool> {
    let mut args = vec!["call", service, path, interface, method];
    if user_bus {
        args.insert(0, "--user");
    }
    run_busctl(args).and_then(|value| value.split_whitespace().last().and_then(parse_bool))
}

#[cfg(target_os = "linux")]
fn run_busctl(args: Vec<&str>) -> Option<String> {
    let output = std::process::Command::new("busctl")
        .args(args)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8(output.stdout).ok()
}

#[cfg(target_os = "linux")]
fn parse_u32(value: &str) -> Option<u32> {
    value.split_whitespace().last()?.parse().ok()
}

#[cfg(target_os = "linux")]
fn parse_bool(value: &str) -> Option<bool> {
    match value.trim() {
        "true" => Some(true),
        "false" => Some(false),
        _ => None,
    }
}

#[cfg(target_os = "linux")]
fn parse_metered(value: &str) -> Option<bool> {
    match parse_u32(value)? {
        1 | 3 => Some(true),
        2 | 4 => Some(false),
        _ => None,
    }
}

#[cfg(target_os = "linux")]
fn parse_object_path(value: &str) -> Option<String> {
    value.split_whitespace().last().map(str::to_owned)
}

#[cfg(target_os = "linux")]
fn network_manager_type(value: &str) -> &'static str {
    let value = value.split('"').nth(1).unwrap_or(value).trim_matches('"');
    match value {
        "802-11-wireless" | "wifi" => "wifi",
        "802-3-ethernet" | "ethernet" => "ethernet",
        "gsm" | "cdma" | "wwan" => "cellular",
        _ => "other",
    }
}

#[cfg(target_os = "linux")]
fn nmcli_type(value: &str) -> Option<&'static str> {
    match value {
        "wifi" => Some("wifi"),
        "ethernet" => Some("ethernet"),
        "gsm" | "cdma" => Some("cellular"),
        "bluetooth" | "vpn" | "tun" | "bridge" => Some("other"),
        _ => None,
    }
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::{network_manager_type, nmcli_type, parse_metered, parse_object_path, parse_u32};

    #[test]
    fn parses_network_manager_metered_values_conservatively() {
        assert_eq!(parse_metered("u 2"), Some(false));
        assert_eq!(parse_metered("u 1"), Some(true));
        assert_eq!(parse_metered("u 3"), Some(true));
        assert_eq!(parse_metered("u 4"), Some(false));
        assert_eq!(parse_metered("u 0"), None);
    }

    #[test]
    fn parses_busctl_values() {
        assert_eq!(parse_u32("u 70"), Some(70));
        assert_eq!(
            parse_object_path("o /org/freedesktop/NetworkManager/ActiveConnection/1"),
            Some("/org/freedesktop/NetworkManager/ActiveConnection/1".to_owned())
        );
    }

    #[test]
    fn maps_linux_connection_types() {
        assert_eq!(network_manager_type("s \"802-11-wireless\""), "wifi");
        assert_eq!(network_manager_type("s \"802-3-ethernet\""), "ethernet");
        assert_eq!(nmcli_type("gsm"), Some("cellular"));
        assert_eq!(nmcli_type("loopback"), None);
    }
}
