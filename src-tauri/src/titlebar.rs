//! Colors the native Windows 11 title bar to match the app theme, using the
//! DWM caption/text/border color attributes. Older Windows versions ignore
//! these attributes, and other platforms do nothing.

/// Parses `#rrggbb` into a Windows COLORREF (0x00BBGGRR).
fn colorref(hex: &str) -> Result<u32, String> {
    let h = hex.trim().trim_start_matches('#');
    if h.len() != 6 {
        return Err(format!("Expected a #rrggbb color, got \"{hex}\""));
    }
    let v = u32::from_str_radix(h, 16).map_err(|_| format!("Invalid color \"{hex}\""))?;
    let (r, g, b) = ((v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff);
    Ok(r | (g << 8) | (b << 16))
}

#[cfg(windows)]
mod dwm {
    use std::ffi::c_void;

    pub const USE_IMMERSIVE_DARK_MODE: u32 = 20;
    pub const BORDER_COLOR: u32 = 34;
    pub const CAPTION_COLOR: u32 = 35;
    pub const TEXT_COLOR: u32 = 36;

    #[link(name = "dwmapi")]
    unsafe extern "system" {
        fn DwmSetWindowAttribute(hwnd: *mut c_void, attribute: u32, value: *const c_void, size: u32) -> i32;
    }

    pub fn set_u32(hwnd: *mut c_void, attribute: u32, value: u32) -> Result<(), String> {
        let hr = unsafe {
            DwmSetWindowAttribute(hwnd, attribute, &value as *const u32 as *const c_void, std::mem::size_of::<u32>() as u32)
        };
        if hr < 0 {
            Err(format!("DwmSetWindowAttribute({attribute}) failed: 0x{:08x}", hr as u32))
        } else {
            Ok(())
        }
    }
}

/// Sets the title bar background (`caption`), title text and window border
/// colors. `dark` switches the minimize/maximize/close glyphs to light-on-dark.
#[tauri::command]
pub fn set_titlebar_colors(
    window: tauri::WebviewWindow,
    caption: String,
    text: String,
    border: String,
    dark: bool,
) -> Result<(), String> {
    let (caption, text, border) = (colorref(&caption)?, colorref(&text)?, colorref(&border)?);
    #[cfg(windows)]
    {
        let hwnd = window.hwnd().map_err(|e| e.to_string())?.0;
        dwm::set_u32(hwnd, dwm::USE_IMMERSIVE_DARK_MODE, dark as u32)?;
        dwm::set_u32(hwnd, dwm::CAPTION_COLOR, caption)?;
        dwm::set_u32(hwnd, dwm::TEXT_COLOR, text)?;
        dwm::set_u32(hwnd, dwm::BORDER_COLOR, border)?;
    }
    #[cfg(not(windows))]
    let _ = (window, caption, text, border, dark);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::colorref;

    #[test]
    fn converts_to_bgr() {
        assert_eq!(colorref("#131518").unwrap(), 0x181513);
        assert_eq!(colorref("ff0000").unwrap(), 0x0000ff);
        assert!(colorref("#fff").is_err());
        assert!(colorref("#gggggg").is_err());
    }
}
