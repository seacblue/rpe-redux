//! Verifies a local signed Windows installer without launching it.
//!
//! The build's updater key is the only trust anchor; a sibling `.sig` must
//! authenticate both the installer bytes and the declared target version.
use base64::Engine;
use minisign_verify::{PublicKey, Signature};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{fs::File, io::Read, path::Path};
use tauri::AppHandle;

/// Largest accepted local installer, in bytes.
pub(crate) const MAX_INSTALLER_BYTES: u64 = 512 * 1024 * 1024;
/// Largest accepted detached signature file, in bytes.
pub(crate) const MAX_SIGNATURE_BYTES: u64 = 64 * 1024;

/// Authenticated installer metadata returned to the frontend.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalUpdateInfo {
    pub(crate) version: String,
    bytes: u64,
    sha256: String,
}

/// Decode a base64-wrapped minisign key or signature.
fn decode_text(encoded: &[u8]) -> Result<String, String> {
    let text = std::str::from_utf8(encoded).map_err(|_| "local_update_signature_invalid")?;
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(text.trim())
        .map_err(|_| "local_update_signature_invalid")?;
    String::from_utf8(decoded).map_err(|_| "local_update_signature_invalid".into())
}

/// Verify the installer signature, the embedded target version, and the PE
/// header before returning the version, size, and SHA-256.
///
/// The signature must embed a `version:` comment newer than `current`.
pub(crate) fn verify(
    installer: &[u8],
    signature: &[u8],
    key: &str,
    current: &str,
) -> Result<LocalUpdateInfo, String> {
    let version = authenticate(installer, signature, key, current)?;
    if installer.len() < 64 || &installer[..2] != b"MZ" {
        return Err("local_update_platform_invalid".into());
    }
    let offset = u32::from_le_bytes(
        installer[60..64]
            .try_into()
            .map_err(|_| "local_update_platform_invalid")?,
    ) as usize;
    let pe = installer
        .get(offset..offset.saturating_add(6))
        .ok_or("local_update_platform_invalid")?;
    // Accept the i386 and x86-64 machines. NSIS x64 installers use an x86
    // bootstrapper whose PE machine does not describe the embedded payload.
    if &pe[..4] != b"PE\0\0" || !matches!(u16::from_le_bytes([pe[4], pe[5]]), 0x014c | 0x8664) {
        return Err("local_update_platform_invalid".into());
    }
    Ok(LocalUpdateInfo {
        version,
        bytes: installer.len() as u64,
        sha256: hex::encode(Sha256::digest(installer)),
    })
}

/// Verify a signed payload that is not an installer, such as a portable ZIP.
///
/// The signature and its embedded version are checked exactly like the
/// installer path; the caller validates the payload format separately.
pub(crate) fn verify_payload(
    bytes: &[u8],
    signature: &[u8],
    key: &str,
    current: &str,
) -> Result<String, String> {
    authenticate(bytes, signature, key, current)
}

/// Authenticate a signed payload and return the version embedded in its signature.
fn authenticate(
    bytes: &[u8],
    signature: &[u8],
    key: &str,
    current: &str,
) -> Result<String, String> {
    if key.trim().is_empty() {
        return Err("local_update_key_missing".into());
    }
    let public = PublicKey::decode(&decode_text(key.trim().as_bytes())?)
        .map_err(|_| "local_update_key_invalid")?;
    let signature = Signature::decode(&decode_text(signature)?)
        .map_err(|_| "local_update_signature_invalid")?;
    public
        .verify(bytes, &signature, true)
        .map_err(|_| "local_update_signature_invalid")?;
    let version = signature
        .trusted_comment()
        .split('\t')
        .find_map(|item| item.strip_prefix("version:"))
        .ok_or("local_update_version_missing")?;
    let target = semver::Version::parse(version.trim_start_matches('v'))
        .map_err(|_| "local_update_version_invalid")?;
    let current = semver::Version::parse(current.trim_start_matches('v'))
        .map_err(|_| "local_update_version_invalid")?;
    if target <= current {
        return Err("local_update_not_newer".into());
    }
    Ok(target.to_string())
}

/// Read a regular file without exceeding `limit` bytes.
pub(crate) fn read_bounded(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    let file = File::open(path).map_err(|_| "local_update_file_missing")?;
    let metadata = file.metadata().map_err(|_| "local_update_file_missing")?;
    if !metadata.is_file() || metadata.len() > limit {
        return Err("local_update_file_invalid".into());
    }
    let mut bytes = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "local_update_file_missing")?;
    if bytes.len() as u64 > limit {
        return Err("local_update_file_invalid".into());
    }
    Ok(bytes)
}

/// Read and authenticate an installer and its adjacent signature.
pub(crate) fn load_candidate(
    path: &Path,
    key: &str,
    current: &str,
) -> Result<(LocalUpdateInfo, Vec<u8>, Vec<u8>), String> {
    if key.trim().is_empty() {
        return Err("local_update_key_missing".into());
    }
    if !path.is_absolute()
        || !path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("exe"))
    {
        return Err("local_update_file_invalid".into());
    }
    let mut signature = path.as_os_str().to_os_string();
    signature.push(".sig");
    let bytes = read_bounded(path, MAX_INSTALLER_BYTES)?;
    let sig = read_bounded(Path::new(&signature), MAX_SIGNATURE_BYTES)?;
    let info = verify(&bytes, &sig, key, current)?;
    Ok((info, bytes, sig))
}

/// Check a selected installer and its adjacent detached signature; never executes either.
#[tauri::command]
pub async fn verify_local_update(
    app: AppHandle,
    token: tauri::State<'_, crate::app::ipc_guard::HostToken>,
    request: tauri::ipc::Request<'_>,
    path: String,
) -> Result<LocalUpdateInfo, String> {
    crate::app::ipc_guard::HostToken::require(token.inner(), request.headers())?;
    tauri::async_runtime::spawn_blocking(move || {
        load_candidate(
            Path::new(&path),
            crate::update::updater::UPDATE_PUBLIC_KEY,
            &app.package_info().version.to_string(),
        )
        .map(|(info, _, _)| info)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    // The fixture is a synthetic PE header signed only with a disposable test key.
    const KEY: &str = include_str!("../../../src/test/fixtures/signed-update/test-public.key");
    const FILE: &[u8] =
        include_bytes!("../../../src/test/fixtures/signed-update/installer.fixture");
    const SIGNATURE: &[u8] =
        include_bytes!("../../../src/test/fixtures/signed-update/installer.fixture.sig");
    const X86: &[u8] =
        include_bytes!("../../../src/test/fixtures/signed-update/x86-installer.fixture");
    const X86_SIGNATURE: &[u8] =
        include_bytes!("../../../src/test/fixtures/signed-update/x86-installer.fixture.sig");
    const WRONG: &[u8] =
        include_bytes!("../../../src/test/fixtures/signed-update/wrong-architecture.fixture");
    const WRONG_SIGNATURE: &[u8] =
        include_bytes!("../../../src/test/fixtures/signed-update/wrong-architecture.fixture.sig");

    #[test]
    fn authenticates_local_installer_version_and_windows_stub() {
        let result = verify(FILE, SIGNATURE, KEY, "1.0.0").unwrap();
        assert_eq!(result.version, "2.0.0");
        assert_eq!(result.bytes, FILE.len() as u64);
        assert_eq!(
            verify(X86, X86_SIGNATURE, KEY, "1.0.0").unwrap().version,
            "2.0.0"
        );
        assert_eq!(
            verify(FILE, SIGNATURE, KEY, "2.0.0").err().unwrap(),
            "local_update_not_newer"
        );
        assert_eq!(
            verify(WRONG, WRONG_SIGNATURE, KEY, "1.0.0").err().unwrap(),
            "local_update_platform_invalid"
        );
        let mut changed = FILE.to_vec();
        changed[200] ^= 1;
        assert_eq!(
            verify(&changed, SIGNATURE, KEY, "1.0.0").err().unwrap(),
            "local_update_signature_invalid"
        );
        assert_eq!(
            verify(FILE, SIGNATURE, "", "1.0.0").err().unwrap(),
            "local_update_key_missing"
        );
    }
}
