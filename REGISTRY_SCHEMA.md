# Windows 8 Simulator - Authentic Registry Schema

This document defines the **authentic Windows registry structure** for the Windows 8 simulator, using **real Windows 8/8.1 registry paths** wherever possible.

## Philosophy

This simulator uses **actual Windows registry paths** - not custom namespaces. Since the registry is sandboxed within the app, there are no conflicts with the host OS. This provides maximum authenticity for users exploring the simulated Windows environment.

## Registry Structure Overview

The simulator implements:
- **HKEY_CURRENT_USER (HKCU)** - User-specific settings (primary)
- **HKEY_LOCAL_MACHINE (HKLM)** - System-wide settings (secondary)
- **HKEY_CLASSES_ROOT (HKCR)** - File associations and COM objects
- **HKEY_USERS (HKU)** - All user profiles (symbolic link to current user)
- **HKEY_CURRENT_CONFIG** - Current hardware profile

## Registry Data Types

```javascript
const RegistryType = {
  REG_SZ: 1,           // String (null-terminated)
  REG_EXPAND_SZ: 2,    // String with environment variables (%SystemRoot%)
  REG_BINARY: 3,       // Binary data (Uint8Array)
  REG_DWORD: 4,        // 32-bit number (DWORD)
  REG_MULTI_SZ: 7,     // Array of strings (null-delimited)
  REG_QWORD: 11,       // 64-bit number
  REG_NONE: 0          // No data type
};
```

---

## Authentic Windows Registry Paths

### 1. Desktop Wallpaper

**Path:** `HKEY_CURRENT_USER\Control Panel\Desktop`

**Real Windows 8 Values:**
```javascript
{
  "Wallpaper": {
    type: REG_SZ,
    data: "C:\\Windows\\Web\\Wallpaper\\Windows\\img0.jpg"
  },
  "WallpaperStyle": {
    type: REG_SZ,
    data: "10"  // 0=center, 2=stretch, 6=fit, 10=fill, 22=span
  },
  "TileWallpaper": {
    type: REG_SZ,
    data: "0"   // 0=don't tile, 1=tile
  },
  "Pattern": {
    type: REG_SZ,
    data: ""    // Empty for solid color, pattern string for pattern
  }
}
```

**Additional path:** `HKEY_CURRENT_USER\Control Panel\Colors`
```javascript
{
  "Background": {
    type: REG_SZ,
    data: "0 0 0"  // RGB format (space-separated)
  }
}
```

**Migration from localStorage:**
- `desktopWallpaper` → Convert relative path to Windows-style path
- `desktopBackgroundSettings.selectedWallpapers` → Store in separate key or use History

---

### 2. Lock Screen Wallpaper

**Path:** `HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Microsoft\Windows\Personalization`

**Real Windows 8 Values:**
```javascript
{
  "LockScreenImage": {
    type: REG_SZ,
    data: "C:\\Windows\\Web\\Screen\\img100.jpg"
  },
  "NoChangingLockScreen": {
    type: REG_DWORD,
    data: 0  // 0=allow changes, 1=locked by policy
  }
}
```

**Alternative user path:** `HKEY_CURRENT_USER\Control Panel\Desktop`
```javascript
{
  "LockScreenImage": {
    type: REG_SZ,
    data: "C:\\Users\\User\\AppData\\Local\\Packages\\Microsoft.Windows.ContentDeliveryManager_cw5n1h2txyewy\\LocalState\\Assets\\lock.jpg"
  }
}
```

**Migration:**
- `lockScreenWallpaper` → Store in HKLM policy path

---

### 3. Taskbar Settings (StuckRects2)

**Path:** `HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Explorer\StuckRects2`

**Real Windows 8 Value:**
```javascript
{
  "Settings": {
    type: REG_BINARY,
    data: Uint8Array(52)  // 52-byte binary structure
  }
}
```

**Binary Structure (52 bytes):**
```
Bytes 0-3:   Version (0x00000028 for Windows 8)
Bytes 4-7:   Unknown
Byte  8:     Taskbar state
             0x02 = Auto-hide OFF, always on top OFF
             0x03 = Auto-hide ON, always on top OFF
             0x0A = Auto-hide OFF, always on top ON
             0x0B = Auto-hide ON, always on top ON
Byte  9:     Lock state (0x00 = unlocked, 0x01 = locked)
Bytes 10-11: Unknown
Bytes 12-15: Taskbar size/height (DWORD, little-endian, in pixels)
Bytes 16-19: Taskbar position (DWORD: 0=left, 1=top, 2=right, 3=bottom)
Bytes 20-35: Taskbar rectangle (RECT structure: left, top, right, bottom - 4 DWORDs)
Bytes 36-51: Monitor rectangle (RECT structure: left, top, right, bottom - 4 DWORDs)
```

**Encoding helper:**
```javascript
function encodeStuckRects2(settings) {
  const buffer = new Uint8Array(52);
  const view = new DataView(buffer.buffer);

  // Version
  view.setUint32(0, 0x00000028, true);

  // State byte
  let stateByte = 0x02;
  if (settings.autoHide) stateByte |= 0x01;
  if (settings.alwaysOnTop) stateByte |= 0x08;
  buffer[8] = stateByte;

  // Lock state
  buffer[9] = settings.locked ? 0x01 : 0x00;

  // Height (pixels)
  view.setUint32(12, settings.height || 40, true);

  // Position (3 = bottom)
  view.setUint32(16, settings.position || 3, true);

  // Taskbar rectangle
  view.setInt32(20, 0, true);      // left
  view.setInt32(24, 1040, true);   // top (1080 - 40)
  view.setInt32(28, 1920, true);   // right
  view.setInt32(32, 1080, true);   // bottom

  // Monitor rectangle
  view.setInt32(36, 0, true);      // left
  view.setInt32(40, 0, true);      // top
  view.setInt32(44, 1920, true);   // right
  view.setInt32(48, 1080, true);   // bottom

  return buffer;
}

function decodeStuckRects2(buffer) {
  if (!buffer || buffer.length < 48) {
    return { autoHide: false, alwaysOnTop: false, locked: true, height: 40, position: 3 };
  }

  const view = new DataView(buffer.buffer);
  const stateByte = buffer[8];

  return {
    autoHide: (stateByte & 0x01) !== 0,
    alwaysOnTop: (stateByte & 0x08) !== 0,
    locked: buffer[9] === 0x01,
    height: view.getUint32(12, true),
    position: view.getUint32(16, true)
  };
}
```

**Migration:**
- `taskbarAutoHide`, `taskbarHeight`, `taskbarLocked` → Encode into StuckRects2 binary

---

### 4. Pinned Taskbar Applications

**Path:** `HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Explorer\Taskband`

**Real Windows 8 Value:**
```javascript
{
  "Favorites": {
    type: REG_BINARY,
    data: /* Complex binary structure */
  }
}
```

**Note:** Real Windows stores pinned apps as shortcuts in:
`%APPDATA%\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar`

**For simplicity, we'll use a custom but plausible path:**

**Path:** `HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Explorer\Taskband\PinnedApplications`

```javascript
{
  "List": {
    type: REG_MULTI_SZ,
    data: [
      "C:\\Windows\\explorer.exe",
      "C:\\Program Files\\Internet Explorer\\iexplore.exe",
      "C:\\Windows\\System32\\calc.exe"
    ]
  },
  "Order": {
    type: REG_MULTI_SZ,
    data: ["explorer", "iexplore", "calc"]  // App IDs
  }
}
```

**Migration:**
- `pinnedTaskbarApps` → Convert to app paths or IDs
- `taskbarOrder` → Store in Order value

---

### 5. UI Accent Color & Theme Colors

**Path:** `HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Explorer\Accent`

**Real Windows 8.1 Values:**
```javascript
{
  "AccentColor": {
    type: REG_DWORD,
    data: 0xFF464646  // Format: 0xAABBGGRR (Alpha, Blue, Green, Red)
  },
  "AccentColorMenu": {
    type: REG_DWORD,
    data: 0xFF464646
  },
  "StartColor": {
    type: REG_DWORD,
    data: 0xFF1E1E1E  // Start screen background color
  },
  "StartColorMenu": {
    type: REG_DWORD,
    data: 0xFF1E1E1E
  },
  "AccentPalette": {
    type: REG_BINARY,
    data: Uint8Array([
      // 8 colors × 4 bytes (ARGB) = 32 bytes
      0xA6, 0xD8, 0xFF, 0xFF,  // Color 1
      0x76, 0xB9, 0xED, 0xFF,  // Color 2
      0x42, 0x9C, 0xE3, 0xFF,  // Color 3 (primary accent)
      0x00, 0x78, 0xD7, 0xFF,  // Color 4
      0x00, 0x5A, 0x9E, 0xFF,  // Color 5
      0x00, 0x42, 0x75, 0xFF,  // Color 6
      0x00, 0x26, 0x52, 0xFF,  // Color 7
      0xF7, 0x63, 0x0C, 0xFF   // Color 8 (error/alert)
    ])
  }
}
```

**Color conversion:**
```javascript
function hexToARGB(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const a = 0xFF;

  return (a << 24) | (b << 16) | (g << 8) | r;
}

function argbToHex(argb) {
  const r = (argb & 0xFF).toString(16).padStart(2, '0');
  const g = ((argb >> 8) & 0xFF).toString(16).padStart(2, '0');
  const b = ((argb >> 16) & 0xFF).toString(16).padStart(2, '0');

  return `#${r}${g}${b}`;
}
```

**Migration:**
- `uiAccentColor` → Convert hex to ARGB DWORD
- `colorSettings.selectedColor` → Store `"automatic"`/`"custom"` in `SimulatorAccentMode`
- `colorSettings.customColor` → Persist hex string in `SimulatorCustomAccentHex`

---

### 6. Theme Settings

**Path:** `HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes`

**Real Windows 8 Values:**
```javascript
{
  "CurrentTheme": {
    type: REG_SZ,
    data: "C:\\Windows\\Resources\\Themes\\aero.theme"
  },
  "InstallTheme": {
    type: REG_SZ,
    data: "C:\\Windows\\Resources\\Themes\\aero.theme"
  }
}
```

**Path:** `HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize` (Windows 8.1)
```javascript
{
  "EnableTransparency": {
    type: REG_DWORD,
    data: 1  // 0=disabled, 1=enabled
  },
  "ColorPrevalence": {
    type: REG_DWORD,
    data: 0  // 0=off, 1=show accent on title bars
  },
  "AppsUseLightTheme": {
    type: REG_DWORD,
    data: 0  // 0=dark, 1=light (Windows 10+ feature, not in Windows 8)
  }
}
```

**For custom themes:**

**Path:** `HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Custom`
```javascript
{
  "ThemeName": {
    type: REG_SZ,
    data: "MyCustomTheme"
  },
  "ThemeData": {
    type: REG_BINARY,
    data: /* JSON-encoded theme definition */
  }
}
```

**Migration:**
- `themeSettings.currentTheme` → Map to theme path
- `themeSettings.customThemes` → Store in Custom\ThemeData

---

### 7. Start Screen Background

**Path:** `HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\ImmersiveShell\Launcher`

**Windows 8.1 Values:**
```javascript
{
  "ShowDesktopBackgroundOnStart": {
    type: REG_DWORD,
    data: 0  // 0=Start pattern, 1=Desktop wallpaper
  },
  "Launcher_ShowMoreTiles": {
    type: REG_DWORD,
    data: 0  // 0=standard view, 1=show more tiles
  }
}
```

**For Start screen pattern and color (custom but plausible):**

**Path:** `HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\ImmersiveShell\Launcher\Personalization`
```javascript
{
  "BackgroundPattern": {
    type: REG_SZ,
    data: "Pattern1"  // Pattern identifier
  },
  "BackgroundColor": {
    type: REG_DWORD,
    data: 0xFF1E1E1E  // ARGB format
  },
  "PreviousBackgroundPattern": {
    type: REG_SZ,
    data: "Pattern2"
  },
  "PreviousBackgroundColor": {
    type: REG_DWORD,
    data: 0xFF2D2D2D
  }
}
```

**Migration:**
- `showMoreTiles` → Launcher_ShowMoreTiles
- `startScreenBackground` → BackgroundPattern + BackgroundColor
- `startScreenBackgroundPrevious` → Previous values

---

### 8. Start Screen Tiles & Layout

**Note:** Real Windows 8 stores tile layout in binary `.itemdata-ms` files at:
`%LocalAppData%\Microsoft\Windows\Application Shortcuts\`

**For the simulator, we'll use a plausible registry path:**

**Path:** `HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\ImmersiveShell\Launcher\TileLayout`

```javascript
{
  "PinnedApps": {
    type: REG_MULTI_SZ,
    data: [
      "Microsoft.WindowsMail_8wekyb3d8bbwe!microsoft.windowslive.mail",
      "Microsoft.WindowsCalendar_8wekyb3d8bbwe!microsoft.windowslive.calendar",
      "Microsoft.BingMaps_8wekyb3d8bbwe!App"
    ]
  },
  "TileGroups": {
    type: REG_BINARY,
    data: /* JSON structure of groups */
  }
}
```

**Tile Sizes - Per App:**

**Path:** `HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\ImmersiveShell\Launcher\TileSizes`
```javascript
{
  "Microsoft.WindowsMail_8wekyb3d8bbwe!microsoft.windowslive.mail": {
    type: REG_SZ,
    data: "medium"  // small, medium, wide, large
  },
  "Microsoft.BingMaps_8wekyb3d8bbwe!App": {
    type: REG_SZ,
    data: "wide"
  }
}
```

**Tile Order per Group:**

**Path:** `HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\ImmersiveShell\Launcher\Groups`
```javascript
{
  "start-screen": {
    type: REG_MULTI_SZ,
    data: ["mail", "calendar", "maps"]
  },
  "productivity": {
    type: REG_MULTI_SZ,
    data: ["word", "excel", "powerpoint"]
  }
}
```

**Migration:**
- `pinnedApps` → PinnedApps (REG_MULTI_SZ)
- `tileSizes` → Individual keys under TileSizes\
- `tileOrder-{group}` → Groups\{group}

---

### 9. Navigation Settings (Windows 8.1 Features)

**Path:** `HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\ImmersiveShell\EdgeUI`

**Real Windows 8.1 Values:**
```javascript
{
  "DisableCharmsHint": {
    type: REG_DWORD,
    data: 0  // 0=show hints, 1=disable
  },
  "DisableTRCorner": {
    type: REG_DWORD,
    data: 0  // 0=enable top-right corner, 1=disable
  },
  "DisableTLCorner": {
    type: REG_DWORD,
    data: 0  // 0=enable top-left corner, 1=disable
  }
}
```

**Path:** `HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Explorer\StartPage`

**Windows 8.1 Values:**
```javascript
{
  "OpenAtLogon": {
    type: REG_DWORD,
    data: 0  // 0=go to Start, 1=go to Desktop
  },
  "DesktopFirst": {
    type: REG_DWORD,
    data: 0  // Boot to desktop preference
  },
  "MakeAllAppsDefault": {
    type: REG_DWORD,
    data: 0  // 0=tiles view, 1=all apps view
  },
  "ShowAppsViewOnSearchClick": {
    type: REG_DWORD,
    data: 0  // Search behavior
  }
}
```

**Path:** `HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\ImmersiveShell\Launcher`
```javascript
{
  "ShowDesktopBackgroundOnStart": {
    type: REG_DWORD,
    data: 0  // 0=pattern, 1=desktop wallpaper
  }
}
```

**Migration:**
- `navigationSettings.charmsHotCornersEnabled` → !DisableCharmsHint
- `navigationSettings.goToDesktopOnSignIn` → OpenAtLogon
- `navigationSettings.showDesktopBackgroundOnStart` → ShowDesktopBackgroundOnStart
- `navigationSettings.showAppsViewOnStart` → MakeAllAppsDefault
- `navigationSettings.searchEverywhereFromApps` → ShowAppsViewOnSearchClick
- `navigationSettings.listDesktopAppsFirst` → Custom or derived value

---

### 10. Display Brightness

**Note:** Real Windows doesn't store brightness in easily accessible registry.

**Plausible path:** `HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\SettingSync\Settings\display`

```javascript
{
  "BrightnessLevel": {
    type: REG_DWORD,
    data: 100  // 0-100 percentage
  }
}
```

**Migration:**
- `settingsBrightness` → BrightnessLevel

---

### 11. Installed Store Apps

**Path:** `HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\Appx`

**Real Windows 8 Value:**
```javascript
{
  "PackageRoot": {
    type: REG_SZ,
    data: "C:\\Program Files\\WindowsApps"
  }
}
```

**User-installed apps list (plausible custom path):**

**Path:** `HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Appx\PackageRepository`
```javascript
{
  "InstalledPackages": {
    type: REG_MULTI_SZ,
    data: [
      "Microsoft.WindowsMail_8wekyb3d8bbwe",
      "Microsoft.BingMaps_8wekyb3d8bbwe",
      "Microsoft.WindowsStore_8wekyb3d8bbwe"
    ]
  }
}
```

**Migration:**
- `msstore-installedApps` + `installedStoreApps` → Merge into InstalledPackages

---

### 12. Internet Explorer Favorites

**Path:** `HKEY_CURRENT_USER\Software\Microsoft\Internet Explorer\FavOrder`

**Real Windows Value:**
```javascript
{
  "FavBarOrder": {
    type: REG_BINARY,
    data: /* Binary structure */
  }
}
```

**For simplicity, use custom path:**

**Path:** `HKEY_CURRENT_USER\Software\Microsoft\Internet Explorer\Favorites`
```javascript
{
  "FavoritesList": {
    type: REG_BINARY,
    data: /* JSON-encoded favorites array */
  }
}
```

**Migration:**
- `ie-favorites` → Encode to binary JSON

---

### 13. File Explorer State

**Path:** `HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced`

**Real Windows 8 Values:**
```javascript
{
  "Hidden": {
    type: REG_DWORD,
    data: 2  // 1=show hidden files, 2=don't show
  },
  "HideFileExt": {
    type: REG_DWORD,
    data: 1  // 0=show extensions, 1=hide
  },
  "ShowSuperHidden": {
    type: REG_DWORD,
    data: 0  // 0=hide protected OS files, 1=show
  },
  "LaunchTo": {
    type: REG_DWORD,
    data: 1  // 1=This PC, 2=Quick Access
  }
}
```

**Window state (custom but plausible):**

**Path:** `HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Explorer\WindowState`
```javascript
{
  "LastActiveWindow": {
    type: REG_BINARY,
    data: /* JSON-encoded window state */
  }
}
```

**Migration:**
- `fileExplorerState` → LastActiveWindow binary

---

### 14. Wallpaper Color Cache

**Path:** `HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\WallpaperColorCache`

```javascript
{
  "img0.jpg": {
    type: REG_SZ,
    data: "#1E1E1E"  // Dominant color
  },
  "img1.jpg": {
    type: REG_SZ,
    data: "#2D4A6E"
  }
}
```

**Migration:**
- `wallpaper-color-data` → Convert object to subkeys

---

## Complete Authentic Registry Tree

```
HKEY_CURRENT_USER\
├── Control Panel\
│   ├── Desktop\
│   │   ├── Wallpaper (REG_SZ)
│   │   ├── WallpaperStyle (REG_SZ)
│   │   ├── TileWallpaper (REG_SZ)
│   │   ├── Pattern (REG_SZ)
│   │   └── LockScreenImage (REG_SZ)
│   └── Colors\
│       ├── Background (REG_SZ)
│       └── WindowFrame (REG_SZ)
│
├── Software\
│   └── Microsoft\
│       ├── Windows\
│       │   └── CurrentVersion\
│       │       ├── Explorer\
│       │       │   ├── Advanced\
│       │       │   │   ├── Hidden (REG_DWORD)
│       │       │   │   ├── HideFileExt (REG_DWORD)
│       │       │   │   ├── ShowSuperHidden (REG_DWORD)
│       │       │   │   └── LaunchTo (REG_DWORD)
│       │       │   ├── Accent\
│       │       │   │   ├── AccentColor (REG_DWORD)
│       │       │   │   ├── AccentColorMenu (REG_DWORD)
│       │       │   │   ├── StartColor (REG_DWORD)
│       │       │   │   ├── StartColorMenu (REG_DWORD)
│       │       │   │   └── AccentPalette (REG_BINARY)
│       │       │   ├── StuckRects2\
│       │       │   │   └── Settings (REG_BINARY - 52 bytes)
│       │       │   ├── Taskband\
│       │       │   │   └── PinnedApplications\
│       │       │   │       ├── List (REG_MULTI_SZ)
│       │       │   │       └── Order (REG_MULTI_SZ)
│       │       │   ├── StartPage\
│       │       │   │   ├── OpenAtLogon (REG_DWORD)
│       │       │   │   ├── DesktopFirst (REG_DWORD)
│       │       │   │   ├── MakeAllAppsDefault (REG_DWORD)
│       │       │   │   └── ShowAppsViewOnSearchClick (REG_DWORD)
│       │       │   └── WindowState\
│       │       │       └── LastActiveWindow (REG_BINARY)
│       │       ├── ImmersiveShell\
│       │       │   ├── EdgeUI\
│       │       │   │   ├── DisableCharmsHint (REG_DWORD)
│       │       │   │   ├── DisableTRCorner (REG_DWORD)
│       │       │   │   └── DisableTLCorner (REG_DWORD)
│       │       │   └── Launcher\
│       │       │       ├── ShowDesktopBackgroundOnStart (REG_DWORD)
│       │       │       ├── Launcher_ShowMoreTiles (REG_DWORD)
│       │       │       ├── Personalization\
│       │       │       │   ├── BackgroundPattern (REG_SZ)
│       │       │       │   ├── BackgroundColor (REG_DWORD)
│       │       │       │   ├── PreviousBackgroundPattern (REG_SZ)
│       │       │       │   └── PreviousBackgroundColor (REG_DWORD)
│       │       │       ├── TileLayout\
│       │       │       │   ├── PinnedApps (REG_MULTI_SZ)
│       │       │       │   └── TileGroups (REG_BINARY)
│       │       │       ├── TileSizes\
│       │       │       │   ├── {appId} (REG_SZ)
│       │       │       │   └── ...
│       │       │       └── Groups\
│       │       │           ├── {groupId} (REG_MULTI_SZ)
│       │       │           └── ...
│       │       ├── Themes\
│       │       │   ├── CurrentTheme (REG_SZ)
│       │       │   ├── InstallTheme (REG_SZ)
│       │       │   ├── Personalize\
│       │       │   │   ├── EnableTransparency (REG_DWORD)
│       │       │   │   └── ColorPrevalence (REG_DWORD)
│       │       │   ├── WallpaperColorCache\
│       │       │   │   ├── {filename} (REG_SZ)
│       │       │   │   └── ...
│       │       │   └── Custom\
│       │       │       ├── ThemeName (REG_SZ)
│       │       │       └── ThemeData (REG_BINARY)
│       │       ├── SettingSync\
│       │       │   └── Settings\
│       │       │       └── display\
│       │       │           └── BrightnessLevel (REG_DWORD)
│       │       └── Appx\
│       │           └── PackageRepository\
│       │               └── InstalledPackages (REG_MULTI_SZ)
│       └── Internet Explorer\
│           └── Favorites\
│               └── FavoritesList (REG_BINARY)
│
HKEY_LOCAL_MACHINE\
└── SOFTWARE\
    ├── Microsoft\
    │   └── Windows\
    │       └── CurrentVersion\
    │           ├── Appx\
    │           │   └── PackageRoot (REG_SZ)
    │           └── Personalization\
    │               └── LockScreenImage (REG_SZ)
    └── Policies\
        └── Microsoft\
            └── Windows\
                └── Personalization\
                    ├── LockScreenImage (REG_SZ)
                    └── NoChangingLockScreen (REG_DWORD)
```

---

## localStorage to Registry Migration Map

| Old localStorage Key | New Registry Path | Type | Conversion Notes |
|---------------------|-------------------|------|------------------|
| `taskbarAutoHide` | `HKCU\...\Explorer\StuckRects2\Settings` | REG_BINARY | Encode byte 8 |
| `taskbarHeight` | `HKCU\...\Explorer\StuckRects2\Settings` | REG_BINARY | Encode bytes 12-15 |
| `taskbarLocked` | `HKCU\...\Explorer\StuckRects2\Settings` | REG_BINARY | Encode byte 9 |
| `pinnedTaskbarApps` | `HKCU\...\Explorer\Taskband\PinnedApplications\List` | REG_MULTI_SZ | Array → multi-string |
| `taskbarOrder` | `HKCU\...\Explorer\Taskband\PinnedApplications\Order` | REG_MULTI_SZ | Array → multi-string |
| `taskbarSmallIcons` | `HKCU\...\Explorer\Advanced\TaskbarSmallIcons` | REG_DWORD | bool → 0/1 |
| `taskbarButtons` | `HKCU\...\Explorer\Advanced\TaskbarGlomLevel` | REG_DWORD | always=0, sometimes=1, never=2 |
| `taskbarLocation` | `HKCU\...\Explorer\StuckRects2\Settings` | REG_BINARY | Position: left=0, top=1, right=2, bottom=3 |
| `showMoreTiles` | `HKCU\...\ImmersiveShell\Launcher\Launcher_ShowMoreTiles` | REG_DWORD | bool → 0/1 |
| `startScreenBackground.pattern` | `HKCU\...\ImmersiveShell\Launcher\Personalization\BackgroundPattern` | REG_SZ | Extract pattern |
| `startScreenBackground.color` | `HKCU\...\ImmersiveShell\Launcher\Personalization\BackgroundColor` | REG_DWORD | Hex → ARGB |
| `startScreenBackgroundPrevious.pattern` | `HKCU\...\ImmersiveShell\Launcher\Personalization\PreviousBackgroundPattern` | REG_SZ | Extract pattern |
| `startScreenBackgroundPrevious.color` | `HKCU\...\ImmersiveShell\Launcher\Personalization\PreviousBackgroundColor` | REG_DWORD | Hex → ARGB |
| `desktopWallpaper` | `HKCU\Control Panel\Desktop\Wallpaper` | REG_SZ | Relative → full path |
| `lockScreenWallpaper` | `HKLM\...\Personalization\LockScreenImage` | REG_SZ | Relative → full path |
| `uiAccentColor` | `HKCU\...\Explorer\Accent\AccentColor` | REG_DWORD | Hex → ARGB |
| `colorSettings.selectedColor` | `HKCU\...\Explorer\Accent\SimulatorAccentMode` | REG_SZ | `"automatic"` or `"custom"` |
| `colorSettings.customColor` | `HKCU\...\Explorer\Accent\SimulatorCustomAccentHex` | REG_SZ | Hex string persisted when custom |
| `themeSettings.currentTheme` | `HKCU\...\Themes\CurrentTheme` | REG_SZ | Map ID → path |
| `themeSettings.customThemes` | `HKCU\...\Themes\Custom\ThemeData` | REG_BINARY | JSON encode |
| `wallpaper-color-data` | `HKCU\...\Themes\WallpaperColorCache\{filename}` | REG_SZ | Object → subkeys |
| `navigationSettings.charmsHotCornersEnabled` | `HKCU\...\ImmersiveShell\EdgeUI\DisableCharmsHint` | REG_DWORD | Invert bool → 0/1 |
| `navigationSettings.goToDesktopOnSignIn` | `HKCU\...\Explorer\StartPage\OpenAtLogon` | REG_DWORD | bool → 0/1 |
| `navigationSettings.showDesktopBackgroundOnStart` | `HKCU\...\ImmersiveShell\Launcher\ShowDesktopBackgroundOnStart` | REG_DWORD | bool → 0/1 |
| `navigationSettings.showAppsViewOnStart` | `HKCU\...\Explorer\StartPage\MakeAllAppsDefault` | REG_DWORD | bool → 0/1 |
| `navigationSettings.searchEverywhereFromApps` | `HKCU\...\Explorer\StartPage\ShowAppsViewOnSearchClick` | REG_DWORD | bool → 0/1 |
| `settingsBrightness` | `HKCU\...\SettingSync\Settings\display\BrightnessLevel` | REG_DWORD | Direct number |
| `pinnedApps` | `HKCU\...\ImmersiveShell\Launcher\TileLayout\PinnedApps` | REG_MULTI_SZ | Array → multi-string |
| `tileSizes` | `HKCU\...\ImmersiveShell\Launcher\TileSizes\{appId}` | REG_SZ | Object → subkeys |
| `tileOrder-{group}` | `HKCU\...\ImmersiveShell\Launcher\Groups\{group}` | REG_MULTI_SZ | Array → multi-string |
| `msstore-installedApps` | `HKCU\...\Appx\PackageRepository\InstalledPackages` | REG_MULTI_SZ | Merge arrays |
| `installedStoreApps` | `HKCU\...\Appx\PackageRepository\InstalledPackages` | REG_MULTI_SZ | Merge arrays |
| `ie-favorites` | `HKCU\Software\Microsoft\Internet Explorer\Favorites\FavoritesList` | REG_BINARY | JSON encode |
| `fileExplorerState` | `HKCU\...\Explorer\WindowState\LastActiveWindow` | REG_BINARY | JSON encode |

---

## Notes on Authenticity

### Fully Authentic Paths ✅
- Desktop wallpaper (`Control Panel\Desktop`)
- Taskbar settings (`StuckRects2`)
- Accent colors (`Explorer\Accent`)
- Theme settings (`Themes\CurrentTheme`)
- Explorer advanced (`Explorer\Advanced`)
- Navigation/EdgeUI (`ImmersiveShell\EdgeUI`)

### Plausible Extensions ⚠️
- Taskbar pinned apps (real Windows uses shortcuts, we use registry)
- Start tile layout (real Windows uses `.itemdata-ms`, we use registry)
- Wallpaper color cache (added for functionality)
- Brightness (real Windows uses power settings/WMI, we use SettingSync)

### Creative Liberties 🎨
- Some Start screen paths under `ImmersiveShell\Launcher\Personalization`
- Tile groups and sizes under `ImmersiveShell\Launcher`
- IE favorites in registry (real Windows uses Favorites folder)

All paths follow Windows naming conventions and fit logically within the registry hierarchy.

---

## Implementation Advantages

1. **Maximum Authenticity** - Users see real Windows paths in Registry Editor
2. **Educational Value** - Learn actual Windows registry structure
3. **No Conflicts** - Sandboxed within the app, no host OS collision
4. **Export/Import** - `.wsd` files contain authentic registry structure
5. **OOBE Integration** - Setup can initialize "real" registry on first boot

---

## Next Steps

**Phase 3:** Build `registry.js` API with:
- Binary encoding/decoding for StuckRects2
- ARGB color conversion
- Path navigation (traversing nested keys)
- Type-safe value access
- Migration from flat electron-store to registry structure

**Ready to proceed?**
