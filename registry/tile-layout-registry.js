/**
 * Start tile layout registry helpers
 *
 * Persists pinned app order and tile sizes in authentic Windows registry paths.
 */

let registryModule = null;
try {
  if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
    registryModule = require('./registry.js');
  } else if (typeof require === 'function') {
    registryModule = require('./registry/registry.js');
  }
} catch (error) {
  console.warn('[TileLayoutRegistry] Unable to require registry module (node context):', error);
}

if (!registryModule && typeof window !== 'undefined' && typeof window.require === 'function') {
  try {
    registryModule = window.require('./registry/registry.js');
  } catch (error) {
    console.warn('[TileLayoutRegistry] Unable to require registry module (window context):', error);
  }
}

if (!registryModule && typeof window !== 'undefined' && window.RegistryAPI) {
  registryModule = window.RegistryAPI;
}

const registryApi = registryModule || {};
const getRegistryFn = registryApi.getRegistry;
const registryTypeConstants = registryApi.RegistryType;
const REG_MULTI_SZ = registryTypeConstants ? registryTypeConstants.REG_MULTI_SZ : 7;
const REG_SZ = registryTypeConstants ? registryTypeConstants.REG_SZ : 1;
const REG_DWORD = registryTypeConstants ? registryTypeConstants.REG_DWORD : 4;

const TILE_LAYOUT_PATH = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\ImmersiveShell\\Launcher\\TileLayout';
const PINNED_APPS_VALUE = 'PinnedApps';
const TILE_SIZES_PATH = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\ImmersiveShell\\Launcher\\TileSizes';
const TILE_ORDER_PATH = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\ImmersiveShell\\Launcher\\Groups';
const TILE_LIVE_ENABLED_PATH = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\ImmersiveShell\\Launcher\\LiveTiles\\Enabled';
const TILE_LIVE_CACHE_PATH = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\ImmersiveShell\\Launcher\\LiveTiles\\Cache';
const TILE_BADGE_STATE_PATH = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\ImmersiveShell\\Launcher\\TileBadges';
const TASKBAR_PATH = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Taskband\\PinnedApplications';
const TASKBAR_LIST_VALUE = 'List';
const TASKBAR_ORDER_VALUE = 'Order';
const TASKBAR_TRAY_ORDER_VALUE = 'TrayOrder';
const TASKBAR_TRAY_OVERFLOW_COUNT_VALUE = 'TrayOverflowCount';
const START_MENU_PATH = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartPage';
const START_MENU_PINS_VALUE = 'StartMenuPinnedApps';
const START_MENU_RECENTS_VALUE = 'StartMenuRecentApps';
const START_MENU_TILE_ROWS_VALUE = 'StartMenuTileRows';
const START_MENU_FULLSCREEN_VALUE = 'StartMenuFullscreen';

function getRegistrySafe() {
  if (typeof getRegistryFn !== 'function') {
    console.warn('[TileLayoutRegistry] Registry API unavailable');
    return null;
  }
  return getRegistryFn();
}

function ensureArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value == null) {
    return [];
  }
  if (typeof value === 'string') {
    return [value];
  }
  return [];
}

function loadPinnedApps() {
  const registry = getRegistrySafe();
  if (!registry) {
    return null;
  }
  const value = registry.getValue(TILE_LAYOUT_PATH, PINNED_APPS_VALUE, []);
  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }
  return ensureArray(value).filter(Boolean);
}

function savePinnedApps(appIds) {
  const registry = getRegistrySafe();
  if (!registry) {
    return [];
  }
  const list = Array.isArray(appIds) ? appIds.filter(Boolean) : [];

  registry.setValue(
    TILE_LAYOUT_PATH,
    PINNED_APPS_VALUE,
    list,
    REG_MULTI_SZ
  );

  return list;
}

function loadTaskbarPins() {
  const registry = getRegistrySafe();
  if (!registry) {
    return null;
  }
  const value = registry.getValue(TASKBAR_PATH, TASKBAR_LIST_VALUE, []);
  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }
  return ensureArray(value).filter(Boolean);
}

function saveTaskbarPins(appIds) {
  const registry = getRegistrySafe();
  if (!registry) {
    return [];
  }
  const list = Array.isArray(appIds) ? appIds.filter(Boolean) : [];

  registry.setValue(
    TASKBAR_PATH,
    TASKBAR_LIST_VALUE,
    list,
    REG_MULTI_SZ
  );

  return list;
}

function loadStartMenuPins() {
  const registry = getRegistrySafe();
  if (!registry) {
    return null;
  }
  const value = registry.getValue(START_MENU_PATH, START_MENU_PINS_VALUE, null);
  if (value == null) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }
  return ensureArray(value).filter(Boolean);
}

function saveStartMenuPins(appIds) {
  const registry = getRegistrySafe();
  if (!registry) {
    return [];
  }
  const list = Array.isArray(appIds) ? appIds.filter(Boolean) : [];

  registry.setValue(
    START_MENU_PATH,
    START_MENU_PINS_VALUE,
    list,
    REG_MULTI_SZ
  );

  return list;
}

function loadStartMenuRecents() {
  const registry = getRegistrySafe();
  if (!registry) {
    return null;
  }
  const value = registry.getValue(START_MENU_PATH, START_MENU_RECENTS_VALUE, null);
  if (value == null) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }
  return ensureArray(value).filter(Boolean);
}

function saveStartMenuRecents(appIds) {
  const registry = getRegistrySafe();
  if (!registry) {
    return [];
  }
  const list = Array.isArray(appIds) ? appIds.filter(Boolean) : [];

  registry.setValue(
    START_MENU_PATH,
    START_MENU_RECENTS_VALUE,
    list,
    REG_MULTI_SZ
  );

  return list;
}

function loadStartMenuTileRows() {
  const registry = getRegistrySafe();
  if (!registry) {
    return null;
  }

  const value = registry.getValue(START_MENU_PATH, START_MENU_TILE_ROWS_VALUE, null);
  const normalized = Number(value);

  if (!Number.isFinite(normalized) || normalized < 1) {
    return null;
  }

  return Math.round(normalized);
}

function saveStartMenuTileRows(rowCount) {
  const registry = getRegistrySafe();
  if (!registry) {
    return null;
  }

  const normalized = Number(rowCount);
  if (!Number.isFinite(normalized) || normalized < 1) {
    registry.deleteValue(START_MENU_PATH, START_MENU_TILE_ROWS_VALUE);
    return null;
  }

  const savedValue = Math.round(normalized);
  registry.setValue(
    START_MENU_PATH,
    START_MENU_TILE_ROWS_VALUE,
    savedValue,
    REG_DWORD
  );

  return savedValue;
}

function loadStartMenuFullscreenPreference() {
  const registry = getRegistrySafe();
  if (!registry) {
    return null;
  }

  const value = registry.getValue(START_MENU_PATH, START_MENU_FULLSCREEN_VALUE, null);
  if (value == null) {
    return null;
  }

  return Number(value) === 1;
}

function saveStartMenuFullscreenPreference(enabled) {
  const registry = getRegistrySafe();
  if (!registry) {
    return null;
  }

  if (enabled == null) {
    registry.deleteValue(START_MENU_PATH, START_MENU_FULLSCREEN_VALUE);
    return null;
  }

  const normalized = enabled ? 1 : 0;
  registry.setValue(
    START_MENU_PATH,
    START_MENU_FULLSCREEN_VALUE,
    normalized,
    REG_DWORD
  );

  return normalized === 1;
}

function loadTileSizes() {
  const registry = getRegistrySafe();
  if (!registry) {
    return {};
  }
  const tileSizes = registry.getValue(TILE_SIZES_PATH, null, {});
  if (!tileSizes || typeof tileSizes !== 'object') {
    return {};
  }

  const sizes = {};
  Object.keys(tileSizes).forEach(key => {
    const entry = tileSizes[key];
    if (entry && typeof entry === 'object' && typeof entry.data === 'string') {
      sizes[key] = entry.data;
    }
  });

  return sizes;
}

function saveTileSizes(sizeMap) {
  const registry = getRegistrySafe();
  if (!registry) {
    return {};
  }
  registry.deleteKey(TILE_SIZES_PATH);

  if (!sizeMap || typeof sizeMap !== 'object') {
    return {};
  }

  Object.keys(sizeMap).forEach(key => {
    const value = sizeMap[key];
    if (typeof value === 'string' && value.length > 0) {
      registry.setValue(
        TILE_SIZES_PATH,
        key,
        value,
        REG_SZ
      );
    }
  });

  return sizeMap;
}

function loadLiveTileEnabledStates() {
  const registry = getRegistrySafe();
  if (!registry) {
    return {};
  }

  const savedValues = registry.getValue(TILE_LIVE_ENABLED_PATH, null, {});
  if (!savedValues || typeof savedValues !== 'object') {
    return {};
  }

  const enabledStates = {};
  Object.keys(savedValues).forEach(key => {
    const entry = savedValues[key];
    if (!entry || typeof entry !== 'object') {
      return;
    }

    const rawValue = entry.data;
    if (rawValue == null) {
      return;
    }

    enabledStates[key] = Number(rawValue) !== 0;
  });

  return enabledStates;
}

function saveLiveTileEnabledStates(stateMap) {
  const registry = getRegistrySafe();
  if (!registry) {
    return {};
  }

  registry.deleteKey(TILE_LIVE_ENABLED_PATH);

  if (!stateMap || typeof stateMap !== 'object') {
    return {};
  }

  Object.keys(stateMap).forEach(key => {
    if (!key) {
      return;
    }

    registry.setValue(
      TILE_LIVE_ENABLED_PATH,
      key,
      stateMap[key] ? 1 : 0,
      REG_DWORD
    );
  });

  return stateMap;
}

function loadLiveTileCache() {
  const registry = getRegistrySafe();
  if (!registry) {
    return {};
  }

  const savedValues = registry.getValue(TILE_LIVE_CACHE_PATH, null, {});
  if (!savedValues || typeof savedValues !== 'object') {
    return {};
  }

  const cacheEntries = {};
  Object.keys(savedValues).forEach(key => {
    const entry = savedValues[key];
    if (!entry || typeof entry !== 'object' || typeof entry.data !== 'string' || !entry.data) {
      return;
    }

    try {
      const parsed = JSON.parse(entry.data);
      if (parsed && typeof parsed === 'object') {
        cacheEntries[key] = parsed;
      }
    } catch (error) {
      console.warn(`[TileLayoutRegistry] Failed to parse live tile cache for ${key}:`, error);
    }
  });

  return cacheEntries;
}

function saveLiveTileCache(cacheMap) {
  const registry = getRegistrySafe();
  if (!registry) {
    return {};
  }

  registry.deleteKey(TILE_LIVE_CACHE_PATH);

  if (!cacheMap || typeof cacheMap !== 'object') {
    return {};
  }

  Object.keys(cacheMap).forEach(key => {
    const entry = cacheMap[key];
    if (!key || !entry || typeof entry !== 'object') {
      return;
    }

    try {
      registry.setValue(
        TILE_LIVE_CACHE_PATH,
        key,
        JSON.stringify(entry),
        REG_SZ
      );
    } catch (error) {
      console.warn(`[TileLayoutRegistry] Failed to save live tile cache for ${key}:`, error);
    }
  });

  return cacheMap;
}

function loadTileBadgeState() {
  const registry = getRegistrySafe();
  if (!registry) {
    return {};
  }

  const savedValues = registry.getValue(TILE_BADGE_STATE_PATH, null, {});
  if (!savedValues || typeof savedValues !== 'object') {
    return {};
  }

  const badgeEntries = {};
  Object.keys(savedValues).forEach(key => {
    const entry = savedValues[key];
    if (!entry || typeof entry !== 'object' || typeof entry.data !== 'string' || !entry.data) {
      return;
    }

    try {
      const parsed = JSON.parse(entry.data);
      if (parsed && typeof parsed === 'object') {
        badgeEntries[key] = parsed;
      }
    } catch (error) {
      console.warn(`[TileLayoutRegistry] Failed to parse tile badge state for ${key}:`, error);
    }
  });

  return badgeEntries;
}

function saveTileBadgeState(stateMap) {
  const registry = getRegistrySafe();
  if (!registry) {
    return {};
  }

  registry.deleteKey(TILE_BADGE_STATE_PATH);

  if (!stateMap || typeof stateMap !== 'object') {
    return {};
  }

  Object.keys(stateMap).forEach(key => {
    if (!key) {
      return;
    }

    const entry = stateMap[key];
    if (!entry || typeof entry !== 'object') {
      return;
    }

    try {
      registry.setValue(
        TILE_BADGE_STATE_PATH,
        key,
        JSON.stringify(entry),
        REG_SZ
      );
    } catch (error) {
      console.warn(`[TileLayoutRegistry] Failed to save tile badge state for ${key}:`, error);
    }
  });

  return stateMap;
}

function loadTileOrder(groupId) {
  const registry = getRegistrySafe();
  if (!registry) {
    return [];
  }
  let value = registry.getValue(TILE_ORDER_PATH, groupId, null);

  // Backward-compatible fallback in case an older build stored a subkey.
  if (!value) {
    value = registry.getValue(`${TILE_ORDER_PATH}\\${groupId}`, null, null);
  }

  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }

  if (typeof value === 'object') {
    const entries = [];
    Object.keys(value).forEach(key => {
      const entry = value[key];
      if (entry && typeof entry === 'object' && typeof entry.data === 'string') {
        entries.push(entry.data);
      }
    });
    return entries;
  }

  return [];
}

function loadTaskbarOrder() {
  const registry = getRegistrySafe();
  if (!registry) {
    return [];
  }
  const value = registry.getValue(TASKBAR_PATH, TASKBAR_ORDER_VALUE, []);
  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }
  return ensureArray(value).filter(Boolean);
}

function saveTaskbarOrder(order) {
  const registry = getRegistrySafe();
  if (!registry) {
    return [];
  }
  const normalized = Array.isArray(order) ? order.filter(Boolean) : [];

  registry.setValue(
    TASKBAR_PATH,
    TASKBAR_ORDER_VALUE,
    normalized,
    REG_MULTI_SZ
  );

  return normalized;
}

function loadTrayOrder() {
  const registry = getRegistrySafe();
  if (!registry) {
    return [];
  }
  const value = registry.getValue(TASKBAR_PATH, TASKBAR_TRAY_ORDER_VALUE, []);
  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }
  return ensureArray(value).filter(Boolean);
}

function saveTrayOrder(order) {
  const registry = getRegistrySafe();
  if (!registry) {
    return [];
  }
  const normalized = Array.isArray(order) ? order.filter(Boolean) : [];

  registry.setValue(
    TASKBAR_PATH,
    TASKBAR_TRAY_ORDER_VALUE,
    normalized,
    REG_MULTI_SZ
  );

  return normalized;
}

function loadTrayOverflowCount() {
  const registry = getRegistrySafe();
  if (!registry) {
    return 0;
  }

  const value = Number(registry.getValue(TASKBAR_PATH, TASKBAR_TRAY_OVERFLOW_COUNT_VALUE, 0));
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }

  return Math.round(value);
}

function saveTrayOverflowCount(count) {
  const registry = getRegistrySafe();
  if (!registry) {
    return 0;
  }

  const normalized = Number(count);
  const savedValue = Number.isFinite(normalized) && normalized > 0 ? Math.round(normalized) : 0;

  registry.setValue(
    TASKBAR_PATH,
    TASKBAR_TRAY_OVERFLOW_COUNT_VALUE,
    savedValue,
    REG_DWORD
  );

  return savedValue;
}

function saveTileOrder(groupId, order) {
  const registry = getRegistrySafe();
  if (!registry) {
    return [];
  }
  const normalized = Array.isArray(order) ? order.filter(Boolean) : [];

  registry.setValue(
    TILE_ORDER_PATH,
    groupId,
    normalized,
    REG_MULTI_SZ
  );

  return normalized;
}

function clearTileOrder(groupId) {
  const registry = getRegistrySafe();
  if (!registry) {
    return;
  }
  try {
    const clearedValue = registry.deleteValue(TILE_ORDER_PATH, groupId);
    if (!clearedValue) {
      registry.deleteKey(`${TILE_ORDER_PATH}\\${groupId}`);
    }
  } catch (error) {
    console.warn('[TileLayoutRegistry] Failed to clear tile order:', error);
  }
}

const api = {
  loadPinnedApps,
  savePinnedApps,
  loadTileSizes,
  saveTileSizes,
  loadLiveTileEnabledStates,
  saveLiveTileEnabledStates,
  loadLiveTileCache,
  saveLiveTileCache,
  loadTileBadgeState,
  saveTileBadgeState,
  loadTileOrder,
  saveTileOrder,
  clearTileOrder,
  loadTaskbarPins,
  saveTaskbarPins,
  loadStartMenuPins,
  saveStartMenuPins,
  loadStartMenuRecents,
  saveStartMenuRecents,
  loadStartMenuTileRows,
  saveStartMenuTileRows,
  loadStartMenuFullscreenPreference,
  saveStartMenuFullscreenPreference,
  loadTaskbarOrder,
  saveTaskbarOrder,
  loadTrayOrder,
  saveTrayOrder,
  loadTrayOverflowCount,
  saveTrayOverflowCount
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}

if (typeof window !== 'undefined') {
  window.TileLayoutRegistry = api;
}
