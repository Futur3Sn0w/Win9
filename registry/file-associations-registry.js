;(function (root) {
  const globalRef = root || {};

  if (globalRef.FileAssociationsRegistry) {
    if (typeof module !== 'undefined' && module.exports) {
      module.exports = globalRef.FileAssociationsRegistry;
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
      console.debug('[FileAssociationsRegistry] Unable to require registry module (node context):', error);
    }
  }

  if (!registryModule && typeof window !== 'undefined' && typeof window.require === 'function') {
    try {
      registryModule = window.require('./registry/registry.js');
    } catch (error) {
      if (typeof console !== 'undefined' && console.debug) {
        console.debug('[FileAssociationsRegistry] Unable to require registry module (window context):', error);
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
          return fallbackEncoder ? fallbackEncoder.encode(json) : [];
        } catch (error) {
          console.warn('[FileAssociationsRegistry] Fallback encodeJSONBinary failed:', error);
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
          return JSON.parse(fallbackDecoder.decode(uint8));
        } catch (error) {
          console.warn('[FileAssociationsRegistry] Fallback decodeJSONBinary failed:', error);
          return null;
        }
      });

  const OPEN_WITH_PATH = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileAssociations';
  const OPEN_WITH_VALUE = 'UserOpenChoices';

  let warnedUnavailable = false;

  function getRegistrySafe() {
    if (typeof getRegistryFn !== 'function') {
      if (!warnedUnavailable) {
        console.warn('[FileAssociationsRegistry] Registry API unavailable');
        warnedUnavailable = true;
      }
      return null;
    }

    return getRegistryFn();
  }

  function normalizeExtension(extension) {
    if (!extension || typeof extension !== 'string') {
      return '';
    }

    return extension.startsWith('.') ? extension.toLowerCase() : `.${extension.toLowerCase()}`;
  }

  function clone(value) {
    if (value == null) {
      return value;
    }

    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return value;
    }
  }

  function loadOpenChoiceMap() {
    const registry = getRegistrySafe();
    if (!registry) {
      return {};
    }

    try {
      const raw = registry.getValue(OPEN_WITH_PATH, OPEN_WITH_VALUE, null);
      const decoded = decodeJSONBinary(raw);
      return decoded && typeof decoded === 'object' ? decoded : {};
    } catch (error) {
      console.error('[FileAssociationsRegistry] Failed to load open choices:', error);
      return {};
    }
  }

  function saveOpenChoiceMap(map) {
    const registry = getRegistrySafe();
    const normalized = map && typeof map === 'object' ? clone(map) : {};

    if (!registry) {
      return normalized;
    }

    try {
      const encoded = Array.from(encodeJSONBinary(normalized));
      registry.setValue(
        OPEN_WITH_PATH,
        OPEN_WITH_VALUE,
        encoded,
        registryTypes.REG_BINARY
      );
    } catch (error) {
      console.error('[FileAssociationsRegistry] Failed to save open choices:', error);
    }

    return normalized;
  }

  function getOpenChoice(extension) {
    const normalizedExtension = normalizeExtension(extension);
    if (!normalizedExtension) {
      return null;
    }

    const map = loadOpenChoiceMap();
    return map[normalizedExtension] ? clone(map[normalizedExtension]) : null;
  }

  function saveOpenChoice(extension, choice) {
    const normalizedExtension = normalizeExtension(extension);
    if (!normalizedExtension || !choice || typeof choice !== 'object') {
      return null;
    }

    const map = loadOpenChoiceMap();
    map[normalizedExtension] = clone(choice);
    saveOpenChoiceMap(map);
    return clone(map[normalizedExtension]);
  }

  function removeOpenChoice(extension) {
    const normalizedExtension = normalizeExtension(extension);
    if (!normalizedExtension) {
      return false;
    }

    const map = loadOpenChoiceMap();
    if (!(normalizedExtension in map)) {
      return false;
    }

    delete map[normalizedExtension];
    saveOpenChoiceMap(map);
    return true;
  }

  const api = {
    loadOpenChoiceMap,
    getOpenChoice,
    saveOpenChoice,
    removeOpenChoice
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (typeof globalRef !== 'undefined') {
    globalRef.FileAssociationsRegistry = api;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
