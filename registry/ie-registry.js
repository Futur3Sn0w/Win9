;(function (root) {
  const globalRef = root || {};

  if (globalRef.IERegistry) {
    if (typeof module !== 'undefined' && module.exports) {
      module.exports = globalRef.IERegistry;
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
      console.debug('[IERegistry] Unable to require registry module (node context):', error);
    }
  }

  if (!registryModule && typeof window !== 'undefined' && typeof window.require === 'function') {
    try {
      registryModule = window.require('./registry/registry.js');
    } catch (error) {
      if (typeof console !== 'undefined' && console.debug) {
        console.debug('[IERegistry] Unable to require registry module (window context):', error);
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
          RegistryType: api.RegistryType || { REG_BINARY: 3 },
          encodeJSONBinary: api.encodeJSONBinary || null,
          decodeJSONBinary: api.decodeJSONBinary || null
        };
        break;
      }
    }
  }

  const getRegistryFn = registryModule ? registryModule.getRegistry : null;
  const registryTypes = registryModule ? registryModule.RegistryType : { REG_BINARY: 3 };

  const fallbackEncoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
  const fallbackDecoder = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;

  const encodeJSONBinary = registryModule && registryModule.encodeJSONBinary
    ? registryModule.encodeJSONBinary
    : (data => {
        try {
          const json = JSON.stringify(data);
          if (!fallbackEncoder) {
            return [];
          }
          return fallbackEncoder.encode(json);
        } catch (error) {
          console.warn('[IERegistry] Fallback encodeJSONBinary failed:', error);
          return [];
        }
      });

  const decodeJSONBinary = registryModule && registryModule.decodeJSONBinary
    ? registryModule.decodeJSONBinary
    : (raw => {
        if (!raw || !fallbackDecoder) {
          return null;
        }
        try {
          const uint8 = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
          const json = fallbackDecoder.decode(uint8);
          return JSON.parse(json);
        } catch (error) {
          console.warn('[IERegistry] Fallback decodeJSONBinary failed:', error);
          return null;
        }
      });

  const FAVORITES_PATH = 'HKCU\\Software\\Microsoft\\Internet Explorer\\Favorites';
  const FAVORITES_VALUE = 'FavoritesList';
  const LEGACY_STORAGE_KEY = 'ie-favorites';

  let registryUnavailableWarned = false;

  function getRegistrySafe() {
    if (typeof getRegistryFn !== 'function') {
      if (!registryUnavailableWarned) {
        console.warn('[IERegistry] Registry API unavailable');
        registryUnavailableWarned = true;
      }
      return null;
    }
    return getRegistryFn();
  }

  function normalizeFavorites(list) {
    if (!Array.isArray(list)) {
      return [];
    }

    return list
      .map(item => (item && typeof item === 'object') ? { ...item } : null)
      .filter(Boolean);
  }

  function readLegacyFavorites() {
    if (typeof window === 'undefined' || !window.localStorage) {
      return [];
    }

    try {
      const stored = window.localStorage.getItem(LEGACY_STORAGE_KEY);
      if (!stored) {
        return [];
      }
      const parsed = JSON.parse(stored);
      return normalizeFavorites(parsed);
    } catch (error) {
      console.warn('[IERegistry] Failed to read legacy favorites from localStorage:', error);
      return [];
    }
  }

  function clearLegacyFavorites() {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }

    try {
      window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch (error) {
      console.warn('[IERegistry] Failed to clear legacy favorites key:', error);
    }
  }

  function decodeFavorites(raw) {
    if (!decodeJSONBinary || !raw) {
      return [];
    }

    try {
      const decoded = decodeJSONBinary(raw);
      return normalizeFavorites(decoded);
    } catch (error) {
      console.warn('[IERegistry] Failed to decode favorites from registry:', error);
      return [];
    }
  }

  function encodeFavorites(favorites) {
    if (!encodeJSONBinary) {
      return [];
    }

    try {
      const binary = encodeJSONBinary(favorites);
      return Array.from(binary);
    } catch (error) {
      console.warn('[IERegistry] Failed to encode favorites for registry:', error);
      return [];
    }
  }

  function loadFavorites() {
    const registry = getRegistrySafe();
    let favorites = [];

    if (registry) {
      try {
        const raw = registry.getValue(FAVORITES_PATH, FAVORITES_VALUE, null);
        favorites = decodeFavorites(raw);
      } catch (error) {
        console.error('[IERegistry] Failed to load favorites from registry:', error);
        favorites = [];
      }
    }

    if (!favorites.length) {
      const legacy = readLegacyFavorites();
      if (legacy.length) {
        favorites = saveFavorites(legacy);
      }
    } else {
      clearLegacyFavorites();
    }

    return favorites;
  }

  function saveFavorites(favorites) {
    const normalized = normalizeFavorites(favorites);
    const registry = getRegistrySafe();

    if (registry) {
      try {
        const encoded = encodeFavorites(normalized);
        registry.setValue(
          FAVORITES_PATH,
          FAVORITES_VALUE,
          encoded,
          registryTypes.REG_BINARY
        );
      } catch (error) {
        console.error('[IERegistry] Failed to save favorites to registry:', error);
      }
    } else {
      console.warn('[IERegistry] Registry unavailable; favorites not persisted');
    }

    clearLegacyFavorites();
    return normalized;
  }

  const api = {
    loadFavorites,
    saveFavorites
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (typeof globalRef !== 'undefined') {
    globalRef.IERegistry = api;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
