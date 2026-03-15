/**
 * Desktop wallpaper registry utilities
 *
 * Centralizes loading/saving of desktop wallpaper settings using the registry API.
 * Stores both authentic Windows registry values and simulator-specific metadata.
 */

const { getRegistry, RegistryType } = require('./registry.js');

// Registry paths & value names
const DESKTOP_PATH = 'HKCU\\Control Panel\\Desktop';
const WALLPAPER_SETTINGS_PATH = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Wallpapers';
const SLIDESHOW_PATH = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Wallpaper\\Slideshow';

const SETTINGS_VALUE = 'SimulatorDesktopBackgroundSettings';
const CUSTOM_FOLDERS_VALUE = 'CustomFolders';
const CURRENT_LOCATION_VALUE = 'CurrentLocation';
const WALLPAPER_TYPE_VALUE = 'CurrentWallpaperType';
const WALLPAPER_RELATIVE_VALUE = 'CurrentWallpaperRelative';
const SLIDESHOW_IMAGES_VALUE = 'Images';
const SLIDESHOW_TYPES_VALUE = 'ImageTypes';
const SLIDESHOW_ENABLED_VALUE = 'Enabled';
const SLIDESHOW_INTERVAL_VALUE = 'Interval';
const SLIDESHOW_SHUFFLE_VALUE = 'Shuffle';
const SLIDESHOW_BATTERY_VALUE = 'PauseOnBattery';
const COLOR_CACHE_VALUE = 'CachedColor';

// Defaults and helpers
const WALLPAPER_PREFIX = 'resources/images/wallpapers/';
const DEFAULT_WALLPAPER = 'Windows/img0.jpg';
const DEFAULT_LOCATION = 'windows';
const VALID_POSITIONS = new Set(['fill', 'fit', 'stretch', 'tile', 'center']);

const INTERVAL_STRING_TO_MS = {
  '10s': 10_000,
  '30s': 30_000,
  '1m': 60_000,
  '3m': 180_000,
  '5m': 300_000,
  '10m': 600_000,
  '15m': 900_000,
  '20m': 1_200_000,
  '30m': 1_800_000,
  '1h': 3_600_000,
  '2h': 7_200_000,
  '3h': 10_800_000,
  '4h': 14_400_000,
  '6h': 21_600_000,
  '12h': 43_200_000,
  '24h': 86_400_000
};

const DEFAULT_SETTINGS = Object.freeze({
  currentWallpaper: DEFAULT_WALLPAPER,
  currentWallpaperType: 'builtin',
  selectedWallpapers: [],
  selectedWallpapersTypes: [],
  picturePosition: 'fill',
  changeInterval: '30m',
  shuffle: false,
  pauseOnBattery: false,
  customFolders: [],
  currentLocation: DEFAULT_LOCATION
});

const PICTURE_POSITION_TO_STYLE = {
  fill: { style: '10', tile: '0' },
  fit: { style: '6', tile: '0' },
  stretch: { style: '2', tile: '0' },
  tile: { style: '0', tile: '1' },
  center: { style: '0', tile: '0' }
};

function styleToPicturePosition(styleValue, tileValue) {
  const style = typeof styleValue === 'number' ? styleValue.toString() : (styleValue || '').toString();
  const tile = typeof tileValue === 'number' ? tileValue.toString() : (tileValue || '').toString();

  if (tile === '1') {
    return 'tile';
  }

  switch (style) {
    case '10':
      return 'fill';
    case '6':
      return 'fit';
    case '2':
      return 'stretch';
    case '0':
      return 'center';
    default:
      return null;
  }
}

function getDefaultDesktopBackgroundSettings() {
  return {
    currentWallpaper: DEFAULT_SETTINGS.currentWallpaper,
    currentWallpaperType: DEFAULT_SETTINGS.currentWallpaperType,
    selectedWallpapers: [],
    selectedWallpapersTypes: [],
    picturePosition: DEFAULT_SETTINGS.picturePosition,
    changeInterval: DEFAULT_SETTINGS.changeInterval,
    shuffle: DEFAULT_SETTINGS.shuffle,
    pauseOnBattery: DEFAULT_SETTINGS.pauseOnBattery,
    customFolders: [],
    currentLocation: DEFAULT_SETTINGS.currentLocation
  };
}

function inferWallpaperType(path) {
  if (!path || typeof path !== 'string') {
    return 'builtin';
  }

  if (path.startsWith('resources/')) {
    return 'builtin';
  }

  if (path.startsWith('/') || /^[A-Za-z]:\\/.test(path) || path.startsWith('file://') || path.startsWith('http://') || path.startsWith('https://')) {
    return 'custom';
  }

  return 'builtin';
}

function toFullWallpaperPath(path, type = 'builtin') {
  if (!path) return null;

  if (type === 'custom') {
    return path;
  }

  const normalized = toRelativeWallpaperPath(path);
  if (normalized && normalized !== path) {
    path = normalized;
  }

  if (path.startsWith('resources/')) {
    return path;
  }

  // If the path looks like an absolute file path, return as-is
  if (/^[A-Za-z]:\\/.test(path) || path.startsWith('\\\\') || path.startsWith('file://')) {
    return path;
  }

  return WALLPAPER_PREFIX + path;
}

function toRelativeWallpaperPath(path) {
  if (!path || typeof path !== 'string') {
    return null;
  }

  // Normalize Windows paths to use backslashes consistently
  const normalizedPath = path.replace(/\//g, '\\');

  // Detect built-in Windows wallpaper locations (C:\Windows\Web\Wallpaper\...)
  const windowsWallpaperMatch = normalizedPath.match(/^[A-Za-z]:\\Windows\\Web\\Wallpaper\\(.+)$/i);
  if (windowsWallpaperMatch && windowsWallpaperMatch[1]) {
    return windowsWallpaperMatch[1].replace(/\\/g, '/');
  }

  // Detect resource path stored without prefix (e.g., Windows\img0.jpg)
  if (path.startsWith(WALLPAPER_PREFIX)) {
    return path.slice(WALLPAPER_PREFIX.length);
  }

  if (path.startsWith('resources/')) {
    return path;
  }

  // Convert legacy backslash-separated relative paths
  if (/^[^:]+\\[^:]+/.test(normalizedPath)) {
    return normalizedPath.replace(/\\/g, '/');
  }

  return path;
}

function normalizeCustomFolders(folders) {
  if (!Array.isArray(folders)) {
    return [];
  }

  return folders
    .map(folder => {
      if (!folder || typeof folder !== 'object') {
        return null;
      }
      const name = typeof folder.name === 'string' ? folder.name : '';
      const path = typeof folder.path === 'string' ? folder.path : null;
      if (!path) {
        return null;
      }
      return { name, path };
    })
    .filter(Boolean);
}

function intervalStringToMs(intervalKey) {
  return INTERVAL_STRING_TO_MS[intervalKey] || INTERVAL_STRING_TO_MS[DEFAULT_SETTINGS.changeInterval];
}

function intervalMsToString(ms) {
  const numeric = typeof ms === 'number' ? ms : parseInt(ms, 10);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_SETTINGS.changeInterval;
  }

  const entry = Object.entries(INTERVAL_STRING_TO_MS).find(([, value]) => value === numeric);
  return entry ? entry[0] : DEFAULT_SETTINGS.changeInterval;
}

function normalizeSettings(input = {}) {
  const merged = {
    ...getDefaultDesktopBackgroundSettings(),
    ...(input || {})
  };

  merged.currentWallpaper = typeof merged.currentWallpaper === 'string' && merged.currentWallpaper
    ? merged.currentWallpaper
    : DEFAULT_SETTINGS.currentWallpaper;

  merged.currentWallpaperType = merged.currentWallpaperType === 'custom' ? 'custom' : 'builtin';

  if (merged.currentWallpaperType === 'builtin') {
    const rel = toRelativeWallpaperPath(merged.currentWallpaper);
    if (rel) {
      merged.currentWallpaper = rel;
    }
  }

  merged.selectedWallpapers = Array.isArray(merged.selectedWallpapers)
    ? merged.selectedWallpapers.filter(Boolean).map(item => item.toString())
    : [];

  merged.selectedWallpapersTypes = Array.isArray(merged.selectedWallpapersTypes)
    ? merged.selectedWallpapersTypes
    : [];

  if (merged.selectedWallpapersTypes.length !== merged.selectedWallpapers.length) {
    merged.selectedWallpapersTypes = merged.selectedWallpapers.map((wallpaper, index) => {
      const explicitType = merged.selectedWallpapersTypes[index];
      if (explicitType === 'custom' || explicitType === 'builtin') {
        return explicitType;
      }
      return inferWallpaperType(wallpaper);
    });
  } else {
    merged.selectedWallpapersTypes = merged.selectedWallpapersTypes.map((type, index) => {
      if (type === 'custom' || type === 'builtin') {
        return type;
      }
      return inferWallpaperType(merged.selectedWallpapers[index]);
    });
  }

  merged.selectedWallpapers = merged.selectedWallpapers.map((wallpaper, index) => {
    const type = merged.selectedWallpapersTypes[index] || 'builtin';
    if (type === 'custom') {
      return wallpaper;
    }
    const rel = toRelativeWallpaperPath(wallpaper);
    return rel || wallpaper;
  });

  merged.picturePosition = VALID_POSITIONS.has(merged.picturePosition)
    ? merged.picturePosition
    : DEFAULT_SETTINGS.picturePosition;

  merged.changeInterval = Object.prototype.hasOwnProperty.call(INTERVAL_STRING_TO_MS, merged.changeInterval)
    ? merged.changeInterval
    : DEFAULT_SETTINGS.changeInterval;

  merged.shuffle = !!merged.shuffle;
  merged.pauseOnBattery = !!merged.pauseOnBattery;
  merged.customFolders = normalizeCustomFolders(merged.customFolders);
  merged.currentLocation = typeof merged.currentLocation === 'string' && merged.currentLocation
    ? merged.currentLocation
    : DEFAULT_SETTINGS.currentLocation;

  return merged;
}

function loadDesktopBackgroundSettings() {
  const registry = getRegistry();
  const defaults = getDefaultDesktopBackgroundSettings();
  let settings = { ...defaults };

  const rawJson = registry.getValue(WALLPAPER_SETTINGS_PATH, SETTINGS_VALUE, null);
  if (typeof rawJson === 'string' && rawJson.trim().length > 0) {
    try {
      const parsed = JSON.parse(rawJson);
      settings = { ...settings, ...(parsed || {}) };
    } catch (error) {
      console.error('[WallpaperRegistry] Failed to parse wallpaper settings JSON:', error);
    }
  }

  const storedType = registry.getValue(WALLPAPER_SETTINGS_PATH, WALLPAPER_TYPE_VALUE, null);
  if (storedType === 'custom' || storedType === 'builtin') {
    settings.currentWallpaperType = storedType;
  }

  let wallpaperFromRegistry = registry.getValue(WALLPAPER_SETTINGS_PATH, WALLPAPER_RELATIVE_VALUE, null);
  const wallpaperAbsolute = registry.getValue(DESKTOP_PATH, 'Wallpaper', null);

  if (settings.currentWallpaperType === 'custom') {
    if (typeof wallpaperAbsolute === 'string' && wallpaperAbsolute.length > 0) {
      settings.currentWallpaper = wallpaperAbsolute;
    }
  } else {
    if (typeof wallpaperFromRegistry === 'string' && wallpaperFromRegistry.length > 0) {
      settings.currentWallpaper = wallpaperFromRegistry;
    } else if (typeof wallpaperAbsolute === 'string' && wallpaperAbsolute.length > 0) {
      const relative = toRelativeWallpaperPath(wallpaperAbsolute);
      if (relative) {
        settings.currentWallpaper = relative;
      }
    }
  }

  const wallpaperStyle = registry.getValue(DESKTOP_PATH, 'WallpaperStyle', null);
  const tileWallpaper = registry.getValue(DESKTOP_PATH, 'TileWallpaper', null);
  const positionFromRegistry = styleToPicturePosition(wallpaperStyle, tileWallpaper);
  if (positionFromRegistry) {
    settings.picturePosition = positionFromRegistry;
  }

  const registrySelected = registry.getValue(SLIDESHOW_PATH, SLIDESHOW_IMAGES_VALUE, null);
  const registryTypes = registry.getValue(SLIDESHOW_PATH, SLIDESHOW_TYPES_VALUE, null);

  if (Array.isArray(registrySelected) && registrySelected.length > 0) {
    settings.selectedWallpapers = registrySelected.map((path, index) => {
      const type = Array.isArray(registryTypes) ? registryTypes[index] : inferWallpaperType(path);
      if (type === 'custom') {
        return path;
      }
      return toRelativeWallpaperPath(path);
    }).filter(Boolean);

    settings.selectedWallpapersTypes = settings.selectedWallpapers.map((_, index) => {
      const explicit = Array.isArray(registryTypes) ? registryTypes[index] : null;
      if (explicit === 'custom' || explicit === 'builtin') {
        return explicit;
      }
      return inferWallpaperType(registrySelected[index]);
    });
  }

  const intervalValue = registry.getValue(SLIDESHOW_PATH, SLIDESHOW_INTERVAL_VALUE, null);
  if (intervalValue !== null && intervalValue !== undefined) {
    settings.changeInterval = intervalMsToString(intervalValue);
  }

  const shuffleValue = registry.getValue(SLIDESHOW_PATH, SLIDESHOW_SHUFFLE_VALUE, null);
  if (shuffleValue !== null && shuffleValue !== undefined) {
    settings.shuffle = !!shuffleValue;
  }

  const batteryValue = registry.getValue(SLIDESHOW_PATH, SLIDESHOW_BATTERY_VALUE, null);
  if (batteryValue !== null && batteryValue !== undefined) {
    settings.pauseOnBattery = !!batteryValue;
  }

  const customFoldersJson = registry.getValue(WALLPAPER_SETTINGS_PATH, CUSTOM_FOLDERS_VALUE, null);
  if (typeof customFoldersJson === 'string' && customFoldersJson.trim().length > 0) {
    try {
      const parsedFolders = JSON.parse(customFoldersJson);
      settings.customFolders = normalizeCustomFolders(parsedFolders);
    } catch (error) {
      console.error('[WallpaperRegistry] Failed to parse custom folders JSON:', error);
    }
  }

  const currentLocation = registry.getValue(WALLPAPER_SETTINGS_PATH, CURRENT_LOCATION_VALUE, null);
  if (typeof currentLocation === 'string' && currentLocation.length > 0) {
    settings.currentLocation = currentLocation;
  }

  return normalizeSettings(settings);
}

function saveDesktopBackgroundSettings(inputSettings) {
  const registry = getRegistry();
  const settings = normalizeSettings(inputSettings);

  const jsonPayload = JSON.stringify({
    currentWallpaper: settings.currentWallpaper,
    currentWallpaperType: settings.currentWallpaperType,
    selectedWallpapers: settings.selectedWallpapers,
    selectedWallpapersTypes: settings.selectedWallpapersTypes,
    picturePosition: settings.picturePosition,
    changeInterval: settings.changeInterval,
    shuffle: settings.shuffle,
    pauseOnBattery: settings.pauseOnBattery,
    customFolders: settings.customFolders,
    currentLocation: settings.currentLocation
  });

  registry.setValue(WALLPAPER_SETTINGS_PATH, SETTINGS_VALUE, jsonPayload, RegistryType.REG_SZ);
  registry.setValue(WALLPAPER_SETTINGS_PATH, WALLPAPER_TYPE_VALUE, settings.currentWallpaperType, RegistryType.REG_SZ);

  if (settings.currentWallpaperType === 'builtin') {
    registry.setValue(WALLPAPER_SETTINGS_PATH, WALLPAPER_RELATIVE_VALUE, settings.currentWallpaper, RegistryType.REG_SZ);
  } else {
    registry.deleteValue(WALLPAPER_SETTINGS_PATH, WALLPAPER_RELATIVE_VALUE);
  }

  const fullWallpaperPath = toFullWallpaperPath(settings.currentWallpaper, settings.currentWallpaperType);
  if (fullWallpaperPath) {
    registry.setValue(DESKTOP_PATH, 'Wallpaper', fullWallpaperPath, RegistryType.REG_SZ);
  }

  const positionMapping = PICTURE_POSITION_TO_STYLE[settings.picturePosition] || PICTURE_POSITION_TO_STYLE.fill;
  registry.setValue(DESKTOP_PATH, 'WallpaperStyle', positionMapping.style, RegistryType.REG_SZ);
  registry.setValue(DESKTOP_PATH, 'TileWallpaper', positionMapping.tile, RegistryType.REG_SZ);

  const normalizedSelected = settings.selectedWallpapers.map((path, index) => {
    const type = settings.selectedWallpapersTypes[index] || inferWallpaperType(path);
    return toFullWallpaperPath(path, type);
  }).filter(Boolean);

  registry.setValue(SLIDESHOW_PATH, SLIDESHOW_IMAGES_VALUE, normalizedSelected, RegistryType.REG_MULTI_SZ);
  registry.setValue(SLIDESHOW_PATH, SLIDESHOW_TYPES_VALUE, settings.selectedWallpapersTypes, RegistryType.REG_MULTI_SZ);
  registry.setValue(SLIDESHOW_PATH, SLIDESHOW_ENABLED_VALUE, normalizedSelected.length > 1 ? 1 : 0, RegistryType.REG_DWORD);
  registry.setValue(SLIDESHOW_PATH, SLIDESHOW_INTERVAL_VALUE, intervalStringToMs(settings.changeInterval), RegistryType.REG_DWORD);
  registry.setValue(SLIDESHOW_PATH, SLIDESHOW_SHUFFLE_VALUE, settings.shuffle ? 1 : 0, RegistryType.REG_DWORD);
  registry.setValue(SLIDESHOW_PATH, SLIDESHOW_BATTERY_VALUE, settings.pauseOnBattery ? 1 : 0, RegistryType.REG_DWORD);

  registry.setValue(WALLPAPER_SETTINGS_PATH, CUSTOM_FOLDERS_VALUE, JSON.stringify(settings.customFolders), RegistryType.REG_SZ);
  registry.setValue(WALLPAPER_SETTINGS_PATH, CURRENT_LOCATION_VALUE, settings.currentLocation, RegistryType.REG_SZ);

  return settings;
}

function getDesktopWallpaperFullPath() {
  const settings = loadDesktopBackgroundSettings();
  return toFullWallpaperPath(settings.currentWallpaper, settings.currentWallpaperType);
}

function getWallpaperColorCache() {
  const registry = getRegistry();
  const raw = registry.getValue(WALLPAPER_SETTINGS_PATH, COLOR_CACHE_VALUE, null);

  if (typeof raw === 'string' && raw.trim().length > 0) {
    try {
      return JSON.parse(raw);
    } catch (error) {
      console.error('[WallpaperRegistry] Failed to parse wallpaper color cache:', error);
      return null;
    }
  }

  if (raw && typeof raw === 'object') {
    return raw;
  }

  return null;
}

function saveWallpaperColorCache(entry) {
  if (!entry || typeof entry !== 'object') {
    throw new Error('Invalid wallpaper color cache entry');
  }

  const payload = {
    path: entry.path,
    color: entry.color,
    timestamp: entry.timestamp || Date.now()
  };

  const registry = getRegistry();
  registry.setValue(WALLPAPER_SETTINGS_PATH, COLOR_CACHE_VALUE, JSON.stringify(payload), RegistryType.REG_SZ);
  return payload;
}

module.exports = {
  loadDesktopBackgroundSettings,
  saveDesktopBackgroundSettings,
  getDesktopWallpaperFullPath,
  getDefaultDesktopBackgroundSettings,
  toFullWallpaperPath,
  toRelativeWallpaperPath,
  intervalStringToMs,
  intervalMsToString,
  getWallpaperColorCache,
  saveWallpaperColorCache
};
