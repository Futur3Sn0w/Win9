/**
 * Control Panel color registry utilities
 *
 * Persists the classic personalization color (ui-wall-color) separately from the
 * modern accent color so the two surfaces can operate independently.
 */

const { getRegistry, RegistryType } = require('./registry.js');

const PERSONALIZE_PATH = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Simulator\\ControlPanelColor';
const MODE_VALUE = 'Mode';
const COLOR_VALUE = 'CustomHex';
const DEFAULT_COLOR = '#0078D7';

function normalizeHex(hex) {
  if (!hex || typeof hex !== 'string') {
    return DEFAULT_COLOR;
  }

  let value = hex.trim();

  if (!value.startsWith('#')) {
    value = `#${value}`;
  }

  if (/^#[0-9A-Fa-f]{6}$/.test(value)) {
    return value.toUpperCase();
  }

  if (/^#[0-9A-Fa-f]{3}$/.test(value)) {
    // Expand shorthand hex (#RGB => #RRGGBB)
    const r = value[1];
    const g = value[2];
    const b = value[3];
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }

  return DEFAULT_COLOR;
}

function loadControlPanelColor() {
  try {
    const registry = getRegistry();
    const mode = registry.getValue(PERSONALIZE_PATH, MODE_VALUE, 'automatic');
    const storedHex = registry.getValue(PERSONALIZE_PATH, COLOR_VALUE, null);

    if (mode === 'custom' && typeof storedHex === 'string') {
      return {
        mode: 'custom',
        color: normalizeHex(storedHex)
      };
    }

    return {
      mode: 'automatic',
      color: DEFAULT_COLOR
    };
  } catch (error) {
    console.warn('[ControlPanelColorRegistry] Failed to load wall color settings:', error);
    return {
      mode: 'automatic',
      color: DEFAULT_COLOR
    };
  }
}

function saveControlPanelColor({ mode = 'automatic', color = DEFAULT_COLOR } = {}) {
  try {
    const registry = getRegistry();
    const normalizedMode = mode === 'custom' ? 'custom' : 'automatic';

    registry.setValue(
      PERSONALIZE_PATH,
      MODE_VALUE,
      normalizedMode,
      RegistryType.REG_SZ
    );

    if (normalizedMode === 'custom') {
      registry.setValue(
        PERSONALIZE_PATH,
        COLOR_VALUE,
        normalizeHex(color),
        RegistryType.REG_SZ
      );
    } else {
      registry.deleteValue(PERSONALIZE_PATH, COLOR_VALUE);
    }
  } catch (error) {
    console.error('[ControlPanelColorRegistry] Failed to save wall color settings:', error);
  }
}

function isControlPanelColorAutomatic() {
  return loadControlPanelColor().mode !== 'custom';
}

module.exports = {
  loadControlPanelColor,
  saveControlPanelColor,
  isControlPanelColorAutomatic
};

if (typeof window !== 'undefined') {
  window.ControlPanelColorRegistry = module.exports;
}
