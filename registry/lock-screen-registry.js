/**
 * Lock screen wallpaper registry utilities
 *
 * Centralizes read/write logic for lock screen wallpaper selection
 * so multiple surfaces (shell, Settings app, personalization) stay in sync.
 */

const { getRegistry, RegistryType } = require('./registry.js');

const LOCK_SCREEN_PATH = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Lock Screen';
const POLICY_PATH = 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\Personalization';

const VALUE_CURRENT = 'CurrentImage';
const VALUE_RELATIVE = 'CurrentImageRelative';
const VALUE_TYPE = 'CurrentImageType';
const VALUE_RECENTS = 'RecentImages';
const VALUE_POLICY_LOCK = 'LockScreenImage';

const LOCK_SCREEN_PREFIX = 'resources/images/wallpapers/Lock/';
const DEFAULT_WALLPAPER = 'img101.png';
const DEFAULT_RECENT_IMAGES = Object.freeze([
  'img101.png',
  'img100.jpg',
  'img102.jpg',
  'img103.png',
  'img104.jpg'
]);
const MAX_RECENT_IMAGES = 8;

function ensureArray(value) {
  if (Array.isArray(value)) {
    return value.slice();
  }
  if (value == null) {
    return [];
  }
  if (typeof value === 'object') {
    const items = [];
    Object.keys(value).forEach(key => {
      const entry = value[key];
      if (entry && typeof entry === 'object' && typeof entry.data === 'string') {
        items.push(entry.data);
      }
    });
    return items;
  }
  if (typeof value === 'string') {
    return value.length > 0 ? [value] : [];
  }
  return [];
}

function normalizeSeparator(path) {
  return (path || '').replace(/\\/g, '/');
}

function inferImageType(identifier) {
  if (!identifier || typeof identifier !== 'string') {
    return 'builtin';
  }

  const normalized = normalizeSeparator(identifier);
  const windowsScreenPattern = /^[A-Za-z]:\/Windows\/Web\/Screen\/.+$/i;

  if (normalized.startsWith('resources/') || normalized.startsWith('resources\\')) {
    return 'builtin';
  }

  if (windowsScreenPattern.test(normalized)) {
    return 'builtin';
  }

  if (/^[A-Za-z]:\//.test(normalized) || normalized.startsWith('file://') || normalized.startsWith('\\\\')) {
    return 'custom';
  }

  return 'builtin';
}

function toRelative(identifier, type = 'builtin') {
  if (!identifier || typeof identifier !== 'string') {
    return null;
  }

  const normalized = normalizeSeparator(identifier);
  const windowsScreenMatch = normalized.match(/^[A-Za-z]:\/Windows\/Web\/Screen\/(.+)$/i);
  if (windowsScreenMatch && windowsScreenMatch[1]) {
    return windowsScreenMatch[1];
  }

  if (type === 'custom') {
    return identifier;
  }

  if (normalized.startsWith(LOCK_SCREEN_PREFIX)) {
    return normalized.slice(LOCK_SCREEN_PREFIX.length);
  }

  if (normalized.startsWith('resources/images/wallpapers/Lock/')) {
    return normalized.slice('resources/images/wallpapers/Lock/'.length);
  }

  return normalized;
}

function toFullPath(identifier, type = 'builtin') {
  if (!identifier || typeof identifier !== 'string') {
    return LOCK_SCREEN_PREFIX + DEFAULT_WALLPAPER;
  }

  if (type === 'custom') {
    return identifier;
  }

  const normalized = normalizeSeparator(identifier);

  if (normalized.startsWith('resources/')) {
    return normalized;
  }

  if (/^[A-Za-z]:\//.test(normalized) || normalized.startsWith('file://') || normalized.startsWith('\\\\')) {
    return normalized;
  }

  return LOCK_SCREEN_PREFIX + normalized.replace(/^\.?\//, '');
}

function dedupePreserveOrder(list) {
  const seen = new Set();
  const result = [];
  list.forEach(item => {
    if (item && !seen.has(item)) {
      seen.add(item);
      result.push(item);
    }
  });
  return result;
}

function buildRecentList(current, providedList = []) {
  const pieces = [];
  if (current) {
    pieces.push(current);
  }
  if (Array.isArray(providedList)) {
    pieces.push(...providedList);
  }
  pieces.push(...DEFAULT_RECENT_IMAGES);

  const deduped = dedupePreserveOrder(pieces);
  return deduped.slice(0, MAX_RECENT_IMAGES);
}

function loadPolicyLockScreenFallback(registry) {
  const policyValue = registry.getValue(POLICY_PATH, VALUE_POLICY_LOCK, null);
  if (typeof policyValue === 'string' && policyValue.length > 0) {
    return {
      currentWallpaper: toRelative(policyValue, 'custom'),
      currentWallpaperType: inferImageType(policyValue),
      recentWallpapers: buildRecentList(toRelative(policyValue, 'custom'))
    };
  }
  return null;
}

function loadLockScreenWallpaperState() {
  const registry = getRegistry();

  let type = registry.getValue(LOCK_SCREEN_PATH, VALUE_TYPE, null);
  let relative = registry.getValue(LOCK_SCREEN_PATH, VALUE_RELATIVE, null);
  let full = registry.getValue(LOCK_SCREEN_PATH, VALUE_CURRENT, null);

  if (!relative && full) {
    relative = toRelative(full, inferImageType(full));
  }

  if (!relative) {
    const policyFallback = loadPolicyLockScreenFallback(registry);
    if (policyFallback) {
      return policyFallback;
    }
  }

  let currentWallpaper = relative || full || DEFAULT_WALLPAPER;
  type = type || inferImageType(currentWallpaper);

  if (type === 'builtin') {
    currentWallpaper = toRelative(currentWallpaper, type) || DEFAULT_WALLPAPER;
  }

  const recentsRaw = registry.getValue(LOCK_SCREEN_PATH, VALUE_RECENTS, null);
  const recents = buildRecentList(currentWallpaper, ensureArray(recentsRaw));

  return {
    currentWallpaper,
    currentWallpaperType: type,
    recentWallpapers: recents
  };
}

function saveLockScreenWallpaperState(state) {
  if (!state || typeof state.currentWallpaper !== 'string') {
    throw new Error('Invalid lock screen wallpaper state: missing currentWallpaper');
  }

  const registry = getRegistry();

  const type = state.currentWallpaperType === 'custom' ? 'custom' : 'builtin';
  const relative = type === 'builtin'
    ? toRelative(state.currentWallpaper, type) || DEFAULT_WALLPAPER
    : state.currentWallpaper;
  const fullPath = toFullPath(state.currentWallpaper, type);
  const recents = buildRecentList(relative, state.recentWallpapers);

  registry.setValue(LOCK_SCREEN_PATH, VALUE_CURRENT, fullPath, RegistryType.REG_SZ);

  if (type === 'builtin') {
    registry.setValue(LOCK_SCREEN_PATH, VALUE_RELATIVE, relative, RegistryType.REG_SZ);
  } else {
    registry.deleteValue(LOCK_SCREEN_PATH, VALUE_RELATIVE);
  }

  registry.setValue(LOCK_SCREEN_PATH, VALUE_TYPE, type, RegistryType.REG_SZ);
  registry.setValue(LOCK_SCREEN_PATH, VALUE_RECENTS, recents, RegistryType.REG_MULTI_SZ);

  return {
    currentWallpaper: relative,
    currentWallpaperType: type,
    recentWallpapers: recents
  };
}

function resolveLockScreenWallpaperPath(identifier, type = 'builtin') {
  return toFullPath(identifier || DEFAULT_WALLPAPER, type);
}

function getDefaultLockScreenWallpaperState() {
  return {
    currentWallpaper: DEFAULT_WALLPAPER,
    currentWallpaperType: 'builtin',
    recentWallpapers: DEFAULT_RECENT_IMAGES.slice()
  };
}

module.exports = {
  loadLockScreenWallpaperState,
  saveLockScreenWallpaperState,
  resolveLockScreenWallpaperPath,
  getDefaultLockScreenWallpaperState,
  DEFAULT_WALLPAPER,
  DEFAULT_RECENT_IMAGES
};
