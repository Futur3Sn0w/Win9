/**
 * Market Manager
 * Handles fetching the remote app catalog, installing/uninstalling apps,
 * and managing both remote (webview) and local (downloaded) install modes.
 */

class MarketManager {
    constructor() {
        /** @type {string} Base URL of the market repo (GitHub Pages root) */
        this.baseUrl = '';

        /** @type {Array} Lightweight catalog entries from directory.json */
        this.catalogEntries = [];

        /** @type {Map<string, object>} Full app manifests keyed by app ID */
        this.manifests = new Map();

        /** @type {Set<string>} IDs of installed market apps */
        this.installedAppIds = new Set();

        /** @type {boolean} Whether the manager has been initialized */
        this.initialized = false;
    }

    /**
     * Initialize the market manager.
     * @param {string} baseUrl - The base URL of the market repository (GitHub Pages root)
     */
    async init(baseUrl) {
        if (this.initialized) return;

        this.baseUrl = baseUrl.replace(/\/+$/, '');

        try {
            await this.loadCatalog();
            this.loadInstalledApps();
            this.initialized = true;
            console.log('[MarketManager] Initialized with', this.catalogEntries.length, 'catalog entries');
            console.log('[MarketManager] Installed apps:', Array.from(this.installedAppIds));
        } catch (error) {
            console.error('[MarketManager] Failed to initialize:', error);
        }
    }

    /**
     * Load the catalog index from remote directory.json
     */
    async loadCatalog() {
        const url = `${this.baseUrl}/directory.json`;
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status} fetching ${url}`);
            }
            const data = await response.json();
            this.catalogEntries = Array.isArray(data.apps) ? data.apps : [];
        } catch (error) {
            console.error('[MarketManager] Failed to load catalog:', error);
            throw error;
        }
    }

    /**
     * Load installed app IDs and their cached manifests from the registry.
     */
    loadInstalledApps() {
        const registry = window.MarketRegistry;
        if (!registry || typeof registry.loadInstalledMarketApps !== 'function') {
            console.warn('[MarketManager] MarketRegistry unavailable');
            this.installedAppIds = new Set();
            return;
        }

        const appIds = registry.loadInstalledMarketApps();
        this.installedAppIds = new Set(Array.isArray(appIds) ? appIds : []);

        // Load cached manifests for installed apps
        this.installedAppIds.forEach(appId => {
            const cached = registry.loadMarketAppData(appId);
            if (cached) {
                this.manifests.set(appId, cached);
            }
        });
    }

    /**
     * Fetch the full manifest (app.json) for a given catalog entry.
     * Caches the result in this.manifests.
     * @param {string} appId
     * @returns {Promise<object|null>}
     */
    async fetchManifest(appId) {
        // Return cached if available
        if (this.manifests.has(appId)) {
            return this.manifests.get(appId);
        }

        const entry = this.catalogEntries.find(e => e.id === appId);
        if (!entry || !entry.manifestUrl) {
            console.warn('[MarketManager] No catalog entry for:', appId);
            return null;
        }

        const url = `${this.baseUrl}/${entry.manifestUrl}?_=${Date.now()}`;
        try {
            const response = await fetch(url, { cache: 'no-store' });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status} fetching ${url}`);
            }
            const manifest = await response.json();
            this.manifests.set(appId, manifest);
            return manifest;
        } catch (error) {
            console.error('[MarketManager] Failed to fetch manifest for', appId, ':', error);
            return null;
        }
    }

    /**
     * Fetch all manifests for all catalog entries.
     * @returns {Promise<object[]>}
     */
    async fetchAllManifests() {
        const promises = this.catalogEntries.map(entry => this.fetchManifest(entry.id));
        const results = await Promise.allSettled(promises);
        return results
            .filter(r => r.status === 'fulfilled' && r.value)
            .map(r => r.value);
    }

    /**
     * Get all loaded manifests.
     * @returns {object[]}
     */
    getAllManifests() {
        return Array.from(this.manifests.values());
    }

    /**
     * Get a manifest by app ID (from cache).
     * @param {string} appId
     * @returns {object|null}
     */
    getManifest(appId) {
        return this.manifests.get(appId) || null;
    }

    /**
     * Check if an app is installed.
     * @param {string} appId
     * @returns {boolean}
     */
    isInstalled(appId) {
        return this.installedAppIds.has(appId);
    }

    /**
     * Install an app based on its manifest requirements.
     * - remote: registers the app with a webview URL pointing to GitHub Pages
     * - local: downloads all files and registers a local path
     *
     * @param {string} appId
     * @param {function} [onProgress] - Optional progress callback (stage, percent)
     * @returns {Promise<{success: boolean, message: string, app?: object}>}
     */
    async installApp(appId, onProgress) {
        const manifest = await this.fetchManifest(appId);
        if (!manifest) {
            return { success: false, message: `App not found: ${appId}` };
        }

        if (this.isInstalled(appId)) {
            return { success: false, message: `${manifest.name} is already installed` };
        }

        const installMode = manifest.requirements?.installMode || 'remote';

        try {
            let appDefinition;

            if (installMode === 'local') {
                if (onProgress) onProgress('downloading', 0);
                appDefinition = await this.installLocal(manifest, onProgress);
            } else {
                if (onProgress) onProgress('registering', 0);
                appDefinition = this.installRemote(manifest);
            }

            // Mark as installed
            this.installedAppIds.add(appId);
            this.saveInstalledApps();

            // Cache manifest in registry for offline access
            const registry = window.MarketRegistry;
            if (registry && typeof registry.saveMarketAppData === 'function') {
                registry.saveMarketAppData(appId, manifest);
            }

            // Notify parent window
            if (window.parent && window.parent !== window) {
                window.parent.postMessage({
                    type: 'MARKET_APP_INSTALLED',
                    app: appDefinition
                }, '*');
            }

            if (onProgress) onProgress('complete', 100);
            console.log('[MarketManager] Installed:', appId, '(mode:', installMode + ')');

            return {
                success: true,
                message: `${manifest.name} has been installed successfully!`,
                app: appDefinition
            };
        } catch (error) {
            console.error('[MarketManager] Install failed for', appId, ':', error);
            // Rollback
            this.installedAppIds.delete(appId);
            this.saveInstalledApps();
            return { success: false, message: `Failed to install ${manifest.name}: ${error.message}` };
        }
    }

    /**
     * Install a remote app — register it with a webview URL.
     * No files are downloaded; the app loads from GitHub Pages at launch time.
     * @param {object} manifest
     * @returns {object} App definition compatible with apps.json format
     */
    installRemote(manifest) {
        const catalogEntry = this.catalogEntries.find(e => e.id === manifest.id);
        const manifestDir = catalogEntry?.manifestUrl
            ? catalogEntry.manifestUrl.substring(0, catalogEntry.manifestUrl.lastIndexOf('/'))
            : `apps/${manifest.id}`;

        const appDef = {
            id: manifest.id,
            name: manifest.name,
            icon: manifest.icon,
            color: manifest.color || 'blue',
            size: manifest.size || 'normal',
            pinned: false,
            category: manifest.category || 'apps',
            type: manifest.type || 'modern',
            source: 'market',
            installMode: 'remote'
        };

        // If the manifest defines a webview, use it directly
        if (manifest.webview && manifest.webview.enabled) {
            appDef.webview = { ...manifest.webview };
            // Build a path that uses the entry point on GitHub Pages as fallback
            appDef.path = `${this.baseUrl}/${manifestDir}/${manifest.entryPoint || 'index.html'}`;
        } else {
            // Non-webview remote app — load it in an iframe from GitHub Pages
            appDef.path = `${this.baseUrl}/${manifestDir}/${manifest.entryPoint || 'index.html'}`;
        }

        if (manifest.windowOptions) {
            appDef.windowOptions = { ...manifest.windowOptions };
        }

        if (manifest.appbar) {
            appDef.appbar = manifest.appbar;
        }

        // Resolve logo from manifest files — prefer SVG (resolution-independent),
        // fall back to PNG/JPG. Sets logoImage (app list / taskbar) and
        // tileImages.default (Start screen tiles at all sizes).
        const logoFile = Array.isArray(manifest.files) && (
            manifest.files.find(f => /resources\/logo\.svg$/i.test(f)) ||
            manifest.files.find(f => /resources\/logo\.(png|jpg)$/i.test(f))
        );
        if (logoFile) {
            const logoUrl = `${this.baseUrl}/${manifestDir}/${logoFile}`;
            appDef.logoImage = logoUrl;
            appDef.tileImages = { default: logoUrl };
        }

        return appDef;
    }

    /**
     * Install a local app — download all files from the manifest's file list,
     * save them to the local filesystem, and register a local path.
     * @param {object} manifest
     * @param {function} [onProgress]
     * @returns {Promise<object>} App definition compatible with apps.json format
     */
    async installLocal(manifest, onProgress) {
        const catalogEntry = this.catalogEntries.find(e => e.id === manifest.id);
        const manifestDir = catalogEntry?.manifestUrl
            ? catalogEntry.manifestUrl.substring(0, catalogEntry.manifestUrl.lastIndexOf('/'))
            : `apps/${manifest.id}`;

        const files = manifest.files || [manifest.entryPoint || 'index.html'];
        const totalFiles = files.length;

        // Request the main process to create the app directory and download files
        const localAppPath = await this.downloadAppFiles(manifest.id, manifestDir, files, (index, fileName) => {
            if (onProgress) {
                const percent = Math.round(((index + 1) / totalFiles) * 90);
                onProgress('downloading', percent, {
                    currentFile: fileName,
                    fileIndex: index + 1,
                    totalFiles: totalFiles
                });
            }
        });

        const appDef = {
            id: manifest.id,
            name: manifest.name,
            icon: manifest.icon,
            color: manifest.color || 'blue',
            size: manifest.size || 'normal',
            pinned: false,
            category: manifest.category || 'apps',
            type: manifest.type || 'modern',
            path: `${localAppPath}/${manifest.entryPoint || 'index.html'}`,
            source: 'market',
            installMode: 'local'
        };

        if (manifest.loadDirect) {
            appDef.loadDirect = true;
        }

        if (manifest.webview && manifest.webview.enabled) {
            appDef.webview = { ...manifest.webview };
        }

        if (manifest.windowOptions) {
            appDef.windowOptions = { ...manifest.windowOptions };
        }

        if (manifest.tileOptions) {
            appDef.tileOptions = { ...manifest.tileOptions };
        }

        if (manifest.appbar) {
            appDef.appbar = manifest.appbar;
        }

        // Build logo/tile image paths from downloaded resources
        this.applyLocalAssetPaths(appDef, manifest, localAppPath);

        return appDef;
    }

    /**
     * Populate logoImage and tile image paths for a locally installed app
     * based on what files are included in the manifest.
     * @param {object} appDef - The app definition to modify
     * @param {object} manifest - The app manifest
     * @param {string} localAppPath - The local install directory
     */
    applyLocalAssetPaths(appDef, manifest, localAppPath) {
        const files = manifest.files || [];
        const resourceFiles = files.filter(f => f.startsWith('resources/'));

        // Logo — prefer SVG (resolution-independent), fall back to PNG
        const logoFile = resourceFiles.includes('resources/logo.svg')
            ? 'resources/logo.svg'
            : resourceFiles.includes('resources/logo.png')
                ? 'resources/logo.png'
                : null;
        if (logoFile) {
            const logoUrl = `${localAppPath}/${logoFile}`;
            appDef.logoImage = logoUrl;
            appDef.tileImages = { default: logoUrl };
            appDef.splashImage = logoUrl;
        }

        // Tile images — build from available scale files
        const tileTypes = ['tiletiny', 'tilesmall', 'tilewide', 'tilelarge'];
        const scales = ['80', '100'];

        for (const tileType of tileTypes) {
            for (const scale of scales) {
                const fileName = `resources/${tileType}.scale-${scale}.png`;
                if (resourceFiles.includes(fileName)) {
                    // At least one tile resource exists — the path-guesser in
                    // apps-manager will construct the right paths as long as
                    // we set the base correctly. But since local market apps
                    // use a non-standard base path, we need to signal that
                    // the resources are available.
                    if (!appDef._marketResourceBase) {
                        appDef._marketResourceBase = `${localAppPath}/resources`;
                    }
                }
            }
        }
    }

    /**
     * Get a reference to ipcRenderer, either directly (if Node integration
     * is available) or via the parent window.
     * @returns {object|null}
     */
    getIpc() {
        // Try direct require (works in webview/nodeintegration contexts)
        try {
            if (typeof require === 'function') {
                return require('electron').ipcRenderer;
            }
        } catch (e) { /* not available */ }

        // Try parent window (works when running inside an iframe)
        try {
            if (window.parent && window.parent !== window && window.parent.require) {
                return window.parent.require('electron').ipcRenderer;
            }
        } catch (e) { /* cross-origin or unavailable */ }

        // Try top window
        try {
            if (window.top && window.top !== window && window.top.require) {
                return window.top.require('electron').ipcRenderer;
            }
        } catch (e) { /* cross-origin or unavailable */ }

        return null;
    }

    /**
     * Download app files from the remote market repo to local storage.
     * Uses Electron IPC to write files via the main process.
     * @param {string} appId
     * @param {string} remoteDir - Remote directory path relative to baseUrl
     * @param {string[]} files - List of file paths relative to the app directory
     * @param {function} [onFileComplete] - Callback called with file index after each download
     * @returns {Promise<string>} Local path where files were saved
     */
    async downloadAppFiles(appId, remoteDir, files, onFileComplete) {
        const ipc = this.getIpc();
        if (!ipc) {
            throw new Error('Electron IPC unavailable — cannot download files');
        }

        // Ask main process for the app install path
        // Normalize to forward slashes so paths work in browser URL contexts
        const localPath = (await ipc.invoke('market-get-app-path', appId)).replace(/\\/g, '/');

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const remoteUrl = `${this.baseUrl}/${remoteDir}/${file}`;

            const response = await fetch(remoteUrl);
            if (!response.ok) {
                throw new Error(`Failed to download ${file}: HTTP ${response.status}`);
            }

            const content = await response.arrayBuffer();
            const saveResult = await ipc.invoke('market-save-file', {
                appId: appId,
                filePath: file,
                data: Array.from(new Uint8Array(content))
            });

            if (saveResult && !saveResult.success) {
                throw new Error(`Failed to save ${file}: ${saveResult.error}`);
            }

            if (onFileComplete) onFileComplete(i, file);
        }

        return localPath;
    }

    /**
     * Uninstall an app.
     * @param {string} appId
     * @returns {Promise<{success: boolean, message: string}>}
     */
    async uninstallApp(appId) {
        const manifest = this.getManifest(appId);
        const appName = manifest?.name || appId;

        if (!this.isInstalled(appId)) {
            return { success: false, message: `${appName} is not installed` };
        }

        try {
            const installMode = manifest?.requirements?.installMode || 'remote';

            // If locally installed, clean up downloaded files
            if (installMode === 'local') {
                try {
                    const ipc = this.getIpc();
                    if (ipc) {
                        await ipc.invoke('market-remove-app', appId);
                    }
                } catch (cleanupError) {
                    console.warn('[MarketManager] Failed to clean up local files for', appId, ':', cleanupError);
                }
            }

            // Remove from installed set
            this.installedAppIds.delete(appId);
            this.saveInstalledApps();

            // Remove cached manifest from registry and in-memory cache
            this.manifests.delete(appId);
            const registry = window.MarketRegistry;
            if (registry && typeof registry.removeMarketAppData === 'function') {
                registry.removeMarketAppData(appId);
            }

            // Notify parent window
            if (window.parent && window.parent !== window) {
                window.parent.postMessage({
                    type: 'MARKET_APP_UNINSTALLED',
                    appId: appId
                }, '*');
            }

            console.log('[MarketManager] Uninstalled:', appId);

            return {
                success: true,
                message: `${appName} has been uninstalled.`
            };
        } catch (error) {
            console.error('[MarketManager] Uninstall failed for', appId, ':', error);
            // Rollback
            this.installedAppIds.add(appId);
            this.saveInstalledApps();
            return { success: false, message: `Failed to uninstall ${appName}: ${error.message}` };
        }
    }

    /**
     * Persist the installed app set to the registry.
     */
    saveInstalledApps() {
        const registry = window.MarketRegistry;
        if (!registry || typeof registry.saveInstalledMarketApps !== 'function') {
            console.warn('[MarketManager] MarketRegistry unavailable; not persisted');
            return;
        }

        try {
            registry.saveInstalledMarketApps(Array.from(this.installedAppIds));
        } catch (error) {
            console.error('[MarketManager] Failed to save installed apps:', error);
        }
    }

    /**
     * Build an app definition from a cached manifest (for apps-manager integration).
     * Used at startup to reconstruct installed market apps without re-fetching.
     * @param {string} appId
     * @returns {object|null}
     */
    async buildAppDefinition(appId) {
        const manifest = this.getManifest(appId);
        if (!manifest) return null;

        const installMode = manifest.requirements?.installMode || 'remote';

        if (installMode === 'remote') {
            return this.installRemote(manifest);
        }

        // Resolve the actual install path via IPC (or fall back to relative)
        let localAppPath = `market-apps/${manifest.id}`;
        const ipc = this.getIpc();
        if (ipc) {
            try {
                localAppPath = (await ipc.invoke('market-get-app-path', manifest.id)).replace(/\\/g, '/');
            } catch (e) { /* fall back to relative */ }
        }

        // For local apps, reconstruct the path from the expected install location
        const appDef = {
            id: manifest.id,
            name: manifest.name,
            icon: manifest.icon,
            color: manifest.color || 'blue',
            size: manifest.size || 'normal',
            pinned: false,
            category: manifest.category || 'apps',
            type: manifest.type || 'modern',
            path: `${localAppPath}/${manifest.entryPoint || 'index.html'}`,
            source: 'market',
            installMode: 'local'
        };

        if (manifest.loadDirect) {
            appDef.loadDirect = true;
        }

        if (manifest.webview && manifest.webview.enabled) {
            appDef.webview = { ...manifest.webview };
        }

        if (manifest.windowOptions) {
            appDef.windowOptions = { ...manifest.windowOptions };
        }

        if (manifest.tileOptions) {
            appDef.tileOptions = { ...manifest.tileOptions };
        }

        if (manifest.appbar) {
            appDef.appbar = manifest.appbar;
        }

        // Rebuild asset paths so tile images resolve correctly
        this.applyLocalAssetPaths(appDef, manifest, localAppPath);

        return appDef;
    }

    /**
     * Get all installed app definitions (for apps-manager integration).
     * @returns {object[]}
     */
    async getInstalledAppDefinitions() {
        const defs = [];
        for (const appId of this.installedAppIds) {
            const def = await this.buildAppDefinition(appId);
            if (def) defs.push(def);
        }
        return defs;
    }

    /**
     * Format a human-readable requirements summary for display.
     * @param {object} manifest
     * @returns {Array<{label: string, value: string}>}
     */
    getRequirementsSummary(manifest) {
        const reqs = manifest.requirements || {};
        const summary = [];

        summary.push({
            label: 'Install type',
            value: reqs.installMode === 'local' ? 'Downloaded to device' : 'Runs from cloud'
        });

        summary.push({
            label: 'Internet required',
            value: reqs.internet !== false ? 'Yes' : 'No'
        });

        if (reqs.minVersion) {
            summary.push({
                label: 'Minimum version',
                value: reqs.minVersion
            });
        }

        if (reqs.permissions && reqs.permissions.length > 0) {
            summary.push({
                label: 'Permissions',
                value: reqs.permissions.join(', ')
            });
        }

        if (reqs.diskSpace) {
            summary.push({
                label: 'Install size',
                value: reqs.diskSpace
            });
        }

        return summary;
    }
}

// Create global instance
if (typeof window !== 'undefined') {
    window.marketManager = new MarketManager();
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = MarketManager;
}
