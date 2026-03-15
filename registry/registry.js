/**
 * Windows Registry API
 *
 * Provides a Windows Registry-like API for the Windows 8 simulator.
 * Uses electron-store as the backend storage with authentic Windows registry paths.
 *
 * Features:
 * - Authentic Windows 8 registry paths
 * - Binary data encoding (StuckRects2, AccentPalette, etc.)
 * - Type-safe value access (REG_DWORD, REG_SZ, REG_BINARY, etc.)
 * - Hierarchical path navigation
 * - Change notifications
 * - Migration from flat storage
 */

const Store = require('electron-store');

// ============================================================================
// CONSTANTS & TYPE DEFINITIONS
// ============================================================================

/**
 * Registry data types (matching Windows registry)
 */
const RegistryType = {
  REG_NONE: 0,           // No value type
  REG_SZ: 1,             // String (null-terminated)
  REG_EXPAND_SZ: 2,      // String with environment variables
  REG_BINARY: 3,         // Binary data
  REG_DWORD: 4,          // 32-bit number (DWORD)
  REG_DWORD_LITTLE_ENDIAN: 4,  // Same as REG_DWORD
  REG_DWORD_BIG_ENDIAN: 5,     // 32-bit number (big-endian)
  REG_LINK: 6,           // Symbolic link
  REG_MULTI_SZ: 7,       // Array of strings
  REG_RESOURCE_LIST: 8,  // Resource list
  REG_QWORD: 11,         // 64-bit number
  REG_QWORD_LITTLE_ENDIAN: 11  // Same as REG_QWORD
};

/**
 * Registry root keys (hives)
 */
const RootKey = {
  HKEY_CLASSES_ROOT: 'HKEY_CLASSES_ROOT',
  HKEY_CURRENT_USER: 'HKEY_CURRENT_USER',
  HKEY_LOCAL_MACHINE: 'HKEY_LOCAL_MACHINE',
  HKEY_USERS: 'HKEY_USERS',
  HKEY_CURRENT_CONFIG: 'HKEY_CURRENT_CONFIG',

  // Abbreviations
  HKCR: 'HKEY_CLASSES_ROOT',
  HKCU: 'HKEY_CURRENT_USER',
  HKLM: 'HKEY_LOCAL_MACHINE',
  HKU: 'HKEY_USERS',
  HKCC: 'HKEY_CURRENT_CONFIG'
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Parse a registry path into root key and subpath
 * @param {string} path - Registry path (e.g., "HKCU\\Software\\Microsoft\\Windows")
 * @returns {Object} - { rootKey, subPath, parts }
 */
function parsePath(path) {
  if (!path || typeof path !== 'string') {
    throw new Error('Invalid registry path');
  }

  // Split by backslash (Windows path separator)
  const parts = path.split('\\').filter(p => p.length > 0);

  if (parts.length === 0) {
    throw new Error('Empty registry path');
  }

  // First part is the root key
  let rootKey = parts[0].toUpperCase();

  // Expand abbreviations
  if (rootKey === 'HKCU') rootKey = RootKey.HKEY_CURRENT_USER;
  else if (rootKey === 'HKLM') rootKey = RootKey.HKEY_LOCAL_MACHINE;
  else if (rootKey === 'HKCR') rootKey = RootKey.HKEY_CLASSES_ROOT;
  else if (rootKey === 'HKU') rootKey = RootKey.HKEY_USERS;
  else if (rootKey === 'HKCC') rootKey = RootKey.HKEY_CURRENT_CONFIG;

  // Validate root key
  if (!Object.values(RootKey).includes(rootKey)) {
    throw new Error(`Invalid root key: ${parts[0]}`);
  }

  const subPath = parts.slice(1);

  return {
    rootKey,
    subPath,
    parts: [rootKey, ...subPath]
  };
}

/**
 * Navigate to a nested object using a path array
 * Creates intermediate objects if create=true
 * @param {Object} obj - Root object
 * @param {Array} path - Array of keys
 * @param {boolean} create - Create missing keys
 * @returns {Object} - Target object or null
 */
function navigatePath(obj, path, create = false) {
  let current = obj;

  for (let i = 0; i < path.length; i++) {
    const key = path[i];

    if (current[key] === undefined) {
      if (create) {
        current[key] = {};
      } else {
        return null;
      }
    }

    current = current[key];
  }

  return current;
}

/**
 * Convert hex color to ARGB DWORD
 * @param {string} hex - Hex color (e.g., "#464646")
 * @returns {number} - ARGB DWORD (0xAABBGGRR)
 */
function hexToARGB(hex) {
  if (!hex || typeof hex !== 'string') {
    return 0xFF000000; // Default: opaque black
  }

  // Remove # if present
  hex = hex.replace('#', '');

  // Parse RGB
  const r = parseInt(hex.slice(0, 2), 16) || 0;
  const g = parseInt(hex.slice(2, 4), 16) || 0;
  const b = parseInt(hex.slice(4, 6), 16) || 0;
  const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) : 0xFF;

  // ARGB format: Alpha in high byte, then Blue, Green, Red
  return (a << 24) | (b << 16) | (g << 8) | r;
}

/**
 * Convert ARGB DWORD to hex color
 * @param {number} argb - ARGB DWORD (0xAABBGGRR)
 * @returns {string} - Hex color (e.g., "#464646")
 */
function argbToHex(argb) {
  const r = (argb & 0xFF).toString(16).padStart(2, '0');
  const g = ((argb >> 8) & 0xFF).toString(16).padStart(2, '0');
  const b = ((argb >> 16) & 0xFF).toString(16).padStart(2, '0');
  // const a = ((argb >> 24) & 0xFF).toString(16).padStart(2, '0');

  return `#${r}${g}${b}`.toUpperCase();
}

// ============================================================================
// BINARY ENCODING/DECODING
// ============================================================================

/**
 * Encode taskbar settings to StuckRects2 binary format (52 bytes)
 * @param {Object} settings - Taskbar settings
 * @returns {Uint8Array} - 52-byte binary blob
 */
function encodeStuckRects2(settings) {
  const buffer = new Uint8Array(52);
  const view = new DataView(buffer.buffer);

  // Bytes 0-3: Version (0x00000028 for Windows 8)
  view.setUint32(0, 0x00000028, true);

  // Bytes 4-7: Unknown/reserved
  view.setUint32(4, 0, true);

  // Byte 8: Taskbar state
  // 0x02 = Auto-hide OFF, always on top OFF
  // 0x03 = Auto-hide ON, always on top OFF
  // 0x0A = Auto-hide OFF, always on top ON
  // 0x0B = Auto-hide ON, always on top ON
  let stateByte = 0x02;
  if (settings.autoHide) stateByte |= 0x01;
  if (settings.alwaysOnTop) stateByte |= 0x08;
  buffer[8] = stateByte;

  // Byte 9: Lock state (0x00 = unlocked, 0x01 = locked)
  buffer[9] = settings.locked ? 0x01 : 0x00;

  // Bytes 10-11: Unknown/reserved
  buffer[10] = 0;
  buffer[11] = 0;

  // Bytes 12-15: Taskbar height (DWORD, little-endian)
  view.setUint32(12, settings.height || 40, true);

  // Bytes 16-19: Taskbar position (DWORD)
  // 0=left, 1=top, 2=right, 3=bottom
  view.setUint32(16, settings.position !== undefined ? settings.position : 3, true);

  // Bytes 20-35: Taskbar rectangle (RECT: left, top, right, bottom)
  // For now, use mock values based on position and height
  const screenWidth = 1920;
  const screenHeight = 1080;
  const height = settings.height || 40;

  switch (settings.position || 3) {
    case 0: // Left
      view.setInt32(20, 0, true);
      view.setInt32(24, 0, true);
      view.setInt32(28, height, true);
      view.setInt32(32, screenHeight, true);
      break;
    case 1: // Top
      view.setInt32(20, 0, true);
      view.setInt32(24, 0, true);
      view.setInt32(28, screenWidth, true);
      view.setInt32(32, height, true);
      break;
    case 2: // Right
      view.setInt32(20, screenWidth - height, true);
      view.setInt32(24, 0, true);
      view.setInt32(28, screenWidth, true);
      view.setInt32(32, screenHeight, true);
      break;
    case 3: // Bottom (default)
    default:
      view.setInt32(20, 0, true);
      view.setInt32(24, screenHeight - height, true);
      view.setInt32(28, screenWidth, true);
      view.setInt32(32, screenHeight, true);
      break;
  }

  // Bytes 36-47: Monitor rectangle (same as screen for single monitor)
  view.setInt32(36, 0, true);
  view.setInt32(40, 0, true);
  view.setInt32(44, screenWidth, true);
  view.setInt32(48, screenHeight, true);

  return buffer;
}

/**
 * Decode StuckRects2 binary format to taskbar settings
 * @param {Uint8Array|Array} buffer - 52-byte binary blob
 * @returns {Object} - Taskbar settings
 */
function decodeStuckRects2(buffer) {
  if (!buffer || buffer.length < 48) {
    // Return defaults if invalid (accept 48 or 52 bytes for compatibility)
    return {
      autoHide: false,
      alwaysOnTop: false,
      locked: true,
      height: 40,
      position: 3
    };
  }

  // Convert to Uint8Array if needed
  const uint8Array = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(uint8Array.buffer);

  const stateByte = uint8Array[8];

  return {
    autoHide: (stateByte & 0x01) !== 0,
    alwaysOnTop: (stateByte & 0x08) !== 0,
    locked: uint8Array[9] === 0x01,
    height: view.getUint32(12, true),
    position: view.getUint32(16, true)
  };
}

/**
 * Encode accent palette to binary format (32 bytes = 8 colors × 4 bytes ARGB)
 * @param {Array} colors - Array of 8 hex colors
 * @returns {Uint8Array} - 32-byte binary blob
 */
function encodeAccentPalette(colors) {
  const buffer = new Uint8Array(32);

  for (let i = 0; i < 8 && i < colors.length; i++) {
    const argb = hexToARGB(colors[i]);
    const offset = i * 4;

    // Store as ARGB (4 bytes per color)
    buffer[offset] = (argb >> 24) & 0xFF;  // Alpha
    buffer[offset + 1] = (argb >> 16) & 0xFF;  // Blue
    buffer[offset + 2] = (argb >> 8) & 0xFF;   // Green
    buffer[offset + 3] = argb & 0xFF;           // Red
  }

  return buffer;
}

/**
 * Decode accent palette from binary format
 * @param {Uint8Array|Array} buffer - 32-byte binary blob
 * @returns {Array} - Array of 8 hex colors
 */
function decodeAccentPalette(buffer) {
  if (!buffer || buffer.length < 32) {
    // Return default palette
    return [
      '#A6D8FF', '#76B9ED', '#429CE3', '#0078D7',
      '#005A9E', '#004275', '#002652', '#F7630C'
    ];
  }

  const uint8Array = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const colors = [];

  for (let i = 0; i < 8; i++) {
    const offset = i * 4;
    const a = uint8Array[offset];
    const b = uint8Array[offset + 1];
    const g = uint8Array[offset + 2];
    const r = uint8Array[offset + 3];

    const argb = (a << 24) | (b << 16) | (g << 8) | r;
    colors.push(argbToHex(argb));
  }

  return colors;
}

/**
 * Encode JSON object to binary (for generic storage)
 * @param {*} data - Data to encode
 * @returns {Uint8Array} - Binary blob
 */
function encodeJSONBinary(data) {
  const json = JSON.stringify(data);
  const encoder = new TextEncoder();
  return encoder.encode(json);
}

/**
 * Decode binary to JSON object
 * @param {Uint8Array|Array} buffer - Binary blob
 * @returns {*} - Decoded data
 */
function decodeJSONBinary(buffer) {
  if (!buffer) return null;

  const uint8Array = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const decoder = new TextDecoder();
  const json = decoder.decode(uint8Array);

  try {
    return JSON.parse(json);
  } catch (e) {
    console.error('Failed to decode JSON binary:', e);
    return null;
  }
}

// ============================================================================
// REGISTRY CLASS
// ============================================================================

/**
 * Windows Registry API
 */
class Registry {
  constructor(storeName = 'registry') {
    // Use electron-store for persistence
    this.store = new Store({
      name: storeName,
      // Don't set defaults here - we'll initialize on first use
    });

    // In-memory cache for performance
    this.cache = null;

    // Change listeners
    this.listeners = new Map();

    // Initialize registry structure
    this._initializeRegistry();
  }

  /**
   * Initialize registry structure with default hives
   * @private
   */
  _initializeRegistry() {
    // Load entire registry into cache
    this.cache = this.store.get('registry', null);

    // If no registry exists, create default structure
    if (!this.cache) {
      this.cache = {
        [RootKey.HKEY_CURRENT_USER]: {},
        [RootKey.HKEY_LOCAL_MACHINE]: {},
        [RootKey.HKEY_CLASSES_ROOT]: {},
        [RootKey.HKEY_USERS]: {},
        [RootKey.HKEY_CURRENT_CONFIG]: {}
      };

      this._saveRegistry();
    }
  }

  /**
   * Save registry to persistent storage
   * @private
   */
  _saveRegistry() {
    this.store.set('registry', this.cache);
  }

  /**
   * Get a registry value
   * @param {string} path - Full registry path (e.g., "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StuckRects2\\Settings")
   * @param {string} valueName - Optional value name (if null, returns entire key)
   * @param {*} defaultValue - Default value if not found
   * @returns {*} - Registry value or default
   */
  getValue(path, valueName = null, defaultValue = null) {
    try {
      const { rootKey, subPath } = parsePath(path);

      // Navigate to the key
      let current = this.cache[rootKey];
      if (!current) return defaultValue;

      current = navigatePath(current, subPath, false);
      if (!current) return defaultValue;

      // If valueName specified, return that value
      if (valueName !== null) {
        const valueData = current[valueName];
        if (valueData === undefined) return defaultValue;

        // If it's a registry value object with type and data
        if (valueData && typeof valueData === 'object' && 'type' in valueData && 'data' in valueData) {
          return valueData.data;
        }

        // Otherwise return as-is
        return valueData;
      }

      // Return entire key
      return current;
    } catch (error) {
      console.error(`[Registry] Error getting value at ${path}\\${valueName}:`, error);
      return defaultValue;
    }
  }

  /**
   * Set a registry value
   * @param {string} path - Full registry path
   * @param {string} valueName - Value name
   * @param {*} data - Value data
   * @param {number} type - Registry type (REG_SZ, REG_DWORD, etc.)
   */
  setValue(path, valueName, data, type = RegistryType.REG_SZ) {
    try {
      const { rootKey, subPath } = parsePath(path);

      // Ensure root key exists
      if (!this.cache[rootKey]) {
        this.cache[rootKey] = {};
      }

      // Navigate to the key (create if needed)
      let current = navigatePath(this.cache[rootKey], subPath, true);

      // Store value with type information
      const oldValue = current[valueName];
      current[valueName] = {
        type,
        data
      };

      // Save to disk
      this._saveRegistry();

      // Notify listeners
      this._notifyListeners(path, valueName, oldValue?.data, data);

      return true;
    } catch (error) {
      console.error(`[Registry] Error setting value at ${path}\\${valueName}:`, error);
      return false;
    }
  }

  /**
   * Delete a registry value
   * @param {string} path - Full registry path
   * @param {string} valueName - Value name
   * @returns {boolean} - Success
   */
  deleteValue(path, valueName) {
    try {
      const { rootKey, subPath } = parsePath(path);

      let current = this.cache[rootKey];
      if (!current) return false;

      current = navigatePath(current, subPath, false);
      if (!current) return false;

      const oldValue = current[valueName];
      delete current[valueName];

      this._saveRegistry();
      this._notifyListeners(path, valueName, oldValue?.data, null);

      return true;
    } catch (error) {
      console.error(`[Registry] Error deleting value at ${path}\\${valueName}:`, error);
      return false;
    }
  }

  /**
   * Delete an entire registry key
   * @param {string} path - Full registry path
   * @returns {boolean} - Success
   */
  deleteKey(path) {
    try {
      const { rootKey, subPath } = parsePath(path);

      if (subPath.length === 0) {
        throw new Error('Cannot delete root key');
      }

      let parent = this.cache[rootKey];
      if (!parent) return false;

      // Navigate to parent
      parent = navigatePath(parent, subPath.slice(0, -1), false);
      if (!parent) return false;

      const keyName = subPath[subPath.length - 1];
      delete parent[keyName];

      this._saveRegistry();

      return true;
    } catch (error) {
      console.error(`[Registry] Error deleting key at ${path}:`, error);
      return false;
    }
  }

  /**
   * Check if a registry key exists
   * @param {string} path - Full registry path
   * @returns {boolean}
   */
  keyExists(path) {
    try {
      const { rootKey, subPath } = parsePath(path);

      let current = this.cache[rootKey];
      if (!current) return false;

      current = navigatePath(current, subPath, false);
      return current !== null;
    } catch {
      return false;
    }
  }

  /**
   * Enumerate values in a key
   * @param {string} path - Full registry path
   * @returns {Array} - Array of value names
   */
  enumValues(path) {
    try {
      const key = this.getValue(path);
      if (!key || typeof key !== 'object') return [];

      return Object.keys(key);
    } catch {
      return [];
    }
  }

  /**
   * Enumerate subkeys of a key
   * @param {string} path - Full registry path
   * @returns {Array} - Array of subkey names
   */
  enumKeys(path) {
    try {
      const key = this.getValue(path);
      if (!key || typeof key !== 'object') return [];

      // Subkeys are objects, values have 'type' and 'data'
      return Object.keys(key).filter(k => {
        const item = key[k];
        return item && typeof item === 'object' && !('type' in item && 'data' in item);
      });
    } catch {
      return [];
    }
  }

  /**
   * Watch for changes to a registry value
   * @param {string} path - Full registry path
   * @param {string} valueName - Value name
   * @param {Function} callback - Callback(newValue, oldValue)
   * @returns {Function} - Unsubscribe function
   */
  watch(path, valueName, callback) {
    const key = `${path}\\${valueName}`;

    if (!this.listeners.has(key)) {
      this.listeners.set(key, []);
    }

    this.listeners.get(key).push(callback);

    // Return unsubscribe function
    return () => {
      const callbacks = this.listeners.get(key);
      if (callbacks) {
        const index = callbacks.indexOf(callback);
        if (index > -1) {
          callbacks.splice(index, 1);
        }
      }
    };
  }

  /**
   * Notify listeners of value changes
   * @private
   */
  _notifyListeners(path, valueName, oldValue, newValue) {
    const key = `${path}\\${valueName}`;
    const callbacks = this.listeners.get(key);

    if (callbacks && callbacks.length > 0) {
      callbacks.forEach(cb => {
        try {
          cb(newValue, oldValue);
        } catch (error) {
          console.error('[Registry] Error in change listener:', error);
        }
      });
    }
  }

  /**
   * Export entire registry to JSON
   * @returns {Object} - Complete registry structure
   */
  exportRegistry() {
    return JSON.parse(JSON.stringify(this.cache));
  }

  /**
   * Import registry from JSON
   * @param {Object} data - Registry data
   * @param {boolean} merge - Merge with existing data
   */
  importRegistry(data, merge = false) {
    if (merge) {
      // Merge imported data with existing registry
      Object.keys(data).forEach(rootKey => {
        if (!this.cache[rootKey]) {
          this.cache[rootKey] = {};
        }
        this._deepMerge(this.cache[rootKey], data[rootKey]);
      });
    } else {
      // Replace entire registry
      this.cache = data;
    }

    this._saveRegistry();
  }

  /**
   * Deep merge two objects
   * @private
   */
  _deepMerge(target, source) {
    Object.keys(source).forEach(key => {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        if (!target[key]) {
          target[key] = {};
        }
        this._deepMerge(target[key], source[key]);
      } else {
        target[key] = source[key];
      }
    });
  }

  /**
   * Get the path to the registry file
   */
  get path() {
    return this.store.path;
  }
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Singleton registry instance
 */
let registryInstance = null;

/**
 * Get the singleton registry instance
 * @returns {Registry}
 */
function getRegistry() {
  if (!registryInstance) {
    registryInstance = new Registry();
  }
  return registryInstance;
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  // Classes
  Registry,

  // Constants
  RegistryType,
  RootKey,

  // Binary encoding/decoding
  encodeStuckRects2,
  decodeStuckRects2,
  encodeAccentPalette,
  decodeAccentPalette,
  encodeJSONBinary,
  decodeJSONBinary,

  // Conversion utilities
  hexToARGB,
  argbToHex,

  // Path utilities
  parsePath,

  // Singleton
  getRegistry
};
