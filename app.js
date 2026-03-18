// Import registry utilities
const { getRegistry, encodeStuckRects2, decodeStuckRects2, RegistryType } = require('./registry/registry.js');
const {
    loadDesktopBackgroundSettings,
    getDesktopWallpaperFullPath,
    toFullWallpaperPath
} = require('./registry/wallpaper-registry.js');
const { createWallpaperController } = require('./components/wallpaper/wallpaper-controller.js');
const {
    loadLockScreenWallpaperState,
    saveLockScreenWallpaperState,
    resolveLockScreenWallpaperPath,
    getDefaultLockScreenWallpaperState
} = require('./registry/lock-screen-registry.js');
const {
    loadThemeSettings,
    saveThemeSettings,
    getDefaultThemeSettings,
    isDefaultThemeSettings
} = require('./registry/theme-registry.js');
const {
    loadStartScreenBackground,
    saveCurrentStartScreenBackground,
    savePreviousStartScreenBackground,
    clearPreviousStartScreenBackground
} = require('./registry/start-background-registry.js');
const SettingsRegistry = require('./registry/settings-registry.js');
const { pathToFileURL: appPathToFileURL } = require('url');

let electronIpc = null;
let electronScreen = null;
let electronWebFrame = null;
try {
    ({ ipcRenderer: electronIpc, screen: electronScreen, webFrame: electronWebFrame } = require('electron'));
} catch (error) {
    console.debug('[App] ipcRenderer unavailable:', error.message || error);
}

if (typeof window !== 'undefined') {
    window.RegistryAPI = window.RegistryAPI || {};
    Object.assign(window.RegistryAPI, {
        getRegistry,
        encodeStuckRects2,
        decodeStuckRects2,
        RegistryType,
        loadLockScreenWallpaperState,
        saveLockScreenWallpaperState,
        resolveLockScreenWallpaperPath,
        getDefaultLockScreenWallpaperState,
        loadThemeSettings,
        saveThemeSettings,
        getDefaultThemeSettings,
        isDefaultThemeSettings
    });
}

if (typeof window !== 'undefined' && !window.ColorRegistry && typeof window.require === 'function') {
    try {
        window.ColorRegistry = window.require('./registry/color-registry.js');
    } catch (error) {
        console.error('[App] Failed to initialize ColorRegistry via window.require:', error);
    }
}

function getColorRegistry() {
    if (typeof window === 'undefined') {
        return null;
    }
    if (window.ColorRegistry) {
        return window.ColorRegistry;
    }
    if (typeof window.require === 'function') {
        try {
            const registryModule = window.require('./registry/color-registry.js');
            window.ColorRegistry = registryModule;
            return registryModule;
        } catch (error) {
            console.error('[App] Unable to require color-registry.js:', error);
        }
    }
    return null;
}

function isAccentAutomaticMode() {
    const colorRegistry = getColorRegistry();
    if (colorRegistry && typeof colorRegistry.isAccentAutomatic === 'function') {
        try {
            return colorRegistry.isAccentAutomatic();
        } catch (error) {
            console.warn('[Accent] isAccentAutomatic check failed:', error);
        }
    }
    return false;
}

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
            return appPathToFileURL(path).href;
        } catch (error) {
            console.warn('[App] Failed to convert asset path to file URL:', path, error);
        }
    }

    return path;
}

function resolveWallpaperPreviewType(path) {
    if (!path || typeof path !== 'string') {
        return 'builtin';
    }

    if (path.startsWith('resources/')) {
        return 'builtin';
    }

    if (path.startsWith('/') || path.startsWith('\\\\') || /^[A-Z]:[\\/]/i.test(path) || path.startsWith('file://') || path.startsWith('http://') || path.startsWith('https://')) {
        return 'custom';
    }

    return 'builtin';
}

function handleWallpaperControllerStateChanged(detail) {
    if (currentBackground && currentBackground.pattern === 'desktop') {
        applyDesktopWallpaperBackground(detail.currentWallpaperPath);
    }

    refreshPersonalizeBackgroundSelection();
}

const wallpaperController = createWallpaperController({
    getWallpaperElement: () => document.getElementById('desktop-wallpaper'),
    toAssetUrl,
    setDesktopTileImage: (path) => AppsManager.setTileImage('desktop', path),
    shouldExtractColor: () => isAccentAutomaticMode(),
    onStateChanged: handleWallpaperControllerStateChanged
});

if (typeof window !== 'undefined') {
    window.WallpaperController = wallpaperController;
}

// View management
let views = {};
let currentView = 'boot';
let viewBeforeLock = null; // Track which view the user was on before locking
let startReturnModernAppId = null;

let bootSequenceTimer = null;
let bootTransitionTimer = null;
let bootSequenceCompleted = false;
let pendingSkipBoot = false;

// Helper function to update current view and body class
function setCurrentView(viewName) {
    currentView = viewName;
    // Update body class for z-index management
    $('body').removeClass('view-boot view-lock view-login view-signingIn view-start view-desktop view-modern')
        .addClass('view-' + viewName);
    console.log('Current view set to:', viewName);

    if (typeof window.updateFloatingStartButtonAvailability === 'function') {
        window.updateFloatingStartButtonAvailability();
    }

    if (typeof updateStartButtonVisualState === 'function') {
        updateStartButtonVisualState();
    }
}

function cancelBootSequenceTimers() {
    if (bootSequenceTimer) {
        clearTimeout(bootSequenceTimer);
        bootSequenceTimer = null;
    }
    if (bootTransitionTimer) {
        clearTimeout(bootTransitionTimer);
        bootTransitionTimer = null;
    }
}

function revealLockScreen($fadeToBlack, immediate = false) {
    if (!views.boot || !views.lock || !views.login) {
        return;
    }

    bootTransitionTimer = null;
    bootSequenceTimer = null;
    views.boot.removeClass('visible fade-in fade-out');

    if (!views.login.hasClass('visible')) {
        views.login.addClass('visible');
    }
    views.login.attr('data-lock-state', 'logged-out');
    initLoginScreen();

    if (!views.lock.hasClass('visible')) {
        views.lock.addClass('visible');
    }
    setCurrentView('lock');
    initLockScreen();

    if (!$fadeToBlack || !$fadeToBlack.length) {
        return;
    }

    if (immediate) {
        $fadeToBlack.removeClass('visible boot-transition');
    } else {
        setTimeout(function () {
            $fadeToBlack.removeClass('visible');
            setTimeout(function () {
                $fadeToBlack.removeClass('boot-transition');
            }, 300);
        }, 500);
    }
}

function startBootTransition($fadeToBlack, immediate = false) {
    if (bootSequenceCompleted) {
        return;
    }

    bootSequenceCompleted = true;
    if (views.boot) {
        views.boot.addClass('fade-out');
    }

    if (immediate) {
        revealLockScreen($fadeToBlack, true);
    } else {
        bootTransitionTimer = setTimeout(function () {
            revealLockScreen($fadeToBlack, false);
        }, 500);
    }
}

function skipBootSequence(immediate = true) {
    if (!views.boot || views.boot.length === 0) {
        return false;
    }

    const $fadeToBlack = $('#fade-to-black');
    if (!$fadeToBlack.length) {
        return false;
    }

    if (bootSequenceCompleted) {
        pendingSkipBoot = false;
        setCurrentView('lock');
        return true;
    }

    pendingSkipBoot = false;
    cancelBootSequenceTimers();
    views.boot.addClass('fade-in');
    startBootTransition($fadeToBlack, immediate);
    return true;
}

if (electronIpc) {
    electronIpc.on('shell:skip-boot', () => {
        if (!skipBootSequence(true)) {
            pendingSkipBoot = true;
        }
    });
    if (typeof window !== 'undefined') {
        window.skipBootSequence = skipBootSequence;
    }
}

// Tile grid management
let calculatedTileRows = 6; // Default to 6 rows, will be updated dynamically

const defaultNavigationSettings = {
    charmsHotCornersEnabled: true,
    goToDesktopOnSignIn: false,
    showDesktopBackgroundOnStart: false,
    showStartOnCurrentDisplay: false,
    showAppsViewOnStart: false,
    searchEverywhereFromApps: false,
    listDesktopAppsFirst: false,
    useStartMenu: false
};

let navigationSettings = { ...defaultNavigationSettings };
// Taskbar settings now stored in registry (StuckRects2)
const STUCKRECTS2_PATH = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StuckRects2';
const TASKBAR_ADVANCED_PATH = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced';
const TASKBAR_SHOW_SEARCH_BUTTON_VALUE_NAME = 'ShowSearchButton';
const TASKBAR_SHOW_TASK_VIEW_BUTTON_VALUE_NAME = 'ShowTaskViewButton';
const TASKBAR_SHELL_BUTTON_ICON_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128];
const TASKBAR_SHELL_BUTTON_RESOURCE_SCALE = 2;
const NOTIFICATION_CENTER_ICON_SIZES = {
    none: [26, 34, 46, 61],
    new: [27, 34, 46, 61],
    dnd: [26, 34, 46, 61]
};
const NOTIFICATION_CENTER_RESOURCE_SCALE = 1;
const NOTIFICATION_CENTER_MAX_ITEMS = 50;
// Navigation settings registry paths
const REGISTRY_PATHS = {
    edgeUI: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\ImmersiveShell\\EdgeUI',
    startPage: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartPage',
    launcher: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\ImmersiveShell\\Launcher',
    accent: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Accent',
    display: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Display'
};
const DISPLAY_ZOOM_VALUE_NAME = 'ZoomPercent';
const DISPLAY_DEFAULT_ZOOM_PERCENT = 100;
const DISPLAY_MIN_ZOOM_PERCENT = 25;
const DISPLAY_MAX_ZOOM_PERCENT = 500;
const DISPLAY_ZOOM_PRESETS = [50, 67, 80, 90, 100, 110, 125, 150, 175, 200];
let currentShellZoomPercent = DISPLAY_DEFAULT_ZOOM_PERCENT;
let displayZoomMonitorId = null;
let taskbarAutoHideEnabled = loadTaskbarAutoHidePreference();
let taskbarHeight = loadTaskbarHeightPreference();
let taskbarUseSmallIcons = loadTaskbarSmallIconsPreference();
let taskbarShowSearchButton = loadTaskbarSearchButtonPreference();
let taskbarShowTaskViewButton = loadTaskbarTaskViewButtonPreference();
let taskbarLocked = loadTaskbarLockedPreference();
let notificationCenterQuietHoursEnabled = false;
let notificationCenterUnreadCount = 0;
let notificationCenterItems = [];
let lockScreenWallpaperState = getDefaultLockScreenWallpaperState();

function normalizeDisplayZoomPercent(value, fallback = DISPLAY_DEFAULT_ZOOM_PERCENT) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return fallback;
    }

    const rounded = Math.round(numeric);
    return Math.max(DISPLAY_MIN_ZOOM_PERCENT, Math.min(DISPLAY_MAX_ZOOM_PERCENT, rounded));
}

function roundResolutionDimension(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return 1;
    }

    return Math.max(1, Math.round(numeric));
}

function getPrimaryDisplayMetrics() {
    const display = electronScreen && typeof electronScreen.getPrimaryDisplay === 'function'
        ? electronScreen.getPrimaryDisplay()
        : null;

    const scaleFactor = Number(display?.scaleFactor) || 1;
    const width = roundResolutionDimension((display?.size?.width || window.screen.width || 1366) * scaleFactor);
    const height = roundResolutionDimension((display?.size?.height || window.screen.height || 768) * scaleFactor);

    return {
        id: display?.id || 'primary',
        label: display?.label || 'Generic PnP Monitor',
        width,
        height,
        aspectRatio: height > 0 ? width / height : 1
    };
}

function getStoredDisplayZoomPercent() {
    const registry = getRegistry();
    return normalizeDisplayZoomPercent(
        registry.getValue(REGISTRY_PATHS.display, DISPLAY_ZOOM_VALUE_NAME, DISPLAY_DEFAULT_ZOOM_PERCENT)
    );
}

function persistDisplayZoomPercent(zoomPercent) {
    const registry = getRegistry();
    const normalized = normalizeDisplayZoomPercent(zoomPercent);
    registry.setValue(
        REGISTRY_PATHS.display,
        DISPLAY_ZOOM_VALUE_NAME,
        normalized,
        RegistryType.REG_DWORD
    );
    return normalized;
}

function getActualShellZoomPercent() {
    if (electronWebFrame && typeof electronWebFrame.getZoomFactor === 'function') {
        return normalizeDisplayZoomPercent(electronWebFrame.getZoomFactor() * 100, currentShellZoomPercent);
    }

    return currentShellZoomPercent;
}

function buildDisplayResolutionOption(displayMetrics, zoomPercent) {
    const normalizedZoomPercent = normalizeDisplayZoomPercent(zoomPercent);
    const zoomFactor = normalizedZoomPercent / 100;
    const width = roundResolutionDimension(displayMetrics.width / zoomFactor);
    const height = roundResolutionDimension(displayMetrics.height / zoomFactor);
    const isDefault = normalizedZoomPercent === DISPLAY_DEFAULT_ZOOM_PERCENT;
    const suffix = isDefault ? ' (Default)' : ` (${normalizedZoomPercent}% zoom)`;

    return {
        zoomPercent: normalizedZoomPercent,
        zoomFactor,
        width,
        height,
        label: `${width} x ${height}${suffix}`,
        isDefault
    };
}

function getDisplayResolutionOptions(displayMetrics = getPrimaryDisplayMetrics(), currentZoomPercent = getActualShellZoomPercent()) {
    const zoomPercents = new Set(DISPLAY_ZOOM_PRESETS.map(preset => normalizeDisplayZoomPercent(preset)));
    zoomPercents.add(normalizeDisplayZoomPercent(currentZoomPercent));

    return Array.from(zoomPercents)
        .map(zoomPercent => buildDisplayResolutionOption(displayMetrics, zoomPercent))
        .sort((left, right) => {
            const areaDelta = (right.width * right.height) - (left.width * left.height);
            if (areaDelta !== 0) {
                return areaDelta;
            }

            return left.zoomPercent - right.zoomPercent;
        });
}

function getDisplaySettingsState() {
    const displayMetrics = getPrimaryDisplayMetrics();
    const zoomPercent = getActualShellZoomPercent();
    const resolutionOptions = getDisplayResolutionOptions(displayMetrics, zoomPercent);
    const currentResolution = resolutionOptions.find(option => option.zoomPercent === zoomPercent)
        || buildDisplayResolutionOption(displayMetrics, zoomPercent);

    return {
        display: displayMetrics,
        zoomPercent,
        zoomFactor: zoomPercent / 100,
        currentResolution,
        resolutionOptions
    };
}

function dispatchDisplaySettingsChanged(source = 'shell') {
    if (typeof window === 'undefined') {
        return;
    }

    window.dispatchEvent(new CustomEvent('win8-display-settings-changed', {
        detail: {
            source,
            state: getDisplaySettingsState()
        }
    }));
}

function applyShellZoomPercent(zoomPercent, options = {}) {
    const {
        persist = true,
        notify = true,
        source = 'shell'
    } = options;

    const normalized = normalizeDisplayZoomPercent(zoomPercent);

    if (electronWebFrame && typeof electronWebFrame.setZoomFactor === 'function') {
        electronWebFrame.setZoomFactor(normalized / 100);
    }

    currentShellZoomPercent = normalized;

    if (persist) {
        persistDisplayZoomPercent(normalized);
    }

    if (notify) {
        dispatchDisplaySettingsChanged(source);
    }

    return normalized;
}

function syncShellZoomPercentFromFrame() {
    const actualZoomPercent = getActualShellZoomPercent();
    if (actualZoomPercent === currentShellZoomPercent) {
        return;
    }

    currentShellZoomPercent = actualZoomPercent;
    persistDisplayZoomPercent(actualZoomPercent);
    dispatchDisplaySettingsChanged('shortcut');
}

function startDisplayZoomMonitoring() {
    if (typeof window === 'undefined') {
        return;
    }

    applyShellZoomPercent(getStoredDisplayZoomPercent(), {
        persist: false,
        notify: false,
        source: 'startup'
    });

    if (displayZoomMonitorId) {
        clearInterval(displayZoomMonitorId);
    }

    displayZoomMonitorId = window.setInterval(syncShellZoomPercentFromFrame, 500);

    window.addEventListener('beforeunload', () => {
        if (displayZoomMonitorId) {
            clearInterval(displayZoomMonitorId);
            displayZoomMonitorId = null;
        }
    }, { once: true });
}

function sendControlPanelAppletNavigation(appletId, attemptsRemaining = 20) {
    const runningControlPanel = AppsManager.getRunningApp('control-panel');
    const iframe = runningControlPanel?.$container?.find('iframe')[0];

    if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({
            action: 'openApplet',
            appletId
        }, '*');
        return;
    }

    if (attemptsRemaining <= 0) {
        console.warn('Unable to navigate Control Panel to applet:', appletId);
        return;
    }

    setTimeout(() => {
        sendControlPanelAppletNavigation(appletId, attemptsRemaining - 1);
    }, 150);
}

function openControlPanelApplet(appletId) {
    if (!appletId) {
        return;
    }

    const controlPanelApp = AppsManager.getAppById('control-panel');
    if (!controlPanelApp) {
        console.warn('Control Panel app is not available for applet launch:', appletId);
        return;
    }

    if (AppsManager.isAppRunning('control-panel')) {
        if (AppsManager.getAppState('control-panel') === 'minimized') {
            restoreClassicWindow('control-panel');
        } else {
            focusClassicWindow('control-panel');
        }
        sendControlPanelAppletNavigation(appletId);
        return;
    }

    launchApp(controlPanelApp, null, {
        initialAppletId: appletId
    });
}

startDisplayZoomMonitoring();

if (typeof window !== 'undefined') {
    window.DisplaySettingsAPI = {
        getState: getDisplaySettingsState,
        getResolutionOptions: () => getDisplaySettingsState().resolutionOptions,
        getZoomPercent: getActualShellZoomPercent,
        setZoomPercent: (zoomPercent) => applyShellZoomPercent(zoomPercent, {
            persist: true,
            notify: true,
            source: 'control-panel'
        }),
        openControlPanelApplet
    };
}

function isDefaultLockScreenState(state) {
    if (!state) {
        return true;
    }

    const baseline = getDefaultLockScreenWallpaperState();
    const currentMatches = state.currentWallpaper === baseline.currentWallpaper;
    const typeMatches = (state.currentWallpaperType || 'builtin') === (baseline.currentWallpaperType || 'builtin');

    const baselineRecents = Array.isArray(baseline.recentWallpapers) ? baseline.recentWallpapers : [];
    const stateRecents = Array.isArray(state.recentWallpapers) ? state.recentWallpapers : [];
    const recentsMatches = stateRecents.length === baselineRecents.length &&
        stateRecents.every((value, index) => value === baselineRecents[index]);

    return currentMatches && typeMatches && recentsMatches;
}

loadNavigationSettingsIntoState();
updateCharmsHotCornerAccessibility();

setTaskbarSmallIcons(taskbarUseSmallIcons, { persist: false });
setTaskbarSearchButtonVisible(taskbarShowSearchButton, { persist: false });
setTaskbarTaskViewButtonVisible(taskbarShowTaskViewButton, { persist: false });

function loadNavigationSettingsIntoState() {
    try {
        const registry = getRegistry();
        navigationSettings = { ...defaultNavigationSettings };

        // charmsHotCornersEnabled is inverted in registry (DisableCharmsHint)
        const disableCharms = registry.getValue(REGISTRY_PATHS.edgeUI, 'DisableCharmsHint', 0);
        navigationSettings.charmsHotCornersEnabled = disableCharms === 0;

        // goToDesktopOnSignIn
        const openAtLogon = registry.getValue(REGISTRY_PATHS.startPage, 'OpenAtLogon', 0);
        navigationSettings.goToDesktopOnSignIn = openAtLogon === 1;

        // showDesktopBackgroundOnStart
        const showDesktopBg = registry.getValue(REGISTRY_PATHS.launcher, 'ShowDesktopBackgroundOnStart', 0);
        navigationSettings.showDesktopBackgroundOnStart = showDesktopBg === 1;

        // showAppsViewOnStart
        const makeAllAppsDefault = registry.getValue(REGISTRY_PATHS.startPage, 'MakeAllAppsDefault', 0);
        navigationSettings.showAppsViewOnStart = makeAllAppsDefault === 1;

        // searchEverywhereFromApps
        const showAppsViewOnSearch = registry.getValue(REGISTRY_PATHS.startPage, 'ShowAppsViewOnSearchClick', 0);
        navigationSettings.searchEverywhereFromApps = showAppsViewOnSearch === 1;

        // showStartOnCurrentDisplay - store in EdgeUI for now
        const showStartOnDisplay = registry.getValue(REGISTRY_PATHS.edgeUI, 'ShowStartOnCurrentDisplay', 0);
        navigationSettings.showStartOnCurrentDisplay = showStartOnDisplay === 1;

        // listDesktopAppsFirst - store in StartPage for now
        const listDesktopFirst = registry.getValue(REGISTRY_PATHS.startPage, 'ListDesktopAppsFirst', 0);
        navigationSettings.listDesktopAppsFirst = listDesktopFirst === 1;

        // useStartMenu - store in StartPage
        const useStartMenu = registry.getValue(REGISTRY_PATHS.startPage, 'UseStartMenu', 0);
        navigationSettings.useStartMenu = useStartMenu === 1;

    } catch (error) {
        console.error('Failed to load navigation settings from registry:', error);
        navigationSettings = { ...defaultNavigationSettings };
    }
}

function saveNavigationSettings() {
    try {
        const registry = getRegistry();

        // charmsHotCornersEnabled is inverted in registry (DisableCharmsHint)
        registry.setValue(
            REGISTRY_PATHS.edgeUI,
            'DisableCharmsHint',
            navigationSettings.charmsHotCornersEnabled ? 0 : 1,
            RegistryType.REG_DWORD
        );

        // goToDesktopOnSignIn
        registry.setValue(
            REGISTRY_PATHS.startPage,
            'OpenAtLogon',
            navigationSettings.goToDesktopOnSignIn ? 1 : 0,
            RegistryType.REG_DWORD
        );

        // showDesktopBackgroundOnStart
        registry.setValue(
            REGISTRY_PATHS.launcher,
            'ShowDesktopBackgroundOnStart',
            navigationSettings.showDesktopBackgroundOnStart ? 1 : 0,
            RegistryType.REG_DWORD
        );

        // showAppsViewOnStart
        registry.setValue(
            REGISTRY_PATHS.startPage,
            'MakeAllAppsDefault',
            navigationSettings.showAppsViewOnStart ? 1 : 0,
            RegistryType.REG_DWORD
        );

        // searchEverywhereFromApps
        registry.setValue(
            REGISTRY_PATHS.startPage,
            'ShowAppsViewOnSearchClick',
            navigationSettings.searchEverywhereFromApps ? 1 : 0,
            RegistryType.REG_DWORD
        );

        // showStartOnCurrentDisplay
        registry.setValue(
            REGISTRY_PATHS.edgeUI,
            'ShowStartOnCurrentDisplay',
            navigationSettings.showStartOnCurrentDisplay ? 1 : 0,
            RegistryType.REG_DWORD
        );

        // listDesktopAppsFirst
        registry.setValue(
            REGISTRY_PATHS.startPage,
            'ListDesktopAppsFirst',
            navigationSettings.listDesktopAppsFirst ? 1 : 0,
            RegistryType.REG_DWORD
        );

        // useStartMenu
        registry.setValue(
            REGISTRY_PATHS.startPage,
            'UseStartMenu',
            navigationSettings.useStartMenu ? 1 : 0,
            RegistryType.REG_DWORD
        );

    } catch (error) {
        console.error('Failed to save navigation settings to registry:', error);
    }
}

function sanitizeNavigationSettings(rawSettings) {
    const sanitized = {};
    if (!rawSettings) {
        return sanitized;
    }

    Object.keys(defaultNavigationSettings).forEach(key => {
        if (Object.prototype.hasOwnProperty.call(rawSettings, key)) {
            sanitized[key] = !!rawSettings[key];
        }
    });

    return sanitized;
}

function applyNavigationSettingsUpdate(updates) {
    const sanitized = sanitizeNavigationSettings(updates);
    const changes = {};

    Object.entries(sanitized).forEach(([key, value]) => {
        if (navigationSettings[key] !== value) {
            changes[key] = {
                old: navigationSettings[key],
                new: value
            };
            navigationSettings[key] = value;
        }
    });

    if (Object.keys(changes).length > 0) {
        saveNavigationSettings();
    }

    return changes;
}

function updateCharmsHotCornerAccessibility() {
    const $body = $('body');
    if (!$body.length) {
        return;
    }

    if (navigationSettings.charmsHotCornersEnabled) {
        $body.removeClass('charms-hotcorners-disabled');
    } else {
        $body.addClass('charms-hotcorners-disabled');
    }
}

function handleCharmsHotCornersChange() {
    updateCharmsHotCornerAccessibility();

    if (typeof window.updateFloatingStartButtonAvailability === 'function') {
        window.updateFloatingStartButtonAvailability();
    }

    if (!navigationSettings.charmsHotCornersEnabled) {
        hideCharmsBar();
    }
}

// Helper function to load all taskbar settings from registry
function loadTaskbarSettingsFromRegistry() {
    try {
        const registry = getRegistry();
        const stuckRects2Binary = registry.getValue(STUCKRECTS2_PATH, 'Settings');

        if (!stuckRects2Binary) {
            console.warn('[Taskbar] No StuckRects2 data found in registry, using defaults');
            // Return defaults if not found in registry
            return {
                autoHide: false,
                alwaysOnTop: false,
                locked: true,
                height: 40,
                position: 3
            };
        }

        console.log('[Taskbar] Loading from registry, binary length:', stuckRects2Binary.length);
        const decoded = decodeStuckRects2(stuckRects2Binary);
        console.log('[Taskbar] Decoded settings from registry:', decoded);
        return decoded;
    } catch (error) {
        console.error('[Taskbar] Failed to load taskbar settings from registry:', error);
        return {
            autoHide: false,
            alwaysOnTop: false,
            locked: true,
            height: 40,
            position: 3
        };
    }
}

// Helper function to save all taskbar settings to registry
function saveTaskbarSettingsToRegistry(settings) {
    try {
        const registry = getRegistry();
        const encoded = encodeStuckRects2(settings);
        const encodedArray = Array.from(encoded);

        registry.setValue(
            STUCKRECTS2_PATH,
            'Settings',
            encodedArray,
            RegistryType.REG_BINARY
        );
    } catch (error) {
        console.error('Failed to save taskbar settings to registry:', error);
    }
}

function loadTaskbarAutoHidePreference() {
    try {
        const settings = loadTaskbarSettingsFromRegistry();
        return settings.autoHide;
    } catch (error) {
        console.error('Failed to load taskbar auto-hide preference:', error);
        return false;
    }
}

function persistTaskbarAutoHidePreference(enabled) {
    try {
        const settings = loadTaskbarSettingsFromRegistry();
        settings.autoHide = enabled;
        saveTaskbarSettingsToRegistry(settings);
    } catch (error) {
        console.error('Failed to save taskbar auto-hide preference:', error);
    }
}

function loadTaskbarSmallIconsPreference() {
    try {
        const registry = getRegistry();
        const value = registry.getValue(TASKBAR_ADVANCED_PATH, 'TaskbarSmallIcons', 0);
        return Number(value) === 1;
    } catch (error) {
        console.error('Failed to load taskbar small icons preference:', error);
        return false;
    }
}

function loadTaskbarButtonVisibilityPreference(valueName, fallback = true) {
    try {
        const registry = getRegistry();
        const value = registry.getValue(TASKBAR_ADVANCED_PATH, valueName, fallback ? 1 : 0);
        return Number(value) !== 0;
    } catch (error) {
        console.error(`Failed to load taskbar button visibility preference for ${valueName}:`, error);
        return fallback;
    }
}

function persistTaskbarButtonVisibilityPreference(valueName, enabled) {
    try {
        const registry = getRegistry();
        registry.setValue(TASKBAR_ADVANCED_PATH, valueName, enabled ? 1 : 0, RegistryType.REG_DWORD);
    } catch (error) {
        console.error(`Failed to persist taskbar button visibility preference for ${valueName}:`, error);
    }
}

function updateTaskbarShellButtonsVisibility() {
    $('.taskbar-search-button').toggleClass('is-hidden', !taskbarShowSearchButton);
    $('.taskbar-task-view-button').toggleClass('is-hidden', !taskbarShowTaskViewButton);
}

function getTaskbarShellButtonAssetScaleFactor() {
    const displayScale = electronScreen && typeof electronScreen.getPrimaryDisplay === 'function'
        ? Number(electronScreen.getPrimaryDisplay()?.scaleFactor) || 1
        : 1;
    const zoomScale = getActualShellZoomPercent() / 100;

    return Math.max(1, displayScale * zoomScale);
}

function getTaskbarShellButtonRenderSize($icon) {
    if (!$icon || !$icon.length) {
        return document.body.classList.contains('taskbar-small-icons') ? 20 : 24;
    }

    const element = $icon[0];
    const computedStyle = window.getComputedStyle(element);
    const width = parseFloat(computedStyle.width) || 0;
    const height = parseFloat(computedStyle.height) || 0;

    return Math.max(width, height, document.body.classList.contains('taskbar-small-icons') ? 20 : 24);
}

function selectTaskbarShellButtonIconSize(targetSize) {
    const availableSizes = TASKBAR_SHELL_BUTTON_ICON_SIZES;
    const exactMatch = availableSizes.find(size => size === targetSize);
    if (exactMatch) {
        return exactMatch;
    }

    const nextUpSize = availableSizes.find(size => size > targetSize);
    if (typeof nextUpSize === 'number') {
        return nextUpSize;
    }

    return availableSizes[availableSizes.length - 1];
}

function updateTaskbarShellButtonIcons() {
    const scaleFactor = getTaskbarShellButtonAssetScaleFactor();

    $('.taskbar-shell-button-icon[data-icon-folder]').each(function () {
        const $icon = $(this);
        const folderName = $icon.attr('data-icon-folder');
        if (!folderName) {
            return;
        }

        const renderSize = getTaskbarShellButtonRenderSize($icon);
        const targetAssetSize = Math.max(1, Math.ceil(renderSize * scaleFactor * TASKBAR_SHELL_BUTTON_RESOURCE_SCALE));
        const selectedSize = selectTaskbarShellButtonIconSize(targetAssetSize);
        const nextSrc = `resources/images/taskbar/${folderName}/${selectedSize}.png`;

        if ($icon.attr('src') !== nextSrc) {
            $icon.attr('src', nextSrc);
        }
    });
}

function selectNotificationCenterIconSize(targetSize, state) {
    const availableSizes = NOTIFICATION_CENTER_ICON_SIZES[state] || NOTIFICATION_CENTER_ICON_SIZES.none;
    const exactMatch = availableSizes.find(size => size === targetSize);
    if (exactMatch) {
        return exactMatch;
    }

    const nextUpSize = availableSizes.find(size => size > targetSize);
    if (typeof nextUpSize === 'number') {
        return nextUpSize;
    }

    return availableSizes[availableSizes.length - 1];
}

function getNotificationCenterState() {
    if (notificationCenterQuietHoursEnabled) {
        return 'dnd';
    }

    return notificationCenterUnreadCount > 0 ? 'new' : 'none';
}

function getNotificationCenterTooltip(state) {
    switch (state) {
        case 'dnd':
            return 'Notification center (Do not disturb)';
        case 'new':
            return 'Notification center (New notifications)';
        default:
            return 'Notification center';
    }
}

function updateNotificationCenterIcon() {
    const $icon = $('#notification-center-icon-img');
    if (!$icon.length) {
        return;
    }

    const state = getNotificationCenterState();
    const scaleFactor = getTaskbarShellButtonAssetScaleFactor();
    const renderSize = getTaskbarShellButtonRenderSize($icon);
    const targetAssetSize = Math.max(1, Math.ceil(renderSize * scaleFactor * NOTIFICATION_CENTER_RESOURCE_SCALE));
    const selectedSize = selectNotificationCenterIconSize(targetAssetSize, state);
    const nextSrc = `resources/images/taskbar/notif_center/${state}/${selectedSize}.png`;

    if ($icon.attr('src') !== nextSrc) {
        $icon.attr('src', nextSrc);
    }

    $('#notification-center-icon')
        .attr('data-state', state)
        .attr('title', getNotificationCenterTooltip(state));
}

function escapeNotificationCenterText(value) {
    const div = document.createElement('div');
    div.textContent = value == null ? '' : String(value);
    return div.innerHTML;
}

function formatNotificationCenterTime(timestamp) {
    return new Date(timestamp).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    });
}

function getNotificationCenterSectionLabel(detail) {
    if (detail && detail.sourceLabel) {
        return detail.sourceLabel;
    }

    if (detail && detail.appId && typeof AppsManager !== 'undefined') {
        const app = AppsManager.getAppById(detail.appId);
        if (app && app.name) {
            return app.name;
        }

        return detail.appId;
    }

    return 'Windows.SystemToast.AutoPlay';
}

function getNotificationCenterSectionIcon(detail) {
    if (detail && detail.appIcon) {
        return detail.appIcon;
    }

    if (detail && detail.appId && typeof AppsManager !== 'undefined') {
        const app = AppsManager.getAppById(detail.appId);
        if (app) {
            return AppsManager.getIconImage(app, 32) || app.icon || null;
        }
    }

    return null;
}

function renderNotificationCenterPanel() {
    const $panelBody = $('#notification-center-panel-body');
    if (!$panelBody.length) {
        return;
    }

    const sections = [];
    const sectionMap = new Map();

    notificationCenterItems.forEach(item => {
        if (!sectionMap.has(item.sectionKey)) {
            const section = {
                key: item.sectionKey,
                label: item.sectionLabel,
                icon: item.sectionIcon,
                items: []
            };
            sectionMap.set(item.sectionKey, section);
            sections.push(section);
        }

        sectionMap.get(item.sectionKey).items.push(item);
    });

    const html = sections.map(section => {
        const hasIcon = Boolean(section.icon);
        const itemsHtml = section.items.map(item => {
            const descriptionHtml = item.description
                ? `<div class="notification-center-item-description">${escapeNotificationCenterText(item.description)}</div>`
                : '';

            return `
                <div class="notification-center-item">
                    <button
                        class="notification-center-item-button"
                        type="button"
                        data-notification-id="${escapeNotificationCenterText(item.id)}"
                        ${item.onClick ? '' : 'disabled'}
                    >
                        <div class="notification-center-item-topline">
                            <div class="notification-center-item-title">${escapeNotificationCenterText(item.title)}</div>
                            <div class="notification-center-item-time">${escapeNotificationCenterText(formatNotificationCenterTime(item.timestamp))}</div>
                        </div>
                        ${descriptionHtml}
                    </button>
                </div>
            `;
        }).join('');

        return `
            <section class="notification-center-section${hasIcon ? ' notification-center-section--with-icon' : ''}">
                <div class="notification-center-section-header${hasIcon ? ' notification-center-section-header--with-icon' : ''}">
                    ${hasIcon ? `<div class="notification-center-section-icon"><img src="${escapeNotificationCenterText(section.icon)}" alt=""></div>` : ''}
                    <div class="notification-center-section-title">${escapeNotificationCenterText(section.label)}</div>
                </div>
                ${itemsHtml}
            </section>
        `;
    }).join('');

    $panelBody.html(html);
    $('#notification-center-clear').prop('disabled', notificationCenterItems.length === 0);
}

function isNotificationCenterPanelVisible() {
    return $('#notification-center-panel').hasClass('visible');
}

function markNotificationCenterRead() {
    if (notificationCenterUnreadCount === 0) {
        return;
    }

    notificationCenterUnreadCount = 0;
    updateNotificationCenterIcon();
}

function showNotificationCenterPanel() {
    const $panel = $('#notification-center-panel');
    if (!$panel.length) {
        return;
    }

    renderNotificationCenterPanel();
    $panel.addClass('visible').attr('aria-hidden', 'false');
    $('#notification-center-icon').addClass('active');
    markNotificationCenterRead();
}

function hideNotificationCenterPanel() {
    const $panel = $('#notification-center-panel');
    if (!$panel.length) {
        return;
    }

    $panel.removeClass('visible').attr('aria-hidden', 'true');
    $('#notification-center-icon').removeClass('active');
}

function clearNotificationCenter() {
    notificationCenterItems = [];
    notificationCenterUnreadCount = 0;
    renderNotificationCenterPanel();
    updateNotificationCenterIcon();

    if (window.notificationManager && typeof window.notificationManager.hideAll === 'function') {
        window.notificationManager.hideAll();
    }
}

function toggleNotificationCenterPanel() {
    if (isNotificationCenterPanelVisible()) {
        hideNotificationCenterPanel();
        return;
    }

    closeAllTaskbarPopupsAndMenus();
    showNotificationCenterPanel();
}

function addNotificationCenterItem(detail) {
    const itemDetail = detail || {};
    const item = {
        id: itemDetail.id || `notification-center-${Date.now()}`,
        sectionKey: itemDetail.appId || itemDetail.sourceLabel || 'windows-system-toast',
        sectionLabel: getNotificationCenterSectionLabel(itemDetail),
        sectionIcon: getNotificationCenterSectionIcon(itemDetail),
        title: itemDetail.title || 'Notification',
        description: itemDetail.description || '',
        timestamp: itemDetail.timestamp || Date.now(),
        onClick: typeof itemDetail.onClick === 'function' ? itemDetail.onClick : null
    };

    notificationCenterItems = [
        item,
        ...notificationCenterItems.filter(existingItem => existingItem.id !== item.id)
    ].slice(0, NOTIFICATION_CENTER_MAX_ITEMS);

    if (!isNotificationCenterPanelVisible()) {
        notificationCenterUnreadCount = Math.min(notificationCenterItems.length, notificationCenterUnreadCount + 1);
    }

    renderNotificationCenterPanel();
    updateNotificationCenterIcon();
}

function handleNotificationCenterItemClick(notificationId) {
    const item = notificationCenterItems.find(entry => entry.id === notificationId);
    if (!item || !item.onClick) {
        return;
    }

    try {
        item.onClick();
        hideNotificationCenterPanel();
    } catch (error) {
        console.error('Notification center item action failed:', error);
    }
}

function setNotificationCenterDoNotDisturb(enabled) {
    notificationCenterQuietHoursEnabled = !!enabled;
    updateNotificationCenterIcon();
    return getNotificationCenterState();
}

function initNotificationCenter() {
    const $notificationCenterIcon = $('#notification-center-icon');
    if (!$notificationCenterIcon.length) {
        return;
    }

    $notificationCenterIcon.on('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        toggleNotificationCenterPanel();
    });

    $(window)
        .off('resize.notification-center')
        .on('resize.notification-center', updateNotificationCenterIcon);
    window.addEventListener('win8-display-settings-changed', updateNotificationCenterIcon);

    document.addEventListener('win8:notification-shown', (event) => {
        addNotificationCenterItem(event.detail);
    });

    $(document).on('click', '#notification-center-clear', function (e) {
        e.preventDefault();
        e.stopPropagation();
        clearNotificationCenter();
    });

    $(document).on('click', '#notification-center-close', function (e) {
        e.preventDefault();
        e.stopPropagation();
        hideNotificationCenterPanel();
    });

    $(document).on('click', '.notification-center-item-button[data-notification-id]', function (e) {
        e.preventDefault();
        e.stopPropagation();
        handleNotificationCenterItemClick($(this).attr('data-notification-id'));
    });

    $(document).on('click', function (e) {
        if (isNotificationCenterPanelVisible() &&
            !$(e.target).closest('#notification-center-panel, #notification-center-icon').length) {
            hideNotificationCenterPanel();
        }
    });

    $(document).on('keydown', function (e) {
        if (e.key === 'Escape' && isNotificationCenterPanelVisible()) {
            hideNotificationCenterPanel();
        }
    });

    window.NotificationCenter = {
        getState: getNotificationCenterState,
        getItems: () => notificationCenterItems.slice(),
        getUnreadCount: () => notificationCenterUnreadCount,
        isDoNotDisturbEnabled: () => notificationCenterQuietHoursEnabled,
        setDoNotDisturb: setNotificationCenterDoNotDisturb,
        clearAll: clearNotificationCenter,
        open: showNotificationCenterPanel,
        close: hideNotificationCenterPanel,
        toggle: toggleNotificationCenterPanel,
        syncIcon: updateNotificationCenterIcon
    };

    renderNotificationCenterPanel();
    updateNotificationCenterIcon();
}

function loadTaskbarSearchButtonPreference() {
    return loadTaskbarButtonVisibilityPreference(TASKBAR_SHOW_SEARCH_BUTTON_VALUE_NAME, true);
}

function setTaskbarSearchButtonVisible(enabled, options = {}) {
    const normalized = !!enabled;
    const { persist = true } = options;
    const changed = taskbarShowSearchButton !== normalized;

    taskbarShowSearchButton = normalized;
    updateTaskbarShellButtonsVisibility();
    updateTaskbarContextMenuChecks();

    if (persist) {
        persistTaskbarButtonVisibilityPreference(TASKBAR_SHOW_SEARCH_BUTTON_VALUE_NAME, normalized);
    }

    return changed;
}

function loadTaskbarTaskViewButtonPreference() {
    return loadTaskbarButtonVisibilityPreference(TASKBAR_SHOW_TASK_VIEW_BUTTON_VALUE_NAME, true);
}

function setTaskbarTaskViewButtonVisible(enabled, options = {}) {
    const normalized = !!enabled;
    const { persist = true } = options;
    const changed = taskbarShowTaskViewButton !== normalized;

    taskbarShowTaskViewButton = normalized;
    updateTaskbarShellButtonsVisibility();
    updateTaskbarContextMenuChecks();

    if (persist) {
        persistTaskbarButtonVisibilityPreference(TASKBAR_SHOW_TASK_VIEW_BUTTON_VALUE_NAME, normalized);
    }

    return changed;
}

function setTaskbarSmallIcons(enabled, options = {}) {
    const normalized = !!enabled;
    const { persist = true } = options;
    const changed = normalized !== taskbarUseSmallIcons;
    taskbarUseSmallIcons = normalized;

    document.body.classList.toggle('taskbar-small-icons', normalized);
    updateTaskbarShellButtonIcons();
    updateNotificationCenterIcon();

    if (persist) {
        try {
            const registry = getRegistry();
            registry.setValue(TASKBAR_ADVANCED_PATH, 'TaskbarSmallIcons', normalized ? 1 : 0, RegistryType.REG_DWORD);
        } catch (error) {
            console.error('Failed to persist taskbar small icons preference:', error);
        }
    }

    return changed;
}

function setTaskbarAutoHide(enabled, options = {}) {
    const normalized = !!enabled;
    const { persist = true } = options;

    const stateChanged = taskbarAutoHideEnabled !== normalized;
    taskbarAutoHideEnabled = normalized;

    if (persist) {
        persistTaskbarAutoHidePreference(taskbarAutoHideEnabled);
    }

    if (stateChanged) {
        console.log('Taskbar auto-hide preference updated:', taskbarAutoHideEnabled);
    }

    updateTaskbarVisibility(currentView);

    if (typeof window.updateFloatingStartButtonAvailability === 'function') {
        window.updateFloatingStartButtonAvailability();
    }
}

function loadTaskbarHeightPreference() {
    try {
        const settings = loadTaskbarSettingsFromRegistry();
        const height = settings.height || 40;

        // Validate height is in increments of 42px starting from 40px
        // Valid heights: 40, 82, 124, 166, etc.
        if (height === 40) return 40;
        if (height > 40 && (height - 40) % 42 === 0) {
            return height;
        }
        return 40; // Default if invalid
    } catch (error) {
        console.error('Failed to load taskbar height preference:', error);
        return 40;
    }
}

function persistTaskbarHeightPreference(height) {
    try {
        const settings = loadTaskbarSettingsFromRegistry();
        settings.height = height;
        saveTaskbarSettingsToRegistry(settings);
    } catch (error) {
        console.error('Failed to save taskbar height preference:', error);
    }
}

function setTaskbarHeight(height, options = {}) {
    const { persist = true } = options;

    // Validate and normalize height
    let normalizedHeight = 40;
    if (height === 40) {
        normalizedHeight = 40;
    } else if (height > 40 && (height - 40) % 42 === 0) {
        normalizedHeight = height;
    }

    const stateChanged = taskbarHeight !== normalizedHeight;
    taskbarHeight = normalizedHeight;

    if (persist) {
        persistTaskbarHeightPreference(taskbarHeight);
    }

    if (stateChanged) {
        console.log('Taskbar height updated:', taskbarHeight);
        // Update clock immediately to show/hide day of week
        updateTaskbarClock();
        // Update taskbar resized class
        updateTaskbarResizedClass();
        updateNotificationCenterIcon();
    }

    updateTaskbarReservedHeight();
}

function updateTaskbarResizedClass() {
    const $taskbar = $('.taskbar');
    if (!$taskbar.length) {
        return;
    }

    if (taskbarHeight > 40) {
        $taskbar.addClass('resized');
    } else {
        $taskbar.removeClass('resized');
    }
}

function updateTaskbarReservedHeight() {
    const $body = $('body');
    if (!$body.length) {
        return;
    }

    // If taskbar is auto-hidden, maximized windows can use the full screen
    // If taskbar is visible, reserve space for it
    const isAutoHidden = $body.hasClass('taskbar-autohide');
    const reservedHeight = isAutoHidden ? 0 : taskbarHeight;

    $body.css('--taskbar-reserved-height', `${reservedHeight}px`);
    $body.css('--taskbar-height', `${taskbarHeight}px`);

    console.log('Taskbar reserved height set to:', reservedHeight + 'px',
        isAutoHidden ? '(auto-hidden)' : '(visible)');
}

// Taskbar lock state management helper functions
function loadTaskbarLockedPreference() {
    try {
        const settings = loadTaskbarSettingsFromRegistry();
        return settings.locked !== undefined ? settings.locked : true;
    } catch (error) {
        console.error('Failed to load taskbar locked preference:', error);
        return true; // Default to locked
    }
}

function persistTaskbarLockedPreference(locked) {
    try {
        const settings = loadTaskbarSettingsFromRegistry();
        settings.locked = locked;
        saveTaskbarSettingsToRegistry(settings);
    } catch (error) {
        console.error('Failed to save taskbar locked preference:', error);
    }
}

function setTaskbarLocked(locked, options = {}) {
    const { persist = true } = options;

    const stateChanged = taskbarLocked !== locked;
    taskbarLocked = !!locked;

    if (persist) {
        persistTaskbarLockedPreference(taskbarLocked);
    }

    if (stateChanged) {
        console.log('Taskbar locked state updated:', taskbarLocked);
    }

    updateTaskbarLockState();
    updateTaskbarContextMenuChecks();
}

function updateTaskbarLockState() {
    const $body = $('body');
    if (!$body.length) {
        return;
    }

    if (taskbarLocked) {
        $body.addClass('taskbar-locked');
        $body.removeClass('taskbar-unlocked');
    } else {
        $body.removeClass('taskbar-locked');
        $body.addClass('taskbar-unlocked');
    }
}

// Taskbar resize functionality
let taskbarResizing = false;
let taskbarResizeStartY = 0;
let taskbarResizeStartHeight = 40;

function initTaskbarResize() {
    const $taskbar = $('.taskbar');

    // Create resize handle if it doesn't exist
    if (!$taskbar.find('.taskbar-resize-handle').length) {
        $taskbar.append('<div class="taskbar-resize-handle"></div>');
    }

    const $resizeHandle = $('.taskbar-resize-handle');

    // Mouse down on resize handle
    $resizeHandle.on('mousedown', function (e) {
        // Only allow resizing when taskbar is unlocked
        if (taskbarLocked) {
            return;
        }

        e.preventDefault();
        taskbarResizing = true;
        taskbarResizeStartY = e.pageY;
        taskbarResizeStartHeight = taskbarHeight;

        $('body').addClass('taskbar-resizing');

        // Prevent text selection during resize
        $('body').css('user-select', 'none');
    });

    // Mouse move - handle resize
    $(document).on('mousemove', function (e) {
        if (!taskbarResizing) {
            return;
        }

        e.preventDefault();

        // Calculate new height (drag up increases height, drag down decreases)
        const deltaY = taskbarResizeStartY - e.pageY;
        const newHeight = taskbarResizeStartHeight + deltaY;

        // Snap to nearest 42px increment (starting from 40px)
        // Valid heights: 40, 82, 124, 166, 208, 250, 292, 334, 376
        let snappedHeight;
        if (newHeight <= 40) {
            snappedHeight = 40;
        } else if (newHeight >= 376) {
            snappedHeight = 376;
        } else {
            // Find nearest increment
            const increment = Math.round((newHeight - 40) / 42);
            snappedHeight = 40 + (increment * 42);
        }

        // Apply the new height (don't persist yet, wait for mouseup)
        setTaskbarHeight(snappedHeight, { persist: false });
    });

    // Mouse up - finish resize
    $(document).on('mouseup', function (e) {
        if (!taskbarResizing) {
            return;
        }

        e.preventDefault();
        taskbarResizing = false;

        $('body').removeClass('taskbar-resizing');
        $('body').css('user-select', '');

        // Persist the final height
        persistTaskbarHeightPreference(taskbarHeight);
    });
}

function showView(viewName, keepLoginVisible = false) {
    // Hide all views using opacity-based visibility
    $.each(views, function (key, $view) {
        if ($view.length) {
            // Special case: keep login screen visible when showing lock screen
            if (keepLoginVisible && key === 'login') {
                return; // Skip hiding login screen
            }
            $view.removeClass('visible'); // Use opacity-based visibility for all views

            // Remove fade-in class from lock screen when hiding it
            if (key === 'lock') {
                $view.removeClass('fade-in');
            }
        }
    });

    // Show requested view
    if (views[viewName] && views[viewName].length) {
        views[viewName].addClass('visible'); // Use opacity-based visibility for all views

        // Add fade-in animation for lock screen
        if (viewName === 'lock') {
            views[viewName].addClass('fade-in');
        }

        setCurrentView(viewName);

        // Update charms bar visibility
        if (viewName === 'desktop' || viewName === 'start') {
            $('body').addClass('charms-allowed');
        } else {
            $('body').removeClass('charms-allowed');
        }

        // Update taskbar visibility
        updateTaskbarVisibility(viewName);

        if (viewName === 'start') {
            applyStartScreenDefaultView();
        }
    }
}

function shouldDisplayTaskbar(viewName) {
    return viewName === 'desktop' || viewName === 'start' || viewName === 'modern';
}

function shouldAutoHideTaskbarForView(viewName) {
    if (viewName === 'start' || viewName === 'modern') {
        return true;
    }

    if (viewName === 'desktop') {
        return taskbarAutoHideEnabled;
    }

    return false;
}

// Update taskbar visibility based on current view
function updateTaskbarVisibility(viewName) {
    const $body = $('body');
    if (!$body.length) {
        return;
    }

    // Remove existing taskbar visibility classes and force reflow so transitions reset cleanly
    $body.removeClass('taskbar-visible taskbar-autohide');
    void $body[0].offsetHeight;

    if (shouldDisplayTaskbar(viewName)) {
        if (shouldAutoHideTaskbarForView(viewName)) {
            $body.addClass('taskbar-autohide');
            const viewLabel = viewName === 'start' ? 'start screen' : viewName;
            const logSuffix = viewName === 'desktop' ? ' (user preference enabled)' : '';
            console.log(`Taskbar set to auto-hide for ${viewLabel}${logSuffix}`);
        } else {
            $body.addClass('taskbar-visible');
            console.log('Taskbar set to always visible for desktop');
        }
    } else if (viewName === 'boot' || viewName === 'lock' || viewName === 'login') {
        console.log('Taskbar hidden for view:', viewName);
    } else {
        console.log('Taskbar visibility unchanged for unknown view:', viewName);
    }

    // Force another reflow to ensure the new class is applied
    void $body[0].offsetHeight;

    // Update the CSS variable for maximized window height
    updateTaskbarReservedHeight();

    if (typeof window.updateFloatingStartButtonAvailability === 'function') {
        window.updateFloatingStartButtonAvailability();
    }

    console.log('Taskbar visibility updated for view:', viewName, '- Body classes:', $body.attr('class'));
}

// Initialize - show boot screen
$(document).ready(function () {
    // Initialize views object after DOM is ready
    views = {
        boot: $('#boot-screen'),
        lock: $('#lock-screen'),
        login: $('#login-screen'),
        signingIn: $('#signing-in-screen'),
        start: $('#start-screen'),
        desktop: $('#desktop')
    };

    showView('boot');

    cancelBootSequenceTimers();
    bootSequenceCompleted = false;

    // Load saved lock screen wallpaper
    loadLockScreenWallpaper();

    // Initialize taskbar reserved height CSS variable
    updateTaskbarReservedHeight();

    // Initialize taskbar lock state
    updateTaskbarLockState();

    // Initialize taskbar resized class based on current height
    updateTaskbarResizedClass();

    // Initialize taskbar resize functionality
    initTaskbarResize();

    // Show black screen behind boot screen
    const $fadeToBlack = $('#fade-to-black');
    $fadeToBlack.addClass('visible boot-transition');

    // Fade in boot screen elements after a brief delay
    setTimeout(function () {
        if (views.boot) {
            views.boot.addClass('fade-in');
        }
    }, 100);

    // Boot sequence: boot -> lock screen after 2-5 seconds (random for realism)
    const bootDuration = Math.floor(Math.random() * 3000) + 2000; // Random between 2000-5000ms
    bootSequenceTimer = setTimeout(function () {
        startBootTransition($fadeToBlack, false);
    }, bootDuration);

    if (pendingSkipBoot) {
        skipBootSequence(true);
    }
});

// ===== LOCK SCREEN =====
let lockDragging = false;
let lockStartY = 0;
let lockCurrentY = 0;
let lockTouchMoved = false;
let suppressNextLockClick = false;
let lockBounceTimeout = null;
const LOCK_SCREEN_TOUCH_TAP_MAX_DRAG = 18;
const LOCK_SCREEN_DISMISS_DRAG_THRESHOLD = -100;

function suppressLockScreenClick(duration = 450) {
    suppressNextLockClick = true;
    setTimeout(function () {
        suppressNextLockClick = false;
    }, duration);
}

function playLockScreenTouchBounce() {
    const $lockScreen = views.lock;
    if (!$lockScreen.length) {
        return;
    }

    clearTimeout(lockBounceTimeout);
    suppressLockScreenClick();

    $lockScreen.removeClass('touch-bouncing');
    $lockScreen.css({
        'transition': '',
        'transform': 'translateY(0)'
    });

    void $lockScreen[0].offsetHeight;
    $lockScreen.addClass('touch-bouncing');

    lockBounceTimeout = setTimeout(function () {
        $lockScreen.removeClass('touch-bouncing');
    }, 450);
}

function initLockScreen() {
    // Clear any existing lock screen interval first
    if (window.lockScreenInterval) {
        clearInterval(window.lockScreenInterval);
    }
    updateLockTime();
    window.lockScreenInterval = setInterval(updateLockTime, 1000);

    const $lockScreen = views.lock;

    // Remove any existing event handlers to avoid duplicates
    $lockScreen.off('mousedown touchstart touchmove touchend touchcancel click');
    $(document).off('mousemove.lockscreen mouseup.lockscreen keydown.lockscreen');
    clearTimeout(lockBounceTimeout);
    $lockScreen.removeClass('touch-bouncing');

    // Mouse drag support
    $lockScreen.on('mousedown', function (e) {
        $lockScreen.removeClass('touch-bouncing');
        lockStartY = e.clientY;
        lockCurrentY = e.clientY;
        lockDragging = true;
        lockTouchMoved = false;
        $lockScreen.css('transition', 'none');
    });

    $(document).on('mousemove.lockscreen', function (e) {
        if (!lockDragging) return;
        lockCurrentY = e.clientY;
        const deltaY = lockCurrentY - lockStartY;
        if (deltaY < 0) { // Only allow upward drag
            $lockScreen.css('transform', `translateY(${deltaY}px)`);
        }
    });

    $(document).on('mouseup.lockscreen', function () {
        if (!lockDragging) return;
        lockDragging = false;
        $lockScreen.css('transition', '');

        const deltaY = lockCurrentY - lockStartY;
        if (deltaY < LOCK_SCREEN_DISMISS_DRAG_THRESHOLD) { // Dragged up enough
            transitionToLogin();
        } else {
            $lockScreen.css('transform', 'translateY(0)');
        }
    });

    // Touch drag support
    $lockScreen.on('touchstart', function (e) {
        const originalEvent = e.originalEvent;
        if (!originalEvent.touches || originalEvent.touches.length !== 1) {
            return;
        }

        const touch = originalEvent.touches[0];
        $lockScreen.removeClass('touch-bouncing');
        lockStartY = touch.clientY;
        lockCurrentY = touch.clientY;
        lockDragging = true;
        lockTouchMoved = false;
        $lockScreen.css('transition', 'none');
    });

    $lockScreen.on('touchmove', function (e) {
        if (!lockDragging) return;

        const originalEvent = e.originalEvent;
        if (!originalEvent.touches || originalEvent.touches.length !== 1) {
            return;
        }

        const touch = originalEvent.touches[0];
        lockCurrentY = touch.clientY;
        const deltaY = lockCurrentY - lockStartY;
        if (Math.abs(deltaY) >= LOCK_SCREEN_TOUCH_TAP_MAX_DRAG) {
            lockTouchMoved = true;
        }
        if (deltaY < 0) { // Only allow upward drag
            $lockScreen.css('transform', `translateY(${deltaY}px)`);
            e.preventDefault();
        }
    });

    $lockScreen.on('touchend touchcancel', function () {
        if (!lockDragging) return;
        lockDragging = false;
        $lockScreen.css('transition', '');

        const deltaY = lockCurrentY - lockStartY;
        if (deltaY < LOCK_SCREEN_DISMISS_DRAG_THRESHOLD) { // Dragged up enough
            suppressLockScreenClick();
            transitionToLogin();
        } else if (!lockTouchMoved && Math.abs(deltaY) < LOCK_SCREEN_TOUCH_TAP_MAX_DRAG) {
            playLockScreenTouchBounce();
        } else {
            $lockScreen.css('transform', 'translateY(0)');
        }
    });

    // Click to go to login screen
    $lockScreen.on('click', function (e) {
        if (suppressNextLockClick) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }

        if (!lockDragging && Math.abs(lockCurrentY - lockStartY) < 10) {
            transitionToLogin();
        }
    });

    // Keyboard dismiss (any key press)
    $(document).on('keydown.lockscreen', function (e) {
        if (currentView === 'lock') {
            transitionToLogin();
        }
    });
}

function updateLockTime() {
    const now = new Date();
    const $timeEl = $('.lock-time');
    const $dateEl = $('.lock-date');

    if ($timeEl.length) {
        let timeString = now.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
        // Remove AM/PM
        timeString = timeString.replace(/\s?(AM|PM)/i, '');
        $timeEl.text(timeString);
    }

    if ($dateEl.length) {
        $dateEl.text(now.toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric'
        }));
    }
}

// Function to update lock screen wallpaper
function applyLockScreenWallpaper(state) {
    if (!state) {
        return;
    }

    const $lockScreen = $('#lock-screen');
    if (!$lockScreen.length) {
        return;
    }

    const resolvedPath = resolveLockScreenWallpaperPath(state.currentWallpaper, state.currentWallpaperType);
    const normalizedPath = resolvedPath.replace(/\\/g, '/');
    $lockScreen.css('background-image', `url("${normalizedPath}")`);
    console.log('[App.js] Applied lock screen wallpaper:', state.currentWallpaper);
}

function loadLockScreenWallpaper() {
    try {
        lockScreenWallpaperState = loadLockScreenWallpaperState();
        console.log('[App.js] Loaded lock screen wallpaper from registry:', lockScreenWallpaperState.currentWallpaper);
    } catch (error) {
        console.error('[App.js] Failed to load lock screen wallpaper from registry:', error);
        lockScreenWallpaperState = getDefaultLockScreenWallpaperState();
    }

    migrateLegacyLockScreenWallpaper();
    applyLockScreenWallpaper(lockScreenWallpaperState);
}

function migrateLegacyLockScreenWallpaper() {
    if (typeof window === 'undefined' || !window.localStorage) {
        return;
    }

    let legacyCurrent = null;
    let legacyRecents = [];
    let hasLegacyData = false;

    try {
        legacyCurrent = window.localStorage.getItem('lockScreenWallpaper');
        const legacyRecentsRaw = window.localStorage.getItem('lockScreenWallpapers');
        if (legacyRecentsRaw) {
            try {
                const parsed = JSON.parse(legacyRecentsRaw);
                if (Array.isArray(parsed)) {
                    legacyRecents = parsed;
                }
            } catch (parseError) {
                console.warn('[App.js] Failed to parse legacy lock screen wallpapers list:', parseError);
            }
        }

        hasLegacyData = Boolean(legacyCurrent) || (Array.isArray(legacyRecents) && legacyRecents.length > 0);
        if (!hasLegacyData) {
            return;
        }

        if (isDefaultLockScreenState(lockScreenWallpaperState)) {
            try {
                lockScreenWallpaperState = saveLockScreenWallpaperState({
                    currentWallpaper: legacyCurrent || lockScreenWallpaperState.currentWallpaper,
                    currentWallpaperType: 'builtin',
                    recentWallpapers: Array.isArray(legacyRecents) ? legacyRecents : []
                });
                console.log('[App.js] Migrated legacy lock screen wallpaper from localStorage to registry');
            } catch (saveError) {
                console.warn('[App.js] Failed to save migrated lock screen wallpaper state:', saveError);
            }
        } else {
            console.log('[App.js] Skipped migrating legacy lock screen wallpaper (registry already populated).');
        }
    } catch (error) {
        console.warn('[App.js] Failed to read legacy lock screen wallpaper from localStorage:', error);
    } finally {
        try {
            window.localStorage.removeItem('lockScreenWallpaper');
            window.localStorage.removeItem('lockScreenWallpapers');
        } catch (cleanupError) {
            console.warn('[App.js] Failed to clear legacy lock screen wallpaper keys from localStorage:', cleanupError);
        }
    }
}

function updateLockScreenWallpaper(wallpaperIdentifier, options = {}) {
    const nextState = {
        currentWallpaper: typeof wallpaperIdentifier === 'string' && wallpaperIdentifier.length > 0
            ? wallpaperIdentifier
            : lockScreenWallpaperState.currentWallpaper,
        currentWallpaperType: options.wallpaperType || lockScreenWallpaperState.currentWallpaperType || 'builtin',
        recentWallpapers: Array.isArray(options.recentWallpapers)
            ? options.recentWallpapers
            : lockScreenWallpaperState.recentWallpapers
    };

    try {
        lockScreenWallpaperState = saveLockScreenWallpaperState(nextState);
    } catch (error) {
        console.error('[App.js] Failed to save lock screen wallpaper to registry:', error);
        lockScreenWallpaperState = {
            currentWallpaper: nextState.currentWallpaper,
            currentWallpaperType: nextState.currentWallpaperType,
            recentWallpapers: nextState.recentWallpapers || lockScreenWallpaperState.recentWallpapers
        };
    }

    applyLockScreenWallpaper(lockScreenWallpaperState);
}

window.updateLockScreenWallpaper = updateLockScreenWallpaper;

function transitionToLogin() {
    const $lockScreen = views.lock;

    // Clean up lock screen event listeners
    $(document).off('mousemove.lockscreen mouseup.lockscreen keydown.lockscreen');

    // Check if we're unlocking (viewBeforeLock exists) or doing fresh login
    const isUnlock = viewBeforeLock !== null;

    if (isUnlock) {
        // ===== UNLOCK FLOW: Show user picker =====
        console.log('Unlock flow - showing user picker (login screen)');

        // Animate the lock screen sliding up to reveal login screen (already rendered beneath)
        $lockScreen.css('transition', 'transform 0.3s ease-out');
        $lockScreen.css('transform', 'translateY(-100%)');

        setTimeout(function () {
            // Hide lock screen and reset it for future use
            $lockScreen.removeClass('visible fade-in fade-out');
            $lockScreen.css('transform', 'translateY(0)');
            $lockScreen.css('transition', '');
            setCurrentView('login');
            $('body').removeClass('charms-allowed'); // Ensure charms bar is hidden on login screen
        }, 300);
    } else {
        // ===== FRESH LOGIN FLOW: Show user picker =====
        console.log('Fresh login flow - showing user picker');

        // Animate the lock screen sliding up to reveal login screen (already rendered beneath)
        $lockScreen.css('transition', 'transform 0.3s ease-out');
        $lockScreen.css('transform', 'translateY(-100%)');

        setTimeout(function () {
            // Hide lock screen and reset it for future use
            $lockScreen.removeClass('visible fade-in fade-out');
            $lockScreen.css('transform', 'translateY(0)');
            $lockScreen.css('transition', '');
            setCurrentView('login');
            $('body').removeClass('charms-allowed'); // Ensure charms bar is hidden on login screen
        }, 300);
    }
}

function unlockToView() {
    const $startScreen = views.start;
    const $desktop = views.desktop;

    console.log('unlockToView() called - returning to:', viewBeforeLock);

    const targetView = viewBeforeLock;

    // Show the target view directly
    if (targetView === 'start') {
        $startScreen.addClass('visible');
        $startScreen.addClass('show-content');
    } else if (targetView === 'desktop') {
        $desktop.addClass('visible');
    }

    // Update current view and UI
    setCurrentView(targetView);
    $('body').addClass('charms-allowed');
    updateTaskbarVisibility(targetView);
    if (targetView === 'start') {
        applyStartScreenDefaultView();
    }

    // Play logon sound after unlock
    if (window.systemSounds) {
        systemSounds.play('logon');
    }

    // Remove lock state attribute since user has unlocked
    views.login.removeAttr('data-lock-state');

    // Clear the saved view after successful unlock
    viewBeforeLock = null;
    console.log('Unlock complete - Current view:', currentView);
}

// ===== LOGIN SCREEN =====
let isLoginInProgress = false;

function initLoginScreen() {
    const $userPickerItem = $('.user-picker-item');

    // Reset the login progress flag when initializing login screen
    isLoginInProgress = false;

    // User picker item click
    $userPickerItem.on('click', function () {
        // Prevent multiple clicks during login sequence
        if (isLoginInProgress) {
            return;
        }
        isLoginInProgress = true;
        transitionToSigningIn();
    });
}

function transitionToSigningIn() {
    const $loginScreen = views.login;
    const $signingInScreen = views.signingIn;

    // Check if we're unlocking (user already signed in) or doing fresh login
    const isUnlock = viewBeforeLock !== null;

    if (isUnlock) {
        // ===== UNLOCK FLOW: Skip signing in screen, go directly to previous view =====
        console.log('transitionToSigningIn() called - Unlock flow (skipping signing in screen)');

        // Fade out the login screen
        $loginScreen.css({
            'opacity': '0',
            'transition': 'opacity 0.3s ease-out'
        });

        setTimeout(function () {
            // Hide login screen
            $loginScreen.removeClass('visible fade-to-accent');
            $loginScreen.css({
                'opacity': '',
                'transition': ''
            });

            // Go directly to the saved view
            unlockToView();
        }, 300);
    } else {
        // ===== FRESH LOGIN FLOW: Show signing in screen =====
        console.log('transitionToSigningIn() called - Fresh login flow');

        // Fade the background from #180052 to ui-accent color
        $loginScreen.addClass('fade-to-accent');

        // After a brief moment, transition to the signing in screen
        setTimeout(function () {
            // Hide login screen
            $loginScreen.removeClass('visible fade-to-accent');

            // Show signing in screen
            $signingInScreen.addClass('visible');
            setCurrentView('signingIn');

            // After about 1 second, proceed to login
            setTimeout(function () {
                login();
            }, 1000);
        }, 500);
    }
}

function login() {
    const $signingInScreen = views.signingIn;
    const $startScreen = views.start;
    const $desktop = views.desktop;
    const shouldOpenDesktop = isStartMenuEnabled() || navigationSettings.goToDesktopOnSignIn;

    console.log('login() called - Fresh login flow (sliding animation)');

    // Play logon sound immediately
    if (window.systemSounds) {
        systemSounds.play('logon');
    }

    // Trigger slide-out animation for signing in screen
    $signingInScreen.addClass('slide-out');

    // Wait 1 second before starting the transition
    setTimeout(function () {
        if (shouldOpenDesktop) {
            $desktop.addClass('visible');
            return;
        }

        // Show start screen and make it visible
        $startScreen.addClass('visible');

        // Force reflow to ensure initial state is applied
        $startScreen[0].offsetHeight;

        // Trigger slide-in animation for start screen
        $startScreen.addClass('slide-in');

        // Also show the content
        $startScreen.addClass('show-content');
    }, 1000);

    // Clean up after all transitions complete (1s pause + 1.5s transition)
    setTimeout(function () {
        // Only proceed if we haven't navigated away from login sequence
        if (currentView === 'signingIn' || currentView === 'login' || currentView === 'boot' || currentView === 'lock') {
            $signingInScreen.removeClass('visible slide-out');
            $signingInScreen.css({
                'opacity': '',
                'transition': '',
                'transform': ''
            });

            // Remove lock state attribute since user is now logged in
            views.login.removeAttr('data-lock-state');

            if (shouldOpenDesktop) {
                $startScreen.removeClass('visible show-content show-content-from-desktop fade-background slide-in exit-to-desktop opening-from-desktop');
                setCurrentView('desktop');
                $('body').removeClass('view-start').addClass('view-desktop');
                $('body').addClass('charms-allowed');
                updateTaskbarVisibility('desktop');
            } else {
                setCurrentView('start');
                console.log('Fresh login complete - Current view:', currentView);
                $('body').addClass('charms-allowed');
                updateTaskbarVisibility('start');
                applyStartScreenDefaultView();
            }
        } else {
            console.log('Login animation skipped - view already changed to:', currentView);
        }
    }, 2500);
}

// ===== START SCREEN =====
let contextMenuAppId = null;
let tooltipTimeout = null;
let tooltipHideTimeout = null;
const START_SCREEN_TOUCH_SWIPE_GATE = 24;
const START_SCREEN_TOUCH_DIRECTION_LOCK_THRESHOLD = 12;
const START_SCREEN_TOUCH_COMMIT_THRESHOLD = 96;
const START_SCREEN_TOUCH_HORIZONTAL_BIAS = 16;
const START_SCREEN_TOUCH_RIGHT_EDGE_EXCLUSION = 32;
const startScreenTouchDrag = {
    active: false,
    engaged: false,
    startX: 0,
    startY: 0,
    initialAllAppsOpen: false,
    baselineOffset: 0,
    currentOffset: 0,
    maxOffset: 0
};

const DEFAULT_START_MENU_PINNED_IDS = ['settings', 'explorer', 'control-panel'];
const MAX_START_MENU_RECENTS = 7;
const START_MENU_MIN_ROWS = 4;
const START_MENU_ROW_STEP = 2;
const START_MENU_LEFT_WIDTH = 260;
const START_MENU_VIEWPORT_MARGIN = 32;
const startMenuState = {
    pinnedIds: [],
    recentIds: [],
    allAppsOpen: false,
    query: ''
};
let startMenuContextAppId = null;
let startMenuContextMode = null;
let startMenuTileRows = null;
let startMenuRowsManuallySized = false;
const startMenuResize = {
    active: false,
    startY: 0,
    startRows: START_MENU_MIN_ROWS,
    minRows: START_MENU_MIN_ROWS,
    maxRows: START_MENU_MIN_ROWS
};

applyStartMenuModePreference();

function hideStartMenuImmediately() {
    const $startMenu = $('#start-menu');
    if (!$startMenu.length) {
        return;
    }

    endStartMenuResize();
    $startMenu.removeClass('visible');
    $('body').removeClass('start-menu-open taskbar-peek');
    hideStartMenuItemContextMenu();
    startMenuState.query = '';
    startMenuState.allAppsOpen = false;

    const searchInput = document.getElementById('start-menu-search-input');
    if (searchInput) {
        searchInput.value = '';
    }

    startReturnModernAppId = null;
    updateStartMenuToggleButton();
    updateStartButtonVisualState();
}

function getStartMenuEligibleApps() {
    if (!window.AppsManager || typeof AppsManager.getAllApps !== 'function') {
        return [];
    }

    const allApps = AppsManager.getAllApps();
    return allApps.filter(app => app && app.id !== 'desktop' && app.showInStart !== false);
}

function sortAppsForStartMenu(apps) {
    const source = Array.isArray(apps) ? apps.slice() : [];

    source.sort((a, b) => {
        if (navigationSettings.listDesktopAppsFirst) {
            const aDesktop = a.type === 'classic' || a.type === 'meta-classic';
            const bDesktop = b.type === 'classic' || b.type === 'meta-classic';

            if (aDesktop !== bDesktop) {
                return aDesktop ? -1 : 1;
            }
        }

        return (a.name || '').localeCompare(b.name || '');
    });

    return source;
}

function getTileGridSizing(showMoreTiles = document.body.classList.contains('tiles-compact')) {
    return showMoreTiles
        ? { tileSize: 56, gap: 8 }
        : { tileSize: 70, gap: 10 };
}

function getStartMenuTileGridSizing() {
    const startMenuElement = document.getElementById('start-menu');

    if (startMenuElement) {
        const styles = getComputedStyle(startMenuElement);
        const tileSize = parseFloat(styles.getPropertyValue('--start-menu-tile-cell'));
        const gap = parseFloat(styles.getPropertyValue('--start-menu-tile-gap'));

        if (Number.isFinite(tileSize) && Number.isFinite(gap)) {
            return { tileSize, gap };
        }
    }

    return { tileSize: 56, gap: 8 };
}

function normalizeStartMenuIds(ids, { fallback = [] } = {}) {
    const eligibleIds = new Set(getStartMenuEligibleApps().map(app => app.id));
    const normalized = Array.isArray(ids) ? ids.filter(id => eligibleIds.has(id)) : [];
    const unique = [];
    const seen = new Set();

    normalized.forEach(id => {
        if (!seen.has(id)) {
            seen.add(id);
            unique.push(id);
        }
    });

    if (unique.length > 0) {
        return unique;
    }

    return fallback.filter(id => eligibleIds.has(id));
}

function loadStartMenuState() {
    const registry = window.TileLayoutRegistry;
    const storedPins = registry && typeof registry.loadStartMenuPins === 'function'
        ? registry.loadStartMenuPins()
        : null;
    const storedRecents = registry && typeof registry.loadStartMenuRecents === 'function'
        ? registry.loadStartMenuRecents()
        : [];
    const storedTileRows = registry && typeof registry.loadStartMenuTileRows === 'function'
        ? registry.loadStartMenuTileRows()
        : null;

    startMenuState.pinnedIds = normalizeStartMenuIds(
        storedPins,
        storedPins === null ? { fallback: DEFAULT_START_MENU_PINNED_IDS } : {}
    );
    startMenuState.recentIds = normalizeStartMenuIds(storedRecents).slice(0, MAX_START_MENU_RECENTS);
    startMenuTileRows = Number.isFinite(storedTileRows) ? storedTileRows : null;
    startMenuRowsManuallySized = Number.isFinite(startMenuTileRows);
}

function saveStartMenuState() {
    const registry = window.TileLayoutRegistry;
    if (!registry) {
        return;
    }

    if (typeof registry.saveStartMenuPins === 'function') {
        registry.saveStartMenuPins(startMenuState.pinnedIds);
    }

    if (typeof registry.saveStartMenuRecents === 'function') {
        registry.saveStartMenuRecents(startMenuState.recentIds.slice(0, MAX_START_MENU_RECENTS));
    }
}

function saveStartMenuSizePreference() {
    const registry = window.TileLayoutRegistry;
    if (!registry || typeof registry.saveStartMenuTileRows !== 'function') {
        return;
    }

    registry.saveStartMenuTileRows(
        startMenuRowsManuallySized && Number.isFinite(startMenuTileRows)
            ? startMenuTileRows
            : null
    );
}

function recordStartMenuLaunch(appId) {
    const app = window.AppsManager && typeof AppsManager.getAppById === 'function'
        ? AppsManager.getAppById(appId)
        : null;

    if (!app || app.id === 'desktop' || app.showInStart === false) {
        return;
    }

    startMenuState.recentIds = [
        appId,
        ...startMenuState.recentIds.filter(id => id !== appId)
    ].slice(0, MAX_START_MENU_RECENTS);

    saveStartMenuState();

    if (isStartMenuEnabled()) {
        renderStartMenuLeftPane();
    }
}

function getStartMenuPinnedListApps() {
    return startMenuState.pinnedIds
        .map(id => AppsManager.getAppById(id))
        .filter(Boolean);
}

function getStartMenuRecentApps() {
    const pinnedSet = new Set(startMenuState.pinnedIds);
    return startMenuState.recentIds
        .filter(id => !pinnedSet.has(id))
        .map(id => AppsManager.getAppById(id))
        .filter(Boolean);
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getStartMenuEntryIconMarkup(app, size = 40) {
    const hasMifIcon = app.icon && app.icon.startsWith('mif-');
    const isModernApp = app.type === 'modern';
    let plateClass = isModernApp
        ? (app.color ? `app-icon-plate--${app.color}` : 'app-icon-plate--accent')
        : 'start-menu-entry__icon--plain';
    let iconHtml = '';

    if (hasMifIcon) {
        const iconImage = AppsManager.getIconImage(app, size);
        iconHtml = iconImage
            ? `<img src="${iconImage}" alt="">`
            : `<span class="${app.icon}"></span>`;
    } else {
        const iconImage = AppsManager.getIconImage(app, size);
        if (iconImage) {
            iconHtml = `<img src="${iconImage}" alt="">`;
        } else {
            const logoImage = AppsManager.getAppListLogo(app);
            iconHtml = `<img src="${logoImage}" alt="">`;
        }
    }

    return {
        plateClass,
        iconHtml
    };
}

function updateStartMenuThemeColor() {
    const rootStyles = getComputedStyle(document.documentElement);
    const baseColor = rootStyles.getPropertyValue('--ui-wall-color').trim() || '#0078d7';
    const adjustedColor = adjustBrightnessAndSaturation(baseColor, -30, +8);

    document.documentElement.style.setProperty('--start-menu-color', adjustedColor);
}

function buildStartMenuEntryHtml(app, mode, { dense = false, subtitle = '' } = {}) {
    const { plateClass, iconHtml } = getStartMenuEntryIconMarkup(app, dense ? 28 : 32);
    const denseClass = dense ? ' start-menu-entry--dense' : '';
    const subtitleHtml = subtitle
        ? `<span class="start-menu-entry__subtitle">${escapeHtml(subtitle)}</span>`
        : '';

    return `
        <button class="start-menu-entry${denseClass}" data-app="${app.id}" data-context="${mode}">
            <span class="start-menu-entry__icon ${plateClass}">${iconHtml}</span>
            <span class="start-menu-entry__text">
                <span class="start-menu-entry__label">${escapeHtml(app.name)}</span>
                ${subtitleHtml}
            </span>
        </button>
    `;
}

function updateStartMenuToggleButton() {
    const $button = $('#start-menu-all-apps-toggle');
    if (!$button.length) {
        return;
    }

    const showingAllApps = startMenuState.allAppsOpen && !startMenuState.query.trim();
    $button.find('.start-menu-all-apps-text').text(showingAllApps ? 'Back' : 'All apps');
    $button.find('.start-menu-all-apps-icon > span')
        .toggleClass('mif-arrow-right', !showingAllApps)
        .toggleClass('mif-arrow-left', showingAllApps);
}

function updateStartButtonVisualState() {
    const isActive = isStartMenuOpen() || currentView === 'start';
    $('.taskbar .start-button, .floating-start-button').toggleClass('active', isActive);
}

function getStartMenuSearchResults(query) {
    const needle = query.trim().toLowerCase();
    if (!needle) {
        return [];
    }

    return sortAppsForStartMenu(getStartMenuEligibleApps()).filter(app =>
        (app.name || '').toLowerCase().includes(needle)
    );
}

function renderStartMenuLeftPane() {
    const $list = $('#start-menu-left-list');
    if (!$list.length || !window.AppsManager) {
        return;
    }

    const query = startMenuState.query.trim();
    const normalizedQuery = query.toLowerCase();
    let html = '';

    if (normalizedQuery) {
        const results = getStartMenuSearchResults(normalizedQuery);

        html += '<div class="start-menu-section-title">Results</div>';
        if (results.length > 0) {
            results.forEach(app => {
                html += buildStartMenuEntryHtml(app, 'search', { dense: false });
            });
        } else {
            html += '<div class="start-menu-empty-state">No matching apps.</div>';
        }
    } else if (startMenuState.allAppsOpen) {
        sortAppsForStartMenu(getStartMenuEligibleApps()).forEach(app => {
            html += buildStartMenuEntryHtml(app, 'all-apps', { dense: true });
        });
    } else {
        const pinnedApps = getStartMenuPinnedListApps();
        const recentApps = getStartMenuRecentApps();

        pinnedApps.forEach(app => {
            html += buildStartMenuEntryHtml(app, 'pinned');
        });

        if (pinnedApps.length > 0 && recentApps.length > 0) {
            html += '<div class="start-menu-list-separator"></div>';
        }

        if (recentApps.length > 0) {
            recentApps.forEach(app => {
                html += buildStartMenuEntryHtml(app, 'recent');
            });
        } else {
            html += '<div class="start-menu-empty-state">Recently opened apps will appear here.</div>';
        }
    }

    $list.html(html);
    updateStartMenuToggleButton();
}

function getStartMenuChromeMetrics() {
    const topHeight = $('.start-menu-top').outerHeight() || 57;
    const topSeparatorHeight = $('#start-menu .start-menu-left > .start-menu-list-separator').outerHeight(true) || 0;
    const bottomHeight = $('.start-menu-bottom').outerHeight() || 92;
    const rightPaddingTop = parseInt($('.start-menu-right').css('padding-top'), 10) || 14;
    const rightPaddingBottom = parseInt($('.start-menu-right').css('padding-bottom'), 10) || 16;
    const leftChromeHeight = topHeight + topSeparatorHeight + bottomHeight;
    const rightChromeHeight = rightPaddingTop + rightPaddingBottom;

    return {
        leftChromeHeight: Math.ceil(leftChromeHeight),
        rightChromeHeight: Math.ceil(rightChromeHeight)
    };
}

function getTaskbarHeightForLayout() {
    const taskbarHeightValue = getComputedStyle(document.body).getPropertyValue('--taskbar-height').trim();
    const parsed = parseInt(taskbarHeightValue, 10);
    return Number.isFinite(parsed) ? parsed : 40;
}

function getStartMenuRowBounds() {
    const { tileSize, gap } = getStartMenuTileGridSizing();
    const { rightChromeHeight } = getStartMenuChromeMetrics();
    const availableHeight = Math.max(0, window.innerHeight - getTaskbarHeightForLayout() - 16 - rightChromeHeight);
    const rawMaxRows = Math.floor((availableHeight + gap) / (tileSize + gap));
    const snappedMaxRows = Math.max(
        START_MENU_MIN_ROWS,
        rawMaxRows - ((rawMaxRows - START_MENU_MIN_ROWS) % START_MENU_ROW_STEP)
    );

    return {
        minRows: START_MENU_MIN_ROWS,
        maxRows: snappedMaxRows
    };
}

function getStartMenuPinnedTileApps() {
    if (!window.AppsManager || typeof AppsManager.getPinnedApps !== 'function') {
        return [];
    }

    return AppsManager.getPinnedApps().filter(app => app && app.id !== 'desktop');
}

function getStartMenuDimensionsForRows(rows) {
    const pinnedApps = getStartMenuPinnedTileApps();
    const layout = calculateTileLayout(pinnedApps, rows);
    const { tileSize, gap } = getStartMenuTileGridSizing();
    const { leftChromeHeight, rightChromeHeight } = getStartMenuChromeMetrics();
    const rightPaddingLeft = parseInt($('.start-menu-right').css('padding-left'), 10) || 16;
    const rightPaddingRight = parseInt($('.start-menu-right').css('padding-right'), 10) || 16;
    const usedColumns = Math.max(layout.maxColumn, 0);
    const tileWidth = usedColumns > 0
        ? (usedColumns * tileSize) + ((usedColumns - 1) * gap)
        : 0;
    const tileHeight = rows > 0
        ? (rows * tileSize) + (Math.max(0, rows - 1) * gap)
        : 0;
    const rightWidth = Math.ceil(Math.max(0, tileWidth) + rightPaddingLeft + rightPaddingRight);
    const shellWidth = START_MENU_LEFT_WIDTH + rightWidth;
    const shellHeight = Math.ceil(Math.max(
        leftChromeHeight,
        rightChromeHeight + tileHeight
    ));

    return {
        rows,
        layout,
        rightWidth,
        shellWidth,
        shellHeight,
        tileSize,
        tileHeight
    };
}

function resolveStartMenuTileRows(preferredRows = null) {
    const bounds = getStartMenuRowBounds();
    const viewportWidthLimit = Math.max(280, window.innerWidth - START_MENU_VIEWPORT_MARGIN);

    let candidate;
    if (preferredRows != null) {
        candidate = preferredRows;
    } else if (startMenuRowsManuallySized && Number.isFinite(startMenuTileRows)) {
        candidate = startMenuTileRows;
    } else {
        candidate = bounds.minRows;
    }

    candidate = Math.max(bounds.minRows, Math.min(bounds.maxRows, candidate));
    candidate = candidate - ((candidate - bounds.minRows) % START_MENU_ROW_STEP);

    for (let rows = candidate; rows <= bounds.maxRows; rows += START_MENU_ROW_STEP) {
        const dimensions = getStartMenuDimensionsForRows(rows);
        if (dimensions.shellWidth <= viewportWidthLimit || rows === bounds.maxRows) {
            startMenuTileRows = rows;
            return dimensions;
        }
    }

    const fallback = getStartMenuDimensionsForRows(bounds.maxRows);
    startMenuTileRows = bounds.maxRows;
    return fallback;
}

function applyStartMenuShellSize(dimensions) {
    const startMenuElement = document.getElementById('start-menu');
    if (!startMenuElement || !dimensions) {
        return;
    }

    startMenuElement.style.setProperty('--start-menu-left-width', `${START_MENU_LEFT_WIDTH}px`);
    startMenuElement.style.setProperty('--start-menu-right-width', `${Math.max(0, dimensions.rightWidth)}px`);
    startMenuElement.style.setProperty('--start-menu-shell-width', `${Math.max(START_MENU_LEFT_WIDTH, dimensions.shellWidth)}px`);
    startMenuElement.style.setProperty('--start-menu-shell-height', `${dimensions.shellHeight}px`);
}

function renderStartMenuTiles() {
    const $tilesContainer = $('#start-menu-tiles');
    if (!$tilesContainer.length || !window.AppsManager) {
        return;
    }

    const pinnedApps = getStartMenuPinnedTileApps();
    const dimensions = resolveStartMenuTileRows(startMenuRowsManuallySized ? startMenuTileRows : null);
    const gridValue = `repeat(${dimensions.rows}, ${dimensions.tileSize}px)`;

    applyStartMenuShellSize(dimensions);
    $tilesContainer.css('grid-template-rows', gridValue);

    if (pinnedApps.length === 0) {
        $tilesContainer.html('<p class="start-menu-empty-state start-menu-empty-state--tiles">No tiles pinned.</p>');
        return;
    }

    $tilesContainer.html(buildPositionedTileGridHtml(pinnedApps, dimensions.layout));

    setTimeout(() => {
        initializeTiles();
    }, 0);
}

function renderStartMenu() {
    updateStartMenuThemeColor();
    renderStartMenuLeftPane();
    renderStartMenuTiles();
    updateStartButtonVisualState();
}

function hideStartMenuItemContextMenu() {
    $('#start-menu-item-context-menu').removeClass('active');
    startMenuContextAppId = null;
    startMenuContextMode = null;
}

function showStartMenuItemContextMenu(x, y, appId, mode) {
    const app = AppsManager.getAppById(appId);
    const $menu = $('#start-menu-item-context-menu');

    if (!app || !$menu.length) {
        return;
    }

    startMenuContextAppId = appId;
    startMenuContextMode = mode;
    hideContextMenu();

    const isPinnedToTiles = !!app.pinned;

    $menu.find('[data-action="keep-in-list"]').toggle(mode === 'recent');
    $menu.find('[data-action="remove-from-list"]').toggle(mode === 'pinned');
    $menu.find('[data-action="pin-start-tile"]').toggle(mode === 'all-apps' || mode === 'search');
    $menu.find('[data-action="pin-start-tile"] .context-menu-item-text')
        .text(isPinnedToTiles ? 'Unpin from Start' : 'Pin to Start');

    $menu.css({
        left: x + 'px',
        top: y + 'px'
    });

    const menuWidth = $menu.outerWidth();
    const menuHeight = $menu.outerHeight();
    const windowWidth = $(window).width();
    const windowHeight = $(window).height();

    if (x + menuWidth > windowWidth) {
        $menu.css('left', (windowWidth - menuWidth - 10) + 'px');
    }
    if (y + menuHeight > windowHeight) {
        $menu.css('top', (windowHeight - menuHeight - 10) + 'px');
    }

    $menu.addClass('active');
}

function openStartMenu() {
    const $startMenu = $('#start-menu');
    const $startScreen = views.start;
    const $desktop = views.desktop;
    const activeModernApp = getActiveModernRunningApp();

    if (!$startMenu.length) {
        return;
    }

    hideContextMenu();
    hideTaskbarContextMenu();
    hideDesktopContextMenu();
    hideQuickLinksMenu();
    hideStartMenuItemContextMenu();
    closeModernFlyout();

    if (activeModernApp) {
        startReturnModernAppId = activeModernApp.app.id;
        hideModernTouchEdgeBars();
        hideAllActiveModernApps();
        $desktop.addClass('visible');
        setCurrentView('desktop');
        $('body').removeClass('view-modern').addClass('view-desktop');
        $('body').addClass('charms-allowed');
        updateTaskbarVisibility('desktop');
    }

    $startScreen.removeClass('visible show-content show-content-from-desktop fade-background slide-in exit-to-desktop opening-from-desktop');
    $desktop.addClass('visible');

    renderStartMenu();
    $startMenu.addClass('visible');
    $('body').addClass('start-menu-open');

    if ($('body').hasClass('taskbar-autohide')) {
        $('body').addClass('taskbar-peek');
    }

    updateStartButtonVisualState();
    requestExplorerDesktopRefresh();
}

function closeStartMenu(options = {}) {
    const restoreModernAppId = !options.forceDesktop && !options.suppressRestore ? startReturnModernAppId : null;

    endStartMenuResize();
    hideStartMenuItemContextMenu();
    $('#start-menu').removeClass('visible');
    $('body').removeClass('start-menu-open taskbar-peek');

    startMenuState.query = '';
    const searchInput = document.getElementById('start-menu-search-input');
    if (searchInput) {
        searchInput.value = '';
    }

    startMenuState.allAppsOpen = false;
    updateStartMenuToggleButton();
    updateStartButtonVisualState();

    startReturnModernAppId = null;

    if (restoreModernAppId && AppsManager.isAppRunning(restoreModernAppId)) {
        setTimeout(function () {
            if (!isStartMenuOpen()) {
                restoreModernApp(restoreModernAppId);
            }
        }, 50);
    }
}

function toggleStartMenuAllApps(forceState) {
    const wasAllAppsOpen = startMenuState.allAppsOpen;
    const nextState = typeof forceState === 'boolean'
        ? forceState
        : !startMenuState.allAppsOpen;

    startMenuState.allAppsOpen = nextState;
    startMenuState.query = '';

    const searchInput = document.getElementById('start-menu-search-input');
    if (searchInput) {
        searchInput.value = '';
    }

    renderStartMenuLeftPane();

    if (!wasAllAppsOpen && nextState) {
        const $list = $('#start-menu-left-list');
        if (!$list.length) {
            return;
        }

        $list.removeClass('entering-all-apps');
        void $list[0].offsetHeight;
        $list.addClass('entering-all-apps');
        setTimeout(() => {
            $list.removeClass('entering-all-apps');
        }, 140);
    }
}

function beginStartMenuResize(clientY) {
    const bounds = getStartMenuRowBounds();
    startMenuResize.active = true;
    startMenuResize.startY = clientY;
    startMenuResize.startRows = resolveStartMenuTileRows(startMenuRowsManuallySized ? startMenuTileRows : null).rows;
    startMenuResize.minRows = bounds.minRows;
    startMenuResize.maxRows = bounds.maxRows;
    $('body').addClass('start-menu-resizing');
}

function updateStartMenuResize(clientY) {
    if (!startMenuResize.active) {
        return;
    }

    const { tileSize, gap } = getStartMenuTileGridSizing();
    const stepHeight = (tileSize + gap) * START_MENU_ROW_STEP;
    const deltaY = startMenuResize.startY - clientY;
    const stepDelta = Math.round(deltaY / stepHeight);
    const candidateRows = startMenuResize.startRows + (stepDelta * START_MENU_ROW_STEP);
    const nextRows = Math.max(
        startMenuResize.minRows,
        Math.min(startMenuResize.maxRows, candidateRows)
    );

    if (nextRows !== startMenuTileRows) {
        startMenuRowsManuallySized = true;
        startMenuTileRows = nextRows;
        renderStartMenuTiles();
    }
}

function endStartMenuResize() {
    if (!startMenuResize.active) {
        return;
    }

    startMenuResize.active = false;
    $('body').removeClass('start-menu-resizing');
    saveStartMenuSizePreference();
}

function isStartScreenTouchSwipeContext() {
    const $startScreen = $('#start-screen');
    return $('body').hasClass('view-start') && $startScreen.length > 0 && $startScreen.hasClass('visible');
}

function getStartScreenSwipeExtent() {
    const $viewsContainer = $('#start-screen .start-views-container');
    return $viewsContainer.outerHeight() || $('#start-screen').outerHeight() || window.innerHeight;
}

function clearStartScreenTouchDragStyles() {
    $('#start-screen')
        .removeClass('touch-dragging')
        .css('--start-touch-offset', '');
}

function resetStartScreenTouchDragState() {
    startScreenTouchDrag.active = false;
    startScreenTouchDrag.engaged = false;
    startScreenTouchDrag.startX = 0;
    startScreenTouchDrag.startY = 0;
    startScreenTouchDrag.initialAllAppsOpen = false;
    startScreenTouchDrag.baselineOffset = 0;
    startScreenTouchDrag.currentOffset = 0;
    startScreenTouchDrag.maxOffset = 0;
    clearStartScreenTouchDragStyles();
}

function updateStartScreenTouchDragOffset(nextOffset) {
    const clampedOffset = Math.max(-startScreenTouchDrag.maxOffset, Math.min(0, nextOffset));
    startScreenTouchDrag.currentOffset = clampedOffset;

    $('#start-screen')
        .addClass('touch-dragging')
        .css('--start-touch-offset', `${clampedOffset}px`);
}

$(document).ready(async function () {
    // Load apps data
    await AppsManager.loadApps();
    loadStartMenuState();

    // Apply saved wallpaper settings (position, slideshow, etc.)
    applySavedWallpaperSettings();

    // Set desktop tile to show wallpaper
    setDesktopTileWallpaper();

    renderPinnedTiles();
    renderAllAppsList();
    renderStartMenu();
    applyStartMenuModePreference();

    // Update taskbar to show pinned apps
    AppsManager.updateTaskbar();
    scheduleExplorerPreload();

    // Initialize tile drag-and-drop
    if (window.TileDrag) {
        window.TileDrag.init();
        console.log('Tile drag-and-drop enabled');
    }

    // Apply saved tile size preference from registry
    const showMoreTiles = loadShowMoreTilesFromRegistry();
    applyTileSize(showMoreTiles);
    console.log('Applied tile size preference:', showMoreTiles ? 'compact' : 'normal');

    // Recalculate tile rows on window resize
    let resizeTimeout;
    $(window).on('resize', function () {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(function () {
            calculateTileRows();
            // Re-render tiles to reposition them with the new row count
            renderPinnedTiles();
            // Re-render all apps list to recalculate column layout
            renderAllAppsList();
            renderStartMenuTiles();
        }, 100);
    });

    // Recalculate rows when window is fully loaded and sized
    $(window).on('load', function () {
        // Small delay to ensure Electron window has finished sizing
        setTimeout(function () {
            console.log('Window fully loaded, recalculating tile rows...');
            calculateTileRows();
            renderPinnedTiles();
            renderStartMenuTiles();
        }, 50);
    });

    // All Apps toggle button click
    $('.all-apps-toggle').on('click', function () {
        toggleStartScreenAllAppsOpen();
    });

    $('#start-screen').on('touchstart.startswipe', function (e) {
        if (!isStartScreenTouchSwipeContext()) {
            resetStartScreenTouchDragState();
            return;
        }

        const originalEvent = e.originalEvent;
        if (!originalEvent.touches || originalEvent.touches.length !== 1) {
            return;
        }

        const touch = originalEvent.touches[0];
        if (touch.clientX >= window.innerWidth - START_SCREEN_TOUCH_RIGHT_EDGE_EXCLUSION) {
            return;
        }

        startScreenTouchDrag.active = true;
        startScreenTouchDrag.engaged = false;
        startScreenTouchDrag.startX = touch.clientX;
        startScreenTouchDrag.startY = touch.clientY;
        startScreenTouchDrag.initialAllAppsOpen = $('#start-screen').hasClass('all-apps-open');
        startScreenTouchDrag.maxOffset = getStartScreenSwipeExtent();
        startScreenTouchDrag.baselineOffset = startScreenTouchDrag.initialAllAppsOpen
            ? -startScreenTouchDrag.maxOffset
            : 0;
        startScreenTouchDrag.currentOffset = startScreenTouchDrag.baselineOffset;
    });

    $(document).on('touchmove.startswipe', function (e) {
        if (!startScreenTouchDrag.active) {
            return;
        }

        if (!isStartScreenTouchSwipeContext()) {
            resetStartScreenTouchDragState();
            return;
        }

        const originalEvent = e.originalEvent;
        if (!originalEvent.touches || originalEvent.touches.length !== 1) {
            resetStartScreenTouchDragState();
            return;
        }

        const touch = originalEvent.touches[0];
        const deltaX = touch.clientX - startScreenTouchDrag.startX;
        const deltaY = touch.clientY - startScreenTouchDrag.startY;

        if (!startScreenTouchDrag.engaged) {
            if (Math.abs(deltaY) < START_SCREEN_TOUCH_DIRECTION_LOCK_THRESHOLD) {
                return;
            }

            if (Math.abs(deltaX) > Math.abs(deltaY) + START_SCREEN_TOUCH_HORIZONTAL_BIAS) {
                resetStartScreenTouchDragState();
                return;
            }

            const wantsAllApps = !startScreenTouchDrag.initialAllAppsOpen && deltaY <= -START_SCREEN_TOUCH_SWIPE_GATE;
            const wantsPinned = startScreenTouchDrag.initialAllAppsOpen && deltaY >= START_SCREEN_TOUCH_SWIPE_GATE;

            if (!wantsAllApps && !wantsPinned) {
                return;
            }

            startScreenTouchDrag.engaged = true;
        }

        const gatedDeltaY = startScreenTouchDrag.initialAllAppsOpen
            ? Math.max(0, deltaY - START_SCREEN_TOUCH_SWIPE_GATE)
            : Math.min(0, deltaY + START_SCREEN_TOUCH_SWIPE_GATE);

        updateStartScreenTouchDragOffset(startScreenTouchDrag.baselineOffset + gatedDeltaY);
        e.preventDefault();
    });

    $(document).on('touchend.startswipe touchcancel.startswipe', function () {
        if (!startScreenTouchDrag.active) {
            return;
        }

        const shouldSwitchViews = startScreenTouchDrag.engaged &&
            Math.abs(startScreenTouchDrag.currentOffset - startScreenTouchDrag.baselineOffset) >= START_SCREEN_TOUCH_COMMIT_THRESHOLD;
        const nextAllAppsOpen = shouldSwitchViews
            ? !startScreenTouchDrag.initialAllAppsOpen
            : startScreenTouchDrag.initialAllAppsOpen;

        setStartScreenAllAppsOpen(nextAllAppsOpen);
        resetStartScreenTouchDragState();
    });

    // Initialize context menu
    initContextMenu();

    $('#start-menu-all-apps-toggle').on('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        toggleStartMenuAllApps();
    });

    $('#start-menu-search-input').on('input', function () {
        startMenuState.query = $(this).val() || '';
        renderStartMenuLeftPane();
    });

    $('#start-menu-search-input').on('keydown', function (e) {
        if (e.key === 'Escape') {
            e.preventDefault();
            if (startMenuState.query.trim()) {
                startMenuState.query = '';
                this.value = '';
                renderStartMenuLeftPane();
            } else {
                closeStartMenu({ forceDesktop: false });
            }
            return;
        }

        if (e.key === 'Enter') {
            const results = getStartMenuSearchResults(startMenuState.query);
            if (results.length > 0) {
                e.preventDefault();
                launchApp(results[0].id);
                closeStartMenu({ forceDesktop: true, suppressRestore: true });
            }
        }
    });

    $('#start-menu-search-button').on('click', function (e) {
        e.preventDefault();
        e.stopPropagation();

        const query = startMenuState.query.trim();
        if (!query) {
            $('#start-menu-search-input').trigger('focus');
            return;
        }

        const results = getStartMenuSearchResults(query);
        if (results.length > 0) {
            launchApp(results[0].id);
            closeStartMenu({ forceDesktop: true, suppressRestore: true });
        }
    });

    $('.start-menu-resize-handle').on('mousedown', function (e) {
        if (!isStartMenuOpen()) {
            return;
        }

        e.preventDefault();
        e.stopPropagation();
        beginStartMenuResize(e.clientY);
    });

    $(document).on('mousemove.startmenuresize', function (e) {
        updateStartMenuResize(e.clientY);
    });

    $(document).on('mouseup.startmenuresize', function () {
        endStartMenuResize();
    });

    $(document).on('click', '.start-menu-entry', function (e) {
        if (e.button === 2 || e.which === 3) {
            return;
        }

        e.preventDefault();
        e.stopPropagation();

        const appId = $(this).attr('data-app');
        launchApp(appId);
        closeStartMenu({ forceDesktop: true, suppressRestore: true });
    });

    $(document).on('contextmenu', '.start-menu-entry', function (e) {
        e.preventDefault();
        e.stopPropagation();

        const appId = $(this).attr('data-app');
        const mode = $(this).attr('data-context');
        showStartMenuItemContextMenu(e.pageX, e.pageY, appId, mode);
    });

    $(document).on('click', '#start-menu-item-context-menu .context-menu-item', function (e) {
        e.preventDefault();
        e.stopPropagation();

        if (!startMenuContextAppId) {
            return;
        }

        const action = $(this).attr('data-action');

        if (action === 'keep-in-list') {
            startMenuState.pinnedIds = [
                startMenuContextAppId,
                ...startMenuState.pinnedIds.filter(id => id !== startMenuContextAppId)
            ];
            saveStartMenuState();
            renderStartMenuLeftPane();
        } else if (action === 'remove-from-list') {
            startMenuState.pinnedIds = startMenuState.pinnedIds.filter(id => id !== startMenuContextAppId);
            saveStartMenuState();
            renderStartMenuLeftPane();
        } else if (action === 'pin-start-tile') {
            AppsManager.togglePin(startMenuContextAppId);
            renderPinnedTiles();
            renderAllAppsList();
            renderStartMenuTiles();
        }

        hideStartMenuItemContextMenu();
    });

    $(document).on('mousedown', function (e) {
        if (!isStartMenuOpen()) {
            return;
        }

        if ($(e.target).closest('#start-menu, #app-context-menu, #start-menu-item-context-menu, .start-power-menu, .user-tile-dropdown, .taskbar .start-button, .floating-start-button-container, .start-button-trigger.bottom-left').length) {
            return;
        }

        closeStartMenu({ forceDesktop: false });
    });

    // Tile click handlers (delegated for dynamically generated tiles)
    $(document).on('click', '.tiles__tile', function (e) {
        // Ignore if this was triggered by a right-click
        if (e.button === 2 || e.which === 3) {
            return;
        }

        e.preventDefault();
        e.stopPropagation();
        const appId = $(this).attr('data-app');
        const $tile = $(this);
        console.log('Tile clicked:', appId);

        if ($(this).closest('#start-menu').length) {
            launchApp(appId, $tile);
            closeStartMenu({ forceDesktop: true, suppressRestore: true });
            return;
        }

        launchApp(appId, $tile);
    });

    // Tile hover handlers for tooltips on small tiles
    $(document).on('mouseenter', '.tiles__tile--small', function (e) {
        const $tile = $(this);
        const appId = $tile.attr('data-app');
        const app = AppsManager.getAppById(appId);

        if (!app) return;

        const $tooltip = $('#tile-tooltip');
        $tooltip.text(app.name);

        // Position tooltip centered above the cursor (stays in place)
        const tooltipX = e.pageX;
        const tooltipY = e.pageY - 30; // 30px above cursor

        $tooltip.css({
            left: tooltipX + 'px',
            top: tooltipY + 'px',
            transform: 'translate(-50%, -100%)'
        });

        // Show tooltip after a short delay
        if (tooltipTimeout) {
            clearTimeout(tooltipTimeout);
        }
        tooltipTimeout = setTimeout(() => {
            $tooltip.addClass('visible');

            // Hide tooltip after 5 seconds
            if (tooltipHideTimeout) {
                clearTimeout(tooltipHideTimeout);
            }
            tooltipHideTimeout = setTimeout(() => {
                $tooltip.removeClass('visible');
            }, 5000);
        }, 500);
    });

    $(document).on('mouseleave', '.tiles__tile--small', function () {
        const $tooltip = $('#tile-tooltip');
        $tooltip.removeClass('visible');

        // Clear any pending tooltip timeouts
        if (tooltipTimeout) {
            clearTimeout(tooltipTimeout);
            tooltipTimeout = null;
        }
        if (tooltipHideTimeout) {
            clearTimeout(tooltipHideTimeout);
            tooltipHideTimeout = null;
        }
    });

    // App list item click
    $(document).on('click', '.app-list-item', function (e) {
        // Ignore if this was triggered by a right-click
        if (e.button === 2 || e.which === 3) {
            return;
        }

        if (!$(e.target).hasClass('app-list-item__pin')) {
            const appId = $(this).attr('data-app');
            console.log('App clicked:', appId);
            launchApp(appId);

            if ($(this).closest('#start-menu').length) {
                closeStartMenu({ forceDesktop: true, suppressRestore: true });
            } else {
                setStartScreenAllAppsOpen(false);
            }
        }
    });

    // Global message handler for store app installations
    window.addEventListener('message', function (e) {
        if (e.data && e.data.type === 'STORE_APP_INSTALLED') {
            handleStoreAppInstalled(e.data.app);
        } else if (e.data && e.data.type === 'STORE_APP_UNINSTALLED') {
            handleStoreAppUninstalled(e.data.appId);
        }
    });
});

function setDesktopTileWallpaper() {
    if (window.WallpaperController) {
        const currentWallpaperPath = window.WallpaperController.getCurrentFullPath();
        if (currentWallpaperPath) {
            AppsManager.setTileImage('desktop', currentWallpaperPath);
            return;
        }
    }

    // First, try to get the wallpaper from registry-backed settings
    try {
        const settings = loadDesktopBackgroundSettings();
        if (settings.currentWallpaper) {
            const wallpaperPath = toFullWallpaperPath(settings.currentWallpaper, settings.currentWallpaperType);
            if (wallpaperPath) {
                AppsManager.setTileImage('desktop', wallpaperPath);
                return;
            }
        }
    } catch (e) {
        console.error('Failed to read saved wallpaper settings for tile:', e);
    }

    // Fallback: try to read from DOM
    const wallpaperEl = document.getElementById('desktop-wallpaper') || document.getElementById('desktop');
    if (!wallpaperEl) return;

    const style = window.getComputedStyle(wallpaperEl);
    const backgroundImage = style.backgroundImage;

    // Extract URL from background-image property
    const urlMatch = backgroundImage.match(/url\(['"]?(.+?)['"]?\)/);
    if (urlMatch && urlMatch[1]) {
        const wallpaperUrl = urlMatch[1];
        // Set the desktop tile to show the wallpaper
        AppsManager.setTileImage('desktop', wallpaperUrl);
    } else {
        // Last resort: use default wallpaper
        const fallbackPath = getDesktopWallpaperPath();
        if (fallbackPath) {
            AppsManager.setTileImage('desktop', fallbackPath);
        }
    }
}

const APP_TILE_COLORS = {
    'teal': '#00A0B1',
    'blue': '#0A5BC4',
    'magenta': '#A700AE',
    'purple': '#643EBF',
    'red': '#BF1E4B',
    'orange': '#DC572E',
    'green': '#00A600',
    'sky': '#2E8DEF',
    'grey': '#7D7D7D'
};

function getAppTileColor(colorKey) {
    if (!colorKey) {
        return APP_TILE_COLORS.blue;
    }

    if (typeof colorKey === 'string' && colorKey.startsWith('#')) {
        return colorKey;
    }

    return APP_TILE_COLORS[colorKey] || APP_TILE_COLORS.blue;
}

// Create and show tile flip animation
function showTileFlipAnimation(app, $clickedTile, callback) {
    // Get tile's position and dimensions
    const tileRect = $clickedTile[0].getBoundingClientRect();

    // Get tile color
    const bgColor = getAppTileColor(app.color);

    // Create overlay elements
    const $overlay = $('<div class="tile-flip-overlay"></div>');
    const $background = $('<div class="tile-flip-background"></div>').css('background-color', bgColor);
    const $tile = $('<div class="tile-flip-tile"></div>').css('background-color', bgColor);
    const $icon = $('<div class="tile-flip-icon"></div>');

    // Check if app has MIF icon - determines fallback hierarchy
    const hasMifIcon = app.icon && app.icon.startsWith('mif-');
    let flipIcon = null;

    if (hasMifIcon) {
        // Use iconImages if available, otherwise MIF icon
        flipIcon = AppsManager.getIconImage(app, 64);
    } else {
        // Use large tile image for apps without MIF icons (largest size available)
        flipIcon = AppsManager.getTileLargeSplash(app);
    }

    if (flipIcon) {
        $icon.append(`<img src="${flipIcon}" alt="">`);
    } else if (app.icon) {
        $icon.append(`<span class="${app.icon}"></span>`);
    }

    // Set initial tile position and size (matching the clicked tile)
    $tile.css({
        left: tileRect.left + 'px',
        top: tileRect.top + 'px',
        width: tileRect.width + 'px',
        height: tileRect.height + 'px'
    });

    // Assemble elements
    $tile.append($icon);
    $overlay.append($background);
    $overlay.append($tile);
    $('body').append($overlay);

    // Animation sequence
    setTimeout(() => {
        // Phase 1: Fade in background (starts immediately)
        $background.addClass('visible');

        // Phase 2: Expand tile to fullscreen and flip (starts after 50ms)
        setTimeout(() => {
            $tile.css({
                left: '0',
                top: '0',
                width: '100vw',
                height: '100vh'
            }).addClass('expanding flipping');
        }, 50);

        // Phase 3: Open app while tile is expanding (so it appears beneath)
        setTimeout(() => {
            if (callback) callback();
        }, 400); // Open app 400ms after animation starts (during expansion)

        // Phase 4: Hold the animation briefly, then fade out
        setTimeout(() => {
            $background.addClass('fade-out');
            $tile.addClass('fade-out');

            // Phase 5: Clean up after fade out completes
            setTimeout(() => {
                $overlay.remove();
            }, 500);
        }, 750); // Start fade out 750ms after animation starts
    }, 10);
}

// Launch app based on its type
function launchApp(appOrId, $clickedTile, launchOptions = {}) {
    const app = typeof appOrId === 'string' ? AppsManager.getAppById(appOrId) : appOrId;
    const appId = typeof appOrId === 'string' ? appOrId : appOrId && appOrId.id;

    if (!app || !appId) {
        console.error('App not found:', appOrId);
        return;
    }

    // Prevent rapid duplicate launches from start screen (debounce at launch level)
    // This catches double-clicks on tiles before they queue up delayed opens
    if (!launchOptions.fromTaskbar && $clickedTile && $clickedTile.length > 0) {
        const now = Date.now();
        const lastLaunch = launchingApps.get(appId);
        if (lastLaunch && (now - lastLaunch) < 500) {
            console.log('Prevented duplicate tile launch of:', appId, '(too soon after previous launch)');
            return;
        }
        launchingApps.set(appId, now);
    }

    console.log('Launching app:', appId, 'Type:', app.type);
    recordStartMenuLaunch(appId);

    // Determine if we should show the flip animation (only for modern apps when tile was clicked)
    let shouldAnimate = app.type === 'modern' && $clickedTile && $clickedTile.length > 0;
    if (launchOptions.fromTaskbar) {
        shouldAnimate = false;
    }

    // Clear tile-level debounce so openClassicApp's own debounce doesn't conflict
    launchingApps.delete(appId);

    switch (app.type) {
        case 'meta':
            // Meta apps have special behavior (like Desktop tile)
            if (appId === 'desktop') {
                console.log('Showing desktop view');
                transitionToDesktop();
            }
            break;

        case 'modern':
            // Modern apps open in fullscreen with animation
            console.log('Opening modern app:', appId);
            if (shouldAnimate) {
                showTileFlipAnimation(app, $clickedTile, () => {
                    openModernApp(app, launchOptions);
                });
            } else {
                openModernApp(app, launchOptions);
            }
            break;

        case 'classic':
            // Classic apps open on the desktop
            console.log('Opening classic app:', appId);

            const openClassicAppWithTransition = () => {
                // Check if any modern app is currently active
                const hasActiveModernApp = AppsManager.getRunningApps().some(running =>
                    running.app && running.app.type === 'modern' && AppsManager.getAppState(running.app.id) === 'active'
                );

                // If on start screen OR a modern app is active, transition to desktop first
                if (currentView !== 'desktop' || hasActiveModernApp) {
                    // Hide any active modern apps
                    if (hasActiveModernApp) {
                        hideAllActiveModernApps();
                    }

                    // Transition to desktop if needed
                    if (currentView !== 'desktop') {
                        transitionToDesktop();
                    }

                    // Wait for transition to complete before opening the app
                    setTimeout(() => {
                        openClassicApp(app, launchOptions);
                    }, 500);
                } else {
                    openClassicApp(app, launchOptions);
                }
            };

            // Classic apps should switch to desktop, not use flip animation
            if ($clickedTile && $clickedTile.length > 0 && !launchOptions.fromTaskbar) {
                // User clicked a tile on Start screen - transition to desktop first
                openClassicAppWithTransition();
            } else {
                // Launched from taskbar or already on desktop
                openClassicAppWithTransition();
            }
            break;

        case 'meta-classic':
            // Meta-classic apps open on desktop (like Taskbar Properties, Run dialog)
            console.log('Opening meta-classic app:', appId);

            const openClassicWithTransition = () => {
                // Check if any modern app is currently active
                const hasActiveModernApp = AppsManager.getRunningApps().some(running =>
                    running.app && running.app.type === 'modern' && AppsManager.getAppState(running.app.id) === 'active'
                );

                // If on start screen OR a modern app is active, transition to desktop first
                if (currentView !== 'desktop' || hasActiveModernApp) {
                    // Hide any active modern apps
                    if (hasActiveModernApp) {
                        hideAllActiveModernApps();
                    }

                    // Transition to desktop if needed
                    if (currentView !== 'desktop') {
                        transitionToDesktop();
                    }

                    // Wait for transition to complete before opening the app
                    setTimeout(() => {
                        openClassicApp(app, launchOptions);
                    }, 500);
                } else {
                    openClassicApp(app, launchOptions);
                }
            };

            if (shouldAnimate) {
                showTileFlipAnimation(app, $clickedTile, openClassicWithTransition);
            } else {
                openClassicWithTransition();
            }
            break;

        default:
            console.log('Unknown app type:', app.type, 'for app:', appId);
            break;
    }
}

// Handle store app installation
function handleStoreAppInstalled(app) {
    console.log('Store app installed:', app.id);

    const registeredApp = AppsManager.addOrUpdateApp(app) || app;

    // Refresh UI
    renderPinnedTiles();
    renderAllAppsList();
    AppsManager.updateTaskbar();

    // Show notification from the Store app
    if (window.notificationManager) {
        window.notificationManager.show({
            icon: AppsManager.getIconImage(registeredApp, 40) || registeredApp.icon || 'mif-download',
            title: `${registeredApp.name} was installed.`,
            description: '',
            appId: 'msstore', // Notification is sent by the Store app
            // duration: 5000,
            onClick: () => {
                // Launch the app when notification is clicked
                console.log('Launching app from notification:', registeredApp.id);
                launchApp(registeredApp.id);
            }
        });
    }
}

// Handle store app uninstallation
function handleStoreAppUninstalled(appId) {
    console.log('Store app uninstalled:', appId);

    // Remove app from apps data
    const allApps = AppsManager.getAllApps();
    const index = allApps.findIndex(a => a.id === appId);
    if (index !== -1) {
        allApps.splice(index, 1);
    }

    // Close app if it's running
    if (AppsManager.isAppRunning(appId)) {
        const runningApp = AppsManager.getRunningApp(appId);
        if (runningApp && runningApp.app) {
            if (runningApp.app.type === 'modern') {
                closeModernApp(appId);
            } else if (runningApp.app.type === 'classic') {
                closeClassicApp(appId);
            }
        }
    }

    // Refresh UI
    renderPinnedTiles();
    renderAllAppsList();
    AppsManager.updateTaskbar();
}

// Open a modern (fullscreen) app
function openModernApp(app, launchOptions = {}) {
    // App needs either a path (for iframe) or webview config
    if (!app.path && !(app.webview && app.webview.enabled)) {
        console.error('Modern app missing path or webview config:', app.id);
        return;
    }

    // Check if app is already running - if so, just restore it
    if (AppsManager.isAppRunning(app.id)) {
        console.log('App already running, restoring:', app.id);
        restoreModernApp(app.id);
        return;
    }

    console.log('Loading modern app from:', app.path);

    // Hide any other active modern apps (only one modern app visible at a time)
    hideAllActiveModernApps();
    hideModernTouchEdgeBars();

    const fromTaskbar = !!launchOptions.fromTaskbar;

    // Capture launch origin for minimize behavior (before we change currentView)
    const launchOrigin = isStartSurfaceVisible() && !fromTaskbar ? 'start' : 'desktop';

    // Hide start screen if we're launching from it
    // (tile flip animation or splash screen will cover the transition)
    if (currentView === 'start') {
        const $startScreen = views.start;
        console.log('Hiding start screen for modern app launch');

        // Remove visible state to trigger opacity fade out (300ms transition)
        $startScreen.removeClass('visible show-content show-content-from-desktop fade-background slide-in opening-from-desktop');

        // Update view state
        setCurrentView('desktop');
        $('body').removeClass('view-start').addClass('view-desktop');
        updateTaskbarVisibility('desktop');
    }
    const splashDelay = 1000;
    const splashFadeDuration = 400;
    const splashColor = fromTaskbar ? getAppTileColor(app.color) : null;
    const launchCleanupDelay = splashDelay + splashFadeDuration + 100;

    // Get window options with defaults
    const windowOptions = app.windowOptions || {};
    const defaultOptions = {
        minimizable: true,
        showIcon: true
    };
    const options = { ...defaultOptions, ...windowOptions };

    // Create the container
    const $container = $('<div class="modern-app-container"></div>');
    $container.attr('data-app-id', app.id);
    if (fromTaskbar) {
        $container.addClass('taskbar-launch');
        if (splashColor) {
            $container.css('background-color', splashColor);
        }
    }

    // Create titlebar trigger area
    const $titlebarTrigger = $('<div class="modern-app-titlebar-trigger"></div>');

    // Create titlebar
    const $titlebar = $('<div class="modern-app-titlebar"></div>');

    // Check if app has MIF icon - determines fallback hierarchy
    const hasMifIcon = app.icon && app.icon.startsWith('mif-');
    let titleIcon = null;
    let plateClass = '';

    if (hasMifIcon) {
        // Use iconImages if available, otherwise MIF icon
        titleIcon = AppsManager.getIconImage(app, 16);
        if (!titleIcon) {
            // Add color plate for apps with MIF icons
            plateClass = app.color ? `app-icon-plate--${app.color}` : '';
        }
    } else {
        // Use logo.png for apps without MIF icons with color plate
        titleIcon = AppsManager.getAppListLogo(app);
        plateClass = app.color ? `app-icon-plate--${app.color}` : '';
    }

    // Add icon to titlebar (if not disabled)
    if (options.showIcon !== false && (titleIcon || app.icon)) {
        const $icon = $(`<span class="modern-app-icon ${plateClass}"></span>`);
        if (titleIcon) {
            const imgStyle = plateClass ? 'style="object-fit: cover; width: 100%; height: 100%;"' : '';
            $icon.append(`<img src="${titleIcon}" alt="" ${imgStyle}>`);
        } else if (app.icon) {
            $icon.append(`<span class="${app.icon}"></span>`);
        }
        $titlebar.append($icon);
    } else {
        $titlebar.addClass('no-icon');
    }

    // Add app name to titlebar
    $titlebar.append(`<span class="modern-app-name">${app.name}</span>`);

    // Create controls section
    const $controls = $('<div class="modern-app-controls"></div>');

    // Minimize button
    const $minimizeBtn = $(`
        <button class="modern-app-control-btn minimize" title="Minimize">
            <svg width="16" height="16" viewBox="0 0 16 16">
                <rect x="3" y="7" width="10" height="2" fill="currentColor"/>
            </svg>
        </button>
    `);

    // Apply window options to minimize button
    if (!options.minimizable) {
        $minimizeBtn.prop('disabled', true).addClass('disabled');
    } else {
        // Minimize button click handler
        $minimizeBtn.on('click', function () {
            minimizeModernApp(app.id);
        });
    }

    // Close button
    const $closeBtn = $(`
        <button class="modern-app-control-btn close" title="Close">
            <svg width="16" height="16" viewBox="0 0 16 16">
                <path d="M2 2 L14 14 M14 2 L2 14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
        </button>
    `);

    // Close button click handler
    $closeBtn.on('click', function () {
        closeModernApp(app.id);
    });

    // Assemble controls
    $controls.append($minimizeBtn);
    $controls.append($closeBtn);

    // Add controls to titlebar
    $titlebar.append($controls);

    // Disable charms triggers when titlebar is visible
    // Track titlebar visibility using mouseenter/mouseleave on trigger and titlebar
    $titlebarTrigger.on('mouseenter', function () {
        $('.charms-trigger').css('pointer-events', 'none');
    });

    $titlebar.on('mouseenter', function () {
        $('.charms-trigger').css('pointer-events', 'none');
    });

    // Re-enable when titlebar hides (mouse leaves both trigger and titlebar areas)
    $titlebarTrigger.on('mouseleave', function (e) {
        // Check if mouse is NOT moving to the titlebar
        const titlebarRect = $titlebar[0].getBoundingClientRect();
        if (e.clientY > titlebarRect.bottom) {
            $('.charms-trigger').css('pointer-events', '');
        }
    });

    $titlebar.on('mouseleave', function () {
        $('.charms-trigger').css('pointer-events', '');
    });

    // Create content area - use webview if specified, otherwise iframe
    const $content = $('<div class="modern-app-content"></div>');

    // Check if app should use webview mode (for embedding external websites)
    if (app.webview && app.webview.enabled) {
        console.log('Creating webview for app:', app.id);
        const webviewUrl = app.webview.url || app.path;
        const partition = app.webview.partition || 'persist:' + app.id;

        const $webview = $('<webview></webview>');
        $webview.attr({
            'src': webviewUrl,
            'partition': partition,
            'allowpopups': true,
            'nodeintegration': false,
            'disablewebsecurity': true
        });
        $webview.addClass('modern-app-iframe'); // Reuse same CSS class for styling

        // Add loading overlay
        const $loading = $(`
            <div class="webview-loading">
                <div class="spinner"></div>
                <div class="loading-text">Loading ${app.name}...</div>
            </div>
        `);
        $content.append($loading);
        $content.append($webview);

        // Create navigation bar for webview
        const $navBar = $(`
            <div class="modern-webview-bar">
                <div class="modern-webview-bar-controls">
                    <button class="modern-webview-bar-btn" data-action="back" title="Back">
                        <span class="mif-arrow-left"></span>
                        <div class="modern-webview-bar-btn-label">Back</div>
                    </button>
                    <button class="modern-webview-bar-btn" data-action="forward" title="Forward">
                        <span class="mif-arrow-right"></span>
                        <div class="modern-webview-bar-btn-label">Forward</div>
                    </button>
                    <button class="modern-webview-bar-btn" data-action="refresh" title="Refresh">
                        <span class="mif-refresh"></span>
                        <div class="modern-webview-bar-btn-label">Refresh</div>
                    </button>
                    <button class="modern-webview-bar-expand" title="Show labels">
                        <span class="mif-more-horiz"></span>
                    </button>
                </div>
            </div>
        `);
        $content.append($navBar);

        // Handle webview events
        const webviewElement = $webview[0];

        // Update navigation button states
        function updateNavButtons() {
            const canGoBack = webviewElement.canGoBack();
            const canGoForward = webviewElement.canGoForward();
            $navBar.find('[data-action="back"]').prop('disabled', !canGoBack);
            $navBar.find('[data-action="forward"]').prop('disabled', !canGoForward);
        }

        webviewElement.addEventListener('did-start-loading', () => {
            console.log('Webview started loading:', app.id);
        });

        webviewElement.addEventListener('did-finish-load', () => {
            console.log('Webview finished loading:', app.id);
            $loading.fadeOut(300, function () { $(this).remove(); });
            updateNavButtons();

            // Inject CSS to ensure the page fills the webview properly
            webviewElement.insertCSS(`
                html, body, iframe {
                    margin: 0 !important;
                    padding: 0 !important;
                    width: 100% !important;
                    height: 100% !important;
                    overflow: auto !important;
                }
            `);
        });

        webviewElement.addEventListener('did-navigate', () => {
            updateNavButtons();
        });

        webviewElement.addEventListener('did-navigate-in-page', () => {
            updateNavButtons();
        });

        webviewElement.addEventListener('did-fail-load', (event) => {
            if (event.errorCode !== -3) { // -3 is aborted
                console.error('Webview failed to load:', event.errorCode, event.errorDescription);
                $loading.find('.loading-text').text(`Error: ${event.errorDescription}`).css('color', '#ff4444');
            }
        });

        // Navigation bar button handlers
        $navBar.find('[data-action="back"]').on('click', () => {
            if (webviewElement.canGoBack()) {
                webviewElement.goBack();
            }
        });

        $navBar.find('[data-action="forward"]').on('click', () => {
            if (webviewElement.canGoForward()) {
                webviewElement.goForward();
            }
        });

        $navBar.find('[data-action="refresh"]').on('click', () => {
            webviewElement.reload();
        });

        $navBar.find('.modern-webview-bar-expand').on('click', () => {
            $navBar.toggleClass('expanded');
        });
    } else if (app.loadDirect) {
        // Load HTML content directly into the container (not in an iframe)
        // This allows webview tags in the HTML to work properly
        console.log('[App.js] Loading HTML directly for app:', app.id);

        fetch(app.path)
            .then(response => response.text())
            .then(html => {
                // Parse the HTML and extract just the body content
                const parser = new DOMParser();
                const doc = parser.parseFromString(html, 'text/html');

                // Get the base path for resolving relative URLs
                const basePath = app.path.substring(0, app.path.lastIndexOf('/') + 1);
                console.log('[App.js] Base path for', app.id, ':', basePath);

                // Helper function to resolve relative URLs
                const resolveUrl = (url) => {
                    if (!url || url.startsWith('http://') || url.startsWith('https://') || url.startsWith('about:')) {
                        return url;
                    }

                    // If it's already absolute from root, return as-is
                    if (url.startsWith('/')) {
                        return url;
                    }

                    // Resolve ../ paths
                    let resolved = basePath + url;
                    const parts = resolved.split('/');
                    const stack = [];

                    for (const part of parts) {
                        if (part === '..') {
                            stack.pop();
                        } else if (part && part !== '.') {
                            stack.push(part);
                        }
                    }

                    resolved = stack.join('/');
                    console.log('[App.js] Resolved', url, 'to', resolved);
                    return resolved;
                };

                // Get stylesheets from head and fix paths
                const styles = doc.querySelectorAll('style, link[rel="stylesheet"]');
                styles.forEach(style => {
                    const cloned = style.cloneNode(true);
                    if (cloned.href && cloned.tagName === 'LINK') {
                        cloned.href = resolveUrl(style.getAttribute('href'));
                    }
                    $content.append($(cloned));
                });

                // Get scripts first (before we clone the body)
                const scripts = doc.querySelectorAll('script');

                // Remove all script tags from the body before getting innerHTML
                // This prevents jQuery from trying to execute them
                scripts.forEach(script => script.remove());

                // Get body content (now without script tags)
                const bodyContent = doc.body.innerHTML;
                const $wrapper = $('<div class="direct-loaded-content"></div>');
                $wrapper.html(bodyContent);
                $content.append($wrapper);

                // Now manually add and execute scripts with fixed paths
                scripts.forEach(script => {
                    const newScript = document.createElement('script');
                    if (script.src) {
                        const resolvedPath = resolveUrl(script.getAttribute('src'));
                        newScript.src = resolvedPath;
                        console.log('[App.js] Loading script:', resolvedPath);
                    } else {
                        newScript.textContent = script.textContent;
                    }
                    // Use vanilla DOM append to avoid jQuery script processing
                    $wrapper[0].appendChild(newScript);
                });
            })
            .catch(error => {
                console.error('[App.js] Failed to load HTML for', app.id, error);
                $content.append($('<div class="error">Failed to load app</div>'));
            });
    } else {
        // Use traditional iframe for local HTML apps
        const $iframe = $(`<iframe class="modern-app-iframe" src="${app.path}"></iframe>`);
        console.log('[App.js] Created iframe for', app.id);
        $content.append($iframe);

        // Send theme variables to iframe once it loads
        $iframe.on('load', function () {
            const iframeWindow = $iframe[0].contentWindow;
            if (iframeWindow) {
                const rootStyles = getComputedStyle(document.documentElement);
                iframeWindow.postMessage({
                    action: 'setThemeVariables',
                    variables: {
                        'ui-accent': rootStyles.getPropertyValue('--ui-accent').trim(),
                        'ui-accent-plus': rootStyles.getPropertyValue('--ui-accent-plus').trim(),
                        'ui-accent-minus': rootStyles.getPropertyValue('--ui-accent-minus').trim(),
                        'ui-accent-text-contrast': rootStyles.getPropertyValue('--ui-accent-text-contrast').trim(),
                        'ui-wall-color': rootStyles.getPropertyValue('--ui-wall-color').trim()
                    }
                }, '*');
                console.log('[App.js] Sent theme variables to modern app iframe:', app.id);
            }
        });
    }

    // Assemble container
    $container.append($titlebarTrigger);
    $container.append($titlebar);
    $container.append($content);

    let $splash = null;
    if (fromTaskbar) {
        $splash = $('<div class="modern-app-splash"></div>');
        const $splashIcon = $('<span class="modern-app-splash-icon"></span>');

        // Check if app has MIF icon - determines fallback hierarchy
        const hasMifIcon = app.icon && app.icon.startsWith('mif-');
        let splashIcon = null;

        if (hasMifIcon) {
            // Use iconImages if available, otherwise MIF icon
            splashIcon = AppsManager.getIconImage(app, 64);
        } else {
            // Use large tile image for apps without MIF icons (largest size available)
            splashIcon = AppsManager.getTileLargeSplash(app);
        }

        if (splashIcon) {
            $splashIcon.append(`<img src="${splashIcon}" alt="">`);
        } else if (app.icon) {
            $splashIcon.append(`<span class="${app.icon}"></span>`);
        }
        $splash.append($splashIcon);
        if (splashColor) {
            $splash.css('background-color', splashColor);
        }
        $container.append($splash);
    }

    // Add to body
    $('body').append($container);

    // Show with animation (only if not already running)
    setTimeout(function () {
        $container.addClass('active');
        // Check if we should animate the opening (don't animate if tile flip overlay is still visible)
        const hasOverlay = $('.tile-flip-overlay').length > 0;
        if (fromTaskbar) {
            const addVisibleClass = () => {
                $container.addClass('taskbar-launch-visible');
            };
            if (window.requestAnimationFrame) {
                window.requestAnimationFrame(addVisibleClass);
            } else {
                setTimeout(addVisibleClass, 0);
            }
        } else if (!hasOverlay) {
            $container.addClass('opening');
            // Remove opening class after animation completes
            setTimeout(function () {
                $container.removeClass('opening');
            }, 300);
        }
    }, 10);

    if (fromTaskbar) {
        setTimeout(function () {
            $container.addClass('taskbar-content-visible');
            if ($splash) {
                $splash.addClass('fade-out');
                setTimeout(function () {
                    $splash.remove();
                    $container.css('background-color', '#000');
                }, splashFadeDuration);
            } else {
                $container.css('background-color', '#000');
            }
            setTimeout(function () {
                $container.removeClass('taskbar-launch taskbar-launch-visible taskbar-content-visible');
                $container.css('background-color', '');
            }, launchCleanupDelay - splashDelay);
        }, splashDelay);
    }

    // Register app as running (with launch origin for minimize behavior)
    AppsManager.registerRunningApp(app.id, app, $container, launchOrigin);

    // Keep charms bar enabled for modern apps (they need access to Settings charm, etc.)
    $('body').addClass('charms-allowed');

    setCurrentView('modern');
    updateTaskbarVisibility('modern');

    console.log('Modern app opened:', app.name);
}

// Close a modern app
function closeModernApp(appId) {
    const runningApp = AppsManager.getRunningApp(appId);
    if (!runningApp) {
        console.error('App not running:', appId);
        return;
    }

    const $container = runningApp.$container;
    const launchOrigin = runningApp.launchOrigin || 'desktop';

    hideModernTouchEdgeBars();

    // Add closing animation
    $container.addClass('closing');

    // Wait for animation to complete
    setTimeout(function () {
        $container.remove();
        console.log('Modern app closed');

        // Unregister app from running apps
        AppsManager.unregisterRunningApp(appId);

        // Check if there are other active modern apps
        const hasOtherActiveModernApps = AppsManager.getRunningApps().some(running =>
            running.app && running.app.type === 'modern' && AppsManager.getAppState(running.app.id) === 'active'
        );

        // If there are other active modern apps, don't change the view
        if (hasOtherActiveModernApps) {
            console.log('Other modern apps are still active, staying in current view');
            return;
        }

        // Return to the view where the app was launched from (same as minimize)
        if (launchOrigin === 'start') {
            console.log('Returning to start screen (app was launched from start)');
            openStartScreen();
        } else {
            console.log('Returning to desktop (app was launched from desktop/taskbar)');
            // If not already on desktop, transition to it
            if (currentView !== 'desktop') {
                transitionToDesktop();
            } else {
                // Already on desktop view, ensure it's visible and update UI state
                const $desktop = views.desktop;
                $desktop.addClass('visible');
                $('body').removeClass('view-modern').addClass('view-desktop');
                $('body').addClass('charms-allowed');
                updateTaskbarVisibility('desktop');

                // Briefly show taskbar if it's set to autohide
                if ($('body').hasClass('taskbar-autohide')) {
                    $('body').addClass('taskbar-peek');
                    setTimeout(() => {
                        $('body').removeClass('taskbar-peek');
                    }, 1500);
                }
            }
        }
    }, 300);
}

// Helper function to hide all active modern apps (without triggering view transitions)
function hideAllActiveModernApps(exceptAppId = null) {
    const runningApps = AppsManager.getRunningApps();
    runningApps.forEach(runningApp => {
        const appId = runningApp.app.id;
        const appType = runningApp.app.type;
        const appState = AppsManager.getAppState(appId);

        // Only hide modern apps that are currently active and not the exception
        if (appType === 'modern' && appState === 'active' && appId !== exceptAppId) {
            const $container = runningApp.$container;
            $container.removeClass('active');
            AppsManager.setAppState(appId, 'minimized');
            console.log('Hidden active modern app:', appId);
        }
    });
}

// Minimize a modern app
function minimizeModernApp(appId) {
    const runningApp = AppsManager.getRunningApp(appId);
    if (!runningApp) {
        console.error('App not running:', appId);
        return;
    }

    const $container = runningApp.$container;
    const launchOrigin = runningApp.launchOrigin || 'desktop';
    let restoreOffsets = null;

    hideModernTouchEdgeBars();

    // Get the taskbar icon position
    const $taskbarIcon = $(`.taskbar-app[data-app-id="${appId}"]`);
    if ($taskbarIcon.length) {
        const iconRect = $taskbarIcon[0].getBoundingClientRect();
        const iconCenterX = iconRect.left + iconRect.width / 2;
        const iconCenterY = iconRect.top + iconRect.height / 2;

        // Calculate the center of the screen
        const screenCenterX = window.innerWidth / 2;
        const screenCenterY = window.innerHeight / 2;

        // Calculate the distance to move
        const translateX = iconCenterX - screenCenterX;
        const translateY = iconCenterY - screenCenterY;

        // Store the animation target for the animation
        $container.css('--minimize-x', `${translateX}px`);
        $container.css('--minimize-y', `${translateY}px`);

        restoreOffsets = { x: translateX, y: translateY };
    }

    // Remember offsets so restore animation can begin from the same origin
    runningApp.restoreAnimationOffsets = restoreOffsets;

    // Add minimizing animation
    $container.addClass('minimizing');

    // Wait for animation to complete
    setTimeout(function () {
        $container.removeClass('active minimizing');

        // Clear the CSS variables
        $container.css('--minimize-x', '');
        $container.css('--minimize-y', '');

        // Update app state
        AppsManager.setAppState(appId, 'minimized');

        // Return to the view where the app was launched from
        if (launchOrigin === 'start') {
            console.log('Returning to start screen (app was launched from start)');
            openStartScreen();
        } else {
            console.log('Returning to desktop (app was launched from desktop/taskbar)');
            // If not already on desktop, transition to it
            if (currentView !== 'desktop') {
                transitionToDesktop();
            } else {
                // Already on desktop view, ensure it's visible and update UI state
                const $desktop = views.desktop;
                $desktop.addClass('visible');
                $('body').removeClass('view-modern').addClass('view-desktop');
                $('body').addClass('charms-allowed');
                updateTaskbarVisibility('desktop');

                // Briefly show taskbar if it's set to autohide
                if ($('body').hasClass('taskbar-autohide')) {
                    $('body').addClass('taskbar-peek');
                    setTimeout(() => {
                        $('body').removeClass('taskbar-peek');
                    }, 1500);
                }
            }
        }

        console.log('Modern app minimized:', appId);
    }, 300);
}

// Restore a modern app
function restoreModernApp(appId) {
    const runningApp = AppsManager.getRunningApp(appId);
    if (!runningApp) {
        console.error('App not running:', appId);
        return;
    }

    const $container = runningApp.$container;

    hideModernTouchEdgeBars();

    // Hide any other active modern apps (only one modern app visible at a time)
    hideAllActiveModernApps(appId);

    // Hide start screen if we're restoring from it
    if (currentView === 'start') {
        const $startScreen = views.start;
        console.log('Hiding start screen for modern app restore');

        // Remove visible state to trigger opacity fade out (300ms transition)
        $startScreen.removeClass('visible show-content show-content-from-desktop fade-background slide-in opening-from-desktop');

        // Update view state
        setCurrentView('desktop');
        $('body').removeClass('view-start').addClass('view-desktop');
        updateTaskbarVisibility('desktop');
    }

    // Reuse stored offsets when available to keep minimize/restore aligned
    let restoreOffsets = runningApp.restoreAnimationOffsets;

    if (!restoreOffsets) {
        // Fallback: calculate from current taskbar icon position
        const $taskbarIcon = $(`.taskbar-app[data-app-id="${appId}"]`);
        if ($taskbarIcon.length) {
            const iconRect = $taskbarIcon[0].getBoundingClientRect();
            const iconCenterX = iconRect.left + iconRect.width / 2;
            const iconCenterY = iconRect.top + iconRect.height / 2;

            const screenCenterX = window.innerWidth / 2;
            const screenCenterY = window.innerHeight / 2;

            restoreOffsets = {
                x: iconCenterX - screenCenterX,
                y: iconCenterY - screenCenterY
            };
        }
    }

    if (restoreOffsets) {
        $container.css('--restore-x', `${restoreOffsets.x}px`);
        $container.css('--restore-y', `${restoreOffsets.y}px`);
    }

    // Show the container and add restoring animation
    $container.addClass('active restoring');

    // Update app state
    AppsManager.setAppState(appId, 'active');

    // Keep charms bar enabled for modern apps
    $('body').addClass('charms-allowed');

    setCurrentView('modern');
    updateTaskbarVisibility('modern');

    // Remove restoring class after animation completes
    setTimeout(function () {
        $container.removeClass('restoring');

        // Clear the CSS variables
        $container.css('--restore-x', '');
        $container.css('--restore-y', '');
    }, 300);

    console.log('Modern app restored:', appId);
}

// ===== CLASSIC APPS =====
let activeClassicWindow = null;
let classicWindowZIndex = 1000;
let launchingApps = new Map(); // Track apps currently being launched to prevent duplicates
const CLASSIC_WINDOW_READY_FALLBACK_MS = 3000;
const EXPLORER_PRELOAD_DELAY_MS = 1500;
let explorerPreloadScheduled = false;

function getClassicWindowOptions(app) {
    const windowOptions = app?.windowOptions || {};
    const defaultOptions = {
        width: 600,
        height: 500,
        resizable: true,
        minimizable: true,
        maximizable: true,
        alwaysOnTop: false,
        showInTaskbar: true,
        showIcon: true
    };

    return { ...defaultOptions, ...windowOptions };
}

function getTaskbarReservedHeight() {
    if (Number.isFinite(taskbarHeight)) {
        return taskbarAutoHideEnabled ? 0 : taskbarHeight;
    }

    const reservedHeight = parseInt(
        getComputedStyle(document.body).getPropertyValue('--taskbar-reserved-height'),
        10
    );

    return Number.isFinite(reservedHeight) ? reservedHeight : 40;
}

function getClassicWindowDefaultBounds(app) {
    const options = getClassicWindowOptions(app);
    const width = options.width;
    const height = options.height;
    const defaultPosition = options.defaultPosition;

    if (defaultPosition && typeof defaultPosition === 'object') {
        const viewportWidth = $(window).width();
        const respectTaskbar = defaultPosition.respectTaskbar !== false;
        const viewportHeight = $(window).height() - (respectTaskbar ? getTaskbarReservedHeight() : 0);
        const horizontal = defaultPosition.horizontal || 'center';
        const vertical = defaultPosition.vertical || 'center';
        const marginX = Number(defaultPosition.marginX) || 0;
        const marginY = Number(defaultPosition.marginY) || 0;

        let left = (viewportWidth - width) / 2;
        let top = (viewportHeight - height) / 2 - 20;

        if (horizontal === 'left') {
            left = marginX;
        } else if (horizontal === 'right') {
            left = viewportWidth - width - marginX;
        }

        if (vertical === 'top') {
            top = marginY;
        } else if (vertical === 'bottom') {
            top = viewportHeight - height - marginY;
        }

        return {
            width,
            height,
            left: Math.max(0, Math.min(left, Math.max(0, viewportWidth - width))),
            top: Math.max(0, Math.min(top, Math.max(0, viewportHeight - height)))
        };
    }

    return {
        width,
        height,
        left: ($(window).width() - width) / 2,
        top: ($(window).height() - height) / 2 - 20
    };
}

function animateClassicWindowOpen($container) {
    setTimeout(function () {
        $container.addClass('opening');
        setTimeout(function () {
            $container.removeClass('opening');
        }, 150);
    }, 10);
}

function resetClassicWindowForFreshLaunch(windowData) {
    if (!windowData?.$container?.length || !windowData.app) {
        return;
    }

    const $container = windowData.$container;
    const app = windowData.app;
    const options = getClassicWindowOptions(app);
    const bounds = getClassicWindowDefaultBounds(app);
    const nextZIndex = options.alwaysOnTop ? 9998 : ++classicWindowZIndex;

    windowData.restoreAnimationOffsets = null;

    $container
        .removeClass('maximized snapped snapped-left snapped-right minimizing restoring closing opening launch-deferred inactive')
        .removeData('isSnapped')
        .removeData('snapZone')
        .removeData('preSnapState')
        .removeData('prevState')
        .removeData('pendingRestore')
        .removeData('pendingFreshLaunch')
        .css({
            width: bounds.width + 'px',
            height: bounds.height + 'px',
            left: bounds.left + 'px',
            top: bounds.top + 'px',
            zIndex: nextZIndex,
            '--minimize-x': '',
            '--minimize-y': '',
            '--restore-x': '',
            '--restore-y': ''
        });

    setClassicWindowMaximizeButtonState($container, false);

    if (options.alwaysOnTop) {
        $container.addClass('always-on-top');
    } else {
        $container.removeClass('always-on-top');
    }
}

function isStartMenuEnabled() {
    return !!navigationSettings.useStartMenu;
}

function isStartMenuOpen() {
    return $('#start-menu').hasClass('visible');
}

function isStartSurfaceVisible() {
    return isStartMenuEnabled() ? isStartMenuOpen() : currentView === 'start';
}

function applyStartMenuModePreference() {
    $('body').toggleClass('start-menu-mode', isStartMenuEnabled());

    if (isStartMenuEnabled() &&
        typeof loadShowMoreTilesFromRegistry === 'function' &&
        typeof saveShowMoreTilesToRegistry === 'function' &&
        typeof applyTileSize === 'function') {
        const showMoreTilesEnabled = loadShowMoreTilesFromRegistry();
        if (!showMoreTilesEnabled) {
            saveShowMoreTilesToRegistry(true);
        }
        applyTileSize(true);
    }

    if (!isStartMenuEnabled()) {
        hideStartMenuImmediately();
        return;
    }

    if (currentView === 'start') {
        transitionToDesktop();
        return;
    }

    if (typeof renderStartMenu === 'function') {
        renderStartMenu();
    }
}

function showPreloadedClassicWindow(windowData) {
    if (!windowData?.$container?.length) {
        return;
    }

    const $container = windowData.$container;
    const wasBackgroundPreload = !!$container.data('backgroundPreload');

    if (wasBackgroundPreload) {
        $container.data('backgroundPreload', false);
        scheduleExplorerPreload();
    }

    if ($container.hasClass('launch-deferred') && !$container.data('classicWindowReady')) {
        console.log('Preloaded classic window launch deferred until ready:', windowData.windowId);
        $container.data('pendingFreshLaunch', true);
        return;
    }

    resetClassicWindowForFreshLaunch(windowData);
    $container.show();
    focusClassicWindow(windowData.windowId);
    AppsManager.setWindowState(windowData.windowId, 'active');
    animateClassicWindowOpen($container);

    console.log('Preloaded classic window shown with fresh launch animation:', windowData.windowId);
}

function isExplorerPreloadEnabled() {
    return process.platform === 'win32';
}

function isDefaultExplorerLaunch(app, launchOptions = {}) {
    return !!(app &&
        app.id === 'explorer' &&
        !launchOptions.openFolderPath &&
        !launchOptions.openFilePath &&
        !launchOptions.forceNewWindow);
}

function getPreloadedExplorerWindow() {
    const windows = AppsManager.getAppWindows('explorer');
    return windows.find(windowData => windowData?.$container?.data('backgroundPreload'));
}

function scheduleExplorerPreload(delay = EXPLORER_PRELOAD_DELAY_MS) {
    if (!isExplorerPreloadEnabled() || explorerPreloadScheduled || getPreloadedExplorerWindow()) {
        return;
    }

    const explorerApp = AppsManager.getAppById('explorer');
    if (!explorerApp) {
        return;
    }

    explorerPreloadScheduled = true;
    setTimeout(function () {
        explorerPreloadScheduled = false;

        if (getPreloadedExplorerWindow()) {
            return;
        }

        console.log('Preloading File Explorer in the background');
        openClassicApp(explorerApp, {
            preloadInBackground: true,
            deferWindowUntilReady: true
        });
    }, delay);
}

function restorePreloadedExplorerWindow(app, launchOptions = {}) {
    if (!isExplorerPreloadEnabled() || !isDefaultExplorerLaunch(app, launchOptions)) {
        return false;
    }

    const preloadedWindow = getPreloadedExplorerWindow();
    if (!preloadedWindow) {
        return false;
    }

    console.log('Using preloaded File Explorer window:', preloadedWindow.windowId);
    showPreloadedClassicWindow(preloadedWindow);
    return true;
}

function shouldRecycleExplorerWindow(windowData) {
    if (!isExplorerPreloadEnabled() || !windowData || windowData.appId !== 'explorer') {
        return false;
    }

    if (windowData.$container?.data('backgroundPreload')) {
        return false;
    }

    const otherWindows = AppsManager.getAppWindows('explorer')
        .filter(candidate => candidate.windowId !== windowData.windowId);

    return otherWindows.length === 0;
}

function sendClassicWindowCommand($container, payload) {
    if (!$container || !$container.length || !payload || typeof payload.action !== 'string') {
        return;
    }

    const webview = $container.find('webview.classic-window-iframe')[0];
    if (webview && typeof webview.send === 'function') {
        webview.send('host-command', payload);
        return;
    }

    const iframe = $container.find('iframe.classic-window-iframe')[0];
    if (iframe?.contentWindow) {
        iframe.contentWindow.postMessage(payload, '*');
    }
}

function recycleExplorerWindow(windowData) {
    if (!windowData?.$container?.length) {
        return;
    }

    const $container = windowData.$container;
    $container.data('backgroundPreload', true);
    $container.data('pendingRestore', false);

    sendClassicWindowCommand($container, { action: 'resetForPreload' });

    if (activeClassicWindow === windowData.windowId) {
        activeClassicWindow = null;
    }

    if (windowData.state === 'minimized') {
        $container.hide();
        AppsManager.setWindowState(windowData.windowId, 'minimized');
    } else {
        minimizeClassicWindow(windowData.windowId);
    }

    console.log('Recycled File Explorer window into the background preload pool:', windowData.windowId);
}

// Open a classic app window
function openClassicApp(app, launchOptions = {}) {
    if (!app.path) {
        console.error('Classic app missing path:', app.id);
        return;
    }

    if (restorePreloadedExplorerWindow(app, launchOptions)) {
        launchingApps.delete(app.id);
        return;
    }

    // Check if app supports multiple windows
    const allowMultipleWindows = app.allowMultipleWindows === true;
    const isBackgroundPreload = !!launchOptions.preloadInBackground;

    // If app doesn't support multiple windows and is already running, just focus it
    if (!allowMultipleWindows && AppsManager.isAppRunning(app.id)) {
        console.log('Classic app already running, focusing:', app.id);
        focusClassicWindow(app.id);
        return;
    }

    // Prevent duplicate rapid launches (debounce)
    // Allow multiple windows, but not duplicate launches within 300ms
    const now = Date.now();
    const lastLaunch = launchingApps.get(app.id);
    if (lastLaunch && (now - lastLaunch) < 300) {
        console.log('Prevented duplicate launch of:', app.id, '(too soon after previous launch)');
        return;
    }
    launchingApps.set(app.id, now);

    console.log('Loading classic app from:', app.path, allowMultipleWindows ? '(multiple windows allowed)' : '');

    // Get window options with defaults
    const options = getClassicWindowOptions(app);
    const shouldDeferReveal = launchOptions.deferWindowUntilReady !== false &&
        options.deferShowUntilReady !== false;
    const requiresExplicitReadySignal = app.id === 'explorer';

    // Create the container (start with active class since it's being opened)
    const $container = $('<div class="classic-app-container"></div>');
    $container.attr('data-app-id', app.id);
    $container.data('classicWindowReady', !shouldDeferReveal);

    if (isBackgroundPreload) {
        $container.addClass('inactive');
        $container.data('backgroundPreload', true);
    } else {
        $container.addClass('active');
    }

    if (shouldDeferReveal) {
        $container.addClass('launch-deferred');
    }

    // Unfocus any currently active windows
    if (!isBackgroundPreload) {
        $('.classic-app-container').removeClass('active').addClass('inactive');
    }

    // Create titlebar
    const $titlebar = $('<div class="classic-window-titlebar"></div>');

    // Create title section
    const $title = $('<div class="classic-window-title"></div>');
    const classicTitleIcon = AppsManager.getIconImage(app, 16);
    if (options.showIcon !== false && (classicTitleIcon || app.icon)) {
        const $icon = $('<span class="classic-window-icon"></span>');
        if (classicTitleIcon) {
            $icon.append(`<img src="${classicTitleIcon}" alt="">`);
        } else if (app.icon) {
            $icon.append(`<span class="${app.icon}"></span>`);
        }
        $title.append($icon);
    } else {
        $title.addClass('no-icon');
    }
    $title.append(`<span class="classic-window-name">${app.name}</span>`);

    // Create controls section
    const $controls = $('<div class="classic-window-controls"></div>');

    // Minimize button
    const $minimizeBtn = $(`
        <button class="classic-window-control-btn minimize" title="Minimize">
            <span class="classic-window-control-glyph" aria-hidden="true"></span>
        </button>
    `);

    // Maximize button
    const $maximizeBtn = $(`
        <button class="classic-window-control-btn maximize" title="Maximize">
            <span class="classic-window-control-glyph" aria-hidden="true"></span>
        </button>
    `);

    // Close button
    const $closeBtn = $(`
        <button class="classic-window-control-btn close" title="Close">
            <span class="classic-window-control-glyph" aria-hidden="true"></span>
        </button>
    `);

    // Apply window options to buttons
    if (!options.minimizable) {
        $minimizeBtn.prop('disabled', true).addClass('disabled');
    } else {
        $minimizeBtn.on('click', function (e) {
            e.stopPropagation();
            const windowId = $container.attr('data-window-id');
            minimizeClassicWindow(windowId || app.id);
        });
    }

    if (!options.maximizable) {
        $maximizeBtn.prop('disabled', true).addClass('disabled');
    } else {
        $maximizeBtn.on('click', function (e) {
            e.stopPropagation();
            const windowId = $container.attr('data-window-id');
            toggleMaximizeClassicWindow(windowId || app.id);
        });
    }

    $closeBtn.on('click', function (e) {
        e.stopPropagation();
        const windowId = $container.attr('data-window-id');
        closeClassicApp(windowId || app.id);
    });

    // Assemble controls
    $controls.append($minimizeBtn);
    $controls.append($maximizeBtn);
    $controls.append($closeBtn);

    // Assemble titlebar
    $titlebar.append($title);
    $titlebar.append($controls);

    // Create content area
    const $content = $('<div class="classic-window-content"></div>');
    let $iframe = null;
    let windowId = null;
    let revealTimeoutId = null;
    let hasRevealedWindow = !shouldDeferReveal;

    const revealClassicWindow = (source = 'ready') => {
        if (hasRevealedWindow || isBackgroundPreload) {
            return;
        }

        hasRevealedWindow = true;
        $container.removeClass('launch-deferred');
        console.log(`Classic window revealed for ${app.id} via ${source}`);
        animateClassicWindowOpen($container);
    };

    const markClassicWindowReady = (source = 'ready') => {
        if ($container.data('classicWindowReady')) {
            return;
        }

        if (revealTimeoutId) {
            clearTimeout(revealTimeoutId);
            revealTimeoutId = null;
        }

        $container.data('classicWindowReady', true);
        console.log(`Classic window ready for ${app.id} via ${source}`);

        if ($container.data('pendingRestore')) {
            $container.removeData('pendingRestore');
            restoreClassicWindow(windowId || app.id);
            return;
        }

        if ($container.data('pendingFreshLaunch')) {
            $container.removeData('pendingFreshLaunch');
            showPreloadedClassicWindow(AppsManager.getRunningWindow(windowId));
            return;
        }

        revealClassicWindow(source);
    };

    if (app.loadDirect) {
        // Load HTML content directly (similar to modern apps)
        console.log('[App.js] Loading classic app HTML directly:', app.id);

        fetch(app.path)
            .then(response => response.text())
            .then(html => {
                const parser = new DOMParser();
                const doc = parser.parseFromString(html, 'text/html');

                // Get the base path for resolving relative URLs
                const basePath = app.path.substring(0, app.path.lastIndexOf('/') + 1);

                // Helper function to resolve relative URLs
                const resolveUrl = (url) => {
                    if (!url || url.startsWith('http://') || url.startsWith('https://') || url.startsWith('about:')) {
                        return url;
                    }
                    if (url.startsWith('/')) {
                        return url;
                    }

                    let resolved = basePath + url;
                    const parts = resolved.split('/');
                    const stack = [];

                    for (const part of parts) {
                        if (part === '..') {
                            stack.pop();
                        } else if (part && part !== '.') {
                            stack.push(part);
                        }
                    }

                    return stack.join('/');
                };

                // Get stylesheets from head and fix paths
                const styles = doc.querySelectorAll('style, link[rel="stylesheet"]');
                styles.forEach(style => {
                    const cloned = style.cloneNode(true);
                    if (cloned.href && cloned.tagName === 'LINK') {
                        cloned.href = resolveUrl(style.getAttribute('href'));
                    }
                    $content.append($(cloned));
                });

                // Get scripts first
                const scripts = doc.querySelectorAll('script');
                scripts.forEach(script => script.remove());

                // Get body content
                const bodyContent = doc.body.innerHTML;
                const $wrapper = $('<div class="direct-loaded-content"></div>');
                $wrapper.html(bodyContent);
                $wrapper.attr('data-app-id', app.id);
                $content.append($wrapper);

                // Execute scripts with fixed paths
                scripts.forEach(script => {
                    const newScript = document.createElement('script');
                    if (script.src) {
                        newScript.src = resolveUrl(script.getAttribute('src'));
                    } else {
                        newScript.textContent = script.textContent;
                    }
                    $wrapper[0].appendChild(newScript);
                });

                // Send openFile message if needed (after scripts load)
                if (launchOptions.openFilePath) {
                    setTimeout(() => {
                        const event = new CustomEvent('openFile', {
                            detail: { filePath: launchOptions.openFilePath },
                            bubbles: true,
                            cancelable: true
                        });
                        $wrapper[0].dispatchEvent(event);
                    }, 100);
                }

                markClassicWindowReady('direct-load');
            })
            .catch(error => {
                console.error('[App.js] Failed to load classic app HTML:', error);
                $content.append($('<div class="error">Failed to load app</div>'));
                markClassicWindowReady('load-error');
            });
    } else if (app.useWebview) {
        // Use Electron webview with nodeIntegration for apps that need Node.js access
        $iframe = $(`<webview class="classic-window-iframe" src="${app.path}" nodeintegration webpreferences="contextIsolation=no"></webview>`);
        $content.append($iframe);

        // Send theme variables to webview once it loads
        $iframe.on('dom-ready', function () {
            const webview = $iframe[0];
            if (webview) {
                const rootStyles = getComputedStyle(document.documentElement);
                webview.send('setThemeVariables', {
                    variables: {
                        'ui-accent': rootStyles.getPropertyValue('--ui-accent').trim(),
                        'ui-accent-plus': rootStyles.getPropertyValue('--ui-accent-plus').trim(),
                        'ui-accent-minus': rootStyles.getPropertyValue('--ui-accent-minus').trim(),
                        'ui-accent-text-contrast': rootStyles.getPropertyValue('--ui-accent-text-contrast').trim(),
                        'ui-wall-color': rootStyles.getPropertyValue('--ui-wall-color').trim()
                    }
                });
                console.log('[App.js] Sent theme variables to classic app webview:', app.id);
            }

            if (!requiresExplicitReadySignal) {
                markClassicWindowReady('dom-ready');
            }
        });

        // Listen for IPC messages from webview
        $iframe.on('ipc-message', function (event) {
            const channel = event.originalEvent.channel;
            const args = event.originalEvent.args || [];

            if (channel === 'window-message') {
                // Forward as postMessage for compatibility
                const messageData = args[0];
                if (messageHandler) {
                    messageHandler({ data: messageData });
                }
            }
        });
    } else {
        // Use traditional iframe
        $iframe = $(`<iframe class="classic-window-iframe" src="${app.path}"></iframe>`);
        $content.append($iframe);

        // Send theme variables to iframe once it loads
        $iframe.on('load', function () {
            const iframeWindow = $iframe[0].contentWindow;
            if (iframeWindow) {
                const rootStyles = getComputedStyle(document.documentElement);
                iframeWindow.postMessage({
                    action: 'setThemeVariables',
                    variables: {
                        'ui-accent': rootStyles.getPropertyValue('--ui-accent').trim(),
                        'ui-accent-plus': rootStyles.getPropertyValue('--ui-accent-plus').trim(),
                        'ui-accent-minus': rootStyles.getPropertyValue('--ui-accent-minus').trim(),
                        'ui-accent-text-contrast': rootStyles.getPropertyValue('--ui-accent-text-contrast').trim(),
                        'ui-wall-color': rootStyles.getPropertyValue('--ui-wall-color').trim()
                    }
                }, '*');
                console.log('[App.js] Sent theme variables to classic app iframe:', app.id);
            }

            if (!requiresExplicitReadySignal) {
                markClassicWindowReady('load');
            }
        });
    }

    // Add resize handles (only if resizable)
    if (options.resizable) {
        const resizeHandles = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
        resizeHandles.forEach(direction => {
            const $handle = $(`<div class="classic-window-resize-handle ${direction}"></div>`);
            $container.append($handle);
        });
    } else {
        $container.addClass('non-resizable');
    }

    // Assemble container
    $container.append($titlebar);
    $container.append($content);

    // Set initial position (centered) using window options
    const initialBounds = getClassicWindowDefaultBounds(app);
    const windowWidth = initialBounds.width;
    const windowHeight = initialBounds.height;
    const left = initialBounds.left;
    const top = initialBounds.top;

    // Calculate initial z-index
    let initialZIndex = ++classicWindowZIndex;
    if (options.alwaysOnTop) {
        initialZIndex = 9998; // Below modern apps (9999) but above other classic windows
        $container.addClass('always-on-top');
    }

    $container.css({
        width: windowWidth + 'px',
        height: windowHeight + 'px',
        left: left + 'px',
        top: top + 'px',
        zIndex: initialZIndex
    });

    // Add to desktop
    $('#desktop').append($container);

    if (!shouldDeferReveal && !isBackgroundPreload) {
        animateClassicWindowOpen($container);
    } else if (shouldDeferReveal) {
        revealTimeoutId = setTimeout(function () {
            console.warn(`Classic window readiness timed out for ${app.id}; revealing fallback window`);
            markClassicWindowReady('timeout');
        }, CLASSIC_WINDOW_READY_FALLBACK_MS);
    }

    // Register window as running and get unique window ID
    windowId = AppsManager.registerRunningWindow(app.id, app, $container);
    $container.attr('data-window-id', windowId);

    // Clear launch flag now that window is registered
    launchingApps.delete(app.id);

    // Set as active window
    if (isBackgroundPreload) {
        $container.hide();
        AppsManager.setWindowState(windowId, 'minimized');
    } else {
        activeClassicWindow = windowId;
    }

    // Pass windowId to iframe/webview so it can identify itself in messages
    if ($iframe && $iframe[0]) {
        if (app.useWebview) {
            // For webviews, use ipc-message
            $iframe.on('dom-ready', function () {
                const normalizedLaunchOptions = { ...launchOptions };
                $iframe[0].send('setWindowId', {
                    windowId: windowId,
                    appId: app.id
                });

                if (Object.keys(normalizedLaunchOptions).length > 0) {
                    $iframe[0].send('setLaunchOptions', {
                        launchOptions: normalizedLaunchOptions
                    });
                }

                if (normalizedLaunchOptions.openFilePath) {
                    $iframe[0].send('openFile', {
                        filePath: normalizedLaunchOptions.openFilePath
                    });
                }

                if (normalizedLaunchOptions.initialAppletId) {
                    $iframe[0].send('openApplet', {
                        appletId: normalizedLaunchOptions.initialAppletId
                    });
                }
            });
        } else if ($iframe[0].contentWindow) {
            const deliverLaunchContextToIframe = () => {
                const iframeWindow = $iframe[0].contentWindow;
                if (!iframeWindow) {
                    return;
                }

                const normalizedLaunchOptions = { ...launchOptions };
                iframeWindow.launchOptions = normalizedLaunchOptions;
                iframeWindow.postMessage({
                    action: 'setWindowId',
                    windowId: windowId,
                    appId: app.id
                }, '*');

                if (Object.keys(normalizedLaunchOptions).length > 0) {
                    iframeWindow.postMessage({
                        action: 'setLaunchOptions',
                        launchOptions: normalizedLaunchOptions
                    }, '*');
                }

                if (normalizedLaunchOptions.openFilePath) {
                    iframeWindow.postMessage({
                        action: 'openFile',
                        filePath: normalizedLaunchOptions.openFilePath
                    }, '*');
                }

                if (normalizedLaunchOptions.initialAppletId) {
                    iframeWindow.postMessage({
                        action: 'openApplet',
                        appletId: normalizedLaunchOptions.initialAppletId
                    }, '*');
                }
            };

            // For regular iframes, use postMessage plus a direct launchOptions assignment.
            $iframe.on('load', function () {
                deliverLaunchContextToIframe();
                setTimeout(deliverLaunchContextToIframe, 50);
            });
        }
    }

    // Initialize window dragging
    initClassicWindowDrag($container, $titlebar);

    // Initialize window resizing (only if resizable)
    if (options.resizable) {
        initClassicWindowResize($container);
    }

    // Click anywhere on window to focus it
    $container.on('mousedown', function () {
        // Focus this window when clicking anywhere on it
        const windowId = $container.attr('data-window-id');
        focusClassicWindow(windowId || app.id);
        // Don't stop propagation - let other handlers work too
    });

    // Listen for messages from iframe - using a closure to capture windowId
    const messageHandler = function (e) {
        // Only handle messages from this specific window
        if (e.data.windowId && e.data.windowId !== windowId) {
            return; // Message is for a different window
        }

        // Also check appId for backward compatibility with apps that don't send windowId
        if (e.data.appId && e.data.appId !== app.id) {
            return; // Message is for a different app
        }

        if (e.data.action === 'closeClassicApp') {
            closeClassicApp(windowId);
        } else if (e.data.action === 'updateWindowTitle' && e.data.title) {
            updateClassicWindowTitle(windowId, e.data.title);
        } else if (e.data.action === 'updateWindowIcon' && e.data.iconPath) {
            updateClassicWindowIcon(windowId, e.data.iconPath);
        } else if (e.data.action === 'classicAppReady') {
            markClassicWindowReady('app-ready');
        } else if (e.data.action === 'applyTaskbarSettings') {
            // Handle taskbar settings from Taskbar Properties
            applyTaskbarSettings(e.data.settings);
        } else if (e.data.action === 'launchRunCommand' && app.id === 'run') {
            const command = typeof e.data.command === 'string' ? e.data.command : '';
            const result = handleRunCommand(command);

            if (result.success) {
                if (result.launchedAppId !== app.id) {
                    closeClassicApp(windowId);
                }
            } else {
                const windowData = AppsManager.getRunningWindow(windowId);
                if (windowData && windowData.$container) {
                    const iframeEl = windowData.$container.find('iframe')[0];
                    if (iframeEl && iframeEl.contentWindow) {
                        iframeEl.contentWindow.postMessage({
                            action: 'runCommandResult',
                            success: false,
                            message: result.message || '',
                            command: command
                        }, '*');
                    }
                }
            }
        }
    };
    window.addEventListener('message', messageHandler);

    // Store the message handler so we can remove it when the window closes
    $container.data('messageHandler', messageHandler);

    console.log('Classic app opened:', app.name);
}

// Close a classic app
async function closeClassicApp(windowIdOrAppId) {
    // Determine if this is a windowId or appId
    // WindowIds have format: appId-timestamp-random (e.g., "notepad-1234567890-1234")
    const isWindowId = windowIdOrAppId && windowIdOrAppId.includes('-') &&
        windowIdOrAppId.split('-').length >= 3;

    let windowData;
    let windowId;

    if (isWindowId) {
        // Direct window lookup
        windowData = AppsManager.getRunningWindow(windowIdOrAppId);
        windowId = windowIdOrAppId;
    } else {
        // Backward compatibility: get first window for this app
        const windows = AppsManager.getAppWindows(windowIdOrAppId);
        if (windows.length > 0) {
            windowData = windows[0];
            windowId = windowData.windowId;
        }
    }

    if (!windowData) {
        console.error('Classic window not running:', windowIdOrAppId);
        return;
    }

    if (shouldRecycleExplorerWindow(windowData)) {
        recycleExplorerWindow(windowData);
        return;
    }

    const $container = windowData.$container;
    const $iframe = $container.find('iframe');

    // Check if iframe has a confirmClose method
    if ($iframe.length && $iframe[0].contentWindow) {
        const iframeWindow = $iframe[0].contentWindow;

        // Check if the app wants to handle close confirmation
        if (typeof iframeWindow.confirmClose === 'function') {
            const canClose = await iframeWindow.confirmClose();
            if (!canClose) {
                // App cancelled the close
                return;
            }
        }
    }

    // Add closing animation
    $container.addClass('closing');

    // Remove message handler for this window
    const messageHandler = $container.data('messageHandler');
    if (messageHandler) {
        window.removeEventListener('message', messageHandler);
    }

    // Wait for animation to complete
    setTimeout(function () {
        $container.remove();
        console.log('Classic window closed:', windowId);

        // Unregister window from running windows
        AppsManager.unregisterRunningWindow(windowId);

        // Clear active window if this was it
        if (activeClassicWindow === windowId) {
            activeClassicWindow = null;
        }
    }, 150);
}

// Handle Run dialog commands and launch matching apps
function handleRunCommand(rawCommand) {
    const command = typeof rawCommand === 'string' ? rawCommand.trim() : '';
    if (!command) {
        return {
            success: false,
            message: 'Please enter the name of a program, folder, document, or Internet resource.'
        };
    }

    const normalized = command.toLowerCase();
    const normalizedWithoutExe = normalized.endsWith('.exe')
        ? normalized.slice(0, -4)
        : normalized;

    const allApps = AppsManager.getAllApps() || [];

    const directMatch = allApps.find(app => {
        const appIdLower = (app.id || '').toLowerCase();
        return appIdLower === normalized || appIdLower === normalizedWithoutExe;
    });

    if (directMatch) {
        if (directMatch.id !== 'run') {
            launchApp(directMatch.id);
        }
        return { success: true, launchedAppId: directMatch.id };
    }

    const aliasMatch = allApps.find(app => {
        if (!Array.isArray(app.runCommands)) {
            return false;
        }
        return app.runCommands.some(alias => {
            if (typeof alias !== 'string') return false;
            const aliasLower = alias.toLowerCase();
            return aliasLower === normalized || aliasLower === normalizedWithoutExe;
        });
    });

    if (aliasMatch) {
        if (aliasMatch.id !== 'run') {
            launchApp(aliasMatch.id);
        }
        return { success: true, launchedAppId: aliasMatch.id };
    }

    return {
        success: false,
        message: `Windows cannot find '${command}'. Check the spelling and try again.`
    };
}

// Focus a classic window (bring to front)
function focusClassicWindow(windowIdOrAppId) {
    // Determine if this is a windowId or appId
    const isWindowId = windowIdOrAppId && windowIdOrAppId.includes('-') &&
        windowIdOrAppId.split('-').length >= 3;

    let windowData;
    let windowId;

    if (isWindowId) {
        windowData = AppsManager.getRunningWindow(windowIdOrAppId);
        windowId = windowIdOrAppId;
    } else {
        // Backward compatibility: get first window for this app
        const windows = AppsManager.getAppWindows(windowIdOrAppId);
        if (windows.length > 0) {
            windowData = windows[0];
            windowId = windowData.windowId;
        }
    }

    if (!windowData) return;

    const $container = windowData.$container;

    // If this window is already active, no need to do anything
    if (activeClassicWindow === windowId && $container.hasClass('active')) {
        return;
    }

    console.log('Focusing classic window:', windowId);

    // Remove active class from all windows
    $('.classic-app-container').removeClass('active').addClass('inactive');

    // Add active class to this window
    $container.removeClass('inactive').addClass('active');

    // Update z-index to bring to front (unless it's always on top)
    if (!$container.hasClass('always-on-top')) {
        // Get all non-always-on-top windows
        const $normalWindows = $('.classic-app-container').not('.always-on-top');

        // Find the highest z-index among normal windows
        let maxZ = 1000;
        $normalWindows.each(function () {
            const z = parseInt($(this).css('zIndex')) || 1000;
            if (z > maxZ) maxZ = z;
        });

        // Set this window's z-index higher than all others
        const newZ = maxZ + 1;
        $container.css('zIndex', newZ);

        // Update the global counter if needed
        if (newZ > classicWindowZIndex) {
            classicWindowZIndex = newZ;
        }
    }

    activeClassicWindow = windowId;

    // Update taskbar to reflect active state
    AppsManager.updateTaskbar();
}

// Update the title of a classic window
function updateClassicWindowTitle(windowIdOrAppId, newTitle) {
    // Determine if this is a windowId or appId
    const isWindowId = windowIdOrAppId && windowIdOrAppId.includes('-') &&
        windowIdOrAppId.split('-').length >= 3;

    let windowData;

    if (isWindowId) {
        windowData = AppsManager.getRunningWindow(windowIdOrAppId);
    } else {
        // Backward compatibility: get first window for this app
        const windows = AppsManager.getAppWindows(windowIdOrAppId);
        if (windows.length > 0) {
            windowData = windows[0];
        }
    }

    if (!windowData) return;

    const $container = windowData.$container;
    const $titleElement = $container.find('.classic-window-name');

    if ($titleElement.length) {
        $titleElement.text(newTitle);
        console.log(`Updated window title for ${windowIdOrAppId} to: ${newTitle}`);
    }
}

function updateClassicWindowIcon(windowIdOrAppId, iconPath) {
    const isWindowId = windowIdOrAppId && windowIdOrAppId.includes('-') &&
        windowIdOrAppId.split('-').length >= 3;

    let windowData;

    if (isWindowId) {
        windowData = AppsManager.getRunningWindow(windowIdOrAppId);
    } else {
        const windows = AppsManager.getAppWindows(windowIdOrAppId);
        if (windows.length > 0) {
            windowData = windows[0];
        }
    }

    if (!windowData?.$container || !iconPath) {
        return;
    }

    const $titleElement = windowData.$container.find('.classic-window-title');
    if (!$titleElement.length) {
        return;
    }

    let $iconContainer = $titleElement.find('.classic-window-icon');
    if (!$iconContainer.length) {
        $iconContainer = $('<span class="classic-window-icon"></span>');
        $titleElement.removeClass('no-icon');
        $titleElement.prepend($iconContainer);
    }

    let $iconImage = $iconContainer.find('img');
    if (!$iconImage.length) {
        $iconContainer.empty();
        $iconImage = $('<img alt="">');
        $iconContainer.append($iconImage);
    }

    $iconImage.attr('src', iconPath);
    console.log(`Updated window icon for ${windowIdOrAppId} to: ${iconPath}`);
}

// Unfocus all classic windows (when clicking on desktop)
function unfocusAllClassicWindows() {
    console.log('Unfocusing all classic windows');

    // Remove active class from all windows
    $('.classic-app-container').removeClass('active').addClass('inactive');

    activeClassicWindow = null;

    // Update taskbar to reflect no active window
    AppsManager.updateTaskbar();
}

// Minimize a classic window
function minimizeClassicWindow(windowIdOrAppId) {
    // Determine if this is a windowId or appId
    const isWindowId = windowIdOrAppId && windowIdOrAppId.includes('-') &&
        windowIdOrAppId.split('-').length >= 3;

    let windowData;
    let windowId;
    let appId;

    if (isWindowId) {
        windowData = AppsManager.getRunningWindow(windowIdOrAppId);
        windowId = windowIdOrAppId;
        appId = windowData ? windowData.appId : null;
    } else {
        // Backward compatibility: get first window for this app
        const windows = AppsManager.getAppWindows(windowIdOrAppId);
        if (windows.length > 0) {
            windowData = windows[0];
            windowId = windowData.windowId;
            appId = windowIdOrAppId;
        }
    }

    if (!windowData) return;

    const $container = windowData.$container;
    let restoreOffsets = null;

    // Get the taskbar icon position
    const $taskbarIcon = $(`.taskbar-app[data-app-id="${appId}"]`);
    if ($taskbarIcon.length) {
        const iconRect = $taskbarIcon[0].getBoundingClientRect();
        const containerRect = $container[0].getBoundingClientRect();

        // Calculate center positions
        const iconCenterX = iconRect.left + iconRect.width / 2;
        const iconCenterY = iconRect.top + iconRect.height / 2;
        const containerCenterX = containerRect.left + containerRect.width / 2;
        const containerCenterY = containerRect.top + containerRect.height / 2;

        // Calculate the distance to move
        const translateX = iconCenterX - containerCenterX;
        const translateY = iconCenterY - containerCenterY;

        // Store the animation target for the animation
        $container.css('--minimize-x', `${translateX}px`);
        $container.css('--minimize-y', `${translateY}px`);

        restoreOffsets = { x: translateX, y: translateY };
    }

    windowData.restoreAnimationOffsets = restoreOffsets;

    // Remove active state since it's being minimized
    $container.removeClass('active').addClass('inactive');

    // Add minimizing animation
    $container.addClass('minimizing');

    // Clear active window reference if this was the active one
    if (activeClassicWindow === windowId) {
        activeClassicWindow = null;
    }

    // Wait for animation to complete
    setTimeout(function () {
        // Hide the window after animation
        $container.hide();

        // Remove animation class
        $container.removeClass('minimizing');

        // Clear the CSS variables
        $container.css('--minimize-x', '');
        $container.css('--minimize-y', '');

        // Update window state
        AppsManager.setWindowState(windowId, 'minimized');

        console.log('Classic window minimized:', windowId);
    }, 200); // Match the animation duration in CSS
}

// Restore a minimized classic window
function restoreClassicWindow(windowIdOrAppId) {
    // Determine if this is a windowId or appId
    const isWindowId = windowIdOrAppId && windowIdOrAppId.includes('-') &&
        windowIdOrAppId.split('-').length >= 3;

    let windowData;
    let windowId;
    let appId;

    if (isWindowId) {
        windowData = AppsManager.getRunningWindow(windowIdOrAppId);
        windowId = windowIdOrAppId;
        appId = windowData ? windowData.appId : null;
    } else {
        // Backward compatibility: get first window for this app
        const windows = AppsManager.getAppWindows(windowIdOrAppId);
        if (windows.length > 0) {
            windowData = windows[0];
            windowId = windowData.windowId;
            appId = windowIdOrAppId;
        }
    }

    if (!windowData) return;

    const $container = windowData.$container;
    const wasBackgroundPreload = !!$container.data('backgroundPreload');

    if (wasBackgroundPreload) {
        $container.data('backgroundPreload', false);
        scheduleExplorerPreload();
    }

    if ($container.hasClass('launch-deferred') && !$container.data('classicWindowReady')) {
        console.log('Classic window restore deferred until ready:', windowId);
        $container.data('pendingRestore', true);
        return;
    }

    let restoreOffsets = windowData.restoreAnimationOffsets;

    if (!restoreOffsets) {
        // Fallback: best-effort calculation if offsets weren't stored
        const $taskbarIcon = $(`.taskbar-app[data-app-id="${appId}"]`);
        if ($taskbarIcon.length) {
            const iconRect = $taskbarIcon[0].getBoundingClientRect();
            const containerRect = $container[0].getBoundingClientRect();

            const iconCenterX = iconRect.left + iconRect.width / 2;
            const iconCenterY = iconRect.top + iconRect.height / 2;
            const containerCenterX = containerRect.left + containerRect.width / 2;
            const containerCenterY = containerRect.top + containerRect.height / 2;

            restoreOffsets = {
                x: iconCenterX - containerCenterX,
                y: iconCenterY - containerCenterY
            };
        }
    }

    if (restoreOffsets) {
        $container.css('--restore-x', `${restoreOffsets.x}px`);
        $container.css('--restore-y', `${restoreOffsets.y}px`);
    }

    // Show the window and add restoring animation
    $container.removeClass('launch-deferred').show().addClass('restoring');

    // Wait for animation to complete
    setTimeout(function () {
        // Remove animation class
        $container.removeClass('restoring');

        // Clear the CSS variables
        $container.css('--restore-x', '');
        $container.css('--restore-y', '');

        // Then focus it (which will bring it to front and update state)
        focusClassicWindow(windowId);

        // Update window state
        AppsManager.setWindowState(windowId, 'active');

        console.log('Classic window restored:', windowId);
    }, 200); // Match the animation duration in CSS
}

function setClassicWindowMaximizeButtonState($container, isRestored) {
    const $maximizeBtn = $container.find('.classic-window-control-btn.maximize');
    $maximizeBtn.toggleClass('is-restored', Boolean(isRestored));
}

// Toggle maximize/restore for a classic window
function toggleMaximizeClassicWindow(windowIdOrAppId) {
    // Determine if this is a windowId or appId
    const isWindowId = windowIdOrAppId && windowIdOrAppId.includes('-') &&
        windowIdOrAppId.split('-').length >= 3;

    let windowData;

    if (isWindowId) {
        windowData = AppsManager.getRunningWindow(windowIdOrAppId);
    } else {
        // Backward compatibility: get first window for this app
        const windows = AppsManager.getAppWindows(windowIdOrAppId);
        if (windows.length > 0) {
            windowData = windows[0];
        }
    }

    if (!windowData) return;

    const $container = windowData.$container;

    if ($container.hasClass('maximized')) {
        // Restore to previous size/position
        const prevState = $container.data('prevState');
        if (prevState) {
            $container.css({
                left: prevState.left,
                top: prevState.top,
                width: prevState.width,
                height: prevState.height
            });
        }
        $container.removeClass('maximized');
        setClassicWindowMaximizeButtonState($container, false);
    } else {
        // If window is snapped, save the snap state to restore to later
        const isSnapped = $container.data('isSnapped');
        if (isSnapped) {
            // Save the preSnapState as prevState so we can restore to it
            const preSnapState = $container.data('preSnapState');
            if (preSnapState) {
                $container.data('prevState', preSnapState);
            }
            // Clear snap state
            $container.removeClass('snapped snapped-left snapped-right');
            $container.removeData('isSnapped');
            $container.removeData('snapZone');
        } else {
            // Save current state
            $container.data('prevState', {
                left: $container.css('left'),
                top: $container.css('top'),
                width: $container.css('width'),
                height: $container.css('height')
            });
        }
        // Maximize
        $container.addClass('maximized');
        setClassicWindowMaximizeButtonState($container, true);
    }
}

// Initialize window dragging
function initClassicWindowDrag($container, $titlebar) {
    let isDragging = false;
    let startX, startY, startLeft, startTop;
    let dragStartedFromMaximized = false;
    let dragStartedFromSnapped = false;
    let hasMovedAtLeastOnePx = false;
    let mouseOffsetRatio = { x: 0.5, y: 0 }; // Track where in the window the user grabbed
    const $iframe = $container.find('.classic-window-iframe');
    let $snapPreview = null;
    let currentSnapZone = null;
    let lastSnapZone = null; // Track the last snap zone to detect changes

    // Store state to restore if movement doesn't occur
    let pendingRestoreState = null;

    // Create snap preview element if it doesn't exist
    if ($('#snap-preview').length === 0) {
        $snapPreview = $('<div id="snap-preview"></div>');
        $('#desktop').append($snapPreview);
    } else {
        $snapPreview = $('#snap-preview');
    }

    // Function to create pulse effects
    function createSnapPulse(x, y, edge) {
        // Remove any existing pulses
        $('.snap-pulse').remove();

        // Create two pulse elements
        const $pulse1 = $('<div class="snap-pulse pulse-1"></div>');
        const $pulse2 = $('<div class="snap-pulse pulse-2"></div>');

        // Position based on edge
        let pulseX = x;
        let pulseY = y;

        if (edge === 'left') {
            pulseX = 0; // Snap to left edge
        } else if (edge === 'right') {
            pulseX = window.innerWidth; // Snap to right edge
        } else if (edge === 'top') {
            pulseY = 0; // Snap to top edge
        }

        $pulse1.css({ left: pulseX + 'px', top: pulseY + 'px' });
        $pulse2.css({ left: pulseX + 'px', top: pulseY + 'px' });

        $('#desktop').append($pulse1);
        $('#desktop').append($pulse2);

        // Remove pulses after animation completes
        setTimeout(() => {
            $pulse1.remove();
            $pulse2.remove();
        }, 750); // 0.5s animation + 0.25s delay
    }

    // Add double-click to maximize/restore
    $titlebar.on('dblclick', function (e) {
        // Don't maximize if clicking on buttons
        if ($(e.target).closest('.classic-window-control-btn').length) {
            return;
        }

        // Get the app ID and toggle maximize
        const appId = $container.data('app-id');
        if (appId) {
            toggleMaximizeClassicWindow(appId);
        }
    });

    $titlebar.on('mousedown', function (e) {
        // Don't drag if clicking on buttons
        if ($(e.target).closest('.classic-window-control-btn').length) {
            return;
        }

        isDragging = true;
        hasMovedAtLeastOnePx = false;
        startX = e.clientX;
        startY = e.clientY;
        pendingRestoreState = null;

        // Handle dragging from maximized state
        if ($container.hasClass('maximized')) {
            dragStartedFromMaximized = true;
            dragStartedFromSnapped = false;

            // Store the state we need to restore later
            const prevState = $container.data('prevState') || {
                width: '800px',
                height: '600px',
                left: '100px',
                top: '100px'
            };

            // Calculate where in the titlebar the user clicked (as a ratio)
            const titlebarWidth = $titlebar.outerWidth();
            mouseOffsetRatio.x = e.offsetX / titlebarWidth;
            mouseOffsetRatio.y = 0;

            // Store pending restore info (don't apply yet)
            pendingRestoreState = {
                type: 'maximized',
                prevState: prevState,
                mouseOffsetRatio: { ...mouseOffsetRatio },
                clickOffsetY: e.offsetY
            };

            startLeft = parseInt($container.css('left'));
            startTop = parseInt($container.css('top'));
        } else if ($container.data('isSnapped')) {
            // Handle dragging from snapped state - restore previous size
            dragStartedFromMaximized = false;
            dragStartedFromSnapped = true;

            const preSnapState = $container.data('preSnapState');
            if (preSnapState) {
                // Calculate where in the titlebar the user clicked (as a ratio)
                const titlebarWidth = $titlebar.outerWidth();
                mouseOffsetRatio.x = e.offsetX / titlebarWidth;

                // Store pending restore info (don't apply yet)
                pendingRestoreState = {
                    type: 'snapped',
                    preSnapState: preSnapState,
                    mouseOffsetRatio: { ...mouseOffsetRatio },
                    clickOffsetY: e.offsetY
                };
            }

            startLeft = parseInt($container.css('left'));
            startTop = parseInt($container.css('top'));
        } else {
            dragStartedFromMaximized = false;
            dragStartedFromSnapped = false;
            startLeft = parseInt($container.css('left'));
            startTop = parseInt($container.css('top'));
        }

        // Disable pointer events on iframe to prevent it from stealing mouse events
        $iframe.css('pointer-events', 'none');

        e.preventDefault();
    });

    $(document).on('mousemove', function (e) {
        if (!isDragging) return;

        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;

        // Check if we've moved at least 1px
        if (!hasMovedAtLeastOnePx && (Math.abs(deltaX) >= 1 || Math.abs(deltaY) >= 1)) {
            hasMovedAtLeastOnePx = true;

            // Now apply the pending restore if we have one
            if (pendingRestoreState) {
                if (pendingRestoreState.type === 'maximized') {
                    // Restore from maximized
                    const prevState = pendingRestoreState.prevState;
                    const offsetRatio = pendingRestoreState.mouseOffsetRatio;
                    const clickOffsetY = pendingRestoreState.clickOffsetY;

                    // Remove maximized class and restore size
                    $container.removeClass('maximized');
                    $container.css({
                        width: prevState.width,
                        height: prevState.height
                    });

                    setClassicWindowMaximizeButtonState($container, false);

                    // Calculate new position so cursor stays at the same spot in the titlebar
                    const newWidth = parseInt(prevState.width);
                    const newLeft = e.clientX - (newWidth * offsetRatio.x);
                    const newTop = e.clientY - clickOffsetY;

                    $container.css({
                        left: newLeft + 'px',
                        top: newTop + 'px'
                    });

                    startLeft = newLeft;
                    startTop = newTop;

                    // Clear the prevState since we've unmaximized
                    $container.removeData('prevState');
                } else if (pendingRestoreState.type === 'snapped') {
                    // Restore from snapped
                    const preSnapState = pendingRestoreState.preSnapState;
                    const offsetRatio = pendingRestoreState.mouseOffsetRatio;
                    const clickOffsetY = pendingRestoreState.clickOffsetY;

                    // Restore size
                    $container.css({
                        width: preSnapState.width,
                        height: preSnapState.height
                    });

                    // Calculate new position so cursor stays at the same spot
                    const newWidth = parseInt(preSnapState.width);
                    const newLeft = e.clientX - (newWidth * offsetRatio.x);
                    const newTop = e.clientY - clickOffsetY;

                    $container.css({
                        left: newLeft + 'px',
                        top: newTop + 'px'
                    });

                    startLeft = newLeft;
                    startTop = newTop;

                    // Clear snap state
                    $container.removeClass('snapped snapped-left snapped-right');
                    $container.removeData('isSnapped');
                    $container.removeData('snapZone');
                    $container.removeData('preSnapState');
                }

                pendingRestoreState = null;
            }
        }

        // Only move the window if it's not maximized/snapped, or if we've already restored it
        if (!pendingRestoreState) {
            $container.css({
                left: (startLeft + deltaX) + 'px',
                top: (startTop + deltaY) + 'px'
            });
        }

        // Detect snap zones (only if we've moved and are not in a pending state)
        if (hasMovedAtLeastOnePx && !pendingRestoreState) {
            const snapThreshold = 10; // pixels from edge to trigger snap
            const inset = 6; // pixels to inset the preview
            const screenWidth = window.innerWidth;
            const screenHeight = window.innerHeight;

            // Get taskbar reserved height from CSS variable
            const taskbarReservedHeight = parseInt(
                getComputedStyle(document.body).getPropertyValue('--taskbar-reserved-height') || '40'
            );
            const availableHeight = screenHeight - taskbarReservedHeight;

            // Get current window position for animation start
            const currentLeft = parseInt($container.css('left'));
            const currentTop = parseInt($container.css('top'));
            const currentWidth = $container.outerWidth();
            const currentHeight = $container.outerHeight();

            currentSnapZone = null;

            if (e.clientX <= snapThreshold) {
                // Left snap
                currentSnapZone = 'left';

                // Check if this is a new snap zone entry
                if (lastSnapZone !== 'left') {
                    // Set initial position to window's current position
                    $snapPreview.css({
                        left: currentLeft + 'px',
                        top: currentTop + 'px',
                        width: currentWidth + 'px',
                        height: currentHeight + 'px',
                        display: 'block'
                    });

                    // Trigger pulse effect
                    createSnapPulse(e.clientX, e.clientY, 'left');

                    // Force a reflow to ensure the initial state is applied
                    $snapPreview[0].offsetHeight;

                    // Animate to final position
                    $snapPreview.css({
                        left: inset + 'px',
                        top: inset + 'px',
                        width: `calc(50% - ${inset * 1.5}px)`,
                        height: `calc(${availableHeight}px - ${inset * 2}px)`
                    });
                }
            } else if (e.clientX >= screenWidth - snapThreshold) {
                // Right snap
                currentSnapZone = 'right';

                // Check if this is a new snap zone entry
                if (lastSnapZone !== 'right') {
                    // Set initial position to window's current position
                    $snapPreview.css({
                        left: currentLeft + 'px',
                        top: currentTop + 'px',
                        width: currentWidth + 'px',
                        height: currentHeight + 'px',
                        display: 'block'
                    });

                    // Trigger pulse effect
                    createSnapPulse(e.clientX, e.clientY, 'right');

                    // Force a reflow to ensure the initial state is applied
                    $snapPreview[0].offsetHeight;

                    // Animate to final position
                    $snapPreview.css({
                        left: `calc(50% + ${inset * 0.5}px)`,
                        top: inset + 'px',
                        width: `calc(50% - ${inset * 1.5}px)`,
                        height: `calc(${availableHeight}px - ${inset * 2}px)`
                    });
                }
            } else if (e.clientY <= snapThreshold) {
                // Top snap (maximize)
                currentSnapZone = 'top';

                // Check if this is a new snap zone entry
                if (lastSnapZone !== 'top') {
                    // Set initial position to window's current position
                    $snapPreview.css({
                        left: currentLeft + 'px',
                        top: currentTop + 'px',
                        width: currentWidth + 'px',
                        height: currentHeight + 'px',
                        display: 'block'
                    });

                    // Trigger pulse effect
                    createSnapPulse(e.clientX, e.clientY, 'top');

                    // Force a reflow to ensure the initial state is applied
                    $snapPreview[0].offsetHeight;

                    // Animate to final position
                    $snapPreview.css({
                        left: inset + 'px',
                        top: inset + 'px',
                        width: `calc(100% - ${inset * 2}px)`,
                        height: `calc(${availableHeight}px - ${inset * 2}px)`
                    });
                }
            } else {
                // No snap zone
                currentSnapZone = null;
                $snapPreview.css('display', 'none');
            }

            // Update last snap zone
            lastSnapZone = currentSnapZone;
        }
    });

    $(document).on('mouseup', function () {
        if (isDragging) {
            // Re-enable pointer events on iframe
            $iframe.css('pointer-events', 'auto');

            // Hide snap preview
            $snapPreview.css('display', 'none');

            // If we never moved and had a pending restore, it means we just clicked
            // Don't restore in that case - keep the window maximized/snapped
            if (!hasMovedAtLeastOnePx && pendingRestoreState) {
                // Just clear the pending state without applying it
                pendingRestoreState = null;
            }

            // Apply snap if in a snap zone (only if we actually moved)
            if (currentSnapZone && hasMovedAtLeastOnePx) {
                // Save current state before snapping (unless we just unmaximized)
                if (!dragStartedFromMaximized && !dragStartedFromSnapped) {
                    $container.data('preSnapState', {
                        left: $container.css('left'),
                        top: $container.css('top'),
                        width: $container.css('width'),
                        height: $container.css('height')
                    });
                } else {
                    // If we dragged from maximized/snapped, use the restored state
                    const restoredState = {
                        left: $container.css('left'),
                        top: $container.css('top'),
                        width: $container.css('width'),
                        height: $container.css('height')
                    };
                    $container.data('preSnapState', restoredState);
                }

                // Mark as snapped
                $container.data('isSnapped', true);
                $container.data('snapZone', currentSnapZone);

                if (currentSnapZone === 'left') {
                    $container.css({
                        left: '0',
                        top: '0',
                        width: '50%',
                        height: '100%'
                    });
                    $container.addClass('snapped snapped-left');
                } else if (currentSnapZone === 'right') {
                    $container.css({
                        left: '50%',
                        top: '0',
                        width: '50%',
                        height: '100%'
                    });
                    $container.addClass('snapped snapped-right');
                } else if (currentSnapZone === 'top') {
                    // Save state for maximize
                    const preSnapState = $container.data('preSnapState');
                    if (preSnapState) {
                        $container.data('prevState', preSnapState);
                    }
                    $container.addClass('maximized');
                    setClassicWindowMaximizeButtonState($container, true);
                    $container.removeData('isSnapped');
                    $container.removeData('snapZone');
                }
            }

            dragStartedFromMaximized = false;
            dragStartedFromSnapped = false;
            hasMovedAtLeastOnePx = false;
            pendingRestoreState = null;
            lastSnapZone = null;

            // Clean up any remaining pulse effects
            $('.snap-pulse').remove();
        }
        isDragging = false;
        currentSnapZone = null;
    });
}

// Initialize window resizing
function initClassicWindowResize($container) {
    let isResizing = false;
    let resizeDirection = null;
    let startX, startY, startWidth, startHeight, startLeft, startTop;

    const $iframe = $container.find('.classic-window-iframe');

    $container.find('.classic-window-resize-handle').on('mousedown', function (e) {
        isResizing = true;
        resizeDirection = $(this).attr('class').split(' ')[1];
        startX = e.clientX;
        startY = e.clientY;
        startWidth = $container.outerWidth();
        startHeight = $container.outerHeight();
        startLeft = parseInt($container.css('left'));
        startTop = parseInt($container.css('top'));

        // Disable pointer events on iframe to prevent it from interfering with resizing
        $iframe.css('pointer-events', 'none');

        // Discard snap state when manually resizing
        if ($container.data('isSnapped')) {
            $container.removeClass('snapped snapped-left snapped-right');
            $container.removeData('isSnapped');
            $container.removeData('snapZone');
            $container.removeData('preSnapState');
        }

        e.preventDefault();
        e.stopPropagation();
    });

    $(document).on('mousemove', function (e) {
        if (!isResizing) return;

        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;

        let newWidth = startWidth;
        let newHeight = startHeight;
        let newLeft = startLeft;
        let newTop = startTop;

        // Calculate new dimensions based on resize direction
        if (resizeDirection.includes('e')) {
            newWidth = Math.max(400, startWidth + deltaX);
        }
        if (resizeDirection.includes('w')) {
            newWidth = Math.max(400, startWidth - deltaX);
            newLeft = startLeft + deltaX;
        }
        if (resizeDirection.includes('s')) {
            newHeight = Math.max(300, startHeight + deltaY);
        }
        if (resizeDirection.includes('n')) {
            newHeight = Math.max(300, startHeight - deltaY);
            newTop = startTop + deltaY;
        }

        $container.css({
            width: newWidth + 'px',
            height: newHeight + 'px',
            left: newLeft + 'px',
            top: newTop + 'px'
        });
    });

    $(document).on('mouseup', function () {
        if (isResizing) {
            // Re-enable pointer events on iframe
            $iframe.css('pointer-events', 'auto');
        }
        isResizing = false;
        resizeDirection = null;
    });
}

// Apply taskbar settings from Taskbar Properties
function applyTaskbarSettings(settings) {
    console.log('Applying taskbar settings:', settings);

    // Update taskbar lock state
    if (settings.locked !== undefined) {
        setTaskbarLocked(settings.locked);
        updateTaskbarLockDisplay();
    }

    if (settings.autoHide !== undefined) {
        setTaskbarAutoHide(settings.autoHide);
    }

    if (settings.smallIcons !== undefined) {
        setTaskbarSmallIcons(settings.smallIcons);
    }

    if (settings.showSearchButton !== undefined) {
        setTaskbarSearchButtonVisible(settings.showSearchButton);
    }

    if (settings.showTaskViewButton !== undefined) {
        setTaskbarTaskViewButtonVisible(settings.showTaskViewButton);
    }

    if (settings.taskbarButtons) {
        console.log('[Taskbar] Taskbar button combine mode change requested:', settings.taskbarButtons, '(not yet visualised)');
    }

    if (settings.navigation) {
        const navChanges = applyNavigationSettingsUpdate(settings.navigation);

        if (Object.prototype.hasOwnProperty.call(navChanges, 'charmsHotCornersEnabled')) {
            handleCharmsHotCornersChange();
        }

        if (Object.prototype.hasOwnProperty.call(navChanges, 'showDesktopBackgroundOnStart')) {
            applyDesktopBackgroundPreference(navChanges.showDesktopBackgroundOnStart.new);
        }

        if (Object.prototype.hasOwnProperty.call(navChanges, 'showAppsViewOnStart')) {
            applyStartScreenDefaultView(true);
        }

        if (Object.prototype.hasOwnProperty.call(navChanges, 'useStartMenu')) {
            applyStartMenuModePreference();
        }
    }

    if (settings.location) {
        console.log('[Taskbar] Location change requested:', settings.location, '(visual reposition not yet implemented)');
    }
}

function renderPinnedTiles() {
    const pinnedApps = AppsManager.getPinnedApps();
    const $tilesContainer = $('#pinned-tiles');

    if (pinnedApps.length === 0) {
        $tilesContainer.html('<p style="color: #fff; padding: 20px;">No pinned apps. Visit All Apps to pin some.</p>');
        return;
    }

    $tilesContainer.html(buildPositionedTileGridHtml(pinnedApps));

    // Re-initialize tiles for 3D effect
    setTimeout(() => {
        initializeTiles();

        // Initialize drag-and-drop for tiles
        if (window.TileDrag && typeof window.TileDrag.refresh === 'function') {
            window.TileDrag.refresh();
        }
    }, 0);
}

function buildPositionedTileGridHtml(apps, layout = null) {
    const resolvedLayout = layout || calculateTileLayout(apps);
    let html = '';

    resolvedLayout.tiles.forEach(tileInfo => {
        const tileHTML = AppsManager.generateTileHTML(tileInfo.app);
        const size = tileInfo.size;
        const gridRowStyle = `${tileInfo.row} / span ${size.rows}`;
        const gridColStyle = `${tileInfo.col} / span ${size.cols}`;
        const positioned = tileHTML.replace(
            'class="tiles__tile',
            `style="grid-row: ${gridRowStyle}; grid-column: ${gridColStyle};" class="tiles__tile`
        );
        html += positioned;
    });

    return html;
}

// Calculate smart tile layout based on size rules
function calculateTileLayout(apps, maxRows = calculatedTileRows) {
    const layout = {
        tiles: [],
        maxColumn: 0
    };

    // Grid state: track occupied cells
    // Each column is 2 half-columns wide (for small tiles)
    const grid = [];

    // Get tile size in half-units
    function getTileSize(app) {
        if (app.size === 'small') return { rows: 1, cols: 1 }; // 0.5 × 0.5
        if (app.size === 'wide') return { rows: 2, cols: 4 }; // 1 × 2
        if (app.size === 'large') return { rows: 4, cols: 4 }; // 2 × 2
        return { rows: 2, cols: 2 }; // 1 × 1 (medium/normal)
    }

    // Find next available position for a tile (with backward floating)
    function findPosition(tileSize, isWideOrLarge = false) {
        // Wide/large tiles must start in columns 1, 5, 9, etc. (every 4 half-columns)

        // Search in 4-column groups (1-4, 5-8, 9-12, etc.)
        for (let groupStart = 1; groupStart < 1000; groupStart += 4) {
            // Within each 4-column group, search all valid starting columns
            const columnsToTry = [];

            if (isWideOrLarge) {
                // Wide/large can only start at column 1, 5, 9, etc.
                columnsToTry.push(groupStart);
            } else {
                // Medium/small can start at any column within the group
                for (let col = groupStart; col < groupStart + 4; col++) {
                    columnsToTry.push(col);
                }
            }

            // For each column in this group, try all rows (top to bottom)
            for (let row = 1; row <= maxRows - tileSize.rows + 1; row++) {
                for (let col of columnsToTry) {
                    if (canPlaceTile(row, col, tileSize)) {
                        return { row, col };
                    }
                }
            }
        }

        // Fallback (should never reach here)
        return { row: 1, col: 1 };
    }

    // Check if tile can be placed at position
    function canPlaceTile(row, col, size) {
        if (row + size.rows - 1 > maxRows) return false;

        // Check if tile would cross a 4-column group boundary
        const startGroup = Math.floor((col - 1) / 4);
        const endGroup = Math.floor((col + size.cols - 2) / 4);
        if (startGroup !== endGroup) {
            return false; // Tile would span across groups
        }

        for (let r = row; r < row + size.rows; r++) {
            for (let c = col; c < col + size.cols; c++) {
                if (grid[`${r},${c}`]) return false;
            }
        }
        return true;
    }

    // Mark grid cells as occupied
    function markOccupied(row, col, size) {
        for (let r = row; r < row + size.rows; r++) {
            for (let c = col; c < col + size.cols; c++) {
                grid[`${r},${c}`] = true;
            }
        }
    }

    // Track small tile groups and their reserved spaces
    let smallTileGroups = []; // Array of { startRow, startCol, tiles: [] }

    apps.forEach(app => {
        const size = getTileSize(app);
        const isWideOrLarge = app.size === 'wide' || app.size === 'large';

        // Handle small tiles - reserve 2×2 blocks and fill them
        if (app.size === 'small') {
            // Try to add to existing group with space
            let addedToGroup = false;
            for (let group of smallTileGroups) {
                if (group.tiles.length < 4) {
                    // Add to this group
                    const positions = [
                        { row: group.startRow, col: group.startCol },
                        { row: group.startRow, col: group.startCol + 1 },
                        { row: group.startRow + 1, col: group.startCol },
                        { row: group.startRow + 1, col: group.startCol + 1 }
                    ];
                    const pos = positions[group.tiles.length];

                    layout.tiles.push({
                        app: app,
                        row: pos.row,
                        col: pos.col,
                        size: { rows: 1, cols: 1 }
                    });
                    layout.maxColumn = Math.max(layout.maxColumn, group.startCol + 1);
                    markOccupied(pos.row, pos.col, { rows: 1, cols: 1 });
                    group.tiles.push(app);
                    addedToGroup = true;
                    break;
                }
            }

            // If not added to existing group, create new group and reserve 2×2 space
            if (!addedToGroup) {
                const pos = findPosition({ rows: 2, cols: 2 }, false);

                // Reserve the entire 2×2 block
                markOccupied(pos.row, pos.col, { rows: 2, cols: 2 });

                // Place first small tile
                layout.tiles.push({
                    app: app,
                    row: pos.row,
                    col: pos.col,
                    size: { rows: 1, cols: 1 }
                });
                layout.maxColumn = Math.max(layout.maxColumn, pos.col + 1);

                // Create group to track this reserved space
                smallTileGroups.push({
                    startRow: pos.row,
                    startCol: pos.col,
                    tiles: [app]
                });
            }
        } else {
            // Place medium/wide/large tile
            const pos = findPosition(size, isWideOrLarge);
            layout.tiles.push({
                app: app,
                row: pos.row,
                col: pos.col,
                size: size
            });
            layout.maxColumn = Math.max(layout.maxColumn, pos.col + size.cols - 1);
            markOccupied(pos.row, pos.col, size);
        }
    });

    return layout;
}

function renderAllAppsList() {
    const allApps = AppsManager.getAllApps();
    const $listContainer = $('#all-apps-list');

    // Filter out apps that shouldn't be shown
    const visibleApps = allApps.filter(app => app.showInStart !== false);

    // Separate modern apps and desktop/classic apps
    const modernApps = visibleApps.filter(app => app.type === 'modern').sort((a, b) => a.name.localeCompare(b.name));
    const desktopApps = visibleApps.filter(app => app.type === 'classic' || app.type === 'meta-classic').sort((a, b) => a.name.localeCompare(b.name));

    // Build items array with metadata for smart column layout
    const items = [];

    // Render modern apps first (alphabetically, grouped by letter)
    let currentLetter = '';
    modernApps.forEach(app => {
        const firstLetter = app.name.charAt(0).toUpperCase();
        if (firstLetter !== currentLetter) {
            currentLetter = firstLetter;
            items.push({
                type: 'header',
                html: `<div class="app-list-header">${currentLetter}</div>`,
                nextItem: 'app' // This header must have an app below it
            });
        }
        items.push({
            type: 'app',
            html: AppsManager.generateAppListItemHTML(app)
        });
    });

    // Render desktop apps (alphabetically, each with its own header)
    desktopApps.forEach(app => {
        items.push({
            type: 'header',
            html: `<div class="app-list-header app-list-header--desktop">${app.name}</div>`,
            nextItem: 'app' // This header must have an app below it
        });
        items.push({
            type: 'app',
            html: AppsManager.generateAppListItemHTML(app)
        });
    });

    // Calculate grid parameters
    const containerHeight = $listContainer.height();
    const itemHeight = 50; // height + gap = 50px + 5px = 55px total
    const gap = 5;
    const rowHeight = itemHeight + gap;
    const maxRowsPerColumn = Math.floor((containerHeight + gap) / rowHeight);

    // Build HTML with smart column breaks
    let html = '';
    let currentRow = 0;

    items.forEach((item) => {
        // Check if this is a header and would be the last item in the column
        // or if there isn't room for the header + at least one app below it
        if (item.type === 'header' && item.nextItem === 'app') {
            // If the header would be at the last row OR second-to-last row (no room for an app below),
            // add spacers to push it to next column
            if (currentRow >= maxRowsPerColumn - 1) {
                // Fill remaining slots in current column with spacers
                while (currentRow < maxRowsPerColumn) {
                    html += `<div class="app-list-spacer"></div>`;
                    currentRow++;
                }
                currentRow = 0; // Reset to new column
            }
        }

        html += item.html;
        currentRow++;

        // Reset row counter when column is full
        if (currentRow >= maxRowsPerColumn) {
            currentRow = 0;
        }
    });

    $listContainer.html(html);
}

// ===== DESKTOP =====
$(document).ready(function () {
    // Select only the taskbar start button (not the floating one)
    const $startButton = $('.taskbar .start-button');

    if ($startButton.length) {
        $startButton.on('click', function () {
            console.log('Start button clicked, currentView:', currentView);
            toggleStartSurface();
        });

        // Right-click to show Quick Links menu (Win+X)
        $startButton.on('contextmenu', function (e) {
            e.preventDefault();
            console.log('Start button right-clicked');
            showQuickLinksMenu();
        });
    }

    initTaskbarShellButtons();
    initNotificationCenter();

    // Update clock in taskbar
    updateTaskbarClock();
    setInterval(updateTaskbarClock, 1000);

    // Initialize wallpaper color extraction
    // This will use cached color immediately if available, then verify in background
    if (window.WallpaperColorExtractor) {
        window.WallpaperColorExtractor.initialize();
    }

    // Initialize desktop context menu
    initDesktopContextMenu();

    if (window.ExplorerEngine && typeof window.ExplorerEngine.initializeDesktop === 'function') {
        window.ExplorerEngine.initializeDesktop().catch(error => {
            console.error('ExplorerEngine: Initialization failed.', error);
        });
    }

    // Taskbar app icon click handler (delegated for dynamic icons)
    $(document).on('click', '.taskbar-app', function () {
        const appId = $(this).attr('data-app-id');
        console.log('Taskbar app clicked:', appId);

        const appState = AppsManager.getAppState(appId);
        const app = AppsManager.getAppById(appId);

        if (!app) return;

        if (!appState || appState === null) {
            // App is not running - launch it
            console.log('Launching app from taskbar:', appId);
            launchApp(app, null, { fromTaskbar: true });
        } else if (appState === 'active') {
            // If app is already active, minimize it (only if minimizable)
            const windowOptions = app.windowOptions || {};
            const isMinimizable = windowOptions.minimizable !== false;

            if (!isMinimizable) {
                console.log('Cannot minimize app - minimize is disabled:', appId);
                return;
            }

            if (app.type === 'modern') {
                minimizeModernApp(appId);
            } else if (app.type === 'meta-classic' || app.type === 'classic') {
                minimizeClassicWindow(appId);
            }
        } else if (appState === 'minimized') {
            // If app is minimized, restore it
            if (app.type === 'modern') {
                restoreModernApp(appId);
            } else if (app.type === 'meta-classic' || app.type === 'classic') {
                restoreClassicWindow(appId);
            }
        }
    });

    // Initialize taskbar context menu
    initTaskbarContextMenu();
});

// Desktop context menu
function initDesktopContextMenu() {
    const $desktopContent = $('.desktop-content');
    const $desktop = $('#desktop');

    // Click on desktop to unfocus all windows
    $desktop.on('mousedown', function (e) {
        // Only unfocus if clicking directly on desktop (not on windows or other elements)
        if (e.target === this || $(e.target).hasClass('desktop-content')) {
            unfocusAllClassicWindows();
        }
    });

    // Right-click on desktop blank area
    $desktopContent.on('contextmenu', function (e) {
        const $targetItem = $(e.target).closest('.desktop-item');
        if ($targetItem.length === 0) {
            unfocusAllClassicWindows();
            e.preventDefault();

            if (window.ExplorerEngine && typeof window.ExplorerEngine.clearSelection === 'function') {
                window.ExplorerEngine.clearSelection();
            }

            showDesktopContextMenu(e.pageX, e.pageY);
        }
    });

    // Hide desktop context menu on click outside
    $(document).on('click', function (e) {
        if (!$(e.target).closest('.desktop-context-menu').length) {
            hideDesktopContextMenu();
        }
    });

    // Desktop context menu item clicks
    $(document).on('click', '.desktop-context-menu-button', function (e) {
        e.preventDefault();
        e.stopPropagation();

        const action = $(this).attr('data-action');
        console.log('Desktop context menu action:', action);

        // Add your desktop context menu actions here
        switch (action) {
            case 'refresh':
                console.log('Refreshing desktop...');
                requestExplorerDesktopRefresh();
                break;
            case 'desktop-paste':
                if (window.ExplorerEngine && typeof window.ExplorerEngine.pasteClipboardToDesktop === 'function') {
                    window.ExplorerEngine.pasteClipboardToDesktop().catch(error => {
                        console.error('ExplorerEngine: Paste failed.', error);
                    });
                }
                break;
            case 'view-size-small':
                if (window.ExplorerEngine && typeof window.ExplorerEngine.setIconSize === 'function') {
                    window.ExplorerEngine.setIconSize('small');
                }
                break;
            case 'view-size-medium':
                if (window.ExplorerEngine && typeof window.ExplorerEngine.setIconSize === 'function') {
                    window.ExplorerEngine.setIconSize('medium');
                }
                break;
            case 'view-size-large':
                if (window.ExplorerEngine && typeof window.ExplorerEngine.setIconSize === 'function') {
                    window.ExplorerEngine.setIconSize('large');
                }
                break;
            case 'toggle-snap-to-grid': {
                if (window.ExplorerEngine && typeof window.ExplorerEngine.toggleSnapToGrid === 'function') {
                    const current = window.ExplorerEngine.getSettings && window.ExplorerEngine.getSettings();
                    const next = !(current && current.snapToGrid);
                    window.ExplorerEngine.toggleSnapToGrid(next);
                }
                break;
            }
            case 'toggle-arrange-icons': {
                if (window.ExplorerEngine && typeof window.ExplorerEngine.toggleArrangeIcons === 'function') {
                    const current = window.ExplorerEngine.getSettings && window.ExplorerEngine.getSettings();
                    const next = !(current && current.arrangeIcons);
                    window.ExplorerEngine.toggleArrangeIcons(next);
                }
                break;
            }
            case 'toggle-show-desktop-icons': {
                if (window.ExplorerEngine && typeof window.ExplorerEngine.toggleShowIcons === 'function') {
                    const current = window.ExplorerEngine.getSettings && window.ExplorerEngine.getSettings();
                    const next = !(current && current.showIcons);
                    window.ExplorerEngine.toggleShowIcons(next);
                }
                break;
            }
            case 'new-folder':
                console.log('Creating new folder...');
                if (window.ExplorerEngine && typeof window.ExplorerEngine.createNewFolder === 'function') {
                    window.ExplorerEngine.createNewFolder().catch(error => {
                        console.error('ExplorerEngine: Create folder failed.', error);
                    });
                }
                break;
            case 'new-text-document':
                console.log('Creating new text document...');
                if (window.ExplorerEngine && typeof window.ExplorerEngine.createNewTextDocument === 'function') {
                    window.ExplorerEngine.createNewTextDocument().catch(error => {
                        console.error('ExplorerEngine: Create text document failed.', error);
                    });
                }
                break;
            case 'new-shortcut':
                console.log('Shortcut creation is not yet implemented.');
                break;
            case 'personalize':
                console.log('Opening personalization...');
                openControlPanelApplet('personalization');
                break;
            case 'screen-resolution':
                console.log('Opening screen resolution...');
                openControlPanelApplet('screen-resolution');
                break;
        }

        hideDesktopContextMenu();
    });
}

function showDesktopContextMenu(x, y) {
    // Ensure all taskbar popups/flyouts are closed before showing a new desktop menu
    closeAllTaskbarPopupsAndMenus();

    // Close all other classic context menus
    closeAllClassicContextMenus();

    // Create desktop context menu
    const $contextMenu = $('<div class="classic-context-menu desktop-context-menu"></div>');

    const explorerSettings = window.ExplorerEngine && typeof window.ExplorerEngine.getSettings === 'function'
        ? window.ExplorerEngine.getSettings()
        : {
            iconSize: 'small',
            snapToGrid: true,
            arrangeIcons: false,
            showIcons: true
        };

    const iconSize = explorerSettings.iconSize || 'small';
    const snapToGridEnabled = explorerSettings.snapToGrid !== false;
    const arrangeIconsEnabled = explorerSettings.arrangeIcons === true;
    const showIconsEnabled = explorerSettings.showIcons !== false;
    const canPasteFromClipboard = window.ExplorerEngine && typeof window.ExplorerEngine.canPasteToDesktop === 'function'
        ? window.ExplorerEngine.canPasteToDesktop()
        : false;

    // Add menu items
    const menuItems = [
        {
            action: 'view',
            text: 'View',
            submenu: [
                { action: 'view-size-small', text: 'Small icons', type: 'radio', group: 'icon-size', checked: iconSize === 'small' },
                { action: 'view-size-medium', text: 'Medium icons', type: 'radio', group: 'icon-size', checked: iconSize === 'medium' },
                { action: 'view-size-large', text: 'Large icons', type: 'radio', group: 'icon-size', checked: iconSize === 'large' },
                { type: 'separator' },
                { action: 'toggle-snap-to-grid', text: 'Align icons to grid', type: 'checkbox', checked: snapToGridEnabled },
                { action: 'toggle-arrange-icons', text: 'Auto arrange icons', type: 'checkbox', checked: arrangeIconsEnabled },
                { type: 'separator' },
                { action: 'toggle-show-desktop-icons', text: 'Show desktop icons', type: 'checkbox', checked: showIconsEnabled }
            ]
        },
        { action: 'refresh', text: 'Refresh' },
        { type: 'separator' },
        { action: 'desktop-paste', text: 'Paste', disabled: !canPasteFromClipboard },
        { type: 'separator' },
        {
            action: 'new',
            text: 'New',
            submenu: [
                { action: 'new-folder', icon: 'resources/images/icons/explorer/generic_folder/16.png', iconType: 'image', text: 'Folder' },
                { action: 'new-shortcut', icon: 'mif-link', text: 'Shortcut', disabled: true },
                { type: 'separator' },
                { action: 'new-text-document', icon: 'resources/images/icons/explorer/text_document/16.png', iconType: 'image', text: 'Text Document' }
            ]
        },
        { type: 'separator' },
        { action: 'screen-resolution', icon: 'mif-display', text: 'Screen resolution' },
        { action: 'personalize', icon: 'resources/images/icons/control panel applets/Personalize/16.png', iconType: 'image', text: 'Personalize' }
    ];

    menuItems.forEach(item => {
        if (item.type === 'separator') {
            $contextMenu.append('<div class="classic-context-menu-separator"></div>');
            return;
        }

        const classes = ['classic-context-menu-item'];
        if (item.submenu) {
            classes.push('has-submenu');
        } else {
            classes.push('desktop-context-menu-button');
        }
        if (item.disabled) {
            classes.push('is-disabled');
        }
        if (item.checked) {
            classes.push('is-checked');
        }

        const $button = $('<div></div>')
            .addClass(classes.join(' '))
            .attr('data-action', item.action || '');
        if (item.type) {
            $button.attr('data-type', item.type);
        }
        if (item.group) {
            $button.attr('data-group', item.group);
        }

        const iconClass = item.type && (item.type === 'checkbox' || item.type === 'radio')
            ? (item.checked ? 'mif-checkmark' : '')
            : (item.icon || '');

        let iconHTML;
        if (iconClass && item.iconType === 'image') {
            iconHTML = `<img src="${iconClass}" alt="" style="width: 16px; height: 16px;" />`;
        } else {
            iconHTML = iconClass ? `<span class="${iconClass}"></span>` : '<span></span>';
        }

        const $icon = $('<span class="classic-context-menu-item-icon"></span>').html(iconHTML);
        const $text = $('<span class="classic-context-menu-item-text"></span>').text(item.text);

        $button.append($icon, $text);

        if (item.submenu) {
            const $arrow = $('<span class="classic-context-menu-submenu-arrow">▶</span>');
            $button.append($arrow);

            const $submenu = $('<div class="classic-context-submenu classic-context-menu"></div>');
            item.submenu.forEach(subItem => {
                if (subItem.type === 'separator') {
                    $submenu.append('<div class="classic-context-menu-separator"></div>');
                    return;
                }

                const subClasses = ['classic-context-menu-item', 'desktop-context-menu-button'];
                if (subItem.disabled) {
                    subClasses.push('is-disabled');
                }
                if (subItem.checked) {
                    subClasses.push('is-checked');
                }

                const subIconClass = subItem.type && (subItem.type === 'checkbox' || subItem.type === 'radio')
                    ? (subItem.checked ? 'mif-checkmark' : '')
                    : (subItem.icon || '');

                let subIconHTML;
                if (subIconClass && subItem.iconType === 'image') {
                    subIconHTML = `<img src="${subIconClass}" alt="" style="width: 16px; height: 16px;" />`;
                } else {
                    subIconHTML = subIconClass ? `<span class="${subIconClass}"></span>` : '<span></span>';
                }

                const $subItem = $('<div></div>')
                    .addClass(subClasses.join(' '))
                    .attr('data-action', subItem.action)
                    .attr('data-type', subItem.type || '')
                    .attr('data-group', subItem.group || '')
                    .html(`
                        <span class="classic-context-menu-item-icon">${subIconHTML}</span>
                        <span class="classic-context-menu-item-text">${subItem.text}</span>
                    `);

                $submenu.append($subItem);
            });

            $button.append($submenu);

            // Prevent default action handling on submenu container
            $button.on('click', function (e) {
                if (e.target === this) {
                    e.preventDefault();
                    e.stopPropagation();
                }
            });
        }

        $contextMenu.append($button);
    });

    // Position context menu
    $contextMenu.css({
        position: 'absolute',
        left: x + 'px',
        top: y + 'px',
        zIndex: 1000
    });

    // Append to desktop
    $('#desktop').append($contextMenu);

    // Disable pointer events on all iframes and webviews
    $('.classic-window-iframe, .modern-app-iframe, webview').css('pointer-events', 'none');

    // Check if menu goes off screen and adjust
    const menuWidth = $contextMenu.outerWidth();
    const menuHeight = $contextMenu.outerHeight();
    const windowWidth = $(window).width();
    const windowHeight = $(window).height();

    if (x + menuWidth > windowWidth) {
        $contextMenu.css('left', (windowWidth - menuWidth - 10) + 'px');
    }
    if (y + menuHeight > windowHeight) {
        $contextMenu.css('top', (windowHeight - menuHeight - 10) + 'px');
    }
}

function hideDesktopContextMenu() {
    $('.desktop-context-menu').remove();
    // Re-enable pointer events on all iframes and webviews
    $('.classic-window-iframe, .modern-app-iframe, webview').css('pointer-events', 'auto');
}

function initTaskbarContextMenu() {
    const $taskbar = $('.taskbar');

    // Right-click on taskbar blank area
    $taskbar.on('contextmenu', function (e) {
        // Only show menu if clicking on the taskbar itself (not on buttons or other elements)
        if (e.target === this || $(e.target).hasClass('taskbar-apps')) {
            e.preventDefault();
            showTaskbarContextMenu(e.pageX, e.pageY);
        }
    });

    // Hide taskbar context menu on click outside
    $(document).on('click', function (e) {
        if (!$(e.target).closest('#taskbar-context-menu').length) {
            hideTaskbarContextMenu();
        }
    });

    // Taskbar context menu item clicks
    $(document).on('click', '.taskbar-context-menu-button', function (e) {
        e.preventDefault();
        e.stopPropagation();

        const action = $(this).attr('data-action');
        console.log('Taskbar context menu action:', action);

        switch (action) {
            case 'task-manager':
                console.log('Opening Task Manager...');
                // TODO: Implement Task Manager functionality
                break;
            case 'toggle-task-view-button':
                setTaskbarTaskViewButtonVisible(!taskbarShowTaskViewButton);
                break;
            case 'toggle-search-button':
                setTaskbarSearchButtonVisible(!taskbarShowSearchButton);
                break;
            case 'lock-taskbar':
                toggleTaskbarLock();
                break;
            case 'properties':
                console.log('Opening Taskbar Properties...');
                launchApp('taskbar-properties');
                break;
        }

        // Hide menu after any action (including lock toggle)
        hideTaskbarContextMenu();
    });

    // Update the lock state display on load
    updateTaskbarContextMenuChecks();
}

function showTaskbarContextMenu(x, y) {
    // Close all taskbar popups and menus first
    closeAllTaskbarPopupsAndMenus();

    // Close all other classic context menus
    closeAllClassicContextMenus();

    const $contextMenu = $('#taskbar-context-menu');

    // Update lock state display
    updateTaskbarContextMenuChecks();

    // Disable pointer events on all iframes and webviews
    $('.classic-window-iframe, .modern-app-iframe, webview').css('pointer-events', 'none');

    // Position context menu
    $contextMenu.css({
        position: 'fixed',
        left: x + 'px',
        top: y + 'px',
        display: 'flex'
    });

    // Check if menu goes off screen and adjust
    const menuWidth = $contextMenu.outerWidth();
    const menuHeight = $contextMenu.outerHeight();
    const windowWidth = $(window).width();
    const windowHeight = $(window).height();

    if (x + menuWidth > windowWidth) {
        $contextMenu.css('left', (windowWidth - menuWidth - 10) + 'px');
    }
    if (y + menuHeight > windowHeight) {
        $contextMenu.css('top', (windowHeight - menuHeight - 10) + 'px');
    }
}

function hideTaskbarContextMenu() {
    $('#taskbar-context-menu').css('display', 'none');
    // Re-enable pointer events on all iframes and webviews
    $('.classic-window-iframe, .modern-app-iframe, webview').css('pointer-events', 'auto');
}

/**
 * Close all taskbar-related popups and menus
 * This ensures mutual exclusion - only one popup/menu can be open at a time
 */
function closeAllTaskbarPopupsAndMenus() {
    hideNotificationCenterPanel();

    // Close all registered classic flyouts (clock, battery, etc.)
    if (window.ClassicFlyoutManager) {
        window.ClassicFlyoutManager.hideAll();
    }

    // Close the volume flyout (managed separately from ClassicFlyoutManager)
    if (window.VolumeUI && typeof window.VolumeUI.hideFlyout === 'function') {
        window.VolumeUI.hideFlyout();
    }

    // Close taskbar context menu
    hideTaskbarContextMenu();

    // Close quick links menu (Win+X)
    if (typeof hideQuickLinksMenu === 'function') {
        hideQuickLinksMenu();
    }

    // Close taskbar item context menu
    if (window.TaskbarItemContextMenu) {
        window.TaskbarItemContextMenu.hideContextMenu();
    }

    // Close eject icon context menu
    if (window.USBEjectMonitor) {
        window.USBEjectMonitor.hideContextMenu();
    }
}

function toggleTaskbarLock() {
    setTaskbarLocked(!taskbarLocked);
    updateTaskbarContextMenuChecks();
}

function setTaskbarContextMenuCheckState(selector, checked) {
    const $icon = $(selector);
    if (!$icon.length) {
        return;
    }

    $icon.html(checked ? '<span class="mif-checkmark"></span>' : '<span></span>');
    $icon.closest('.classic-context-menu-item').toggleClass('is-checked', checked);
}

function updateTaskbarContextMenuChecks() {
    setTaskbarContextMenuCheckState('.taskbar-lock-check', taskbarLocked);
    setTaskbarContextMenuCheckState('.taskbar-search-check', taskbarShowSearchButton);
    setTaskbarContextMenuCheckState('.taskbar-task-view-check', taskbarShowTaskViewButton);
}

function updateTaskbarLockDisplay() {
    updateTaskbarContextMenuChecks();
}

function initTaskbarShellButtons() {
    const $taskbarShellButtons = $('.taskbar-shell-button');
    if (!$taskbarShellButtons.length) {
        return;
    }

    $taskbarShellButtons.on('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
    });

    $taskbarShellButtons.on('contextmenu', function (e) {
        e.preventDefault();
        e.stopPropagation();
        showTaskbarContextMenu(e.pageX, e.pageY);
    });

    updateTaskbarShellButtonsVisibility();
    updateTaskbarShellButtonIcons();
    updateTaskbarContextMenuChecks();

    $(window).on('resize.taskbar-shell-buttons', updateTaskbarShellButtonIcons);
    window.addEventListener('win8-display-settings-changed', updateTaskbarShellButtonIcons);
}

function applyFullscreenBodyState(isFullscreen) {
    document.body.classList.toggle('fullscreen', !!isFullscreen);
}

function isShellFullscreenActive() {
    if (electronIpc) {
        return document.body.classList.contains('fullscreen');
    }

    return Boolean(document.fullscreenElement);
}

async function toggleShellFullscreen(forceState) {
    const targetState = typeof forceState === 'boolean'
        ? forceState
        : !isShellFullscreenActive();

    if (electronIpc && typeof electronIpc.send === 'function') {
        electronIpc.send('toggle-simple-fullscreen', targetState);
        applyFullscreenBodyState(targetState);
        return targetState;
    }

    try {
        if (targetState) {
            if (!document.fullscreenElement) {
                await document.documentElement.requestFullscreen();
            }
        } else if (document.fullscreenElement) {
            await document.exitFullscreen();
        }
    } catch (error) {
        console.error('Failed to toggle fullscreen:', error);
    }

    const nextState = Boolean(document.fullscreenElement);
    applyFullscreenBodyState(nextState);
    return nextState;
}

if (electronIpc && typeof electronIpc.on === 'function') {
    electronIpc.on('fullscreen-state-changed', (_event, state) => {
        applyFullscreenBodyState(Boolean(state));
    });
}

document.addEventListener('fullscreenchange', () => {
    if (!electronIpc) {
        applyFullscreenBodyState(Boolean(document.fullscreenElement));
    }
});

function setStartScreenAllAppsOpen(isOpen) {
    const $startScreen = $('#start-screen');
    if (!$startScreen.length) {
        return;
    }

    $startScreen.toggleClass('all-apps-open', Boolean(isOpen));

    if (typeof window.syncStartScreenAllAppsIdleState === 'function') {
        window.syncStartScreenAllAppsIdleState();
    }
}

function toggleStartScreenAllAppsOpen() {
    const $startScreen = $('#start-screen');
    if (!$startScreen.length) {
        return;
    }

    setStartScreenAllAppsOpen(!$startScreen.hasClass('all-apps-open'));
}

function applyStartScreenDefaultView(enforce = false) {
    const $startScreen = $('#start-screen');
    if (!$startScreen.length) {
        return;
    }

    if (navigationSettings.showAppsViewOnStart) {
        setStartScreenAllAppsOpen(true);
    } else if (enforce) {
        setStartScreenAllAppsOpen(false);
    }
}

function openStartSurface() {
    if (isStartMenuEnabled()) {
        openStartMenu();
    } else {
        openStartScreen();
    }
}

function closeStartSurface(options = {}) {
    if (isStartMenuEnabled()) {
        closeStartMenu(options);
    } else {
        closeStartScreen(options);
    }
}

function toggleStartSurface() {
    if (isStartSurfaceVisible()) {
        closeStartSurface();
    } else {
        openStartSurface();
    }
}

function getActiveModernRunningApp() {
    if (typeof AppsManager === 'undefined' || typeof AppsManager.getRunningApps !== 'function') {
        return null;
    }

    return AppsManager.getRunningApps().find(runningApp =>
        runningApp.app &&
        runningApp.app.type === 'modern' &&
        AppsManager.getAppState(runningApp.app.id) === 'active'
    ) || null;
}

function openStartScreen() {
    if (isStartMenuEnabled()) {
        openStartMenu();
        return;
    }

    const $startScreen = views.start;
    const $desktop = views.desktop;
    const activeModernApp = getActiveModernRunningApp();

    console.log('openStartScreen called');
    console.log('Start screen classes:', $startScreen.attr('class'));

    // Close all popups and menus before showing start screen
    closeAllPopupsAndMenus();

    startReturnModernAppId = activeModernApp ? activeModernApp.app.id : null;

    if (activeModernApp) {
        hideModernTouchEdgeBars();
        hideAllActiveModernApps();
    }

    applyStartScreenDefaultView();
    requestExplorerDesktopRefresh();

    // Set view immediately to prevent race conditions
    setCurrentView('start');
    $('body').removeClass('view-desktop').addClass('view-start');

    // Step 1: Start crossfade - fade out desktop and fade in start screen simultaneously
    $desktop.addClass('fade-out-to-start');

    // Make start screen visible immediately to begin crossfade
    $startScreen.addClass('visible');
    console.log('Added visible class');

    // Add the opening-from-desktop class to start from center (50%)
    $startScreen.addClass('opening-from-desktop');

    // Force reflow
    $startScreen[0].offsetHeight;

    // Step 2: Fade in background (300ms) - using ::before pseudo-element
    $startScreen.addClass('fade-background');
    console.log('Added fade-background class');

    // Step 3: After background fades in, slide in content from center (500ms)
    setTimeout(function () {
        // Only proceed if we're still trying to show start screen (not interrupted by transitionToDesktop)
        if (currentView === 'start') {
            $startScreen.addClass('show-content-from-desktop');
            console.log('Current view:', currentView);
            console.log('Final start screen classes:', $startScreen.attr('class'));
            $('body').addClass('charms-allowed'); // Enable charms bar on start screen
            updateTaskbarVisibility('start'); // Enable taskbar for start screen
        } else {
            console.log('openStartScreen animation cancelled - view changed to:', currentView);
        }
    }, 300);
}

function closeStartScreen(options = {}) {
    if (isStartMenuEnabled()) {
        closeStartMenu(options);
        return;
    }

    const $startScreen = views.start;
    const $desktop = views.desktop;
    const forceDesktop = !!options.forceDesktop;
    const restoreModernAppId = !forceDesktop ? startReturnModernAppId : null;

    console.log('closeStartScreen called');

    // Close all popups and menus before hiding start screen
    closeAllPopupsAndMenus();
    requestExplorerDesktopRefresh();

    // Remove show-content classes to slide UI out to the right
    $startScreen.removeClass('show-content show-content-from-desktop');
    startReturnModernAppId = null;

    if (restoreModernAppId && AppsManager.isAppRunning(restoreModernAppId)) {
        setTimeout(function () {
            if (currentView === 'start') {
                restoreModernApp(restoreModernAppId);
            } else {
                console.log('closeStartScreen modern restore cancelled - view changed to:', currentView);
            }
        }, 500);
        return;
    }

    // After UI slides out, fade out background and crossfade to desktop
    setTimeout(function () {
        $startScreen.removeClass('fade-background slide-in opening-from-desktop');

        // Start fading in desktop while start screen fades out
        $desktop.removeClass('fade-out-to-start');
        $desktop.addClass('visible');
        setCurrentView('desktop');
        $('body').removeClass('view-start').addClass('view-desktop');

        // Immediately ensure taskbar is properly configured for desktop view
        updateTaskbarVisibility('desktop');
        $('body').addClass('charms-allowed'); // Enable charms bar on desktop

        // Briefly show taskbar if it's set to autohide
        if ($('body').hasClass('taskbar-autohide')) {
            $('body').addClass('taskbar-peek');
            setTimeout(() => {
                $('body').removeClass('taskbar-peek');
            }, 1500);
        }

        // Wait for crossfade to complete before hiding start screen
        setTimeout(function () {
            // Only finalize if we're still on desktop (not interrupted by openStartScreen)
            if (currentView === 'desktop') {
                $startScreen.removeClass('visible'); // Hide start screen after fade completes
                console.log('Current view:', currentView);

                // Re-apply taskbar visibility to ensure it stays properly shown
                updateTaskbarVisibility('desktop');
                $('body').addClass('charms-allowed');
            } else {
                console.log('closeStartScreen animation cancelled - view changed to:', currentView);
            }
        }, 400); // Wait for opacity transition to complete
    }, 500);
}

function transitionToDesktop() {
    const $startScreen = views.start;
    const $desktop = views.desktop;

    console.log('transitionToDesktop called');

    hideModernTouchEdgeBars();
    hideAllActiveModernApps();

    // Close all popups and menus before transitioning to desktop
    closeAllPopupsAndMenus();
    requestExplorerDesktopRefresh();

    // Immediately remove show-content classes to prevent tiles from sliding back in
    $startScreen.removeClass('show-content show-content-from-desktop');

    // Show desktop with fade-in animation (it will be behind the Start screen due to z-index)
    $desktop.removeClass('fade-out-to-start'); // Remove fade-out class
    $desktop.addClass('visible fade-in-from-start'); // Show desktop with fade-in
    setCurrentView('desktop');
    $('body').removeClass('view-start').addClass('view-desktop');

    // Immediately ensure taskbar is properly configured for desktop view
    // This ensures the backend registers the change even before the animation completes
    updateTaskbarVisibility('desktop');
    $('body').addClass('charms-allowed'); // Enable charms bar on desktop

    // Briefly show taskbar if it's set to autohide
    if ($('body').hasClass('taskbar-autohide')) {
        $('body').addClass('taskbar-peek');
        setTimeout(() => {
            $('body').removeClass('taskbar-peek');
        }, 1500);
    }

    // Add exit animation class to Start screen (this will fade out simultaneously)
    $startScreen.addClass('exit-to-desktop');
    console.log('Added exit-to-desktop class');

    // Wait for crossfade animation to complete (600ms)
    setTimeout(function () {
        // Only finalize if we're still on desktop (not interrupted by openStartScreen)
        if (currentView === 'desktop') {
            console.log('Crossfade animation complete, cleaning up...');
            $startScreen.removeClass('visible'); // Hide start screen
            // Reset all transition classes - this will return elements to their default states
            $startScreen.removeClass('slide-in fade-background exit-to-desktop opening-from-desktop');
            console.log('Removed all transition classes');

            // Clear any inline styles that might interfere with reopening
            $startScreen.find('.tiles__tile').each(function () {
                this.style.transform = '';
                this.style.opacity = '';
            });
            $startScreen.find('.start-header, .start-footer, .all-apps-view').each(function () {
                this.style.opacity = '';
            });
            console.log('Cleared inline styles');
            console.log('Start screen classes after cleanup:', $startScreen.attr('class'));

            // Remove the fade-in animation class from desktop after completion
            $desktop.removeClass('fade-in-from-start');

            // Re-apply taskbar visibility to ensure it's properly shown after animation completes
            console.log('Final view confirmation:', currentView);
            updateTaskbarVisibility('desktop');
            $('body').addClass('charms-allowed');
        } else {
            console.log('transitionToDesktop animation cancelled - view changed to:', currentView);
        }
    }, 450);
}

function updateTaskbarClock() {
    const $clockEl = $('.clock');
    if ($clockEl.length && currentView === 'desktop') {
        const now = new Date();
        const time = now.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
        const date = now.toLocaleDateString('en-US', {
            month: 'numeric',
            day: 'numeric',
            year: 'numeric'
        });

        // When taskbar is taller than default (40px), show day of week like Windows 8
        // This matches real Windows behavior for multi-row taskbars
        if (taskbarHeight > 40) {
            const dayOfWeek = now.toLocaleDateString('en-US', {
                weekday: 'long'
            });

            $clockEl.html(`
                <span>${time}</span>
                <span>${dayOfWeek}</span>
                <span>${date}</span>
            `);
        } else {
            $clockEl.html(`
                <span>${time}</span>
                <span>${date}</span>
            `);
        }
    }
}

// Keyboard shortcuts
// Track if Meta key was pressed alone (for Start screen toggle on keyup)
let metaKeyPressedAlone = false;

// Helper function to check if an input/text field is focused
function isInputFocused() {
    const activeElement = document.activeElement;
    return activeElement && (
        activeElement.tagName === 'INPUT' ||
        activeElement.tagName === 'TEXTAREA' ||
        activeElement.isContentEditable
    );
}

$(document).on('keydown', function (e) {
    // Check if we should gate shortcuts (but not the Meta key alone)
    const shouldGateShortcuts = isInputFocused() && e.key !== 'Meta';

    // Disable shortcuts when system is locked or logged out
    const isSystemLocked = currentView === 'lock' || currentView === 'login' || currentView === 'boot';

    // Win+C - Show Charms bar
    if (e.metaKey && e.key === 'c' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
        if (!shouldGateShortcuts && !isSystemLocked) {
            e.preventDefault();
            metaKeyPressedAlone = false; // Prevent Start screen toggle

            const $charmsBar = $('.charms-bar');
            const $charmsDateTimePanel = $('.charms-datetime-panel');

            // Close all other popups and menus before showing charms bar
            // Close classic flyouts
            if (window.ClassicFlyoutManager && typeof window.ClassicFlyoutManager.hideAll === 'function') {
                window.ClassicFlyoutManager.hideAll();
            }
            // Close context menus
            if (typeof hideContextMenu === 'function') hideContextMenu();
            if (typeof hideTaskbarContextMenu === 'function') hideTaskbarContextMenu();
            if (typeof hideDesktopContextMenu === 'function') hideDesktopContextMenu();
            if (typeof hideQuickLinksMenu === 'function') hideQuickLinksMenu();
            // Close taskbar item context menu
            if (window.TaskbarItemContextMenu && typeof window.TaskbarItemContextMenu.hideContextMenu === 'function') {
                window.TaskbarItemContextMenu.hideContextMenu();
            }
            // Close modern flyouts
            if (typeof closeModernFlyout === 'function') closeModernFlyout();

            // Show charms bar with full background and date/time panel
            // Add keyboard-triggered class for slide-in animation
            $charmsBar.removeClass('hiding').addClass('visible show-background keyboard-triggered');
            $charmsDateTimePanel.addClass('visible');
            console.log('Win+C: showing charms bar');

            // Remove keyboard-triggered class after animation completes
            setTimeout(function () {
                $charmsBar.removeClass('keyboard-triggered');
            }, 250);
        }
        return;
    }

    // Win+I - Open Settings modern flyout
    if (e.metaKey && e.key === 'i' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
        if (!shouldGateShortcuts && !isSystemLocked) {
            e.preventDefault();
            metaKeyPressedAlone = false; // Prevent Start screen toggle
            openModernFlyout('settings');
        }
        return;
    }

    // Win+R - Open Run dialog
    if (e.metaKey && (e.key === 'r' || e.key === 'R') && !e.shiftKey && !e.ctrlKey && !e.altKey) {
        if (!isSystemLocked) {
            e.preventDefault();
            metaKeyPressedAlone = false; // Prevent Start screen toggle
            launchApp('run');
        }
        return;
    }

    // Win+E - Open File Explorer
    if (e.metaKey && (e.key === 'e' || e.key === 'E') && !e.shiftKey && !e.ctrlKey && !e.altKey) {
        if (!isSystemLocked) {
            e.preventDefault();
            metaKeyPressedAlone = false; // Prevent Start screen toggle

            // Switch to desktop first if on Start screen
            if (isStartSurfaceVisible()) {
                closeStartSurface({ forceDesktop: true, suppressRestore: true });
                // Launch File Explorer after transition
                setTimeout(() => {
                    launchApp('explorer');
                }, 500);
            } else {
                launchApp('explorer');
            }
        }
        return;
    }

    // Win+L - Lock the system
    if (e.metaKey && e.key === 'l' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
        if (!shouldGateShortcuts && !isSystemLocked) {
            e.preventDefault();
            metaKeyPressedAlone = false; // Prevent Start screen toggle
            lockSystem();
            console.log('Win+L: locking system');
        }
        return;
    }

    // Win+X - Show Quick Links menu
    if (e.metaKey && e.key === 'x' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
        if (!shouldGateShortcuts && !isSystemLocked) {
            e.preventDefault();
            metaKeyPressedAlone = false; // Prevent Start screen toggle
            showQuickLinksMenu();
            console.log('Win+X: showing Quick Links menu');
        }
        return;
    }

    // Track if Meta key is pressed alone (no other keys)
    if (e.key === 'Meta' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
        metaKeyPressedAlone = true;
    } else if (e.metaKey) {
        // If any other key is pressed with Meta, it's not alone
        metaKeyPressedAlone = false;
    }
});

$(document).on('keyup', function (e) {
    // Windows key (Meta/Command) - toggle Start screen on release
    // This one always works, even with input focused (matching Windows behavior)
    if (e.key === 'Meta' && metaKeyPressedAlone) {
        // Only allow on desktop or start screen, not when locked/logged out
        const isSystemLocked = currentView === 'lock' || currentView === 'login' || currentView === 'boot';

        if (!isSystemLocked) {
            e.preventDefault();
            toggleStartSurface();
        }
        metaKeyPressedAlone = false;
    }
});

// ===== CONTEXT MENU =====
function initContextMenu() {
    // Right-click on tiles
    $(document).on('contextmenu', '.tiles__tile', function (e) {
        e.preventDefault();
        e.stopPropagation();
        const appId = $(this).attr('data-app');
        showContextMenu(e.pageX, e.pageY, appId, this);
    });

    // Right-click on app list items
    $(document).on('contextmenu', '.app-list-item', function (e) {
        e.preventDefault();
        e.stopPropagation();
        const appId = $(this).attr('data-app');
        showContextMenu(e.pageX, e.pageY, appId, this);
    });

    // Context menu item clicks
    $(document).on('click', '.context-menu-item', function (e) {
        e.preventDefault();
        e.stopPropagation();

        const $item = $(this);
        const action = $item.attr('data-action');

        console.log('Context menu item clicked:', action);

        // Don't close menu if clicking the submenu parent (only opens submenu)
        if ($item.hasClass('context-menu-item-submenu') && !action.startsWith('resize-')) {
            return;
        }

        if (action === 'pin') {
            console.log('Toggling pin for:', contextMenuAppId);
            const app = AppsManager.getAppById(contextMenuAppId);
            const wasUnpinned = app && !app.pinned;
            const isInAllAppsView = $('#start-screen').hasClass('all-apps-open');

            AppsManager.togglePin(contextMenuAppId);
            renderPinnedTiles();
            renderAllAppsList();
            renderStartMenuTiles();
            hideContextMenu();

            // If we just pinned an app (not unpinned) and we're in the all apps view,
            // navigate back to the pinned view
            if (wasUnpinned && isInAllAppsView && contextMenuSource !== 'start-menu-app-list') {
                setStartScreenAllAppsOpen(false);
            }
        } else if (action === 'pin-taskbar') {
            console.log('Toggling taskbar pin for:', contextMenuAppId);
            AppsManager.toggleTaskbarPin(contextMenuAppId);
            hideContextMenu();
        } else if (action.startsWith('resize-')) {
            const size = $item.attr('data-size');
            console.log('Setting size to:', size, 'for app:', contextMenuAppId);
            AppsManager.setTileSize(contextMenuAppId, size);
            renderPinnedTiles();
            renderStartMenuTiles();
            hideContextMenu();
        }
    });

    // Hide context menu on click outside
    $(document).on('click', function (e) {
        // Don't hide if clicking inside the context menu
        if (!$(e.target).closest('.context-menu').length) {
            hideContextMenu();
            hideStartMenuItemContextMenu();
        }
    });
}

let contextMenuSource = 'start-screen';

function showContextMenu(x, y, appId, sourceElement = null) {
    const $contextMenu = $('#app-context-menu');
    const app = AppsManager.getAppById(appId);
    const $source = sourceElement ? $(sourceElement) : $();

    if (!app) return;

    contextMenuAppId = appId;
    hideStartMenuItemContextMenu();
    contextMenuSource = $source.closest('#start-menu').length
        ? ($source.closest('#start-menu-tiles').length ? 'start-menu-tile' : 'start-menu-app-list')
        : 'start-screen';

    // Update pin/unpin text
    const $pinItem = $contextMenu.find('[data-action="pin"] .context-menu-item-text');
    $pinItem.text(contextMenuSource === 'start-screen'
        ? (app.pinned ? 'Unpin from Start' : 'Pin to Start')
        : (app.pinned ? 'Unpin from Start' : 'Pin to Start'));

    const shouldShowTaskbarPin =
        app.type !== 'meta' && app.type !== 'meta-classic';
    const $taskbarPinItem = $contextMenu.find('[data-action="pin-taskbar"]');
    $taskbarPinItem.toggle(shouldShowTaskbarPin);
    $taskbarPinItem.find('.context-menu-item-text')
        .text(app.pinnedToTaskbar ? 'Unpin from Taskbar' : 'Pin to Taskbar');

    // Update resize checkmarks
    $contextMenu.find('.context-submenu .context-menu-item').removeClass('checked');
    $contextMenu.find(`.context-submenu [data-size="${app.size || 'normal'}"]`).addClass('checked');

    const shouldShowResize = contextMenuSource !== 'start-menu-app-list';
    $contextMenu.find('[data-action="resize"]').toggle(shouldShowResize);

    // Show/hide resize options based on tileOptions
    const tileOptions = app.tileOptions || {};
    const allowWide = tileOptions.allowWide || false;
    const allowLarge = tileOptions.allowLarge || false;

    // Show or hide wide option
    const $wideOption = $contextMenu.find('[data-size="wide"]');
    if (allowWide) {
        $wideOption.show();
    } else {
        $wideOption.hide();
    }

    // Show or hide large option
    const $largeOption = $contextMenu.find('[data-size="large"]');
    if (allowLarge) {
        $largeOption.show();
    } else {
        $largeOption.hide();
    }

    // Position context menu
    $contextMenu.css({
        left: x + 'px',
        top: y + 'px'
    });

    // Check if menu goes off screen and adjust
    const menuWidth = $contextMenu.outerWidth();
    const menuHeight = $contextMenu.outerHeight();
    const windowWidth = $(window).width();
    const windowHeight = $(window).height();

    if (x + menuWidth > windowWidth) {
        $contextMenu.css('left', (windowWidth - menuWidth - 10) + 'px');
    }
    if (y + menuHeight > windowHeight) {
        $contextMenu.css('top', (windowHeight - menuHeight - 10) + 'px');
    }

    $contextMenu.addClass('active');
}

function hideContextMenu() {
    $('#app-context-menu').removeClass('active');
    contextMenuAppId = null;
    contextMenuSource = 'start-screen';
}

// Helper function to close all UI popups and menus
function closeAllPopupsAndMenus() {
    // Close tile context menu
    hideContextMenu();
    hideStartMenuItemContextMenu();

    // Close taskbar context menu
    hideTaskbarContextMenu();

    // Close desktop context menu
    hideDesktopContextMenu();

    // Close quick links menu (Win+X)
    hideQuickLinksMenu();

    // Close taskbar item context menu
    if (window.TaskbarItemContextMenu && typeof window.TaskbarItemContextMenu.hideContextMenu === 'function') {
        window.TaskbarItemContextMenu.hideContextMenu();
    } else {
        // Fallback manual close
        const $taskbarItemMenu = $('#taskbar-item-context-menu');
        $taskbarItemMenu.removeClass('visible').addClass('exiting');
        setTimeout(() => {
            $taskbarItemMenu.css('display', 'none');
            $taskbarItemMenu.removeClass('exiting');
        }, 150);
    }

    // Close all classic flyouts using ClassicFlyoutManager
    if (window.ClassicFlyoutManager && typeof window.ClassicFlyoutManager.hideAll === 'function') {
        window.ClassicFlyoutManager.hideAll();
    } else {
        // Fallback: manually close all classic flyouts
        $('.classic-flyout').removeClass('visible');
        $('.system-icon, .clock').removeClass('active');
    }

    // Close user tile dropdown
    $('.user-tile-dropdown').removeClass('active');

    // Close power menus
    $('.start-power-menu').removeClass('active');
    $('.settings-power-menu').removeClass('active');
    $('.settings-control-item[data-control="power"]').removeClass('active');
    $('.login-power-menu').removeClass('active');
    $('.login-power-button').removeClass('active');

    // Close all modern flyouts
    closeModernFlyout();

    // Hide charms bar
    hideCharmsBar();

    // Close all apps view on start screen
    setStartScreenAllAppsOpen(false);
}

// ===== CHARMS BAR =====
$(document).ready(function () {
    const $charmsBar = $('.charms-bar');
    const $charmsTriggers = $('.charms-trigger');
    const $charmsDateTimePanel = $('.charms-datetime-panel');
    const CHARMS_TOUCH_EDGE_ZONE = 32;
    const CHARMS_TOUCH_OPEN_THRESHOLD = 56;
    const CHARMS_TOUCH_VERTICAL_CANCEL_THRESHOLD = 72;
    let charmsTimeout = null;
    let charmsInactivityTimeout = null;
    let suppressNextCharmsDocumentClick = false;
    const charmsTouchDrag = {
        active: false,
        startX: 0,
        startY: 0,
        currentX: 0,
        revealWidth: 0
    };

    // Function to check if charms bar should be accessible
    function isCharmsBarAllowed() {
        return currentView === 'desktop' || currentView === 'start';
    }

    function clearCharmsTimers() {
        clearTimeout(charmsTimeout);
        clearTimeout(charmsInactivityTimeout);
    }

    function getCharmsBarWidth() {
        return $charmsBar.outerWidth() || parseFloat($charmsBar.css('width')) || 86;
    }

    function clearCharmsTouchDragStyles() {
        $charmsBar.removeClass('touch-dragging').css('--charms-touch-offset', '');
    }

    function resetCharmsTouchDragState() {
        charmsTouchDrag.active = false;
        charmsTouchDrag.startX = 0;
        charmsTouchDrag.startY = 0;
        charmsTouchDrag.currentX = 0;
        charmsTouchDrag.revealWidth = 0;
        clearCharmsTouchDragStyles();
    }

    function closeTransientUiForCharms() {
        // Close classic flyouts
        if (window.ClassicFlyoutManager && typeof window.ClassicFlyoutManager.hideAll === 'function') {
            window.ClassicFlyoutManager.hideAll();
        }
        // Close context menus
        if (typeof hideContextMenu === 'function') hideContextMenu();
        if (typeof hideTaskbarContextMenu === 'function') hideTaskbarContextMenu();
        if (typeof hideDesktopContextMenu === 'function') hideDesktopContextMenu();
        if (typeof hideQuickLinksMenu === 'function') hideQuickLinksMenu();
        // Close taskbar item context menu
        if (window.TaskbarItemContextMenu && typeof window.TaskbarItemContextMenu.hideContextMenu === 'function') {
            window.TaskbarItemContextMenu.hideContextMenu();
        }
        // Close modern flyouts
        if (typeof closeModernFlyout === 'function') closeModernFlyout();
    }

    function showCharmsBarFully(options = {}) {
        const keyboardTriggered = Boolean(options.keyboardTriggered);

        if (!isCharmsBarAllowed()) return;

        clearCharmsTimers();
        clearCharmsTouchDragStyles();
        closeTransientUiForCharms();

        $charmsBar.removeClass('hiding').addClass('visible show-background');
        if (keyboardTriggered) {
            $charmsBar.addClass('keyboard-triggered');
            setTimeout(function () {
                $charmsBar.removeClass('keyboard-triggered');
            }, 250);
        } else {
            $charmsBar.removeClass('keyboard-triggered');
        }

        $charmsDateTimePanel.addClass('visible');
    }

    function setTouchDragReveal(revealWidth) {
        const barWidth = getCharmsBarWidth();
        const clampedRevealWidth = Math.max(0, Math.min(revealWidth, barWidth));
        const touchOffset = Math.max(0, barWidth - clampedRevealWidth);

        $charmsBar
            .removeClass('hiding show-background keyboard-triggered')
            .addClass('visible touch-dragging')
            .css('--charms-touch-offset', `${touchOffset}px`);
        $charmsDateTimePanel.removeClass('visible');
        charmsTouchDrag.revealWidth = clampedRevealWidth;
    }

    // Function to update charms date/time panel
    function updateCharmsDateTime() {
        const now = new Date();

        // Update time (without AM/PM)
        let timeString = now.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
        timeString = timeString.replace(/\s?(AM|PM)/i, '');
        $('.charms-time').text(timeString);

        // Update weekday
        const weekday = now.toLocaleDateString('en-US', {
            weekday: 'long'
        });
        $('.charms-date-weekday').text(weekday);

        // Update month and day
        const monthDay = now.toLocaleDateString('en-US', {
            month: 'long',
            day: 'numeric'
        });
        $('.charms-date-monthday').text(monthDay);
    }

    // Update date/time immediately and then every second
    updateCharmsDateTime();
    setInterval(updateCharmsDateTime, 1000);

    // Show charms bar without background when hovering over trigger areas
    $charmsTriggers.on('mouseenter', function () {
        if (!isCharmsBarAllowed() || !navigationSettings.charmsHotCornersEnabled) return;

        clearCharmsTimers();
        $charmsBar.removeClass('hiding').addClass('visible');
        console.log('Trigger hover: showing charms bar');

        // Set inactivity timeout to hide ghost view after 4 seconds
        charmsInactivityTimeout = setTimeout(function () {
            if (!$charmsBar.hasClass('show-background')) {
                $charmsBar.addClass('hiding');
                setTimeout(function () {
                    $charmsBar.removeClass('visible hiding');
                }, 250);
                console.log('Inactivity timeout: hiding ghost view');
            }
        }, 4000);
    });

    // Reset inactivity timer on mouse movement over trigger
    $charmsTriggers.on('mousemove', function () {
        if (!isCharmsBarAllowed() || !navigationSettings.charmsHotCornersEnabled) return;

        clearTimeout(charmsInactivityTimeout);

        // Only restart the timer if the ghost is showing (not the full bar)
        if ($charmsBar.hasClass('visible') && !$charmsBar.hasClass('show-background')) {
            charmsInactivityTimeout = setTimeout(function () {
                if (!$charmsBar.hasClass('show-background')) {
                    $charmsBar.addClass('hiding');
                    setTimeout(function () {
                        $charmsBar.removeClass('visible hiding');
                    }, 250);
                    console.log('Inactivity timeout: hiding ghost view');
                }
            }, 4000);
        }
    });

    // Hide charms bar when leaving trigger (unless moving to charms bar)
    $charmsTriggers.on('mouseleave', function () {
        if (!navigationSettings.charmsHotCornersEnabled) return;

        clearTimeout(charmsInactivityTimeout);
        charmsTimeout = setTimeout(function () {
            if (!$charmsBar.is(':hover')) {
                $charmsBar.addClass('hiding');
                setTimeout(function () {
                    $charmsBar.removeClass('visible show-background hiding');
                }, 250);
                console.log('Trigger leave: hiding charms bar');
            }
        }, 500); // 500ms grace period for ghost view
    });

    // When mouse enters the charms bar itself, show the background and date/time panel
    $charmsBar.on('mouseenter', function () {
        if (!isCharmsBarAllowed() || $charmsBar.hasClass('touch-dragging')) return;

        showCharmsBarFully();
        console.log('Charms bar hover: showing background and date/time panel');
    });

    // When mouse leaves the charms bar, hide everything with extra grace period
    $charmsBar.on('mouseleave', function () {
        charmsTimeout = setTimeout(function () {
            hideCharmsBar();
            console.log('Charms bar leave: hiding everything');
        }, 150);
    });

    $(document).on('touchstart.charmsedge', function (e) {
        if (!isCharmsBarAllowed() || !navigationSettings.charmsHotCornersEnabled) return;

        const originalEvent = e.originalEvent;
        if (!originalEvent.touches || originalEvent.touches.length !== 1) return;

        const touch = originalEvent.touches[0];
        if (touch.clientX < window.innerWidth - CHARMS_TOUCH_EDGE_ZONE) return;

        clearCharmsTimers();
        charmsTouchDrag.active = true;
        charmsTouchDrag.startX = touch.clientX;
        charmsTouchDrag.startY = touch.clientY;
        charmsTouchDrag.currentX = touch.clientX;
        charmsTouchDrag.revealWidth = 0;

        setTouchDragReveal(0);
    });

    $(document).on('touchmove.charmsedge', function (e) {
        if (!charmsTouchDrag.active) return;

        const originalEvent = e.originalEvent;
        if (!originalEvent.touches || originalEvent.touches.length !== 1) {
            resetCharmsTouchDragState();
            hideCharmsBar();
            return;
        }

        const touch = originalEvent.touches[0];
        const dragDistance = Math.max(0, window.innerWidth - touch.clientX);
        const verticalDistance = Math.abs(touch.clientY - charmsTouchDrag.startY);

        charmsTouchDrag.currentX = touch.clientX;

        if (verticalDistance > CHARMS_TOUCH_VERTICAL_CANCEL_THRESHOLD && dragDistance < CHARMS_TOUCH_OPEN_THRESHOLD) {
            resetCharmsTouchDragState();
            hideCharmsBar();
            return;
        }

        setTouchDragReveal(dragDistance);
        e.preventDefault();
    });

    $(document).on('touchend.charmsedge touchcancel.charmsedge', function () {
        if (!charmsTouchDrag.active) return;

        const shouldOpenFully = charmsTouchDrag.revealWidth >= CHARMS_TOUCH_OPEN_THRESHOLD;
        resetCharmsTouchDragState();

        suppressNextCharmsDocumentClick = true;
        setTimeout(function () {
            suppressNextCharmsDocumentClick = false;
        }, 400);

        if (shouldOpenFully) {
            showCharmsBarFully();
            console.log('Touch edge drag: showing charms bar');
            return;
        }

        hideCharmsBar();
        console.log('Touch edge drag: hiding charms bar');
    });

    // Click outside charms bar to close immediately (no delay)
    $(document).on('click', function (e) {
        if (suppressNextCharmsDocumentClick) {
            return;
        }

        if (isCharmsBarAllowed() && $charmsBar.hasClass('visible')) {
            // Check if click is outside charms bar, triggers, datetime panel, and modern flyouts
            if (!$(e.target).closest('.charms-bar, .charms-trigger, .charms-datetime-panel, .modern-flyout').length) {
                clearCharmsTimers();
                hideCharmsBar();
                console.log('Click outside: hiding charms bar immediately');
            }
        }
    });

    // Charms icon click handlers
    $('.charms-icon[data-charm="search"]').on('click', function () {
        console.log('Search charm clicked');
        openModernFlyout('search');
    });

    $('.charms-icon[data-charm="share"]').on('click', function () {
        console.log('Share charm clicked');
        openModernFlyout('share');
    });

    $('.charms-icon[data-charm="start"]').on('click', function () {
        console.log('Start charm clicked');
        toggleStartSurface();
        hideCharmsBar();
    });

    $('.charms-icon[data-charm="devices"]').on('click', function () {
        console.log('Devices charm clicked');
        openModernFlyout('devices');
    });

    $('.charms-icon[data-charm="settings"]').on('click', function () {
        console.log('Settings charm clicked');
        openModernFlyout('settings');
    });

    // "Change PC settings" link click handler
    $(document).on('click', '.pc-settings-link', function (e) {
        e.preventDefault();
        console.log('Change PC settings clicked');

        // Close modern flyout
        closeModernFlyout();

        // Launch PC Settings app
        const settingsApp = AppsManager.getAppById('settings');
        if (settingsApp) {
            launchApp('settings');
        } else {
            console.error('PC Settings app not found');
        }
    });
});

// ===== FLOATING START BUTTON =====
$(document).ready(function () {
    const $floatingStartButton = $('.floating-start-button');
    const $floatingStartButtonContainer = $('.floating-start-button-container');
    const $startButtonTrigger = $('.start-button-trigger.bottom-left');
    let startButtonTimeout = null;

    // Function to check if floating start button should be accessible
    const FLOATING_START_ALLOWED_VIEWS = new Set(['desktop', 'start', 'modern']);

    function isFloatingStartButtonAllowed() {
        if (!FLOATING_START_ALLOWED_VIEWS.has(currentView)) {
            return false;
        }

        // On desktop, hide floating button if taskbar is visible (not autohidden)
        // This prevents interference with the taskbar's own start button
        if (currentView === 'desktop') {
            // Check if taskbar is visible and NOT autohidden
            const isTaskbarPermanentlyVisible = !taskbarAutoHideEnabled;
            if (isTaskbarPermanentlyVisible) {
                return false;
            }
        }

        return true;
    }

    function updateFloatingStartButtonAvailability() {
        const hotCornersEnabled = navigationSettings.charmsHotCornersEnabled;
        const allowed = isFloatingStartButtonAllowed() && hotCornersEnabled;

        if (!allowed) {
            clearTimeout(startButtonTimeout);
            $floatingStartButtonContainer.removeClass('visible');
        }

        $startButtonTrigger.toggleClass('floating-start-button-trigger-disabled', !allowed);

        return allowed;
    }

    // Show floating start button when hovering over bottom-left trigger
    $startButtonTrigger.on('mouseenter', function () {
        if (!isFloatingStartButtonAllowed() || !navigationSettings.charmsHotCornersEnabled) return;

        clearTimeout(startButtonTimeout);
        $floatingStartButtonContainer.addClass('visible');
        console.log('Start button trigger hover: showing floating start button');
    });

    // Hide floating start button when leaving trigger (unless moving to button)
    $startButtonTrigger.on('mouseleave', function () {
        if (!navigationSettings.charmsHotCornersEnabled) return;

        startButtonTimeout = setTimeout(function () {
            if (!$floatingStartButton.is(':hover')) {
                $floatingStartButtonContainer.removeClass('visible');
                console.log('Start button trigger leave: hiding floating start button');
            }
        }, 150); // Short grace period to move to button
    });

    // Keep button visible when hovering over it
    $floatingStartButton.on('mouseenter', function () {
        if (!isFloatingStartButtonAllowed()) return;
        clearTimeout(startButtonTimeout);
    });

    // Hide button when leaving it
    $floatingStartButton.on('mouseleave', function () {
        startButtonTimeout = setTimeout(function () {
            $floatingStartButtonContainer.removeClass('visible');
            console.log('Floating start button leave: hiding');
        }, 150);
    });

    // Click handler - same as taskbar start button
    $floatingStartButton.on('click', function () {
        console.log('Floating start button clicked');
        toggleStartSurface();
        // Hide the floating button after click
        $floatingStartButtonContainer.removeClass('visible');
    });

    // Right-click handler - show Quick Links menu (Win+X)
    $floatingStartButton.on('contextmenu', function (e) {
        e.preventDefault();
        console.log('Floating start button right-clicked');
        showQuickLinksMenu();
        // Keep the button visible while the menu is open
        clearTimeout(startButtonTimeout);
    });

    // Hide floating start button when Quick Links menu is shown
    $(document).on('quickLinksMenuShown', function () {
        clearTimeout(startButtonTimeout);
    });

    // Hide floating start button when clicking outside
    $(document).on('click', function (e) {
        if (isFloatingStartButtonAllowed() && $floatingStartButtonContainer.hasClass('visible')) {
            // Check if click is outside floating start button and trigger
            if (!$(e.target).closest('.floating-start-button-container, .start-button-trigger.bottom-left').length) {
                clearTimeout(startButtonTimeout);
                $floatingStartButtonContainer.removeClass('visible');
                console.log('Click outside: hiding floating start button');
            }
        }
    });

    // Expose updater for other modules and run once
    window.updateFloatingStartButtonAvailability = updateFloatingStartButtonAvailability;
    updateFloatingStartButtonAvailability();
});

// ===== MODERN FLYOUTS =====
function openModernFlyout(flyoutName) {
    const $flyout = $(`.modern-flyout[data-flyout="${flyoutName}"]`);
    const $charmsBar = $('.charms-bar');
    const $charmsDateTimePanel = $('.charms-datetime-panel');

    if ($flyout.length === 0) {
        console.error('Flyout not found:', flyoutName);
        return;
    }

    console.log('Opening flyout:', flyoutName);
    closeStartMenu({ forceDesktop: true, suppressRestore: true });

    // Close all popups and menus (except charms bar which we handle separately below)
    // Close classic flyouts
    if (window.ClassicFlyoutManager && typeof window.ClassicFlyoutManager.hideAll === 'function') {
        window.ClassicFlyoutManager.hideAll();
    }
    // Close context menus
    if (typeof hideContextMenu === 'function') hideContextMenu();
    if (typeof hideTaskbarContextMenu === 'function') hideTaskbarContextMenu();
    if (typeof hideDesktopContextMenu === 'function') hideDesktopContextMenu();
    if (typeof hideQuickLinksMenu === 'function') hideQuickLinksMenu();
    // Close taskbar item context menu
    if (window.TaskbarItemContextMenu && typeof window.TaskbarItemContextMenu.hideContextMenu === 'function') {
        window.TaskbarItemContextMenu.hideContextMenu();
    }

    // Update Settings flyout with current app context
    if (flyoutName === 'settings') {
        updateSettingsFlyout();
        // Reset panels to initial state
        resetSettingsPanels();
    }

    // Close the charms bar
    $charmsBar.removeClass('visible show-background');
    $charmsDateTimePanel.removeClass('visible');

    // Close any other open modern flyouts with animation
    const $otherFlyouts = $('.modern-flyout.visible').not($flyout);
    if ($otherFlyouts.length > 0) {
        $otherFlyouts.addClass('closing');
        setTimeout(function () {
            $otherFlyouts.removeClass('visible closing');
        }, 300);
    }

    // Open the selected flyout after a brief delay
    setTimeout(function () {
        $flyout.removeClass('closing').addClass('visible');
    }, 200);
}

function updateSettingsFlyout() {
    const $appNameElement = $('#settings-app-name');
    const $menuItems = $('#settings-menu-items');

    // Get the current app name based on the current view
    let appName = 'Desktop';
    if (currentView === 'start' || isStartMenuOpen()) {
        appName = 'Start';
    } else if (currentView === 'desktop') {
        appName = 'Desktop';
    }

    // Update the app name in the Settings flyout
    $appNameElement.text(appName);

    // Clear existing menu items
    $menuItems.empty();

    // Add Start Screen specific menu items
    if (currentView === 'start' || isStartMenuOpen()) {
        const $personalizeItem = $(`
            <div class="settings-menu-item" data-action="personalize">
                <span class="settings-menu-item-text">Personalize</span>
            </div>
        `);
        $menuItems.append($personalizeItem);

        const $tilesItem = $(`
            <div class="settings-menu-item" data-action="tiles">
                <span class="settings-menu-item-text">Tiles</span>
            </div>
        `);
        $menuItems.append($tilesItem);
    }

    console.log('Updated Settings flyout for:', appName);
}

function closeModernFlyout() {
    hideAllSettingsSliderPopups();

    const $openFlyouts = $('.modern-flyout.visible');

    // Add closing animation
    $openFlyouts.addClass('closing');

    // Wait for animation to complete before removing visible class
    setTimeout(function () {
        $openFlyouts.removeClass('visible closing');
        // Reset settings panels when closing
        resetSettingsPanels();
    }, 300);

    console.log('Closed all flyouts');
}

// Reset settings panels to their initial state
function resetSettingsPanels() {
    const $mainSettings = $('.settings-panel.main-settings');
    const $personalizePanel = $('.settings-panel.personalize-panel');
    const $tilesPanel = $('.settings-panel.tiles-panel');

    hideAllSettingsSliderPopups();

    // Clear all animation classes
    $mainSettings.removeClass('fade-out hidden');
    $personalizePanel.removeClass('slide-in fade-out');
    $tilesPanel.removeClass('slide-in fade-out');

    // Clear any inline styles
    $mainSettings.css('transition', '').css('transform', '').css('opacity', '');
}

// Close modern flyout when clicking outside
$(document).on('click', function (e) {
    if (!$(e.target).closest('.modern-flyout, .charms-bar, .charms-trigger').length) {
        closeModernFlyout();
    }
});

// Close modern flyout on escape key
$(document).on('keydown', function (e) {
    if (e.key === 'Escape') {
        closeModernFlyout();
    }
});

// ===== SETTINGS SLIDER POPUPS =====
const DEFAULT_BRIGHTNESS_LEVEL = 100;
let currentBrightnessLevel = DEFAULT_BRIGHTNESS_LEVEL;
const SETTINGS_SLIDER_FADE_DURATION = 200; // ms

function clampNumber(value, min, max) {
    const number = Number(value);
    if (Number.isNaN(number)) {
        return min;
    }
    return Math.min(max, Math.max(min, Math.round(number)));
}

function hideAllSettingsSliderPopups({ except = null } = {}) {
    $('.settings-slider-popup').each(function () {
        const $popup = $(this);
        const popupType = ($popup.data('popup') || '').toString();

        if (popupType === except) {
            return;
        }

        scheduleHideSettingsSliderPopup($popup);
    });

    if (!except) {
        $('.settings-control-item[data-control="volume"], .settings-control-item[data-control="brightness"]').removeClass('active-slider');
    }
}

function applyBrightnessLevel(level, { persist = false, syncSlider = true } = {}) {
    const clamped = clampNumber(level, 0, 100);
    currentBrightnessLevel = clamped;

    const normalized = Math.min(1, Math.max(0, clamped / 100));
    document.documentElement.style.setProperty('--system-brightness-factor', normalized.toFixed(2));

    if (syncSlider) {
        const brightnessSlider = document.getElementById('settings-brightness-slider');
        if (brightnessSlider && Number(brightnessSlider.value) !== clamped) {
            brightnessSlider.value = clamped;
        }
    }

    if (persist) {
        try {
            SettingsRegistry.saveBrightnessLevel(clamped);
        } catch (error) {
            console.error('Failed to persist brightness level to registry:', error);
        }
    }
}

function loadStoredBrightnessLevel() {
    try {
        const stored = SettingsRegistry.loadBrightnessLevel(DEFAULT_BRIGHTNESS_LEVEL);
        applyBrightnessLevel(stored);
    } catch (error) {
        console.error('Failed to load brightness level from registry:', error);
        applyBrightnessLevel(DEFAULT_BRIGHTNESS_LEVEL);
    }
}

async function syncSettingsVolumeSlider() {
    const slider = document.getElementById('settings-volume-slider');

    if (!slider) {
        return;
    }

    let volumeValue = clampNumber(slider.value, 0, 100);

    if (window.VolumeUI && typeof window.VolumeUI.getVolumeState === 'function') {
        try {
            const state = await window.VolumeUI.getVolumeState();
            if (state && typeof state.volume === 'number') {
                volumeValue = clampNumber(state.volume, 0, 100);
            }
        } catch (error) {
            console.error('Failed to read system volume state for settings slider:', error);
        }
    }

    if (Number(slider.value) !== volumeValue) {
        slider.value = volumeValue;
    }
}

function syncSettingsBrightnessSlider() {
    applyBrightnessLevel(currentBrightnessLevel);
}

function scheduleHideSettingsSliderPopup($popup) {
    if (!$popup || !$popup.length) {
        return;
    }

    const control = $popup.closest('.settings-control-item');
    if (control.length) {
        control.removeClass('active-slider');
    }

    const existingTimer = $popup.data('hideTimer');
    if (existingTimer) {
        clearTimeout(existingTimer);
    }

    if (!$popup.hasClass('visible')) {
        $popup.removeClass('closing').attr('aria-hidden', 'true').removeData('hideTimer');
        return;
    }

    $popup.addClass('closing').attr('aria-hidden', 'true');
    $popup.find('.settings-slider').removeClass('is-active');

    const timer = setTimeout(() => {
        $popup.removeClass('visible closing').removeData('hideTimer');
    }, SETTINGS_SLIDER_FADE_DURATION);

    $popup.data('hideTimer', timer);
}

function toggleSettingsSliderPopup(type) {
    const $popup = $(`.settings-slider-popup[data-popup="${type}"]`);
    const $control = $(`.settings-control-item[data-control="${type}"]`);

    if (!$popup.length || !$control.length) {
        return;
    }

    const isClosing = $popup.hasClass('closing');
    const isVisible = $popup.hasClass('visible') && !isClosing;

    if (isVisible) {
        scheduleHideSettingsSliderPopup($popup);
        return;
    }

    hideAllSettingsSliderPopups({ except: type });

    const existingTimer = $popup.data('hideTimer');
    if (existingTimer) {
        clearTimeout(existingTimer);
        $popup.removeData('hideTimer');
    }

    $popup.removeClass('closing').addClass('visible').attr('aria-hidden', 'false');
    $control.addClass('active-slider');

    if (type === 'volume') {
        syncSettingsVolumeSlider();
    } else if (type === 'brightness') {
        syncSettingsBrightnessSlider();
    }
}

loadStoredBrightnessLevel();

$(document).on('click', '.settings-control-item[data-control="volume"]', function (e) {
    e.preventDefault();
    e.stopPropagation();
    toggleSettingsSliderPopup('volume');
});

$(document).on('click', '.settings-control-item[data-control="brightness"]', function (e) {
    e.preventDefault();
    e.stopPropagation();
    toggleSettingsSliderPopup('brightness');
});

$(document).on('click', '.settings-control-item[data-control="fullscreen"]', async function (e) {
    e.preventDefault();
    e.stopPropagation();

    const isFullscreen = await toggleShellFullscreen();
    closeModernFlyout();
    console.log('Settings fullscreen button clicked - fullscreen:', isFullscreen);
});

$(document).on('click', '.settings-control-item', function (e) {
    const control = $(this).data('control');
    if (control !== 'volume' && control !== 'brightness') {
        hideAllSettingsSliderPopups();
    }
});

$(document).on('input', '#settings-volume-slider', function (e) {
    e.stopPropagation();
    const value = clampNumber(this.value, 0, 100);

    if (window.VolumeUI && typeof window.VolumeUI.previewVolume === 'function') {
        window.VolumeUI.previewVolume(value);
    }
});

$(document).on('change', '#settings-volume-slider', function () {
    const value = clampNumber(this.value, 0, 100);

    if (window.VolumeUI && typeof window.VolumeUI.setVolume === 'function') {
        window.VolumeUI.setVolume(value);
    }

    if (window.systemSounds && typeof window.systemSounds.play === 'function') {
        window.systemSounds.play('default_beep');
    }
});

$(document).on('click', '.settings-slider', function (e) {
    e.stopPropagation();
});

$(document).on('input', '#settings-brightness-slider', function (e) {
    e.stopPropagation();
    const value = clampNumber(this.value, 0, 100);
    applyBrightnessLevel(value, { persist: false, syncSlider: false });
});

$(document).on('change', '#settings-brightness-slider', function () {
    const value = clampNumber(this.value, 0, 100);
    applyBrightnessLevel(value, { persist: true, syncSlider: false });
});

$(document).on('pointerdown', '.settings-slider', function (e) {
    e.stopPropagation();
    $(this).addClass('is-active');
});

$(document).on('pointerup pointercancel', function () {
    $('.settings-slider.is-active').removeClass('is-active');
});

$(document).on('click', '.settings-slider-popup', function (e) {
    e.stopPropagation();
});

$(document).on('click', function (e) {
    if (!$(e.target).closest('.settings-slider-popup, .settings-control-item[data-control="volume"], .settings-control-item[data-control="brightness"]').length) {
        hideAllSettingsSliderPopups();
    }
});

// ===== PERSONALIZATION =====
let backgroundPatterns = null;
const DEFAULT_START_BACKGROUND = { pattern: 1, variant: 1 };
let currentBackground = { ...DEFAULT_START_BACKGROUND };
let previousStartBackground = null;

// Load background patterns metadata
async function loadBackgroundPatterns() {
    try {
        const response = await fetch('resources/data/background-patterns.json');
        backgroundPatterns = await response.json();
        currentBackground = { ...backgroundPatterns.default };
        console.log('Loaded background patterns:', backgroundPatterns);
        return backgroundPatterns;
    } catch (error) {
        console.error('Failed to load background patterns:', error);
        // Fallback to default
        backgroundPatterns = {
            patterns: [
                {
                    id: 1,
                    alignment: 'top',
                    splitY: null,
                    variants: [
                        { id: 1, backgroundColor: '#16499A' },
                        { id: 2, backgroundColor: '#180052' },
                        { id: 3, backgroundColor: '#BF5A15' }
                    ]
                }
            ],
            default: { pattern: 1, variant: 1 }
        };
        return backgroundPatterns;
    }
}

// Initialize background patterns on load
$(document).ready(async function () {
    await loadBackgroundPatterns();

    const defaultBackground = backgroundPatterns && backgroundPatterns.default
        ? { ...backgroundPatterns.default }
        : { ...DEFAULT_START_BACKGROUND };

    const { current: registryBackground, previous: registryPrevious } = loadStartScreenBackground(defaultBackground);
    currentBackground = registryBackground ? { ...registryBackground } : defaultBackground;
    previousStartBackground = registryPrevious ? { ...registryPrevious } : null;
    console.log('Loaded start background from registry:', currentBackground, 'previous:', previousStartBackground);

    // Restore saved accent color from registry (which was set by the last pattern selection)
    const savedAccentColor = loadAccentColorFromRegistry();
    setAccentColors(savedAccentColor);
    console.log('Restored accent color from registry:', savedAccentColor);

    // Apply the background
    if (currentBackground.pattern === 'desktop') {
        applyDesktopWallpaperBackground();
    } else {
        applyBackgroundPattern(currentBackground.pattern, currentBackground.variant);
    }

    const isDesktopBackground = currentBackground.pattern === 'desktop';
    if (navigationSettings.showDesktopBackgroundOnStart !== isDesktopBackground) {
        applyNavigationSettingsUpdate({ showDesktopBackgroundOnStart: isDesktopBackground });
    }
});

// Settings menu item click handler
$(document).on('click', '.settings-menu-item[data-action="personalize"]', function (e) {
    e.preventDefault();
    e.stopPropagation();
    console.log('Personalize menu item clicked');
    showPersonalizePanel();
});

// Personalize back button click handler
$(document).on('click', '.personalize-back-button', function (e) {
    e.preventDefault();
    e.stopPropagation();
    console.log('Personalize back button clicked');
    hidePersonalizePanel();
});

// Show Personalize panel (Metro-style: fade out, then slide in from right)
function showPersonalizePanel() {
    // Load pattern thumbnails
    loadPatternThumbnails();

    const $mainSettings = $('.settings-panel.main-settings');
    const $personalizePanel = $('.settings-panel.personalize-panel');

    // Step 1: Quick fade out the main settings content
    $mainSettings.addClass('fade-out');

    // Step 2: After fade completes, hide main panel and slide in personalize
    setTimeout(function () {
        $mainSettings.addClass('hidden');
        $personalizePanel.addClass('slide-in');
    }, 150); // Match the CSS fade transition duration
}

// Hide Personalize panel (Metro-style: fade out, then slide in main from right)
function hidePersonalizePanel() {
    const $mainSettings = $('.settings-panel.main-settings');
    const $personalizePanel = $('.settings-panel.personalize-panel');

    // Step 1: Quick fade out the personalize content
    $personalizePanel.addClass('fade-out');

    // Step 2: After fade completes, slide out personalize and prepare main to slide in
    setTimeout(function () {
        $personalizePanel.removeClass('slide-in fade-out');

        // Reset main settings position off-screen to the right
        $mainSettings.css('transform', 'translateX(100%)').css('opacity', '0');
        $mainSettings.removeClass('hidden fade-out');

        // Force reflow to ensure the transform is applied
        $mainSettings[0].offsetHeight;

        // Slide main settings in from the right with transition
        $mainSettings.css('transition', 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1)');
        $mainSettings.css('transform', 'translateX(0)').css('opacity', '1');

        // Clean up inline styles after animation
        setTimeout(function () {
            $mainSettings.css('transition', '').css('transform', '').css('opacity', '');
        }, 300);
    }, 150); // Match the CSS fade transition duration
}

// ===================================
// Tiles Panel Functions
// ===================================

// Settings menu item click handler for Tiles
$(document).on('click', '.settings-menu-item[data-action="tiles"]', function (e) {
    e.preventDefault();
    e.stopPropagation();
    console.log('Tiles menu item clicked');
    showTilesPanel();
});

// Tiles back button click handler
$(document).on('click', '.tiles-back-button', function (e) {
    e.preventDefault();
    e.stopPropagation();
    console.log('Tiles back button clicked');
    hideTilesPanel();
});

// Show Tiles panel (Metro-style: fade out, then slide in from right)
function showTilesPanel() {
    const $mainSettings = $('.settings-panel.main-settings');
    const $tilesPanel = $('.settings-panel.tiles-panel');

    // Load current setting
    loadTilesToggleState();

    // Step 1: Quick fade out the main settings content
    $mainSettings.addClass('fade-out');

    // Step 2: After fade completes, hide main panel and slide in tiles
    setTimeout(function () {
        $mainSettings.addClass('hidden');
        $tilesPanel.addClass('slide-in');
    }, 150); // Match the CSS fade transition duration
}

// Hide Tiles panel (Metro-style: fade out, then slide in main from right)
function hideTilesPanel() {
    const $mainSettings = $('.settings-panel.main-settings');
    const $tilesPanel = $('.settings-panel.tiles-panel');

    // Step 1: Quick fade out the tiles content
    $tilesPanel.addClass('fade-out');

    // Step 2: After fade completes, slide out tiles and prepare main to slide in
    setTimeout(function () {
        $tilesPanel.removeClass('slide-in fade-out');

        // Reset main settings position off-screen to the right
        $mainSettings.css('transform', 'translateX(100%)').css('opacity', '0');
        $mainSettings.removeClass('hidden fade-out');

        // Force reflow to ensure the transform is applied
        $mainSettings[0].offsetHeight;

        // Slide main settings in from the right with transition
        $mainSettings.css('transition', 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1)');
        $mainSettings.css('transform', 'translateX(0)').css('opacity', '1');

        // Clean up inline styles after animation
        setTimeout(function () {
            $mainSettings.css('transition', '').css('transform', '').css('opacity', '');
        }, 300);
    }, 150); // Match the CSS fade transition duration
}

// Helper functions for showMoreTiles registry setting
function loadShowMoreTilesFromRegistry() {
    try {
        const registry = getRegistry();
        const value = registry.getValue(REGISTRY_PATHS.launcher, 'Launcher_ShowMoreTiles', 0);
        return value === 1;
    } catch (error) {
        console.error('Failed to load showMoreTiles from registry:', error);
        return false;
    }
}

function saveShowMoreTilesToRegistry(showMore) {
    try {
        const registry = getRegistry();
        registry.setValue(
            REGISTRY_PATHS.launcher,
            'Launcher_ShowMoreTiles',
            showMore ? 1 : 0,
            RegistryType.REG_DWORD
        );
    } catch (error) {
        console.error('Failed to save showMoreTiles to registry:', error);
    }
}

// Helper functions for accent color registry setting
function loadAccentColorFromRegistry() {
    try {
        const colorRegistry = getColorRegistry();
        if (!colorRegistry || typeof colorRegistry.getAccentColorHex !== 'function') {
            return '#464646';
        }
        const hexColor = colorRegistry.getAccentColorHex('#464646');
        console.log('[Accent] Loaded from registry:', hexColor);
        return hexColor;
    } catch (error) {
        console.error('[Accent] Failed to load accent color from registry:', error);
        return '#464646';
    }
}

function saveAccentColorToRegistry(color) {
    try {
        const colorRegistry = getColorRegistry();
        if (!colorRegistry || typeof colorRegistry.setAccentColorHex !== 'function') {
            console.warn('[Accent] Color registry unavailable, skipping save');
            return;
        }
        const normalized = colorRegistry.setAccentColorHex(color);
        console.log('[Accent] Saving to registry:', normalized);
    } catch (error) {
        console.error('[Accent] Failed to save accent color to registry:', error);
    }
}


// Load the tiles toggle state from registry
function loadTilesToggleState() {
    const showMoreTiles = isStartMenuEnabled() ? true : loadShowMoreTilesFromRegistry();
    const $toggleInput = $('#tiles-toggle-input');
    const $toggleLabel = $('#tiles-toggle-label');

    $toggleInput.prop('checked', showMoreTiles);
    $toggleInput.prop('disabled', isStartMenuEnabled());
    $toggleLabel.text(showMoreTiles ? 'Yes' : 'No');
}

// Tiles toggle change handler
$(document).on('change', '#tiles-toggle-input', function () {
    const isChecked = $(this).is(':checked');
    const $toggleLabel = $('#tiles-toggle-label');

    if (isStartMenuEnabled() && !isChecked) {
        $(this).prop('checked', true);
        $toggleLabel.text('Yes');
        saveShowMoreTilesToRegistry(true);
        applyTileSize(true);
        return;
    }

    // Update label
    $toggleLabel.text(isChecked ? 'Yes' : 'No');

    // Save to registry
    saveShowMoreTilesToRegistry(isChecked);

    // Apply tile size changes immediately
    applyTileSize(isChecked);

    console.log('Show more tiles:', isChecked);
});

// Apply tile size changes to the Start screen
function applyTileSize(showMoreTiles) {
    const $body = $('body');

    if (showMoreTiles) {
        $body.addClass('tiles-compact');
    } else {
        $body.removeClass('tiles-compact');
    }

    // Use requestAnimationFrame to ensure CSS changes have been applied
    // Then calculate rows and render tiles in the correct order
    requestAnimationFrame(() => {
        // Calculate and apply dynamic row count BEFORE rendering tiles
        // This ensures the layout algorithm has the correct row count
        calculateTileRows();

        // Regenerate tiles to load the correct scale images (scale-80 vs scale-100)
        renderPinnedTiles();

        if (typeof renderStartMenuTiles === 'function') {
            renderStartMenuTiles();
        }
    });
}

function calculateTileRows() {
    const showMoreTiles = loadShowMoreTilesFromRegistry();

    const $pinnedView = $('.pinned-view');
    const $tiles = $('#pinned-tiles');
    const pinnedViewElement = $pinnedView.get(0);

    const windowHeight = $(window).height();

    let topInset = 190;
    let bottomInset = 100;
    let scrollPaddingTop = 0;

    if (pinnedViewElement) {
        const styles = window.getComputedStyle(pinnedViewElement);
        topInset = parseInt(styles.getPropertyValue('--start-content-top'), 10) || topInset;
        bottomInset = parseInt(styles.getPropertyValue('--start-content-bottom'), 10) || bottomInset;
    }

    const pinnedScrollRegion = document.querySelector('.start-scroll-region--pinned');
    if (pinnedScrollRegion) {
        const scrollStyles = window.getComputedStyle(pinnedScrollRegion);
        scrollPaddingTop = parseInt(scrollStyles.paddingTop, 10) || 0;
    }

    // Available space is window height minus the fixed header/footer insets.
    const availableHeight = windowHeight - topInset - bottomInset - scrollPaddingTop;

    // Tile size based on mode
    let tileSize, gap;
    if (showMoreTiles) {
        tileSize = 56;  // Compact mode tile height
        gap = 8;        // Compact mode gap
    } else {
        tileSize = 70;  // Normal mode tile height
        gap = 10;       // Normal mode gap
    }

    // Calculate how many rows fit
    // The first row doesn't need a gap before it, so we add one gap back
    const rowHeight = tileSize + gap;
    let numRows = Math.floor((availableHeight + gap) / rowHeight);

    // Ensure at least 2 rows (minimum for proper layout)
    numRows = Math.max(2, numRows);

    // Store the calculated rows for use by tile layout algorithm
    calculatedTileRows = numRows;

    // Apply the calculated rows to the CSS
    const gridValue = `repeat(${numRows}, ${tileSize}px)`;
    $tiles.css('grid-template-rows', gridValue);

    // Debug: verify the style was applied
    const appliedValue = $tiles.css('grid-template-rows');
    console.log(`Calculated tile rows: ${numRows} (window: ${windowHeight}px, available: ${availableHeight}px, row height: ${rowHeight}px, mode: ${showMoreTiles ? 'compact' : 'normal'})`);
    console.log(`Applied grid-template-rows: ${gridValue}, Actually set to: ${appliedValue}`);
}

// Get desktop wallpaper path (from saved preference or default)
function getDesktopWallpaperPath() {
    if (window.WallpaperController) {
        const currentWallpaperPath = window.WallpaperController.getCurrentFullPath();
        if (currentWallpaperPath && typeof currentWallpaperPath === 'string') {
            return currentWallpaperPath;
        }
    }

    const fullPath = getDesktopWallpaperFullPath();
    if (fullPath && typeof fullPath === 'string') {
        return fullPath;
    }
    return 'resources/images/wallpapers/Windows/img0.jpg';
}

// Unified function to apply wallpaper and update desktop tile
function applyDesktopWallpaper(wallpaperPath, options = {}) {
    if (window.WallpaperController) {
        return window.WallpaperController.previewWallpaper({
            currentWallpaper: wallpaperPath,
            currentWallpaperType: resolveWallpaperPreviewType(wallpaperPath)
        }, {
            withCrossfade: options.withCrossfade === true,
            updateTile: options.updateTile !== false,
            extractColor: typeof options.extractColor === 'boolean' ? options.extractColor : undefined,
            reason: options.withCrossfade ? 'direct-apply-crossfade' : 'direct-apply'
        });
    }

    return Promise.resolve();
}

// Apply saved wallpaper settings on app launch
function applySavedWallpaperSettings() {
    if (window.WallpaperController) {
        return window.WallpaperController.initialize();
    }

    return Promise.resolve();
}

// Start wallpaper slideshow
function startWallpaperSlideshow(settings) {
    if (window.WallpaperController) {
        return window.WallpaperController.startSlideshow(settings || window.WallpaperController.getSettings());
    }
}

// Stop wallpaper slideshow
function stopWallpaperSlideshow() {
    if (window.WallpaperController) {
        window.WallpaperController.stopSlideshow();
    }
}

// Pause wallpaper slideshow (keeps interval running but skips changes)
function pauseWallpaperSlideshow() {
    if (window.WallpaperController) {
        window.WallpaperController.pauseSlideshow();
    }
}

// Resume wallpaper slideshow
function resumeWallpaperSlideshow() {
    if (window.WallpaperController) {
        window.WallpaperController.resumeSlideshow();
    }
}

// Apply wallpaper with 1s crossfade effect
function applyWallpaperWithCrossfade(wallpaperPath) {
    return applyDesktopWallpaper(wallpaperPath, { withCrossfade: true });
}

// Utility: Shuffle array
function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

// Load pattern thumbnails into the grid
function loadPatternThumbnails() {
    const $patternsGrid = $('#personalize-patterns-grid');
    $patternsGrid.empty();

    if (!backgroundPatterns) {
        console.error('Background patterns not loaded');
        return;
    }

    // Generate thumbnails for patterns (only first variant of each pattern)
    backgroundPatterns.patterns.forEach(patternData => {
        const patternId = patternData.id;
        const thumbPath = `resources/images/modern_patterns/${patternId}/v1_thumb.png`;
        const isSelected = (currentBackground.pattern === patternId);

        const $thumbnail = $(`
            <div class="pattern-thumbnail ${isSelected ? 'selected' : ''}"
                 data-pattern="${patternId}">
                <img src="${thumbPath}" alt="Pattern ${patternId}">
            </div>
        `);

        $patternsGrid.append($thumbnail);
    });

    // Add desktop wallpaper option at the end
    // Helper to get wallpaper path with type awareness
    const getSavedWallpaperPath = () => {
        if (window.WallpaperController) {
            const controllerPath = window.WallpaperController.getCurrentFullPath();
            if (controllerPath) {
                return controllerPath;
            }
        }

        try {
            const settings = loadDesktopBackgroundSettings();
            if (settings.currentWallpaper) {
                const fullPath = toFullWallpaperPath(settings.currentWallpaper, settings.currentWallpaperType);
                if (fullPath) {
                    return fullPath;
                }
            }
        } catch (e) {
            console.error('Failed to read saved wallpaper settings:', e);
        }
        return getDesktopWallpaperPath(); // Fallback to default
    };

    const desktopWallpaperPath = toAssetUrl(getSavedWallpaperPath());
    const isDesktopSelected = (currentBackground.pattern === 'desktop');
    const $desktopThumbnail = $(`
        <div class="pattern-thumbnail desktop-wallpaper ${isDesktopSelected ? 'selected' : ''}"
             data-pattern="desktop">
            <img src="${desktopWallpaperPath}" alt="Desktop Wallpaper">
        </div>
    `);
    $patternsGrid.append($desktopThumbnail);

    console.log('Loaded pattern thumbnails');

    // Load variants for currently selected pattern (if not desktop wallpaper)
    if (currentBackground.pattern !== 'desktop') {
        loadVariantThumbnails(currentBackground.pattern);
    } else {
        // Clear variants grid for desktop wallpaper option
        $('#personalize-variants-grid').empty();
    }
}

// Load variant thumbnails for selected pattern
function loadVariantThumbnails(patternId) {
    const $variantsGrid = $('#personalize-variants-grid');
    $variantsGrid.empty();

    if (!backgroundPatterns) {
        console.error('Background patterns not loaded');
        return;
    }

    // Find the pattern data
    const patternData = backgroundPatterns.patterns.find(p => p.id === patternId);
    if (!patternData) {
        console.error('Pattern not found:', patternId);
        return;
    }

    // Generate thumbnails for all variants of this pattern
    patternData.variants.forEach(variantData => {
        const variant = variantData.id;
        const thumbPath = `resources/images/modern_patterns/${patternId}/v${variant}_thumb.png`;
        const isSelected = (currentBackground.pattern === patternId && currentBackground.variant === variant);

        const $thumbnail = $(`
            <div class="variant-thumbnail ${isSelected ? 'selected' : ''}"
                 data-pattern="${patternId}"
                 data-variant="${variant}">
                <img src="${thumbPath}" alt="Variant ${variant}">
            </div>
        `);

        $variantsGrid.append($thumbnail);
    });

    console.log('Loaded variant thumbnails for pattern:', patternId);
}

// Pattern thumbnail click handler
$(document).on('click', '.pattern-thumbnail', function (e) {
    e.preventDefault();
    e.stopPropagation();

    const patternIdStr = $(this).attr('data-pattern');
    const patternId = patternIdStr === 'desktop' ? 'desktop' : parseInt(patternIdStr);

    console.log('Pattern thumbnail clicked:', patternId);

    const previousBackground = {
        pattern: currentBackground.pattern,
        variant: currentBackground.variant
    };

    // Update selection in patterns grid
    $('.pattern-thumbnail').removeClass('selected');
    $(this).addClass('selected');

    // Handle desktop wallpaper option
    if (patternId === 'desktop') {
        // Clear variants grid since desktop wallpaper has no variants
        $('#personalize-variants-grid').empty();

        // Apply desktop wallpaper as background
        applyDesktopWallpaperBackground();

        // Update current background
        currentBackground = { pattern: 'desktop', variant: null };

        if (previousBackground.pattern !== 'desktop') {
            previousStartBackground = { ...previousBackground };
            savePreviousStartScreenBackground(previousStartBackground);
        }

        saveCurrentStartScreenBackground(currentBackground);

        applyNavigationSettingsUpdate({ showDesktopBackgroundOnStart: true });
    } else {
        // Update current background FIRST so loadVariantThumbnails can properly select variant 1
        currentBackground = { pattern: patternId, variant: 1 };

        // Load variants for this pattern (will auto-select variant 1)
        loadVariantThumbnails(patternId);

        // Apply background with first variant of this pattern
        applyBackgroundPattern(patternId, 1);

        saveCurrentStartScreenBackground(currentBackground);
        previousStartBackground = null;
        clearPreviousStartScreenBackground();
        applyNavigationSettingsUpdate({ showDesktopBackgroundOnStart: false });
    }
});

// Variant thumbnail click handler
$(document).on('click', '.variant-thumbnail', function (e) {
    e.preventDefault();
    e.stopPropagation();

    const patternId = parseInt($(this).attr('data-pattern'));
    const variant = parseInt($(this).attr('data-variant'));

    console.log('Variant thumbnail clicked:', patternId, variant);

    // Update selection in variants grid
    $('.variant-thumbnail').removeClass('selected');
    $(this).addClass('selected');

    // Apply background
    applyBackgroundPattern(patternId, variant);

    // Update current background
    currentBackground = { pattern: patternId, variant: variant };

    saveCurrentStartScreenBackground(currentBackground);
});

// Helper function to adjust brightness of a color
// percentChange: +25 for 25% brighter, -25 for 25% darker
function adjustBrightness(color, percentChange) {
    let r, g, b, a = 1;

    // Parse hex color (e.g., #RRGGBB or #RGB)
    const hexMatch = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hexMatch) {
        let hex = hexMatch[1];

        // Expand shorthand form (e.g., #03F -> #0033FF)
        if (hex.length === 3) {
            hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
        }

        r = parseInt(hex.substring(0, 2), 16);
        g = parseInt(hex.substring(2, 4), 16);
        b = parseInt(hex.substring(4, 6), 16);
    } else {
        // Parse rgb() or rgba() format
        const rgbaMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
        if (rgbaMatch) {
            r = parseInt(rgbaMatch[1]);
            g = parseInt(rgbaMatch[2]);
            b = parseInt(rgbaMatch[3]);
            a = parseFloat(rgbaMatch[4] || '1');
        } else {
            console.warn('Could not parse color:', color);
            return color;
        }
    }

    // Adjust brightness by percentage
    const factor = 1 + (percentChange / 100);
    r = Math.min(255, Math.max(0, Math.round(r * factor)));
    g = Math.min(255, Math.max(0, Math.round(g * factor)));
    b = Math.min(255, Math.max(0, Math.round(b * factor)));

    // Return in the same format as input (hex -> hex, rgba -> rgba)
    if (hexMatch) {
        const toHex = (n) => n.toString(16).padStart(2, '0');
        return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    } else {
        return `rgba(${r}, ${g}, ${b}, ${a})`;
    }
}

// Helper function to adjust both brightness and saturation
function adjustBrightnessAndSaturation(color, brightnessChange, saturationChange) {
    let r, g, b, a = 1;
    let isHex = false;

    // Parse hex color (e.g., #RRGGBB or #RGB)
    const hexMatch = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hexMatch) {
        isHex = true;
        let hex = hexMatch[1];

        // Expand shorthand form (e.g., #03F -> #0033FF)
        if (hex.length === 3) {
            hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
        }

        r = parseInt(hex.substring(0, 2), 16);
        g = parseInt(hex.substring(2, 4), 16);
        b = parseInt(hex.substring(4, 6), 16);
    } else {
        // Parse rgb() or rgba() format
        const rgbaMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
        if (rgbaMatch) {
            r = parseInt(rgbaMatch[1]);
            g = parseInt(rgbaMatch[2]);
            b = parseInt(rgbaMatch[3]);
            a = parseFloat(rgbaMatch[4] || '1');
        } else {
            console.warn('Could not parse color:', color);
            return color;
        }
    }

    // Convert RGB to HSL
    r /= 255;
    g /= 255;
    b /= 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;

    if (max === min) {
        h = s = 0; // achromatic
    } else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

        switch (max) {
            case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
            case g: h = ((b - r) / d + 2) / 6; break;
            case b: h = ((r - g) / d + 4) / 6; break;
        }
    }

    // Adjust saturation and lightness
    s = Math.min(1, Math.max(0, s * (1 + saturationChange / 100)));
    l = Math.min(1, Math.max(0, l * (1 + brightnessChange / 100)));

    // Convert HSL back to RGB
    let r2, g2, b2;
    if (s === 0) {
        r2 = g2 = b2 = l; // achromatic
    } else {
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };

        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r2 = hue2rgb(p, q, h + 1 / 3);
        g2 = hue2rgb(p, q, h);
        b2 = hue2rgb(p, q, h - 1 / 3);
    }

    // Convert back to 0-255 range
    r2 = Math.round(r2 * 255);
    g2 = Math.round(g2 * 255);
    b2 = Math.round(b2 * 255);

    // Return in the same format as input
    if (isHex) {
        const toHex = (n) => n.toString(16).padStart(2, '0');
        return `#${toHex(r2)}${toHex(g2)}${toHex(b2)}`;
    } else {
        return `rgba(${r2}, ${g2}, ${b2}, ${a})`;
    }
}

// Helper function to calculate relative luminance (WCAG formula)
function getRelativeLuminance(r, g, b) {
    // Normalize RGB values to 0-1 range
    const rsRGB = r / 255;
    const gsRGB = g / 255;
    const bsRGB = b / 255;

    // Apply gamma correction
    const rLinear = rsRGB <= 0.03928 ? rsRGB / 12.92 : Math.pow((rsRGB + 0.055) / 1.055, 2.4);
    const gLinear = gsRGB <= 0.03928 ? gsRGB / 12.92 : Math.pow((gsRGB + 0.055) / 1.055, 2.4);
    const bLinear = bsRGB <= 0.03928 ? bsRGB / 12.92 : Math.pow((bsRGB + 0.055) / 1.055, 2.4);

    // Calculate relative luminance
    return 0.2126 * rLinear + 0.7152 * gLinear + 0.0722 * bLinear;
}

// Helper function to get contrasting text color (white or black)
function getContrastingTextColor(color) {
    let r, g, b;

    // Parse hex color
    const hexMatch = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hexMatch) {
        let hex = hexMatch[1];

        // Expand shorthand form
        if (hex.length === 3) {
            hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
        }

        r = parseInt(hex.substring(0, 2), 16);
        g = parseInt(hex.substring(2, 4), 16);
        b = parseInt(hex.substring(4, 6), 16);
    } else {
        // Parse rgb() or rgba() format
        const rgbaMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
        if (rgbaMatch) {
            r = parseInt(rgbaMatch[1]);
            g = parseInt(rgbaMatch[2]);
            b = parseInt(rgbaMatch[3]);
        } else {
            console.warn('Could not parse color for contrast calculation:', color);
            return '#ffffff'; // Default to white
        }
    }

    // Calculate relative luminance
    const luminance = getRelativeLuminance(r, g, b);

    // Use white text for dark backgrounds, black text for light backgrounds
    // Threshold of 0.5 works well for most cases (WCAG uses 0.179 for AA contrast)
    return luminance > 0.5 ? '#000000' : '#ffffff';
}

// Helper function to set accent color and its brightness variations
function setAccentColors(color) {
    // Set the base accent color
    document.documentElement.style.setProperty('--ui-accent', color);

    // Set +40% brighter version with -25% saturation (lighter = less saturated)
    const colorPlus = adjustBrightnessAndSaturation(color, 30, -20);
    document.documentElement.style.setProperty('--ui-accent-plus', colorPlus);

    // Set -40% darker version with +30% saturation (darker = more saturated)
    const colorMinus = adjustBrightnessAndSaturation(color, -30, 20);
    document.documentElement.style.setProperty('--ui-accent-minus', colorMinus);

    // Set contrasting text color (white or black)
    const textColor = getContrastingTextColor(color);
    document.documentElement.style.setProperty('--ui-accent-text-contrast', textColor);

    console.log('Set accent colors - base:', color, 'plus:', colorPlus, 'minus:', colorMinus, 'text:', textColor);

    // Notify all iframe apps of the theme change
    notifyIframeAppsOfThemeChange();
}

// Helper function to send theme variables to all open iframe apps
function notifyIframeAppsOfThemeChange() {
    const rootStyles = getComputedStyle(document.documentElement);
    const themeVariables = {
        'ui-accent': rootStyles.getPropertyValue('--ui-accent').trim(),
        'ui-accent-plus': rootStyles.getPropertyValue('--ui-accent-plus').trim(),
        'ui-accent-minus': rootStyles.getPropertyValue('--ui-accent-minus').trim(),
        'ui-accent-text-contrast': rootStyles.getPropertyValue('--ui-accent-text-contrast').trim(),
        'ui-wall-color': rootStyles.getPropertyValue('--ui-wall-color').trim()
    };

    // Find all iframes in modern and classic app containers
    const $iframes = $('.modern-app-iframe, .classic-window-iframe');
    $iframes.each(function () {
        const iframeWindow = this.contentWindow;
        if (iframeWindow) {
            iframeWindow.postMessage({
                action: 'setThemeVariables',
                variables: themeVariables
            }, '*');
        }
    });

    console.log('[App.js] Notified', $iframes.length, 'iframe apps of theme change');
}

// Apply background pattern to Start Screen
function applyBackgroundPattern(patternId, variant) {
    const bgPath = `resources/images/modern_patterns/${patternId}/v${variant}_full.png`;
    const $startScreen = $('#start-screen');
    const $startScreenBg = $('.start-screen-background');

    // Get pattern metadata
    const patternData = backgroundPatterns.patterns.find(p => p.id === patternId);
    if (!patternData) {
        console.error('Pattern data not found:', patternId);
        return;
    }

    // Get variant data to access backgroundColor
    const variantData = patternData.variants.find(v => v.id === variant);
    if (!variantData) {
        console.error('Variant data not found:', patternId, variant);
        return;
    }

    const alignment = patternData.alignment || 'top';
    const backgroundColor = variantData.backgroundColor || '#000000';
    const splitY = patternData.splitY;

    // Clear any existing split background styling
    $startScreen.removeClass('bg-split bg-top bg-bottom bg-cover');
    $startScreenBg.find('.split-bg-container').remove();

    // Apply background color to both elements
    $startScreen.css('background-color', backgroundColor);
    $startScreenBg.css('background-color', backgroundColor);

    if (alignment === 'split' && splitY !== null && splitY !== undefined) {
        // Split background: image is split at splitY pixels from top
        // Top portion aligned to top, bottom portion aligned to bottom
        $startScreen.addClass('bg-split');

        // Create container for split backgrounds
        const $splitContainer = $('<div class="split-bg-container"></div>');

        // Top section: show only the portion from 0 to splitY
        const $topSection = $(`<div class="split-bg-top"></div>`);
        $topSection.css({
            'background-image': `url('${bgPath}')`,
            'background-position': 'top left',
            'background-size': 'auto 800px', // Always 800px tall
            'background-repeat': 'repeat-x',
            'height': `${splitY}px`,
            'position': 'absolute',
            'top': '0',
            'left': '0',
            'width': '100%',
            'z-index': '0'
        });

        // Bottom section: show the portion from splitY to 800px, aligned to bottom
        const $bottomSection = $(`<div class="split-bg-bottom"></div>`);
        const bottomHeight = 800 - splitY; // Remaining height of the image
        $bottomSection.css({
            'background-image': `url('${bgPath}')`,
            'background-position': `left ${-splitY}px`, // Offset to show bottom portion
            'background-size': 'auto 800px', // Always 800px tall
            'background-repeat': 'repeat-x',
            'height': `${bottomHeight}px`,
            'position': 'absolute',
            'bottom': '0',
            'left': '0',
            'width': '100%',
            'z-index': '0'
        });

        $splitContainer.append($topSection);
        $splitContainer.append($bottomSection);
        $startScreenBg.append($splitContainer);

        // Clear the background images
        $startScreen.css({
            'background-image': 'none'
        });
        $startScreenBg.css({
            'background-image': 'none'
        });
    } else if (alignment === 'top') {
        // Top-aligned: image at top (800px tall), background color fills rest
        $startScreen.css({
            'background-image': 'none'
        });
        $startScreenBg.css({
            'background-image': `url('${bgPath}')`,
            'background-size': 'auto 800px',
            'background-position': 'top center',
            'background-repeat': 'repeat-x'
        });
    } else if (alignment === 'bottom') {
        // Bottom-aligned: image at bottom (800px tall), background color fills rest
        $startScreen.css({
            'background-image': 'none'
        });
        $startScreenBg.css({
            'background-image': `url('${bgPath}')`,
            'background-size': 'auto 800px',
            'background-position': 'bottom center',
            'background-repeat': 'repeat-x'
        });
    }

    // Always update the accent color to match the selected pattern variant's background color
    setAccentColors(backgroundColor);
    saveAccentColorToRegistry(backgroundColor);

    console.log('Applied background pattern:', patternId, 'variant:', variant, 'alignment:', alignment, 'backgroundColor:', backgroundColor, 'splitY:', splitY);
}

// Apply desktop wallpaper as Start Screen background
function applyDesktopWallpaperBackground(explicitWallpaperPath = null) {
    // Helper to get wallpaper path with type awareness
    const getSavedWallpaperPath = () => {
        if (explicitWallpaperPath) {
            return explicitWallpaperPath;
        }

        if (window.WallpaperController) {
            const controllerPath = window.WallpaperController.getCurrentFullPath();
            if (controllerPath) {
                return controllerPath;
            }
        }

        try {
            const settings = loadDesktopBackgroundSettings();
            if (settings.currentWallpaper) {
                const fullPath = toFullWallpaperPath(settings.currentWallpaper, settings.currentWallpaperType);
                if (fullPath) {
                    return fullPath;
                }
            }
        } catch (e) {
            console.error('Failed to read saved wallpaper settings:', e);
        }
        return getDesktopWallpaperPath(); // Fallback to default
    };

    const wallpaperPath = getSavedWallpaperPath();
    const formattedPath = toAssetUrl(wallpaperPath);

    const $startScreen = $('#start-screen');
    const $startScreenBg = $('.start-screen-background');

    // Clear any existing split background styling
    $startScreen.removeClass('bg-split bg-top bg-bottom bg-cover');
    $startScreenBg.find('.split-bg-container').remove();

    // Apply the desktop wallpaper with a 50% dim overlay
    $startScreen.css({
        'background-image': 'none',
        'background-color': '#464646'
    });
    $startScreenBg.css({
        'background-image': `linear-gradient(rgba(0, 0, 0, 0.5), rgba(0, 0, 0, 0.5)), url("${formattedPath}")`,
        'background-size': 'cover',
        'background-position': 'center',
        'background-repeat': 'no-repeat',
        'background-color': '#464646'
    });

    // Always set accent to grey when desktop wallpaper is used as start screen background
    setAccentColors('#464646');
    saveAccentColorToRegistry('#464646');

    console.log('Applied desktop wallpaper as Start Screen background with 50% dim overlay:', formattedPath);
}

function refreshPersonalizeBackgroundSelection() {
    if ($('#personalize-patterns-grid').length) {
        loadPatternThumbnails();
    }
}

function applyDesktopBackgroundPreference(enabled) {
    if (!backgroundPatterns) {
        loadBackgroundPatterns().then(() => applyDesktopBackgroundPreference(enabled));
        return;
    }

    if (enabled) {
        if (currentBackground.pattern !== 'desktop') {
            previousStartBackground = { ...currentBackground };
            savePreviousStartScreenBackground(previousStartBackground);
        }

        currentBackground = { pattern: 'desktop', variant: null };
        saveCurrentStartScreenBackground(currentBackground);
        applyDesktopWallpaperBackground();
    } else {
        let restored = false;
        if (!previousStartBackground) {
            const { previous } = loadStartScreenBackground(backgroundPatterns.default || DEFAULT_START_BACKGROUND);
            previousStartBackground = previous ? { ...previous } : null;
        }

        if (previousStartBackground && previousStartBackground.pattern && previousStartBackground.pattern !== 'desktop') {
            currentBackground = {
                pattern: previousStartBackground.pattern,
                variant: previousStartBackground.variant || 1
            };
            saveCurrentStartScreenBackground(currentBackground);
            applyBackgroundPattern(currentBackground.pattern, currentBackground.variant);
            restored = true;
        }

        if (!restored) {
            const fallback = backgroundPatterns.default || { pattern: 1, variant: 1 };
            currentBackground = {
                pattern: fallback.pattern,
                variant: fallback.variant || 1
            };
            saveCurrentStartScreenBackground(currentBackground);
            applyBackgroundPattern(currentBackground.pattern, currentBackground.variant);
        }

        previousStartBackground = null;
        clearPreviousStartScreenBackground();
    }

    refreshPersonalizeBackgroundSelection();
}

// ===== USER TILE =====
$(document).ready(function () {
    // Helper function to position dropdown below a button
    // align: 'right' (default), 'center', or 'left'
    function positionDropdown($button, $dropdown, { center = false, align } = {}) {
        const buttonRect = $button[0].getBoundingClientRect();
        const dropdownWidth = $dropdown.outerWidth();

        // Resolve alignment (center flag kept for backwards compat)
        const effectiveAlign = align || (center ? 'center' : 'right');

        let left;
        if (effectiveAlign === 'center') {
            left = buttonRect.left + (buttonRect.width / 2) - (dropdownWidth / 2);
        } else if (effectiveAlign === 'left') {
            left = buttonRect.left;
        } else {
            left = buttonRect.right - dropdownWidth;
        }

        $dropdown.css({
            top: buttonRect.bottom + 8 + 'px',
            left: left + 'px'
        });
    }

    // Helper to find the contextually correct dropdown for a button
    function findDropdownForButton($button, dropdownClass) {
        const inStartMenu = $button.closest('#start-menu').length > 0;
        if (inStartMenu) {
            // Use the start-menu-specific dropdown (sibling of #start-menu)
            return $('.start-menu-user-dropdown, .start-menu-power-dropdown').filter('.' + dropdownClass);
        }
        // Use the start-screen dropdown (inside #start-screen)
        return $('#start-screen .' + dropdownClass);
    }

    // Toggle user tile dropdown (but not when clicking on dropdown items)
    $('.user-tile').on('click', function (e) {
        // Don't toggle if clicking on the dropdown or its items
        if ($(e.target).closest('.user-tile-dropdown').length) {
            return;
        }
        e.stopPropagation();

        const $userTile = $(this);
        const $dropdown = findDropdownForButton($userTile, 'user-tile-dropdown');
        const isActive = $dropdown.hasClass('active');

        // Close all dropdowns
        $('.start-power-menu, .user-tile-dropdown').removeClass('active');

        // Toggle dropdown
        if (!isActive) {
            const inStartMenu = $userTile.closest('#start-menu').length > 0;
            positionDropdown($userTile, $dropdown, { align: inStartMenu ? 'left' : 'right' });
            $dropdown.addClass('active');
        }
    });

    // Close dropdown when clicking outside
    $(document).on('click', function (e) {
        if (!$(e.target).closest('.user-tile').length && !$(e.target).closest('.user-tile-dropdown').length) {
            $('.user-tile-dropdown').removeClass('active');
        }
    });

    // User tile dropdown item click handlers
    $(document).on('click', '.user-tile-dropdown-item', function (e) {
        e.preventDefault();
        e.stopPropagation();

        const action = $(this).attr('data-action');
        console.log('User tile action:', action);

        // Close dropdown
        $('.user-tile-dropdown').removeClass('active');

        switch (action) {
            case 'change-picture':
                console.log('Change account picture - not yet implemented');
                // TODO: Implement change picture functionality
                break;
            case 'lock':
                console.log('Locking system...');
                lockSystem();
                break;
            case 'sign-out':
                console.log('Signing out...');
                signOut();
                break;
        }
    });

    // Power button dropdown handler
    $('.power-button').on('click', function (e) {
        // Don't toggle if clicking on the dropdown or its items
        if ($(e.target).closest('.start-power-menu').length) {
            return;
        }
        e.stopPropagation();

        const $powerButton = $(this);
        const $dropdown = findDropdownForButton($powerButton, 'start-power-menu');
        const isActive = $dropdown.hasClass('active');

        // Close all dropdowns
        $('.start-power-menu, .user-tile-dropdown').removeClass('active');

        // Toggle dropdown
        if (!isActive) {
            positionDropdown($powerButton, $dropdown, { center: true });
            $dropdown.addClass('active');
        }
    });

    // Close power dropdown when clicking outside
    $(document).on('click', function (e) {
        if (!$(e.target).closest('.power-button').length && !$(e.target).closest('.start-power-menu').length) {
            $('.start-power-menu').removeClass('active');
        }
    });

    // Power menu item click handlers
    $(document).on('click', '.start-power-menu-item', function (e) {
        e.preventDefault();
        e.stopPropagation();

        const action = $(this).attr('data-action');
        console.log('Power menu action:', action);

        // Close dropdown
        $('.start-power-menu').removeClass('active');

        handleSystemPowerAction(action, 'Start power menu');
    });

    // Search button handler
    $('.search-button').on('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        console.log('Search button clicked');
        openModernFlyout('search');
    });

    // All apps arrow fade-out on idle
    let allAppsIdleTimer = null;

    function resetAllAppsIdleTimer() {
        const $upToggle = $('.all-apps-up-toggle');

        // Remove fade class
        $upToggle.removeClass('fade-idle');

        // Clear existing timer
        if (allAppsIdleTimer) {
            clearTimeout(allAppsIdleTimer);
        }

        // Only set timer if we're in all apps view
        if ($('#start-screen').hasClass('all-apps-open')) {
            allAppsIdleTimer = setTimeout(function () {
                $upToggle.addClass('fade-idle');
            }, 5000);
        }
    }

    window.syncStartScreenAllAppsIdleState = resetAllAppsIdleTimer;

    // Track mouse movement in start screen
    $('#start-screen').on('mousemove', function () {
        if ($('#start-screen').hasClass('all-apps-open')) {
            resetAllAppsIdleTimer();
        }
    });

    // Reset timer when switching to all apps view
    $('.all-apps-toggle').on('click', function () {
        resetAllAppsIdleTimer();
    });
});

// ===== CLASSIC CONTEXT MENUS MANAGEMENT =====
// Unified function to close all classic context menus
function closeAllClassicContextMenus() {
    // Hide Quick Links menu
    if (quickLinksMenuVisible) {
        hideQuickLinksMenu();
    }

    // Hide desktop context menu
    hideDesktopContextMenu();

    // Hide taskbar context menu
    hideTaskbarContextMenu();

    if (window.ExplorerEngine && typeof window.ExplorerEngine.closeItemContextMenu === 'function') {
        window.ExplorerEngine.closeItemContextMenu();
    }
}

function requestExplorerDesktopRefresh() {
    if (window.ExplorerEngine && typeof window.ExplorerEngine.refreshDesktop === 'function') {
        window.ExplorerEngine.refreshDesktop().catch(error => {
            console.error('ExplorerEngine: Refresh failed.', error);
        });
    }
}

// ===== QUICK LINKS MENU (Win+X) =====
let quickLinksMenuVisible = false;

function showQuickLinksMenu() {
    const $menu = $('#quick-links-menu');

    // If already visible, hide it
    if (quickLinksMenuVisible) {
        hideQuickLinksMenu();
        return;
    }

    // Close all taskbar popups and menus first
    closeAllTaskbarPopupsAndMenus();

    // Close all other classic context menus
    hideDesktopContextMenu();
    hideTaskbarContextMenu();
    closeStartMenu({ forceDesktop: true, suppressRestore: true });

    $menu.find('[data-action="desktop"]').closest('.classic-context-menu-item').toggle(!isStartMenuEnabled());

    // Show the menu
    $menu.css('display', 'flex');
    quickLinksMenuVisible = true;

    console.log('Quick Links menu shown');
}

function hideQuickLinksMenu() {
    const $menu = $('#quick-links-menu');

    if (!quickLinksMenuVisible) {
        return;
    }

    // Hide the menu
    $menu.css('display', 'none');
    quickLinksMenuVisible = false;
    console.log('Quick Links menu hidden');
}

function getAppForQuickLink(preferredIds, preferredNames) {
    if (!window.AppsManager) {
        return null;
    }

    const ids = (Array.isArray(preferredIds) ? preferredIds : [preferredIds]).filter(Boolean);
    const names = (Array.isArray(preferredNames) ? preferredNames : [preferredNames])
        .filter(name => typeof name === 'string' && name.trim().length > 0)
        .map(name => name.toLowerCase());

    if (typeof AppsManager.getAppById === 'function') {
        for (const id of ids) {
            const appById = AppsManager.getAppById(id);
            if (appById) {
                return appById;
            }
        }
    }

    if (typeof AppsManager.getAllApps !== 'function') {
        return null;
    }

    const all = AppsManager.getAllApps();
    if (!Array.isArray(all) || all.length === 0) {
        return null;
    }

    return all.find(app => {
        if (!app) {
            return false;
        }

        if (ids.length && ids.includes(app.id)) {
            return true;
        }

        if (names.length && typeof app.name === 'string' && names.includes(app.name.toLowerCase())) {
            return true;
        }

        return false;
    }) || null;
}

// Handle Quick Links menu item clicks
$(document).on('click', '.quick-links-menu-item', function (e) {
    e.stopPropagation();
    const action = $(this).data('action');
    console.log('Quick Links menu action:', action);

    // Hide menu first
    hideQuickLinksMenu();

    // Execute the action
    switch (action) {
        case 'control-panel': {
            // Launch Control Panel
            const controlPanelApp = getAppForQuickLink(['control-panel', 'control'], ['Control Panel']);
            if (controlPanelApp) {
                launchApp(controlPanelApp);
            } else {
                console.warn('Quick Links: Control Panel app not available.');
            }
            break;
        }

        case 'file-explorer': {
            // Launch File Explorer
            const fileExplorerApp = getAppForQuickLink(
                ['file-explorer', 'explorer', 'windows-explorer'],
                ['File Explorer', 'Windows Explorer']
            );
            if (fileExplorerApp) {
                launchApp(fileExplorerApp);
            } else {
                console.warn('Quick Links: File Explorer app not available.');
            }
            break;
        }

        case 'search':
            // Open Search flyout (available on any surface)
            if (typeof openModernFlyout === 'function') {
                openModernFlyout('search');
            } else {
                console.warn('Quick Links: Search flyout not available.');
            }
            break;

        case 'run': {
            // Launch Run dialog
            const runApp = getAppForQuickLink(['run'], ['Run']);
            if (runApp) {
                launchApp(runApp);
            } else {
                console.warn('Quick Links: Run dialog not available.');
            }
            break;
        }

        case 'task-manager': {
            // Launch Task Manager
            const taskManagerApp = getAppForQuickLink(['task-manager', 'taskmgr'], ['Task Manager']);
            if (taskManagerApp) {
                launchApp(taskManagerApp);
            } else {
                console.warn('Quick Links: Task Manager app not available.');
            }
            break;
        }

        case 'device-manager':
        case 'disk-management':
        case 'computer-management':
        case 'power-options':
        case 'event-viewer':
        case 'system':
            console.log(`${action} - Not implemented in simulation`);
            break;

        case 'command-prompt': {
            // Launch Command Prompt
            const cmdApp = getAppForQuickLink(['cmd', 'command-prompt'], ['Command Prompt']);
            if (cmdApp) {
                launchApp(cmdApp);
            } else {
                console.warn('Quick Links: Command Prompt app not available.');
            }
            break;
        }

        case 'command-prompt-admin':
            console.log('Command Prompt (Admin) - Not implemented in simulation');
            break;

        case 'sign-out':
            // Sign out - go to login screen
            if (typeof signOut === 'function') {
                signOut();
            }
            break;

        case 'sleep':
        case 'shut-down':
        case 'restart':
            handleSystemPowerAction(action, 'Quick Links menu');
            break;

        case 'desktop':
            // Switch to desktop
            if (isStartSurfaceVisible()) {
                closeStartSurface({ forceDesktop: true, suppressRestore: true });
            }
            break;
    }
});

// Close Quick Links menu when clicking outside
$(document).on('click', function (e) {
    if (quickLinksMenuVisible) {
        const $menu = $('#quick-links-menu');
        if (!$menu.is(e.target) && $menu.has(e.target).length === 0) {
            hideQuickLinksMenu();
        }
    }
});

// Lock the system (show lock screen, keep apps running)
function lockSystem() {
    const $lockScreen = views.lock;
    const $loginScreen = views.login;
    const $startScreen = views.start;
    const $desktop = views.desktop;

    hideStartMenuImmediately();

    // Save the current view so we can restore it after unlock
    viewBeforeLock = currentView;
    console.log('Locking system - saving view:', viewBeforeLock);

    // Hide all other views
    $startScreen.removeClass('visible show-content show-content-from-desktop fade-background slide-in exit-to-desktop opening-from-desktop');
    $desktop.removeClass('visible fade-out-to-start');

    // Show login screen (user picker) for unlock flow - it will be behind lock screen
    $loginScreen.removeClass('slide-out fade-to-accent');
    $loginScreen.css({
        'transform': '',
        'opacity': '',
        'transition': '',
        'background': ''
    });
    $loginScreen.addClass('visible');

    // Set lock state attribute to indicate user manually locked
    $loginScreen.attr('data-lock-state', 'locked');

    // Show lock screen
    // Add fade-in class for 0.5s pause + 0.25s fade animation
    $lockScreen.addClass('visible fade-in');

    // Reset lock screen state
    $lockScreen.css({
        'transform': 'translateY(0)',
        'transition': ''
    });

    // Update current view
    setCurrentView('lock');

    // Disable charms bar
    $('body').removeClass('charms-allowed');

    // Update taskbar visibility
    updateTaskbarVisibility('lock');

    // Re-initialize lock screen
    initLockScreen();

    console.log('System locked - login screen reset and visible');
}

// Sign out (show intermediary screen, close all apps, fade to black, then show lock screen)
function signOut() {
    console.log('Signing out - showing intermediary screen...');
    hideStartMenuImmediately();

    // Show intermediary screen with "Signing out" text
    showIntermediaryScreen('Signing out', function () {
        console.log('Signing out - closing all running apps...');

        // Play logoff sound
        if (window.systemSounds) {
            systemSounds.play('logoff');
        }

        // Clear the saved view since sign out should always return to start screen
        viewBeforeLock = null;

        // Get all running apps
        const runningApps = AppsManager.getRunningApps();

        // Close each running app
        runningApps.forEach(runningApp => {
            const appId = runningApp.app.id;

            // Remove the container immediately without animation
            if (runningApp.$container) {
                runningApp.$container.remove();
            }

            // Unregister the app
            AppsManager.unregisterRunningApp(appId);
        });

        console.log('All apps closed. Fading to black...');

        // Fade to black (above lockscreen for reveal)
        const $fadeToBlack = $('#fade-to-black');
        $fadeToBlack.addClass('visible boot-transition');

        // Hold black screen for 0.5-1 second, then fade in to lock screen
        const holdDuration = Math.floor(Math.random() * 500) + 500; // 500-1000ms
        setTimeout(function () {
            console.log('Showing lock screen...');

            // Show lock screen first
            console.log('Showing login screen with lock screen on top...');

            const $lockScreen = views.lock;
            const $loginScreen = views.login;
            const $startScreen = views.start;
            const $desktop = views.desktop;
            const $signingInScreen = views.signingIn;

            // Hide all views
            $startScreen.removeClass('visible show-content show-content-from-desktop fade-background slide-in exit-to-desktop opening-from-desktop');
            $desktop.removeClass('visible fade-out-to-start');
            $signingInScreen.removeClass('visible slide-out');
            $signingInScreen.css({
                'opacity': '',
                'transition': '',
                'transform': ''
            });

            // Reset and show login screen (user picker) - it will be behind lock screen
            $loginScreen.removeClass('slide-out fade-to-accent');
            $loginScreen.css({
                'transform': '',
                'opacity': '',
                'transition': '',
                'background': ''
            });
            $loginScreen.addClass('visible');

            // Set lock state attribute to indicate user is fully logged out
            $loginScreen.attr('data-lock-state', 'logged-out');

            // Show lock screen on top, keeping login visible
            $lockScreen.addClass('visible fade-in');
            $lockScreen.css({
                'transform': 'translateY(0)',
                'transition': ''
            });

            // Update current view
            setCurrentView('lock');

            // Disable charms bar
            $('body').removeClass('charms-allowed');

            // Update taskbar visibility
            updateTaskbarVisibility('lock');

            // Re-initialize lock screen
            initLockScreen();

            // Then fade out the black overlay to reveal lock screen
            setTimeout(function () {
                $fadeToBlack.removeClass('visible boot-transition');
            }, 50);

            console.log('Sign out complete - lock screen visible with login screen underneath');
        }, holdDuration);
    });
}

// ===== POWER OPTIONS MENU (Settings Charm) =====
$(document).ready(function () {
    // Settings charm power button click handler - toggle power menu
    $(document).on('click', '.settings-control-item[data-control="power"]', function (e) {
        e.preventDefault();
        e.stopPropagation();

        const $powerMenu = $('.settings-power-menu');
        const $powerButton = $(this);

        // Toggle menu and button active state
        $powerMenu.toggleClass('active');
        $powerButton.toggleClass('active');

        console.log('Settings power button clicked - menu toggled');
    });

    // Login screen power button click handler - toggle power menu
    $(document).on('click', '.login-power-button', function (e) {
        e.preventDefault();
        e.stopPropagation();

        const $powerMenu = $('.login-power-menu');
        const $powerButton = $(this);

        // Toggle menu and button active state
        $powerMenu.toggleClass('active');
        $powerButton.toggleClass('active');

        console.log('Login power button clicked - menu toggled');
    });

    // Close power menus when clicking outside
    $(document).on('click', function (e) {
        // Settings charm power menu
        const $settingsPowerMenu = $('.settings-power-menu');
        const $settingsPowerButton = $('.settings-control-item[data-control="power"]');

        if (!$(e.target).closest('.settings-power-menu').length &&
            !$(e.target).closest('.settings-control-item[data-control="power"]').length) {
            $settingsPowerMenu.removeClass('active');
            $settingsPowerButton.removeClass('active');
        }

        // Login screen power menu
        const $loginPowerMenu = $('.login-power-menu');
        const $loginPowerButton = $('.login-power-button');

        if (!$(e.target).closest('.login-power-menu').length &&
            !$(e.target).closest('.login-power-button').length) {
            $loginPowerMenu.removeClass('active');
            $loginPowerButton.removeClass('active');
        }
    });

    // Settings charm power options menu item click handlers
    $(document).on('click', '.settings-power-menu-item', function (e) {
        e.preventDefault();
        e.stopPropagation();

        const action = $(this).attr('data-action');
        console.log('Settings power option selected:', action);

        // Close the power menu
        $('.settings-power-menu').removeClass('active');
        $('.settings-control-item[data-control="power"]').removeClass('active');

        handleSystemPowerAction(action, 'Settings power menu');
    });

    // Login screen power options menu item click handlers
    $(document).on('click', '.login-power-menu-item', function (e) {
        e.preventDefault();
        e.stopPropagation();

        const action = $(this).attr('data-action');
        console.log('Login power option selected:', action);

        // Close the power menu
        $('.login-power-menu').removeClass('active');
        $('.login-power-button').removeClass('active');

        handleSystemPowerAction(action, 'Login power menu');
    });
});

// ===== NETWORK FLYOUT =====
$(document).ready(function () {
    // Network icon in system tray click handler - open network flyout
    $(document).on('click', '#network-icon', function (e) {
        e.preventDefault();
        e.stopPropagation();

        console.log('Network icon clicked - opening network flyout');
        openModernFlyout('network');
    });

    // Settings charm network button click handler - open network flyout
    $(document).on('click', '.settings-control-item[data-control="network"]', function (e) {
        e.preventDefault();
        e.stopPropagation();

        console.log('Settings network button clicked - opening network flyout');
        openModernFlyout('network');
    });
});

// Helper function to hide charms bar
function hideCharmsBar() {
    const $charmsBar = $('.charms-bar');
    const $charmsDateTimePanel = $('.charms-datetime-panel');

    $charmsBar
        .removeClass('keyboard-triggered touch-dragging')
        .css('--charms-touch-offset', '')
        .addClass('hiding');
    $charmsDateTimePanel.removeClass('visible');
    setTimeout(function () {
        $charmsBar.removeClass('visible show-background hiding');
    }, 250);
}

// ===== TOUCH EDGE BARS FOR MODERN APPS =====
const MODERN_TOUCH_EDGE_ZONE = 32;
const MODERN_TOUCH_RIGHT_EDGE_EXCLUSION = 32;
const MODERN_TOUCH_TITLEBAR_OPEN_THRESHOLD = 20;
const MODERN_TOUCH_TASKBAR_OPEN_THRESHOLD = 32;
const MODERN_TOUCH_CANCEL_HORIZONTAL_THRESHOLD = 96;
const MODERN_TOUCH_BAR_AUTOHIDE_DELAY = 2200;
const modernTouchEdgeBars = {
    titlebar: {
        active: false,
        startX: 0,
        startY: 0,
        reveal: 0,
        pinned: false,
        hideTimeout: null
    },
    taskbar: {
        active: false,
        startX: 0,
        startY: 0,
        reveal: 0,
        pinned: false,
        hideTimeout: null
    }
};

function isModernTouchBarContext() {
    return $('body').hasClass('view-modern') && $('.modern-app-container.active .modern-app-titlebar').length > 0;
}

function getModernTouchTitlebar() {
    return $('.modern-app-container.active').last().find('.modern-app-titlebar').first();
}

function getModernTouchBarElement(barName, options = {}) {
    if (barName === 'titlebar') {
        return options.all ? $('.modern-app-titlebar') : getModernTouchTitlebar();
    }

    return $('.taskbar');
}

function getModernTouchBarHeight(barName) {
    const $bar = getModernTouchBarElement(barName);
    return $bar.outerHeight() || parseFloat($bar.css('height')) || (barName === 'titlebar' ? 30 : 40);
}

function getModernTouchBarOffsetVariable(barName) {
    return barName === 'titlebar'
        ? '--modern-titlebar-touch-offset'
        : '--taskbar-touch-offset';
}

function clearModernTouchBarTimer(barName) {
    const barState = modernTouchEdgeBars[barName];
    clearTimeout(barState.hideTimeout);
    barState.hideTimeout = null;
}

function isModernTouchBarShown(barName) {
    const $bar = getModernTouchBarElement(barName);
    return $bar.hasClass('touch-visible') || $bar.hasClass('touch-pinned') || $bar.hasClass('touch-dragging');
}

function applyModernTouchBarReveal(barName, revealAmount) {
    const $bar = getModernTouchBarElement(barName);
    if (!$bar.length) {
        return;
    }

    const barHeight = getModernTouchBarHeight(barName);
    const clampedReveal = Math.max(0, Math.min(revealAmount, barHeight));
    const offsetValue = barName === 'titlebar'
        ? `${clampedReveal - barHeight}px`
        : `${barHeight - clampedReveal}px`;

    clearModernTouchBarTimer(barName);
    modernTouchEdgeBars[barName].reveal = clampedReveal;

    $bar
        .removeClass('touch-visible touch-pinned')
        .addClass('touch-dragging')
        .css(getModernTouchBarOffsetVariable(barName), offsetValue);
}

function hideModernTouchBar(barName) {
    const $bar = getModernTouchBarElement(barName, { all: true });
    const barState = modernTouchEdgeBars[barName];

    clearModernTouchBarTimer(barName);
    barState.active = false;
    barState.reveal = 0;
    barState.pinned = false;

    $bar
        .removeClass('touch-visible touch-pinned touch-dragging')
        .css(getModernTouchBarOffsetVariable(barName), '');
}

function scheduleModernTouchBarHide(barName) {
    const barState = modernTouchEdgeBars[barName];
    if (barState.pinned) {
        return;
    }

    clearModernTouchBarTimer(barName);
    barState.hideTimeout = setTimeout(function () {
        if (!barState.pinned) {
            hideModernTouchBar(barName);
        }
    }, MODERN_TOUCH_BAR_AUTOHIDE_DELAY);
}

function showModernTouchBar(barName, options = {}) {
    const $bar = getModernTouchBarElement(barName);
    if (!$bar.length) {
        return;
    }

    const { pinned = false } = options;
    const barState = modernTouchEdgeBars[barName];

    clearModernTouchBarTimer(barName);
    barState.active = false;
    barState.reveal = getModernTouchBarHeight(barName);
    barState.pinned = pinned;

    $bar
        .removeClass('touch-dragging')
        .addClass('touch-visible')
        .toggleClass('touch-pinned', pinned)
        .css(getModernTouchBarOffsetVariable(barName), '0px');

    if (!pinned) {
        scheduleModernTouchBarHide(barName);
    }
}

function pinModernTouchBar(barName) {
    if (!isModernTouchBarContext() || !isModernTouchBarShown(barName)) {
        return;
    }

    showModernTouchBar(barName, { pinned: true });
}

function startModernTouchBarDrag(barName, touch) {
    const barState = modernTouchEdgeBars[barName];
    clearModernTouchBarTimer(barName);

    barState.active = true;
    barState.startX = touch.clientX;
    barState.startY = touch.clientY;
    barState.reveal = 0;
    barState.pinned = false;

    applyModernTouchBarReveal(barName, 0);
}

function hideModernTouchEdgeBars() {
    hideModernTouchBar('titlebar');
    hideModernTouchBar('taskbar');
}

$(document).ready(function () {
    $(document).on('touchstart.modernedgebars', function (e) {
        if (!isModernTouchBarContext()) {
            hideModernTouchEdgeBars();
            return;
        }

        const originalEvent = e.originalEvent;
        if (!originalEvent.touches || originalEvent.touches.length !== 1) {
            return;
        }

        const touch = originalEvent.touches[0];
        const $target = $(e.target);
        const insideTitlebar = $target.closest('.modern-app-titlebar').length > 0;
        const insideTaskbar = $target.closest('.taskbar').length > 0;
        let hidExistingBar = false;

        if (insideTitlebar) {
            pinModernTouchBar('titlebar');
        } else if (isModernTouchBarShown('titlebar')) {
            hideModernTouchBar('titlebar');
            hidExistingBar = true;
        }

        if (insideTaskbar) {
            pinModernTouchBar('taskbar');
        } else if (isModernTouchBarShown('taskbar')) {
            hideModernTouchBar('taskbar');
            hidExistingBar = true;
        }

        if (insideTitlebar || insideTaskbar || hidExistingBar) {
            return;
        }

        if (touch.clientX >= window.innerWidth - MODERN_TOUCH_RIGHT_EDGE_EXCLUSION) {
            return;
        }

        if (touch.clientY <= MODERN_TOUCH_EDGE_ZONE) {
            startModernTouchBarDrag('titlebar', touch);
            e.preventDefault();
            return;
        }

        if (touch.clientY >= window.innerHeight - MODERN_TOUCH_EDGE_ZONE) {
            startModernTouchBarDrag('taskbar', touch);
            e.preventDefault();
        }
    });

    $(document).on('touchmove.modernedgebars', function (e) {
        const originalEvent = e.originalEvent;
        if (!originalEvent.touches || originalEvent.touches.length !== 1) {
            if (modernTouchEdgeBars.titlebar.active) {
                hideModernTouchBar('titlebar');
            }

            if (modernTouchEdgeBars.taskbar.active) {
                hideModernTouchBar('taskbar');
            }

            return;
        }

        const touch = originalEvent.touches[0];
        const titlebarState = modernTouchEdgeBars.titlebar;
        const taskbarState = modernTouchEdgeBars.taskbar;

        if (titlebarState.active) {
            const revealAmount = Math.max(0, touch.clientY - titlebarState.startY);
            const horizontalDistance = Math.abs(touch.clientX - titlebarState.startX);

            if (horizontalDistance > MODERN_TOUCH_CANCEL_HORIZONTAL_THRESHOLD &&
                revealAmount < MODERN_TOUCH_TITLEBAR_OPEN_THRESHOLD) {
                hideModernTouchBar('titlebar');
                return;
            }

            applyModernTouchBarReveal('titlebar', revealAmount);
            e.preventDefault();
            return;
        }

        if (taskbarState.active) {
            const revealAmount = Math.max(0, taskbarState.startY - touch.clientY);
            const horizontalDistance = Math.abs(touch.clientX - taskbarState.startX);

            if (horizontalDistance > MODERN_TOUCH_CANCEL_HORIZONTAL_THRESHOLD &&
                revealAmount < MODERN_TOUCH_TASKBAR_OPEN_THRESHOLD) {
                hideModernTouchBar('taskbar');
                return;
            }

            applyModernTouchBarReveal('taskbar', revealAmount);
            e.preventDefault();
        }
    });

    $(document).on('touchend.modernedgebars touchcancel.modernedgebars', function () {
        const titlebarState = modernTouchEdgeBars.titlebar;
        const taskbarState = modernTouchEdgeBars.taskbar;

        if (titlebarState.active) {
            const shouldOpen = titlebarState.reveal >= MODERN_TOUCH_TITLEBAR_OPEN_THRESHOLD;
            titlebarState.active = false;

            if (shouldOpen) {
                showModernTouchBar('titlebar');
            } else {
                hideModernTouchBar('titlebar');
            }
        }

        if (taskbarState.active) {
            const shouldOpen = taskbarState.reveal >= MODERN_TOUCH_TASKBAR_OPEN_THRESHOLD;
            taskbarState.active = false;

            if (shouldOpen) {
                showModernTouchBar('taskbar');
            } else {
                hideModernTouchBar('taskbar');
            }
        }
    });
});

// Helper function to show intermediary screen with random duration
function showIntermediaryScreen(text, callback) {
    console.log('Showing intermediary screen:', text);

    const $intermediaryScreen = $('#intermediary-screen');
    const $intermediaryText = $('.intermediary-text');
    const $fadeToBlack = $('#fade-to-black');

    // Set the text
    $intermediaryText.text(text);

    // Lower fade-to-black z-index so interstitial appears on top
    $fadeToBlack.addClass('below-interstitial');

    // Show the screen
    $intermediaryScreen.addClass('visible');

    // Generate random duration between 1-4 seconds (in milliseconds)
    const minDuration = 1000;
    const maxDuration = 4000;
    const randomDuration = Math.floor(Math.random() * (maxDuration - minDuration + 1)) + minDuration;

    console.log('Intermediary screen will show for:', randomDuration, 'ms');

    // Execute callback after random duration
    setTimeout(function () {
        if (callback) {
            callback();
        }
        // Hide intermediary screen after callback completes
        setTimeout(function () {
            $intermediaryScreen.removeClass('visible');
            // Restore fade-to-black z-index
            $fadeToBlack.removeClass('below-interstitial');
        }, 100);
    }, randomDuration);
}

// Sleep system - black out screen until cursor moves
function sleepSystem() {
    console.log('Sleep: Creating sleep overlay');

    // Close modern flyout first
    closeModernFlyout();
    hideCharmsBar();

    // Create sleep overlay
    const $sleepOverlay = $('<div id="sleep-overlay"></div>');
    $sleepOverlay.css({
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        backgroundColor: '#000',
        zIndex: 999999,
        cursor: 'none'
    });

    $('body').append($sleepOverlay);

    // Wake up on mouse move
    const wakeUp = function () {
        console.log('Sleep: Waking up system');
        $sleepOverlay.remove();
        $(document).off('mousemove', wakeUp);
    };

    $(document).on('mousemove', wakeUp);

    console.log('Sleep: System is sleeping');
}

function requestHostAppQuit() {
    if (!electronIpc || typeof electronIpc.send !== 'function') {
        return false;
    }

    electronIpc.send('shell:quit-app');
    return true;
}

function handleSystemPowerAction(action, sourceLabel = 'Power menu') {
    switch (action) {
        case 'sleep':
            console.log(`${sourceLabel}: Putting system to sleep...`);
            sleepSystem();
            return true;
        case 'shut-down':
            console.log(`${sourceLabel}: Shutting down...`);
            shutDownSystem();
            return true;
        case 'restart':
            console.log(`${sourceLabel}: Restarting...`);
            restartSystem();
            return true;
        default:
            console.warn(`${sourceLabel}: Unsupported power action:`, action);
            return false;
    }
}

// Shut down system - show intermediary screen, fade to black, then quit app
function shutDownSystem() {
    console.log('Shut Down: Starting shutdown sequence');

    // Close modern flyout first
    closeModernFlyout();
    hideCharmsBar();

    // Show intermediary screen with "Shutting down" text
    showIntermediaryScreen('Shutting down', function () {
        console.log('Shut Down: Fading to black...');

        // Fade to black
        const $fadeToBlack = $('#fade-to-black');
        $fadeToBlack.addClass('visible');

        // Wait for fade animation to complete, then quit on the black screen
        setTimeout(async function () {
            console.log('Shut Down: Shutdown flow complete');

            if (requestHostAppQuit()) {
                return;
            }

            console.log('Shut Down: Electron IPC unavailable - falling back to window.close()');
            window.close();

            // Fallback if window.close() doesn't work (browser security)
            setTimeout(async function () {
                await systemDialog.info('Please close this tab manually to shut down.', 'Shut Down Windows');
            }, 100);
        }, 500); // Wait for fade animation
    });
}

// Restart system - show intermediary screen, fade to black, then refresh the page
function restartSystem() {
    console.log('Restart: Starting restart sequence');

    // Close modern flyout first
    closeModernFlyout();
    hideCharmsBar();

    // Show intermediary screen with "Restarting" text
    showIntermediaryScreen('Restarting', function () {
        console.log('Restart: Fading to black...');

        // Fade to black
        const $fadeToBlack = $('#fade-to-black');
        $fadeToBlack.addClass('visible');

        // Wait for fade animation to complete, then reload
        setTimeout(function () {
            console.log('Restart: Reloading page');
            location.reload();
        }, 500); // Wait for fade animation
    });
}

// Expose app control functions globally for taskbar context menu
window.closeModernApp = closeModernApp;
window.closeClassicApp = closeClassicApp;
window.minimizeModernApp = minimizeModernApp;
window.minimizeClassicWindow = minimizeClassicWindow;
window.restoreModernApp = restoreModernApp;
window.restoreClassicWindow = restoreClassicWindow;
window.launchApp = launchApp;
window.closeStartScreen = closeStartScreen;
window.updateClassicWindowTitle = updateClassicWindowTitle;
