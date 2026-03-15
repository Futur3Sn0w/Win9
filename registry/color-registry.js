/**
 * Accent color registry utilities
 *
 * Provides helpers for reading and writing accent color settings using
 * the registry-backed storage layer. Supports both "automatic" (wallpaper-driven)
 * and explicit custom color modes.
 */

const { getRegistry, RegistryType, hexToARGB, argbToHex } = require('./registry.js');

const ACCENT_PATH = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Accent';
const MODE_VALUE = 'SimulatorAccentMode';
const CUSTOM_HEX_VALUE = 'SimulatorCustomAccentHex';
const DEFAULT_HEX = '#464646';

function normalizeHex(hex) {
  if (!hex || typeof hex !== 'string') {
    return DEFAULT_HEX;
  }

  let value = hex.trim();

  if (!value.startsWith('#')) {
    value = `#${value}`;
  }

  if (value.length === 7 || value.length === 4) {
    return value.toUpperCase();
  }

  if (/^#[0-9A-Fa-f]{6}$/.test(value)) {
    return value.toUpperCase();
  }

  if (/^[0-9A-Fa-f]{6}$/.test(value)) {
    return `#${value.toUpperCase()}`;
  }

  // Basic fallback – ensure six-character hex
  return DEFAULT_HEX;
}

function setAccentColorHex(hexColor) {
  const registry = getRegistry();
  const normalized = normalizeHex(hexColor);
  const argb = hexToARGB(normalized);

  registry.setValue(ACCENT_PATH, 'AccentColor', argb, RegistryType.REG_DWORD);
  registry.setValue(ACCENT_PATH, 'AccentColorMenu', argb, RegistryType.REG_DWORD);

  return normalized;
}

function getAccentColorHex(defaultHex = DEFAULT_HEX) {
  const registry = getRegistry();
  const storedHex = registry.getValue(ACCENT_PATH, CUSTOM_HEX_VALUE, null);

  if (typeof storedHex === 'string' && storedHex.length >= 4) {
    return normalizeHex(storedHex);
  }

  const accentDword = registry.getValue(ACCENT_PATH, 'AccentColor', null);
  if (typeof accentDword === 'number') {
    return normalizeHex(argbToHex(accentDword));
  }

  return normalizeHex(defaultHex);
}

function loadColorSettings() {
  const registry = getRegistry();
  const mode = registry.getValue(ACCENT_PATH, MODE_VALUE, 'automatic');

  if (mode === 'custom') {
    return {
      selectedColor: 'custom',
      customColor: getAccentColorHex()
    };
  }

  return {
    selectedColor: 'automatic',
    customColor: null
  };
}

function saveColorSettings(options) {
  const registry = getRegistry();
  const selected = options?.selectedColor || 'automatic';

  if (selected === 'automatic') {
    registry.setValue(ACCENT_PATH, MODE_VALUE, 'automatic', RegistryType.REG_SZ);
    registry.deleteValue(ACCENT_PATH, CUSTOM_HEX_VALUE);
    return {
      selectedColor: 'automatic',
      customColor: null
    };
  }

  const normalized = normalizeHex(selected);
  registry.setValue(ACCENT_PATH, MODE_VALUE, 'custom', RegistryType.REG_SZ);
  registry.setValue(ACCENT_PATH, CUSTOM_HEX_VALUE, normalized, RegistryType.REG_SZ);
  setAccentColorHex(normalized);

  return {
    selectedColor: 'custom',
    customColor: normalized
  };
}

function isAccentAutomatic() {
  return loadColorSettings().selectedColor !== 'custom';
}

const api = {
  loadColorSettings,
  saveColorSettings,
  setAccentColorHex,
  getAccentColorHex,
  isAccentAutomatic,
  DEFAULT_HEX
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}

if (typeof window !== 'undefined') {
  window.ColorRegistry = api;
}
