;(function (root) {
  const globalRef = root || {};

  if (globalRef.RunRegistry) {
    if (typeof module !== 'undefined' && module.exports) {
      module.exports = globalRef.RunRegistry;
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
      console.debug('[RunRegistry] Unable to require registry module (node context):', error);
    }
  }

  if (!registryModule && typeof window !== 'undefined' && typeof window.require === 'function') {
    try {
      registryModule = window.require('./registry/registry.js');
    } catch (error) {
      if (typeof console !== 'undefined' && console.debug) {
        console.debug('[RunRegistry] Unable to require registry module (window context):', error);
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

  const RUN_MRU_PATH = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\RunMRU';
  const RUN_HISTORY_VALUE = 'History';
  const LEGACY_HISTORY_KEY = 'runDialogHistory';

  let registryUnavailableWarned = false;

  function getRegistrySafe() {
    if (typeof getRegistryFn !== 'function') {
      if (!registryUnavailableWarned) {
        console.warn('[RunRegistry] Registry API unavailable');
        registryUnavailableWarned = true;
      }
      return null;
    }
    return getRegistryFn();
  }

  function normalizeHistory(list) {
    if (!Array.isArray(list)) {
      return [];
    }
    const result = [];
    const seen = new Set();
    list.forEach(entry => {
      if (typeof entry === 'string') {
        const trimmed = entry.trim();
        if (trimmed && !seen.has(trimmed.toLowerCase())) {
          seen.add(trimmed.toLowerCase());
          result.push(trimmed);
        }
      }
    });
    return result;
  }

  function readLegacyHistory() {
    if (typeof window === 'undefined' || !window.localStorage) {
      return [];
    }

    try {
      const stored = window.localStorage.getItem(LEGACY_HISTORY_KEY);
      if (!stored) {
        return [];
      }
      const parsed = JSON.parse(stored);
      return normalizeHistory(parsed);
    } catch (error) {
      console.warn('[RunRegistry] Failed to read legacy Run history from localStorage:', error);
      return [];
    }
  }

  function clearLegacyHistory() {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }

    try {
      window.localStorage.removeItem(LEGACY_HISTORY_KEY);
    } catch (error) {
      console.warn('[RunRegistry] Failed to clear legacy Run history key:', error);
    }
  }

  function loadRunHistory() {
    const registry = getRegistrySafe();
    let history = [];

    if (registry) {
      try {
        const raw = registry.getValue(RUN_MRU_PATH, RUN_HISTORY_VALUE, []);
        history = normalizeHistory(raw);
      } catch (error) {
        console.error('[RunRegistry] Failed to load Run history from registry:', error);
        history = [];
      }
    }

    if (!history.length) {
      const legacy = readLegacyHistory();
      if (legacy.length) {
        history = saveRunHistory(legacy);
      }
    } else {
      clearLegacyHistory();
    }

    return history;
  }

  function saveRunHistory(historyItems) {
    const normalized = normalizeHistory(historyItems);
    const registry = getRegistrySafe();

    if (registry) {
      try {
        registry.setValue(
          RUN_MRU_PATH,
          RUN_HISTORY_VALUE,
          normalized,
          registryTypes.REG_MULTI_SZ
        );
      } catch (error) {
        console.error('[RunRegistry] Failed to save Run history to registry:', error);
      }
    } else {
      console.warn('[RunRegistry] Registry unavailable; Run history not persisted');
    }

    clearLegacyHistory();
    return normalized;
  }

  const api = {
    loadRunHistory,
    saveRunHistory
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (typeof globalRef !== 'undefined') {
    globalRef.RunRegistry = api;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
