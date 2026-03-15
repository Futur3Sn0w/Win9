/**
 * Theme registry utilities
 *
 * Persists personalization theme selections (custom + unsaved themes)
 * using the simulator's registry backend so all surfaces stay in sync.
 */

const { getRegistry, RegistryType } = require('./registry.js');

const THEMES_PATH = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes';
const CUSTOM_PATH = `${THEMES_PATH}\\Custom`;
const VALUE_CURRENT_THEME = 'CurrentTheme';
const VALUE_CUSTOM_THEMES = 'ThemeData';
const VALUE_UNSAVED_THEME = 'UnsavedTheme';

const DEFAULT_THEME_SETTINGS = Object.freeze({
  currentTheme: 'windows',
  customThemes: [],
  unsavedTheme: null
});

function cloneDeep(value) {
  if (value == null) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function normalizeThemeSettings(settings) {
  const normalized = {
    currentTheme: DEFAULT_THEME_SETTINGS.currentTheme,
    customThemes: [],
    unsavedTheme: null
  };

  if (!settings || typeof settings !== 'object') {
    return normalized;
  }

  if (typeof settings.currentTheme === 'string' && settings.currentTheme.trim().length > 0) {
    normalized.currentTheme = settings.currentTheme.trim();
  }

  if (Array.isArray(settings.customThemes)) {
    normalized.customThemes = cloneDeep(settings.customThemes).filter(Boolean);
  }

  if (settings.unsavedTheme && typeof settings.unsavedTheme === 'object') {
    normalized.unsavedTheme = cloneDeep(settings.unsavedTheme);
  }

  return normalized;
}

function parseJsonValue(raw) {
  if (!raw) {
    return null;
  }

  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch (error) {
      console.warn('[ThemeRegistry] Failed to parse JSON string:', error);
      return null;
    }
  }

  if (Array.isArray(raw)) {
    try {
      return JSON.parse(Buffer.from(raw).toString('utf8'));
    } catch (error) {
      console.warn('[ThemeRegistry] Failed to parse JSON buffer:', error);
      return null;
    }
  }

  return null;
}

function getDefaultThemeSettings() {
  return cloneDeep(DEFAULT_THEME_SETTINGS);
}

function loadThemeSettings() {
  const registry = getRegistry();
  const result = getDefaultThemeSettings();

  try {
    const currentTheme = registry.getValue(THEMES_PATH, VALUE_CURRENT_THEME, null);
    const customThemesRaw = registry.getValue(CUSTOM_PATH, VALUE_CUSTOM_THEMES, null);
    const unsavedThemeRaw = registry.getValue(CUSTOM_PATH, VALUE_UNSAVED_THEME, null);

    if (typeof currentTheme === 'string' && currentTheme.trim().length > 0) {
      result.currentTheme = currentTheme.trim();
    }

    const customThemesParsed = parseJsonValue(customThemesRaw);
    if (Array.isArray(customThemesParsed)) {
      result.customThemes = customThemesParsed.filter(Boolean);
    }

    const unsavedParsed = parseJsonValue(unsavedThemeRaw);
    if (unsavedParsed && typeof unsavedParsed === 'object') {
      result.unsavedTheme = unsavedParsed;
    }
  } catch (error) {
    console.error('[ThemeRegistry] Failed to load theme settings:', error);
  }

  return normalizeThemeSettings(result);
}

function saveThemeSettings(settings) {
  const registry = getRegistry();
  const normalized = normalizeThemeSettings(settings);

  try {
    registry.setValue(
      THEMES_PATH,
      VALUE_CURRENT_THEME,
      normalized.currentTheme,
      RegistryType.REG_SZ
    );

    if (normalized.customThemes.length > 0) {
      registry.setValue(
        CUSTOM_PATH,
        VALUE_CUSTOM_THEMES,
        JSON.stringify(normalized.customThemes),
        RegistryType.REG_SZ
      );
    } else {
      registry.deleteValue(CUSTOM_PATH, VALUE_CUSTOM_THEMES);
    }

    if (normalized.unsavedTheme && typeof normalized.unsavedTheme === 'object') {
      registry.setValue(
        CUSTOM_PATH,
        VALUE_UNSAVED_THEME,
        JSON.stringify(normalized.unsavedTheme),
        RegistryType.REG_SZ
      );
    } else {
      registry.deleteValue(CUSTOM_PATH, VALUE_UNSAVED_THEME);
    }
  } catch (error) {
    console.error('[ThemeRegistry] Failed to save theme settings:', error);
  }

  return normalized;
}

function isDefaultThemeSettings(settings) {
  const normalized = normalizeThemeSettings(settings);
  const defaults = DEFAULT_THEME_SETTINGS;

  const currentMatches = normalized.currentTheme === defaults.currentTheme;
  const customMatches = Array.isArray(normalized.customThemes) && normalized.customThemes.length === 0;
  const unsavedMatches = !normalized.unsavedTheme;

  return currentMatches && customMatches && unsavedMatches;
}

module.exports = {
  loadThemeSettings,
  saveThemeSettings,
  getDefaultThemeSettings,
  isDefaultThemeSettings
};
