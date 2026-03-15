/**
 * Store Manager Component
 * Handles installation and uninstallation of apps from the Microsoft Store
 * Integrates with the main apps-manager to persist changes
 */

class StoreManager {
    constructor() {
        this.storeApps = [];
        this.installedAppIds = new Set();
        this.initialized = false;
    }

    /**
     * Initialize the store manager
     * Load store directory and track installed apps
     */
    async init() {
        if (this.initialized) return;

        try {
            // Load store directory
            await this.loadStoreDirectory();

            // Load installed apps from registry
            await this.loadInstalledApps();

            this.initialized = true;
            console.log('StoreManager initialized with', this.storeApps.length, 'store apps');
            console.log('Currently installed store apps:', Array.from(this.installedAppIds));
        } catch (error) {
            console.error('Failed to initialize StoreManager:', error);
        }
    }

    /**
     * Load the store directory from msstoredirectory.json
     */
    async loadStoreDirectory() {
        try {
            const response = await fetch('msstoredirectory.json');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            this.storeApps = data.apps || [];
        } catch (error) {
            console.error('Failed to load store directory:', error);
            throw error;
        }
    }

    /**
     * Load installed apps from registry (includes legacy migration)
     */
    async loadInstalledApps() {
        try {
            const registry = window.StoreRegistry;
            if (!registry || typeof registry.loadInstalledStoreApps !== 'function') {
                console.warn('StoreRegistry API unavailable; installed apps state may not persist');
                this.installedAppIds = new Set();
                return;
            }

            const appIds = registry.loadInstalledStoreApps();
            this.installedAppIds = new Set(Array.isArray(appIds) ? appIds : []);
        } catch (error) {
            console.error('Failed to load installed apps from registry:', error);
            this.installedAppIds = new Set();
        }
    }

    /**
     * Get all available store apps
     */
    getStoreApps() {
        return this.storeApps;
    }

    /**
     * Get app by ID from store
     */
    getStoreAppById(appId) {
        return this.storeApps.find(app => app.id === appId);
    }

    /**
     * Check if an app is installed
     */
    isInstalled(appId) {
        return this.installedAppIds.has(appId);
    }

    /**
     * Install an app
     * Adds the app to the main apps registry and persists the change
     */
    async installApp(appId) {
        const app = this.getStoreAppById(appId);
        if (!app) {
            throw new Error(`App not found in store: ${appId}`);
        }

        if (this.isInstalled(appId)) {
            console.log('App already installed:', appId);
            return { success: false, message: 'App is already installed' };
        }

        try {
            // Add to installed apps set
            this.installedAppIds.add(appId);

            // Persist via registry
            this.saveInstalledApps();

            // Notify parent window (main app) about the installation
            if (window.parent && window.parent !== window) {
                window.parent.postMessage({
                    type: 'STORE_APP_INSTALLED',
                    app: app
                }, '*');
            }

            console.log('App installed successfully:', appId);

            return {
                success: true,
                message: `${app.name} has been installed successfully!`,
                app: app
            };
        } catch (error) {
            console.error('Failed to install app:', error);
            // Rollback on error
            this.installedAppIds.delete(appId);
            throw error;
        }
    }

    /**
     * Uninstall an app
     * Removes the app from the main apps registry and persists the change
     */
    async uninstallApp(appId) {
        const app = this.getStoreAppById(appId);
        if (!app) {
            throw new Error(`App not found in store: ${appId}`);
        }

        if (!this.isInstalled(appId)) {
            console.log('App not installed:', appId);
            return { success: false, message: 'App is not installed' };
        }

        try {
            // Remove from installed apps set
            this.installedAppIds.delete(appId);

            // Persist via registry
            this.saveInstalledApps();

            // Notify parent window (main app) about the uninstallation
            if (window.parent && window.parent !== window) {
                window.parent.postMessage({
                    type: 'STORE_APP_UNINSTALLED',
                    appId: appId
                }, '*');
            }

            console.log('App uninstalled successfully:', appId);

            return {
                success: true,
                message: `${app.name} has been uninstalled.`,
                app: app
            };
        } catch (error) {
            console.error('Failed to uninstall app:', error);
            // Rollback on error
            this.installedAppIds.add(appId);
            this.saveInstalledApps();
            throw error;
        }
    }

    /**
     * Save installed apps to registry
     */
    saveInstalledApps() {
        const registry = window.StoreRegistry;
        if (!registry || typeof registry.saveInstalledStoreApps !== 'function') {
            console.warn('StoreRegistry API unavailable; installed apps not persisted');
            return;
        }

        try {
            const appIds = Array.from(this.installedAppIds);
            registry.saveInstalledStoreApps(appIds);
        } catch (error) {
            console.error('Failed to save installed apps to registry:', error);
            throw error;
        }
    }

    /**
     * Get app description for display
     */
    getAppDescription(app) {
        const descriptions = {
            'connections': 'Find the connection between words in this daily puzzle game from The New York Times.',
            'strands': 'Uncover the hidden theme by finding related words in this word search puzzle.',
            'mini-crossword': 'Quick daily crossword puzzle that can be solved in minutes.'
        };
        return descriptions[app.id] || 'A great app for your Windows 8 device.';
    }
}

// Create global instance
if (typeof window !== 'undefined') {
    window.storeManager = new StoreManager();
}

// Export for Node.js environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = StoreManager;
}
