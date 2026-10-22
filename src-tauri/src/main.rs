// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(target_os = "linux")]
mod linux_gtk;

fn main() {
    #[cfg(target_os = "linux")]
    {
        for variable in ["GTK_MODULES", "GTK3_MODULES"] {
            if let Some(filtered) = std::env::var_os(variable)
                .as_deref()
                .and_then(linux_gtk::without_appmenu_module)
            {
                unsafe { std::env::set_var(variable, filtered) };
            }
        }

        // The dashboard does not need accelerated compositing, which retains
        // substantial VRAM even while idle. Set the default before WebKit starts.
        if std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_none()
            && std::env::var_os("WEBKIT_FORCE_COMPOSITING_MODE").is_none()
        {
            unsafe { std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1") };
        }

        // Newer WebKit can still allocate GPU painting resources unless the
        // DMA-BUF renderer is disabled before the webview is created.
        if std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").as_deref()
            == Some(std::ffi::OsStr::new("1"))
            && std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none()
        {
            unsafe { std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1") };
        }
    }

    codex_switcher_lib::run()
}
