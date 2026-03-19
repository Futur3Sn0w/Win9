/**
 * Apps Manager
 * Handles loading, managing, and persisting app data
 */

const STORE_DIRECTORY_PATH = 'apps/modern/msstore/msstoredirectory.json';
const { pathToFileURL: appsManagerPathToFileURL } = require('url');

function toAssetUrl(path) {
    if (!path || typeof path !== 'string') {
        return path;
    }

    if (path.startsWith('http://') || path.startsWith('https://') ||
        path.startsWith('file://') || path.startsWith('resources/')) {
        return path;
    }

    if (path.startsWith('/') || path.startsWith('\\\\') || /^[A-Z]:[\\/]/i.test(path)) {
        try {
            return appsManagerPathToFileURL(path).href;
        } catch (error) {
            console.warn('[AppsManager] Failed to convert asset path to file URL:', path, error);
        }
    }

    return path;
}

let appsData = null;

// Load apps from JSON file
async function loadApps() {
    try {
        const response = await fetch('apps.json');
        const data = await response.json();
        appsData = Array.isArray(data.apps) ? data.apps : [];

        await mergeInstalledStoreApps();

        applySavedPinState();
        applySavedTaskbarPinState();
        loadTileSizes();

        return appsData;
    } catch (error) {
        console.error('Error loading apps:', error);
        return [];
    }
}

async function mergeInstalledStoreApps() {
    if (!appsData) {
        appsData = [];
    }

    const storeRegistry = window.StoreRegistry;
    let installedIds = [];

    if (storeRegistry && typeof storeRegistry.loadInstalledStoreApps === 'function') {
        try {
            installedIds = storeRegistry.loadInstalledStoreApps();
        } catch (error) {
            console.error('Failed to load installed store apps from registry:', error);
            installedIds = [];
        }
    }

    if (!Array.isArray(installedIds) || installedIds.length === 0) {
        return;
    }

    let storeDirectory = [];
    try {
        const response = await fetch(STORE_DIRECTORY_PATH);
        if (!response.ok) {
            throw new Error(`HTTP error ${response.status}`);
        }
        const directoryData = await response.json();
        storeDirectory = Array.isArray(directoryData.apps) ? directoryData.apps : [];
    } catch (error) {
        console.error('Failed to load Store directory for installed apps:', error);
        return;
    }

    installedIds.forEach(appId => {
        if (appsData.some(app => app.id === appId)) {
            return;
        }

        const storeApp = storeDirectory.find(app => app.id === appId);
        if (!storeApp) {
            console.warn('Installed Store app not found in directory:', appId);
            return;
        }

        const hydratedApp = { ...storeApp };
        if (typeof hydratedApp.pinned === 'undefined') {
            hydratedApp.pinned = false;
        }
        appsData.push(hydratedApp);
    });
}

function applySavedPinState() {
    if (!appsData) {
        return;
    }

    try {
        let pinnedIds = [];

        if (window.TileLayoutRegistry && typeof window.TileLayoutRegistry.loadPinnedApps === 'function') {
            const registryPinned = window.TileLayoutRegistry.loadPinnedApps();
            if (Array.isArray(registryPinned)) {
                pinnedIds = registryPinned;
            }
        }

        if ((!Array.isArray(pinnedIds) || pinnedIds.length === 0) && typeof localStorage !== 'undefined') {
            try {
                const legacyPins = localStorage.getItem('pinnedApps');
                if (legacyPins) {
                    const parsedLegacy = JSON.parse(legacyPins);
                    if (Array.isArray(parsedLegacy)) {
                        pinnedIds = parsedLegacy;
                        if (window.TileLayoutRegistry && typeof window.TileLayoutRegistry.savePinnedApps === 'function') {
                            try {
                                window.TileLayoutRegistry.savePinnedApps(pinnedIds);
                                console.log('[AppsManager] Migrated pinned apps to registry');
                            } catch (migrationError) {
                                console.warn('[AppsManager] Failed to migrate pinned apps to registry:', migrationError);
                            }
                        }
                    }
                }
            } catch (error) {
                console.error('Failed to load legacy pinned apps from localStorage:', error);
            } finally {
                try {
                    localStorage.removeItem('pinnedApps');
                } catch (cleanupError) {
                    console.warn('Failed to remove legacy pinnedApps key:', cleanupError);
                }
            }
        }

        if (!Array.isArray(pinnedIds) || pinnedIds.length === 0) {
            return;
        }

        const pinnedSet = new Set(pinnedIds);
        appsData.forEach(app => {
            app.pinned = pinnedSet.has(app.id);
        });
    } catch (error) {
        console.error('Failed to load pinned apps:', error);
    }
}

function applySavedTaskbarPinState() {
    if (!appsData) {
        return;
    }

    let pinnedIds = [];

    const registry = window.TileLayoutRegistry;
    if (registry && typeof registry.loadTaskbarPins === 'function') {
        try {
            const registryPins = registry.loadTaskbarPins();
            if (Array.isArray(registryPins)) {
                pinnedIds = registryPins;
            }
        } catch (error) {
            console.error('Failed to load taskbar pins from registry:', error);
        }
    }

    if ((!Array.isArray(pinnedIds) || pinnedIds.length === 0) && typeof localStorage !== 'undefined') {
        try {
            const savedTaskbarPins = localStorage.getItem('pinnedTaskbarApps');
            if (savedTaskbarPins) {
                const legacyPins = JSON.parse(savedTaskbarPins);
                if (Array.isArray(legacyPins)) {
                    pinnedIds = legacyPins;
                    if (registry && typeof registry.saveTaskbarPins === 'function') {
                        try {
                            registry.saveTaskbarPins(pinnedIds);
                            console.log('[AppsManager] Migrated taskbar pins to registry');
                        } catch (error) {
                            console.warn('Failed to migrate taskbar pins to registry:', error);
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Failed to access taskbar pins from localStorage:', error);
        } finally {
            try {
                localStorage.removeItem('pinnedTaskbarApps');
            } catch (cleanupError) {
                console.warn('Failed to remove legacy pinnedTaskbarApps key:', cleanupError);
            }
        }
    }

    const pinnedTaskbarSet = new Set(Array.isArray(pinnedIds) ? pinnedIds : []);
    console.log('Loading pinned taskbar apps:', pinnedIds);
    appsData.forEach(app => {
        app.pinnedToTaskbar = pinnedTaskbarSet.has(app.id);
    });
}

// Retrieve the best matching icon image for a given size
function getIconImage(app, desiredSize) {
    if (!app) {
        return null;
    }

    // If app has iconImages, try to find the best match
    if (app.iconImages) {
        const icons = app.iconImages;
        const exactMatch = icons[String(desiredSize)];
        if (exactMatch) {
            return exactMatch;
        }

        const availableSizes = Object.keys(icons)
            .map(size => parseInt(size, 10))
            .filter(size => !Number.isNaN(size))
            .sort((a, b) => a - b);

        if (availableSizes.length > 0) {
            let closestSize = availableSizes[0];
            let smallestDiff = Math.abs(closestSize - desiredSize);
            availableSizes.forEach(size => {
                const diff = Math.abs(size - desiredSize);
                if (diff < smallestDiff) {
                    smallestDiff = diff;
                    closestSize = size;
                }
            });

            return icons[String(closestSize)] || null;
        }
    }

    // No iconImages found - check if this is a classic or meta_classic app
    // If so, use generic_program icon as fallback (MIF icons don't apply here)
    if (app.type === 'classic' || app.type === 'meta_classic') {
        // Map desiredSize to closest available generic_program icon size
        const availableSizes = [16, 20, 24, 32, 40, 48, 64, 256];
        let closestSize = availableSizes[0];
        let smallestDiff = Math.abs(closestSize - desiredSize);

        availableSizes.forEach(size => {
            const diff = Math.abs(size - desiredSize);
            if (diff < smallestDiff) {
                smallestDiff = diff;
                closestSize = size;
            }
        });

        return `resources/images/icons/explorer/generic_program/${closestSize}.png`;
    }

    return null;
}

// Get tile image path for real tile icons
// Returns the path to the tile image based on app ID, tile size, and compact mode
function getTileImage(app, tileSize) {
    if (!app) return null;

    // Determine if we're in compact mode
    const isCompact = document.body.classList.contains('tiles-compact');
    const scale = isCompact ? '80' : '100';

    // Map tile size to the correct image name
    // tiny = small (70px normal, 56px compact)
    // small = medium (150px normal, 120px compact)
    // wide = wide (310x150 normal, 248x120 compact)
    // large = large (310x310 normal, 248x248 compact)
    let imageName;
    if (tileSize === 'small') {
        imageName = 'tiletiny';
    } else if (tileSize === 'wide') {
        imageName = 'tilewide';
    } else if (tileSize === 'large') {
        imageName = 'tilelarge';
    } else {
        // Default/medium size
        imageName = 'tilesmall';
    }

    // Construct the path based on app type and ID
    let basePath;
    if (app.type === 'modern') {
        basePath = `apps/modern/${app.id}/resources`;
    } else if (app.type === 'meta-classic' || app.type === 'meta') {
        basePath = `apps/meta-classic/${app.id}/resources`;
    } else {
        basePath = `apps/${app.id}/resources`;
    }

    const imagePath = `${basePath}/${imageName}.scale-${scale}.png`;

    // We could check if the file exists, but for performance we'll just return the path
    // The browser will handle missing images gracefully
    return imagePath;
}

// Get app list logo image path
function getAppListLogo(app) {
    if (!app) return null;

    // Construct the path based on app type and ID
    let basePath;
    if (app.type === 'modern') {
        basePath = `apps/modern/${app.id}/resources`;
    } else if (app.type === 'meta-classic' || app.type === 'meta') {
        basePath = `apps/meta-classic/${app.id}/resources`;
    } else {
        basePath = `apps/${app.id}/resources`;
    }

    return `${basePath}/logo.png`;
}

// Get largest available tile image for splash screens and animations
// Returns the largest size in order: large -> wide -> small (medium)
function getTileLargeSplash(app) {
    if (!app) return null;

    // Determine if we're in compact mode
    const isCompact = document.body.classList.contains('tiles-compact');
    const scale = isCompact ? '80' : '100';

    // Construct the path based on app type and ID
    let basePath;
    if (app.type === 'modern') {
        basePath = `apps/modern/${app.id}/resources`;
    } else if (app.type === 'meta-classic' || app.type === 'meta') {
        basePath = `apps/meta-classic/${app.id}/resources`;
    } else {
        basePath = `apps/${app.id}/resources`;
    }

    // Try to determine the largest available size based on tileOptions
    // Priority: large > wide > small (medium) > tiny (fallback)
    const tileOptions = app.tileOptions || {};

    if (tileOptions.allowLarge) {
        return `${basePath}/tilelarge.scale-${scale}.png`;
    } else if (tileOptions.allowWide) {
        return `${basePath}/tilewide.scale-${scale}.png`;
    } else {
        // Default to medium size (tilesmall) as it should always be available
        return `${basePath}/tilesmall.scale-${scale}.png`;
    }
}

// Get all apps
function getAllApps() {
    return appsData || [];
}

// Get pinned apps
function getPinnedApps() {
    if (!appsData) return [];

    const registry = window.TileLayoutRegistry;
    let pinnedIds = [];

    if (registry && typeof registry.loadPinnedApps === 'function') {
        try {
            const registryPinned = registry.loadPinnedApps();
            if (Array.isArray(registryPinned)) {
                pinnedIds = registryPinned;
            }
        } catch (error) {
            console.error('Failed to load pinned apps from registry:', error);
        }
    }

    let pinnedApps;
    if (pinnedIds.length > 0) {
        pinnedApps = pinnedIds
            .map(id => appsData.find(app => app.id === id))
            .filter(Boolean);
    } else {
        pinnedApps = appsData.filter(app => app.pinned);
    }

    // Apply saved tile order if available
    if (window.TileDrag && typeof window.TileDrag.applySavedOrder === 'function') {
        pinnedApps = window.TileDrag.applySavedOrder(pinnedApps);
    }

    return pinnedApps;
}

// Get app by ID
function getAppById(id) {
    return appsData ? appsData.find(app => app.id === id) : null;
}

function addOrUpdateApp(app) {
    if (!app || !app.id) {
        console.error('addOrUpdateApp requires an app with an id');
        return null;
    }

    if (!appsData) {
        appsData = [];
    }

    const normalizedApp = { ...app };
    const existingIndex = appsData.findIndex(existing => existing.id === normalizedApp.id);

    if (existingIndex !== -1) {
        appsData[existingIndex] = {
            ...appsData[existingIndex],
            ...normalizedApp
        };
    } else {
        appsData.push(normalizedApp);
    }

    applySavedPinState();
    applySavedTaskbarPinState();
    loadTileSizes();

    return getAppById(normalizedApp.id);
}

// Toggle pin status
function togglePin(appId) {
    const app = getAppById(appId);
    if (app) {
        app.pinned = !app.pinned;
        savePinnedApps();
    }
}

function toggleTaskbarPin(appId) {
    const app = getAppById(appId);
    if (!app) {
        return null;
    }

    app.pinnedToTaskbar = !app.pinnedToTaskbar;
    saveTaskbarPins();
    updateTaskbar();

    return app.pinnedToTaskbar;
}

// Set tile size
function setTileSize(appId, size) {
    const app = getAppById(appId);
    if (app) {
        app.size = size;
        saveTileSizes();
    }
}

// Persist pinned apps state
function savePinnedApps() {
    const pinnedIds = appsData
        .filter(app => app.pinned)
        .map(app => app.id);

    const registry = window.TileLayoutRegistry;
    if (registry && typeof registry.savePinnedApps === 'function') {
        try {
            registry.savePinnedApps(pinnedIds);
            console.log('[AppsManager] Saved pinned apps to registry:', pinnedIds);
        } catch (error) {
            console.error('Failed to save pinned apps to registry:', error);
        }
    }
}

function saveTaskbarPins() {
    if (!appsData) {
        return;
    }

    const pinnedIds = appsData
        .filter(app => app.pinnedToTaskbar)
        .map(app => app.id);

    const registry = window.TileLayoutRegistry;
    if (registry && typeof registry.saveTaskbarPins === 'function') {
        try {
            registry.saveTaskbarPins(pinnedIds);
            console.log('[AppsManager] Saved pinned taskbar apps to registry:', pinnedIds);
        } catch (error) {
            console.error('Failed to save pinned taskbar apps to registry:', error);
        }
    } else {
        console.warn('[AppsManager] Tile layout registry API unavailable; taskbar pins not persisted');
    }

    if (typeof localStorage !== 'undefined') {
        try {
            localStorage.removeItem('pinnedTaskbarApps');
        } catch (error) {
            console.warn('Failed to remove legacy pinnedTaskbarApps key:', error);
        }
    }
}

// Persist tile sizes
function saveTileSizes() {
    const tileSizes = {};
    appsData.forEach(app => {
        tileSizes[app.id] = app.size;
    });
    const registry = window.TileLayoutRegistry;

    if (registry && typeof registry.saveTileSizes === 'function') {
        try {
            registry.saveTileSizes(tileSizes);
            console.log('[AppsManager] Saved tile sizes to registry');
        } catch (error) {
            console.error('Failed to save tile sizes to registry:', error);
        }
    } else {
        console.warn('[AppsManager] Tile layout registry API unavailable; tile sizes not persisted');
    }

    if (typeof localStorage !== 'undefined') {
        try {
            localStorage.removeItem('tileSizes');
        } catch (error) {
            console.warn('Failed to remove legacy tileSizes key:', error);
        }
    }
}

// Load tile sizes (with legacy migration)
function loadTileSizes() {
    if (!appsData) {
        return;
    }

    let sizeMap = {};
    const registry = window.TileLayoutRegistry;

    if (registry && typeof registry.loadTileSizes === 'function') {
        try {
            sizeMap = registry.loadTileSizes();
            if (sizeMap && typeof sizeMap === 'object' && Object.keys(sizeMap).length > 0) {
                applyTileSizesFromMap(sizeMap);
                return;
            }
        } catch (error) {
            console.error('Failed to load tile sizes from registry:', error);
        }
    }

    if (typeof localStorage === 'undefined') {
        return;
    }

    let savedSizes;
    try {
        savedSizes = localStorage.getItem('tileSizes');
    } catch (error) {
        console.error('Failed to access tile sizes from localStorage:', error);
        return;
    }

    if (!savedSizes) {
        return;
    }

    try {
        const tileSizes = JSON.parse(savedSizes);
        if (!tileSizes || typeof tileSizes !== 'object') {
            return;
        }

        applyTileSizesFromMap(tileSizes);
        if (registry && typeof registry.saveTileSizes === 'function') {
            try {
                registry.saveTileSizes(tileSizes);
                console.log('[AppsManager] Migrated tile sizes to registry');
            } catch (error) {
                console.error('Failed to migrate tile sizes to registry:', error);
            }
        }
        try {
            localStorage.removeItem('tileSizes');
        } catch (cleanupError) {
            console.warn('Failed to remove legacy tileSizes key after migration:', cleanupError);
        }
    } catch (error) {
        console.error('Failed to parse tile sizes:', error);
    }
}

function applyTileSizesFromMap(tileSizes) {
    appsData.forEach(app => {
        if (tileSizes[app.id]) {
            app.size = tileSizes[app.id];
        }
    });
}

// Generate tile HTML for an app
function generateTileHTML(app) {
    const sizeClass = app.size === 'wide' ? 'tiles__tile--wide' :
        app.size === 'large' ? 'tiles__tile--large' :
            app.size === 'small' ? 'tiles__tile--small' : '';
    const colorClass = `tiles__tile--${app.color}`;

    // Check if this tile should display an image
    const hasImage = app.showImage || app.imageUrl;
    const imageClass = hasImage ? 'tiles__tile--image' : '';

    // Build the tile content
    let tileContent = '';
    if (hasImage) {
        // Image tile - hide icon, prepare for image display
        const imageUrl = app.imageUrl || '';
        const imageStyle = imageUrl ? `style="background-image: url(&quot;${imageUrl}&quot;);"` : '';
        tileContent = `
            <div class="tiles__tile-image" ${imageStyle}></div>
            <span>${app.name}</span>
        `;
    } else {
        // Check if app has MIF icon class - this determines the fallback hierarchy
        const hasMifIcon = app.icon && app.icon.startsWith('mif-');

        if (hasMifIcon) {
            // App has MIF icon - use icon font or iconImages as fallback
            const iconImage = getIconImage(app, 64);
            const iconHTML = iconImage
                ? `<img src="${iconImage}" alt="">`
                : `<span class="${app.icon}"></span>`;

            tileContent = `
                <i class="${iconImage ? 'tile-icon-image' : ''}">${iconHTML}</i>
                <span>${app.name}</span>
            `;
        } else {
            // No MIF icon - check if we have iconImages or need generic_program fallback
            const iconImage = getIconImage(app, 64);

            if (iconImage) {
                // Use PNG icon (either from iconImages or generic_program fallback)
                tileContent = `
                    <i class="tile-icon-image"><img src="${iconImage}" alt=""></i>
                    <span>${app.name}</span>
                `;
            } else {
                // Assume app has tile image in resources
                const tileImage = getTileImage(app, app.size);
                tileContent = `
                    <div class="tiles__tile-image" style="background-image: url('${tileImage}'); background-size: cover; background-position: center;"></div>
                    <span>${app.name}</span>
                `;
            }
        }
    }

    return `
        <a href="" class="tiles__tile ${sizeClass} ${colorClass} ${imageClass}" data-app="${app.id}" draggable="false">
            ${tileContent}
        </a>
    `;
}

// Generate app list item HTML (for All Apps view)
function generateAppListItemHTML(app) {
    // Check if app has MIF icon class - this determines the fallback hierarchy
    const hasMifIcon = app.icon && app.icon.startsWith('mif-');

    let iconHTML;
    let colorClass = '';

    // Determine color plate class for all apps
    if (app.color) {
        colorClass = `app-icon-plate--${app.color}`;
    } else {
        colorClass = 'app-icon-plate--accent';
    }

    if (hasMifIcon) {
        // App has MIF icon - use icon font or iconImages as fallback
        const iconImage = getIconImage(app, 40);
        if (iconImage) {
            iconHTML = `<img src="${iconImage}" alt="">`;
        } else {
            iconHTML = `<span class="${app.icon}"></span>`;
        }
    } else {
        // No MIF icon - check if we have iconImages or need generic_program fallback
        const iconImage = getIconImage(app, 40);

        if (iconImage) {
            // Use PNG icon (either from iconImages or generic_program fallback)
            iconHTML = `<img src="${iconImage}" alt="" style="object-fit: cover; width: 100%; height: 100%; padding: 4px;">`;
        } else {
            // Use logo.png from resources
            const logoImage = getAppListLogo(app);
            iconHTML = `<img src="${logoImage}" alt="" style="object-fit: cover; width: 100%; height: 100%; padding: 4px;">`;
        }
    }

    return `
        <div class="app-list-item" data-app="${app.id}">
            <div class="app-list-item__icon ${colorClass}">${iconHTML}</div>
            <div class="app-list-item__name">${app.name}</div>
        </div>
    `;
}

// Set tile image for a specific app
function setTileImage(appId, imageUrl) {
    const app = getAppById(appId);
    if (app) {
        const formattedUrl = toAssetUrl(imageUrl);

        app.showImage = true;
        app.imageUrl = formattedUrl; // Store the formatted URL

        // Update the tile in the DOM if it exists
        const tileElement = document.querySelector(`.tiles__tile[data-app="${appId}"]`);
        if (tileElement) {
            const imageDiv = tileElement.querySelector('.tiles__tile-image');
            if (imageDiv) {
                // Preload the image before setting it
                const img = new Image();
                img.onload = () => {
                    imageDiv.style.backgroundImage = `url("${formattedUrl}")`;
                };
                img.onerror = (error) => {
                    console.error('Failed to load tile image:', formattedUrl, error);
                    // Try setting it anyway
                    imageDiv.style.backgroundImage = `url("${formattedUrl}")`;
                };
                img.src = formattedUrl;
            } else {
                // Tile needs to be regenerated to show image
                const parent = tileElement.parentElement;
                const newTileHTML = generateTileHTML(app);
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = newTileHTML;
                parent.replaceChild(tempDiv.firstElementChild, tileElement);
            }
        }
    }
}

// Remove tile image for a specific app (revert to icon)
function removeTileImage(appId) {
    const app = getAppById(appId);
    if (app) {
        app.showImage = false;
        app.imageUrl = null;
        // Update the tile in the DOM if it exists
        const tileElement = document.querySelector(`.tiles__tile[data-app="${appId}"]`);
        if (tileElement) {
            // Tile needs to be regenerated to show icon again
            const parent = tileElement.parentElement;
            const newTileHTML = generateTileHTML(app);
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = newTileHTML;
            parent.replaceChild(tempDiv.firstElementChild, tileElement);
        }
    }
}

// ===== RUNNING APPS MANAGEMENT =====

// Window tracking - supports multiple windows per app
let runningWindows = new Map(); // Map of windowId -> { windowId, appId, app, $container, state, launchOrigin }
let appWindows = new Map(); // Map of appId -> Set of windowIds

// Generate a unique window ID
function generateWindowId(appId) {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000);
    return `${appId}-${timestamp}-${random}`;
}

// Register a running window
function registerRunningWindow(appId, app, $container, launchOrigin = 'desktop') {
    const windowId = generateWindowId(appId);

    runningWindows.set(windowId, {
        windowId: windowId,
        appId: appId,
        app: app,
        $container: $container,
        state: 'active',
        launchOrigin: launchOrigin
    });

    // Track this window under the app
    if (!appWindows.has(appId)) {
        appWindows.set(appId, new Set());
    }
    appWindows.get(appId).add(windowId);

    console.log('Window registered:', windowId, 'for app:', appId, 'from', launchOrigin);
    updateTaskbar();

    return windowId;
}

// Unregister a running window
function unregisterRunningWindow(windowId) {
    const windowData = runningWindows.get(windowId);
    if (windowData) {
        const appId = windowData.appId;
        runningWindows.delete(windowId);

        // Remove from app's window set
        if (appWindows.has(appId)) {
            appWindows.get(appId).delete(windowId);
            // If no more windows for this app, remove the app entry
            if (appWindows.get(appId).size === 0) {
                appWindows.delete(appId);
            }
        }

        console.log('Window unregistered:', windowId, 'for app:', appId);
        updateTaskbar();
    }
}

// Get window data by windowId
function getRunningWindow(windowId) {
    return runningWindows.get(windowId);
}

// Get all windows for a specific app
function getAppWindows(appId) {
    const windowIds = appWindows.get(appId);
    if (!windowIds) return [];

    return Array.from(windowIds).map(windowId => runningWindows.get(windowId)).filter(w => w);
}

function isBackgroundWindow(windowData) {
    return !!windowData?.$container?.data('backgroundPreload');
}

function getVisibleAppWindows(appId) {
    return getAppWindows(appId).filter(windowData => !isBackgroundWindow(windowData));
}

// Get all window IDs for a specific app
function getAppWindowIds(appId) {
    return appWindows.get(appId) ? Array.from(appWindows.get(appId)) : [];
}

// Check if app has any running windows
function isAppRunning(appId) {
    return getVisibleAppWindows(appId).length > 0;
}

// Get window count for an app
function getAppWindowCount(appId) {
    return getVisibleAppWindows(appId).length;
}

// Set window state
function setWindowState(windowId, state) {
    const windowData = runningWindows.get(windowId);
    if (windowData) {
        windowData.state = state;
        console.log('Window state changed:', windowId, state);
        updateTaskbar();
    }
}

// Get window state
function getWindowState(windowId) {
    const windowData = runningWindows.get(windowId);
    return windowData ? windowData.state : null;
}

// Get all running apps (unique apps, not individual windows)
function getRunningApps() {
    const apps = [];
    const processedAppIds = new Set();

    runningWindows.forEach(windowData => {
        if (!processedAppIds.has(windowData.appId)) {
            processedAppIds.add(windowData.appId);
            apps.push({
                app: windowData.app,
                $container: windowData.$container, // First window's container (for backward compatibility)
                state: windowData.state,
                launchOrigin: windowData.launchOrigin
            });
        }
    });

    return apps;
}

// BACKWARD COMPATIBILITY FUNCTIONS
// These maintain the old API for apps that don't support multiple windows

// Register a running app (backward compatible - creates a single window)
function registerRunningApp(appId, app, $container, launchOrigin = 'desktop') {
    return registerRunningWindow(appId, app, $container, launchOrigin);
}

// Unregister a running app (backward compatible - closes all windows)
function unregisterRunningApp(appId) {
    const windowIds = getAppWindowIds(appId);
    windowIds.forEach(windowId => unregisterRunningWindow(windowId));
}

// Get running app data (backward compatible - returns first window)
function getRunningApp(appId) {
    const windows = getVisibleAppWindows(appId);
    if (windows.length === 0) return null;

    // Return data in old format
    return {
        app: windows[0].app,
        $container: windows[0].$container,
        state: windows[0].state,
        launchOrigin: windows[0].launchOrigin
    };
}

// Set app state (backward compatible - sets state for all windows)
function setAppState(appId, state) {
    const windowIds = getAppWindowIds(appId);
    windowIds.forEach(windowId => setWindowState(windowId, state));
}

// Get app state (backward compatible - returns first window's state)
function getAppState(appId) {
    const windows = getVisibleAppWindows(appId);
    return windows.length > 0 ? windows[0].state : null;
}

// Track current taskbar apps for animation
let currentTaskbarApps = new Set();

// Helper function to extract dominant color from app icon for glow effect
function getGlowColorFromApp(app) {
    // Color mapping for modern apps with color plates
    const colorMap = {
        'blue': 'rgba(30, 90, 194, .75)',
        'green': 'rgba(15, 160, 15, .75)',
        'red': 'rgba(188, 41, 77, .75)',
        'purple': 'rgba(156, 16, 165, .75)',
        'orange': 'rgba(226, 87, 54, .75)',
        'teal': 'rgba(16, 146, 169, .75)',
        'lime': 'rgba(156, 205, 40, .75)',
        'pink': 'rgba(243, 16, 156, .75)'
    };

    // Return the color if it's a modern app with a color
    if (app.type === 'modern' && app.color && colorMap[app.color]) {
        return colorMap[app.color];
    }

    // Default to white-ish for desktop apps or apps without color
    return 'rgba(255, 255, 255, .2)';
}

// Setup hover glow effect for taskbar icons
function setupTaskbarGlowEffect($taskbarIcon, app) {
    const $glow = $taskbarIcon.find('.taskbar-app-glow');
    const isRunning = $taskbarIcon.attr('data-running') === 'true';

    // Set glow color for running apps
    if (isRunning) {
        const glowColor = getGlowColorFromApp(app);
        $glow.css('--glow-color', glowColor);

        // Add mouse move tracking for running apps
        $taskbarIcon.on('mousemove', function (e) {
            const iconRect = this.getBoundingClientRect();
            const relativeX = e.clientX - iconRect.left;
            const centerX = iconRect.width / 2;

            // Calculate position: map mouse position within icon to glow position
            // Keep glow within icon boundaries (0% to 100%)
            const glowPercentX = (relativeX / iconRect.width) * 100;
            const clampedX = Math.max(0, Math.min(100, glowPercentX));

            $glow.css('left', `${clampedX}%`);
        });

        // Reset glow position when mouse leaves, after fade-out completes
        $taskbarIcon.on('mouseleave', function () {
            // Wait for the 1s fade-out transition to complete before resetting position
            setTimeout(() => {
                $glow.css('left', '50%');
            }, 1000); // Match the CSS opacity transition duration
        });
    }
}

// Update taskbar to show running apps AND pinned apps
function updateTaskbar() {
    const $taskbarApps = $('.taskbar-apps');

    // Collect all apps that should appear in taskbar
    const taskbarAppsToShow = new Set();
    const runningAppIds = new Set();
    const pinnedAppIds = [];

    // Add all running apps (iterate through windows, collect unique app IDs)
    runningWindows.forEach((windowData) => {
        if (isBackgroundWindow(windowData)) return;

        const appId = windowData.appId;

        // Don't show desktop in taskbar
        if (appId === 'desktop') return;

        const app = windowData.app;

        // Check if app should be shown in taskbar (default to true if not specified)
        const showInTaskbar = app.windowOptions?.showInTaskbar !== false;
        if (!showInTaskbar) return;

        taskbarAppsToShow.add(appId);
        runningAppIds.add(appId);
    });

    // Collect pinned apps in order
    appsData.forEach(app => {
        if (app.pinnedToTaskbar) {
            pinnedAppIds.push(app.id);
            if (!taskbarAppsToShow.has(app.id)) {
                taskbarAppsToShow.add(app.id);
            }
        }
    });

    // Apply saved order to pinned apps
    if (window.TaskbarDrag && typeof window.TaskbarDrag.loadTaskbarOrder === 'function') {
        const savedOrder = window.TaskbarDrag.loadTaskbarOrder();
        if (savedOrder.length > 0) {
            // Create ordered list based on saved order
            const orderedPinnedIds = [];
            const pinnedSet = new Set(pinnedAppIds);

            // Add apps in saved order first
            savedOrder.forEach(appId => {
                if (pinnedSet.has(appId)) {
                    orderedPinnedIds.push(appId);
                    pinnedSet.delete(appId);
                }
            });

            // Add any remaining pinned apps that weren't in saved order
            pinnedSet.forEach(appId => {
                orderedPinnedIds.push(appId);
            });

            // Replace pinnedAppIds with ordered version
            pinnedAppIds.length = 0;
            pinnedAppIds.push(...orderedPinnedIds);
        }
    }

    // Determine which apps are being added or removed
    const appsToAdd = new Set([...taskbarAppsToShow].filter(id => !currentTaskbarApps.has(id)));
    const appsToRemove = new Set([...currentTaskbarApps].filter(id => !taskbarAppsToShow.has(id)));

    // Fade out and remove apps that are no longer needed
    if (appsToRemove.size > 0) {
        appsToRemove.forEach(appId => {
            const $existingIcon = $taskbarApps.find(`.taskbar-app[data-app-id="${appId}"]`);
            if ($existingIcon.length > 0) {
                $existingIcon.addClass('taskbar-app-exit');
                // Remove from DOM after animation completes
                setTimeout(() => {
                    $existingIcon.remove();
                }, 350); // Match CSS transition duration
            }
        });
    }

    // Build ordered list: pinned apps first (in saved order), then running apps
    const orderedAppIds = [];

    // Add pinned apps in their saved order
    pinnedAppIds.forEach(appId => {
        if (taskbarAppsToShow.has(appId)) {
            orderedAppIds.push(appId);
        }
    });

    // Add running apps that aren't pinned (at the end)
    runningAppIds.forEach(appId => {
        if (!pinnedAppIds.includes(appId) && taskbarAppsToShow.has(appId)) {
            orderedAppIds.push(appId);
        }
    });

    // Clear and rebuild taskbar in correct order
    // But only rebuild if the order has changed or there are new apps
    const currentOrder = $taskbarApps.find('.taskbar-app').map(function () {
        return $(this).attr('data-app-id');
    }).get();

    const needsReorder = orderedAppIds.length !== currentOrder.length ||
        orderedAppIds.some((id, index) => id !== currentOrder[index]);

    if (needsReorder || appsToAdd.size > 0 || appsToRemove.size > 0) {
        // Build new order by rearranging existing elements and adding new ones
        orderedAppIds.forEach((appId, index) => {
            const app = getAppById(appId);
            if (!app) return;

            // Check if this is a new app or existing one
            const $existingIcon = $taskbarApps.find(`.taskbar-app[data-app-id="${appId}"]`);

            if ($existingIcon.length > 0 && !appsToRemove.has(appId)) {
                // Move existing item to correct position
                // Remove enter class in case it's still there
                $existingIcon.removeClass('taskbar-app-enter');

                // Get current position
                const currentIndex = $existingIcon.index();

                // Only move if position has changed
                if (currentIndex !== index) {
                    // Detach and reinsert at correct position
                    $existingIcon.detach();
                    const $children = $taskbarApps.children('.taskbar-app');

                    if (index === 0) {
                        $taskbarApps.prepend($existingIcon);
                    } else if (index >= $children.length) {
                        $taskbarApps.append($existingIcon);
                    } else {
                        $children.eq(index).before($existingIcon);
                    }
                }
            } else if (appsToAdd.has(appId)) {
                // Create new item
                const isRunning = isAppRunning(appId);
                // Check if any window of this app is active
                const windows = getVisibleAppWindows(appId);
                const isActive = isRunning && windows.some(w => w.state === 'active');

                // Check if app has MIF icon class - this determines the fallback hierarchy
                const hasMifIcon = app.icon && app.icon.startsWith('mif-');

                let iconHTML;
                let plateClass = '';

                if (hasMifIcon) {
                    // App has MIF icon - use icon font or iconImages as fallback
                    const iconImage = getIconImage(app, 40);
                    if (iconImage) {
                        iconHTML = `<img src="${iconImage}" alt="">`;
                    } else {
                        // Add color plate for apps with MIF icons
                        plateClass = app.color ? `taskbar-icon-plate--${app.color}` : '';
                        iconHTML = `<span class="${app.icon}"></span>`;
                    }
                } else {
                    // No MIF icon - check if we have iconImages or need generic_program fallback
                    const iconImage = getIconImage(app, 40);

                    if (iconImage) {
                        // Use PNG icon (either from iconImages or generic_program fallback)
                        plateClass = app.color ? `taskbar-icon-plate--${app.color}` : '';
                        iconHTML = `<img src="${iconImage}" alt="" style="object-fit: cover; width: 100%; height: 100%;">`;
                    } else {
                        // Use logo.png from resources with color plate
                        const logoImage = getAppListLogo(app);
                        plateClass = app.color ? `taskbar-icon-plate--${app.color}` : '';
                        iconHTML = `<img src="${logoImage}" alt="" style="object-fit: cover; width: 100%; height: 100%;">`;
                    }
                }

                const $taskbarIcon = $(`
                    <div class="taskbar-app taskbar-app-enter ${isActive ? 'active' : ''}"
                         data-app-id="${appId}"
                         data-running="${isRunning}"
                         title="${app.name}">
                        <div class="taskbar-app-glow"></div>
                        <span class="taskbar-app-icon ${plateClass}">${iconHTML}</span>
                    </div>
                `);

                // Insert at correct position
                const $children = $taskbarApps.children('.taskbar-app');
                if (index === 0) {
                    $taskbarApps.prepend($taskbarIcon);
                } else if (index >= $children.length) {
                    $taskbarApps.append($taskbarIcon);
                } else {
                    $children.eq(index).before($taskbarIcon);
                }

                // Setup glow effect with mouse tracking for running apps
                setupTaskbarGlowEffect($taskbarIcon, app);

                // Trigger reflow and remove enter class to start fade-in animation
                $taskbarIcon[0].offsetHeight;
                requestAnimationFrame(() => {
                    $taskbarIcon.removeClass('taskbar-app-enter');
                });
            }
        });
    }

    // Update existing apps (state changes like active/inactive)
    taskbarAppsToShow.forEach(appId => {
        if (appsToAdd.has(appId)) return; // Skip newly added apps

        const app = getAppById(appId);
        if (!app) return;

        const $existingIcon = $taskbarApps.find(`.taskbar-app[data-app-id="${appId}"]`);
        if ($existingIcon.length > 0) {
            const isRunning = isAppRunning(appId);
            // Check if any window of this app is active
            const windows = getVisibleAppWindows(appId);
            const isActive = isRunning && windows.some(w => w.state === 'active');
            const wasRunning = $existingIcon.attr('data-running') === 'true';

            // Update active class
            $existingIcon.toggleClass('active', isActive);
            // Update data-running attribute
            $existingIcon.attr('data-running', isRunning);

            // If running state changed, update glow effect
            if (wasRunning !== isRunning) {
                // Remove old event handlers
                $existingIcon.off('mousemove mouseleave');

                // Ensure glow element exists
                if (!$existingIcon.find('.taskbar-app-glow').length) {
                    $existingIcon.prepend('<div class="taskbar-app-glow"></div>');
                }

                // Re-setup glow effect with new state
                setupTaskbarGlowEffect($existingIcon, app);
            }
        }
    });

    // Update current taskbar apps set
    currentTaskbarApps = new Set(taskbarAppsToShow);

    console.log('Taskbar updated with', taskbarAppsToShow.size, 'apps (running + pinned)');
}

// Export functions
window.AppsManager = {
    loadApps,
    getAllApps,
    getPinnedApps,
    getAppById,
    addOrUpdateApp,
    getIconImage,
    getTileImage,
    getAppListLogo,
    getTileLargeSplash,
    togglePin,
    toggleTaskbarPin,
    setTileSize,
    setTileImage,
    removeTileImage,
    generateTileHTML,
    generateAppListItemHTML,
    // Running apps management (backward compatible)
    registerRunningApp,
    unregisterRunningApp,
    getRunningApp,
    isAppRunning,
    getRunningApps,
    setAppState,
    getAppState,
    // Multiple windows support
    registerRunningWindow,
    unregisterRunningWindow,
    getRunningWindow,
    getAppWindows,
    getVisibleAppWindows,
    getAppWindowIds,
    getAppWindowCount,
    setWindowState,
    getWindowState,
    generateWindowId,
    saveTaskbarPins,
    updateTaskbar
};
