//! `rperedux://` links for charts and collaboration rooms.
//!
//! Windows registers the scheme under HKCU on every launch, so both installed
//! and portable copies work without an installer step. The URL is kept as a
//! pending value until the frontend is ready.

use std::sync::Mutex;
use tauri::State;

/// Scheme URL received before the frontend asks for it.
#[derive(Default)]
pub struct PendingDeepLink(pub Mutex<Option<String>>);

/// Return the first `rperedux://` argument from a process invocation.
pub fn deep_link_from_args<I>(args: I) -> Option<String>
where
    I: IntoIterator<Item = String>,
{
    args.into_iter().find(|argument| {
        argument
            .get(..11)
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case("rperedux://"))
    })
}

/// Register the scheme through `reg.exe`, which needs no direct registry handle.
#[cfg(windows)]
fn register_with_reg_exe(executable: &str) -> std::io::Result<()> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let root = r"HKCU\Software\Classes\rperedux";
    let entries = [
        (root.to_owned(), None, "URL:RPE Redux link".to_owned()),
        (root.to_owned(), Some("URL Protocol"), String::new()),
        (
            format!(r"{root}\DefaultIcon"),
            None,
            format!("\"{executable}\",0"),
        ),
        (
            format!(r"{root}\shell\open\command"),
            None,
            format!("\"{executable}\" \"%1\""),
        ),
    ];
    for (key, name, value) in entries {
        let mut command = Command::new("reg");
        command.args(["add", &key]);
        if let Some(name) = name {
            command.args(["/v", name]);
        } else {
            command.arg("/ve");
        }
        let output = command
            .args(["/d", &value, "/f"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()?;
        if !output.status.success() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::Other,
                String::from_utf8_lossy(&output.stderr).trim().to_owned(),
            ));
        }
    }
    Ok(())
}

/// Register the custom scheme for the current executable. Windows only; other
/// hosts keep the paste-link path in the room dialog.
pub fn register() {
    #[cfg(windows)]
    {
        use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, KEY_WRITE};
        use winreg::RegKey;

        let Ok(executable) = std::env::current_exe() else {
            return;
        };
        let executable = executable.display().to_string();
        let result = (|| -> std::io::Result<()> {
            let classes = RegKey::predef(HKEY_CURRENT_USER);
            // Key creation asks only for the access the scheme needs.
            let permissions = KEY_READ | KEY_WRITE;
            let (root, _) =
                classes.create_subkey_with_flags(r"Software\Classes\rperedux", permissions)?;
            root.set_value("", &"URL:RPE Redux link")?;
            root.set_value("URL Protocol", &"")?;
            let (icon, _) = root.create_subkey_with_flags("DefaultIcon", permissions)?;
            icon.set_value("", &format!("\"{executable}\",0"))?;
            let (command, _) = root.create_subkey_with_flags(r"shell\open\command", permissions)?;
            command.set_value("", &format!("\"{executable}\" \"%1\""))?;
            Ok(())
        })();
        if let Err(error) = result {
            if let Err(fallback) = register_with_reg_exe(&executable) {
                eprintln!("URI registration failed: {error}; fallback: {fallback}");
            }
        }
    }
}

/// Consume the launch link once the frontend resolves its boot route.
#[tauri::command]
pub fn take_deep_link(state: State<'_, PendingDeepLink>) -> Option<String> {
    state.0.lock().ok().and_then(|mut pending| pending.take())
}

#[cfg(test)]
mod tests {
    use super::deep_link_from_args;

    #[test]
    fn picks_the_first_scheme_argument_case_insensitively() {
        let args = vec![
            "rperedux.exe".to_owned(),
            "RPERedux://chart/abc".to_owned(),
            "rperedux://join?server=x".to_owned(),
        ];
        assert_eq!(
            deep_link_from_args(args).as_deref(),
            Some("RPERedux://chart/abc")
        );
    }

    #[test]
    fn ignores_plain_paths_and_other_schemes() {
        let args = vec![
            "app.exe".to_owned(),
            "https://example.test/chart/abc".to_owned(),
        ];
        assert_eq!(deep_link_from_args(args), None);
    }
}
