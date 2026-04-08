# Windows 9 UI Simulator

A faithful recreation of **Windows 9** — the OS that never officially shipped — built in Electron.

## What is Windows 9?

Microsoft never released a product called Windows 9. After Windows 8.1, the company skipped straight to Windows 10. But in the period between them — roughly 2013 through early 2015 — there existed a genuinely fascinating transitional era: internal technical previews, alpha-stage UI experiments, leaked builds, and partial prototypes that showed exactly where Windows was heading before the pivot to 10. That gap has a name in enthusiast circles, and this project fills it: **Windows 9**.

This simulator is built from years of personally studying those builds, early screenshots, and design artifacts — long before any of it was fed to an AI. It treats that era as its own generation of Windows and asks: *what would a finished version have looked like?*

Where original builds were unfinished, incomplete, or only existed as early/alpha/preview material, this project applies creative polish — faithful to the design language and spirit of the era, but filled in where Microsoft never had the chance. The Metro/Modern design system, Charms, the Start screen, taskbar, shell transitions, and notification surfaces are all rendered to a level of completeness the real previews never reached.

The goal is simple: sit down at this and feel like you're running the version of Windows 9 that could have shipped.

## Feature Highlights
- **Boot-to-Desktop pipeline** – Boot splash, lock screen slide-up, user picker, signing-in animation, and Start transition mirror the original sequence in `index.html`/`app.js`.
- **Modern Start screen** – Tile grid, All Apps view, resize/context menus, personalization patterns, and metro transitions are rendered from `apps.json` and managed by `apps-manager.js`, `tile-drag.js`, and `wallpaper-color.js`.
- **Desktop & taskbar** – Auto-hide, height tiers, lock state, Win+X quick links, Taskbar and Navigation CPL, and drag-to-reorder pinned apps are driven from `app.js`, `taskbar-drag.js`, and `taskbar-item-context-menu.js`.
- **Charms & Settings flyouts** – Edge triggers, charms icons, Settings charm sub-panels (main, Personalize, Tiles), power menu, and contextual controls live in `app.js` with styling in `css/charms.css` and `css/modern-ui.css`.
- **Notifications & sounds** – Windows 9 toast visuals, device connect/disconnect toasts, and authentic sound set powered by `components/notification`, `components/system_sounds`, and USB monitoring in `components/device_connectivity`.
- **System integrations** – Volume, network, and battery tray icons hook into the host OS via IPC (`components/volume`, `components/network`, `components/battery`) with Electron main-process helpers for native data.

## Windows-Accurate Experiences (1:1)
- **Boot & lock visuals** – Same logo animation, spinner timing, and lock-screen slide/keyboard unlock (`index.html`, `app.js`).
- **Start tile grammar** – Tile sizes, spacing, snap-to-rows behaviour, context menu text, and All Apps categorisation mimic Windows 9 (see `apps.json`, `tile-drag.js`, `css/start.css`).
- **Settings charm** – Layout, header typography, power menu options, and Personalize/Tiles subpanels match the original flyouts (`app.js`, `css/modern-ui.css`).
- **Taskbar affordances** – Right-click menu copy, Win+X list contents, auto-hide animation, and height presets (40/82/124/166px) reproduce classic shell behaviour (`app.js`, `taskbar-drag.js`, `apps/meta-classic/taskbar/taskbar.cpl.html`).
- **Toast notifications** – Slide-in/out motion, icon layout, and persistent notifications with drag-to-dismiss replicate Windows toast styling (`components/notification/notification.css`).
- **System sounds** – Authentic WAVs and trigger mapping (`components/system_sounds/sound-map.json`, `resources/sounds`) echo the stock Windows soundscape.

## Project Layout
- `index.html` – Defines all shell views (boot, lock, login, signing in, Start, Desktop) plus charms, flyouts, taskbar, and tray shells.
- `app.js` – Core state machine managing view transitions, navigation settings, taskbar state, charms accessibility, personalization, and Start/Desktop orchestration.
- `apps.json` – Declarative catalog of modern/meta-classic apps (tile metadata, window options, categories) consumed by `apps-manager.js`.
- `apps/` – App assets:
  - `modern/*` – Packaged HTML apps (e.g., PC Settings, Store).
  - `meta-classic/*` – Webified replicas of classic dialogs (Taskbar properties, etc.).
  - `classic/` – Placeholder hooks for classic desktop apps.
- `components/` – Modular functionality: notifications, sounds, system tray integrations, device connectivity.
- `css/*.css` – Segmented stylesheets (boot, logon, start, taskbar, charms, desktop) matching Windows typography, spacing, and animation curves.
- `resources/` – Images, fonts, sounds, and personalization data (start wallpapers, charms icons, Segoe UI).
- `electron-main.js` – Electron main process: window lifecycle, IPC handlers, native integration scaffolding, and USB monitoring.

## Data & Persistence
- LocalStorage keys for navigation (`navigationSettings`), taskbar state (`taskbarAutoHide`, `taskbarHeight`, `taskbarLocked`), tile pinning order, and wallpaper color caching ensure repeat sessions behave like a real profile.
- Tile drag order persists via `TileDrag.applySavedOrder`, while taskbar pinning uses its own saved list.
- System preferences (volume, network, battery) are requested on demand through `ipcRenderer.invoke` calls hitting `volume-control`, `network-control`, and `battery-control` modules.

## Getting Started
```bash
npm install
npm start          # launches Electron shell
npm run dev        # opens with DevTools
```

Requirements:
- Node.js ≥ 18
- macOS/Linux support is implemented for volume and network APIs; Windows host support for some system calls is planned.
- Electron’s nodeIntegration is enabled; run in a controlled environment.

## Key Components in Detail

| Area | Relevant Files | Notes |
| --- | --- | --- |
| Start screen & tiles | `app.js`, `apps-manager.js`, `tile-drag.js`, `css/start.css` | Builds pinned and all-app views, handles tile resize/context menus, supports compact mode and personalization patterns (`resources/data/background-patterns.json`). |
| Taskbar & tray | `app.js`, `taskbar-drag.js`, `taskbar-item-context-menu.js`, `apps/meta-classic/taskbar` | Implements pinning, running-app badges, drag reordering, context menus, auto-hide, multi-height clock rendering, and Win+X menu. |
| Charms & flyouts | `app.js`, `css/charms.css`, `css/modern-ui.css` | Hot-corner triggers, Settings flyout with contextual options, Personalize and Tiles subpanels, clock overlay. |
| Notifications & sounds | `components/notification`, `components/system_sounds`, `components/device_connectivity` | Toasts with drag-to-dismiss, authentic sounds, USB drive notifications with delayed toast activation. |
| System integration | `components/volume`, `components/network`, `components/battery`, `electron-main.js` | Renderer UIs invoke Electron IPC for native data; volume/mute (macOS/Linux), Wi-Fi signal mapping, battery status (Web Battery API fallback). |

## Known Gaps / Next Steps
- Windows host volume/mute control currently logs “not yet implemented” (`components/volume/volume-control.js`).
- `components/battery/battery-monitor.js` expects `ipcRenderer` to be defined globally; uncommenting the `require('electron')` import or injecting `window.ipcRenderer` is necessary to avoid runtime errors in Electron.
- Battery API accuracy depends on Chromium’s Battery Status API availability; fallback provides placeholder levels until IPC wiring is expanded.
- Additional classic dialogs and modern apps are scaffolded but may need content passes.
- Security hardening (enable `contextIsolation`, disable `nodeIntegration`) is deferred while development tooling remains inline.

## License

MIT – see `package.json`.
