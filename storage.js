/**
 * Storage Abstraction Layer
 *
 * This module provides a unified storage interface using electron-store
 * for backward compatibility with settings not yet migrated to the registry.
 */

const Store = require('electron-store');

// Initialize the store
const store = new Store({
  name: 'config',
});

/**
 * Storage wrapper class providing backward-compatible API
 * Works similarly to localStorage but uses electron-store underneath
 */
class Storage {
  /**
   * Get a value from storage
   * @param {string} key - Storage key
   * @param {*} fallback - Optional fallback value if key doesn't exist
   * @returns {*} Stored value or fallback
   */
  getItem(key, fallback = null) {
    return store.has(key) ? store.get(key) : fallback;
  }

  /**
   * Set a value in storage
   * @param {string} key - Storage key
   * @param {*} value - Value to store (automatically serialized)
   */
  setItem(key, value) {
    store.set(key, value);
  }

  /**
   * Remove a value from storage
   * @param {string} key - Storage key
   */
  removeItem(key) {
    store.delete(key);
  }

  /**
   * Check if a key exists in storage
   * @param {string} key - Storage key
   * @returns {boolean}
   */
  has(key) {
    return store.has(key);
  }

  /**
   * Clear all storage (use with caution!)
   */
  clear() {
    store.clear();
  }

  /**
   * Get the underlying electron-store instance
   * Useful for advanced operations
   */
  get store() {
    return store;
  }

  /**
   * Get the path to the storage file
   */
  get path() {
    return store.path;
  }

  /**
   * Export all storage data as JSON
   * This will be used for the .wsd export feature
   */
  export() {
    return {
      version: '1.0',
      exportDate: new Date().toISOString(),
      data: store.store // Get all data
    };
  }

  /**
   * Import storage data from JSON
   * This will be used for the .wsd import feature
   *
   * @param {Object} data - The data object to import
   * @param {boolean} merge - If true, merge with existing data. If false, replace all data.
   */
  import(data, merge = true) {
    if (!data || !data.data) {
      throw new Error('Invalid import data format');
    }

    if (merge) {
      // Merge with existing data
      Object.keys(data.data).forEach(key => {
        store.set(key, data.data[key]);
      });
    } else {
      // Replace all data
      store.clear();
      store.store = data.data;
    }

    console.log(`[Storage] Imported ${Object.keys(data.data).length} keys (merge: ${merge})`);
  }
}

// Create singleton instance
const storage = new Storage();

// Export both the class and the singleton
module.exports = {
  Storage,
  storage,
  store // Export raw store for advanced use cases
};
