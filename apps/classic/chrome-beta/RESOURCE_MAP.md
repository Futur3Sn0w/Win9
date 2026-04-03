## Chrome Beta resource map

This app is the isolated sandbox for pushing the Chrome recreation closer to
real Chrome using the unpacked bundle under `appreqs/chrome`.

### High-value WebUI sources

- New Tab Page:
  - `appreqs/chrome/480` contains the local NTP HTML shell.
  - `appreqs/chrome/481.css` contains the classic NTP styling.
  - `appreqs/chrome/482.js`, `488.js`, `491.js`, and `492.js` drive most
    visited tile rendering and fakebox behavior.
  - `appreqs/chrome/779` appears to contain a much larger touch/new-tab-page
    implementation.

- Downloads:
  - `appreqs/chrome/762` contains the downloads page HTML and inline styling,
    with script hooks to `chrome://downloads/downloads.js` and
    `chrome://downloads/strings.js`.

- Bookmarks:
  - `appreqs/chrome/416.json` is the Bookmark Manager manifest and confirms
    the `chrome://bookmarks/` override target.
  - `appreqs/chrome/1005.js` and `1008.js` reference bookmark manager logic.

- Shared Chrome WebUI / controls:
  - `appreqs/chrome/23200.js` is a large settings-page bundle.
  - `appreqs/chrome/22000.css`, `22003.css`, `30500.css`, `30520.css`, and
    `30521.css` are large CSS banks likely useful for shared Chromium WebUI
    tokens, controls, and layouts.

- Images:
  - `pak_index.ini` shows dense PNG banks around `2003-2085`, `8000-8029`,
    and `22024-22094`.
  - These are worth sampling when replacing placeholder icons, separators, or
    internal-page imagery.

### Important constraint

The actual browser frame, tab strip, and omnibox are mostly native Chromium UI,
not WebUI pages. `resources.pak` is strongest for internal pages, shared
controls, icons, and imagery. Recreating the outer browser chrome will still
require hand-built HTML/CSS that borrows proportions and assets from the bundle.
