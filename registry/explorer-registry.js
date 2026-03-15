;(function (root) {
  const globalRef = root || {};

  if (globalRef.ExplorerRegistry) {
    if (typeof module !== 'undefined' && module.exports) {
      module.exports = globalRef.ExplorerRegistry;
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
      console.debug('[ExplorerRegistry] Unable to require registry module (node context):', error);
    }
  }

  if (!registryModule && typeof window !== 'undefined' && typeof window.require === 'function') {
    try {
      registryModule = window.require('./registry/registry.js');
    } catch (error) {
      if (typeof console !== 'undefined' && console.debug) {
        console.debug('[ExplorerRegistry] Unable to require registry module (window context):', error);
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
          console.warn('[ExplorerRegistry] Fallback encodeJSONBinary failed:', error);
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
          console.warn('[ExplorerRegistry] Fallback decodeJSONBinary failed:', error);
          return null;
        }
      });

  const WINDOW_STATE_PATH = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\WindowState';
  const WINDOW_STATE_VALUE = 'LastActiveWindow';
  const LEGACY_STORAGE_KEY = 'ExplorerEngineDesktopSettings';

  let registryUnavailableWarned = false;

  function getRegistrySafe() {
    if (typeof getRegistryFn !== 'function') {
      if (!registryUnavailableWarned) {
        console.warn('[ExplorerRegistry] Registry API unavailable');
        registryUnavailableWarned = true;
      }
      return null;
    }
    return getRegistryFn();
  }

  function cloneDeep(value) {
    if (value == null) {
      return value;
    }
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return value;
    }
  }

  function readLegacyState() {
    if (typeof window === 'undefined' || !window.localStorage) {
      return null;
    }

    try {
      const raw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (error) {
      console.warn('[ExplorerRegistry] Failed to read legacy explorer state from localStorage:', error);
      return null;
    }
  }

  function clearLegacyState() {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }

    try {
      window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch (error) {
      console.warn('[ExplorerRegistry] Failed to clear legacy explorer state key:', error);
    }
  }

  function decodeState(raw) {
    if (!decodeJSONBinary || !raw) {
      return null;
    }

    try {
      const decoded = decodeJSONBinary(raw);
      return decoded && typeof decoded === 'object' ? decoded : null;
    } catch (error) {
      console.warn('[ExplorerRegistry] Failed to decode explorer state from registry:', error);
      return null;
    }
  }

  function encodeState(state) {
    if (!encodeJSONBinary) {
      return [];
    }

    try {
      return Array.from(encodeJSONBinary(state));
    } catch (error) {
      console.warn('[ExplorerRegistry] Failed to encode explorer state for registry:', error);
      return [];
    }
  }

  function loadExplorerDesktopState(defaultState = null) {
    const registry = getRegistrySafe();
    let state = null;

    if (registry) {
      try {
        const raw = registry.getValue(WINDOW_STATE_PATH, WINDOW_STATE_VALUE, null);
        state = decodeState(raw);
      } catch (error) {
        console.error('[ExplorerRegistry] Failed to load explorer state from registry:', error);
        state = null;
      }
    }

    if (!state) {
      const legacy = readLegacyState();
      if (legacy) {
        state = saveExplorerDesktopState(legacy);
      }
    } else {
      clearLegacyState();
    }

    if (state) {
      return cloneDeep(state);
    }

    return cloneDeep(defaultState);
  }

  function saveExplorerDesktopState(state) {
    const registry = getRegistrySafe();
    const normalized = state && typeof state === 'object' ? cloneDeep(state) : {};

    if (registry) {
      try {
        const encoded = encodeState(normalized);
        registry.setValue(
          WINDOW_STATE_PATH,
          WINDOW_STATE_VALUE,
          encoded,
          registryTypes.REG_BINARY
        );
      } catch (error) {
        console.error('[ExplorerRegistry] Failed to save explorer state to registry:', error);
      }
    } else {
      console.warn('[ExplorerRegistry] Registry unavailable; explorer state not persisted');
    }

    clearLegacyState();
    return normalized;
  }

  const api = {
    loadExplorerDesktopState,
    saveExplorerDesktopState
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (typeof globalRef !== 'undefined') {
    globalRef.ExplorerRegistry = api;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
