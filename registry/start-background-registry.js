/**
 * Start screen background registry utilities
 *
 * Persists the simulator's start screen background selection (pattern/variant
 * or desktop wallpaper) using the registry-backed storage layer.
 */

const { getRegistry, RegistryType } = require('./registry.js');

const PERSONALIZATION_PATH = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\ImmersiveShell\\Launcher\\Personalization';
const CURRENT_VALUE = 'SimulatorStartBackgroundCurrent';
const PREVIOUS_VALUE = 'SimulatorStartBackgroundPrevious';

function parseJSON(value) {
  if (!value) return null;

  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (error) {
      console.warn('[StartBackgroundRegistry] Failed to parse JSON value:', error);
      return null;
    }
  }

  // If value is stored as an object (unlikely), clone it
  if (typeof value === 'object') {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return null;
    }
  }

  return null;
}

function normalizeBackground(background, fallback = null) {
  if (!background || typeof background !== 'object') {
    return fallback ? { ...fallback } : null;
  }

  if (background.pattern === 'desktop') {
    return { pattern: 'desktop', variant: null };
  }

  const pattern = parseInt(background.pattern, 10);
  if (Number.isNaN(pattern) || pattern <= 0) {
    if (fallback) {
      return { ...fallback };
    }
    return null;
  }

  const variant = background.variant != null ? parseInt(background.variant, 10) : null;

  return {
    pattern,
    variant: Number.isNaN(variant) ? null : variant
  };
}

function loadStartScreenBackground(defaultBackground = { pattern: 1, variant: 1 }) {
  const registry = getRegistry();

  const currentRaw = registry.getValue(PERSONALIZATION_PATH, CURRENT_VALUE, null);
  const previousRaw = registry.getValue(PERSONALIZATION_PATH, PREVIOUS_VALUE, null);

  const currentParsed = parseJSON(currentRaw);
  const previousParsed = parseJSON(previousRaw);

  const current = normalizeBackground(currentParsed, defaultBackground);
  const previous = normalizeBackground(previousParsed, null);

  return {
    current,
    previous
  };
}

function saveCurrentStartScreenBackground(background) {
  const registry = getRegistry();
  const normalized = normalizeBackground(background, { pattern: 1, variant: 1 });

  registry.setValue(
    PERSONALIZATION_PATH,
    CURRENT_VALUE,
    JSON.stringify(normalized),
    RegistryType.REG_SZ
  );

  return normalized;
}

function savePreviousStartScreenBackground(background) {
  const registry = getRegistry();
  const normalized = normalizeBackground(background, null);

  if (!normalized) {
    registry.deleteValue(PERSONALIZATION_PATH, PREVIOUS_VALUE);
    return null;
  }

  registry.setValue(
    PERSONALIZATION_PATH,
    PREVIOUS_VALUE,
    JSON.stringify(normalized),
    RegistryType.REG_SZ
  );

  return normalized;
}

function clearPreviousStartScreenBackground() {
  const registry = getRegistry();
  registry.deleteValue(PERSONALIZATION_PATH, PREVIOUS_VALUE);
}

const api = {
  loadStartScreenBackground,
  saveCurrentStartScreenBackground,
  savePreviousStartScreenBackground,
  clearPreviousStartScreenBackground
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}

if (typeof window !== 'undefined') {
  window.StartBackgroundRegistry = api;
}
