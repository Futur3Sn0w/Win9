;(function (root) {
  const globalRef = root || {};

  if (globalRef.MarketRegistry) {
    if (typeof module !== 'undefined' && module.exports) {
      module.exports = globalRef.MarketRegistry;
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
      console.debug('[MarketRegistry] Unable to require registry module (node context):', error);
    }
  }

  if (!registryModule && typeof window !== 'undefined' && typeof window.require === 'function') {
    try {
      registryModule = window.require('./registry/registry.js');
    } catch (error) {
      if (typeof console !== 'undefined' && console.debug) {
        console.debug('[MarketRegistry] Unable to require registry module (window context):', error);
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
          RegistryType: api.RegistryType || { REG_SZ: 1, REG_MULTI_SZ: 7 }
        };
        break;
      }
    }
  }

  const getRegistryFn = registryModule ? registryModule.getRegistry : null;
  const registryTypes = registryModule
    ? registryModule.RegistryType
    : { REG_SZ: 1, REG_MULTI_SZ: 7 };

  const MARKET_PATH = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Appx\\Market';
  const INSTALLED_IDS_VALUE = 'InstalledApps';
  const APP_DATA_PREFIX = 'AppData_';

  let registryUnavailableWarned = false;

  function getRegistrySafe() {
    if (typeof getRegistryFn !== 'function') {
      if (!registryUnavailableWarned) {
        console.warn('[MarketRegistry] Registry API unavailable');
        registryUnavailableWarned = true;
      }
      return null;
    }
    return getRegistryFn();
  }

  function normalizeAppIds(value) {
    const seen = new Set();
    const result = [];

    if (Array.isArray(value)) {
      value.forEach(entry => {
        if (typeof entry === 'string' && entry.trim().length > 0) {
          const trimmed = entry.trim();
          if (!seen.has(trimmed)) {
            seen.add(trimmed);
            result.push(trimmed);
          }
        }
      });
      return result;
    }

    if (value && typeof value === 'object') {
      Object.keys(value).forEach(key => {
        const entry = value[key];
        if (entry && typeof entry === 'object') {
          if (typeof entry.data === 'string') {
            const trimmed = entry.data.trim();
            if (trimmed && !seen.has(trimmed)) {
              seen.add(trimmed);
              result.push(trimmed);
            }
          } else if (Array.isArray(entry.data)) {
            entry.data.forEach(item => {
              if (typeof item === 'string' && item.trim().length > 0) {
                const trimmed = item.trim();
                if (!seen.has(trimmed)) {
                  seen.add(trimmed);
                  result.push(trimmed);
                }
              }
            });
          }
        }
      });
      return result;
    }

    if (typeof value === 'string' && value.trim().length > 0) {
      return [value.trim()];
    }

    return result;
  }

  /**
   * Load the list of installed market app IDs.
   */
  function loadInstalledMarketApps() {
    const registry = getRegistrySafe();
    if (!registry) return [];

    try {
      const raw = registry.getValue(MARKET_PATH, INSTALLED_IDS_VALUE, []);
      return normalizeAppIds(raw);
    } catch (error) {
      console.error('[MarketRegistry] Failed to load installed market apps:', error);
      return [];
    }
  }

  /**
   * Save the list of installed market app IDs.
   */
  function saveInstalledMarketApps(appIds) {
    const normalized = normalizeAppIds(appIds);
    const registry = getRegistrySafe();

    if (registry) {
      try {
        registry.setValue(MARKET_PATH, INSTALLED_IDS_VALUE, normalized, registryTypes.REG_MULTI_SZ);
      } catch (error) {
        console.error('[MarketRegistry] Failed to save installed market apps:', error);
      }
    } else {
      console.warn('[MarketRegistry] Registry unavailable; installed market apps not persisted');
    }

    return normalized;
  }

  /**
   * Save full app manifest data for an installed market app.
   * This allows us to reconstruct the app definition without re-fetching from remote.
   */
  function saveMarketAppData(appId, appData) {
    const registry = getRegistrySafe();
    if (!registry) return;

    try {
      const serialized = JSON.stringify(appData);
      registry.setValue(MARKET_PATH, APP_DATA_PREFIX + appId, serialized, registryTypes.REG_SZ);
    } catch (error) {
      console.error('[MarketRegistry] Failed to save app data for', appId, ':', error);
    }
  }

  /**
   * Load full app manifest data for an installed market app.
   */
  function loadMarketAppData(appId) {
    const registry = getRegistrySafe();
    if (!registry) return null;

    try {
      const raw = registry.getValue(MARKET_PATH, APP_DATA_PREFIX + appId, null);
      if (!raw) return null;

      const str = (typeof raw === 'object' && raw.data) ? raw.data : raw;
      if (typeof str !== 'string') return null;

      return JSON.parse(str);
    } catch (error) {
      console.error('[MarketRegistry] Failed to load app data for', appId, ':', error);
      return null;
    }
  }

  /**
   * Remove app manifest data for an uninstalled market app.
   */
  function removeMarketAppData(appId) {
    const registry = getRegistrySafe();
    if (!registry) return;

    try {
      registry.deleteValue(MARKET_PATH, APP_DATA_PREFIX + appId);
    } catch (error) {
      console.debug('[MarketRegistry] Failed to remove app data for', appId, ':', error);
    }
  }

  const api = {
    loadInstalledMarketApps,
    saveInstalledMarketApps,
    saveMarketAppData,
    loadMarketAppData,
    removeMarketAppData
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (typeof globalRef !== 'undefined') {
    globalRef.MarketRegistry = api;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
