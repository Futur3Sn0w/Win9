;(function (root) {
  const globalRef = root || {};

  if (globalRef.SettingsRegistry) {
    if (typeof module !== 'undefined' && module.exports) {
      module.exports = globalRef.SettingsRegistry;
    }
    return;
  }

  let registryModule = null;

try {
  if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
    registryModule = require('./registry.js');
  } else if (typeof require === 'function') {
    registryModule = require('./registry/registry.js');
  }
} catch (error) {
  if (typeof console !== 'undefined' && console.debug) {
    console.debug('[SettingsRegistry] Unable to require registry module (node context):', error);
  }
}

if (!registryModule && typeof window !== 'undefined' && typeof window.require === 'function') {
  try {
    registryModule = window.require('./registry/registry.js');
  } catch (error) {
    if (typeof console !== 'undefined' && console.debug) {
      console.debug('[SettingsRegistry] Unable to require registry module (window context):', error);
    }
  }
  }

  if (!registryModule) {
    const fallbacks = [
      globalRef.RegistryAPI,
      globalRef.parent && globalRef.parent.RegistryAPI,
      globalRef.top && globalRef.top.RegistryAPI
    ];

    for (const api of fallbacks) {
      if (api && typeof api.getRegistry === 'function') {
        registryModule = {
          getRegistry: api.getRegistry,
          RegistryType: api.RegistryType || { REG_DWORD: 4 }
        };
        break;
      }
    }
  }

  const getRegistryFn = registryModule ? registryModule.getRegistry : null;
  const registryTypes = registryModule ? registryModule.RegistryType : { REG_DWORD: 4 };

  const BRIGHTNESS_PATH = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\SettingSync\\Settings\\display';
  const BRIGHTNESS_VALUE = 'BrightnessLevel';
  const LEGACY_BRIGHTNESS_KEY = 'systemBrightnessLevel';

  let registryUnavailableWarned = false;

  function getRegistrySafe() {
    if (typeof getRegistryFn !== 'function') {
      if (!registryUnavailableWarned) {
        console.warn('[SettingsRegistry] Registry API unavailable');
        registryUnavailableWarned = true;
      }
      return null;
    }
    return getRegistryFn();
  }

  function readLegacyBrightness() {
    if (typeof window === 'undefined' || !window.localStorage) {
      return null;
    }

    try {
      const stored = window.localStorage.getItem(LEGACY_BRIGHTNESS_KEY);
      if (stored == null) {
        return null;
      }
      const number = Number(stored);
      return Number.isFinite(number) ? number : null;
    } catch (error) {
      console.warn('[SettingsRegistry] Failed to read legacy brightness from localStorage:', error);
      return null;
    }
  }

  function clearLegacyBrightness() {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }

    try {
      window.localStorage.removeItem(LEGACY_BRIGHTNESS_KEY);
    } catch (error) {
      console.warn('[SettingsRegistry] Failed to clear legacy brightness key:', error);
    }
  }

  function loadBrightnessLevel(defaultValue = null) {
    const registry = getRegistrySafe();
    let level = null;

    if (registry) {
      try {
        const raw = registry.getValue(BRIGHTNESS_PATH, BRIGHTNESS_VALUE, null);
        if (typeof raw === 'number') {
          level = raw;
        }
      } catch (error) {
        console.error('[SettingsRegistry] Failed to load brightness from registry:', error);
        level = null;
      }
    }

    if (level == null) {
      const legacy = readLegacyBrightness();
      if (legacy != null) {
        level = legacy;
        saveBrightnessLevel(level);
      }
    } else {
      clearLegacyBrightness();
    }

    if (level == null) {
      level = defaultValue != null ? defaultValue : 100;
    }

    return level;
  }

  function saveBrightnessLevel(level) {
    const registry = getRegistrySafe();
    const normalized = Number(level);
    const value = Number.isFinite(normalized) ? Math.max(0, Math.min(100, Math.round(normalized))) : 100;

    if (registry) {
      try {
        registry.setValue(
          BRIGHTNESS_PATH,
          BRIGHTNESS_VALUE,
          value,
          registryTypes.REG_DWORD
        );
      } catch (error) {
        console.error('[SettingsRegistry] Failed to save brightness to registry:', error);
      }
    } else {
      console.warn('[SettingsRegistry] Registry unavailable; brightness not persisted');
    }

    clearLegacyBrightness();
    return value;
  }

  const api = {
    loadBrightnessLevel,
    saveBrightnessLevel
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (typeof globalRef !== 'undefined') {
    globalRef.SettingsRegistry = api;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
