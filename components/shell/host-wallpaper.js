(() => {
    const WALLPAPER_CHANGED_EVENT = 'shell-host-wallpaper-changed';

    let electronIpc = null;
    try {
        ({ ipcRenderer: electronIpc } = require('electron'));
    } catch (error) {
        console.debug('[ShellHostWallpaper] ipcRenderer unavailable:', error.message || error);
    }

    const listeners = new Set();
    let loadPromise = null;
    let initialized = false;
    let currentWallpaper = createDefaultWallpaper();

    function normalizeString(value) {
        if (typeof value !== 'string') {
            return '';
        }

        return value.trim();
    }

    function toAbsoluteAssetUrl(assetPath) {
        const normalizedPath = normalizeString(assetPath);
        if (!normalizedPath) {
            return '';
        }

        if (/^(?:data:|file:|https?:|blob:)/i.test(normalizedPath)) {
            return normalizedPath;
        }

        try {
            return new URL(normalizedPath, window.location.href).href;
        } catch (error) {
            console.warn('[ShellHostWallpaper] Failed to resolve asset URL:', normalizedPath, error);
            return normalizedPath;
        }
    }

    function createDefaultWallpaper() {
        return {
            wallpaperPath: '',
            imageUrl: '',
            hasHostWallpaper: false,
            sourceKind: '',
            sourcePlatform: typeof process !== 'undefined' ? process.platform : 'unknown'
        };
    }

    function normalizeWallpaper(rawWallpaper) {
        const fallbackWallpaper = createDefaultWallpaper();
        const wallpaperPath = normalizeString(rawWallpaper && rawWallpaper.wallpaperPath);

        return {
            wallpaperPath,
            imageUrl: toAbsoluteAssetUrl(wallpaperPath),
            hasHostWallpaper: Boolean(rawWallpaper && rawWallpaper.hasHostWallpaper && wallpaperPath),
            sourceKind: normalizeString(rawWallpaper && rawWallpaper.sourceKind) || fallbackWallpaper.sourceKind,
            sourcePlatform: normalizeString(rawWallpaper && rawWallpaper.sourcePlatform) || fallbackWallpaper.sourcePlatform
        };
    }

    function getWallpaper() {
        return { ...currentWallpaper };
    }

    function notifyWallpaperChanged() {
        const snapshot = getWallpaper();
        listeners.forEach((listener) => {
            try {
                listener(snapshot);
            } catch (error) {
                console.error('[ShellHostWallpaper] Listener failed:', error);
            }
        });

        if (typeof window.dispatchEvent === 'function' && typeof window.CustomEvent === 'function') {
            window.dispatchEvent(new CustomEvent(WALLPAPER_CHANGED_EVENT, { detail: snapshot }));
        }
    }

    async function loadWallpaper(options = {}) {
        const forceRefresh = Boolean(options && options.forceRefresh);
        if (!forceRefresh && loadPromise) {
            return loadPromise;
        }

        const requestPromise = (async () => {
            if (!electronIpc || typeof electronIpc.invoke !== 'function') {
                currentWallpaper = createDefaultWallpaper();
                notifyWallpaperChanged();
                return getWallpaper();
            }

            try {
                const rawWallpaper = await electronIpc.invoke('shell:get-host-wallpaper', {
                    refresh: forceRefresh
                });
                currentWallpaper = normalizeWallpaper(rawWallpaper);
            } catch (error) {
                console.warn('[ShellHostWallpaper] Failed to load host wallpaper:', error);
                currentWallpaper = createDefaultWallpaper();
            }

            notifyWallpaperChanged();
            return getWallpaper();
        })();

        loadPromise = requestPromise;
        requestPromise.finally(() => {
            if (loadPromise === requestPromise) {
                loadPromise = null;
            }
        });

        return requestPromise;
    }

    function subscribe(listener) {
        if (typeof listener !== 'function') {
            return () => {};
        }

        listeners.add(listener);
        return () => {
            listeners.delete(listener);
        };
    }

    function initialize() {
        if (initialized) {
            return loadWallpaper();
        }

        initialized = true;
        return loadWallpaper();
    }

    window.ShellHostWallpaper = {
        getWallpaper,
        loadWallpaper,
        subscribe,
        initialize,
        WALLPAPER_CHANGED_EVENT
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            initialize();
        }, { once: true });
    } else {
        initialize();
    }
})();
