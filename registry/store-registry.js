;(function (root) {
  const globalRef = root || {};

  if (globalRef.StoreRegistry) {
    if (typeof module !== 'undefined' && module.exports) {
      module.exports = globalRef.StoreRegistry;
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
      console.debug('[StoreRegistry] Unable to require registry module (node context):', error);
    }
  }

  if (!registryModule && typeof window !== 'undefined' && typeof window.require === 'function') {
    try {
      registryModule = window.require('./registry/registry.js');
    } catch (error) {
      if (typeof console !== 'undefined' && console.debug) {
        console.debug('[StoreRegistry] Unable to require registry module (window context):', error);
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
          RegistryType: api.RegistryType || { REG_MULTI_SZ: 7 }
        };
        break;
      }
    }
  }

  const getRegistryFn = registryModule ? registryModule.getRegistry : null;
  const registryTypes = registryModule ? registryModule.RegistryType : { REG_MULTI_SZ: 7 };

  const INSTALLED_PACKAGES_PATH = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Appx\\PackageRepository\\InstalledPackages';
  const INSTALLED_PACKAGES_VALUE = 'Packages';
  const LEGACY_STORAGE_KEY = 'installedStoreApps';

  let registryUnavailableWarned = false;

  function getRegistrySafe() {
    if (typeof getRegistryFn !== 'function') {
      if (!registryUnavailableWarned) {
        console.warn('[StoreRegistry] Registry API unavailable');
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

  function readLegacyInstalledApps() {
    if (typeof window === 'undefined' || !window.localStorage) {
      return [];
    }

    try {
      const stored = window.localStorage.getItem(LEGACY_STORAGE_KEY);
      if (!stored) {
        return [];
      }
      const parsed = JSON.parse(stored);
      return normalizeAppIds(parsed);
    } catch (error) {
      console.warn('[StoreRegistry] Failed to read legacy installed apps from localStorage:', error);
      return [];
    }
  }

  function clearLegacyInstalledApps() {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }

    try {
      window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch (error) {
      console.warn('[StoreRegistry] Failed to clear legacy installed apps key:', error);
    }
  }

  function loadInstalledStoreApps() {
    const registry = getRegistrySafe();
    let installed = [];

    if (registry) {
      try {
        const raw = registry.getValue(INSTALLED_PACKAGES_PATH, INSTALLED_PACKAGES_VALUE, []);
        installed = normalizeAppIds(raw);
      } catch (error) {
        console.error('[StoreRegistry] Failed to load installed apps from registry:', error);
        installed = [];
      }
    }

    if (installed.length === 0) {
      const legacy = readLegacyInstalledApps();
      if (legacy.length > 0) {
        installed = saveInstalledStoreApps(legacy);
      }
    } else {
      clearLegacyInstalledApps();
    }

    return installed;
  }

  function saveInstalledStoreApps(appIds) {
    const normalized = normalizeAppIds(appIds);
    const registry = getRegistrySafe();

    if (registry) {
      try {
        registry.setValue(
          INSTALLED_PACKAGES_PATH,
          INSTALLED_PACKAGES_VALUE,
          normalized,
          registryTypes.REG_MULTI_SZ
        );
      } catch (error) {
        console.error('[StoreRegistry] Failed to save installed apps to registry:', error);
      }
    } else {
      console.warn('[StoreRegistry] Registry unavailable; installed store apps not persisted');
    }

    clearLegacyInstalledApps();
    return normalized;
  }

  const api = {
    loadInstalledStoreApps,
    saveInstalledStoreApps
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (typeof globalRef !== 'undefined') {
    globalRef.StoreRegistry = api;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
