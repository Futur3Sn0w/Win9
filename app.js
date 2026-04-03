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
const buildInfoModule = require('./components/shell/build-info.js');
const { getRepositoryBuildInfo, formatCompositeVersion } = buildInfoModule;
const { pathToFileURL: appPathToFileURL } = require('url');

let electronIpc = null;
let electronScreen = null;
let electronWebFrame = null;
const APP_RECYCLE_BIN_APP_ID = 'recycle-bin';
try {
    ({ ipcRenderer: electronIpc, screen: electronScreen, webFrame: electronWebFrame } = require('electron'));
} catch (error) {
    console.debug('[App] ipcRenderer unavailable:', error.message || error);
}

if (typeof window !== 'undefined') {
    if (electronIpc && !window.Win8ElectronBridge) {
        window.Win8ElectronBridge = {
            invoke(channel, ...args) {
                return electronIpc.invoke(channel, ...args);
            },
            send(channel, ...args) {
                return electronIpc.send(channel, ...args);
            },
            on(channel, listener) {
                return electronIpc.on(channel, listener);
            },
            once(channel, listener) {
                return electronIpc.once(channel, listener);
            },
            removeListener(channel, listener) {
                return electronIpc.removeListener(channel, listener);
            }
        };
    }

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

    window.BuildInfoAPI = window.BuildInfoAPI || {};
    Object.assign(window.BuildInfoAPI, buildInfoModule);
}

const repositoryBuildInfo = getRepositoryBuildInfo();
const pendingClassicWindowLaunchOptions = new Map();

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

function getShellHostWallpaperService() {
    const contexts = [window, window.parent, window.top];
    for (const ctx of contexts) {
        try {
            if (ctx && ctx.ShellHostWallpaper) {
                return ctx.ShellHostWallpaper;
            }
        } catch (error) {
            console.warn('[App] Could not access ShellHostWallpaper service:', error);
        }
    }

    return null;
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

const HOSTED_VIEW_POINTER_LOCK_BODY_CLASS = 'shell-overlay-hosted-view-lock';
const DESKTOP_MODERN_TASKBAR_PEEK_BODY_CLASS = 'desktop-modern-taskbar-peek';
const PRIMARY_POINTER_COARSE_BODY_CLASS = 'primary-pointer-coarse';
const TOUCH_CAPABLE_BODY_CLASS = 'touch-capable';
const TASK_VIEW_TOUCH_ENABLED_BODY_CLASS = 'task-view-touch-enabled';
const CHARMS_MOUSE_TRIGGERS_SUSPENDED_BODY_CLASS = 'charms-mouse-triggers-suspended';
const CHARMS_TITLEBAR_GESTURE_GUARD_BODY_CLASS = 'charms-titlebar-gesture-guard';
const SHELL_OVERLAY_VISIBILITY_RULES = [
    {
        selector: '#start-menu',
        matches: (element) => element.classList.contains('visible') || document.body?.classList.contains('start-menu-open')
    },
    {
        selector: '.modern-dropdown',
        matches: (element) => element.classList.contains('active')
    },
    {
        selector: '.context-menu',
        matches: (element) => element.classList.contains('active')
    },
    {
        selector: '.classic-context-menu',
        matches: (element) => isShellOverlayElementDisplayed(element)
    },
    {
        selector: '.desktop-context-menu',
        matches: (element) => isShellOverlayElementDisplayed(element)
    },
    {
        selector: '.taskbar-item-context-menu',
        matches: (element) =>
            element.classList.contains('visible') ||
            element.classList.contains('exiting') ||
            isShellOverlayElementDisplayed(element)
    },
    {
        selector: '.taskbar',
        matches: (element) =>
            document.body?.classList.contains('taskbar-peek') ||
            document.body?.classList.contains(DESKTOP_MODERN_TASKBAR_PEEK_BODY_CLASS) ||
            element.classList.contains('touch-visible') ||
            element.classList.contains('touch-pinned') ||
            element.classList.contains('touch-dragging')
    },
    {
        selector: '.modern-app-titlebar',
        matches: (element) =>
            element.classList.contains('touch-visible') ||
            element.classList.contains('touch-pinned') ||
            element.classList.contains('touch-dragging')
    },
    {
        selector: '.modern-desktop-window-titlebar',
        matches: (element) =>
            element.classList.contains('edge-visible') ||
            element.classList.contains('touch-visible') ||
            element.classList.contains('touch-pinned') ||
            element.classList.contains('touch-dragging')
    },
    {
        selector: '.classic-flyout',
        matches: (element) => element.classList.contains('visible') || element.classList.contains('closing')
    },
    {
        selector: '.modern-flyout',
        matches: (element) => element.classList.contains('visible') || element.classList.contains('closing')
    },
    {
        selector: '.six-pack-slider-popup',
        matches: (element) =>
            element.classList.contains('visible') ||
            element.classList.contains('closing') ||
            element.getAttribute('aria-hidden') === 'false'
    },
    {
        selector: '#notification-center-panel',
        matches: (element) =>
            element.classList.contains('visible') ||
            element.classList.contains('closing') ||
            element.getAttribute('aria-hidden') === 'false'
    },
    {
        selector: '#search-panel',
        matches: (element) =>
            element.classList.contains('visible') ||
            element.classList.contains('closing') ||
            element.getAttribute('aria-hidden') === 'false'
    },
    {
        selector: '#tray-overflow-popup',
        matches: (element) =>
            element.classList.contains('visible') ||
            element.classList.contains('closing') ||
            element.getAttribute('aria-hidden') === 'false'
    },
    {
        selector: '.charms-bar',
        matches: (element) => element.classList.contains('visible')
    },
    {
        selector: '.tdbn-panel',
        matches: (element) => element.classList.contains('visible')
    }
];

let hostedViewPointerLockUpdateScheduled = false;
let charmsMouseTriggersUnlocked = false;
let lastKnownCharmsPrimaryPointerCoarse = null;
let charmsTriggerAvailabilityUpdateScheduled = false;

function isElementVisibleForCharmsGuard(element) {
    if (!element || !element.isConnected) {
        return false;
    }

    const computedStyle = window.getComputedStyle(element);
    if (computedStyle.display === 'none' || computedStyle.visibility === 'hidden') {
        return false;
    }

    const rect = element.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0;
}

function isElementHoveredForCharmsGuard(element) {
    if (!element || typeof element.matches !== 'function') {
        return false;
    }

    try {
        return element.matches(':hover');
    } catch (error) {
        return false;
    }
}

function getActiveDesktopModernMetroContainerElement() {
    const containers = Array.from(document.querySelectorAll('.modern-desktop-app-container.metro-mode'))
        .filter(isElementVisibleForCharmsGuard);

    return containers.find((element) => element.classList.contains('active')) ||
        containers[containers.length - 1] ||
        null;
}

function isModernTitlebarShowingForCharmsGuard(titlebarElement, triggerElement, options = {}) {
    if (!isElementVisibleForCharmsGuard(titlebarElement)) {
        return false;
    }

    if (options.includeEdgeVisible && titlebarElement.classList.contains('edge-visible')) {
        return true;
    }

    if (
        titlebarElement.classList.contains('touch-visible') ||
        titlebarElement.classList.contains('touch-pinned') ||
        titlebarElement.classList.contains('touch-dragging')
    ) {
        return true;
    }

    return isElementHoveredForCharmsGuard(titlebarElement) || isElementHoveredForCharmsGuard(triggerElement);
}

function isFullscreenMetroTitlebarShowingForCharmsGuard() {
    if (!document.body) {
        return false;
    }

    if (document.body.classList.contains('view-modern')) {
        const activeContainer = document.querySelector('.modern-app-container.active');
        if (!isElementVisibleForCharmsGuard(activeContainer)) {
            return false;
        }

        return isModernTitlebarShowingForCharmsGuard(
            activeContainer.querySelector('.modern-app-titlebar'),
            activeContainer.querySelector('.modern-app-titlebar-trigger')
        );
    }

    if (document.body.classList.contains('desktop-modern-metro-mode')) {
        const activeContainer = getActiveDesktopModernMetroContainerElement();
        if (!activeContainer) {
            return false;
        }

        return isModernTitlebarShowingForCharmsGuard(
            activeContainer.querySelector('.modern-desktop-window-titlebar'),
            activeContainer.querySelector('.modern-desktop-window-titlebar-trigger'),
            { includeEdgeVisible: true }
        );
    }

    return false;
}

function updateCharmsTriggerAvailabilityState() {
    if (!document.body) {
        return false;
    }

    const isPrimaryPointerCoarse = document.body.classList.contains(PRIMARY_POINTER_COARSE_BODY_CLASS);
    const mouseTriggersSuspended = isPrimaryPointerCoarse && !charmsMouseTriggersUnlocked;
    const titlebarGestureGuard = isFullscreenMetroTitlebarShowingForCharmsGuard();

    document.body.classList.toggle(CHARMS_MOUSE_TRIGGERS_SUSPENDED_BODY_CLASS, mouseTriggersSuspended);
    document.body.classList.toggle(CHARMS_TITLEBAR_GESTURE_GUARD_BODY_CLASS, titlebarGestureGuard);

    if (titlebarGestureGuard &&
        document.querySelector('.charms-bar.visible:not(.show-background)')) {
        hideCharmsBar();
    }

    return mouseTriggersSuspended || titlebarGestureGuard;
}

function scheduleCharmsTriggerAvailabilityUpdate() {
    if (charmsTriggerAvailabilityUpdateScheduled) {
        return;
    }

    charmsTriggerAvailabilityUpdateScheduled = true;
    const scheduleFrame = typeof window.requestAnimationFrame === 'function'
        ? window.requestAnimationFrame.bind(window)
        : (callback) => setTimeout(callback, 16);

    scheduleFrame(() => {
        charmsTriggerAvailabilityUpdateScheduled = false;
        updateCharmsTriggerAvailabilityState();
    });
}

function syncCharmsMouseTriggerModeToPrimaryPointer() {
    if (!document.body) {
        return;
    }

    const isPrimaryPointerCoarse = document.body.classList.contains(PRIMARY_POINTER_COARSE_BODY_CLASS);
    if (lastKnownCharmsPrimaryPointerCoarse === isPrimaryPointerCoarse) {
        scheduleCharmsTriggerAvailabilityUpdate();
        return;
    }

    lastKnownCharmsPrimaryPointerCoarse = isPrimaryPointerCoarse;
    charmsMouseTriggersUnlocked = !isPrimaryPointerCoarse;
    scheduleCharmsTriggerAvailabilityUpdate();
}

function handleCharmsPointerMouseActivity() {
    if (!document.body) {
        return;
    }

    if (document.body.classList.contains(PRIMARY_POINTER_COARSE_BODY_CLASS) && !charmsMouseTriggersUnlocked) {
        charmsMouseTriggersUnlocked = true;
    }

    scheduleCharmsTriggerAvailabilityUpdate();
}

function handleCharmsNonMouseInputActivity() {
    if (!document.body) {
        return;
    }

    if (document.body.classList.contains(PRIMARY_POINTER_COARSE_BODY_CLASS)) {
        charmsMouseTriggersUnlocked = false;
    }

    scheduleCharmsTriggerAvailabilityUpdate();
}

function isShellOverlayElementDisplayed(element) {
    if (!element || !element.isConnected) {
        return false;
    }

    const computedStyle = window.getComputedStyle(element);
    if (computedStyle.display === 'none' || computedStyle.visibility === 'hidden') {
        return false;
    }

    const isExplicitlyOpen =
        element.classList.contains('visible') ||
        element.classList.contains('active') ||
        element.classList.contains('closing') ||
        element.classList.contains('exiting');

    if (!isExplicitlyOpen && Number(computedStyle.opacity) === 0) {
        return false;
    }

    const rect = element.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0;
}

function isAnyShellOverlayVisible() {
    return SHELL_OVERLAY_VISIBILITY_RULES.some(({ selector, matches }) => {
        const elements = document.querySelectorAll(selector);
        for (const element of elements) {
            if (matches(element)) {
                return true;
            }
        }
        return false;
    });
}

function updateHostedViewPointerLockState() {
    if (!document.body) {
        return false;
    }

    const shouldLock = isAnyShellOverlayVisible();
    document.body.classList.toggle(HOSTED_VIEW_POINTER_LOCK_BODY_CLASS, shouldLock);
    return shouldLock;
}

function scheduleHostedViewPointerLockUpdate() {
    if (hostedViewPointerLockUpdateScheduled) {
        return;
    }

    hostedViewPointerLockUpdateScheduled = true;
    const scheduleFrame = typeof window.requestAnimationFrame === 'function'
        ? window.requestAnimationFrame.bind(window)
        : (callback) => setTimeout(callback, 16);

    scheduleFrame(() => {
        hostedViewPointerLockUpdateScheduled = false;
        updateHostedViewPointerLockState();
    });
}

function initHostedViewPointerLockObserver() {
    if (!document.body) {
        return;
    }

    updateHostedViewPointerLockState();

    if (typeof MutationObserver === 'undefined') {
        return;
    }

    const observer = new MutationObserver(() => {
        scheduleHostedViewPointerLockUpdate();
    });

    observer.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'aria-hidden']
    });
}

function updatePrimaryPointerBodyState() {
    if (!document.body || typeof window.matchMedia !== 'function') {
        return false;
    }

    const isPrimaryPointerCoarse = window.matchMedia('(pointer: coarse)').matches;
    const isTouchCapable =
        window.matchMedia('(any-pointer: coarse)').matches ||
        (typeof navigator !== 'undefined' && Number(navigator.maxTouchPoints) > 0);

    document.body.classList.toggle(PRIMARY_POINTER_COARSE_BODY_CLASS, isPrimaryPointerCoarse);
    document.body.classList.toggle(TOUCH_CAPABLE_BODY_CLASS, isTouchCapable);
    syncCharmsMouseTriggerModeToPrimaryPointer();
    return isPrimaryPointerCoarse;
}

function initPrimaryPointerObserver() {
    if (!document.body || typeof window.matchMedia !== 'function') {
        return;
    }

    const mediaQuery = window.matchMedia('(pointer: coarse)');
    const applyState = () => {
        updatePrimaryPointerBodyState();
    };

    applyState();

    if (typeof mediaQuery.addEventListener === 'function') {
        mediaQuery.addEventListener('change', applyState);
    } else if (typeof mediaQuery.addListener === 'function') {
        mediaQuery.addListener(applyState);
    }
}

if (typeof window !== 'undefined') {
    window.updateHostedViewPointerLockState = updateHostedViewPointerLockState;
    window.scheduleHostedViewPointerLockUpdate = scheduleHostedViewPointerLockUpdate;
    window.updatePrimaryPointerBodyState = updatePrimaryPointerBodyState;
    window.scheduleCharmsTriggerAvailabilityUpdate = scheduleCharmsTriggerAvailabilityUpdate;
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initHostedViewPointerLockObserver, { once: true });
        document.addEventListener('DOMContentLoaded', initPrimaryPointerObserver, { once: true });
    } else {
        initHostedViewPointerLockObserver();
        initPrimaryPointerObserver();
    }
}

// View management
let views = {};
let currentView = 'boot';
let viewBeforeLock = null; // Track which view the user was on before locking
let startReturnModernAppId = null;
let explorerShellRestartInProgress = false;

const EXPLORER_SHELL_RESTART_FADE_MS = 280;
const EXPLORER_SHELL_RESTART_BLACKOUT_MS = 140;
const SOFT_RELOAD_TEMPLATE_SELECTORS = [
    '#boot-screen',
    '#lock-screen',
    '#login-screen',
    '#signing-in-screen',
    '#intermediary-screen',
    '#taskbar-context-menu',
    '#quick-links-menu',
    '#app-context-menu'
];

let bootSequenceTimer = null;
let bootTransitionTimer = null;
let bootSequenceCompleted = false;
let pendingSkipBoot = false;
const BOOT_SEQUENCE_MIN_MS = 2000;
const BOOT_SEQUENCE_MAX_MS = 8000;

function createDeferred() {
    let resolve;
    const promise = new Promise((res) => {
        resolve = res;
    });

    return {
        promise,
        resolve
    };
}

const bootWarmupReady = createDeferred();
const shellStartupReady = createDeferred();

function refreshViewRegistry() {
    views = {
        boot: $('#boot-screen'),
        lock: $('#lock-screen'),
        login: $('#login-screen'),
        signingIn: $('#signing-in-screen'),
        start: $('#start-screen'),
        desktop: $('#desktop')
    };
}

// Helper function to update current view and body class
function setCurrentView(viewName) {
    if (viewName !== 'desktop') {
        closeTaskViewPlaceholder();
    }

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

    if (typeof updateTaskViewTouchGestureAvailability === 'function') {
        updateTaskViewTouchGestureAvailability();
    }

    scheduleCharmsTriggerAvailabilityUpdate();
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

async function transitionFromBootWhenReady($fadeToBlack) {
    await Promise.race([
        Promise.allSettled([
            waitForDuration(BOOT_SEQUENCE_MIN_MS),
            bootWarmupReady.promise,
            shellStartupReady.promise
        ]),
        waitForDuration(BOOT_SEQUENCE_MAX_MS)
    ]);

    if (bootSequenceCompleted) {
        return;
    }

    startBootTransition($fadeToBlack, false);
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
const TASKBAR_SHOW_NOTIFICATION_CENTER_ICON_VALUE_NAME = 'ShowNotificationCenterIcon';
const TASKBAR_SHOW_USER_TILE_VALUE_NAME = 'ShowUserTile';
const TASKBAR_MODERN_CLOCK_POPUP_VALUE_NAME = 'UseModernClockPopup';
const TASKBAR_MODERN_VOLUME_POPUP_VALUE_NAME = 'MTCUVC';
const TASKBAR_USE_MODERN_WINDOW_STYLING_VALUE_NAME = 'UseModernWindowStyling';
const TASKBAR_THRESHOLD_FEATURES_ENABLED_VALUE_NAME = 'ThresholdFeaturesEnabled';
const TASKBAR_CONTINUUM_BETA_ENABLED_VALUE_NAME = 'ContinuumBetaEnabled';
const TASKBAR_CONTINUUM_SHELL_MODE_VALUE_NAME = 'ContinuumShellMode';
const TASKBAR_OPEN_METRO_APPS_ON_DESKTOP_VALUE_NAME = 'OpenMetroAppsOnDesktop';
const TASKBAR_DESKTOP_WATERMARK_VALUE_NAME = 'ShowDesktopWatermark';
const THRESHOLD_PENDING_SETTINGS_PATH = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\PendingThresholdSettings';
const THRESHOLD_PENDING_SIGN_OUT_VALUE_NAME = 'PendingSignOut';
const THRESHOLD_PENDING_SETTING_KEYS = [
    'thresholdFeaturesEnabled',
    'useStartMenu',
    'showSearchButton',
    'showTaskViewButton',
    'showNotificationCenterIcon',
    'useModernClockPopup',
    'useModernVolumePopup',
    'continuumBetaEnabled',
    'openMetroAppsOnDesktop',
    'useModernWindowStyling',
    'showDesktopWatermark'
];
const THRESHOLD_SIGN_OUT_REQUIRED_SETTING_KEYS = new Set([
    'thresholdFeaturesEnabled',
    'useStartMenu',
    'continuumBetaEnabled',
    'openMetroAppsOnDesktop'
]);
const TASKBAR_SHELL_BUTTON_ICON_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128];
const TASKBAR_SHELL_BUTTON_RESOURCE_SCALE = 2;
const THRESHOLD_DESKTOP_WATERMARK_DETAILS = {
    productName: 'Windows Technical Preview',
    baseVersion: '6.4',
    buildText: 'Evaluation copy. Build 9999'
};
const NOTIFICATION_CENTER_ICON_SIZES = {
    none: [26, 34, 46, 61],
    new: [27, 34, 46, 61],
    dnd: [26, 34, 46, 61]
};
const NOTIFICATION_CENTER_RESOURCE_SCALE = 1;
const USER_TILE_FRAME_ASSETS = [
    { size: 64, path: 'resources/images/usertile_frames/frame@1x.png', innerInset: 9 },
    { size: 80, path: 'resources/images/usertile_frames/frame@2x.png', innerInset: 11 },
    { size: 96, path: 'resources/images/usertile_frames/frame@3x.png', innerInset: 13 }
];
const USER_TILE_PANEL_FRAME_RENDER_SIZE = 64;
const NOTIFICATION_CENTER_MAX_ITEMS = 50;
const NOTIFICATION_CENTER_DRAG_THRESHOLD = 8;
const NOTIFICATION_CENTER_DISMISS_THRESHOLD = 150;
const NOTIFICATION_CENTER_CLOSE_ANIMATION_MS = 220;
const SEARCH_PANEL_CLOSE_ANIMATION_MS = 220;
const SEARCH_PANEL_STORAGE_KEY = 'win8-search-last-query';
const SEARCH_PANEL_RESULT_LIMIT = 7;
const SEARCH_FLYOUT_RESULT_LIMIT = 7;
const SEARCH_APP_RESULT_LIMIT = 48;
const SEARCH_PANEL_SPLASH_HOLD_MS = 1500;
const SEARCH_PANEL_SPLASH_FADE_MS = 400;
const CONTINUUM_PROMPT_AUTO_DISMISS_MS = 20000;
const CONTINUUM_PROMPT_HIDE_ANIMATION_MS = 220;
const CONTINUUM_PROMPT_SIGN_IN_DEFER_MS = 2200;
const CONTINUUM_SHELL_MODE_TRANSITION_MS = 240;
const CONTINUUM_START_SURFACE_AUTO_OPEN_DEFER_MS = 650;
const START_MENU_SWAP_CLOSE_MS = 160;
const THRESHOLD_BOOT_LOGO_PATH = 'resources/images/betta.svg';
const WINDOWS_BOOT_LOGO_BITMAPS = [
    { width: 82, height: 72, path: 'resources/images/boot/82x72.bmp' },
    { width: 102, height: 90, path: 'resources/images/boot/102x90.bmp' },
    { width: 129, height: 115, path: 'resources/images/boot/129x115.bmp' },
    { width: 242, height: 214, path: 'resources/images/boot/242x214.bmp' },
    { width: 321, height: 284, path: 'resources/images/boot/321x284.bmp' }
];
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
promotePendingThresholdSignOutChangesForStartup();
let taskbarAutoHideEnabled = loadTaskbarAutoHidePreference();
let taskbarHeight = loadTaskbarHeightPreference();
let taskbarUseSmallIcons = loadTaskbarSmallIconsPreference();
let taskbarShowSearchButton = loadTaskbarSearchButtonPreference();
let taskbarShowTaskViewButton = loadTaskbarTaskViewButtonPreference();
let taskbarShowNotificationCenterIcon = loadTaskbarNotificationCenterIconPreference();
let taskbarShowUserTile = loadTaskbarUserTilePreference();
let taskbarUseModernClockPopup = loadModernClockPopupPreference();
let taskbarUseModernVolumePopup = loadModernVolumePopupPreference();
let taskbarUseModernWindowStyling = loadModernWindowStylingPreference();
let thresholdFeaturesEnabled = loadThresholdFeaturesEnabledPreference();
let continuumBetaEnabled = loadContinuumBetaPreference();
let taskbarOpenMetroAppsOnDesktop = loadDesktopModernAppsPreference();
let desktopWatermarkEnabled = loadDesktopWatermarkPreference();
let taskbarLocked = loadTaskbarLockedPreference();
let taskViewPlaceholderOpen = false;
let notificationCenterQuietHoursEnabled = false;
let notificationCenterUnreadCount = 0;
let notificationCenterItems = [];
let notificationCenterCloseTimer = null;
let continuumShellMode = loadContinuumShellModePreference();
let lastContinuumPostureMode = null;
let continuumPromptBehavior = 'ask';
let continuumPromptTargetMode = null;
let continuumPromptDismissTimer = null;
let continuumPromptHideTimer = null;
let continuumPromptDeferredShowTimer = null;
let continuumBackDismissTimer = null;
let continuumBackRippleTimer = null;
let startMenuSwapReopenTimer = null;
let continuumPromptMismatchCheckTimer = null;
let continuumPromptDeferredUntil = 0;
let continuumShellTransitionTimer = null;
let continuumStartSurfaceAutoOpenTimer = null;
let searchPanelOpen = false;
let searchPanelHasShownSplash = false;
let searchPanelSelectedIndex = -1;
let searchPanelResults = [];
let searchPanelControlPanelAppletCatalog = [];
let searchPanelSettingsCatalog = [];
let searchPanelDesktopEntries = [];
let searchPanelAppletCatalogPromise = null;
let searchPanelSettingsCatalogPromise = null;
let searchPanelDesktopEntriesPromise = null;
let searchPanelSplashShowTimer = null;
let searchPanelSplashHideTimer = null;
let searchPanelFocusTimer = null;
let searchPanelCloseTimer = null;
let searchPanelRequestToken = 0;
let searchFlyoutResults = [];
let searchFlyoutSelectedIndex = -1;
let searchFlyoutRequestToken = 0;
let notificationCenterDragState = {
    active: false,
    pointerId: null,
    startX: 0,
    currentX: 0,
    hasDragged: false,
    itemId: null,
    element: null,
    dismissTimer: null,
    suppressClickId: null
};
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

function sendRunningAppMessage(appId, payload, attemptsRemaining = 20) {
    const runningApp = AppsManager.getRunningApp(appId);
    const frame = runningApp?.$container?.find('iframe')[0];

    if (frame && frame.contentWindow) {
        frame.contentWindow.postMessage(payload, '*');
        return true;
    }

    if (attemptsRemaining <= 0) {
        console.warn('Unable to send message to app:', appId, payload);
        return false;
    }

    setTimeout(() => {
        sendRunningAppMessage(appId, payload, attemptsRemaining - 1);
    }, 150);

    return false;
}

function openSettingsCategory(categoryId, itemId = null) {
    if (!categoryId) {
        return;
    }

    const settingsApp = AppsManager.getAppById('settings');
    if (!settingsApp) {
        console.warn('Settings app is not available for category launch:', categoryId, itemId);
        return;
    }

    launchApp(settingsApp, null, { fromTaskbar: true });
    sendRunningAppMessage('settings', {
        action: 'openSettingsCategory',
        categoryId,
        itemId
    });
}

if (typeof window !== 'undefined') {
    window.openControlPanelApplet = openControlPanelApplet;
    window.openSettingsCategory = openSettingsCategory;
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
setTaskbarNotificationCenterIconVisible(taskbarShowNotificationCenterIcon, { persist: false });
setTaskbarUserTileVisible(taskbarShowUserTile, { persist: false });
setModernClockPopupEnabled(taskbarUseModernClockPopup, { persist: false });
setModernVolumePopupEnabled(taskbarUseModernVolumePopup, { persist: false });
setModernWindowStylingEnabled(taskbarUseModernWindowStyling, { persist: false });
setDesktopWatermarkEnabled(desktopWatermarkEnabled, { persist: false });

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

function loadTaskbarStringPreference(valueName, fallback = '') {
    try {
        const registry = getRegistry();
        const value = registry.getValue(TASKBAR_ADVANCED_PATH, valueName, fallback);
        return typeof value === 'string' ? value : fallback;
    } catch (error) {
        console.error(`Failed to load taskbar string preference for ${valueName}:`, error);
        return fallback;
    }
}

function persistTaskbarStringPreference(valueName, value) {
    try {
        const registry = getRegistry();
        registry.setValue(TASKBAR_ADVANCED_PATH, valueName, String(value || ''), RegistryType.REG_SZ);
    } catch (error) {
        console.error(`Failed to persist taskbar string preference for ${valueName}:`, error);
    }
}

function loadPendingThresholdSettingsSnapshot() {
    const snapshot = {
        pending: false,
        values: {}
    };

    try {
        const registry = getRegistry();
        snapshot.pending = Number(
            registry.getValue(THRESHOLD_PENDING_SETTINGS_PATH, THRESHOLD_PENDING_SIGN_OUT_VALUE_NAME, 0)
        ) !== 0;

        THRESHOLD_PENDING_SETTING_KEYS.forEach(key => {
            const value = registry.getValue(THRESHOLD_PENDING_SETTINGS_PATH, key, null);
            if (value === null || value === undefined) {
                return;
            }

            snapshot.values[key] = Number(value) !== 0;
        });
    } catch (error) {
        console.error('Failed to load pending Threshold settings snapshot:', error);
    }

    return snapshot;
}

function replacePendingThresholdSignOutChanges(pendingValues) {
    try {
        const registry = getRegistry();
        const normalized = {};

        THRESHOLD_PENDING_SETTING_KEYS.forEach(key => {
            if (Object.prototype.hasOwnProperty.call(pendingValues, key)) {
                normalized[key] = !!pendingValues[key];
            }
        });

        THRESHOLD_PENDING_SETTING_KEYS.forEach(key => {
            registry.deleteValue(THRESHOLD_PENDING_SETTINGS_PATH, key);
        });

        const hasPending = Object.keys(normalized).length > 0;

        if (hasPending) {
            Object.entries(normalized).forEach(([key, value]) => {
                registry.setValue(
                    THRESHOLD_PENDING_SETTINGS_PATH,
                    key,
                    value ? 1 : 0,
                    RegistryType.REG_DWORD
                );
            });
            registry.setValue(
                THRESHOLD_PENDING_SETTINGS_PATH,
                THRESHOLD_PENDING_SIGN_OUT_VALUE_NAME,
                1,
                RegistryType.REG_DWORD
            );
        } else {
            registry.deleteValue(THRESHOLD_PENDING_SETTINGS_PATH, THRESHOLD_PENDING_SIGN_OUT_VALUE_NAME);
        }
    } catch (error) {
        console.error('Failed to replace pending Threshold sign-out changes:', error);
    }
}

function persistThresholdSettingValueToRegistry(key, value) {
    const registry = getRegistry();

    switch (key) {
        case 'thresholdFeaturesEnabled':
            registry.setValue(
                TASKBAR_ADVANCED_PATH,
                TASKBAR_THRESHOLD_FEATURES_ENABLED_VALUE_NAME,
                value ? 1 : 0,
                RegistryType.REG_DWORD
            );
            return true;
        case 'useStartMenu':
            registry.setValue(
                REGISTRY_PATHS.startPage,
                'UseStartMenu',
                value ? 1 : 0,
                RegistryType.REG_DWORD
            );
            return true;
        case 'showSearchButton':
            registry.setValue(
                TASKBAR_ADVANCED_PATH,
                TASKBAR_SHOW_SEARCH_BUTTON_VALUE_NAME,
                value ? 1 : 0,
                RegistryType.REG_DWORD
            );
            return true;
        case 'showTaskViewButton':
            registry.setValue(
                TASKBAR_ADVANCED_PATH,
                TASKBAR_SHOW_TASK_VIEW_BUTTON_VALUE_NAME,
                value ? 1 : 0,
                RegistryType.REG_DWORD
            );
            return true;
        case 'showNotificationCenterIcon':
            registry.setValue(
                TASKBAR_ADVANCED_PATH,
                TASKBAR_SHOW_NOTIFICATION_CENTER_ICON_VALUE_NAME,
                value ? 1 : 0,
                RegistryType.REG_DWORD
            );
            return true;
        case 'useModernClockPopup':
            registry.setValue(
                TASKBAR_ADVANCED_PATH,
                TASKBAR_MODERN_CLOCK_POPUP_VALUE_NAME,
                value ? 1 : 0,
                RegistryType.REG_DWORD
            );
            return true;
        case 'useModernVolumePopup':
            registry.setValue(
                TASKBAR_ADVANCED_PATH,
                TASKBAR_MODERN_VOLUME_POPUP_VALUE_NAME,
                value ? 1 : 0,
                RegistryType.REG_DWORD
            );
            return true;
        case 'continuumBetaEnabled':
            registry.setValue(
                TASKBAR_ADVANCED_PATH,
                TASKBAR_CONTINUUM_BETA_ENABLED_VALUE_NAME,
                value ? 1 : 0,
                RegistryType.REG_DWORD
            );
            return true;
        case 'openMetroAppsOnDesktop':
            registry.setValue(
                TASKBAR_ADVANCED_PATH,
                TASKBAR_OPEN_METRO_APPS_ON_DESKTOP_VALUE_NAME,
                value ? 1 : 0,
                RegistryType.REG_DWORD
            );
            return true;
        case 'useModernWindowStyling':
            registry.setValue(
                TASKBAR_ADVANCED_PATH,
                TASKBAR_USE_MODERN_WINDOW_STYLING_VALUE_NAME,
                value ? 1 : 0,
                RegistryType.REG_DWORD
            );
            return true;
        case 'showDesktopWatermark':
            registry.setValue(
                TASKBAR_ADVANCED_PATH,
                TASKBAR_DESKTOP_WATERMARK_VALUE_NAME,
                value ? 1 : 0,
                RegistryType.REG_DWORD
            );
            return true;
        default:
            return false;
    }
}

function promotePendingThresholdSignOutChangesForStartup() {
    const pendingSnapshot = loadPendingThresholdSettingsSnapshot();
    if (!pendingSnapshot.pending && Object.keys(pendingSnapshot.values).length === 0) {
        return;
    }

    try {
        Object.entries(pendingSnapshot.values).forEach(([key, value]) => {
            persistThresholdSettingValueToRegistry(key, value);
        });
    } catch (error) {
        console.error('Failed to promote pending Threshold sign-out changes during startup:', error);
        return;
    }

    replacePendingThresholdSignOutChanges({});
}

function getLiveThresholdSettingsState() {
    return {
        thresholdFeaturesEnabled: !!thresholdFeaturesEnabled,
        useStartMenu: !!navigationSettings.useStartMenu,
        showSearchButton: !!taskbarShowSearchButton,
        showTaskViewButton: !!taskbarShowTaskViewButton,
        showNotificationCenterIcon: !!taskbarShowNotificationCenterIcon,
        useModernClockPopup: !!taskbarUseModernClockPopup,
        useModernVolumePopup: !!taskbarUseModernVolumePopup,
        continuumBetaEnabled: !!continuumBetaEnabled,
        openMetroAppsOnDesktop: !!taskbarOpenMetroAppsOnDesktop,
        useModernWindowStyling: !!taskbarUseModernWindowStyling,
        showDesktopWatermark: !!desktopWatermarkEnabled
    };
}

function getDesiredThresholdSettingsState() {
    const liveValues = getLiveThresholdSettingsState();
    const pendingSnapshot = loadPendingThresholdSettingsSnapshot();

    return {
        liveValues,
        pendingSnapshot,
        desiredValues: {
            ...liveValues,
            ...pendingSnapshot.values
        }
    };
}

function isContinuumBetaActive() {
    return thresholdFeaturesEnabled && continuumBetaEnabled;
}

function dispatchContinuumSettingsChanged() {
    if (typeof window === 'undefined' || !document.body) {
        return;
    }

    const detail = {
        thresholdFeaturesEnabled: !!thresholdFeaturesEnabled,
        continuumBetaEnabled: !!continuumBetaEnabled,
        enabled: isContinuumBetaActive()
    };

    document.body.classList.toggle('continuum-beta-enabled', detail.enabled);
    document.body.classList.toggle('continuum-beta-disabled', !detail.enabled);
    document.body.dataset.continuumBetaEnabled = detail.enabled ? 'true' : 'false';

    window.Win8ContinuumSettings = {
        thresholdFeaturesEnabled: detail.thresholdFeaturesEnabled,
        continuumBetaEnabled: detail.continuumBetaEnabled,
        enabled: detail.enabled,
        isEnabled() {
            return detail.enabled;
        }
    };

    console.log('[Continuum] Settings updated:', detail);

    window.dispatchEvent(new CustomEvent('win8-continuum-settings-changed', {
        detail
    }));
}

function normalizeContinuumShellMode(mode) {
    return mode === 'tablet' ? 'tablet' : 'desktop';
}

function isContinuumTabletShellMode() {
    return isContinuumBetaActive() && normalizeContinuumShellMode(continuumShellMode) === 'tablet';
}

function getContinuumPromptElement() {
    return document.getElementById('continuum-posture-prompt');
}

function getContinuumPromptRememberInput() {
    return document.getElementById('continuum-posture-prompt-remember');
}

function getContinuumBackTaskbarButton() {
    return document.querySelector('.taskbar-continuum-back-button');
}

function getContinuumPromptToggleTaskbarButton() {
    return document.getElementById('continuum-prompt-toggle-button');
}

function beginContinuumShellModeTransition() {
    if (typeof document === 'undefined' || !document.body) {
        return;
    }

    document.body.classList.add('continuum-shell-mode-transition');

    if (continuumShellTransitionTimer) {
        clearTimeout(continuumShellTransitionTimer);
    }

    continuumShellTransitionTimer = setTimeout(() => {
        if (document.body) {
            document.body.classList.remove('continuum-shell-mode-transition');
        }
        continuumShellTransitionTimer = null;
    }, CONTINUUM_SHELL_MODE_TRANSITION_MS);
}

function clearContinuumPromptTimers() {
    if (continuumPromptDismissTimer) {
        clearTimeout(continuumPromptDismissTimer);
        continuumPromptDismissTimer = null;
    }

    if (continuumPromptHideTimer) {
        clearTimeout(continuumPromptHideTimer);
        continuumPromptHideTimer = null;
    }

    if (continuumPromptDeferredShowTimer) {
        clearTimeout(continuumPromptDeferredShowTimer);
        continuumPromptDeferredShowTimer = null;
    }

    if (continuumPromptMismatchCheckTimer) {
        clearTimeout(continuumPromptMismatchCheckTimer);
        continuumPromptMismatchCheckTimer = null;
    }
}

function deferContinuumPromptDisplay(delayMs = CONTINUUM_PROMPT_SIGN_IN_DEFER_MS) {
    const nextDeferredUntil = Date.now() + Math.max(0, delayMs);
    continuumPromptDeferredUntil = Math.max(continuumPromptDeferredUntil, nextDeferredUntil);
    hideContinuumPosturePrompt({ immediate: true });
}

function getContinuumPromptDeferredDelay() {
    return Math.max(0, continuumPromptDeferredUntil - Date.now());
}

function reconcileContinuumPosturePromptForCurrentShellMode() {
    if (!isContinuumBetaActive()) {
        return false;
    }

    const postureState = window.Win8DevicePosture?.currentState || null;
    if (!postureState) {
        return false;
    }

    const targetMode = postureState.isTabletPosture ? 'tablet' : 'desktop';
    const currentMode = normalizeContinuumShellMode(continuumShellMode);

    if (currentMode === targetMode) {
        hideContinuumPosturePrompt({ immediate: true });
        return false;
    }

    if (continuumPromptBehavior === 'always') {
        setContinuumShellMode(targetMode);
        return true;
    }

    if (continuumPromptBehavior === 'never') {
        hideContinuumPosturePrompt({ immediate: true });
        return false;
    }

    showContinuumPosturePrompt(targetMode);
    return true;
}

function scheduleContinuumPromptMismatchCheck(delayMs = 0) {
    if (continuumPromptMismatchCheckTimer) {
        clearTimeout(continuumPromptMismatchCheckTimer);
    }

    continuumPromptMismatchCheckTimer = setTimeout(function () {
        continuumPromptMismatchCheckTimer = null;
        reconcileContinuumPosturePromptForCurrentShellMode();
    }, Math.max(0, delayMs));
}

function getEffectiveTaskbarHeight() {
    const baseHeight = Number.isFinite(taskbarHeight) ? taskbarHeight : 40;
    return isContinuumTabletShellMode()
        ? Math.max(baseHeight, 52)
        : baseHeight;
}

function clearPendingContinuumStartSurfaceAutoOpen() {
    if (continuumStartSurfaceAutoOpenTimer) {
        clearTimeout(continuumStartSurfaceAutoOpenTimer);
        continuumStartSurfaceAutoOpenTimer = null;
    }
}

function scheduleContinuumStartSurfaceAutoOpen(delayMs = CONTINUUM_START_SURFACE_AUTO_OPEN_DEFER_MS) {
    clearPendingContinuumStartSurfaceAutoOpen();

    continuumStartSurfaceAutoOpenTimer = setTimeout(function () {
        continuumStartSurfaceAutoOpenTimer = null;

        if (!isContinuumTabletShellMode() ||
            isStartSurfaceVisible() ||
            taskViewPlaceholderOpen ||
            currentView !== 'desktop' ||
            !$('#desktop').hasClass('visible') ||
            getVisibleContinuumDesktopWindows().length > 0) {
            return;
        }

        openStartSurface();
    }, Math.max(0, delayMs));

    return true;
}

function shouldRouteContinuumTabletDismissalToStartSurface(windowData) {
    if (!isContinuumTabletShellMode()) {
        return false;
    }

    const $container = windowData?.$container;
    const isModernDesktopInMetroMode = isModernDesktopWindowData(windowData) && 
                                       $container?.length && 
                                       $container.hasClass('metro-mode');
    const isClassicWindow = $container?.length && $container.hasClass('classic-app-container');

    return !!(isModernDesktopInMetroMode || isClassicWindow);
}

function maybeOpenContinuumStartSurfaceAfterDesktopModernDismissal() {
    if (!isContinuumTabletShellMode()) {
        return false;
    }

    if (getVisibleContinuumDesktopWindows().length > 0) {
        return false;
    }

    clearPendingContinuumStartSurfaceAutoOpen();
    openStartSurface();
    return true;
}

function maybeOpenContinuumStartSurfaceOnTabletEntry() {
    if (!isContinuumTabletShellMode() ||
        isStartSurfaceVisible() ||
        taskViewPlaceholderOpen ||
        currentView !== 'desktop' ||
        !$('#desktop').hasClass('visible')) {
        return false;
    }

    if (getVisibleContinuumDesktopWindows().length > 0) {
        clearPendingContinuumStartSurfaceAutoOpen();
        return false;
    }

    return scheduleContinuumStartSurfaceAutoOpen();
}

function shouldAutoOpenContinuumStartSurfaceOnSignIn() {
    if (!isContinuumBetaActive() || !isStartMenuEnabled()) {
        return false;
    }

    if (isContinuumTabletShellMode()) {
        return true;
    }

    return !!window.Win8DevicePosture?.currentState?.isTabletPosture;
}

function maybeOpenContinuumStartSurfaceOnSignIn() {
    if (!shouldAutoOpenContinuumStartSurfaceOnSignIn() ||
        isStartSurfaceVisible() ||
        taskViewPlaceholderOpen ||
        currentView !== 'desktop' ||
        !$('#desktop').hasClass('visible')) {
        return false;
    }

    setTimeout(function () {
        if (shouldAutoOpenContinuumStartSurfaceOnSignIn() &&
            !isStartSurfaceVisible() &&
            !taskViewPlaceholderOpen &&
            currentView === 'desktop' &&
            $('#desktop').hasClass('visible')) {
            openStartSurface();
        }
    }, 0);

    return true;
}

function primeContinuumStartSurfaceForSignIn() {
    if (!shouldAutoOpenContinuumStartSurfaceOnSignIn() ||
        isStartSurfaceVisible() ||
        taskViewPlaceholderOpen ||
        !isStartMenuEnabled()) {
        return false;
    }

    openStartMenu();
    return true;
}

function updateContinuumTaskbarControlsVisibility() {
    const continuumEnabled = isContinuumBetaActive();
    const tabletModeActive = isContinuumTabletShellMode();
    const backButton = getContinuumBackTaskbarButton();
    const promptToggleButton = getContinuumPromptToggleTaskbarButton();

    if (backButton) {
        const shouldBeHidden = !(continuumEnabled && tabletModeActive);
        const wasHidden = backButton.classList.contains('is-hidden') ||
            backButton.classList.contains('taskbar-back-exiting');
        if (shouldBeHidden !== wasHidden) {
            if (shouldBeHidden) {
                animateContinuumBackButtonOut(backButton);
            } else {
                animateContinuumBackButtonIn(backButton);
            }
        }
    }

    if (promptToggleButton) {
        promptToggleButton.classList.toggle('is-hidden', !continuumEnabled);
        const promptToggleGlyph = promptToggleButton.querySelector('.continuum-prompt-toggle-glyph');
        if (promptToggleGlyph) {
            promptToggleGlyph.classList.toggle('sui-enter-tablet', !tabletModeActive);
            promptToggleGlyph.classList.toggle('sui-exit-tablet', tabletModeActive);
        }
    }
}

function animateContinuumBackButtonIn(backButton) {
    clearTimeout(continuumBackDismissTimer);
    backButton.classList.remove('is-hidden', 'taskbar-back-exiting');
    backButton.classList.add('taskbar-back-entering');
    triggerContinuumBackRipple('in');
}

function animateContinuumBackButtonOut(backButton) {
    clearTimeout(continuumBackDismissTimer);
    backButton.classList.remove('taskbar-back-entering');
    backButton.classList.add('taskbar-back-exiting');
    triggerContinuumBackRipple('out');
    continuumBackDismissTimer = setTimeout(() => {
        backButton.classList.remove('taskbar-back-exiting');
        backButton.classList.add('is-hidden');
    }, 200);
}

function triggerContinuumBackRipple(direction) {
    const candidates = [
        document.querySelector('.taskbar-search-button'),
        document.querySelector('.taskbar-task-view-button'),
        document.querySelector('.taskbar-apps')
    ];
    const targets = candidates.filter(el => el && !el.classList.contains('is-hidden'));
    const magnitudes = direction === 'in' ? [7, 5, 3] : [4, 3, 2];

    targets.forEach((el, i) => {
        el.classList.remove('taskbar-ripple-nudge');
        void el.offsetWidth;
        el.style.setProperty('--ripple-delay', `${30 + i * 30}ms`);
        el.style.setProperty('--ripple-magnitude', `${magnitudes[Math.min(i, magnitudes.length - 1)]}px`);
        el.classList.add('taskbar-ripple-nudge');
    });

    clearTimeout(continuumBackRippleTimer);
    continuumBackRippleTimer = setTimeout(() => {
        for (const el of candidates) {
            if (!el) continue;
            el.classList.remove('taskbar-ripple-nudge');
            el.style.removeProperty('--ripple-delay');
            el.style.removeProperty('--ripple-magnitude');
        }
    }, 400);
}

function getVisibleContinuumDesktopWindows() {
    if (!window.AppsManager || typeof AppsManager.getRunningWindowsSnapshot !== 'function') {
        return [];
    }

    return AppsManager.getRunningWindowsSnapshot()
        .filter(function (runningWindow) {
            const $container = runningWindow?.$container;
            return !!($container?.length &&
                !isFullscreenModernWindowData(runningWindow) &&
                runningWindow.state !== 'minimized' &&
                !$container.data('backgroundPreload') &&
                $container.is(':visible') &&
                !$container.hasClass('minimizing') &&
                !$container.hasClass('closing'));
        })
        .sort(function (left, right) {
            const leftActive = left.$container.hasClass('active') ? 1 : 0;
            const rightActive = right.$container.hasClass('active') ? 1 : 0;
            if (leftActive !== rightActive) {
                return rightActive - leftActive;
            }

            const leftZ = parseInt(left.$container.css('zIndex')) || 0;
            const rightZ = parseInt(right.$container.css('zIndex')) || 0;
            if (leftZ !== rightZ) {
                return rightZ - leftZ;
            }

            return right.$container.index() - left.$container.index();
        });
}

function handleContinuumTaskbarBackAction() {
    closeAllTaskbarPopupsAndMenus();
    closeAllClassicContextMenus();
    closeModernFlyout();
    hideCharmsBar();
    closeTaskViewPlaceholder();

    const activeModernApp = getActiveModernRunningApp();
    const visibleDesktopWindows = getVisibleContinuumDesktopWindows();
    const frontmostDesktopWindow = visibleDesktopWindows[0] || null;

    if (activeModernApp?.app?.id) {
        minimizeModernApp(activeModernApp.app.id, {
            suppressContinuumStartSurface: visibleDesktopWindows.length > 0
        });
        return;
    }

    if (frontmostDesktopWindow?.windowId) {
        const shouldOpenStartAfterMinimize = visibleDesktopWindows.length <= 1;
        minimizeClassicWindow(frontmostDesktopWindow.windowId);

        if (shouldOpenStartAfterMinimize) {
            setTimeout(function () {
                if (!getActiveModernRunningApp() && getVisibleContinuumDesktopWindows().length === 0) {
                    openStartSurface();
                }
            }, CLASSIC_WINDOW_MINIMIZE_ANIMATION_MS + 20);
        }

        return;
    }

    openStartSurface();
}

function openContinuumManualPrompt() {
    if (!isContinuumBetaActive()) {
        return;
    }

    const targetMode = isContinuumTabletShellMode() ? 'desktop' : 'tablet';
    showContinuumPosturePrompt(targetMode);
}

function cloneContinuumWindowStateObject(value) {
    if (!value || typeof value !== 'object') {
        return null;
    }

    return { ...value };
}

function getContinuumWindowStateSnapshot(windowData) {
    return windowData?.$container?.data('continuumAutoWindowState') || null;
}

function setContinuumWindowStateSnapshot(windowData, snapshot) {
    if (!windowData?.$container?.length || !snapshot) {
        return null;
    }

    windowData.$container.data('continuumAutoWindowState', snapshot);
    return snapshot;
}

function clearContinuumWindowStateSnapshot(windowData) {
    if (!windowData?.$container?.length) {
        return;
    }

    windowData.$container.removeData('continuumAutoWindowState');
}

function buildContinuumWindowStateSnapshot(windowData) {
    if (!windowData?.$container?.length) {
        return null;
    }

    const $container = windowData.$container;
    return {
        windowId: windowData.windowId || null,
        appId: windowData.appId || null,
        isModernDesktop: isModernDesktopWindowData(windowData),
        wasMinimized: windowData.state === 'minimized',
        wasMetroMode: $container.hasClass('metro-mode'),
        wasMaximized: $container.hasClass('maximized'),
        wasSnapped: !!$container.data('isSnapped'),
        snapZone: $container.data('snapZone') || null,
        preSnapState: cloneContinuumWindowStateObject($container.data('preSnapState')),
        prevState: cloneContinuumWindowStateObject($container.data('prevState')),
        bounds: getClassicWindowBoundsState($container),
        autoApplied: false,
        userAdjustedWhileTablet: false,
        restoreOnDesktopRestore: false
    };
}

function ensureContinuumWindowStateSnapshot(windowData) {
    const existingSnapshot = getContinuumWindowStateSnapshot(windowData);
    if (existingSnapshot) {
        return existingSnapshot;
    }

    const snapshot = buildContinuumWindowStateSnapshot(windowData);
    if (!snapshot) {
        return null;
    }

    return setContinuumWindowStateSnapshot(windowData, snapshot);
}

function markContinuumWindowStateManuallyAdjusted(windowData) {
    const snapshot = getContinuumWindowStateSnapshot(windowData);
    if (!snapshot) {
        return;
    }

    snapshot.userAdjustedWhileTablet = true;
    snapshot.restoreOnDesktopRestore = false;
    setContinuumWindowStateSnapshot(windowData, snapshot);
}

function restoreClassicWindowStateFromContinuumSnapshot(windowData, snapshot) {
    if (!windowData?.$container?.length || !snapshot) {
        return false;
    }

    const $container = windowData.$container;
    $container.removeClass('maximized snapped snapped-left snapped-right snapped-top-left snapped-top-right snapped-bottom-left snapped-bottom-right');
    $container.removeData('isSnapped');
    $container.removeData('snapZone');
    $container.removeData('preSnapState');

    if (snapshot.wasSnapped && snapshot.snapZone) {
        snapClassicWindowToZone(windowData.windowId, snapshot.snapZone, {
            suppressSnapAssist: true,
            ensureVisible: true,
            focusWindow: false,
            continuumAuto: true
        });
    } else if (snapshot.wasMaximized) {
        if (snapshot.prevState) {
            $container.data('prevState', snapshot.prevState);
        } else {
            $container.removeData('prevState');
        }

        $container.addClass('maximized');
        setClassicWindowMaximizeButtonState($container, true);
    } else {
        if (snapshot.bounds) {
            $container.css(snapshot.bounds);
        }

        if (snapshot.prevState) {
            $container.data('prevState', snapshot.prevState);
        } else {
            $container.removeData('prevState');
        }

        setClassicWindowMaximizeButtonState($container, false);
    }

    if (snapshot.preSnapState) {
        $container.data('preSnapState', snapshot.preSnapState);
    }

    return true;
}

function applyContinuumTabletWindowState(windowData) {
    if (!windowData?.$container?.length || isFullscreenModernWindowData(windowData)) {
        return false;
    }

    const snapshot = ensureContinuumWindowStateSnapshot(windowData);
    if (!snapshot) {
        return false;
    }

    if (windowData.state === 'minimized') {
        snapshot.restoreOnDesktopRestore = false;
        setContinuumWindowStateSnapshot(windowData, snapshot);
        return false;
    }

    if (snapshot.isModernDesktop) {
        if (!windowData.$container.hasClass('metro-mode')) {
            snapshot.autoApplied = true;
            setContinuumWindowStateSnapshot(windowData, snapshot);
            toggleModernDesktopMetroMode(windowData.windowId, { continuumAuto: true });
            return true;
        }

        return false;
    }

    // Only auto-maximize if the window is actually maximizable
    const app = windowData.app;
    const windowOptions = app?.windowOptions || {};
    const supportsTabletMaximize = windowOptions.maximizable !== false &&
        windowOptions.resizable !== false;

    if (supportsTabletMaximize &&
        (!windowData.$container.hasClass('maximized') || !!windowData.$container.data('isSnapped'))) {
        snapshot.autoApplied = true;
        setContinuumWindowStateSnapshot(windowData, snapshot);
        toggleMaximizeClassicWindow(windowData.windowId, {
            continuumAuto: true,
            forceMaximize: true
        });
        return true;
    }

    return false;
}

function restoreContinuumWindowStateAfterTabletExit(windowData) {
    const snapshot = getContinuumWindowStateSnapshot(windowData);
    if (!snapshot) {
        return false;
    }

    if (snapshot.userAdjustedWhileTablet) {
        clearContinuumWindowStateSnapshot(windowData);
        return false;
    }

    if (!snapshot.autoApplied) {
        clearContinuumWindowStateSnapshot(windowData);
        return false;
    }

    if (windowData.state === 'minimized') {
        snapshot.restoreOnDesktopRestore = true;
        setContinuumWindowStateSnapshot(windowData, snapshot);
        return false;
    }

    if (snapshot.isModernDesktop) {
        if (windowData.$container.hasClass('metro-mode')) {
            toggleModernDesktopMetroMode(windowData.windowId, { continuumAuto: true });
        }
    } else {
        restoreClassicWindowStateFromContinuumSnapshot(windowData, snapshot);
    }

    clearContinuumWindowStateSnapshot(windowData);
    return true;
}

function reconcileContinuumWindowStateAfterClassicRestore(windowData) {
    const snapshot = getContinuumWindowStateSnapshot(windowData);
    if (!snapshot) {
        return false;
    }

    if (isContinuumTabletShellMode()) {
        return applyContinuumTabletWindowState(windowData);
    }

    if (!snapshot.restoreOnDesktopRestore || snapshot.userAdjustedWhileTablet || !snapshot.autoApplied) {
        clearContinuumWindowStateSnapshot(windowData);
        return false;
    }

    if (snapshot.isModernDesktop) {
        if (windowData.$container.hasClass('metro-mode')) {
            toggleModernDesktopMetroMode(windowData.windowId, { continuumAuto: true });
        }
    } else {
        restoreClassicWindowStateFromContinuumSnapshot(windowData, snapshot);
    }

    clearContinuumWindowStateSnapshot(windowData);
    return true;
}

function applyContinuumModeToRunningModernWindows() {
    if (!window.AppsManager || typeof AppsManager.getRunningWindowsSnapshot !== 'function') {
        return;
    }

    AppsManager.getRunningWindowsSnapshot().forEach(function (runningWindow) {
        if (!runningWindow?.$container?.length || isFullscreenModernWindowData(runningWindow)) {
            return;
        }

        if (isContinuumTabletShellMode()) {
            applyContinuumTabletWindowState(runningWindow);
        } else {
            restoreContinuumWindowStateAfterTabletExit(runningWindow);
        }
    });
}

function dispatchContinuumShellModeChanged() {
    if (typeof window === 'undefined' || !document.body) {
        return;
    }

    const normalizedMode = normalizeContinuumShellMode(continuumShellMode);
    const tabletModeActive = isContinuumTabletShellMode();
    document.body.classList.toggle('continuum-shell-mode-tablet', tabletModeActive);
    document.body.classList.toggle('continuum-shell-mode-desktop', !tabletModeActive);
    document.body.dataset.continuumShellMode = normalizedMode;

    window.dispatchEvent(new CustomEvent('win8-continuum-shell-mode-changed', {
        detail: {
            mode: normalizedMode,
            tabletModeActive
        }
    }));
}

function applySavedContinuumShellModeBeforeDesktopReveal() {
    if (!isContinuumBetaActive()) {
        return false;
    }

    setContinuumShellMode(normalizeContinuumShellMode(continuumShellMode), {
        persistPreference: false,
        skipTransition: true
    });

    return true;
}

function setContinuumShellMode(mode, options = {}) {
    const normalizedMode = normalizeContinuumShellMode(mode);
    const changed = continuumShellMode !== normalizedMode;
    continuumShellMode = normalizedMode;

    if (changed && options.skipTransition !== true) {
        beginContinuumShellModeTransition();
    }

    if (changed) {
        performStartMenuFullscreenSwap(() => {
            setStartMenuFullscreenPreference(normalizedMode === 'tablet', { render: true, skipTransition: true });
        });
    }

    if (options.persistPreference !== false) {
        persistContinuumShellModePreference(normalizedMode);
    }

    dispatchContinuumShellModeChanged();
    updateTaskbarReservedHeight();
    updateTaskbarResizedClass();
    updateTaskbarClock();
    updateTaskbarShellButtonsVisibility();
    updateTaskbarShellButtonIcons();
    updateNotificationCenterIcon();
    updateTaskbarUserTileFrame();

    if (options.syncWindows !== false) {
        applyContinuumModeToRunningModernWindows();
    }

    if (changed && normalizedMode === 'tablet') {
        maybeOpenContinuumStartSurfaceOnTabletEntry();
    } else if (normalizedMode !== 'tablet') {
        clearPendingContinuumStartSurfaceAutoOpen();
    }

    return changed;
}

function hideContinuumPosturePrompt(options = {}) {
    const { immediate = false } = options;
    const prompt = getContinuumPromptElement();
    if (!prompt) {
        continuumPromptTargetMode = null;
        clearContinuumPromptTimers();
        return;
    }

    clearContinuumPromptTimers();
    continuumPromptTargetMode = null;

    if (immediate) {
        prompt.classList.remove('visible', 'closing');
        prompt.setAttribute('aria-hidden', 'true');
        return;
    }

    prompt.classList.remove('visible');
    prompt.classList.add('closing');
    prompt.setAttribute('aria-hidden', 'true');

    continuumPromptHideTimer = setTimeout(() => {
        prompt.classList.remove('closing');
        continuumPromptHideTimer = null;
    }, CONTINUUM_PROMPT_HIDE_ANIMATION_MS);
}

function applyContinuumPromptDecision(accepted) {
    const rememberInput = getContinuumPromptRememberInput();
    const rememberChoice = !!rememberInput?.checked;
    const targetMode = normalizeContinuumShellMode(continuumPromptTargetMode);

    if (accepted) {
        setContinuumShellMode(targetMode);
        if (rememberChoice) {
            continuumPromptBehavior = 'always';
        }
    } else if (rememberChoice) {
        continuumPromptBehavior = 'never';
    }

    hideContinuumPosturePrompt();
}

function showContinuumPosturePrompt(targetMode) {
    const prompt = getContinuumPromptElement();
    if (!prompt || !isContinuumBetaActive()) {
        return;
    }

    continuumPromptTargetMode = normalizeContinuumShellMode(targetMode);
    const deferredDelay = getContinuumPromptDeferredDelay();
    const shellReadyForPrompt = currentView === 'desktop' || currentView === 'modern' || currentView === 'start';

    if (deferredDelay > 0 || !shellReadyForPrompt) {
        clearContinuumPromptTimers();
        continuumPromptDeferredShowTimer = setTimeout(() => {
            continuumPromptDeferredShowTimer = null;
            showContinuumPosturePrompt(continuumPromptTargetMode);
        }, Math.max(deferredDelay, shellReadyForPrompt ? 0 : 250));
        return;
    }

    const title = document.getElementById('continuum-posture-prompt-title');
    const yesButton = document.getElementById('continuum-posture-prompt-yes');
    const noButton = document.getElementById('continuum-posture-prompt-no');
    const rememberInput = getContinuumPromptRememberInput();

    if (title) {
        title.textContent = continuumPromptTargetMode === 'tablet'
            ? 'Enter tablet mode?'
            : 'Exit tablet mode?';
    }

    if (yesButton) {
        yesButton.textContent = continuumPromptTargetMode === 'tablet' ? 'Yes' : 'Yes';
    }

    if (noButton) {
        noButton.textContent = continuumPromptTargetMode === 'tablet' ? 'No' : 'No';
    }

    if (rememberInput) {
        rememberInput.checked = false;
    }

    clearContinuumPromptTimers();
    prompt.classList.remove('closing');
    prompt.classList.add('visible');
    prompt.setAttribute('aria-hidden', 'false');

    continuumPromptDismissTimer = setTimeout(() => {
        hideContinuumPosturePrompt();
    }, CONTINUUM_PROMPT_AUTO_DISMISS_MS);
}

function initializeContinuumPrompt() {
    if (typeof window === 'undefined' || !document.body) {
        return;
    }

    const prompt = getContinuumPromptElement();
    if (!prompt || prompt.dataset.continuumPromptBound === 'true') {
        return;
    }

    prompt.dataset.continuumPromptBound = 'true';
    const yesButton = document.getElementById('continuum-posture-prompt-yes');
    const noButton = document.getElementById('continuum-posture-prompt-no');

    yesButton?.addEventListener('click', function () {
        applyContinuumPromptDecision(true);
    });

    noButton?.addEventListener('click', function () {
        applyContinuumPromptDecision(false);
    });
}

function handleContinuumSettingsRuntimeChange(event) {
    const detail = event?.detail || {};
    console.log('[Continuum] Runtime settings change received:', detail);

    if (!detail.enabled) {
        continuumPromptBehavior = 'ask';
        lastContinuumPostureMode = null;
        hideContinuumPosturePrompt({ immediate: true });
        setContinuumShellMode('desktop', { syncWindows: false, persistPreference: false });
        return;
    }

    if (!window.Win8DevicePosture?.currentState) {
        setContinuumShellMode(normalizeContinuumShellMode(continuumShellMode), { persistPreference: false });
        return;
    }

    const postureMode = window.Win8DevicePosture.currentState.isTabletPosture ? 'tablet' : 'desktop';
    const nextMode = normalizeContinuumShellMode(continuumShellMode || postureMode);
    setContinuumShellMode(nextMode, { persistPreference: false });
    lastContinuumPostureMode = postureMode;
}

function handleContinuumDevicePostureChanged(event) {
    const detail = event?.detail || {};
    const postureState = detail.state || null;
    console.log('[Continuum] Renderer posture event received:', {
        enabled: detail.enabled,
        posture: postureState?.posture || 'unknown',
        isTabletPosture: postureState?.isTabletPosture ?? null,
        currentShellMode: continuumShellMode
    });

    if (!detail.enabled || !postureState || !isContinuumBetaActive()) {
        hideContinuumPosturePrompt({ immediate: true });
        return;
    }

    const targetMode = postureState.isTabletPosture ? 'tablet' : 'desktop';

    if (!continuumShellMode) {
        setContinuumShellMode(targetMode);
        lastContinuumPostureMode = targetMode;
        return;
    }

    if (lastContinuumPostureMode === targetMode) {
        return;
    }

    lastContinuumPostureMode = targetMode;

    if (continuumPromptBehavior === 'always') {
        setContinuumShellMode(targetMode);
        return;
    }

    if (continuumPromptBehavior === 'never') {
        return;
    }

    if (normalizeContinuumShellMode(continuumShellMode) !== targetMode) {
        showContinuumPosturePrompt(targetMode);
    }
}

function extractThresholdSettingsFromTaskbarSettings(settings = {}) {
    const thresholdSettings = {};

    if (settings.thresholdFeaturesEnabled !== undefined) {
        thresholdSettings.thresholdFeaturesEnabled = !!settings.thresholdFeaturesEnabled;
    }
    if (settings.showSearchButton !== undefined) {
        thresholdSettings.showSearchButton = !!settings.showSearchButton;
    }
    if (settings.showTaskViewButton !== undefined) {
        thresholdSettings.showTaskViewButton = !!settings.showTaskViewButton;
    }
    if (settings.showNotificationCenterIcon !== undefined) {
        thresholdSettings.showNotificationCenterIcon = !!settings.showNotificationCenterIcon;
    }
    if (settings.useModernClockPopup !== undefined) {
        thresholdSettings.useModernClockPopup = !!settings.useModernClockPopup;
    }
    if (settings.useModernVolumePopup !== undefined) {
        thresholdSettings.useModernVolumePopup = !!settings.useModernVolumePopup;
    }
    if (settings.continuumBetaEnabled !== undefined) {
        thresholdSettings.continuumBetaEnabled = !!settings.continuumBetaEnabled;
    }
    if (settings.openMetroAppsOnDesktop !== undefined) {
        thresholdSettings.openMetroAppsOnDesktop = !!settings.openMetroAppsOnDesktop;
    }
    if (settings.useModernWindowStyling !== undefined) {
        thresholdSettings.useModernWindowStyling = !!settings.useModernWindowStyling;
    }
    if (settings.showDesktopWatermark !== undefined) {
        thresholdSettings.showDesktopWatermark = !!settings.showDesktopWatermark;
    }

    if (settings.navigation && settings.navigation.useStartMenu !== undefined) {
        thresholdSettings.useStartMenu = !!settings.navigation.useStartMenu;
    }

    return thresholdSettings;
}

function applyThresholdSettingImmediate(key, value) {
    switch (key) {
        case 'thresholdFeaturesEnabled':
            setThresholdFeaturesEnabled(value);
            return;
        case 'useStartMenu':
            applyNavigationSettingsUpdate({ useStartMenu: value });
            applyStartMenuModePreference();
            return;
        case 'showSearchButton':
            setTaskbarSearchButtonVisible(value);
            return;
        case 'showTaskViewButton':
            setTaskbarTaskViewButtonVisible(value);
            return;
        case 'showNotificationCenterIcon':
            setTaskbarNotificationCenterIconVisible(value);
            return;
        case 'useModernClockPopup':
            setModernClockPopupEnabled(value);
            return;
        case 'useModernVolumePopup':
            setModernVolumePopupEnabled(value);
            return;
        case 'continuumBetaEnabled':
            setContinuumBetaEnabled(value);
            return;
        case 'openMetroAppsOnDesktop':
            setDesktopModernAppsEnabled(value);
            updateDesktopModernAppCommandsAvailability();
            updateDesktopModernMetroModeBodyState();
            return;
        case 'useModernWindowStyling':
            setModernWindowStylingEnabled(value);
            return;
        case 'showDesktopWatermark':
            setDesktopWatermarkEnabled(value);
            return;
    }
}

function getThresholdSignOutPromptFeatureLabel(liveValues, finalDesiredValues, deferredChangeKeys) {
    const startChanged = deferredChangeKeys.includes('useStartMenu') ||
        ((liveValues.thresholdFeaturesEnabled && liveValues.useStartMenu) !==
            (finalDesiredValues.thresholdFeaturesEnabled && finalDesiredValues.useStartMenu));
    if (startChanged) {
        return 'Start';
    }

    const appsChanged = deferredChangeKeys.includes('openMetroAppsOnDesktop') ||
        ((liveValues.thresholdFeaturesEnabled && liveValues.openMetroAppsOnDesktop) !==
            (finalDesiredValues.thresholdFeaturesEnabled && finalDesiredValues.openMetroAppsOnDesktop));
    if (appsChanged) {
        return 'Your Apps';
    }

    const continuumChanged = deferredChangeKeys.includes('continuumBetaEnabled') ||
        ((liveValues.thresholdFeaturesEnabled && liveValues.continuumBetaEnabled) !==
            (finalDesiredValues.thresholdFeaturesEnabled && finalDesiredValues.continuumBetaEnabled));
    if (continuumChanged) {
        return 'Continuum';
    }

    return 'Start';
}

function reconcileThresholdSettingsChangeRequest(settings = {}) {
    const requestedValues = extractThresholdSettingsFromTaskbarSettings(settings);
    if (Object.keys(requestedValues).length === 0) {
        return { requiresPrompt: false, featureLabel: null };
    }

    const { liveValues, desiredValues } = getDesiredThresholdSettingsState();
    const finalDesiredValues = {
        ...desiredValues,
        ...requestedValues
    };
    const deferEntireThresholdCluster = finalDesiredValues.thresholdFeaturesEnabled !== liveValues.thresholdFeaturesEnabled;
    const nextPendingValues = {};
    const deferredChangeKeys = [];

    THRESHOLD_PENDING_SETTING_KEYS.forEach(key => {
        const requestedValue = finalDesiredValues[key];
        if (requestedValue === undefined) {
            return;
        }

        const shouldDefer = deferEntireThresholdCluster || THRESHOLD_SIGN_OUT_REQUIRED_SETTING_KEYS.has(key);

        if (shouldDefer) {
            if (requestedValue !== liveValues[key]) {
                nextPendingValues[key] = requestedValue;
            }

            if (requestedValue !== desiredValues[key]) {
                deferredChangeKeys.push(key);
            }

            return;
        }

        if (requestedValue !== liveValues[key] || requestedValue !== desiredValues[key]) {
            applyThresholdSettingImmediate(key, requestedValue);
        }
    });

    replacePendingThresholdSignOutChanges(nextPendingValues);

    if (deferredChangeKeys.length === 0) {
        return { requiresPrompt: false, featureLabel: null };
    }

    return {
        requiresPrompt: true,
        featureLabel: getThresholdSignOutPromptFeatureLabel(liveValues, finalDesiredValues, deferredChangeKeys)
    };
}

function commitPendingThresholdSignOutChanges() {
    const pendingSnapshot = loadPendingThresholdSettingsSnapshot();
    if (!pendingSnapshot.pending || Object.keys(pendingSnapshot.values).length === 0) {
        return false;
    }

    const hasPendingThresholdToggle = Object.prototype.hasOwnProperty.call(
        pendingSnapshot.values,
        'thresholdFeaturesEnabled'
    );

    if (Object.prototype.hasOwnProperty.call(pendingSnapshot.values, 'useStartMenu')) {
        applyNavigationSettingsUpdate({ useStartMenu: pendingSnapshot.values.useStartMenu });
        if (!hasPendingThresholdToggle) {
            applyStartMenuModePreference();
        }
    }

    [
        'showSearchButton',
        'showTaskViewButton',
        'showNotificationCenterIcon',
        'useModernClockPopup',
        'useModernVolumePopup',
        'continuumBetaEnabled',
        'openMetroAppsOnDesktop',
        'useModernWindowStyling',
        'showDesktopWatermark',
        'thresholdFeaturesEnabled'
    ].forEach(key => {
        if (!Object.prototype.hasOwnProperty.call(pendingSnapshot.values, key)) {
            return;
        }

        applyThresholdSettingImmediate(key, pendingSnapshot.values[key]);
    });

    replacePendingThresholdSignOutChanges({});
    return true;
}

async function promptForThresholdSignOut(featureLabel) {
    const body = `Before we change ${featureLabel}, make sure you save your work. We'll need to close any open apps or windows and then sign out to change this setting. Then, sign back in and ${featureLabel} will be ready for you.`;

    if (window.systemDialog && typeof systemDialog.show === 'function') {
        return systemDialog.show({
            title: 'Sign out to change settings',
            body,
            status: 'question',
            buttons: [
                { label: 'Sign out and change settings', value: 'signout', default: true },
                { label: 'Not right now', value: 'later' }
            ]
        });
    }

    return window.confirm(body) ? 'signout' : 'later';
}

function updateTaskbarShellButtonsVisibility() {
    const shouldShowSearchButton = thresholdFeaturesEnabled && taskbarShowSearchButton;
    const shouldShowTaskViewButton = thresholdFeaturesEnabled && taskbarShowTaskViewButton;

    $('.taskbar-search-button').toggleClass('is-hidden', !shouldShowSearchButton);
    $('.taskbar-task-view-button').toggleClass('is-hidden', !shouldShowTaskViewButton);

    if (!shouldShowTaskViewButton) {
        closeTaskViewPlaceholder();
    }

    if (!shouldShowSearchButton) {
        hideSearchPanel();
    }

    updateTaskViewPlaceholderState();
    updateTaskViewTouchGestureAvailability();
    updateContinuumTaskbarControlsVisibility();
}

function updateNotificationCenterVisibility() {
    const $icon = $('#notification-center-icon');
    if (!$icon.length) {
        return;
    }

    $icon.toggleClass('is-hidden', !(thresholdFeaturesEnabled && taskbarShowNotificationCenterIcon));

    if (!(thresholdFeaturesEnabled && taskbarShowNotificationCenterIcon)) {
        hideNotificationCenterPanel();
    }
}

function updateTaskbarUserTileVisibility() {
    const $button = $('#taskbar-usertile-button');
    if (!$button.length) {
        return;
    }

    $button.toggleClass('is-hidden', !taskbarShowUserTile);

    if (!taskbarShowUserTile && $('#usertile-panel').is('.visible, .closing') &&
        window.ClassicFlyoutManager && typeof window.ClassicFlyoutManager.hide === 'function') {
        window.ClassicFlyoutManager.hide('#usertile-panel');
    }

    if (!taskbarShowUserTile) {
        $button.removeClass('active');
    }
}

function updateModernWindowStylingClass() {
    if (typeof document === 'undefined' || !document.body) {
        return;
    }

    document.body.classList.toggle('modern-window-styling-disabled', !(thresholdFeaturesEnabled && taskbarUseModernWindowStyling));
}

function updateModernClockPopupClass() {
    if (typeof document === 'undefined' || !document.body) {
        return;
    }

    document.body.classList.toggle('taskbar-modern-clock-popup-enabled', thresholdFeaturesEnabled && taskbarUseModernClockPopup);

    if (window.ClockFlyout && typeof window.ClockFlyout.refreshLayout === 'function') {
        window.ClockFlyout.refreshLayout();
    }
}

function updateModernVolumePopupClass() {
    if (typeof document === 'undefined' || !document.body) {
        return;
    }

    document.body.classList.toggle('taskbar-modern-volume-popup-enabled', thresholdFeaturesEnabled && taskbarUseModernVolumePopup);

    if (window.VolumeUI && typeof window.VolumeUI.refreshFlyoutLayout === 'function') {
        window.VolumeUI.refreshFlyoutLayout();
    }
}

function updateModernLockScreenClass() {
    if (typeof document === 'undefined' || !document.body) {
        return;
    }

    const enabled = thresholdFeaturesEnabled;

    // Body class for start menu user tile circular hint
    document.body.classList.toggle('threshold-modern-logonui', enabled);

    // Login screen class for modern lock screen layout
    const $loginScreen = $('#login-screen');
    const $signingInScreen = $('#signing-in-screen');
    $loginScreen.toggleClass('threshold-logonui', enabled);
    $signingInScreen.toggleClass('threshold-logonui', enabled);

    // Show/hide the user list and indicators
    const $userList = $('.login-user-list');
    const $indicators = $('.login-indicators');
    $userList.prop('hidden', !enabled);
    $indicators.prop('hidden', !enabled);

    if (enabled) {
        // Move the power button inside the indicators area
        const $powerButton = $loginScreen.find('.login-power-button');
        const $indicatorsEl = $loginScreen.find('.login-indicators');
        if ($powerButton.length && $indicatorsEl.length && !$indicatorsEl.find('.login-power-button').length) {
            $indicatorsEl.append($powerButton);
        }

        updateLoginScreenIndicators();
    } else {
        // Move the power button back to the login overlay
        const $powerButton = $('.login-indicators .login-power-button');
        const $overlay = $loginScreen.find('.login-overlay');
        if ($powerButton.length && $overlay.length) {
            $overlay.append($powerButton);
        }
    }
}

function updateLoginScreenIndicators() {
    // Update network indicator
    const $networkIcon = $('.login-indicator-network .login-indicator-icon');
    if ($networkIcon.length && typeof networkMonitor !== 'undefined') {
        const iconState = networkMonitor.getNetworkIconState();
        $networkIcon.attr('src', `resources/images/tray/network/${iconState}/32.png`);
    }

    // Update battery indicator using sprite sheet
    const $batteryEl = $('.login-indicator-battery');
    const $batterySprite = $batteryEl.find('.login-indicator-battery-sprite');
    if ($batterySprite.length && typeof batteryMonitor !== 'undefined') {
        const frameIndex = batteryMonitor.getBatteryFrameIndex();
        const renderSize = 20;
        const backgroundWidth = renderSize * BATTERY_SPRITE_FRAME_COUNT;
        const backgroundOffsetX = frameIndex * -renderSize;

        $batterySprite.css({
            'width': `${renderSize}px`,
            'height': `${renderSize}px`,
            'background-image': "url('resources/images/tray/battery/32.png')",
            'background-position': `${backgroundOffsetX}px 0`,
            'background-repeat': 'no-repeat',
            'background-size': `${backgroundWidth}px ${renderSize}px`,
            'image-rendering': 'auto'
        });

        // If no battery present, hide the indicator
        $batteryEl.toggle(batteryMonitor.currentStatus.batteryPresent !== false);
    }
}

function updateDesktopWatermark() {
    const $watermark = $('#desktop-watermark');
    if (!$watermark.length) {
        return;
    }

    const shouldShowWatermark = thresholdFeaturesEnabled && desktopWatermarkEnabled;
    $watermark.prop('hidden', !shouldShowWatermark);

    if (!shouldShowWatermark) {
        return;
    }

    const compositeVersion = formatCompositeVersion(
        THRESHOLD_DESKTOP_WATERMARK_DETAILS.baseVersion,
        repositoryBuildInfo
    );
    const showVersionLine = compositeVersion !== THRESHOLD_DESKTOP_WATERMARK_DETAILS.baseVersion;

    $('#desktop-watermark-title').text(THRESHOLD_DESKTOP_WATERMARK_DETAILS.productName);
    $('#desktop-watermark-version')
        .text(`Version ${compositeVersion}`)
        .prop('hidden', !showVersionLine);
    $('#desktop-watermark-build').text(THRESHOLD_DESKTOP_WATERMARK_DETAILS.buildText);
}

function selectBootLogoBitmap(targetWidth, targetHeight) {
    const exactOrNextUp = WINDOWS_BOOT_LOGO_BITMAPS.find(asset => asset.width >= targetWidth && asset.height >= targetHeight);
    if (exactOrNextUp) {
        return exactOrNextUp;
    }

    return WINDOWS_BOOT_LOGO_BITMAPS[WINDOWS_BOOT_LOGO_BITMAPS.length - 1];
}

function updateBootLogo() {
    const $bootLogo = $('#boot-logo-image');
    if (!$bootLogo.length) {
        return;
    }

    if (thresholdFeaturesEnabled) {
        $bootLogo.attr('src', THRESHOLD_BOOT_LOGO_PATH).attr('alt', 'Threshold boot logo');
        return;
    }

    const $logoContainer = $bootLogo.closest('.windows-logo');
    const rect = $logoContainer.length ? $logoContainer[0].getBoundingClientRect() : null;
    const scaleFactor = typeof window !== 'undefined'
        ? Math.max(1, Number(window.devicePixelRatio) || 1)
        : 1;
    const targetWidth = Math.max(1, Math.ceil((rect?.width || 180) * scaleFactor));
    const targetHeight = Math.max(1, Math.ceil((rect?.height || 180) * scaleFactor));
    const selectedAsset = selectBootLogoBitmap(targetWidth, targetHeight);

    $bootLogo.attr('src', selectedAsset.path).attr('alt', 'Windows logo');
}

function applyThresholdFeatureStates() {
    updateTaskbarShellButtonsVisibility();
    updateTaskbarContextMenuChecks();
    updateNotificationCenterVisibility();
    updateModernClockPopupClass();
    updateModernVolumePopupClass();
    updateModernWindowStylingClass();
    updateDesktopModernAppCommandsAvailability();
    updateDesktopWatermark();
    applyStartMenuModePreference();
    updateBootLogo();
    updateModernLockScreenClass();
    dispatchContinuumSettingsChanged();
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

function selectUserTileFrameAsset(targetSize) {
    const exactMatch = USER_TILE_FRAME_ASSETS.find(asset => asset.size === targetSize);
    if (exactMatch) {
        return exactMatch;
    }

    const nextUp = USER_TILE_FRAME_ASSETS.find(asset => asset.size >= targetSize);
    if (nextUp) {
        return nextUp;
    }

    return USER_TILE_FRAME_ASSETS[USER_TILE_FRAME_ASSETS.length - 1];
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

function getTaskbarUserTileProfileSnapshot() {
    if (window.ShellUserProfile && typeof window.ShellUserProfile.getProfile === 'function') {
        return window.ShellUserProfile.getProfile();
    }

    return {
        displayName: 'User',
        username: 'User',
        imageUrl: 'resources/images/user.png',
        sourcePlatform: 'unknown'
    };
}

function renderTaskbarUserTileProfile(profile = getTaskbarUserTileProfileSnapshot()) {
    const safeDisplayName = profile.displayName || profile.username || 'User';
    const safeUsername = profile.username || safeDisplayName;
    const accountType = profile.sourcePlatform === 'win32' ? 'Windows account' : 'User account';

    $('#taskbar-usertile-button')
        .attr('title', safeDisplayName)
        .attr('aria-label', safeDisplayName);
    $('#taskbar-usertile-image').attr('alt', safeDisplayName);
    $('#usertile-panel-photo-image').attr('alt', safeDisplayName);
    $('#usertile-panel-account-type').text(accountType);
    $('#usertile-panel-username').text(safeUsername);
}

function updateTaskbarUserTileFrame() {
    const $frame = $('#usertile-panel-photo-frame');
    const $photoShell = $('#usertile-panel-photo-shell');
    if (!$frame.length || !$photoShell.length) {
        return;
    }

    const scaleFactor = getTaskbarShellButtonAssetScaleFactor();
    const targetAssetSize = Math.max(1, Math.ceil(USER_TILE_PANEL_FRAME_RENDER_SIZE * scaleFactor));
    const selectedAsset = selectUserTileFrameAsset(targetAssetSize);
    const displayInset = Math.round(((selectedAsset.innerInset / selectedAsset.size) * USER_TILE_PANEL_FRAME_RENDER_SIZE) - 1);

    $frame.attr('src', selectedAsset.path);
    $photoShell.css({
        width: `${USER_TILE_PANEL_FRAME_RENDER_SIZE}px`,
        height: `${USER_TILE_PANEL_FRAME_RENDER_SIZE}px`,
        '--usertile-panel-photo-inset': `${displayInset}px`
    });

    if ($('#usertile-panel').is('.visible, .closing') &&
        window.ClassicFlyoutManager && typeof window.ClassicFlyoutManager.position === 'function') {
        window.ClassicFlyoutManager.position('#usertile-panel', { forceMeasure: true });
    }
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
    if (detail && detail.appId && typeof AppsManager !== 'undefined') {
        const app = AppsManager.getAppById(detail.appId);
        if (app) {
            const iconImage = AppsManager.getIconImage(app, 32) || AppsManager.getAppListLogo(app, 32);
            const isGlyphIcon = !iconImage && window.AppsManager?.isGlyphIconClass?.(app.icon);
            return {
                src: iconImage || null,
                iconClass: isGlyphIcon ? app.icon : null,
                color: app.type === 'modern' ? (app.color || 'accent') : null
            };
        }
    }

    if (detail && detail.appIcon) {
        return { src: detail.appIcon, iconClass: null, color: null };
    }

    return null;
}

function renderNotificationCenterPanel() {
    const $panelBody = $('#notification-center-panel-body');
    if (!$panelBody.length) {
        return;
    }

    if (notificationCenterDragState.active || notificationCenterDragState.element) {
        resetNotificationCenterDragState();
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
        const iconData = section.icon;
        const hasIcon = Boolean(iconData);
        let sectionIconHtml = '';
        if (hasIcon) {
            const plateClass = iconData.color ? `app-icon-plate--${iconData.color}` : '';
            const innerHtml = iconData.src
                ? `<img src="${escapeNotificationCenterText(iconData.src)}" alt="">`
                : iconData.iconClass
                    ? `<span class="${escapeNotificationCenterText(iconData.iconClass)}"></span>`
                    : '';
            sectionIconHtml = `<div class="notification-center-section-icon ${plateClass}">${innerHtml}</div>`;
        }
        const itemsHtml = section.items.map(item => {
            const descriptionHtml = item.description
                ? `<div class="notification-center-item-description">${escapeNotificationCenterText(item.description)}</div>`
                : '';
            return `
                <div class="notification-center-item" data-notification-id="${escapeNotificationCenterText(item.id)}">
                    <button class="notification-center-item-dismiss" type="button" aria-label="Dismiss notification">&times;</button>
                    <button
                        class="notification-center-item-button"
                        type="button"
                        data-notification-id="${escapeNotificationCenterText(item.id)}"
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
                    ${sectionIconHtml}
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

function clearNotificationCenterCloseTimer() {
    if (notificationCenterCloseTimer) {
        clearTimeout(notificationCenterCloseTimer);
        notificationCenterCloseTimer = null;
    }
}

function markNotificationCenterRead() {
    if (notificationCenterUnreadCount === 0) {
        return;
    }

    notificationCenterUnreadCount = 0;
    updateNotificationCenterIcon();
}

function showNotificationCenterPanel() {
    if (!(thresholdFeaturesEnabled && taskbarShowNotificationCenterIcon)) {
        return;
    }

    const $panel = $('#notification-center-panel');
    if (!$panel.length) {
        return;
    }

    clearNotificationCenterCloseTimer();
    clearClassicWindowFocusForShell('notification-center');
    renderNotificationCenterPanel();
    $panel.removeClass('closing').addClass('visible').attr('aria-hidden', 'false');
    $('#notification-center-icon').addClass('active');
    markNotificationCenterRead();
}

function hideNotificationCenterPanel() {
    const $panel = $('#notification-center-panel');
    if (!$panel.length) {
        return;
    }

    resetNotificationCenterDragState();
    clearNotificationCenterCloseTimer();

    if (!$panel.hasClass('visible') && !$panel.hasClass('closing')) {
        $('#notification-center-icon').removeClass('active');
        return;
    }

    $panel.removeClass('visible').addClass('closing').attr('aria-hidden', 'true');
    $('#notification-center-icon').removeClass('active');

    notificationCenterCloseTimer = setTimeout(() => {
        $('#notification-center-panel').removeClass('closing');
        notificationCenterCloseTimer = null;
    }, NOTIFICATION_CENTER_CLOSE_ANIMATION_MS);
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
    if (!(thresholdFeaturesEnabled && taskbarShowNotificationCenterIcon)) {
        return;
    }

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

function resetNotificationCenterDragState() {
    if (notificationCenterDragState.dismissTimer) {
        clearTimeout(notificationCenterDragState.dismissTimer);
        notificationCenterDragState.dismissTimer = null;
    }

    if (notificationCenterDragState.element) {
        notificationCenterDragState.element.classList.remove('notification-center-item--dragging');
        notificationCenterDragState.element.style.transform = '';
        notificationCenterDragState.element.style.opacity = '';
    }

    notificationCenterDragState.active = false;
    notificationCenterDragState.pointerId = null;
    notificationCenterDragState.startX = 0;
    notificationCenterDragState.currentX = 0;
    notificationCenterDragState.hasDragged = false;
    notificationCenterDragState.itemId = null;
    notificationCenterDragState.element = null;
}

function dismissNotificationCenterItem(notificationId, { hideToast = true } = {}) {
    const nextItems = notificationCenterItems.filter(item => item.id !== notificationId);
    if (nextItems.length === notificationCenterItems.length) {
        return;
    }

    if (notificationCenterDragState.suppressClickId === notificationId) {
        notificationCenterDragState.suppressClickId = null;
    }

    notificationCenterItems = nextItems;
    notificationCenterUnreadCount = Math.min(notificationCenterUnreadCount, notificationCenterItems.length);
    renderNotificationCenterPanel();
    updateNotificationCenterIcon();

    if (hideToast &&
        window.notificationManager &&
        window.notificationManager.notifications instanceof Map &&
        window.notificationManager.notifications.has(notificationId) &&
        typeof window.notificationManager.hide === 'function') {
        window.notificationManager.hide(notificationId);
    }
}

function beginNotificationCenterItemDrag(element, event) {
    if (!element) {
        return;
    }

    notificationCenterDragState.active = true;
    notificationCenterDragState.pointerId = event.pointerId ?? 'mouse';
    notificationCenterDragState.startX = event.clientX;
    notificationCenterDragState.currentX = 0;
    notificationCenterDragState.hasDragged = false;
    notificationCenterDragState.itemId = element.getAttribute('data-notification-id');
    notificationCenterDragState.element = element;
}

function updateNotificationCenterItemDrag(event) {
    if (!notificationCenterDragState.active ||
        (event.pointerId ?? 'mouse') !== notificationCenterDragState.pointerId ||
        !notificationCenterDragState.element) {
        return;
    }

    const deltaX = event.clientX - notificationCenterDragState.startX;
    if (!notificationCenterDragState.hasDragged && deltaX > NOTIFICATION_CENTER_DRAG_THRESHOLD) {
        notificationCenterDragState.hasDragged = true;
        notificationCenterDragState.suppressClickId = notificationCenterDragState.itemId;
        notificationCenterDragState.element.classList.add('notification-center-item--dragging');
    }

    if (!notificationCenterDragState.hasDragged) {
        return;
    }

    notificationCenterDragState.currentX = Math.max(0, deltaX);
    notificationCenterDragState.element.style.transform = `translateX(${notificationCenterDragState.currentX}px)`;
    notificationCenterDragState.element.style.opacity = `${Math.max(0.35, 1 - (notificationCenterDragState.currentX / NOTIFICATION_CENTER_DISMISS_THRESHOLD) * 0.55)}`;

    event.preventDefault();
}

function endNotificationCenterItemDrag(event) {
    if (!notificationCenterDragState.active ||
        (event.pointerId ?? 'mouse') !== notificationCenterDragState.pointerId ||
        !notificationCenterDragState.element) {
        return;
    }

    const {
        currentX,
        element,
        itemId,
        hasDragged
    } = notificationCenterDragState;

    if (hasDragged && currentX > NOTIFICATION_CENTER_DISMISS_THRESHOLD) {
        element.style.transform = 'translateX(180px)';
        element.style.opacity = '0';
        notificationCenterDragState.dismissTimer = setTimeout(() => {
            dismissNotificationCenterItem(itemId);
            resetNotificationCenterDragState();
        }, 140);
        return;
    }

    resetNotificationCenterDragState();
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

    $(document).on('click', '.notification-center-item-dismiss', function (e) {
        e.preventDefault();
        e.stopPropagation();
        dismissNotificationCenterItem($(this).closest('.notification-center-item').attr('data-notification-id'));
    });

    $(document).on('click', '.notification-center-item-button[data-notification-id]', function (e) {
        e.preventDefault();
        e.stopPropagation();

        const notificationId = $(this).attr('data-notification-id');
        if (notificationCenterDragState.suppressClickId === notificationId) {
            notificationCenterDragState.suppressClickId = null;
            return;
        }

        handleNotificationCenterItemClick(notificationId);
    });

    $(document).on('pointerdown', '.notification-center-item', function (e) {
        if ($(e.target).closest('.notification-center-item-dismiss').length) {
            return;
        }

        if (e.button !== undefined && e.button !== 0) {
            return;
        }

        beginNotificationCenterItemDrag(this, e);
    });

    $(document).on('pointermove', function (e) {
        updateNotificationCenterItemDrag(e);
    });

    $(document).on('pointerup pointercancel', function (e) {
        endNotificationCenterItemDrag(e);
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
    updateNotificationCenterVisibility();
    updateNotificationCenterIcon();
}

function switchUser() {
    lockSystem();
    transitionToLogin();
}

function handleTaskbarUserTileAction(action) {
    if (window.ClassicFlyoutManager && typeof window.ClassicFlyoutManager.hide === 'function') {
        window.ClassicFlyoutManager.hide('#usertile-panel');
    }

    switch (action) {
        case 'lock':
            lockSystem();
            break;
        case 'sign-out':
            signOut();
            break;
        case 'switch-user':
            switchUser();
            break;
        case 'settings':
            openControlPanelApplet('user-accounts');
            break;
    }
}

function initTaskbarUserTile() {
    const $button = $('#taskbar-usertile-button');
    if (!$button.length) {
        return;
    }

    renderTaskbarUserTileProfile();
    updateTaskbarUserTileVisibility();
    updateTaskbarUserTileFrame();

    if (window.ShellUserProfile && typeof window.ShellUserProfile.subscribe === 'function') {
        window.ShellUserProfile.subscribe((profile) => {
            renderTaskbarUserTileProfile(profile);
        });
    }

    $(window)
        .off('resize.taskbar-usertile')
        .on('resize.taskbar-usertile', updateTaskbarUserTileFrame);
    window.addEventListener('win8-display-settings-changed', updateTaskbarUserTileFrame);

    $(document).on('click', '[data-usertile-action]', function (event) {
        event.preventDefault();
        event.stopPropagation();
        handleTaskbarUserTileAction($(this).attr('data-usertile-action'));
    });
}

function getSearchPanelApp() {
    return AppsManager.getAppById('search') || null;
}

function isSearchPanelVisible() {
    return searchPanelOpen;
}

function updateSearchPanelButtonState() {
    const isActive = Boolean(searchPanelOpen);
    $('.taskbar-search-button')
        .toggleClass('is-active', isActive)
        .attr('aria-pressed', isActive ? 'true' : 'false');
}

function getSearchPanelInputValue() {
    return $('#search-panel-input').val() || '';
}

function persistSearchPanelQuery(query) {
    try {
        localStorage.setItem(SEARCH_PANEL_STORAGE_KEY, String(query || ''));
    } catch (error) {
        console.warn('[SearchPanel] Failed to persist query:', error);
    }
}

function focusSearchPanelInputAfterDelay(delay = 0) {
    if (searchPanelFocusTimer) {
        clearTimeout(searchPanelFocusTimer);
        searchPanelFocusTimer = null;
    }

    searchPanelFocusTimer = setTimeout(() => {
        const input = document.getElementById('search-panel-input');
        if (!input || !isSearchPanelVisible()) {
            return;
        }

        input.focus();
        input.select();
    }, Math.max(0, delay));
}

function resetSearchPanelSplashState() {
    if (searchPanelSplashShowTimer) {
        clearTimeout(searchPanelSplashShowTimer);
        searchPanelSplashShowTimer = null;
    }

    if (searchPanelSplashHideTimer) {
        clearTimeout(searchPanelSplashHideTimer);
        searchPanelSplashHideTimer = null;
    }

    $('#search-panel-splash')
        .removeClass('visible fade-out')
        .attr('aria-hidden', 'true');
}

function buildSearchPanelSplashIconHtml() {
    const searchApp = getSearchPanelApp();
    const splashIcon = searchApp && window.AppsManager && typeof window.AppsManager.getAppListLogo === 'function'
        ? window.AppsManager.getAppListLogo(searchApp, 144)
        : null;

    if (splashIcon) {
        return `<img src="${splashIcon}" alt="">`;
    }

    return '<img src="resources/images/icons/charms_search.png" alt="">';
}

function clearSearchPanelCloseTimer() {
    if (searchPanelCloseTimer) {
        clearTimeout(searchPanelCloseTimer);
        searchPanelCloseTimer = null;
    }
}

function showSearchPanelSplash() {
    const $splash = $('#search-panel-splash');
    if (!$splash.length) {
        return;
    }

    $('#search-panel-splash-icon').html(buildSearchPanelSplashIconHtml());
    $splash.attr('aria-hidden', 'false').addClass('visible').removeClass('fade-out');

    searchPanelSplashShowTimer = setTimeout(() => {
        $splash.addClass('fade-out');
        searchPanelSplashHideTimer = setTimeout(() => {
            $splash.removeClass('visible fade-out').attr('aria-hidden', 'true');
        }, SEARCH_PANEL_SPLASH_FADE_MS);
    }, SEARCH_PANEL_SPLASH_HOLD_MS);

    focusSearchPanelInputAfterDelay(SEARCH_PANEL_SPLASH_HOLD_MS + 40);
}

function getSearchPanelAppIconMarkup(app, size = 32) {
    if (!app) {
        return {
            className: '',
            style: '',
            html: '<span class="sui-all-apps"></span>'
        };
    }

    const iconImage = AppsManager.getIconImage(app, size);
    const logoImage = !iconImage ? AppsManager.getAppListLogo(app) : null;
    const usePlate = app.type === 'modern';
    const plateStyle = usePlate && app.color ? ` style="background:${getAppTileColor(app.color)}"` : '';

    if (iconImage) {
        return {
            className: usePlate ? 'search-panel-result-icon--plate' : '',
            style: plateStyle,
            html: `<img src="${iconImage}" alt="">`
        };
    }

    if (logoImage) {
        return {
            className: usePlate ? 'search-panel-result-icon--plate' : '',
            style: plateStyle,
            html: `<img src="${logoImage}" alt="">`
        };
    }

    if (app.icon) {
        return {
            className: usePlate ? 'search-panel-result-icon--plate' : '',
            style: plateStyle,
            html: `<span class="${app.icon}"></span>`
        };
    }

    return {
        className: '',
        style: '',
        html: '<span class="sui-all-apps"></span>'
    };
}

function getSearchPanelFileIconMarkup(entry, size = 32) {
    const iconBuilder = window.ExplorerIconBuilder;
    const iconSource = iconBuilder && typeof iconBuilder.getIconSourceCandidates === 'function'
        ? (iconBuilder.getIconSourceCandidates(entry, size)[0] || '')
        : '';

    if (iconSource) {
        return {
            className: '',
            style: '',
            html: `<img src="${iconSource}" alt="">`
        };
    }

    return {
        className: '',
        style: '',
        html: entry?.type === 'folder'
            ? '<span class="sui-folder"></span>'
            : '<span class="sui-document"></span>'
    };
}

function normalizeSearchTokens(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean);
}

function calculateSearchScore(query, fields, sourceBias = 0) {
    const normalizedFields = (Array.isArray(fields) ? fields : [fields])
        .map(field => String(field || '').toLowerCase().trim())
        .filter(Boolean);

    if (!normalizedFields.length) {
        return 0;
    }

    const normalizedQuery = String(query || '').toLowerCase().trim();
    if (!normalizedQuery) {
        return sourceBias;
    }

    const tokens = normalizeSearchTokens(normalizedQuery);
    if (!tokens.length) {
        return sourceBias;
    }

    let score = sourceBias;

    for (const token of tokens) {
        let tokenScore = 0;

        normalizedFields.forEach((field, index) => {
            const fieldBias = Math.max(0, 12 - index * 2);
            if (field === token) {
                tokenScore = Math.max(tokenScore, 180 + fieldBias);
                return;
            }

            if (field.startsWith(token)) {
                tokenScore = Math.max(tokenScore, 120 + fieldBias);
                return;
            }

            if (field.includes(` ${token}`)) {
                tokenScore = Math.max(tokenScore, 90 + fieldBias);
                return;
            }

            if (field.includes(token)) {
                tokenScore = Math.max(tokenScore, 60 + fieldBias);
            }
        });

        if (tokenScore === 0) {
            return 0;
        }

        score += tokenScore;
    }

    return score;
}

function createSearchPanelAppResults(query) {
    const normalizedQuery = String(query || '').trim();
    const allApps = AppsManager.getAllApps()
        .filter(app => app && app.id !== 'desktop' && app.id !== 'search');

    if (!normalizedQuery) {
        const preferredOrder = ['iexplore', 'explorer', 'settings', 'control-panel', 'run'];
        const byId = new Map(allApps.map(app => [app.id, app]));
        return preferredOrder
            .map(id => byId.get(id))
            .filter(Boolean)
            .map((app, index) => ({
                id: `app:${app.id}`,
                type: 'app',
                title: app.name,
                subtitle: app.type === 'modern' ? 'App' : 'Desktop app',
                score: 320 - index * 8,
                icon: getSearchPanelAppIconMarkup(app),
                onLaunch: () => launchApp(app, null, { fromTaskbar: true })
            }));
    }

    return allApps
        .map(app => {
            const score = calculateSearchScore(normalizedQuery, [
                app.name,
                app.id,
                ...(Array.isArray(app.runCommands) ? app.runCommands : [])
            ], 36);

            if (!score) {
                return null;
            }

            return {
                id: `app:${app.id}`,
                type: 'app',
                title: app.name,
                subtitle: app.type === 'modern' ? 'App' : 'Desktop app',
                score,
                icon: getSearchPanelAppIconMarkup(app),
                onLaunch: () => launchApp(app, null, { fromTaskbar: true })
            };
        })
        .filter(Boolean);
}

function createSearchPanelSettingsResults(query) {
    const normalizedQuery = String(query || '').trim();

    if (!normalizedQuery) {
        return searchPanelSettingsCatalog
            .filter(entry => entry.categoryId === 'search-and-apps' || entry.itemId === 'display')
            .slice(0, 2)
            .map((entry, index) => ({
                ...entry,
                score: 286 - index * 6
            }));
    }

    return searchPanelSettingsCatalog
        .map(entry => {
            const score = calculateSearchScore(normalizedQuery, entry.searchFields, 28);
            if (!score) {
                return null;
            }

            return {
                ...entry,
                score
            };
        })
        .filter(Boolean);
}

function createSearchPanelAppletResults(query) {
    const normalizedQuery = String(query || '').trim();

    if (!normalizedQuery) {
        const defaultAppletIds = ['indexing-options', 'internet-options', 'folder-options'];
        const byId = new Map(searchPanelControlPanelAppletCatalog.map(entry => [entry.appletId, entry]));
        return defaultAppletIds
            .map(id => byId.get(id))
            .filter(Boolean)
            .map((entry, index) => ({
                ...entry,
                score: 262 - index * 6
            }));
    }

    return searchPanelControlPanelAppletCatalog
        .map(entry => {
            const score = calculateSearchScore(normalizedQuery, entry.searchFields, 24);
            if (!score) {
                return null;
            }

            return {
                ...entry,
                score
            };
        })
        .filter(Boolean);
}

function createSearchPanelFileResults(query) {
    const normalizedQuery = String(query || '').trim();

    if (!normalizedQuery) {
        return searchPanelDesktopEntries
            .slice()
            .sort((left, right) => Number(right.modifiedTime || 0) - Number(left.modifiedTime || 0))
            .slice(0, 2)
            .map((entry, index) => ({
                id: `file:${entry.path}`,
                type: 'file',
                title: entry.name,
                subtitle: entry.type === 'folder' ? 'Desktop folder' : 'Desktop file',
                score: 214 - index * 6,
                icon: getSearchPanelFileIconMarkup(entry),
                onLaunch: () => window.ExplorerEngine.openEntryPath(entry.path, entry.type)
            }));
    }

    return searchPanelDesktopEntries
        .map(entry => {
            const score = calculateSearchScore(normalizedQuery, [
                entry.name,
                entry.typeLabel,
                entry.extension
            ], 16);

            if (!score) {
                return null;
            }

            return {
                id: `file:${entry.path}`,
                type: 'file',
                title: entry.name,
                subtitle: entry.type === 'folder' ? 'Desktop folder' : 'Desktop file',
                score,
                icon: getSearchPanelFileIconMarkup(entry),
                onLaunch: () => window.ExplorerEngine.openEntryPath(entry.path, entry.type)
            };
        })
        .filter(Boolean);
}

function buildSearchPanelResults(query) {
    const normalizedQuery = String(query || '').trim();
    const combined = [
        ...createSearchPanelAppResults(normalizedQuery),
        ...createSearchPanelSettingsResults(normalizedQuery),
        ...createSearchPanelAppletResults(normalizedQuery),
        ...createSearchPanelFileResults(normalizedQuery)
    ];
    const seen = new Set();
    const visibleResults = [];

    combined
        .sort((left, right) => {
            if (right.score !== left.score) {
                return right.score - left.score;
            }

            return left.title.localeCompare(right.title, undefined, { sensitivity: 'base' });
        })
        .forEach(result => {
            if (!result || seen.has(result.id) || visibleResults.length >= SEARCH_PANEL_RESULT_LIMIT) {
                return;
            }

            seen.add(result.id);
            visibleResults.push(result);
        });

    if (normalizedQuery) {
        visibleResults.push({
            id: 'search:more-results',
            type: 'action',
            title: `See more results for "${normalizedQuery}"`,
            subtitle: 'Search app',
            icon: {
                className: 'search-panel-result-icon--plate',
                style: ` style="background:${getAppTileColor('purple')}"`,
                html: '<span class="sui-search"></span>'
            },
            onLaunch: () => launchSearchResultsApp(normalizedQuery)
        });
    }

    return visibleResults;
}

function renderSearchPanelResults() {
    const $results = $('#search-panel-results');
    if (!$results.length) {
        return;
    }

    if (!searchPanelResults.length) {
        $results.html(`
            <div class="search-panel-empty-state">
                Start typing to search apps, settings, and desktop files.
            </div>
        `);
        return;
    }

    const html = searchPanelResults.map((result, index) => {
        const iconClass = result.icon?.className ? ` ${result.icon.className}` : '';
        const iconStyle = result.icon?.style || '';
        const selectedClass = index === searchPanelSelectedIndex ? ' is-selected' : '';
        const actionClass = result.type === 'action' ? ' search-panel-result--action' : '';

        return `
            <button class="search-panel-result${selectedClass}${actionClass}" type="button" data-result-index="${index}" role="option" aria-selected="${index === searchPanelSelectedIndex ? 'true' : 'false'}">
                <span class="search-panel-result-icon${iconClass}"${iconStyle}>${result.icon?.html || '<span class="sui-search"></span>'}</span>
                <span class="search-panel-result-text">
                    <span class="search-panel-result-title">${escapeHtml(result.title)}</span>
                    <span class="search-panel-result-subtitle">${escapeHtml(result.subtitle || '')}</span>
                </span>
            </button>
        `;
    }).join('');

    $results.html(html);
}

function setSearchPanelSelectedIndex(nextIndex, options = {}) {
    const { ensureVisible = false } = options;

    if (!searchPanelResults.length) {
        searchPanelSelectedIndex = -1;
        renderSearchPanelResults();
        return;
    }

    const clampedIndex = Math.max(0, Math.min(searchPanelResults.length - 1, Number(nextIndex) || 0));
    searchPanelSelectedIndex = clampedIndex;
    renderSearchPanelResults();

    if (ensureVisible) {
        const element = document.querySelector(`.search-panel-result[data-result-index="${clampedIndex}"]`);
        if (element) {
            element.scrollIntoView({ block: 'nearest' });
        }
    }
}

function normalizeSearchSurfaceSourceFilter(source) {
    const normalized = String(source || '').trim().toLowerCase();
    if (normalized === 'everything') {
        return 'all';
    }

    if (['all', 'apps', 'settings', 'files'].includes(normalized)) {
        return normalized;
    }

    return 'apps';
}

function getOneSearchSourcesForFilter(source) {
    const normalized = normalizeSearchSurfaceSourceFilter(source);
    if (normalized === 'all') {
        return ['apps', 'settings', 'files'];
    }

    return [normalized];
}

function getSearchResultIconMarkup(result, baseClassName) {
    const iconClass = result?.icon?.className ? ` ${result.icon.className}` : '';
    const iconStyle = typeof result?.icon?.style === 'string' && result.icon.style.trim()
        ? ` style="${escapeHtml(result.icon.style)}"`
        : '';

    return `<span class="${baseClassName}${iconClass}"${iconStyle}>${result?.icon?.html || '<span class="sui-search"></span>'}</span>`;
}

function buildOpenSearchAppResult(query, source = 'all') {
    const normalizedQuery = String(query || '').trim();
    if (!normalizedQuery) {
        return null;
    }

    return {
        id: `search:open-app:${normalizeSearchSurfaceSourceFilter(source)}:${normalizedQuery.toLowerCase()}`,
        source: 'search',
        group: 'Search',
        kind: 'action',
        type: 'action',
        title: `See more results for "${normalizedQuery}"`,
        subtitle: 'Search app',
        score: -1,
        icon: {
            className: 'search-panel-result-icon--plate',
            style: `background:${getAppTileColor('purple')}`,
            html: '<span class="sui-search"></span>'
        },
        action: {
            type: 'open-search-app',
            query: normalizedQuery,
            source: normalizeSearchSurfaceSourceFilter(source)
        }
    };
}

function renderSearchPanelResults() {
    const $results = $('#search-panel-results');
    if (!$results.length) {
        return;
    }

    if (!searchPanelResults.length) {
        $results.html(`
            <div class="search-panel-empty-state">
                Start typing to search apps, settings, and files.
            </div>
        `);
        return;
    }

    const html = searchPanelResults.map((result, index) => {
        const selectedClass = index === searchPanelSelectedIndex ? ' is-selected' : '';
        const actionClass = result.type === 'action' ? ' search-panel-result--action' : '';

        return `
            <button class="search-panel-result${selectedClass}${actionClass}" type="button" data-result-index="${index}" role="option" aria-selected="${index === searchPanelSelectedIndex ? 'true' : 'false'}">
                ${getSearchResultIconMarkup(result, 'search-panel-result-icon')}
                <span class="search-panel-result-text">
                    <span class="search-panel-result-title">${escapeHtml(result.title)}</span>
                    <span class="search-panel-result-subtitle">${escapeHtml(result.subtitle || '')}</span>
                </span>
            </button>
        `;
    }).join('');

    $results.html(html);
}

function updateSearchPanelResults() {
    const normalizedQuery = String(getSearchPanelInputValue() || '').trim();
    let results = [];

    if (window.OneSearch && typeof OneSearch.search === 'function') {
        results = OneSearch.search({
            query: normalizedQuery,
            sources: ['apps', 'settings', 'files'],
            limit: SEARCH_PANEL_RESULT_LIMIT,
            mode: 'preview',
            context: 'taskbar-panel'
        });
    }

    const moreResultsAction = buildOpenSearchAppResult(normalizedQuery, 'all');
    if (moreResultsAction) {
        results = results.concat(moreResultsAction);
    }

    searchPanelResults = results;
    searchPanelSelectedIndex = searchPanelResults.length
        ? Math.max(0, Math.min(searchPanelSelectedIndex, searchPanelResults.length - 1))
        : -1;
    renderSearchPanelResults();
}

function activateSearchPanelResult(index = searchPanelSelectedIndex) {
    const result = searchPanelResults[index];
    if (!result) {
        return;
    }

    hideSearchPanel();

    try {
        if (window.OneSearch && typeof OneSearch.execute === 'function') {
            OneSearch.execute(result);
        }
    } catch (error) {
        console.error('[SearchPanel] Failed to launch search result:', error);
    }
}

function launchSearchResultsApp(query, source = 'all') {
    const normalizedQuery = String(query || '').trim();
    persistSearchPanelQuery(normalizedQuery);

    const searchApp = getSearchPanelApp();
    if (!searchApp) {
        console.warn('Search app is not available.');
        return;
    }

    launchApp(searchApp, null, { fromTaskbar: true });
    sendRunningAppMessage('search', {
        action: 'updateSearchQuery',
        query: normalizedQuery,
        source: normalizeSearchSurfaceSourceFilter(source)
    });
}

if (typeof window !== 'undefined') {
    window.launchSearchResultsApp = launchSearchResultsApp;
}

function loadSearchPanelControlPanelCatalog() {
    if (searchPanelAppletCatalogPromise) {
        return searchPanelAppletCatalogPromise;
    }

    searchPanelAppletCatalogPromise = fetch('apps/classic/control/data/applets.json')
        .then(response => response.json())
        .then(data => {
            const applets = Array.isArray(data?.applets) ? data.applets : [];
            searchPanelControlPanelAppletCatalog = applets.map(applet => ({
                id: `applet:${applet.id}`,
                type: 'applet',
                appletId: applet.id,
                title: applet.name,
                subtitle: 'Control Panel',
                icon: {
                    className: '',
                    style: '',
                    html: applet.icon ? `<span class="${applet.icon}"></span>` : '<span class="sui-settings"></span>'
                },
                searchFields: [applet.name, applet.description, applet.id, 'control panel'],
                onLaunch: () => openControlPanelApplet(applet.id)
            }));
            return searchPanelControlPanelAppletCatalog;
        })
        .catch(error => {
            console.error('[SearchPanel] Failed to load Control Panel applets:', error);
            searchPanelControlPanelAppletCatalog = [];
            return searchPanelControlPanelAppletCatalog;
        });

    return searchPanelAppletCatalogPromise;
}

function loadSearchPanelSettingsCatalog() {
    if (searchPanelSettingsCatalogPromise) {
        return searchPanelSettingsCatalogPromise;
    }

    searchPanelSettingsCatalogPromise = fetch('apps/modern/settings/settings-data.json')
        .then(response => response.json())
        .then(data => {
            const catalog = [];

            Object.entries(data || {}).forEach(([categoryId, categoryData]) => {
                if (!categoryData?.name) {
                    return;
                }

                catalog.push({
                    id: `settings:${categoryId}`,
                    type: 'setting',
                    categoryId,
                    itemId: null,
                    title: categoryData.name,
                    subtitle: 'PC settings',
                    icon: {
                        className: 'search-panel-result-icon--plate',
                        style: ` style="background:${getAppTileColor('purple')}"`,
                        html: '<span class="sui-settings"></span>'
                    },
                    searchFields: [categoryData.name, categoryId.replace(/-/g, ' '), 'pc settings', 'settings'],
                    onLaunch: () => openSettingsCategory(categoryId)
                });

                Object.entries(categoryData.items || {}).forEach(([itemId, itemData]) => {
                    const sectionTitles = Array.isArray(itemData?.sections)
                        ? itemData.sections.map(section => section.title)
                        : [];

                    catalog.push({
                        id: `settings:${categoryId}:${itemId}`,
                        type: 'setting',
                        categoryId,
                        itemId,
                        title: itemData.name,
                        subtitle: `PC settings - ${categoryData.name}`,
                        icon: {
                            className: 'search-panel-result-icon--plate',
                            style: ` style="background:${getAppTileColor('purple')}"`,
                            html: '<span class="sui-settings"></span>'
                        },
                        searchFields: [
                            itemData.name,
                            categoryData.name,
                            ...sectionTitles,
                            categoryId.replace(/-/g, ' '),
                            itemId.replace(/-/g, ' '),
                            'pc settings',
                            'settings'
                        ],
                        onLaunch: () => openSettingsCategory(categoryId, itemId)
                    });
                });
            });

            searchPanelSettingsCatalog = catalog;
            return searchPanelSettingsCatalog;
        })
        .catch(error => {
            console.error('[SearchPanel] Failed to load settings search catalog:', error);
            searchPanelSettingsCatalog = [];
            return searchPanelSettingsCatalog;
        });

    return searchPanelSettingsCatalogPromise;
}

function refreshSearchPanelDesktopEntries() {
    if (!window.ExplorerEngine || typeof window.ExplorerEngine.readDesktopEntries !== 'function') {
        searchPanelDesktopEntries = [];
        return Promise.resolve(searchPanelDesktopEntries);
    }

    searchPanelDesktopEntriesPromise = window.ExplorerEngine.readDesktopEntries()
        .then(entries => {
            searchPanelDesktopEntries = Array.isArray(entries) ? entries : [];
            return searchPanelDesktopEntries;
        })
        .catch(error => {
            console.error('[SearchPanel] Failed to load desktop entries:', error);
            searchPanelDesktopEntries = [];
            return searchPanelDesktopEntries;
        });

    return searchPanelDesktopEntriesPromise;
}

function ensureSearchPanelSources(options = {}) {
    const { refreshDesktopEntries = false } = options;
    if (!window.OneSearch || typeof OneSearch.ensureSources !== 'function') {
        updateSearchPanelResults();
        return Promise.resolve();
    }

    const currentToken = ++searchPanelRequestToken;
    return OneSearch.ensureSources({
        sources: ['apps', 'settings', 'files'],
        refreshFiles: refreshDesktopEntries
    }).then(() => {
        if (currentToken === searchPanelRequestToken) {
            updateSearchPanelResults();
        }
    });
}

function getSearchFlyoutInputValue() {
    return $('#charms-search-input').val() || '';
}

function getSearchFlyoutSourceValue() {
    return normalizeSearchSurfaceSourceFilter($('#charms-search-source').val() || 'apps');
}

function updateSearchFlyoutPlaceholder() {
    const input = document.getElementById('charms-search-input');
    if (!input) {
        return;
    }

    const source = getSearchFlyoutSourceValue();
    input.placeholder = source === 'all'
        ? 'Search apps, settings, and files'
        : `Search ${source}`;
}

function focusSearchFlyoutInputAfterDelay(delay = 0) {
    if (searchPanelFocusTimer) {
        clearTimeout(searchPanelFocusTimer);
        searchPanelFocusTimer = null;
    }

    searchPanelFocusTimer = setTimeout(() => {
        const input = document.getElementById('charms-search-input');
        const flyout = document.querySelector('.modern-flyout[data-flyout="search"]');
        if (!input || !flyout || !flyout.classList.contains('visible')) {
            return;
        }

        input.focus();
        input.select();
    }, Math.max(0, delay));
}

function renderSearchFlyoutResults() {
    const $results = $('#charms-search-results');
    if (!$results.length) {
        return;
    }

    if (!searchFlyoutResults.length) {
        $results.html(`
            <div class="charms-search-empty-state">
                Start typing to search ${escapeHtml(getSearchFlyoutSourceValue() === 'all' ? 'apps, settings, and files' : getSearchFlyoutSourceValue())}.
            </div>
        `);
        return;
    }

    const html = searchFlyoutResults.map((result, index) => {
        const selectedClass = index === searchFlyoutSelectedIndex ? ' is-selected' : '';
        const actionClass = result.type === 'action' ? ' charms-search-result--action' : '';

        return `
            <button class="charms-search-result${selectedClass}${actionClass}" type="button" data-search-flyout-index="${index}" role="option" aria-selected="${index === searchFlyoutSelectedIndex ? 'true' : 'false'}">
                ${getSearchResultIconMarkup(result, 'charms-search-result-icon')}
                <span class="charms-search-result-text">
                    <span class="charms-search-result-title">${escapeHtml(result.title)}</span>
                    <span class="charms-search-result-subtitle">${escapeHtml(result.subtitle || '')}</span>
                </span>
            </button>
        `;
    }).join('');

    $results.html(html);
}

function setSearchFlyoutSelectedIndex(nextIndex, options = {}) {
    const { ensureVisible = false } = options;

    if (!searchFlyoutResults.length) {
        searchFlyoutSelectedIndex = -1;
        renderSearchFlyoutResults();
        return;
    }

    const clampedIndex = Math.max(0, Math.min(searchFlyoutResults.length - 1, Number(nextIndex) || 0));
    searchFlyoutSelectedIndex = clampedIndex;
    renderSearchFlyoutResults();

    if (ensureVisible) {
        const element = document.querySelector(`.charms-search-result[data-search-flyout-index="${clampedIndex}"]`);
        if (element) {
            element.scrollIntoView({ block: 'nearest' });
        }
    }
}

function updateSearchFlyoutResults() {
    const query = String(getSearchFlyoutInputValue() || '').trim();
    const sourceFilter = getSearchFlyoutSourceValue();
    let results = [];

    if (window.OneSearch && typeof OneSearch.search === 'function') {
        results = OneSearch.search({
            query,
            sources: getOneSearchSourcesForFilter(sourceFilter),
            limit: SEARCH_FLYOUT_RESULT_LIMIT,
            mode: 'flyout',
            context: 'charms-search'
        });
    }

    const openSearchAppResult = buildOpenSearchAppResult(query, sourceFilter);
    if (openSearchAppResult) {
        results = results.concat(openSearchAppResult);
    }

    searchFlyoutResults = results;
    searchFlyoutSelectedIndex = searchFlyoutResults.length
        ? Math.max(0, Math.min(searchFlyoutSelectedIndex, searchFlyoutResults.length - 1))
        : -1;
    renderSearchFlyoutResults();
}

function ensureSearchFlyoutSources(options = {}) {
    const sources = getOneSearchSourcesForFilter(getSearchFlyoutSourceValue());
    if (!window.OneSearch || typeof OneSearch.ensureSources !== 'function') {
        updateSearchFlyoutResults();
        return Promise.resolve();
    }

    const currentToken = ++searchFlyoutRequestToken;
    return OneSearch.ensureSources({
        sources,
        refreshFiles: Boolean(options.refreshFiles)
    }).then(() => {
        if (currentToken === searchFlyoutRequestToken) {
            updateSearchFlyoutResults();
        }
    });
}

function launchSearchFlyoutSearchApp(query = getSearchFlyoutInputValue(), source = getSearchFlyoutSourceValue()) {
    closeModernFlyout();
    launchSearchResultsApp(query, source);
}

function activateSearchFlyoutResult(index = searchFlyoutSelectedIndex) {
    const result = searchFlyoutResults[index];
    if (!result) {
        launchSearchFlyoutSearchApp();
        return;
    }

    closeModernFlyout();

    if (window.OneSearch && typeof OneSearch.execute === 'function') {
        OneSearch.execute(result);
    }
}

function handleSearchFlyoutOpened() {
    const sources = getOneSearchSourcesForFilter(getSearchFlyoutSourceValue());
    updateSearchFlyoutPlaceholder();
    updateSearchFlyoutResults();
    ensureSearchFlyoutSources({ refreshFiles: sources.includes('files') });
    focusSearchFlyoutInputAfterDelay(260);
}

function initSearchFlyout() {
    const $input = $('#charms-search-input');
    const $source = $('#charms-search-source');
    const $submit = $('#charms-search-submit');
    const $openApp = $('#charms-search-open-app');

    if (!$input.length || !$source.length || !$submit.length || !$openApp.length) {
        return;
    }

    $source.val('apps');
    updateSearchFlyoutPlaceholder();
    updateSearchFlyoutResults();

    $input.on('input', function () {
        searchFlyoutSelectedIndex = 0;
        updateSearchFlyoutResults();
    });

    $input.on('keydown', function (event) {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setSearchFlyoutSelectedIndex(searchFlyoutSelectedIndex + 1, { ensureVisible: true });
            return;
        }

        if (event.key === 'ArrowUp') {
            event.preventDefault();
            setSearchFlyoutSelectedIndex(searchFlyoutSelectedIndex - 1, { ensureVisible: true });
            return;
        }

        if (event.key === 'Enter') {
            event.preventDefault();
            if (searchFlyoutSelectedIndex >= 0) {
                activateSearchFlyoutResult(searchFlyoutSelectedIndex);
            } else {
                launchSearchFlyoutSearchApp();
            }
        }
    });

    $source.on('change', function () {
        const nextSource = normalizeSearchSurfaceSourceFilter(this.value);
        this.value = nextSource;
        searchFlyoutSelectedIndex = 0;
        updateSearchFlyoutPlaceholder();
        updateSearchFlyoutResults();
        ensureSearchFlyoutSources({
            refreshFiles: getOneSearchSourcesForFilter(nextSource).includes('files')
        });
        focusSearchFlyoutInputAfterDelay(0);
    });

    $submit.on('click', function (event) {
        event.preventDefault();
        event.stopPropagation();

        if (searchFlyoutSelectedIndex >= 0) {
            activateSearchFlyoutResult(searchFlyoutSelectedIndex);
            return;
        }

        launchSearchFlyoutSearchApp();
    });

    $openApp.on('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        launchSearchFlyoutSearchApp();
    });

    $(document).on('mouseenter', '.charms-search-result[data-search-flyout-index]', function () {
        const index = Number($(this).attr('data-search-flyout-index'));
        if (Number.isFinite(index) && index !== searchFlyoutSelectedIndex) {
            setSearchFlyoutSelectedIndex(index);
        }
    });

    $(document).on('click', '.charms-search-result[data-search-flyout-index]', function (event) {
        event.preventDefault();
        event.stopPropagation();
        const index = Number($(this).attr('data-search-flyout-index'));
        if (Number.isFinite(index)) {
            activateSearchFlyoutResult(index);
        }
    });
}

function requestSearchAppResults(query, source = 'all', options = {}) {
    const requestId = options.requestId ?? null;
    const normalizedQuery = String(query || '').trim();
    const normalizedSource = normalizeSearchSurfaceSourceFilter(source);
    const sources = getOneSearchSourcesForFilter(normalizedSource);

    const sendResults = () => {
        const results = window.OneSearch && typeof OneSearch.search === 'function'
            ? OneSearch.search({
                query: normalizedQuery,
                sources,
                limit: SEARCH_APP_RESULT_LIMIT,
                mode: 'search-app',
                context: 'search-app'
            })
            : [];

        sendRunningAppMessage('search', {
            action: 'oneSearchResults',
            query: normalizedQuery,
            source: normalizedSource,
            requestId,
            results
        });
    };

    if (!window.OneSearch || typeof OneSearch.ensureSources !== 'function') {
        sendResults();
        return Promise.resolve();
    }

    return OneSearch.ensureSources({
        sources,
        refreshFiles: Boolean(options.refreshFiles) && sources.includes('files')
    })
        .then(sendResults)
        .catch(error => {
            console.error('[SearchApp] Failed to load requested sources:', error);
            sendResults();
        });
}

window.addEventListener('message', function (event) {
    const data = event.data;
    if (!data || data.appId !== 'search') {
        return;
    }

    if (data.action === 'oneSearchRequest') {
        requestSearchAppResults(data.query || '', data.source || 'all', {
            requestId: data.requestId ?? null
        });
        return;
    }

    if (data.action === 'oneSearchExecute' && data.result) {
        try {
            if (window.OneSearch && typeof OneSearch.execute === 'function') {
                OneSearch.execute(data.result);
            }
        } catch (error) {
            console.error('[SearchApp] Failed to execute search result:', error);
        }
    }
});

function showSearchPanel() {
    if (!(thresholdFeaturesEnabled && taskbarShowSearchButton)) {
        return;
    }

    const $panel = $('#search-panel');
    if (!$panel.length) {
        return;
    }

    clearClassicWindowFocusForShell('search-panel');
    searchPanelOpen = true;
    updateSearchPanelButtonState();
    clearSearchPanelCloseTimer();
    $panel.removeClass('closing').addClass('visible').attr('aria-hidden', 'false');
    updateTabletStartHomeShellState();

    updateSearchPanelResults();
    ensureSearchPanelSources({ refreshDesktopEntries: true });

    if (!searchPanelHasShownSplash) {
        searchPanelHasShownSplash = true;
        showSearchPanelSplash();
        return;
    }

    focusSearchPanelInputAfterDelay(0);
}

function hideSearchPanel() {
    const $panel = $('#search-panel');

    if (!searchPanelOpen && (!$panel.length || !$panel.hasClass('closing'))) {
        resetSearchPanelSplashState();
        updateSearchPanelButtonState();
        return;
    }

    searchPanelOpen = false;
    resetSearchPanelSplashState();
    clearSearchPanelCloseTimer();

    if ($panel.length) {
        $panel.removeClass('visible').addClass('closing').attr('aria-hidden', 'true');
        searchPanelCloseTimer = setTimeout(() => {
            $('#search-panel').removeClass('closing');
            searchPanelCloseTimer = null;
            updateTabletStartHomeShellState();
        }, SEARCH_PANEL_CLOSE_ANIMATION_MS);
    }

    updateSearchPanelButtonState();
    updateTabletStartHomeShellState();
}

function toggleSearchPanel() {
    if (isSearchPanelVisible()) {
        hideSearchPanel();
        return;
    }

    closeAllTaskbarPopupsAndMenus({ includeTaskView: false });
    closeAllClassicContextMenus();
    closeModernFlyout();
    hideCharmsBar();

    if (isStartSurfaceVisible() && !shouldUseTabletStartHomeSurface()) {
        closeStartSurface({ forceDesktop: true, suppressRestore: true });
    }

    showSearchPanel();
}

function initSearchPanel() {
    const $panel = $('#search-panel');
    const $input = $('#search-panel-input');
    const $submit = $('#search-panel-submit');

    if (!$panel.length || !$input.length || !$submit.length) {
        return;
    }

    let initialQuery = '';
    try {
        initialQuery = localStorage.getItem(SEARCH_PANEL_STORAGE_KEY) || '';
    } catch (error) {
        console.warn('[SearchPanel] Failed to restore query:', error);
    }

    $input.val(initialQuery);
    updateSearchPanelResults();
    updateSearchPanelButtonState();
    resetSearchPanelSplashState();

    $input.on('input', function () {
        persistSearchPanelQuery(this.value);
        searchPanelSelectedIndex = 0;
        updateSearchPanelResults();
    });

    $input.on('keydown', function (event) {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setSearchPanelSelectedIndex(searchPanelSelectedIndex + 1, { ensureVisible: true });
            return;
        }

        if (event.key === 'ArrowUp') {
            event.preventDefault();
            setSearchPanelSelectedIndex(searchPanelSelectedIndex - 1, { ensureVisible: true });
            return;
        }

        if (event.key === 'Enter') {
            event.preventDefault();
            if (searchPanelSelectedIndex >= 0) {
                activateSearchPanelResult(searchPanelSelectedIndex);
            } else {
                launchSearchResultsApp($input.val());
            }
        }
    });

    $submit.on('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        launchSearchResultsApp($input.val());
    });

    $(document).on('mouseenter', '.search-panel-result[data-result-index]', function () {
        const index = Number($(this).attr('data-result-index'));
        if (Number.isFinite(index) && index !== searchPanelSelectedIndex) {
            setSearchPanelSelectedIndex(index);
        }
    });

    $(document).on('click', '.search-panel-result[data-result-index]', function (event) {
        event.preventDefault();
        event.stopPropagation();
        const index = Number($(this).attr('data-result-index'));
        if (Number.isFinite(index)) {
            activateSearchPanelResult(index);
        }
    });

    $(document).on('click', function (event) {
        if (isSearchPanelVisible() &&
            !$(event.target).closest('#search-panel, .taskbar-search-button').length) {
            hideSearchPanel();
        }
    });

    $(document).on('keydown', function (event) {
        if (event.key === 'Escape' && isSearchPanelVisible()) {
            hideSearchPanel();
        }
    });
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

function loadTaskbarNotificationCenterIconPreference() {
    return loadTaskbarButtonVisibilityPreference(TASKBAR_SHOW_NOTIFICATION_CENTER_ICON_VALUE_NAME, true);
}

function loadTaskbarUserTilePreference() {
    return loadTaskbarButtonVisibilityPreference(TASKBAR_SHOW_USER_TILE_VALUE_NAME, true);
}

function setTaskbarNotificationCenterIconVisible(enabled, options = {}) {
    const normalized = !!enabled;
    const { persist = true } = options;
    const changed = taskbarShowNotificationCenterIcon !== normalized;

    taskbarShowNotificationCenterIcon = normalized;
    updateNotificationCenterVisibility();

    if (persist) {
        persistTaskbarButtonVisibilityPreference(TASKBAR_SHOW_NOTIFICATION_CENTER_ICON_VALUE_NAME, normalized);
    }

    // Update notification toast position (top-down vs bottom-stack)
    if (window.notificationManager) {
        window.notificationManager.updateContainerPosition();
    }

    return changed;
}

function setTaskbarUserTileVisible(enabled, options = {}) {
    const normalized = !!enabled;
    const { persist = true } = options;
    const changed = taskbarShowUserTile !== normalized;

    taskbarShowUserTile = normalized;
    updateTaskbarUserTileVisibility();

    if (persist) {
        persistTaskbarButtonVisibilityPreference(TASKBAR_SHOW_USER_TILE_VALUE_NAME, normalized);
    }

    return changed;
}

function loadModernWindowStylingPreference() {
    return loadTaskbarButtonVisibilityPreference(TASKBAR_USE_MODERN_WINDOW_STYLING_VALUE_NAME, true);
}

function loadModernClockPopupPreference() {
    return loadTaskbarButtonVisibilityPreference(TASKBAR_MODERN_CLOCK_POPUP_VALUE_NAME, true);
}

function loadModernVolumePopupPreference() {
    return loadTaskbarButtonVisibilityPreference(TASKBAR_MODERN_VOLUME_POPUP_VALUE_NAME, true);
}

function setModernClockPopupEnabled(enabled, options = {}) {
    const normalized = !!enabled;
    const { persist = true } = options;
    const changed = taskbarUseModernClockPopup !== normalized;

    taskbarUseModernClockPopup = normalized;
    updateModernClockPopupClass();

    if (persist) {
        persistTaskbarButtonVisibilityPreference(TASKBAR_MODERN_CLOCK_POPUP_VALUE_NAME, normalized);
    }

    return changed;
}

function setModernVolumePopupEnabled(enabled, options = {}) {
    const normalized = !!enabled;
    const { persist = true } = options;
    const changed = taskbarUseModernVolumePopup !== normalized;

    taskbarUseModernVolumePopup = normalized;
    updateModernVolumePopupClass();

    if (persist) {
        persistTaskbarButtonVisibilityPreference(TASKBAR_MODERN_VOLUME_POPUP_VALUE_NAME, normalized);
    }

    return changed;
}

function setModernWindowStylingEnabled(enabled, options = {}) {
    const normalized = !!enabled;
    const { persist = true } = options;
    const changed = taskbarUseModernWindowStyling !== normalized;

    taskbarUseModernWindowStyling = normalized;
    updateModernWindowStylingClass();

    if (persist) {
        persistTaskbarButtonVisibilityPreference(TASKBAR_USE_MODERN_WINDOW_STYLING_VALUE_NAME, normalized);
    }

    return changed;
}

function loadThresholdFeaturesEnabledPreference() {
    return loadTaskbarButtonVisibilityPreference(TASKBAR_THRESHOLD_FEATURES_ENABLED_VALUE_NAME, true);
}

function loadContinuumBetaPreference() {
    return loadTaskbarButtonVisibilityPreference(TASKBAR_CONTINUUM_BETA_ENABLED_VALUE_NAME, false);
}

function loadContinuumShellModePreference() {
    return normalizeContinuumShellMode(
        loadTaskbarStringPreference(TASKBAR_CONTINUUM_SHELL_MODE_VALUE_NAME, 'desktop')
    );
}

function persistContinuumShellModePreference(mode) {
    persistTaskbarStringPreference(TASKBAR_CONTINUUM_SHELL_MODE_VALUE_NAME, normalizeContinuumShellMode(mode));
}

function loadDesktopModernAppsPreference() {
    return loadTaskbarButtonVisibilityPreference(TASKBAR_OPEN_METRO_APPS_ON_DESKTOP_VALUE_NAME, false);
}

function loadDesktopWatermarkPreference() {
    return loadTaskbarButtonVisibilityPreference(TASKBAR_DESKTOP_WATERMARK_VALUE_NAME, true);
}

function setContinuumBetaEnabled(enabled, options = {}) {
    const normalized = !!enabled;
    const { persist = true } = options;
    const changed = continuumBetaEnabled !== normalized;

    continuumBetaEnabled = normalized;
    dispatchContinuumSettingsChanged();

    if (persist) {
        persistTaskbarButtonVisibilityPreference(TASKBAR_CONTINUUM_BETA_ENABLED_VALUE_NAME, normalized);
    }

    return changed;
}

function setDesktopModernAppsEnabled(enabled, options = {}) {
    const normalized = !!enabled;
    const { persist = true } = options;
    const changed = taskbarOpenMetroAppsOnDesktop !== normalized;

    taskbarOpenMetroAppsOnDesktop = normalized;

    if (persist) {
        persistTaskbarButtonVisibilityPreference(TASKBAR_OPEN_METRO_APPS_ON_DESKTOP_VALUE_NAME, normalized);
    }

    return changed;
}

function areDesktopModernAppsEnabled() {
    return thresholdFeaturesEnabled && taskbarOpenMetroAppsOnDesktop;
}

function setDesktopWatermarkEnabled(enabled, options = {}) {
    const normalized = !!enabled;
    const { persist = true } = options;
    const changed = desktopWatermarkEnabled !== normalized;

    desktopWatermarkEnabled = normalized;
    updateDesktopWatermark();

    if (persist) {
        persistTaskbarButtonVisibilityPreference(TASKBAR_DESKTOP_WATERMARK_VALUE_NAME, normalized);
    }

    return changed;
}

function setThresholdFeaturesEnabled(enabled, options = {}) {
    const normalized = !!enabled;
    const { persist = true } = options;
    const changed = thresholdFeaturesEnabled !== normalized;

    thresholdFeaturesEnabled = normalized;
    applyThresholdFeatureStates();

    if (persist) {
        persistTaskbarButtonVisibilityPreference(TASKBAR_THRESHOLD_FEATURES_ENABLED_VALUE_NAME, normalized);
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
    updateTaskbarUserTileFrame();

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

    if (getEffectiveTaskbarHeight() > 40) {
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
    const effectiveTaskbarHeight = getEffectiveTaskbarHeight();
    const reservedHeight = isAutoHidden ? 0 : effectiveTaskbarHeight;

    $body.css('--taskbar-reserved-height', `${reservedHeight}px`);
    $body.css('--taskbar-height', `${effectiveTaskbarHeight}px`);

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
            // Trace unexpected autohide on desktop to catch the culprit
            if (viewName !== 'desktop' && currentView === 'desktop') {
                console.warn('Taskbar autohide set with view=' + viewName + ' but currentView=desktop — caller:', new Error().stack);
            }
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
    refreshViewRegistry();

    syncWallColorContrastVariable(getComputedStyle(document.documentElement).getPropertyValue('--ui-wall-color').trim() || '#0078d7');
    const bootWarmupTasks = [];

    if (window.ShellUserProfile && typeof window.ShellUserProfile.initialize === 'function') {
        bootWarmupTasks.push(window.ShellUserProfile.initialize().catch((error) => {
            console.warn('[App] ShellUserProfile initialization failed:', error);
        }));
    }

    if (window.TimeBank && typeof window.TimeBank.initialize === 'function') {
        bootWarmupTasks.push(Promise.resolve(window.TimeBank.initialize()).catch((error) => {
            console.warn('[App] TimeBank initialization failed:', error);
        }));
        console.log('[TimeBank] Initialized and warmed during boot setup.');
    }
    if (window.TimeBank && typeof window.TimeBank.subscribe === 'function') {
        window.TimeBank.subscribe(updateLockTime, { immediate: true });
    } else {
        updateLockTime();
    }

    applyThresholdFeatureStates();
    initializeContinuumPrompt();
    window.addEventListener('win8-continuum-settings-changed', handleContinuumSettingsRuntimeChange);
    window.addEventListener('win8-device-posture-changed', handleContinuumDevicePostureChanged);
    $(window).on('resize.boot-logo', updateBootLogo);
    window.addEventListener('win8-display-settings-changed', updateBootLogo);

    showView('boot');

    cancelBootSequenceTimers();
    bootSequenceCompleted = false;

    // Load saved lock screen wallpaper
    bootWarmupTasks.push(Promise.resolve().then(() => {
        loadLockScreenWallpaper();
    }).catch((error) => {
        console.warn('[App] Failed to preload lock screen wallpaper during boot:', error);
    }));

    bootWarmupTasks.push(loadInitialBrightnessLevel().catch((error) => {
        console.warn('[App] Failed to preload brightness state during boot:', error);
    }));

    Promise.allSettled(bootWarmupTasks).finally(() => {
        bootWarmupReady.resolve();
    });

    // Initialize taskbar reserved height CSS variable
    updateTaskbarReservedHeight();

    // Initialize taskbar lock state
    updateTaskbarLockState();

    // Initialize taskbar resized class based on current height
    updateTaskbarResizedClass();

    handleContinuumSettingsRuntimeChange({
        detail: window.Win8ContinuumSettings || {
            enabled: isContinuumBetaActive()
        }
    });

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

    void transitionFromBootWhenReady($fadeToBlack);

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
    if (window.lockScreenInterval) {
        clearInterval(window.lockScreenInterval);
        window.lockScreenInterval = null;
    }
    if (window.TimeBank && typeof window.TimeBank.getSnapshot === 'function') {
        updateLockTime(window.TimeBank.getSnapshot());
    } else {
        updateLockTime();
    }

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

function updateLockTime(snapshot) {
    const now = snapshot && snapshot.now instanceof Date ? snapshot.now : new Date();
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
            initLoginScreen();
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
            initLoginScreen();
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
    $userPickerItem.off('click.loginscreen').on('click.loginscreen', function () {
        // Prevent multiple clicks during login sequence
        if (isLoginInProgress) {
            return;
        }
        isLoginInProgress = true;
        transitionToSigningIn();
    });

    // Refresh lock screen indicators when login screen is shown
    if (thresholdFeaturesEnabled) {
        updateLoginScreenIndicators();
    }

    // User list item click (Threshold modern lock screen)
    $('.login-user-list-item').off('click.loginscreen').on('click.loginscreen', function () {
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
            applySavedContinuumShellModeBeforeDesktopReveal();
            deferContinuumPromptDisplay(CONTINUUM_PROMPT_SIGN_IN_DEFER_MS);
            $desktop.addClass('visible');
            $('body').addClass('charms-allowed');
            updateTaskbarVisibility('desktop');
            primeContinuumStartSurfaceForSignIn();
            scheduleContinuumPromptMismatchCheck(CONTINUUM_PROMPT_SIGN_IN_DEFER_MS + 50);
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
                maybeOpenContinuumStartSurfaceOnSignIn();
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
const START_MENU_DEFAULT_FULLSCREEN_ROWS = 8;
const START_MENU_ANIMATION_CLASSES = 'menu-slide-out-left menu-slide-out-right menu-slide-in-left menu-slide-in-right menu-slide-out-up menu-slide-out-down menu-stagger-in menu-stagger-in-back menu-stagger-out menu-stagger-out-back';
const startMenuState = {
    pinnedIds: [],
    recentIds: [],
    allAppsOpen: false,
    searchOpen: false,
    query: '',
    searchSelectedAppId: null,
    fullscreenPreference: null,
    expandedFolders: {} // Track which folders are expanded: { folderName: true/false }
};
let contextMenuListMode = null;
let startMenuTileRows = null;
let startMenuPreferredTileRows = null;
let startMenuRowsManuallySized = false;
const startMenuLeftPaneAnimation = {
    token: 0,
    swapTimeout: null,
    cleanupTimeout: null
};
const startMenuResize = {
    active: false,
    pointerId: null,
    startY: 0,
    startRows: START_MENU_MIN_ROWS,
    minRows: START_MENU_MIN_ROWS,
    maxRows: START_MENU_MIN_ROWS
};
let startSurfaceResizeTimeout = null;
let startSurfaceViewportSignature = '';
const START_MENU_ENTRY_DRAG_THRESHOLD = 6;
const START_MENU_ENTRY_DRAG_CLICK_SUPPRESS_MS = 250;
const START_SURFACE_DESKTOP_TAP_CLICK_SUPPRESS_MS = 350;
const CONTINUUM_TASKBAR_START_SWIPE_OPEN_THRESHOLD = 44;
const CONTINUUM_TASKBAR_START_SWIPE_HORIZONTAL_CANCEL_THRESHOLD = 56;
const CONTINUUM_TASKBAR_START_SWIPE_CLICK_SUPPRESS_MS = 350;
const startMenuEntryDrag = {
    pending: false,
    active: false,
    pointerId: null,
    appId: null,
    sourceContext: null,
    sourceEntry: null,
    sourcePointerOffsetX: 0,
    sourcePointerOffsetY: 0,
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
    helper: null,
    helperMode: null,
    listDropIndex: null,
    tilePreviewActive: false,
    tilePreviewOrder: [],
    tileOriginalOrder: [],
    tilePreviewWasPinned: false,
    tilePreviewElement: null,
    hiddenEmptyState: null,
    suppressClickUntil: 0
};
let startSurfaceDesktopTapSuppressUntil = 0;
const continuumTaskbarStartSwipe = {
    active: false,
    engaged: false,
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
    suppressClickUntil: 0
};

applyStartMenuModePreference();

function hideStartMenuImmediately() {
    const $startMenu = $('#start-menu');
    if (!$startMenu.length) {
        return;
    }

    cancelStartMenuLeftPaneAnimation();
    endStartMenuResize();
    cleanupStartMenuEntryDrag();
    $startMenu.removeClass('visible');
    $('body').removeClass('start-menu-open taskbar-peek');
    hideStartMenuItemContextMenu();
    startMenuState.query = '';
    startMenuState.searchOpen = false;
    startMenuState.allAppsOpen = false;
    startMenuState.searchSelectedAppId = null;

    const searchInput = document.getElementById('start-menu-search-input');
    if (searchInput) {
        searchInput.value = '';
    }

    startReturnModernAppId = null;
    updateStartMenuViewState();
    updateStartMenuToggleButton();
    updateStartButtonVisualState();
}

function clearStartMenuLeftPaneAnimationTimers() {
    if (startMenuLeftPaneAnimation.swapTimeout) {
        clearTimeout(startMenuLeftPaneAnimation.swapTimeout);
        startMenuLeftPaneAnimation.swapTimeout = null;
    }

    if (startMenuLeftPaneAnimation.cleanupTimeout) {
        clearTimeout(startMenuLeftPaneAnimation.cleanupTimeout);
        startMenuLeftPaneAnimation.cleanupTimeout = null;
    }
}

function resetStartMenuLeftPaneAnimationState() {
    const top = document.querySelector('#start-menu .start-menu-top');
    const separator = document.querySelector('#start-menu .start-menu-left > .start-menu-list-separator');
    const scroll = document.querySelector('#start-menu .start-menu-left-scroll');
    const animatedElements = [
        top,
        separator,
        scroll,
        ...document.querySelectorAll('#start-menu-left-list > *')
    ].filter(Boolean);

    animatedElements.forEach(element => {
        element.classList.remove(
            'menu-slide-out-left',
            'menu-slide-out-right',
            'menu-slide-in-left',
            'menu-slide-in-right',
            'menu-slide-out-up',
            'menu-slide-out-down',
            'menu-stagger-in',
            'menu-stagger-in-back',
            'menu-stagger-out',
            'menu-stagger-out-back'
        );
        element.style.removeProperty('opacity');
        element.style.removeProperty('--stagger-delay');
        element.style.removeProperty('--stagger-duration');
    });
}

function cancelStartMenuLeftPaneAnimation() {
    startMenuLeftPaneAnimation.token += 1;
    clearStartMenuLeftPaneAnimationTimers();
    resetStartMenuLeftPaneAnimationState();
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
    const storedFullscreenPreference = registry && typeof registry.loadStartMenuFullscreenPreference === 'function'
        ? registry.loadStartMenuFullscreenPreference()
        : null;

    startMenuState.pinnedIds = normalizeStartMenuIds(
        storedPins,
        storedPins === null ? { fallback: DEFAULT_START_MENU_PINNED_IDS } : {}
    );
    startMenuState.recentIds = normalizeStartMenuIds(storedRecents).slice(0, MAX_START_MENU_RECENTS);
    startMenuPreferredTileRows = Number.isFinite(storedTileRows) ? storedTileRows : null;
    startMenuTileRows = startMenuPreferredTileRows;
    startMenuRowsManuallySized = Number.isFinite(startMenuPreferredTileRows);
    startMenuState.fullscreenPreference = typeof storedFullscreenPreference === 'boolean'
        ? storedFullscreenPreference
        : null;
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
        startMenuRowsManuallySized && Number.isFinite(startMenuPreferredTileRows)
            ? startMenuPreferredTileRows
            : null
    );
}

function saveStartMenuFullscreenPreference() {
    const registry = window.TileLayoutRegistry;
    if (!registry || typeof registry.saveStartMenuFullscreenPreference !== 'function') {
        return;
    }

    registry.saveStartMenuFullscreenPreference(startMenuState.fullscreenPreference);
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

function isStartMenuFullscreenActive() {
    if (typeof startMenuState.fullscreenPreference === 'boolean') {
        return startMenuState.fullscreenPreference;
    }

    return isContinuumTabletShellMode();
}

function updateStartMenuFullscreenButton() {
    const button = document.getElementById('start-menu-fullscreen-button');
    const symbol = document.getElementById('start-menu-fullscreen-symbol');
    if (!button) {
        return;
    }

    const fullscreenActive = isStartMenuFullscreenActive();
    const nextTitle = fullscreenActive ? 'Use compact Start' : 'Use full screen Start';

    button.setAttribute('aria-pressed', fullscreenActive ? 'true' : 'false');
    button.setAttribute('title', nextTitle);
    button.setAttribute('aria-label', nextTitle);

    if (symbol) {
        symbol.classList.toggle('sui-expand', !fullscreenActive);
        symbol.classList.toggle('sui-contract', fullscreenActive);
    }
}

function performStartMenuFullscreenSwap(swapFn) {
    clearTimeout(startMenuSwapReopenTimer);
    const wasOpen = isStartMenuOpen();
    if (wasOpen) {
        closeStartMenu({ suppressRestore: true });
        startMenuSwapReopenTimer = setTimeout(() => {
            swapFn();
            openStartMenu();
        }, START_MENU_SWAP_CLOSE_MS);
    } else {
        swapFn();
    }
}

function setStartMenuFullscreenPreference(nextPreference, options = {}) {
    const normalizedPreference = typeof nextPreference === 'boolean' ? nextPreference : null;
    if (startMenuState.fullscreenPreference === normalizedPreference) {
        updateStartMenuViewState();
        return;
    }

    if (options.skipTransition !== true) {
        const persist = options.persist !== false;
        const render = options.render !== false;
        performStartMenuFullscreenSwap(() => {
            startMenuState.fullscreenPreference = normalizedPreference;
            if (persist) saveStartMenuFullscreenPreference();
            updateStartMenuViewState();
            if (render && typeof renderStartMenu === 'function') renderStartMenu();
        });
        return;
    }

    startMenuState.fullscreenPreference = normalizedPreference;

    if (options.persist !== false) {
        saveStartMenuFullscreenPreference();
    }

    updateStartMenuViewState();

    if (options.render !== false && typeof renderStartMenu === 'function') {
        renderStartMenu();
    }
}

function toggleStartMenuFullscreenPreference() {
    setStartMenuFullscreenPreference(!isStartMenuFullscreenActive());
}

function handleStartMenuContinuumShellModeChanged() {
    if (typeof startMenuState.fullscreenPreference === 'boolean') {
        updateTabletStartHomeShellState();
        return;
    }

    updateStartMenuViewState();

    if (typeof renderStartMenu === 'function') {
        renderStartMenu();
    }
}

function shouldUseTabletStartHomeSurface() {
    return isStartMenuEnabled() && isContinuumTabletShellMode() && isStartMenuFullscreenActive();
}

function updateTabletStartHomeShellState() {
    if (typeof document === 'undefined' || !document.body) {
        return;
    }

    const tabletHomeActive = shouldUseTabletStartHomeSurface();
    const tabletHomeShaded = tabletHomeActive && (
        $('.modern-flyout.visible').length > 0 ||
        $('.charms-bar.visible.show-background').length > 0 ||
        isSearchPanelVisible()
    );

    document.body.classList.toggle('continuum-tablet-start-home', tabletHomeActive);
    document.body.classList.toggle('continuum-tablet-start-home-shaded', tabletHomeShaded);
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
    const hasGlyphIcon = window.AppsManager?.isGlyphIconClass?.(app.icon);
    const isModernApp = app.type === 'modern';
    let plateClass = isModernApp
        ? (app.color ? `app-icon-plate--${app.color}` : 'app-icon-plate--accent')
        : 'start-menu-entry__icon--plain';
    let iconHtml = '';

    if (hasGlyphIcon) {
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
    const adjustedColor = adjustBrightnessAndSaturation(baseColor, -30, +8, 1.7);

    document.documentElement.style.setProperty('--start-menu-color', adjustedColor);
}

function buildStartMenuEntryHtml(app, mode, { dense = false, subtitle = '', folderItem = false, depthLevel = 0 } = {}) {
    const { plateClass, iconHtml } = getStartMenuEntryIconMarkup(app, dense ? 28 : 32);
    const denseClass = dense ? ' start-menu-entry--dense' : '';
    const folderItemClass = folderItem ? ' start-menu-entry--folder-item' : '';
    const selectedClass = mode === 'search' && startMenuState.searchSelectedAppId === app.id
        ? ' start-menu-entry--selected'
        : '';
    const subtitleHtml = subtitle
        ? `<span class="start-menu-entry__subtitle">${escapeHtml(subtitle)}</span>`
        : '';

    // Calculate padding: folderItem apps get depthLevel * 18, regular apps get 3px
    const paddingLeft = folderItem ? depthLevel * 18 : 3;

    return `
        <button class="start-menu-entry${denseClass}${folderItemClass}${selectedClass}" data-app="${app.id}" data-context="${mode}" style="padding-left: ${paddingLeft}px;">
            <span class="start-menu-entry__icon ${plateClass}">${iconHtml}</span>
            <span class="start-menu-entry__text">
                <span class="start-menu-entry__label">${escapeHtml(app.name)}</span>
                ${subtitleHtml}
            </span>
        </button>
    `;
}

function consumeStartMenuEntryDragClickSuppression() {
    if (Date.now() >= startMenuEntryDrag.suppressClickUntil) {
        return false;
    }

    startMenuEntryDrag.suppressClickUntil = 0;
    return true;
}

function consumeStartSurfaceDesktopTapClickSuppression() {
    if (Date.now() >= startSurfaceDesktopTapSuppressUntil) {
        return false;
    }

    startSurfaceDesktopTapSuppressUntil = 0;
    return true;
}

function shouldEnableContinuumTaskbarStartSwipe() {
    return isContinuumBetaActive() &&
        isStartMenuEnabled() &&
        (currentView === 'desktop' || currentView === 'modern');
}

function resetContinuumTaskbarStartSwipeState() {
    continuumTaskbarStartSwipe.active = false;
    continuumTaskbarStartSwipe.engaged = false;
    continuumTaskbarStartSwipe.startX = 0;
    continuumTaskbarStartSwipe.startY = 0;
    continuumTaskbarStartSwipe.currentX = 0;
    continuumTaskbarStartSwipe.currentY = 0;
}

function beginContinuumTaskbarStartSwipe(touch) {
    resetContinuumTaskbarStartSwipeState();
    continuumTaskbarStartSwipe.active = true;
    continuumTaskbarStartSwipe.startX = touch.clientX;
    continuumTaskbarStartSwipe.startY = touch.clientY;
    continuumTaskbarStartSwipe.currentX = touch.clientX;
    continuumTaskbarStartSwipe.currentY = touch.clientY;
}

function updateContinuumTaskbarStartSwipe(touch) {
    if (!continuumTaskbarStartSwipe.active) {
        return false;
    }

    continuumTaskbarStartSwipe.currentX = touch.clientX;
    continuumTaskbarStartSwipe.currentY = touch.clientY;

    const revealAmount = Math.max(0, continuumTaskbarStartSwipe.startY - touch.clientY);
    const horizontalDistance = Math.abs(touch.clientX - continuumTaskbarStartSwipe.startX);

    if (!continuumTaskbarStartSwipe.engaged) {
        if (horizontalDistance > CONTINUUM_TASKBAR_START_SWIPE_HORIZONTAL_CANCEL_THRESHOLD &&
            revealAmount < CONTINUUM_TASKBAR_START_SWIPE_OPEN_THRESHOLD) {
            resetContinuumTaskbarStartSwipeState();
            return false;
        }

        if (revealAmount >= CONTINUUM_TASKBAR_START_SWIPE_OPEN_THRESHOLD) {
            continuumTaskbarStartSwipe.engaged = true;
        }
    }

    return continuumTaskbarStartSwipe.engaged;
}

function finishContinuumTaskbarStartSwipe() {
    if (!continuumTaskbarStartSwipe.active) {
        return false;
    }

    const revealAmount = Math.max(0, continuumTaskbarStartSwipe.startY - continuumTaskbarStartSwipe.currentY);
    const shouldOpen = continuumTaskbarStartSwipe.engaged &&
        revealAmount >= CONTINUUM_TASKBAR_START_SWIPE_OPEN_THRESHOLD &&
        shouldEnableContinuumTaskbarStartSwipe();

    resetContinuumTaskbarStartSwipeState();

    if (!shouldOpen) {
        return false;
    }

    continuumTaskbarStartSwipe.suppressClickUntil = Date.now() + CONTINUUM_TASKBAR_START_SWIPE_CLICK_SUPPRESS_MS;

    if (!isStartSurfaceVisible()) {
        openStartSurface();
    }

    return true;
}

function arraysEqual(left, right) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
        return false;
    }

    for (let index = 0; index < left.length; index += 1) {
        if (left[index] !== right[index]) {
            return false;
        }
    }

    return true;
}

function isPointInsideRect(x, y, rect) {
    return rect &&
        x >= rect.left &&
        x <= rect.right &&
        y >= rect.top &&
        y <= rect.bottom;
}

function getStartMenuLeftListElement() {
    return document.getElementById('start-menu-left-list');
}

function getStartMenuRightPaneElement() {
    return document.querySelector('#start-menu .start-menu-right');
}

function getStartMenuTilesElement() {
    return document.getElementById('start-menu-tiles');
}

function getStartMenuPinnedEntryElements() {
    return Array.from(document.querySelectorAll('#start-menu-left-list .start-menu-entry[data-context="pinned"]'));
}

function clearStartMenuPinnedDropIndicators() {
    $('.start-menu-entry--drag-insert-before, .start-menu-entry--drag-insert-after')
        .removeClass('start-menu-entry--drag-insert-before start-menu-entry--drag-insert-after');
}

function removeStartMenuDragHelper() {
    if (startMenuEntryDrag.helper) {
        startMenuEntryDrag.helper.remove();
        startMenuEntryDrag.helper = null;
    }

    startMenuEntryDrag.helperMode = null;
}

function buildStartMenuTileDragHelper(app) {
    const temp = document.createElement('div');
    temp.innerHTML = AppsManager.generateTileHTML(app).trim();
    const helper = temp.firstElementChild;

    if (!helper) {
        return null;
    }

    helper.classList.add('start-menu-drag-helper', 'start-menu-drag-helper--tile');
    helper.removeAttribute('href');
    helper.setAttribute('aria-hidden', 'true');
    helper.setAttribute('tabindex', '-1');
    helper.setAttribute('draggable', 'false');
    return helper;
}

function setStartMenuDragHelperMode(mode) {
    if (!startMenuEntryDrag.active || startMenuEntryDrag.helperMode === mode) {
        return;
    }

    removeStartMenuDragHelper();

    let helper = null;
    if (mode === 'tile') {
        const app = AppsManager.getAppById(startMenuEntryDrag.appId);
        if (app) {
            helper = buildStartMenuTileDragHelper(app);
        }
    } else if (startMenuEntryDrag.sourceEntry) {
        helper = startMenuEntryDrag.sourceEntry.cloneNode(true);
        helper.classList.add('start-menu-drag-helper', 'start-menu-drag-helper--list');
        helper.classList.remove(
            'start-menu-entry--drag-source',
            'start-menu-entry--drag-insert-before',
            'start-menu-entry--drag-insert-after'
        );
        helper.setAttribute('aria-hidden', 'true');
        helper.setAttribute('tabindex', '-1');
    }

    if (!helper) {
        return;
    }

    document.body.appendChild(helper);
    startMenuEntryDrag.helper = helper;
    startMenuEntryDrag.helperMode = mode;
    updateStartMenuDragHelperPosition(startMenuEntryDrag.currentX, startMenuEntryDrag.currentY);
}

function updateStartMenuDragHelperPosition(clientX, clientY) {
    const helper = startMenuEntryDrag.helper;
    if (!helper) {
        return;
    }

    if (startMenuEntryDrag.helperMode === 'tile') {
        const helperRect = helper.getBoundingClientRect();
        helper.style.left = `${clientX - (helperRect.width / 2)}px`;
        helper.style.top = `${clientY - (helperRect.height / 2)}px`;
    } else {
        helper.style.left = `${clientX - startMenuEntryDrag.sourcePointerOffsetX}px`;
        helper.style.top = `${clientY - startMenuEntryDrag.sourcePointerOffsetY}px`;
    }
}

function getStartMenuEntryCurrentTileOrder() {
    const tilesContainer = getStartMenuTilesElement();
    if (!tilesContainer) {
        return [];
    }

    if (window.TileDrag && typeof window.TileDrag.getCurrentOrder === 'function') {
        return window.TileDrag.getCurrentOrder(tilesContainer).filter(Boolean);
    }

    return Array.from(tilesContainer.querySelectorAll('.tiles__tile'))
        .map(tile => tile.getAttribute('data-app'))
        .filter(Boolean);
}

function applyStartMenuTilePreviewOrder(order) {
    const tilesContainer = getStartMenuTilesElement();
    if (!tilesContainer || !Array.isArray(order) || order.length === 0) {
        return;
    }

    if (window.TileDrag && typeof window.TileDrag.previewOrder === 'function') {
        window.TileDrag.previewOrder(order, tilesContainer);
        return;
    }

    const maxRows = typeof getStartMenuTileRowsForDrag === 'function'
        ? getStartMenuTileRowsForDrag()
        : resolveStartMenuTileRows(startMenuRowsManuallySized ? startMenuPreferredTileRows : null).rows;
    const previewApps = order
        .map(id => AppsManager.getAppById(id))
        .filter(Boolean);
    const previewLayout = calculateTileLayout(previewApps, maxRows);
    const tileMap = new Map(
        Array.from(tilesContainer.querySelectorAll('.tiles__tile'))
            .map(tile => [tile.getAttribute('data-app'), tile])
    );

    previewLayout.tiles.forEach(tileInfo => {
        const tile = tileMap.get(tileInfo.app.id);
        if (!tile) {
            return;
        }

        tile.style.gridRow = `${tileInfo.row} / span ${tileInfo.size.rows}`;
        tile.style.gridColumn = `${tileInfo.col} / span ${tileInfo.size.cols}`;
    });
}

function getSquaredDistanceToRect(x, y, rect) {
    const dx = x < rect.left
        ? rect.left - x
        : (x > rect.right ? x - rect.right : 0);
    const dy = y < rect.top
        ? rect.top - y
        : (y > rect.bottom ? y - rect.bottom : 0);

    return (dx * dx) + (dy * dy);
}

function getPredictedStartMenuTileRect(tileInfo, containerRect, tileSize, gap) {
    const left = containerRect.left + ((tileInfo.col - 1) * (tileSize + gap));
    const top = containerRect.top + ((tileInfo.row - 1) * (tileSize + gap));
    const width = (tileInfo.size.cols * tileSize) + (Math.max(0, tileInfo.size.cols - 1) * gap);
    const height = (tileInfo.size.rows * tileSize) + (Math.max(0, tileInfo.size.rows - 1) * gap);

    return {
        left,
        top,
        right: left + width,
        bottom: top + height
    };
}

function getStartMenuTileDropIndex(appId, baseOrder, clientX, clientY) {
    const tilesContainer = getStartMenuTilesElement();
    if (!tilesContainer) {
        return baseOrder.length;
    }

    const rows = typeof getStartMenuTileRowsForDrag === 'function'
        ? getStartMenuTileRowsForDrag()
        : resolveStartMenuTileRows(startMenuRowsManuallySized ? startMenuPreferredTileRows : null).rows;
    const { tileSize, gap } = getStartMenuTileGridSizing();
    const containerRect = tilesContainer.getBoundingClientRect();
    let bestIndex = baseOrder.length;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let index = 0; index <= baseOrder.length; index += 1) {
        const candidateOrder = [
            ...baseOrder.slice(0, index),
            appId,
            ...baseOrder.slice(index)
        ];
        const candidateApps = candidateOrder
            .map(id => AppsManager.getAppById(id))
            .filter(Boolean);
        const candidateLayout = calculateTileLayout(candidateApps, rows);
        const tileInfo = candidateLayout.tiles.find(tile => tile.app && tile.app.id === appId);
        if (!tileInfo) {
            continue;
        }

        const predictedRect = getPredictedStartMenuTileRect(tileInfo, containerRect, tileSize, gap);
        const distance = getSquaredDistanceToRect(clientX, clientY, predictedRect);

        if (distance < bestDistance) {
            bestDistance = distance;
            bestIndex = index;
        }
    }

    return bestIndex;
}

function ensureStartMenuTilePreviewElement(appId) {
    const tilesContainer = getStartMenuTilesElement();
    if (!tilesContainer) {
        return null;
    }

    const existingTile = tilesContainer.querySelector(`.tiles__tile[data-app="${appId}"]`);
    if (existingTile) {
        existingTile.classList.add('start-menu-list-drag-preview-tile');
        startMenuEntryDrag.tilePreviewElement = existingTile;
        return existingTile;
    }

    const app = AppsManager.getAppById(appId);
    if (!app) {
        return null;
    }

    const emptyState = tilesContainer.querySelector('.start-menu-empty-state--tiles');
    if (emptyState) {
        emptyState.classList.add('start-menu-empty-state--hidden');
        startMenuEntryDrag.hiddenEmptyState = emptyState;
    }

    const previewTile = buildStartMenuTileDragHelper(app);
    if (!previewTile) {
        return null;
    }

    previewTile.classList.remove('start-menu-drag-helper', 'start-menu-drag-helper--tile');
    previewTile.classList.add('start-menu-list-drag-preview-tile');
    tilesContainer.appendChild(previewTile);
    startMenuEntryDrag.tilePreviewElement = previewTile;
    return previewTile;
}

function clearStartMenuTilePreview(restoreOriginalOrder = true) {
    const previewElement = startMenuEntryDrag.tilePreviewElement;
    if (previewElement) {
        if (startMenuEntryDrag.tilePreviewWasPinned) {
            previewElement.classList.remove('start-menu-list-drag-preview-tile');
        } else {
            previewElement.remove();
        }
    }

    if (startMenuEntryDrag.hiddenEmptyState) {
        startMenuEntryDrag.hiddenEmptyState.classList.remove('start-menu-empty-state--hidden');
        startMenuEntryDrag.hiddenEmptyState = null;
    }

    if (restoreOriginalOrder && startMenuEntryDrag.tileOriginalOrder.length > 0) {
        applyStartMenuTilePreviewOrder(startMenuEntryDrag.tileOriginalOrder);
    }

    startMenuEntryDrag.tilePreviewElement = null;
    startMenuEntryDrag.tilePreviewOrder = [];
    startMenuEntryDrag.tileOriginalOrder = [];
    startMenuEntryDrag.tilePreviewWasPinned = false;
    startMenuEntryDrag.tilePreviewActive = false;
    document.body.classList.remove('tile-drag-active');
}

function isStartMenuTilePaneHoverTarget(clientX, clientY) {
    const rightPane = getStartMenuRightPaneElement();
    if (!rightPane || rightPane.offsetParent === null) {
        return false;
    }

    return isPointInsideRect(clientX, clientY, rightPane.getBoundingClientRect());
}

function updateStartMenuTilePreview(clientX, clientY) {
    const appId = startMenuEntryDrag.appId;
    if (!appId) {
        return;
    }

    if (!startMenuEntryDrag.tilePreviewActive) {
        startMenuEntryDrag.tileOriginalOrder = getStartMenuEntryCurrentTileOrder();
        startMenuEntryDrag.tilePreviewWasPinned = startMenuEntryDrag.tileOriginalOrder.includes(appId);
        ensureStartMenuTilePreviewElement(appId);
        startMenuEntryDrag.tilePreviewActive = true;
        document.body.classList.add('tile-drag-active');
    }

    setStartMenuDragHelperMode('tile');

    const baseOrder = startMenuEntryDrag.tileOriginalOrder.filter(id => id !== appId);
    const nextIndex = getStartMenuTileDropIndex(appId, baseOrder, clientX, clientY);
    const nextOrder = [
        ...baseOrder.slice(0, nextIndex),
        appId,
        ...baseOrder.slice(nextIndex)
    ];

    if (!arraysEqual(startMenuEntryDrag.tilePreviewOrder, nextOrder)) {
        startMenuEntryDrag.tilePreviewOrder = nextOrder;
        applyStartMenuTilePreviewOrder(nextOrder);
    }
}

function getStartMenuPinnedListDropIndex(clientX, clientY) {
    const listElement = getStartMenuLeftListElement();
    if (!listElement || !startMenuEntryDrag.active || startMenuEntryDrag.sourceContext !== 'pinned') {
        return null;
    }

    const listRect = listElement.getBoundingClientRect();
    if (clientX < listRect.left || clientX > listRect.right) {
        return null;
    }

    const remainingEntries = getStartMenuPinnedEntryElements()
        .filter(entry => entry !== startMenuEntryDrag.sourceEntry);
    if (remainingEntries.length === 0) {
        return 0;
    }

    for (let index = 0; index < remainingEntries.length; index += 1) {
        const rect = remainingEntries[index].getBoundingClientRect();
        if (clientY < rect.top + (rect.height / 2)) {
            return index;
        }
    }

    return remainingEntries.length;
}

function updateStartMenuPinnedListDropIndicator(clientX, clientY) {
    clearStartMenuPinnedDropIndicators();

    const insertIndex = getStartMenuPinnedListDropIndex(clientX, clientY);
    startMenuEntryDrag.listDropIndex = insertIndex;
    if (insertIndex == null) {
        return;
    }

    const remainingEntries = getStartMenuPinnedEntryElements()
        .filter(entry => entry !== startMenuEntryDrag.sourceEntry);

    if (insertIndex < remainingEntries.length) {
        remainingEntries[insertIndex].classList.add('start-menu-entry--drag-insert-before');
    } else if (remainingEntries.length > 0) {
        remainingEntries[remainingEntries.length - 1].classList.add('start-menu-entry--drag-insert-after');
    }
}

function activateStartMenuEntryDrag() {
    if (startMenuEntryDrag.active || !startMenuEntryDrag.pending || !startMenuEntryDrag.sourceEntry) {
        return;
    }

    startMenuEntryDrag.pending = false;
    startMenuEntryDrag.active = true;
    startMenuEntryDrag.sourceEntry.classList.add('start-menu-entry--drag-source');
    document.body.classList.add('start-menu-entry-dragging');
    hideStartMenuItemContextMenu();
    setStartMenuDragHelperMode('list');
    updateStartMenuDragHelperPosition(startMenuEntryDrag.currentX, startMenuEntryDrag.currentY);
}

function cleanupStartMenuEntryDrag({ restoreTilePreview = true } = {}) {
    if (restoreTilePreview) {
        clearStartMenuTilePreview(true);
    } else {
        clearStartMenuTilePreview(false);
    }

    clearStartMenuPinnedDropIndicators();
    removeStartMenuDragHelper();

    if (startMenuEntryDrag.sourceEntry) {
        if (startMenuEntryDrag.pointerId != null &&
            typeof startMenuEntryDrag.sourceEntry.releasePointerCapture === 'function') {
            try {
                if (typeof startMenuEntryDrag.sourceEntry.hasPointerCapture !== 'function' ||
                    startMenuEntryDrag.sourceEntry.hasPointerCapture(startMenuEntryDrag.pointerId)) {
                    startMenuEntryDrag.sourceEntry.releasePointerCapture(startMenuEntryDrag.pointerId);
                }
            } catch (_error) { }
        }
        startMenuEntryDrag.sourceEntry.classList.remove('start-menu-entry--drag-source');
    }

    document.body.classList.remove('start-menu-entry-dragging');

    startMenuEntryDrag.pending = false;
    startMenuEntryDrag.active = false;
    startMenuEntryDrag.pointerId = null;
    startMenuEntryDrag.appId = null;
    startMenuEntryDrag.sourceContext = null;
    startMenuEntryDrag.sourceEntry = null;
    startMenuEntryDrag.sourcePointerOffsetX = 0;
    startMenuEntryDrag.sourcePointerOffsetY = 0;
    startMenuEntryDrag.startX = 0;
    startMenuEntryDrag.startY = 0;
    startMenuEntryDrag.currentX = 0;
    startMenuEntryDrag.currentY = 0;
    startMenuEntryDrag.listDropIndex = null;
}

function commitStartMenuPinnedListDrop() {
    if (startMenuEntryDrag.sourceContext !== 'pinned' || startMenuEntryDrag.listDropIndex == null) {
        return false;
    }

    const remainingIds = startMenuState.pinnedIds.filter(id => id !== startMenuEntryDrag.appId);
    const nextIndex = Math.max(0, Math.min(startMenuEntryDrag.listDropIndex, remainingIds.length));
    const nextPinnedIds = [
        ...remainingIds.slice(0, nextIndex),
        startMenuEntryDrag.appId,
        ...remainingIds.slice(nextIndex)
    ];

    if (arraysEqual(startMenuState.pinnedIds, nextPinnedIds)) {
        return false;
    }

    startMenuState.pinnedIds = nextPinnedIds;
    saveStartMenuState();
    renderStartMenuLeftPane();
    return true;
}

function commitStartMenuTileDrop() {
    if (!startMenuEntryDrag.tilePreviewActive || startMenuEntryDrag.tilePreviewOrder.length === 0) {
        return false;
    }

    if (window.AppsManager && typeof AppsManager.setPinState === 'function') {
        AppsManager.setPinState(startMenuEntryDrag.appId, true);
    } else {
        const app = AppsManager.getAppById(startMenuEntryDrag.appId);
        if (app) {
            app.pinned = true;
        }
    }

    if (window.TileDrag && typeof window.TileDrag.saveOrder === 'function') {
        window.TileDrag.saveOrder(startMenuEntryDrag.tilePreviewOrder);
    }

    renderPinnedTiles();
    renderAllAppsList();
    renderStartMenuTiles();
    return true;
}

function startPendingStartMenuEntryDrag(event, entryElement) {
    if (!isStartMenuOpen() || !entryElement || event.isPrimary === false) {
        return;
    }

    const pointerType = event.pointerType || 'mouse';
    if (pointerType === 'mouse' && event.button !== 0) {
        return;
    }

    const appId = entryElement.getAttribute('data-app');
    const app = appId ? AppsManager.getAppById(appId) : null;
    if (!app) {
        return;
    }

    cleanupStartMenuEntryDrag();

    const rect = entryElement.getBoundingClientRect();
    startMenuEntryDrag.pointerId = event.pointerId ?? null;
    startMenuEntryDrag.pending = true;
    startMenuEntryDrag.active = false;
    startMenuEntryDrag.appId = appId;
    startMenuEntryDrag.sourceContext = entryElement.getAttribute('data-context');
    startMenuEntryDrag.sourceEntry = entryElement;
    startMenuEntryDrag.sourcePointerOffsetX = event.clientX - rect.left;
    startMenuEntryDrag.sourcePointerOffsetY = event.clientY - rect.top;
    startMenuEntryDrag.startX = event.clientX;
    startMenuEntryDrag.startY = event.clientY;
    startMenuEntryDrag.currentX = event.clientX;
    startMenuEntryDrag.currentY = event.clientY;

    if (startMenuEntryDrag.pointerId != null &&
        typeof entryElement.setPointerCapture === 'function') {
        try {
            entryElement.setPointerCapture(startMenuEntryDrag.pointerId);
        } catch (_error) { }
    }
}

function updateStartMenuEntryDrag(clientX, clientY) {
    if (!startMenuEntryDrag.pending && !startMenuEntryDrag.active) {
        return;
    }

    startMenuEntryDrag.currentX = clientX;
    startMenuEntryDrag.currentY = clientY;

    if (!startMenuEntryDrag.active) {
        const deltaX = clientX - startMenuEntryDrag.startX;
        const deltaY = clientY - startMenuEntryDrag.startY;
        if (Math.hypot(deltaX, deltaY) < START_MENU_ENTRY_DRAG_THRESHOLD) {
            return;
        }

        activateStartMenuEntryDrag();
    }

    if (!startMenuEntryDrag.active) {
        return;
    }

    if (isStartMenuTilePaneHoverTarget(clientX, clientY)) {
        clearStartMenuPinnedDropIndicators();
        startMenuEntryDrag.listDropIndex = null;
        updateStartMenuTilePreview(clientX, clientY);
    } else {
        if (startMenuEntryDrag.tilePreviewActive) {
            clearStartMenuTilePreview(true);
        }

        setStartMenuDragHelperMode('list');
        updateStartMenuPinnedListDropIndicator(clientX, clientY);
    }

    updateStartMenuDragHelperPosition(clientX, clientY);
}

function shouldHandleStartMenuEntryDragPointer(event) {
    if (!startMenuEntryDrag.pending && !startMenuEntryDrag.active) {
        return false;
    }

    if (startMenuEntryDrag.pointerId == null || event.pointerId == null) {
        return true;
    }

    return startMenuEntryDrag.pointerId === event.pointerId;
}

function finishStartMenuEntryDrag() {
    if (!startMenuEntryDrag.pending && !startMenuEntryDrag.active) {
        return false;
    }

    if (!startMenuEntryDrag.active) {
        cleanupStartMenuEntryDrag();
        return false;
    }

    let committed = false;
    if (startMenuEntryDrag.tilePreviewActive) {
        committed = commitStartMenuTileDrop();
        cleanupStartMenuEntryDrag({ restoreTilePreview: false });
    } else {
        committed = commitStartMenuPinnedListDrop();
        cleanupStartMenuEntryDrag();
    }

    startMenuEntryDrag.suppressClickUntil = Date.now() + START_MENU_ENTRY_DRAG_CLICK_SUPPRESS_MS;
    return committed;
}

function cancelStartMenuEntryDrag() {
    if (!startMenuEntryDrag.pending && !startMenuEntryDrag.active) {
        return false;
    }

    cleanupStartMenuEntryDrag();
    return true;
}

function updateStartMenuViewState() {
    const $startMenu = $('#start-menu');
    if (!$startMenu.length) {
        updateTabletStartHomeShellState();
        return;
    }

    const isSearchOpen = Boolean(startMenuState.searchOpen);
    const isAllAppsOpen = Boolean(startMenuState.allAppsOpen) && !isSearchOpen;
    const isFullscreenActive = isStartMenuFullscreenActive();

    $startMenu.toggleClass('start-menu--search', isSearchOpen);
    $startMenu.toggleClass('start-menu--all-apps', isAllAppsOpen);
    $startMenu.toggleClass('start-menu--fullscreen', isFullscreenActive);
    updateStartMenuFullscreenButton();
    updateTabletStartHomeShellState();
}

function updateStartMenuToggleButton() {
    const $button = $('#start-menu-all-apps-toggle');
    if (!$button.length) {
        return;
    }

    const showingAllApps = startMenuState.allAppsOpen && !startMenuState.searchOpen;
    $button.find('.start-menu-all-apps-text').text(showingAllApps ? 'Back' : 'All apps');
    $button.find('.start-menu-all-apps-icon > span')
        .toggleClass('sui-arrow-down', !showingAllApps)
        .toggleClass('sui-arrow-up', showingAllApps);
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

    if (window.OneSearch && typeof OneSearch.search === 'function') {
        const results = OneSearch.search({
            query: needle,
            sources: ['apps'],
            mode: 'start',
            context: 'start-menu'
        });

        return results
            .map(result => AppsManager.getAppById(result?.action?.appId))
            .filter(Boolean);
    }

    return sortAppsForStartMenu(getStartMenuEligibleApps()).filter(app =>
        (app.name || '').toLowerCase().includes(needle)
    );
}

function syncStartMenuSearchSelection(results) {
    if (!Array.isArray(results) || results.length === 0) {
        startMenuState.searchSelectedAppId = null;
        return null;
    }

    const selectedAppId = startMenuState.searchSelectedAppId;
    if (selectedAppId && results.some(app => app.id === selectedAppId)) {
        return selectedAppId;
    }

    startMenuState.searchSelectedAppId = results[0].id;
    return startMenuState.searchSelectedAppId;
}

function updateStartMenuSearchSelectionUi() {
    const selectedAppId = startMenuState.searchSelectedAppId;
    $('#start-menu-left-list .start-menu-entry[data-context="search"]').each(function () {
        $(this).toggleClass('start-menu-entry--selected', $(this).attr('data-app') === selectedAppId);
    });
}

function activateStartMenuSearchResult(appId) {
    if (!appId || !AppsManager.getAppById(appId)) {
        return false;
    }

    launchApp(appId);
    closeStartMenu({ forceDesktop: true, suppressRestore: true });
    return true;
}

function setStartMenuSearchQuery(nextQuery, options = {}) {
    const {
        focusInput = false,
        preserveSearchMode = true
    } = options;
    const normalizedQuery = typeof nextQuery === 'string' ? nextQuery : '';
    const searchInput = document.getElementById('start-menu-search-input');

    cancelStartMenuLeftPaneAnimation();
    startMenuState.query = normalizedQuery;
    startMenuState.searchSelectedAppId = null;

    if ((preserveSearchMode && startMenuState.searchOpen) || normalizedQuery.trim()) {
        startMenuState.searchOpen = true;
        startMenuState.allAppsOpen = false;
    } else {
        startMenuState.searchOpen = false;
    }

    if (searchInput && searchInput.value !== normalizedQuery) {
        searchInput.value = normalizedQuery;
    }

    renderStartMenuLeftPane();

    if (focusInput && searchInput) {
        searchInput.focus();
        searchInput.setSelectionRange(normalizedQuery.length, normalizedQuery.length);
    }
}

function shouldRouteKeyToStartMenuSearch(event) {
    if (!isStartMenuOpen() || event.defaultPrevented || event.isComposing) {
        return false;
    }

    if (isStartMenuFullscreenActive()) {
        return false;
    }

    if (event.metaKey || event.ctrlKey || event.altKey) {
        return false;
    }

    const target = event.target;
    if (!(target instanceof Element)) {
        return false;
    }

    if (target.closest('#start-menu-search-input')) {
        return false;
    }

    if (target.closest('#start-menu') && (
        target.matches('input, textarea, select') ||
        target.isContentEditable ||
        target.closest('[contenteditable=\"\"], [contenteditable=\"true\"]')
    )) {
        return false;
    }

    if (event.key === 'Backspace') {
        return startMenuState.searchOpen || !!startMenuState.query;
    }

    if (event.key.length !== 1) {
        return false;
    }

    if (!startMenuState.query && !event.key.trim()) {
        return false;
    }

    return true;
}

function renderStartMenuLeftPane() {
    const $list = $('#start-menu-left-list');
    if (!$list.length || !window.AppsManager) {
        return;
    }

    const isSearchOpen = Boolean(startMenuState.searchOpen);
    const query = startMenuState.query.trim();
    const normalizedQuery = query.toLowerCase();
    let html = '';

    if (isSearchOpen) {
        const results = getStartMenuSearchResults(normalizedQuery);
        syncStartMenuSearchSelection(results);

        if (results.length > 0) {
            results.forEach(app => {
                html += buildStartMenuEntryHtml(app, 'search', { dense: false });
            });
        } else {
            html += normalizedQuery
                ? '<div class="start-menu-empty-state">No matching apps.</div>'
                : '<div class="start-menu-empty-state">Type to search apps.</div>';
        }
    } else if (startMenuState.allAppsOpen) {
        const allEligibleApps = getStartMenuEligibleApps();

        // Separate modern and desktop apps
        const modernApps = allEligibleApps.filter(app => app.type === 'modern');
        const desktopApps = allEligibleApps.filter(app => app.type === 'classic' || app.type === 'meta-classic');

        // Sort modern apps alphabetically
        modernApps.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        // Render modern apps
        modernApps.forEach(app => {
            html += buildStartMenuEntryHtml(app, 'all-apps', { dense: true });
        });

        // Separate desktop apps with folders from those without
        const appsWithFolder = desktopApps.filter(app => app.folder);
        const appsWithoutFolder = desktopApps.filter(app => !app.folder);

        // Render apps without folder first (alphabetically)
        appsWithoutFolder.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        appsWithoutFolder.forEach(app => {
            html += buildStartMenuEntryHtml(app, 'all-apps', { dense: true });
        });

        // Build a tree structure for nested folders
        const folderTree = {};
        appsWithFolder.forEach(app => {
            const parts = app.folder.split('/');
            let current = folderTree;

            for (let i = 0; i < parts.length; i++) {
                const folderName = parts[i];
                if (!current[folderName]) {
                    current[folderName] = {
                        _apps: [],
                        _children: {}
                    };
                }

                if (i === parts.length - 1) {
                    current[folderName]._apps.push(app);
                } else {
                    current = current[folderName]._children;
                }
            }
        });

        // Helper function to render folders recursively
        const renderFolderTree = (treeNode, parentPath = '') => {
            const folders = Object.keys(treeNode).sort();

            folders.forEach(folderName => {
                const folderPath = parentPath ? `${parentPath}/${folderName}` : folderName;
                const isExpanded = startMenuState.expandedFolders[folderPath] || false;
                const expandedClass = isExpanded ? ' start-menu-folder-entry--expanded' : '';

                // Calculate nesting depth based on folder path
                const nestingDepth = folderPath.split('/').length - 1;
                const folderPadding = nestingDepth * 18;

                // Render folder entry
                html += `
                    <button class="start-menu-entry start-menu-entry--dense start-menu-folder-entry${expandedClass}" data-folder="${folderPath}" data-context="folder" style="padding-left: ${folderPadding}px;">
                        <span class="start-menu-entry__icon start-menu-folder-icon">
                            <img src="resources/images/icons/explorer/generic_folder/16.png" class="start-menu-folder-icon-img" draggable="false" />
                        </span>
                        <span class="start-menu-entry__text">
                            <span class="start-menu-entry__label">${escapeHtml(folderName)}</span>
                        </span>
                    </button>
                `;

                // Render contents if expanded
                if (isExpanded) {
                    const folder = treeNode[folderName];

                    // Render apps in this folder
                    if (folder._apps.length > 0) {
                        folder._apps.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
                        folder._apps.forEach(app => {
                            html += buildStartMenuEntryHtml(app, 'all-apps', {
                                dense: true,
                                folderItem: true,
                                depthLevel: nestingDepth + 1
                            });
                        });
                    }

                    // Render child folders recursively
                    renderFolderTree(folder._children, folderPath);
                }
            });
        };

        // Render the folder tree (at the bottom) - only top-level folders
        renderFolderTree(folderTree, '');
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
    updateStartMenuViewState();
    updateStartMenuToggleButton();
}

function getStartMenuChromeMetrics() {
    const topHeight = $('.start-menu-top').outerHeight() || 57;
    const topSeparatorHeight = $('#start-menu .start-menu-left > .start-menu-list-separator').outerHeight(true) || 0;
    const bottomHeight = $('.start-menu-bottom').outerHeight() || 92;
    const rightPaddingTop = parseInt($('.start-menu-right').css('padding-top'), 10) || 7;
    const rightPaddingBottom = parseInt($('.start-menu-right').css('padding-bottom'), 10) || 7;
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
    const viewportMargin = isStartMenuFullscreenActive() ? 0 : 16;
    const availableHeight = Math.max(0, window.innerHeight - getTaskbarHeightForLayout() - viewportMargin - rightChromeHeight);
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
    const rightPaddingLeft = parseInt($('.start-menu-right').css('padding-left'), 10) || 7;
    const rightPaddingRight = parseInt($('.start-menu-right').css('padding-right'), 10) || 7;
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
    const fullscreenActive = isStartMenuFullscreenActive();

    let candidate;
    if (!fullscreenActive && preferredRows != null) {
        candidate = preferredRows;
    } else if (!fullscreenActive && startMenuRowsManuallySized && Number.isFinite(startMenuPreferredTileRows)) {
        candidate = startMenuPreferredTileRows;
    } else if (fullscreenActive) {
        candidate = Math.max(
            bounds.minRows,
            Math.min(bounds.maxRows, START_MENU_DEFAULT_FULLSCREEN_ROWS)
        );
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
    const dimensions = resolveStartMenuTileRows(startMenuRowsManuallySized ? startMenuPreferredTileRows : null);
    const gridValue = `repeat(${dimensions.rows}, ${dimensions.tileSize}px)`;
    const fullscreenMotionProfile = isStartMenuFullscreenActive() ? 'start-menu-fullscreen' : null;

    applyStartMenuShellSize(dimensions);
    $tilesContainer.css('grid-template-rows', gridValue);
    $tilesContainer.toggleClass('start-menu-tiles--fullscreen-motion', Boolean(fullscreenMotionProfile));

    if (pinnedApps.length === 0) {
        $tilesContainer.html('<p class="start-menu-empty-state start-menu-empty-state--tiles">No tiles pinned.</p>');
        return;
    }

    $tilesContainer.html(buildPositionedTileGridHtml(pinnedApps, dimensions.layout, {
        motionProfile: fullscreenMotionProfile,
        rowCount: dimensions.rows
    }));

    setTimeout(() => {
        initializeTiles();

        if (window.TileDrag && typeof window.TileDrag.refresh === 'function') {
            window.TileDrag.refresh();
        }
    }, 0);
}

function getStartMenuTileRowsForDrag() {
    return resolveStartMenuTileRows(startMenuRowsManuallySized ? startMenuPreferredTileRows : null).rows;
}

window.getStartMenuTileRowsForDrag = getStartMenuTileRowsForDrag;

function renderStartMenu() {
    cancelStartMenuLeftPaneAnimation();
    updateStartMenuThemeColor();
    renderStartMenuLeftPane();
    renderStartMenuTiles();
    updateStartMenuViewState();
    updateStartMenuFullscreenButton();
    updateStartButtonVisualState();
}

function syncStartSurfacesToViewport(options = {}) {
    const { force = false } = options;
    const viewportSignature = `${window.innerWidth}x${window.innerHeight}:${getTaskbarHeightForLayout()}`;
    if (!force && viewportSignature === startSurfaceViewportSignature) {
        return;
    }

    startSurfaceViewportSignature = viewportSignature;

    calculateTileRows();
    renderPinnedTiles();
    renderAllAppsList();

    if (!isStartMenuEnabled()) {
        return;
    }

    if (startMenuResize.active) {
        const bounds = getStartMenuRowBounds();
        startMenuResize.minRows = bounds.minRows;
        startMenuResize.maxRows = bounds.maxRows;
        return;
    }

    renderStartMenu();
}

function scheduleStartSurfaceViewportSync(delay = 100, options = {}) {
    const { force = false } = options;

    if (startSurfaceResizeTimeout) {
        clearTimeout(startSurfaceResizeTimeout);
    }

    startSurfaceResizeTimeout = setTimeout(() => {
        startSurfaceResizeTimeout = null;
        syncStartSurfacesToViewport({ force });
    }, delay);
}

function hideStartMenuItemContextMenu() {
    hideContextMenu();
}

function getContextMenuViewportBounds(viewportPadding = 10) {
    const taskbarReservedHeight = Math.max(0, getTaskbarReservedHeight());

    return {
        left: viewportPadding,
        top: viewportPadding,
        right: Math.max(viewportPadding, window.innerWidth - viewportPadding),
        bottom: Math.max(viewportPadding, window.innerHeight - taskbarReservedHeight - viewportPadding)
    };
}

function measureContextMenuDimensions($menu, displayValue = 'block') {
    const menuElement = $menu.get(0);
    if (!menuElement) {
        return { width: 0, height: 0 };
    }

    const computedStyle = window.getComputedStyle(menuElement);
    const isHidden = computedStyle.display === 'none';
    const inlineDisplay = menuElement.style.display;
    const inlineVisibility = menuElement.style.visibility;

    if (isHidden) {
        $menu.css({
            display: displayValue,
            visibility: 'hidden'
        });
    }

    const width = $menu.outerWidth();
    const height = $menu.outerHeight();

    if (isHidden) {
        $menu.css({
            display: inlineDisplay,
            visibility: inlineVisibility
        });
    }

    return { width, height };
}

function positionContextMenuAtCursor($menu, x, y, options = {}) {
    const {
        displayValue = 'block',
        viewportPadding = 10,
        cursorGap = 6
    } = options;
    const bounds = getContextMenuViewportBounds(viewportPadding);
    const { width: menuWidth, height: menuHeight } = measureContextMenuDimensions($menu, displayValue);
    const maxLeft = Math.max(bounds.left, bounds.right - menuWidth);
    const maxTop = Math.max(bounds.top, bounds.bottom - menuHeight);
    const availableBelow = bounds.bottom - y - cursorGap;
    const availableAbove = y - cursorGap - bounds.top;

    let left = Math.min(Math.max(x, bounds.left), maxLeft);
    let top = y + cursorGap;

    if (menuHeight > availableBelow && availableAbove > availableBelow) {
        top = y - menuHeight - cursorGap;
    }

    top = Math.min(Math.max(top, bounds.top), maxTop);

    $menu.css({
        left: left + 'px',
        top: top + 'px'
    });
}

function positionStartSurfaceContextMenu($menu, x, y) {
    positionContextMenuAtCursor($menu, x, y, {
        displayValue: 'block'
    });
}

function positionModernContextSubmenu($item) {
    const $submenu = $item.children('.context-submenu');
    if (!$submenu.length) {
        return;
    }

    const bounds = getContextMenuViewportBounds();
    const { width: submenuWidth, height: submenuHeight } = measureContextMenuDimensions($submenu, 'block');
    const itemRect = $item.get(0).getBoundingClientRect();
    const defaultTop = -4;
    const availableRight = bounds.right - itemRect.right;
    const availableLeft = itemRect.left - bounds.left;
    const shouldOpenLeft = submenuWidth > availableRight && availableLeft > availableRight;

    let top = defaultTop;
    let submenuTop = itemRect.top + top;
    const submenuBottom = submenuTop + submenuHeight;

    if (submenuBottom > bounds.bottom) {
        top -= submenuBottom - bounds.bottom;
        submenuTop = itemRect.top + top;
    }

    if (submenuTop < bounds.top) {
        top += bounds.top - submenuTop;
    }

    $submenu.css({
        left: shouldOpenLeft ? 'auto' : '100%',
        right: shouldOpenLeft ? '100%' : 'auto',
        top: top + 'px',
        bottom: 'auto'
    });
}

function positionClassicContextSubmenu($item) {
    const $submenu = $item.children('.classic-context-submenu');
    if (!$submenu.length) {
        return;
    }

    const overlap = 6;
    const bounds = getContextMenuViewportBounds();
    const { width: submenuWidth, height: submenuHeight } = measureContextMenuDimensions($submenu, 'flex');
    const itemRect = $item.get(0).getBoundingClientRect();
    const defaultTop = -2;
    const availableRight = bounds.right - (itemRect.right - overlap);
    const availableLeft = (itemRect.left + overlap) - bounds.left;
    const shouldOpenLeft = submenuWidth > availableRight && availableLeft > availableRight;

    let top = defaultTop;
    let submenuTop = itemRect.top + top;
    const submenuBottom = submenuTop + submenuHeight;

    if (submenuBottom > bounds.bottom) {
        top -= submenuBottom - bounds.bottom;
        submenuTop = itemRect.top + top;
    }

    if (submenuTop < bounds.top) {
        top += bounds.top - submenuTop;
    }

    $submenu.css({
        left: shouldOpenLeft ? 'auto' : `calc(100% - ${overlap}px)`,
        right: shouldOpenLeft ? `calc(100% - ${overlap}px)` : 'auto',
        top: top + 'px',
        bottom: 'auto'
    });
}

function showStartMenuItemContextMenu(x, y, appId, mode) {
    showContextMenu(x, y, appId, null, mode);
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

    cancelStartMenuLeftPaneAnimation();
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

    cancelStartMenuLeftPaneAnimation();
    endStartMenuResize();
    cleanupStartMenuEntryDrag();
    hideStartMenuItemContextMenu();
    $('.start-power-menu, .user-tile-dropdown').removeClass('active');
    $('#start-menu').removeClass('visible');
    $('body').removeClass('start-menu-open taskbar-peek');

    startMenuState.query = '';
    startMenuState.searchOpen = false;
    startMenuState.searchSelectedAppId = null;
    const searchInput = document.getElementById('start-menu-search-input');
    if (searchInput) {
        searchInput.value = '';
    }

    startMenuState.allAppsOpen = false;
    updateStartMenuViewState();
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
    const keepHeaderVisible = isStartMenuFullscreenActive();

    if (wasAllAppsOpen === nextState) {
        return;
    }

    cancelStartMenuLeftPaneAnimation();
    const transitionToken = startMenuLeftPaneAnimation.token;
    const $scroll = $('.start-menu-left-scroll');

    // Clear search state
    startMenuState.searchOpen = false;
    startMenuState.query = '';
    startMenuState.searchSelectedAppId = null;
    const searchInput = document.getElementById('start-menu-search-input');
    if (searchInput) {
        searchInput.value = '';
    }

    if (!$scroll.length) {
        startMenuState.allAppsOpen = nextState;
        renderStartMenuLeftPane();
        return;
    }

    // Opening all apps: pinned staggers up/out; all apps staggers up from bottom
    // Going back: all apps staggers down/out; pinned staggers down from top
    const outStaggerClass = nextState ? 'menu-stagger-out' : 'menu-stagger-out-back';
    const outClass = nextState ? 'menu-slide-out-up' : 'menu-slide-out-down'; // for $top/$sep
    const inStaggerClass = nextState ? 'menu-stagger-in' : 'menu-stagger-in-back';

    const $top = $('#start-menu .start-menu-top');
    const $sep = $('#start-menu .start-menu-left > .start-menu-list-separator');

    // How many items are visible in the scroll container right now?
    // Use the first item's height as a proxy; fall back to 38px if the list is empty.
    const exitList = document.getElementById('start-menu-left-list');
    const exitItems = exitList ? Array.from(exitList.children) : [];
    const scrollEl = $scroll[0];

    function visibleItemCount(itemEls, containerEl) {
        if (!itemEls.length || !containerEl) return 0;
        const containerH = containerEl.clientHeight;
        const itemH = itemEls[0].getBoundingClientRect().height || 38;
        return Math.min(itemEls.length, Math.ceil(containerH / itemH));
    }

    // Phase 1: stagger visible exit items individually; off-screen ones exit as a group
    const exitVisible = visibleItemCount(exitItems, scrollEl);

    exitItems.forEach((el, i) => {
        el.classList.remove('menu-stagger-in', 'menu-stagger-in-back');
        // Visible items: 14ms per step. Off-screen: same delay as the last visible item.
        const step = i < exitVisible ? i : (exitVisible - 1);
        el.style.setProperty('--stagger-delay', `${Math.max(step, 0) * 14}ms`);
        el.classList.add(outStaggerClass);
    });

    if (!keepHeaderVisible && !wasAllAppsOpen) {
        $top.removeClass(START_MENU_ANIMATION_CLASSES);
        $sep.removeClass(START_MENU_ANIMATION_CLASSES);
        void $top[0].offsetHeight;
        $top.addClass(outClass);
        $sep.addClass(outClass);
    }

    const exitMaxDelay = Math.max(exitVisible - 1, 0) * 14;
    const exitTotalMs = 90 + exitMaxDelay;

    // Phase 2: After items have exited, swap content and stagger in
    startMenuLeftPaneAnimation.swapTimeout = setTimeout(() => {
        startMenuLeftPaneAnimation.swapTimeout = null;
        if (transitionToken !== startMenuLeftPaneAnimation.token) {
            return;
        }

        $scroll.css('opacity', '0');
        exitItems.forEach(el => {
            el.classList.remove('menu-stagger-out', 'menu-stagger-out-back');
            el.style.removeProperty('--stagger-delay');
        });

        if (!keepHeaderVisible && !wasAllAppsOpen) {
            $top.css('opacity', '0');
            $sep.css('opacity', '0');
            $top.removeClass(outClass);
            $sep.removeClass(outClass);
        }

        startMenuState.allAppsOpen = nextState;
        renderStartMenuLeftPane();

        // Measure visible count for the incoming list.
        const list = document.getElementById('start-menu-left-list');
        const items = list ? Array.from(list.children) : [];
        const inVisible = visibleItemCount(items, scrollEl);

        // Stagger visible items individually; off-screen items float in as a group
        // at the same delay as the last visible item.
        items.forEach((el, i) => {
            const step = i < inVisible ? i : (inVisible - 1);
            el.style.setProperty('--stagger-delay', `${Math.max(step, 0) * 30}ms`);
            // Item 0 leads like the first coil of a slinky — noticeably snappier
            el.style.setProperty('--stagger-duration', i === 0 ? '150ms' : '220ms');
            el.classList.add(inStaggerClass);
        });

        if (!keepHeaderVisible && !nextState) {
            $top.removeClass(START_MENU_ANIMATION_CLASSES);
            $sep.removeClass(START_MENU_ANIMATION_CLASSES);
            if ($top[0]) {
                $top[0].style.setProperty('--stagger-delay', '0ms');
                $top[0].style.setProperty('--stagger-duration', '150ms');
            }
            if ($sep[0]) {
                $sep[0].style.setProperty('--stagger-delay', '0ms');
                $sep[0].style.setProperty('--stagger-duration', '150ms');
            }
            $top.addClass(inStaggerClass);
            $sep.addClass(inStaggerClass);
        }

        // Force reflow so items are painted at their from-keyframe before reveal
        if (list) void list.offsetHeight;

        // Reveal — items are already at opacity:0 so no flash
        $scroll.css('opacity', '');

        if (!keepHeaderVisible && !nextState) {
            $top.css('opacity', '');
            $sep.css('opacity', '');
        }

        const maxDelay = Math.max(inVisible - 1, 0) * 30;
        startMenuLeftPaneAnimation.cleanupTimeout = setTimeout(() => {
            startMenuLeftPaneAnimation.cleanupTimeout = null;
            if (transitionToken !== startMenuLeftPaneAnimation.token) {
                return;
            }

            items.forEach(el => {
                el.classList.remove('menu-stagger-in', 'menu-stagger-in-back');
                el.style.removeProperty('--stagger-delay');
                el.style.removeProperty('--stagger-duration');
            });
            $top.removeClass(START_MENU_ANIMATION_CLASSES);
            $sep.removeClass(START_MENU_ANIMATION_CLASSES);
            if ($top[0]) {
                $top[0].style.removeProperty('--stagger-delay');
                $top[0].style.removeProperty('--stagger-duration');
            }
            if ($sep[0]) {
                $sep[0].style.removeProperty('--stagger-delay');
                $sep[0].style.removeProperty('--stagger-duration');
            }
        }, 220 + maxDelay + 20);
    }, exitTotalMs + 10);
}

function beginStartMenuResize(clientY, pointerId = null) {
    if (isStartMenuFullscreenActive()) {
        return;
    }

    const bounds = getStartMenuRowBounds();
    startMenuResize.active = true;
    startMenuResize.pointerId = pointerId;
    startMenuResize.startY = clientY;
    startMenuResize.startRows = resolveStartMenuTileRows(startMenuRowsManuallySized ? startMenuPreferredTileRows : null).rows;
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

    if (nextRows !== startMenuPreferredTileRows || nextRows !== startMenuTileRows) {
        startMenuRowsManuallySized = true;
        startMenuPreferredTileRows = nextRows;
        startMenuTileRows = nextRows;
        renderStartMenuTiles();
    }
}

function endStartMenuResize() {
    if (!startMenuResize.active) {
        return;
    }

    startMenuResize.active = false;
    startMenuResize.pointerId = null;
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
    try {
        // Load apps data
        await AppsManager.loadApps();
        await initializeRecycleBinTileState();
        bindRecycleBinTileEvents();
        loadStartMenuState();

        try {
            await syncHostWallpaperThemeIfNeeded();
        } catch (error) {
            console.warn('[App] Failed to refresh synced host wallpaper theme:', error);
        }

        // Apply saved wallpaper settings (position, slideshow, etc.)
        try {
            await applySavedWallpaperSettings();
        } catch (error) {
            console.warn('[App] Failed to apply saved wallpaper settings:', error);
        }

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

        // Recalculate Start surfaces on window resize.
        $(window)
            .off('resize.start-surfaces')
            .on('resize.start-surfaces', function () {
                scheduleStartSurfaceViewportSync(100);
            });

        // Recalculate rows when window is fully loaded and sized
        $(window).on('load', function () {
            // Small delay to ensure Electron window has finished sizing
            setTimeout(function () {
                console.log('Window fully loaded, recalculating Start surface layout...');
                syncStartSurfacesToViewport({ force: true });
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

        document.addEventListener('touchmove', function (e) {
            if (!startScreenTouchDrag.active) {
                return;
            }

            if (!isStartScreenTouchSwipeContext()) {
                resetStartScreenTouchDragState();
                return;
            }

            if (!e.touches || e.touches.length !== 1) {
                resetStartScreenTouchDragState();
                return;
            }

            const touch = e.touches[0];
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
        }, { passive: false });

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

        // Swipe up/down on left pane: swipe up → all apps, swipe down → back to pinned
        const smLeftSwipe = { active: false, startX: 0, startY: 0, inScrollEl: false, scrollAtStart: 0, scrollMaxAtStart: 0 };

        $(document).on('touchstart.smleftswipe', function (e) {
            const leftEl = document.querySelector('#start-menu .start-menu-left');
            if (!leftEl || !leftEl.contains(e.target)) return;

            const touch = e.originalEvent.touches[0];
            if (!touch) return;

            const scrollEl = document.querySelector('.start-menu-left-scroll');
            smLeftSwipe.active = true;
            smLeftSwipe.startX = touch.clientX;
            smLeftSwipe.startY = touch.clientY;
            smLeftSwipe.inScrollEl = !!(scrollEl && scrollEl.contains(e.target));
            smLeftSwipe.scrollAtStart = scrollEl ? scrollEl.scrollTop : 0;
            smLeftSwipe.scrollMaxAtStart = scrollEl ? Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight) : 0;
        });

        $(document).on('touchend.smleftswipe touchcancel.smleftswipe', function (e) {
            if (!smLeftSwipe.active) return;
            smLeftSwipe.active = false;

            if (startMenuState.searchOpen) return;

            const touch = e.originalEvent.changedTouches[0];
            if (!touch) return;

            const deltaX = touch.clientX - smLeftSwipe.startX;
            const deltaY = touch.clientY - smLeftSwipe.startY;

            if (Math.abs(deltaY) < 50 || Math.abs(deltaY) < Math.abs(deltaX) * 2) return;

            const { inScrollEl, scrollAtStart, scrollMaxAtStart } = smLeftSwipe;

            if (deltaY < 0) {
                // Swipe up → open all apps (if scroll is at its bottom or touch wasn't in the scroll area)
                const atScrollBottom = scrollAtStart >= scrollMaxAtStart - 2;
                if (!startMenuState.allAppsOpen && (!inScrollEl || atScrollBottom)) {
                    toggleStartMenuAllApps(true);
                }
            } else {
                // Swipe down → go back to pinned (if scroll is at its top or touch wasn't in the scroll area)
                const atScrollTop = scrollAtStart <= 2;
                if (startMenuState.allAppsOpen && (!inScrollEl || atScrollTop)) {
                    toggleStartMenuAllApps(false);
                }
            }
        });

        $('#start-menu-fullscreen-button').on('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            toggleStartMenuFullscreenPreference();
        });

        $('#start-menu-search-input').on('input', function () {
            setStartMenuSearchQuery($(this).val() || '');
        });

        $('#start-menu-search-input').on('keydown', function (e) {
            if (e.key === 'Escape') {
                e.preventDefault();
                if (startMenuState.query.trim()) {
                    setStartMenuSearchQuery('');
                } else {
                    closeStartMenu({ forceDesktop: false });
                }
                return;
            }

            if (e.key === 'Enter') {
                const selectedAppId = syncStartMenuSearchSelection(getStartMenuSearchResults(startMenuState.query));
                if (selectedAppId) {
                    e.preventDefault();
                    activateStartMenuSearchResult(selectedAppId);
                }
            }
        });

        $(document).on('keydown', function (e) {
            if (!shouldRouteKeyToStartMenuSearch(e)) {
                return;
            }

            const nextQuery = e.key === 'Backspace'
                ? startMenuState.query.slice(0, -1)
                : startMenuState.query + e.key;

            e.preventDefault();
            setStartMenuSearchQuery(nextQuery, { focusInput: true });
        });

        $('#start-menu-search-button').on('click', function (e) {
            e.preventDefault();
            e.stopPropagation();

            const query = startMenuState.query.trim();
            if (!query) {
                $('#start-menu-search-input').trigger('focus');
                return;
            }

            const selectedAppId = syncStartMenuSearchSelection(getStartMenuSearchResults(query));
            if (selectedAppId) {
                activateStartMenuSearchResult(selectedAppId);
            }
        });

        window.addEventListener('win8-continuum-shell-mode-changed', handleStartMenuContinuumShellModeChanged);

        $('.start-menu-resize-handle').on('pointerdown', function (e) {
            if (!isStartMenuOpen()) {
                return;
            }

            if (e.pointerType === 'mouse' && e.button !== 0) {
                return;
            }

            if (e.isPrimary === false) {
                return;
            }

            e.preventDefault();
            e.stopPropagation();

            if (typeof this.setPointerCapture === 'function') {
                try {
                    this.setPointerCapture(e.pointerId);
                } catch (error) {
                    console.debug('Unable to capture start menu resize pointer:', error);
                }
            }

            beginStartMenuResize(e.clientY, e.pointerId);
        });

        $(document).on('pointermove.startmenuresize', function (e) {
            if (!startMenuResize.active || e.pointerId !== startMenuResize.pointerId) {
                return;
            }

            updateStartMenuResize(e.clientY);
            e.preventDefault();
        });

        $(document).on('pointerup.startmenuresize pointercancel.startmenuresize', function (e) {
            if (!startMenuResize.active || e.pointerId !== startMenuResize.pointerId) {
                return;
            }

            const handle = document.querySelector('.start-menu-resize-handle');
            if (handle && typeof handle.releasePointerCapture === 'function') {
                try {
                    if (typeof handle.hasPointerCapture !== 'function' || handle.hasPointerCapture(e.pointerId)) {
                        handle.releasePointerCapture(e.pointerId);
                    }
                } catch (error) {
                    console.debug('Unable to release start menu resize pointer:', error);
                }
            }

            endStartMenuResize();
        });

        $(document).on('pointerdown', '.start-menu-entry', function (e) {
            if (e.pointerType === 'mouse' && (e.button === 2 || e.which === 3)) {
                return;
            }

            startPendingStartMenuEntryDrag(e, this);
        });

        $(document).on('pointermove.startmenuentrydrag', function (e) {
            if (!shouldHandleStartMenuEntryDragPointer(e)) {
                return;
            }

            updateStartMenuEntryDrag(e.clientX, e.clientY);

            if (startMenuEntryDrag.active && e.cancelable) {
                e.preventDefault();
            }
        });

        $(document).on('pointerup.startmenuentrydrag', function (e) {
            if (!shouldHandleStartMenuEntryDragPointer(e)) {
                return;
            }

            finishStartMenuEntryDrag();
        });

        $(document).on('pointercancel.startmenuentrydrag', function (e) {
            if (!shouldHandleStartMenuEntryDragPointer(e)) {
                return;
            }

            cancelStartMenuEntryDrag();
        });

        $(document).on('click', '.start-menu-entry', function (e) {
            if (e.button === 2 || e.which === 3) {
                return;
            }

            if (consumeStartMenuEntryDragClickSuppression() || consumeStartSurfaceDesktopTapClickSuppression()) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }

            e.preventDefault();
            e.stopPropagation();

            // Handle folder toggle
            const folderName = $(this).attr('data-folder');
            if (folderName && $(this).attr('data-context') === 'folder') {
                startMenuState.expandedFolders[folderName] = !startMenuState.expandedFolders[folderName];
                renderStartMenuLeftPane();
                return;
            }

            const appId = $(this).attr('data-app');
            if ($(this).attr('data-context') === 'search') {
                startMenuState.searchSelectedAppId = appId;
                updateStartMenuSearchSelectionUi();
            }

            activateStartMenuSearchResult(appId);
        });

        $(document).on('mouseenter', '#start-menu-left-list .start-menu-entry[data-context="search"]', function () {
            const appId = $(this).attr('data-app');
            if (!appId || startMenuState.searchSelectedAppId === appId) {
                return;
            }

            startMenuState.searchSelectedAppId = appId;
            updateStartMenuSearchSelectionUi();
        });

        $(document).on('contextmenu', '.start-menu-entry', function (e) {
            if (startMenuEntryDrag.active || startMenuEntryDrag.pending) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }

            e.preventDefault();
            e.stopPropagation();

            const appId = $(this).attr('data-app');
            const mode = $(this).attr('data-context');
            showStartMenuItemContextMenu(e.pageX, e.pageY, appId, mode);
        });

        $(document).on('mousedown', function (e) {
            if (!isStartMenuOpen()) {
                return;
            }

            if (startMenuEntryDrag.active || startMenuEntryDrag.pending) {
                return;
            }

            if (shouldUseTabletStartHomeSurface()) {
                return;
            }

            if ($(e.target).closest('#start-menu, #app-context-menu, .start-power-menu, .user-tile-dropdown, .taskbar .start-button, .floating-start-button-container, .start-button-trigger.bottom-left').length) {
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

            if (consumeStartSurfaceDesktopTapClickSuppression()) {
                e.preventDefault();
                e.stopPropagation();
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

        // Global message handler for store and market app installations
        window.addEventListener('message', function (e) {
            if (e.data && e.data.type === 'STORE_APP_INSTALLED') {
                handleStoreAppInstalled(e.data.app);
            } else if (e.data && e.data.type === 'STORE_APP_UNINSTALLED') {
                handleStoreAppUninstalled(e.data.appId);
            } else if (e.data && e.data.type === 'MARKET_APP_INSTALLED') {
                handleMarketAppInstalled(e.data.app);
            } else if (e.data && e.data.type === 'MARKET_APP_UNINSTALLED') {
                handleMarketAppUninstalled(e.data.appId);
            }
        });
    } catch (error) {
        console.error('[App] Shell startup initialization failed:', error);
    } finally {
        shellStartupReady.resolve();
    }
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

    const flipIcon = getModernAppSplashImage(app);

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

    const targetAppId = typeof app.launchTargetAppId === 'string' && app.launchTargetAppId
        ? app.launchTargetAppId
        : appId;
    const targetApp = targetAppId === appId
        ? app
        : AppsManager.getAppById(targetAppId);

    if (!targetApp) {
        console.error('Launch target app not found:', targetAppId, 'for app:', appId);
        return;
    }

    const mergedLaunchOptions = {
        ...(app.launchOptions || {}),
        ...(launchOptions || {})
    };
    const shouldCloseStartSurfaceAfterLaunch = isStartSurfaceVisible();
    const scheduleStartSurfaceCloseAfterLaunch = () => {
        if (!shouldCloseStartSurfaceAfterLaunch) {
            return;
        }

        setTimeout(function () {
            if (isStartSurfaceVisible()) {
                closeStartSurface({ forceDesktop: true, suppressRestore: true });
            }
        }, 0);
    };

    if (isContinuumTabletShellMode() && continuumStartSurfaceAutoOpenTimer) {
        scheduleContinuumStartSurfaceAutoOpen();
    }

    // Prevent rapid duplicate launches from start screen (debounce at launch level)
    // This catches double-clicks on tiles before they queue up delayed opens
    if (!mergedLaunchOptions.fromTaskbar && $clickedTile && $clickedTile.length > 0) {
        const now = Date.now();
        const lastLaunch = launchingApps.get(appId);
        if (lastLaunch && (now - lastLaunch) < 500) {
            console.log('Prevented duplicate tile launch of:', appId, '(too soon after previous launch)');
            return;
        }
        launchingApps.set(appId, now);
    }

    console.log('Launching app:', appId, 'Target:', targetAppId, 'Type:', targetApp.type);
    recordStartMenuLaunch(appId);

    // Determine if we should show the flip animation (only for modern apps when tile was clicked)
    let shouldAnimate = targetApp.type === 'modern' && $clickedTile && $clickedTile.length > 0;
    if (mergedLaunchOptions.fromTaskbar) {
        shouldAnimate = false;
    }

    // Clear tile-level debounce so openClassicApp's own debounce doesn't conflict
    launchingApps.delete(appId);

    switch (targetApp.type) {
        case 'meta':
            // Meta apps have special behavior (like Desktop tile)
            if (targetAppId === 'desktop') {
                console.log('Showing desktop view');
                transitionToDesktop();
            }
            scheduleStartSurfaceCloseAfterLaunch();
            break;

        case 'modern':
            if (areDesktopModernAppsEnabled()) {
                console.log('Opening modern app on desktop:', targetAppId);
                openModernAppOnDesktop(targetApp, mergedLaunchOptions);
            } else {
                // Modern apps open in fullscreen with animation
                console.log('Opening modern app:', targetAppId);
                if (shouldAnimate) {
                    showTileFlipAnimation(app, $clickedTile, () => {
                        openModernApp(targetApp, mergedLaunchOptions);
                    });
                } else {
                    openModernApp(targetApp, mergedLaunchOptions);
                }
            }
            scheduleStartSurfaceCloseAfterLaunch();
            break;

        case 'classic':
            // Classic apps open on the desktop
            console.log('Opening classic app:', targetAppId);

            const openClassicAppWithTransition = () => {
                const hasActiveModernApp = hasActiveFullscreenModernApps();

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
                        openClassicApp(targetApp, mergedLaunchOptions);
                    }, 500);
                    return null;
                } else {
                    return openClassicApp(targetApp, mergedLaunchOptions);
                }
            };

            // Classic apps should switch to desktop, not use flip animation
            if ($clickedTile && $clickedTile.length > 0 && !mergedLaunchOptions.fromTaskbar) {
                // User clicked a tile on Start screen - transition to desktop first
                scheduleStartSurfaceCloseAfterLaunch();
                return openClassicAppWithTransition();
            } else {
                // Launched from taskbar or already on desktop
                scheduleStartSurfaceCloseAfterLaunch();
                return openClassicAppWithTransition();
            }


        case 'meta-classic':
            // Meta-classic apps open on desktop (like Taskbar Properties, Run dialog)
            console.log('Opening meta-classic app:', targetAppId);

            const openClassicWithTransition = () => {
                const hasActiveModernApp = hasActiveFullscreenModernApps();

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
                        openClassicApp(targetApp, mergedLaunchOptions);
                    }, 500);
                } else {
                    openClassicApp(targetApp, mergedLaunchOptions);
                }
            };

            if (shouldAnimate) {
                showTileFlipAnimation(app, $clickedTile, openClassicWithTransition);
            } else {
                openClassicWithTransition();
            }
            scheduleStartSurfaceCloseAfterLaunch();
            break;

        default:
            console.log('Unknown app type:', targetApp.type, 'for app:', targetAppId);
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
            icon: AppsManager.getIconImage(registeredApp, 40) || registeredApp.icon || 'sui-download',
            title: `${registeredApp.name} was installed.`,
            description: '',
            appId: 'msstore', // Notification is sent by the Store app
            iconContainerColor: getAppTileColor(registeredApp.color),
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
            if (isModernDesktopWindow(appId)) {
                closeClassicApp(appId);
            } else if (runningApp.app.type === 'modern') {
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

// Handle market app installation
function handleMarketAppInstalled(app) {
    console.log('Market app installed:', app.id);

    const registeredApp = AppsManager.addOrUpdateApp(app) || app;

    // Refresh UI
    renderPinnedTiles();
    renderAllAppsList();
    AppsManager.updateTaskbar();

    // Show notification
    if (window.notificationManager) {
        window.notificationManager.show({
            icon: AppsManager.getIconImage(registeredApp, 40) || registeredApp.icon || 'sui-download',
            title: `${registeredApp.name} was installed.`,
            description: '',
            appId: 'msstore',
            iconContainerColor: getAppTileColor(registeredApp.color),
            onClick: () => {
                console.log('Launching app from notification:', registeredApp.id);
                launchApp(registeredApp.id);
            }
        });
    }
}

// Handle market app uninstallation
function handleMarketAppUninstalled(appId) {
    console.log('Market app uninstalled:', appId);

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
            if (isModernDesktopWindow(appId)) {
                closeClassicApp(appId);
            } else if (runningApp.app.type === 'modern') {
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

function getRunningWindowData(windowIdOrAppId) {
    const isWindowId = windowIdOrAppId && windowIdOrAppId.includes('-') &&
        windowIdOrAppId.split('-').length >= 3;

    if (isWindowId) {
        return AppsManager.getRunningWindow(windowIdOrAppId) || null;
    }

    if (AppsManager.getPrimaryAppWindow) {
        return AppsManager.getPrimaryAppWindow(windowIdOrAppId) || null;
    }

    const windows = AppsManager.getAppWindows(windowIdOrAppId);
    return windows.length > 0 ? windows[0] : null;
}

function isFullscreenModernWindowData(windowData) {
    return !!windowData?.$container?.hasClass('modern-app-container');
}

function isModernDesktopWindowData(windowData) {
    return !!windowData?.$container?.hasClass('modern-desktop-app-container');
}

function isModernAppWindowData(windowData) {
    return isFullscreenModernWindowData(windowData) || isModernDesktopWindowData(windowData);
}

function isModernDesktopWindow(windowIdOrAppId) {
    return isModernDesktopWindowData(getRunningWindowData(windowIdOrAppId));
}

function resolveTaskbarAppLaunchContext(appOrId) {
    const app = typeof appOrId === 'string' ? AppsManager.getAppById(appOrId) : appOrId;
    if (!app) {
        return { app: null, targetApp: null };
    }

    const targetAppId = typeof app.launchTargetAppId === 'string' && app.launchTargetAppId
        ? app.launchTargetAppId
        : app.id;
    const targetApp = targetAppId === app.id
        ? app
        : AppsManager.getAppById(targetAppId);

    return { app, targetApp };
}

function canOpenNewTaskbarAppWindow(appOrId) {
    const { targetApp } = resolveTaskbarAppLaunchContext(appOrId);
    if (!targetApp) {
        return false;
    }

    if (targetApp.type === 'modern' && !areDesktopModernAppsEnabled()) {
        return false;
    }

    return targetApp.allowMultipleWindows === true;
}

function tryOpenNewTaskbarAppWindow(appOrId, launchOptions = {}) {
    const { app } = resolveTaskbarAppLaunchContext(appOrId);
    if (!app || !canOpenNewTaskbarAppWindow(app)) {
        return false;
    }

    launchApp(app, null, {
        fromTaskbar: true,
        ...(launchOptions || {})
    });
    return true;
}

function focusOrRestoreTaskbarApp(appOrId) {
    const app = typeof appOrId === 'string' ? AppsManager.getAppById(appOrId) : appOrId;
    if (!app) {
        return false;
    }

    const appState = AppsManager.getAppState(app.id);
    if (appState === null) {
        return false;
    }

    const usesDesktopWindowBehavior = isModernDesktopWindow(app.id) ||
        app.type === 'meta-classic' ||
        app.type === 'classic';

    if (appState === 'minimized') {
        if (usesDesktopWindowBehavior) {
            restoreClassicWindow(app.id);
        } else if (app.type === 'modern') {
            restoreModernApp(app.id);
        }
        return true;
    }

    if (usesDesktopWindowBehavior) {
        focusClassicWindow(app.id);
    } else if (app.type === 'modern') {
        restoreModernApp(app.id);
    }

    return true;
}

function launchOrFocusTaskbarApp(appOrId, launchOptions = {}) {
    const app = typeof appOrId === 'string' ? AppsManager.getAppById(appOrId) : appOrId;
    if (!app) {
        return false;
    }

    if (tryOpenNewTaskbarAppWindow(app, launchOptions)) {
        return true;
    }

    if (focusOrRestoreTaskbarApp(app)) {
        return true;
    }

    launchApp(app, null, {
        fromTaskbar: true,
        ...(launchOptions || {})
    });
    return true;
}

function hasActiveFullscreenModernApps() {
    return AppsManager.getRunningApps().some(running =>
        isFullscreenModernWindowData(running) && running.state === 'active'
    );
}

function getModernAppTitlebarIconModel(app, desiredSize = 16) {
    const hasGlyphIcon = window.AppsManager?.isGlyphIconClass?.(app.icon);
    let titleIcon = null;
    let plateClass = '';

    if (app.type === 'modern') {
        titleIcon = AppsManager.getAppListLogo(app) || AppsManager.getIconImage(app, desiredSize);
        plateClass = app.color ? `app-icon-plate--${app.color}` : '';
    } else if (hasGlyphIcon) {
        titleIcon = AppsManager.getIconImage(app, desiredSize);
        if (!titleIcon) {
            plateClass = app.color ? `app-icon-plate--${app.color}` : '';
        }
    } else {
        titleIcon = AppsManager.getIconImage(app, desiredSize) || AppsManager.getAppListLogo(app);
        plateClass = app.color ? `app-icon-plate--${app.color}` : '';
    }

    return {
        hasMifIcon: hasGlyphIcon,
        titleIcon,
        plateClass
    };
}

function getModernAppSplashImage(app) {
    if (!app) {
        return null;
    }

    return AppsManager.getTileMediumSplash(app, 144) ||
        AppsManager.getIconImage(app, 64);
}

const MODERN_APP_CONTENT_SPLASH_HOLD_MS = 1500;
const MODERN_APP_CONTENT_SPLASH_FADE_MS = 400;

function createModernAppContentSplash(app, $content, $surfaceTargets = $()) {
    if (!app || !$content?.length) {
        return null;
    }

    const $splash = $('<div class="modern-app-splash modern-app-content-splash"></div>');
    const $splashIcon = $('<span class="modern-app-splash-icon"></span>');
    const splashColor = getAppTileColor(app.color) || '#000';
    const splashIcon = getModernAppSplashImage(app);
    const $hiddenSurfaceTargets = $surfaceTargets?.length ? $surfaceTargets : $();

    if (splashIcon) {
        $splashIcon.append(`<img src="${splashIcon}" alt="">`);
    } else if (app.icon) {
        $splashIcon.append(`<span class="${app.icon}"></span>`);
    }

    $splash.css('background-color', splashColor);
    $splash.append($splashIcon);
    $content.append($splash);
    $hiddenSurfaceTargets.addClass('modern-app-splash-surface-hidden');

    setTimeout(function () {
        $hiddenSurfaceTargets.removeClass('modern-app-splash-surface-hidden');
        $splash.addClass('fade-out');
        setTimeout(function () {
            $splash.remove();
        }, MODERN_APP_CONTENT_SPLASH_FADE_MS);
    }, MODERN_APP_CONTENT_SPLASH_HOLD_MS);

    return $splash;
}

function openModernAppOnDesktop(app, launchOptions = {}) {
    if (AppsManager.isAppRunning(app.id) && !isModernDesktopWindow(app.id)) {
        restoreModernApp(app.id);
        return;
    }

    const openWindow = () => {
        const hasActiveFullscreenModernApp = hasActiveFullscreenModernApps();

        if (currentView !== 'desktop' || hasActiveFullscreenModernApp) {
            if (hasActiveFullscreenModernApp) {
                hideAllActiveModernApps();
            }

            if (currentView !== 'desktop') {
                transitionToDesktop();
            }

            setTimeout(() => {
                openClassicApp(app, {
                    ...launchOptions,
                    modernDesktopMode: true,
                    forceMetroMode: isContinuumTabletShellMode()
                });
            }, 500);
            return;
        }

        openClassicApp(app, {
            ...launchOptions,
            modernDesktopMode: true,
            forceMetroMode: isContinuumTabletShellMode()
        });
    };

    openWindow();
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
    }

    // Create titlebar trigger area
    const $titlebarTrigger = $('<div class="modern-app-titlebar-trigger"></div>');

    // Create titlebar
    const $titlebar = $('<div class="modern-app-titlebar"></div>');

    const { hasMifIcon, titleIcon, plateClass } = getModernAppTitlebarIconModel(app, 16);

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
    let $splashSurfaceTargets = $();

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
        $splashSurfaceTargets = $webview;

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
                        <span class="sui-back"></span>
                        <div class="modern-webview-bar-btn-label">Back</div>
                    </button>
                    <button class="modern-webview-bar-btn" data-action="forward" title="Forward">
                        <span class="sui-forward"></span>
                        <div class="modern-webview-bar-btn-label">Forward</div>
                    </button>
                    <button class="modern-webview-bar-btn" data-action="refresh" title="Refresh">
                        <span class="sui-refresh"></span>
                        <div class="modern-webview-bar-btn-label">Refresh</div>
                    </button>
                    <button class="modern-webview-bar-expand" title="Show labels">
                        <span class="sui-more"></span>
                    </button>
                </div>
            </div>
        `);
        $content.append($navBar);

        function updateWebviewViewportOffset() {
            const navBarHeight = $navBar.outerHeight() || 0;
            const offset = `${navBarHeight}px`;

            $webview.css({
                bottom: offset,
                height: 'auto'
            });

            $loading.css({
                bottom: offset,
                height: 'auto'
            });
        }

        updateWebviewViewportOffset();

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
            requestAnimationFrame(updateWebviewViewportOffset);
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
        $splashSurfaceTargets = $iframe;

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
                        'ui-wall-color': rootStyles.getPropertyValue('--ui-wall-color').trim(),
                        'ui-wall-text-contrast': rootStyles.getPropertyValue('--ui-wall-text-contrast').trim()
                    }
                }, '*');
                console.log('[App.js] Sent theme variables to modern app iframe:', app.id);
            }
        });
    }

    createModernAppContentSplash(app, $content, $splashSurfaceTargets);

    // Assemble container
    $container.append($titlebarTrigger);
    $container.append($titlebar);
    $container.append($content);

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
            setTimeout(function () {
                $container.removeClass('taskbar-launch taskbar-launch-visible taskbar-content-visible');
            }, MODERN_APP_CONTENT_SPLASH_FADE_MS + 100);
        }, MODERN_APP_CONTENT_SPLASH_HOLD_MS);
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
        const hasOtherActiveModernApps = hasActiveFullscreenModernApps();

        // If there are other active modern apps, don't change the view
        if (hasOtherActiveModernApps) {
            console.log('Other modern apps are still active, staying in current view');
            return;
        }

        // Return to the view where the app was launched from (same as minimize)
        if (launchOrigin === 'start') {
            console.log('Returning to start screen (app was launched from start)');
            openStartScreen();
        } else if (isContinuumTabletShellMode()) {
            console.log('Returning to start surface for Continuum tablet mode');
            openStartSurface();
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
        if (isFullscreenModernWindowData(runningApp) && appState === 'active' && appId !== exceptAppId) {
            const $container = runningApp.$container;
            $container.removeClass('active');
            AppsManager.setAppState(appId, 'minimized');
            console.log('Hidden active modern app:', appId);
        }
    });
}

// Minimize a modern app
function minimizeModernApp(appId, options = {}) {
    const runningApp = AppsManager.getRunningApp(appId);
    if (!runningApp) {
        console.error('App not running:', appId);
        return;
    }

    const $container = runningApp.$container;
    const launchOrigin = runningApp.launchOrigin || 'desktop';
    const suppressContinuumStartSurface = !!options.suppressContinuumStartSurface;
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
        } else if (isContinuumTabletShellMode() && !suppressContinuumStartSurface) {
            console.log('Returning to start surface for Continuum tablet mode');
            openStartSurface();
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

    if (dismissContinuumStartSurfaceForAppActivation('modern')) {
        console.log('Dismissed Start surface for modern app restore');
    } else if (currentView === 'start') {
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
const CLASSIC_WINDOW_OPEN_ANIMATION_MS = 500;
const CLASSIC_WINDOW_CLOSE_ANIMATION_MS = 250;
const CLASSIC_WINDOW_MINIMIZE_ANIMATION_MS = 300;
const CLASSIC_WINDOW_RESTORE_ANIMATION_MS = 300;
const CLASSIC_WINDOW_MAXIMIZE_ANIMATION_MS = 240;
const CLASSIC_WINDOW_RESTORE_FROM_MAX_ANIMATION_MS = 220;
const CLASSIC_WINDOW_READY_FALLBACK_MS = 3000;
const EXPLORER_PRELOAD_DELAY_MS = 1500;
let explorerPreloadScheduled = false;

function getClassicWindowOptions(app) {
    const windowOptions = app?.windowOptions || {};
    const isModernDesktopApp = app?.type === 'modern';
    const defaultOptions = {
        width: isModernDesktopApp ? 1024 : 600,
        height: isModernDesktopApp ? 720 : 500,
        resizable: true,
        minimizable: true,
        maximizable: true,
        alwaysOnTop: false,
        showInTaskbar: true,
        showIcon: true,
        showTitle: true
    };

    return { ...defaultOptions, ...windowOptions };
}

function getTaskbarReservedHeight() {
    if (Number.isFinite(taskbarHeight)) {
        return taskbarAutoHideEnabled ? 0 : getEffectiveTaskbarHeight();
    }

    const reservedHeight = parseInt(
        getComputedStyle(document.body).getPropertyValue('--taskbar-reserved-height'),
        10
    );

    return Number.isFinite(reservedHeight) ? reservedHeight : 40;
}

function getClassicWindowDefaultBounds(app, launchOptions = {}) {
    const options = getClassicWindowOptions(app);
    const requestedBounds = launchOptions && typeof launchOptions.initialBounds === 'object'
        ? launchOptions.initialBounds
        : null;
    const width = Number.isFinite(requestedBounds?.width) ? requestedBounds.width : options.width;
    const height = Number.isFinite(requestedBounds?.height) ? requestedBounds.height : options.height;
    const defaultPosition = options.defaultPosition;
    const viewportWidth = $(window).width();
    const viewportHeightWithTaskbar = $(window).height();
    const availableHeight = viewportHeightWithTaskbar - getTaskbarReservedHeight();

    if (requestedBounds) {
        const left = Number.isFinite(requestedBounds.left)
            ? requestedBounds.left
            : (viewportWidth - width) / 2;
        const top = Number.isFinite(requestedBounds.top)
            ? requestedBounds.top
            : (availableHeight - height) / 2 - 20;

        return {
            width,
            height,
            left: Math.max(0, Math.min(left, Math.max(0, viewportWidth - width))),
            top: Math.max(0, Math.min(top, Math.max(0, availableHeight - height)))
        };
    }

    if (defaultPosition && typeof defaultPosition === 'object') {
        const respectTaskbar = defaultPosition.respectTaskbar !== false;
        const viewportHeight = viewportHeightWithTaskbar - (respectTaskbar ? getTaskbarReservedHeight() : 0);
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
        left: (viewportWidth - width) / 2,
        top: (viewportHeightWithTaskbar - height) / 2 - 20
    };
}

function moveClassicWindow(windowIdOrAppId, left, top, options = {}) {
    const windowData = getRunningWindowData(windowIdOrAppId);
    if (!windowData?.$container?.length) {
        return false;
    }

    const numericLeft = Number(left);
    const numericTop = Number(top);
    if (!Number.isFinite(numericLeft) || !Number.isFinite(numericTop)) {
        return false;
    }

    const clampToViewport = options.clampToViewport !== false;
    const respectTaskbar = options.respectTaskbar !== false;
    const width = windowData.$container.outerWidth() || 0;
    const height = windowData.$container.outerHeight() || 0;
    const viewportWidth = $(window).width();
    const viewportHeight = $(window).height() - (respectTaskbar ? getTaskbarReservedHeight() : 0);

    const resolvedLeft = clampToViewport
        ? Math.max(0, Math.min(numericLeft, Math.max(0, viewportWidth - width)))
        : numericLeft;
    const resolvedTop = clampToViewport
        ? Math.max(0, Math.min(numericTop, Math.max(0, viewportHeight - height)))
        : numericTop;

    windowData.$container.css({
        left: `${resolvedLeft}px`,
        top: `${resolvedTop}px`
    });

    if (options.focus !== false) {
        focusClassicWindow(windowData.windowId);
    }

    return true;
}

function animateClassicWindowOpen($container) {
    if (!$container?.length) {
        return;
    }

    const existingTimer = $container.data('classicWindowOpenTimer');
    if (existingTimer) {
        clearTimeout(existingTimer);
    }

    $container.removeClass('opening');
    void $container[0].offsetWidth;
    $container.addClass('opening');

    const timerId = setTimeout(function () {
        $container.removeClass('opening');
        $container.removeData('classicWindowOpenTimer');
    }, CLASSIC_WINDOW_OPEN_ANIMATION_MS);

    $container.data('classicWindowOpenTimer', timerId);
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
        .removeClass('maximized snapped snapped-left snapped-right minimizing restoring closing opening launch-deferred inactive metro-mode')
        .removeData('isSnapped')
        .removeData('snapZone')
        .removeData('preSnapState')
        .removeData('prevState')
        .removeData('desktopModernPrevState')
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
    return thresholdFeaturesEnabled && !!navigationSettings.useStartMenu;
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

        // Reassign to the active virtual desktop (preload may have assigned to a different one)
        if (window.VirtualDesktops) {
            const activeDesktop = VirtualDesktops.getActiveDesktopId();
            const currentDesktop = VirtualDesktops.getWindowDesktopId(windowData.windowId);
            if (currentDesktop !== activeDesktop) {
                VirtualDesktops.setWindowDesktop(windowData.windowId, activeDesktop);
                $container[0].classList.remove('vd-hidden');
            }
        }

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
        !launchOptions.openSpecialFolderId &&
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
        return;
    }

    const directLoadedHost = $container.find('.direct-loaded-content')[0];
    if (directLoadedHost) {
        const enrichedPayload = {
            ...payload,
            appId: payload.appId || $container.attr('data-app-id') || undefined,
            windowId: payload.windowId || $container.attr('data-window-id') || undefined
        };
        directLoadedHost.dispatchEvent(new CustomEvent('host-command', {
            detail: enrichedPayload,
            bubbles: true,
            cancelable: false
        }));
    }
}

function storeClassicWindowLaunchOptions(windowId, launchOptions) {
    if (!windowId || !launchOptions || !Object.keys(launchOptions).length) {
        return;
    }

    pendingClassicWindowLaunchOptions.set(windowId, { ...launchOptions });
}

function consumeClassicWindowLaunchOptions(windowId) {
    if (!windowId || !pendingClassicWindowLaunchOptions.has(windowId)) {
        return null;
    }

    const launchOptions = pendingClassicWindowLaunchOptions.get(windowId);
    pendingClassicWindowLaunchOptions.delete(windowId);
    return launchOptions ? { ...launchOptions } : null;
}

async function resolveExplorerHostRequest(request) {
    const explorerEngine = window.ExplorerEngine;
    if (!explorerEngine) {
        throw new Error('Explorer engine is unavailable.');
    }

    const payload = request && typeof request.payload === 'object' ? request.payload : {};
    const normalizePaths = (value) => Array.isArray(value)
        ? value.filter(pathValue => typeof pathValue === 'string' && pathValue)
        : [];

    switch (request.hostAction) {
        case 'canPasteToDirectory':
            return Boolean(
                typeof explorerEngine.canPasteToDirectory === 'function'
                && explorerEngine.canPasteToDirectory(payload.targetPath)
            );
        case 'getFavoriteFolderPaths':
            if (typeof explorerEngine.getFavoriteFolderPaths !== 'function') {
                throw new Error('Favorites are unavailable.');
            }
            return explorerEngine.getFavoriteFolderPaths();
        case 'isFavoriteFolderPath':
            if (typeof explorerEngine.isFavoriteFolderPath !== 'function') {
                throw new Error('Favorites are unavailable.');
            }
            return Boolean(explorerEngine.isFavoriteFolderPath(payload.folderPath));
        case 'addFavoriteFolderPath':
            if (typeof explorerEngine.addFavoriteFolderPath !== 'function') {
                throw new Error('Favorites are unavailable.');
            }
            return explorerEngine.addFavoriteFolderPath(payload.folderPath);
        case 'removeFavoriteFolderPath':
            if (typeof explorerEngine.removeFavoriteFolderPath !== 'function') {
                throw new Error('Favorites are unavailable.');
            }
            return explorerEngine.removeFavoriteFolderPath(payload.folderPath);
        case 'copyPathsToClipboard':
            if (typeof explorerEngine.copyPathsToClipboard !== 'function') {
                throw new Error('Copy is unavailable.');
            }
            explorerEngine.copyPathsToClipboard(normalizePaths(payload.paths));
            return true;
        case 'cutPathsToClipboard':
            if (typeof explorerEngine.cutPathsToClipboard !== 'function') {
                throw new Error('Cut is unavailable.');
            }
            explorerEngine.cutPathsToClipboard(normalizePaths(payload.paths));
            return true;
        case 'pasteClipboardToDirectory':
            if (typeof explorerEngine.pasteClipboardToDirectory !== 'function') {
                throw new Error('Paste is unavailable.');
            }
            return explorerEngine.pasteClipboardToDirectory(payload.targetPath);
        case 'renameEntryPath':
            if (typeof explorerEngine.renameEntryPath !== 'function') {
                throw new Error('Rename is unavailable.');
            }
            return explorerEngine.renameEntryPath(payload.entryPath, payload.nextName);
        case 'movePathsToRecycleBin':
            if (typeof explorerEngine.movePathsToRecycleBin !== 'function') {
                throw new Error('Delete is unavailable.');
            }
            return explorerEngine.movePathsToRecycleBin(normalizePaths(payload.paths));
        case 'openFile':
            if (window.FileAssociations && typeof window.FileAssociations.openPath === 'function') {
                await window.FileAssociations.openPath(payload.filePath, 'file');
                return true;
            }
            throw new Error('File associations are unavailable.');
        case 'openFileWithChooser': {
            const FA = window.FileAssociations;
            if (!FA) {
                throw new Error('File associations are unavailable.');
            }
            const ext = FA.getFileExtension(payload.filePath);
            const compatibleApps = await FA.getCompatibleAppIds(payload.filePath);
            const candidates = compatibleApps
                .map(appId => ({
                    appId,
                    app: window.AppsManager?.getAppById(appId) || null
                }))
                .filter(c => c.app);

            if (!window.OpenWithChooser || typeof window.OpenWithChooser.show !== 'function') {
                await FA.openPath(payload.filePath, 'file');
                return true;
            }

            const choice = await window.OpenWithChooser.show({
                extension: ext,
                candidates
            });

            if (!choice) {
                return false;
            }

            if (choice.kind === 'app' && choice.appId) {
                if (choice.remember && ext) {
                    FA.saveOpenChoice(ext, { kind: 'app', appId: choice.appId });
                }
                await FA.openFileInternally(payload.filePath, choice.appId);
            } else if (choice.kind === 'host') {
                if (choice.remember && ext) {
                    FA.saveOpenChoice(ext, { kind: 'host' });
                }
                await FA.openPathExternally(payload.filePath);
            }
            return true;
        }
        default:
            throw new Error(`Unsupported explorer host action: ${request.hostAction || 'unknown'}`);
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

function updateDesktopModernMetroModeBodyState() {
    const hasVisibleMetroModeWindow = $('.modern-desktop-app-container.metro-mode:visible').length > 0;
    $('body').toggleClass('desktop-modern-metro-mode', hasVisibleMetroModeWindow);
    scheduleCharmsTriggerAvailabilityUpdate();

    if (!hasVisibleMetroModeWindow && currentView === 'desktop') {
        clearModernTouchBarTimer('titlebar');
        clearModernTouchBarTimer('taskbar');
        clearDesktopModernTaskbarPeekHideTimer();
        $('body').removeClass(DESKTOP_MODERN_TASKBAR_PEEK_BODY_CLASS);
        $('.taskbar')
            .removeClass('touch-visible touch-pinned touch-dragging')
            .css('--taskbar-touch-offset', '');
        $('.modern-desktop-window-titlebar')
            .removeClass('edge-visible touch-visible touch-pinned touch-dragging')
            .css('--modern-titlebar-touch-offset', '');

        scheduleHostedViewPointerLockUpdate();
    }

    if (typeof updateTaskViewTouchGestureAvailability === 'function') {
        updateTaskViewTouchGestureAvailability();
    }
}

function getActiveDesktopModernMetroContainer() {
    let $container = $('.modern-desktop-app-container.metro-mode.active:visible').last();
    if ($container.length) {
        return $container;
    }

    return $('.modern-desktop-app-container.metro-mode:visible').last();
}

function getActiveDesktopModernMetroTitlebar() {
    const $container = getActiveDesktopModernMetroContainer();
    if (!$container.length) {
        return $();
    }

    return $container.find('.modern-desktop-window-titlebar').first();
}

function isDesktopModernTaskbarContext() {
    const $body = $('body');
    return $body.hasClass('desktop-modern-metro-mode');
}

function showDesktopModernTaskbarPeek() {
    const $body = $('body');
    if (!isDesktopModernTaskbarContext()) {
        return;
    }

    const $taskbar = $('.taskbar');
    $body.addClass(DESKTOP_MODERN_TASKBAR_PEEK_BODY_CLASS);
    $taskbar
        .addClass('desktop-edge-visible')
        .css({
            display: 'flex',
            transform: 'translateY(0)'
        });
    updateHostedViewPointerLockState();
    scheduleHostedViewPointerLockUpdate();
}

function hideDesktopModernTaskbarPeek() {
    const $taskbar = $('.taskbar');
    $('body').removeClass(DESKTOP_MODERN_TASKBAR_PEEK_BODY_CLASS);
    $taskbar.removeClass('desktop-edge-visible');

    if (!$taskbar.is('.touch-visible, .touch-pinned, .touch-dragging')) {
        $taskbar.css({
            display: '',
            transform: ''
        });
    } else {
        $taskbar.css('display', 'flex');
        $taskbar.css('transform', '');
    }

    updateHostedViewPointerLockState();
    scheduleHostedViewPointerLockUpdate();
}

function isTouchWithinVisibleDesktopModernTaskbarRegion(touch) {
    if (!touch || (!isDesktopModernTaskbarContext() && !$('body').hasClass('view-modern'))) {
        return false;
    }

    const taskbarElement = document.querySelector('.taskbar');
    if (!taskbarElement) {
        return false;
    }

    const taskbarShown =
        taskbarElement.classList.contains('desktop-edge-visible') ||
        taskbarElement.classList.contains('touch-visible') ||
        taskbarElement.classList.contains('touch-pinned') ||
        taskbarElement.classList.contains('touch-dragging') ||
        document.body?.classList.contains(DESKTOP_MODERN_TASKBAR_PEEK_BODY_CLASS);

    if (!taskbarShown) {
        return false;
    }

    const rect = taskbarElement.getBoundingClientRect();
    return touch.clientX >= rect.left - 2 &&
        touch.clientX <= rect.right + 2 &&
        touch.clientY >= rect.top - 2 &&
        touch.clientY <= rect.bottom + 2;
}

function handleDesktopModernTaskbarMouseMove(event) {
    if (!isDesktopModernTaskbarContext()) {
        return;
    }

    const $taskbar = $('.taskbar');
    const taskbarPixels = getTaskbarHeightForLayout();
    const nearBottomEdge = event.clientY >= window.innerHeight - 2;
    const overTaskbarSurface = $(event.target).closest('.taskbar').length > 0;
    const overEdgeTrigger = $(event.target).closest('.desktop-modern-taskbar-edge-trigger').length > 0;

    if (nearBottomEdge || overTaskbarSurface || overEdgeTrigger) {
        clearDesktopModernTaskbarPeekHideTimer();
        showDesktopModernTaskbarPeek();
        return;
    }

    if (
        $taskbar.is('.touch-visible, .touch-pinned, .touch-dragging') &&
        event.clientY < window.innerHeight - taskbarPixels - 2
    ) {
        hideModernTouchBar('taskbar');
        hideDesktopModernTaskbarPeek();
        return;
    }

    if ($taskbar.hasClass('desktop-edge-visible') && event.clientY < window.innerHeight - taskbarPixels - 2) {
        scheduleDesktopModernTaskbarPeekHide();
    }
}

function setModernDesktopTitlebarEdgeVisible($titlebar, visible) {
    if (!$titlebar?.length) {
        return;
    }

    $titlebar.toggleClass('edge-visible', visible);
    scheduleHostedViewPointerLockUpdate();
    scheduleCharmsTriggerAvailabilityUpdate();
}

function updateDesktopModernAppCommandsAvailability() {
    const enabled = areDesktopModernAppsEnabled();
    $('body').toggleClass('desktop-modern-app-commands-disabled', !enabled);

    if (!enabled) {
        hideModernDesktopTitlebarMenu();
    }
}

function getModernDesktopTitlebarMenuOverlay() {
    let $menu = $('#modern-desktop-titlebar-menu-overlay');
    if ($menu.length) {
        return $menu;
    }

    $menu = $(`
        <div id="modern-desktop-titlebar-menu-overlay" class="context-menu modern-desktop-titlebar-menu">
            <button class="context-menu-item modern-desktop-titlebar-menu-item" type="button" data-action="app-commands">
                <span class="context-menu-item-icon modern-desktop-titlebar-menu-icon modern-desktop-titlebar-menu-icon--more"></span>
                <span class="context-menu-item-text">App Commands</span>
            </button>
            <button class="context-menu-item modern-desktop-titlebar-menu-item" type="button" data-action="search">
                <span class="context-menu-item-icon modern-desktop-titlebar-menu-icon modern-desktop-titlebar-menu-icon--search"></span>
                <span class="context-menu-item-text">Search</span>
            </button>
            <button class="context-menu-item modern-desktop-titlebar-menu-item" type="button" data-action="share">
                <span class="context-menu-item-icon modern-desktop-titlebar-menu-icon modern-desktop-titlebar-menu-icon--share"></span>
                <span class="context-menu-item-text">Share</span>
            </button>
            <button class="context-menu-item modern-desktop-titlebar-menu-item is-disabled" type="button" data-action="play" aria-disabled="true">
                <span class="context-menu-item-icon modern-desktop-titlebar-menu-icon modern-desktop-titlebar-menu-icon--play"></span>
                <span class="context-menu-item-text">Play</span>
            </button>
            <button class="context-menu-item modern-desktop-titlebar-menu-item is-disabled" type="button" data-action="print" aria-disabled="true">
                <span class="context-menu-item-icon modern-desktop-titlebar-menu-icon modern-desktop-titlebar-menu-icon--print"></span>
                <span class="context-menu-item-text">Print</span>
            </button>
            <button class="context-menu-item modern-desktop-titlebar-menu-item is-disabled" type="button" data-action="project" aria-disabled="true">
                <span class="context-menu-item-icon modern-desktop-titlebar-menu-icon modern-desktop-titlebar-menu-icon--devices"></span>
                <span class="context-menu-item-text">Project</span>
            </button>
            <button class="context-menu-item modern-desktop-titlebar-menu-item" type="button" data-action="settings">
                <span class="context-menu-item-icon modern-desktop-titlebar-menu-icon modern-desktop-titlebar-menu-icon--settings"></span>
                <span class="context-menu-item-text">Settings</span>
            </button>
            <button class="context-menu-item modern-desktop-titlebar-menu-item" type="button" data-action="toggle-metro-mode">
                <span class="context-menu-item-icon modern-desktop-titlebar-menu-icon modern-desktop-titlebar-menu-icon--fullscreen"></span>
                <span class="context-menu-item-text">Full Screen</span>
            </button>
        </div>
    `);

    $menu.on('mousedown', function (e) {
        e.stopPropagation();
    });

    $menu.on('click', '.modern-desktop-titlebar-menu-item', function (e) {
        e.preventDefault();
        e.stopPropagation();

        const $item = $(this);
        if ($item.hasClass('is-disabled')) {
            return;
        }

        const action = $(this).attr('data-action');
        const windowId = $menu.attr('data-window-id');
        hideModernDesktopTitlebarMenu();

        if (action === 'search') {
            openModernFlyout('search');
        } else if (action === 'share') {
            openModernFlyout('share');
        } else if (action === 'settings') {
            openModernFlyout('settings', {
                source: 'app-commands',
                windowId
            });
        } else if (action === 'toggle-metro-mode' && windowId) {
            toggleModernDesktopMetroMode(windowId);
        }
    });

    $('body').append($menu);
    return $menu;
}

function getModernDesktopMenuSurfaceTargets($container) {
    if (!$container?.length) {
        return $();
    }

    return $container.find('iframe.classic-window-iframe, webview.classic-window-iframe');
}

function setModernDesktopMenuSurfaceInteractivity($container, enabled) {
    const $targets = getModernDesktopMenuSurfaceTargets($container);
    if (!$targets.length) {
        return;
    }

    $targets.css('pointer-events', enabled ? 'auto' : 'none');
}

function updateModernDesktopMenuLabel($container) {
    if (!$container?.length || !areDesktopModernAppsEnabled() || !$container.hasClass('modern-desktop-app-container')) {
        return;
    }

    const $menu = getModernDesktopTitlebarMenuOverlay();
    const inMetroMode = $container.hasClass('metro-mode');
    const nextLabel = inMetroMode ? 'Exit fullscreen' : 'Enter fullscreen';
    $menu.find('.modern-desktop-titlebar-menu-item[data-action="toggle-metro-mode"]')
        .attr('title', nextLabel)
        .attr('aria-label', nextLabel);
}

function hideModernDesktopTitlebarMenu() {
    const $menu = $('#modern-desktop-titlebar-menu-overlay');
    if (!$menu.length) {
        return;
    }

    const windowId = $menu.attr('data-window-id');
    if (windowId) {
        const windowData = getRunningWindowData(windowId);
        if (windowData?.$container?.length) {
            setModernDesktopMenuSurfaceInteractivity(windowData.$container, true);
            windowData.$container.find('.modern-desktop-window-menu-button').removeClass('active');
        }
    }

    $menu.removeAttr('data-window-id').removeClass('active').css({
        left: '',
        top: ''
    });
}

function showModernDesktopTitlebarMenu($container) {
    if (
        !$container?.length ||
        !areDesktopModernAppsEnabled() ||
        !$container.hasClass('modern-desktop-app-container')
    ) {
        hideModernDesktopTitlebarMenu();
        return;
    }

    const button = $container.find('.modern-desktop-window-menu-button')[0];
    const titlebar = $container.find('.modern-desktop-window-titlebar')[0];
    const windowId = $container.attr('data-window-id');
    if (!button || !titlebar || !windowId) {
        return;
    }

    const $menu = getModernDesktopTitlebarMenuOverlay();
    const currentlyOpenForWindow = $menu.hasClass('active') && $menu.attr('data-window-id') === windowId;

    hideModernDesktopTitlebarMenu();
    if (currentlyOpenForWindow) {
        return;
    }

    updateModernDesktopMenuLabel($container);
    setModernDesktopMenuSurfaceInteractivity($container, false);

    const buttonRect = button.getBoundingClientRect();
    const titlebarRect = titlebar.getBoundingClientRect();
    $menu.attr('data-window-id', windowId).css({
        position: 'fixed',
        left: `${titlebarRect.left}px`,
        top: `${buttonRect.bottom + 3}px`
    }).addClass('active');

    const menuWidth = $menu.outerWidth();
    const menuHeight = $menu.outerHeight();
    const viewportWidth = $(window).width();
    const viewportHeight = $(window).height();
    let left = titlebarRect.left;
    let top = buttonRect.bottom + 3;

    if (left + menuWidth > viewportWidth - 10) {
        left = Math.max(10, viewportWidth - menuWidth - 10);
    }

    if (top + menuHeight > viewportHeight - 10) {
        top = Math.max(10, titlebarRect.bottom - menuHeight - 3);
    }

    $menu.css({
        left: `${left}px`,
        top: `${top}px`
    });

    $container.find('.modern-desktop-window-menu-button').addClass('active');
}

$(document).on('mousedown', function (e) {
    const $menu = $('#modern-desktop-titlebar-menu-overlay');
    if (!$menu.length || !$menu.hasClass('active')) {
        return;
    }

    if ($(e.target).closest('#modern-desktop-titlebar-menu-overlay, .modern-desktop-window-menu-button').length) {
        return;
    }

    hideModernDesktopTitlebarMenu();
});

let desktopModernTaskbarPeekHideTimer = null;

function clearDesktopModernTaskbarPeekHideTimer() {
    clearTimeout(desktopModernTaskbarPeekHideTimer);
    desktopModernTaskbarPeekHideTimer = null;
}

function scheduleDesktopModernTaskbarPeekHide() {
    clearDesktopModernTaskbarPeekHideTimer();
    desktopModernTaskbarPeekHideTimer = setTimeout(function () {
        if ($('.taskbar:hover, .desktop-modern-taskbar-edge-trigger:hover').length) {
            return;
        }

        hideDesktopModernTaskbarPeek();
    }, 450);
}

$(document).on('mouseenter', '.modern-desktop-window-titlebar-trigger', function () {
    const $titlebar = $(this).siblings('.modern-desktop-window-titlebar').first();
    setModernDesktopTitlebarEdgeVisible($titlebar, true);
});

$(document).on('mouseleave', '.modern-desktop-window-titlebar-trigger', function () {
    const $trigger = $(this);
    const $titlebar = $trigger.siblings('.modern-desktop-window-titlebar').first();
    setTimeout(function () {
        if (!$trigger.is(':hover') && !$titlebar.is(':hover')) {
            setModernDesktopTitlebarEdgeVisible($titlebar, false);
        }
    }, 70);
});

$(document).on('mouseenter', '.modern-desktop-window-titlebar', function () {
    setModernDesktopTitlebarEdgeVisible($(this), true);
});

$(document).on('mouseleave', '.modern-desktop-window-titlebar', function () {
    const $titlebar = $(this);
    const $trigger = $titlebar.siblings('.modern-desktop-window-titlebar-trigger').first();
    if (!$trigger.is(':hover')) {
        setModernDesktopTitlebarEdgeVisible($titlebar, false);
    }
});

$(document).on('mouseenter', '.desktop-modern-taskbar-edge-trigger', function () {
    clearDesktopModernTaskbarPeekHideTimer();
    showDesktopModernTaskbarPeek();
});

$(document).on('mouseleave', '.desktop-modern-taskbar-edge-trigger', function () {
    scheduleDesktopModernTaskbarPeekHide();
});

$(document).on('mouseenter', '.taskbar', function () {
    if ($('body').hasClass('desktop-modern-metro-mode')) {
        clearDesktopModernTaskbarPeekHideTimer();
        showDesktopModernTaskbarPeek();
    }
});

$(document).on('mouseleave', '.taskbar', function () {
    if ($('body').hasClass('desktop-modern-metro-mode')) {
        scheduleDesktopModernTaskbarPeekHide();
    }
});

$(document).ready(function () {
    document.addEventListener('mousemove', handleDesktopModernTaskbarMouseMove, { passive: true });

    const desktopModernTaskbarEdgeTrigger = document.querySelector('.desktop-modern-taskbar-edge-trigger');
    if (!desktopModernTaskbarEdgeTrigger) {
        return;
    }

    const handleDesktopModernTaskbarTouchStart = function (event) {
        if (!isDesktopModernTaskbarContext() || !event.touches || event.touches.length !== 1) {
            return;
        }

        clearDesktopModernTaskbarPeekHideTimer();

        if (isModernTouchBarShown('taskbar')) {
            pinModernTouchBar('taskbar');
            event.preventDefault();
            event.stopPropagation();
            return;
        }

        startModernTouchBarDrag('taskbar', event.touches[0]);
        event.preventDefault();
        event.stopPropagation();
    };

    const handleDesktopModernTaskbarTouchMove = function (event) {
        const taskbarState = modernTouchEdgeBars.taskbar;
        if (!taskbarState.active || !event.touches || event.touches.length !== 1) {
            return;
        }

        const touch = event.touches[0];
        const revealAmount = Math.max(0, taskbarState.startY - touch.clientY);
        const horizontalDistance = Math.abs(touch.clientX - taskbarState.startX);

        if (horizontalDistance > MODERN_TOUCH_CANCEL_HORIZONTAL_THRESHOLD &&
            revealAmount < MODERN_TOUCH_TASKBAR_OPEN_THRESHOLD) {
            hideModernTouchBar('taskbar');
            return;
        }

        applyModernTouchBarReveal('taskbar', revealAmount);
        event.preventDefault();
        event.stopPropagation();
    };

    const handleDesktopModernTaskbarTouchEnd = function (event) {
        const taskbarState = modernTouchEdgeBars.taskbar;
        if (!taskbarState.active) {
            return;
        }

        const shouldOpen = taskbarState.reveal >= MODERN_TOUCH_TASKBAR_OPEN_THRESHOLD;
        taskbarState.active = false;

        if (shouldOpen) {
            showModernTouchBar('taskbar', { pinned: true });
        } else {
            hideModernTouchBar('taskbar');
        }

        if (event) {
            event.stopPropagation();
        }
    };

    desktopModernTaskbarEdgeTrigger.addEventListener('touchstart', handleDesktopModernTaskbarTouchStart, { passive: false });
    desktopModernTaskbarEdgeTrigger.addEventListener('touchmove', handleDesktopModernTaskbarTouchMove, { passive: false });
    desktopModernTaskbarEdgeTrigger.addEventListener('touchend', handleDesktopModernTaskbarTouchEnd, { passive: true });
    desktopModernTaskbarEdgeTrigger.addEventListener('touchcancel', handleDesktopModernTaskbarTouchEnd, { passive: true });
});

function toggleModernDesktopMetroMode(windowIdOrAppId, options = {}) {
    const windowData = getRunningWindowData(windowIdOrAppId);
    if (!isModernDesktopWindowData(windowData)) {
        return;
    }

    if (!options.continuumAuto && isContinuumTabletShellMode()) {
        markContinuumWindowStateManuallyAdjusted(windowData);
    }

    const $container = windowData.$container;

    if ($container.hasClass('metro-mode')) {
        const previousState = $container.data('desktopModernPrevState') || {};

        $container.removeClass('metro-mode');
        $container.css({
            left: previousState.left || '',
            top: previousState.top || '',
            width: previousState.width || '',
            height: previousState.height || ''
        });

        if (previousState.isMaximized) {
            $container.addClass('maximized');
            setClassicWindowMaximizeButtonState($container, true);
        } else {
            setClassicWindowMaximizeButtonState($container, false);
        }

        if (previousState.isSnapped) {
            $container.addClass('snapped');
            if (previousState.snapZone === 'left') {
                $container.addClass('snapped-left');
            } else if (previousState.snapZone === 'right') {
                $container.addClass('snapped-right');
            }
            $container.data('isSnapped', true);
            $container.data('snapZone', previousState.snapZone);
            if (previousState.preSnapState) {
                $container.data('preSnapState', previousState.preSnapState);
            }
        } else {
            $container.removeClass('snapped snapped-left snapped-right');
            $container.removeData('isSnapped');
            $container.removeData('snapZone');
            $container.removeData('preSnapState');
        }

        if (previousState.prevState) {
            $container.data('prevState', previousState.prevState);
        } else {
            $container.removeData('prevState');
        }

        $container.removeData('desktopModernPrevState');
    } else {
        $container.data('desktopModernPrevState', {
            left: $container.css('left'),
            top: $container.css('top'),
            width: $container.css('width'),
            height: $container.css('height'),
            isMaximized: $container.hasClass('maximized'),
            isSnapped: !!$container.data('isSnapped'),
            snapZone: $container.data('snapZone') || null,
            preSnapState: $container.data('preSnapState') || null,
            prevState: $container.data('prevState') || null
        });

        $container.removeClass('maximized snapped snapped-left snapped-right');
        $container.removeData('isSnapped');
        $container.removeData('snapZone');
        $container.removeData('preSnapState');
        setClassicWindowMaximizeButtonState($container, false);
        $container.addClass('metro-mode');
    }

    updateModernDesktopMenuLabel($container);
    updateDesktopModernMetroModeBodyState();
    hideModernDesktopTitlebarMenu();
    focusClassicWindow(windowData.windowId);
}

function appendCacheBuster(url, token = Date.now()) {
    if (typeof url !== 'string' || !url) {
        return url;
    }

    const hashIndex = url.indexOf('#');
    const hash = hashIndex === -1 ? '' : url.slice(hashIndex);
    let base = hashIndex === -1 ? url : url.slice(0, hashIndex);

    base = base
        .replace(/([?&])__cb=\d+&?/g, '$1')
        .replace(/[?&]$/, '');

    return `${base}${base.includes('?') ? '&' : '?'}__cb=${token}${hash}`;
}

function isLocalStylesheetHref(href) {
    return typeof href === 'string' &&
        href.length > 0 &&
        !/^(?:https?:|data:|blob:|about:|javascript:|mailto:)/i.test(href);
}

function reloadDocumentLocalStylesheets(doc, token = Date.now()) {
    if (!doc?.querySelectorAll) {
        return;
    }

    const stylesheetLinks = doc.querySelectorAll('link[rel="stylesheet"][href]:not([data-no-reload])');
    stylesheetLinks.forEach(link => {
        const href = link.getAttribute('href');
        if (!isLocalStylesheetHref(href)) {
            return;
        }

        link.setAttribute('href', appendCacheBuster(href, token));
    });
}

function waitForDuration(durationMs) {
    return new Promise(resolve => {
        setTimeout(resolve, Math.max(0, durationMs));
    });
}

function reloadEmbeddedDocumentStylesheets(token = Date.now()) {
    const frameSelectors = ['.classic-window-iframe', '.modern-app-iframe'];
    frameSelectors.forEach(selector => {
        document.querySelectorAll(selector).forEach(frame => {
            try {
                const frameDocument = frame.contentDocument;
                if (frameDocument) {
                    reloadDocumentLocalStylesheets(frameDocument, token);
                }
            } catch (error) {
                console.debug('[Shell Restart] Skipped stylesheet reload for embedded document:', error);
            }
        });
    });
}

function reloadRunningAppIframes(token = Date.now()) {
    if (!window.AppsManager || typeof AppsManager.getRunningWindowsSnapshot !== 'function') {
        return;
    }
    AppsManager.getRunningWindowsSnapshot().forEach(({ $container }) => {
        if (!$container) return;
        $container.find('.classic-window-iframe, .modern-app-iframe').each(function () {
            const src = this.src;
            if (src) this.src = appendCacheBuster(src, token);
        });
    });
}

function replaceShellTemplateFragment(templateDocument, selector) {
    if (!templateDocument?.querySelector) {
        return false;
    }

    const currentElement = document.querySelector(selector);
    const templateElement = templateDocument.querySelector(selector);
    if (!currentElement || !templateElement) {
        return false;
    }

    currentElement.replaceWith(templateElement.cloneNode(true));
    return true;
}

function reloadShellTemplateFragments(templateDocument) {
    SOFT_RELOAD_TEMPLATE_SELECTORS.forEach(selector => {
        replaceShellTemplateFragment(templateDocument, selector);
    });

    refreshViewRegistry();
    initLoginScreen();
    initLockScreen();
    loadLockScreenWallpaper();
}

async function restartExplorerShell() {
    if (explorerShellRestartInProgress) {
        return false;
    }

    explorerShellRestartInProgress = true;

    const restartToken = Date.now();
    const $fadeToBlack = $('#fade-to-black');

    try {
        closeAllTaskbarPopupsAndMenus();
        closeAllClassicContextMenus();
        hideContextMenu();
        closeModernFlyout();
        hideCharmsBar();

        $fadeToBlack.addClass('visible');
        await waitForDuration(EXPLORER_SHELL_RESTART_FADE_MS);

        const response = await fetch(appendCacheBuster('index.html', restartToken), {
            cache: 'no-store'
        });
        if (!response.ok) {
            throw new Error(`Failed to reload shell template: ${response.status}`);
        }

        const html = await response.text();
        const templateDocument = new DOMParser().parseFromString(html, 'text/html');

        reloadShellTemplateFragments(templateDocument);
        reloadDocumentLocalStylesheets(document, restartToken);
        reloadEmbeddedDocumentStylesheets(restartToken);
        reloadRunningAppIframes(restartToken);

        if (window.AppsManager && typeof AppsManager.reloadApps === 'function') {
            await AppsManager.reloadApps(appendCacheBuster('apps.json', restartToken));
        }

        if (typeof renderStartMenu === 'function') {
            renderStartMenu();
        }

        if (window.ExplorerEngine && typeof window.ExplorerEngine.refreshDesktop === 'function') {
            await window.ExplorerEngine.refreshDesktop();
        }

        if (window.AppsManager && typeof AppsManager.updateTaskbar === 'function') {
            AppsManager.updateTaskbar();
        }

        updateTaskbarReservedHeight();
        updateTaskbarResizedClass();
        updateTaskbarLockState();
        updateTaskbarShellButtonsVisibility();
        updateTaskbarShellButtonIcons();
        updateTaskbarContextMenuChecks();
        updateTaskbarUserTileVisibility();
        updateTaskbarUserTileFrame();
        updateNotificationCenterVisibility();
        updateModernClockPopupClass();
        updateModernVolumePopupClass();
        updateTaskbarVisibility(currentView);

        if (window.TaskbarDrag && typeof window.TaskbarDrag.init === 'function') {
            window.TaskbarDrag.init();
        }

        if (window.TrayOverflow && typeof window.TrayOverflow.refreshLayout === 'function') {
            window.TrayOverflow.refreshLayout();
        }

        if (window.ClockFlyout && typeof window.ClockFlyout.refreshLayout === 'function') {
            window.ClockFlyout.refreshLayout();
        }

        if (window.NotificationCenter && typeof window.NotificationCenter.syncIcon === 'function') {
            window.NotificationCenter.syncIcon();
        }

        if (window.TimeBank && typeof window.TimeBank.getSnapshot === 'function') {
            updateLockTime(window.TimeBank.getSnapshot());
            updateTaskbarClock(window.TimeBank.getSnapshot());
        } else {
            updateLockTime();
            updateTaskbarClock();
        }

        $(document).trigger('win8:shell-restarted');

        await waitForDuration(EXPLORER_SHELL_RESTART_BLACKOUT_MS);
        $fadeToBlack.removeClass('visible boot-transition below-interstitial');
        return true;
    } catch (error) {
        console.error('[Shell Restart] Failed to restart Explorer shell:', error);
        $fadeToBlack.removeClass('visible boot-transition below-interstitial');
        return false;
    } finally {
        explorerShellRestartInProgress = false;
    }
}

function findClassicHostStylesheetLink(href) {
    if (!href || !document?.head?.querySelectorAll) {
        return null;
    }

    return Array.from(document.head.querySelectorAll('link[data-classic-host-stylesheet]'))
        .find(link => link.getAttribute('data-classic-host-stylesheet') === href) || null;
}

function acquireClassicHostStylesheet(href, token = Date.now()) {
    if (!isLocalStylesheetHref(href) || !document?.head) {
        return '';
    }

    const existingLink = findClassicHostStylesheetLink(href);
    if (existingLink) {
        const refCount = Number.parseInt(existingLink.getAttribute('data-classic-host-stylesheet-refcount') || '0', 10) || 0;
        existingLink.setAttribute('data-classic-host-stylesheet-refcount', String(refCount + 1));
        existingLink.setAttribute('href', appendCacheBuster(href, token));
        return href;
    }

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = appendCacheBuster(href, token);
    link.setAttribute('data-classic-host-stylesheet', href);
    link.setAttribute('data-classic-host-stylesheet-refcount', '1');
    document.head.appendChild(link);
    return href;
}

function releaseClassicHostStylesheet(href) {
    if (!href) {
        return;
    }

    const existingLink = findClassicHostStylesheetLink(href);
    if (!existingLink) {
        return;
    }

    const refCount = Number.parseInt(existingLink.getAttribute('data-classic-host-stylesheet-refcount') || '0', 10) || 0;
    if (refCount <= 1) {
        existingLink.remove();
        return;
    }

    existingLink.setAttribute('data-classic-host-stylesheet-refcount', String(refCount - 1));
}

// Open a classic app window
function openClassicApp(app, launchOptions = {}) {
    if (!app.path) {
        console.error('Desktop app missing path:', app.id);
        return;
    }

    if (restorePreloadedExplorerWindow(app, launchOptions)) {
        launchingApps.delete(app.id);
        return;
    }

    // Check if app supports multiple windows
    const allowMultipleWindows = app.allowMultipleWindows === true;
    const isBackgroundPreload = !!launchOptions.preloadInBackground;
    const isModernDesktopApp = app.type === 'modern' && launchOptions.modernDesktopMode === true;

    // If app doesn't support multiple windows and is already running, restore or focus it
    // Use isAppRunningAnywhere to detect windows on other virtual desktops too
    if (!allowMultipleWindows && (AppsManager.isAppRunning(app.id) || AppsManager.isAppRunningAnywhere(app.id))) {
        console.log('Desktop app already running, restoring or focusing:', app.id);

        // If the app is on another virtual desktop, switch there first
        if (window.VirtualDesktops && !AppsManager.isAppRunning(app.id) && AppsManager.isAppRunningAnywhere(app.id)) {
            const desktops = VirtualDesktops.getDesktopsForApp(app.id);
            if (desktops.size > 0) {
                const targetDesktop = desktops.values().next().value;
                VirtualDesktops.setActiveDesktop(targetDesktop);
            }
        }

        if (AppsManager.getAppState(app.id) === 'minimized') {
            restoreClassicWindow(app.id);
        } else {
            focusClassicWindow(app.id);
        }
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

    console.log('Loading desktop app from:', app.path, allowMultipleWindows ? '(multiple windows allowed)' : '');
    const styleReloadToken = Date.now();
    const appPathWithCacheBuster = appendCacheBuster(app.path, styleReloadToken);

    // Get window options with defaults
    const options = getClassicWindowOptions(app);
    const hostStylesheet = typeof options.hostStylesheet === 'string'
        ? options.hostStylesheet.trim()
        : '';
    const customTitlebarStyle = typeof options.customTitlebarStyle === 'string'
        ? options.customTitlebarStyle.trim()
        : '';
    const customTitlebarInteractiveSelector = typeof options.customTitlebarInteractiveSelector === 'string'
        ? options.customTitlebarInteractiveSelector.trim()
        : '';
    const acquiredHostStylesheet = acquireClassicHostStylesheet(hostStylesheet, styleReloadToken);
    const shouldDeferReveal = launchOptions.deferWindowUntilReady !== false &&
        options.deferShowUntilReady !== false;
    const requiresExplicitReadySignal = app.id === 'explorer';

    // Create the container (start with active class since it's being opened)
    const $container = $('<div class="classic-app-container"></div>');
    $container.attr('data-app-id', app.id);
    $container.data('classicWindowReady', !shouldDeferReveal);
    if (acquiredHostStylesheet) {
        $container.data('hostStylesheet', acquiredHostStylesheet);
    }
    if (customTitlebarStyle) {
        $container
            .addClass('classic-app-container--custom-titlebar')
            .addClass(`classic-app-container--custom-titlebar-${customTitlebarStyle}`);
    }
    if (customTitlebarInteractiveSelector) {
        $container.data('titlebarInteractiveSelector', customTitlebarInteractiveSelector);
    }
    if (isModernDesktopApp) {
        $container.addClass('modern-desktop-app-container');
    }

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
    let $titlebarTrigger = null;
    const $titlebar = $('<div class="classic-window-titlebar"></div>');
    if (customTitlebarStyle) {
        $titlebar
            .addClass('classic-window-titlebar--custom')
            .addClass(`classic-window-titlebar--custom-${customTitlebarStyle}`);
    }
    if (isModernDesktopApp) {
        $titlebarTrigger = $('<div class="modern-desktop-window-titlebar-trigger"></div>');
        $titlebar.addClass('modern-desktop-window-titlebar');
    }

    // Create title section
    const $title = $('<div class="classic-window-title"></div>');
    let classicTitleIcon = AppsManager.getIconImage(app, 16);
    let titlePlateClass = '';
    let $menuButton = null;
    const showModernDesktopMenuButton = isModernDesktopApp && areDesktopModernAppsEnabled();
    if (isModernDesktopApp) {
        const modernIconModel = getModernAppTitlebarIconModel(app, 16);
        classicTitleIcon = modernIconModel.titleIcon;
        titlePlateClass = modernIconModel.plateClass;
        $title.addClass('modern-desktop-window-title');

        if (showModernDesktopMenuButton) {
            $menuButton = $(`
                <button class="modern-desktop-window-menu-button" type="button" title="App commands" aria-label="App commands">
                    ...
                </button>
            `);

            $menuButton.on('mousedown', function (e) {
                e.stopPropagation();
            });

            $menuButton.on('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                showModernDesktopTitlebarMenu($container);
            });
        }
    }

    if (options.showIcon !== false && (classicTitleIcon || app.icon)) {
        const $icon = $('<span class="classic-window-icon"></span>');
        if (isModernDesktopApp) {
            $icon.addClass('modern-desktop-window-icon');
        }
        if (titlePlateClass) {
            $icon.addClass(titlePlateClass);
        }
        if (classicTitleIcon) {
            const imageStyle = titlePlateClass ? 'style="object-fit: cover; width: 100%; height: 100%;"' : '';
            $icon.append(`<img src="${classicTitleIcon}" alt="" ${imageStyle}>`);
        } else if (app.icon) {
            $icon.append(`<span class="${app.icon}"></span>`);
        }
        $title.append($icon);
    } else {
        $title.addClass('no-icon');
    }

    if (isModernDesktopApp) {
        $title.append($menuButton);
    }

    if (options.showTitle !== false) {
        $title.append(`<span class="classic-window-name">${app.name}</span>`);
    } else {
        $title.addClass('title-hidden');
    }

    const $titlebarAppRegion = customTitlebarStyle
        ? $('<div class="classic-window-titlebar-app-region"></div>')
        : $();

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

    const $exitFullscreenBtn = isModernDesktopApp ? $(`
        <button class="classic-window-control-btn exit-fullscreen" title="Exit fullscreen" aria-label="Exit fullscreen">
            <span class="classic-window-control-glyph" aria-hidden="true"></span>
        </button>
    `) : $();

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

    if ($exitFullscreenBtn.length) {
        $exitFullscreenBtn.on('click', function (e) {
            e.stopPropagation();
            const windowId = $container.attr('data-window-id');
            if (isContinuumTabletShellMode()) {
                minimizeClassicWindow(windowId || app.id);
                return;
            }

            toggleModernDesktopMetroMode(windowId || app.id);
        });
    }

    $closeBtn.on('click', function (e) {
        e.stopPropagation();
        const windowId = $container.attr('data-window-id');
        closeClassicApp(windowId || app.id);
    });

    // Assemble controls
    $controls.append($minimizeBtn);
    if ($exitFullscreenBtn.length) {
        $controls.append($exitFullscreenBtn);
    }
    $controls.append($maximizeBtn);
    $controls.append($closeBtn);

    if (isModernDesktopApp) {
        updateModernDesktopMenuLabel($container);
    }

    // Assemble titlebar
    $titlebar.append($title);
    if ($titlebarAppRegion.length) {
        $titlebar.append($titlebarAppRegion);
    }
    $titlebar.append($controls);

    // Create content area
    const $content = $('<div class="classic-window-content"></div>');
    if (customTitlebarStyle) {
        $content
            .addClass('classic-window-content--custom-titlebar')
            .addClass(`classic-window-content--custom-titlebar-${customTitlebarStyle}`);
    }
    let $iframe = null;
    let $splashSurfaceTargets = $();
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

        fetch(appPathWithCacheBuster)
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
                    if (cloned.tagName === 'LINK') {
                        const sourceHref = style.getAttribute('href');
                        const resolvedHref = resolveUrl(sourceHref);
                        cloned.href = isLocalStylesheetHref(sourceHref)
                            ? appendCacheBuster(resolvedHref, styleReloadToken)
                            : resolvedHref;
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
                $wrapper[0].__hostLaunchOptions = { ...launchOptions };
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

                // Deliver preloaded file data when available, otherwise fall back to a path-only open.
                if (launchOptions.openFileData) {
                    setTimeout(() => {
                        const event = new CustomEvent('openFileData', {
                            detail: { fileData: launchOptions.openFileData },
                            bubbles: true,
                            cancelable: true
                        });
                        $wrapper[0].dispatchEvent(event);
                    }, 100);
                } else if (launchOptions.openFilePath) {
                    setTimeout(() => {
                        const event = new CustomEvent('openFile', {
                            detail: { filePath: launchOptions.openFilePath },
                            bubbles: true,
                            cancelable: true
                        });
                        $wrapper[0].dispatchEvent(event);
                    }, 100);
                }

                if (Object.keys(launchOptions || {}).length > 0) {
                    setTimeout(() => {
                        const event = new CustomEvent('host-command', {
                            detail: {
                                action: 'setLaunchOptions',
                                launchOptions: { ...launchOptions },
                                appId: app.id,
                                windowId: $container.attr('data-window-id') || undefined
                            },
                            bubbles: true,
                            cancelable: false
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
    } else if (app.webview && app.webview.enabled) {
        // Use Electron webview for apps with webview config (e.g. market apps)
        const webviewUrl = app.webview.url || app.path;
        const partition = app.webview.partition || 'persist:' + app.id;
        $iframe = $(`<webview class="classic-window-iframe" allowpopups disablewebsecurity></webview>`);
        $iframe.attr('src', webviewUrl);
        $iframe.attr('partition', partition);
        $content.append($iframe);
        $splashSurfaceTargets = $iframe;

        $iframe.on('dom-ready', function () {
            if (!requiresExplicitReadySignal) {
                markClassicWindowReady('dom-ready');
            }
        });

        $iframe.on('did-fail-load', function (event) {
            const errorCode = event.originalEvent ? event.originalEvent.errorCode : -1;
            if (errorCode === -3) return; // Ignore aborted loads
            console.error('[App.js] Webview failed to load for', app.id);
        });
    } else if (app.useWebview) {
        // Use Electron webview with nodeIntegration for apps that need Node.js access
        $iframe = $(`<webview class="classic-window-iframe" src="${appPathWithCacheBuster}" nodeintegration webpreferences="contextIsolation=no"></webview>`);
        $content.append($iframe);
        $splashSurfaceTargets = $iframe;

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
                        'ui-wall-color': rootStyles.getPropertyValue('--ui-wall-color').trim(),
                        'ui-wall-text-contrast': rootStyles.getPropertyValue('--ui-wall-text-contrast').trim()
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
        $iframe = $(`<iframe class="classic-window-iframe" src="${appPathWithCacheBuster}"></iframe>`);
        $content.append($iframe);
        $splashSurfaceTargets = $iframe;

        // Send theme variables to iframe once it loads
        $iframe.on('load', function () {
            const iframeDocument = $iframe[0].contentDocument;
            if (iframeDocument) {
                reloadDocumentLocalStylesheets(iframeDocument, styleReloadToken);
            }

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
                        'ui-wall-color': rootStyles.getPropertyValue('--ui-wall-color').trim(),
                        'ui-wall-text-contrast': rootStyles.getPropertyValue('--ui-wall-text-contrast').trim()
                    }
                }, '*');
                console.log('[App.js] Sent theme variables to classic app iframe:', app.id);
            }

            if (!requiresExplicitReadySignal) {
                markClassicWindowReady('load');
            }
        });
    }

    if (isModernDesktopApp) {
        createModernAppContentSplash(app, $content, $splashSurfaceTargets);
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
    if ($titlebarTrigger) {
        $container.append($titlebarTrigger);
    }
    $container.append($titlebar);
    $container.append($content);

    // Set initial position (centered) using window options
    const initialBounds = getClassicWindowDefaultBounds(app, launchOptions);
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

    // Add to desktop window layer so desktop-wide effects can treat windows as one scene
    getDesktopWindowLayer().append($container);

    if (!shouldDeferReveal && !isBackgroundPreload && launchOptions.suppressOpenAnimation !== true) {
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
    storeClassicWindowLaunchOptions(windowId, launchOptions);

    // Clear launch flag now that window is registered
    launchingApps.delete(app.id);

    if (!isBackgroundPreload && isContinuumTabletShellMode()) {
        requestAnimationFrame(function () {
            const runningWindow = AppsManager.getRunningWindow(windowId);
            if (!runningWindow?.$container?.length) {
                return;
            }

            applyContinuumTabletWindowState(runningWindow);
        });
    }

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

                if (normalizedLaunchOptions.openFileData) {
                    $iframe[0].send('openFileData', {
                        fileData: normalizedLaunchOptions.openFileData
                    });
                } else if (normalizedLaunchOptions.openFilePath) {
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
                try {
                    iframeWindow.launchOptions = normalizedLaunchOptions;
                } catch (e) {
                    // Cross-origin iframe — use postMessage instead
                }
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

                if (normalizedLaunchOptions.openFileData) {
                    iframeWindow.postMessage({
                        action: 'openFileData',
                        fileData: normalizedLaunchOptions.openFileData
                    }, '*');
                } else if (normalizedLaunchOptions.openFilePath) {
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
        } else if (e.data.action === 'explorerHostRequest' && app.id === 'explorer' && e.data.requestId) {
            Promise.resolve(resolveExplorerHostRequest(e.data))
                .then(result => {
                    sendClassicWindowCommand($container, {
                        action: 'explorer-host-response',
                        requestId: e.data.requestId,
                        result
                    });
                })
                .catch(error => {
                    sendClassicWindowCommand($container, {
                        action: 'explorer-host-response',
                        requestId: e.data.requestId,
                        error: error && error.message ? error.message : 'Explorer host request failed.'
                    });
                });
        } else if (e.data.action === 'applyTaskbarSettings') {
            // Handle taskbar settings from Taskbar Properties
            Promise.resolve(applyTaskbarSettings(e.data.settings)).catch(error => {
                console.error('Failed to apply taskbar settings:', error);
            });
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
    return windowId;
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
        windowData = getRunningWindowData(windowIdOrAppId);
        if (windowData) {
            windowId = windowData.windowId;
        }
    }

    if (!windowData) {
        console.error('Classic window not running:', windowIdOrAppId);
        return;
    }

    closeSnapAssist();

    const $modernDesktopMenu = $('#modern-desktop-titlebar-menu-overlay');
    if (isModernDesktopWindowData(windowData) && $modernDesktopMenu.attr('data-window-id') === windowId) {
        hideModernDesktopTitlebarMenu();
    }

    if (shouldRecycleExplorerWindow(windowData)) {
        recycleExplorerWindow(windowData);
        return;
    }

    const $container = windowData.$container;
    const $iframe = $container.find('iframe');
    const shouldRouteToContinuumStartSurface = shouldRouteContinuumTabletDismissalToStartSurface(windowData);

    // Check if iframe has a confirmClose method
    if ($iframe.length && $iframe[0].contentWindow) {
        try {
            const iframeWindow = $iframe[0].contentWindow;

            // Check if the app wants to handle close confirmation
            if (typeof iframeWindow.confirmClose === 'function') {
                const canClose = await iframeWindow.confirmClose();
                if (!canClose) {
                    // App cancelled the close
                    return;
                }
            }
        } catch (e) {
            // Cross-origin iframe — can't access contentWindow properties, proceed with close
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
        const hostStylesheet = $container.data('hostStylesheet');
        if (hostStylesheet) {
            releaseClassicHostStylesheet(hostStylesheet);
        }

        $container.remove();
        console.log('Classic window closed:', windowId);

        // Unregister window from running windows
        AppsManager.unregisterRunningWindow(windowId);

        // Clear active window if this was it
        if (activeClassicWindow === windowId) {
            activeClassicWindow = null;
        }

        updateDesktopModernMetroModeBodyState();

        if (shouldRouteToContinuumStartSurface) {
            maybeOpenContinuumStartSurfaceAfterDesktopModernDismissal();
        }
    }, CLASSIC_WINDOW_CLOSE_ANIMATION_MS);
}

function relaunchClassicApp(windowIdOrAppId, appId, delayMs = 1000) {
    const relaunchAppId = typeof appId === 'string' && appId ? appId : null;
    if (!relaunchAppId) {
        console.error('Cannot relaunch classic app without an app id.');
        return;
    }

    closeClassicApp(windowIdOrAppId);

    const reopenDelay = Math.max(
        CLASSIC_WINDOW_CLOSE_ANIMATION_MS + 50,
        Number.isFinite(Number(delayMs)) ? Number(delayMs) : 1000
    );

    setTimeout(() => {
        launchApp(relaunchAppId);
    }, reopenDelay);
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

function syncClassicWindowShellStates(activeWindowId = null) {
    if (!window.AppsManager ||
        typeof AppsManager.getRunningWindowsSnapshot !== 'function' ||
        typeof AppsManager.setWindowState !== 'function') {
        return;
    }

    AppsManager.getRunningWindowsSnapshot().forEach((windowData) => {
        if (!windowData?.windowId || !windowData.$container?.length) {
            return;
        }

        if (windowData.state === 'minimized' || windowData.$container.data('backgroundPreload')) {
            return;
        }

        const nextState = activeWindowId && windowData.windowId === activeWindowId ? 'active' : 'inactive';
        if (windowData.state !== nextState) {
            AppsManager.setWindowState(windowData.windowId, nextState);
        }
    });
}

function clearClassicWindowFocusForShell(reason = 'shell-surface') {
    unfocusAllClassicWindows(reason);
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
        windowData = getRunningWindowData(windowIdOrAppId);
        if (windowData) {
            windowId = windowData.windowId;
        }
    }

    if (!windowData) return;

    dismissContinuumStartSurfaceForAppActivation('desktop');

    if (!isModernDesktopWindowData(windowData)) {
        hideModernDesktopTitlebarMenu();
    }

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
    syncClassicWindowShellStates(windowId);

    if (typeof document !== 'undefined') {
        document.dispatchEvent(new CustomEvent('win8:running-windows-changed', {
            detail: {
                reason: 'focus',
                windowId,
                appId: windowData.appId,
                state: windowData.state
            }
        }));
    }
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
        windowData = getRunningWindowData(windowIdOrAppId);
    }

    if (!windowData) return;

    const $container = windowData.$container;
    const $titleElement = $container.find('.classic-window-name');

    if ($titleElement.length) {
        $titleElement.text(newTitle);
        console.log(`Updated window title for ${windowIdOrAppId} to: ${newTitle}`);
        if (AppsManager.notifyRunningWindowUpdated) {
            AppsManager.notifyRunningWindowUpdated(windowData.windowId, {
                appId: windowData.appId,
                title: newTitle
            });
        }
    }
}

function updateClassicWindowIcon(windowIdOrAppId, iconPath) {
    const isWindowId = windowIdOrAppId && windowIdOrAppId.includes('-') &&
        windowIdOrAppId.split('-').length >= 3;

    let windowData;

    if (isWindowId) {
        windowData = AppsManager.getRunningWindow(windowIdOrAppId);
    } else {
        windowData = getRunningWindowData(windowIdOrAppId);
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
    if (AppsManager.notifyRunningWindowUpdated) {
        AppsManager.notifyRunningWindowUpdated(windowData.windowId, {
            appId: windowData.appId,
            iconPath
        });
    }
}

// Unfocus all classic windows when a shell surface takes focus
function unfocusAllClassicWindows(reason = 'shell-surface') {
    console.log('Unfocusing all classic windows:', reason);

    // Remove active class from all windows
    $('.classic-app-container').removeClass('active').addClass('inactive');

    activeClassicWindow = null;
    syncClassicWindowShellStates(null);
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
        windowData = getRunningWindowData(windowIdOrAppId);
        if (windowData) {
            windowId = windowData.windowId;
            appId = windowData.appId;
        }
    }

    if (!windowData) return;

    closeSnapAssist();

    const $container = windowData.$container;
    const $modernDesktopMenu = $('#modern-desktop-titlebar-menu-overlay');
    if (isModernDesktopWindowData(windowData) && $modernDesktopMenu.attr('data-window-id') === windowId) {
        hideModernDesktopTitlebarMenu();
    }
    const shouldRouteToContinuumStartSurface = shouldRouteContinuumTabletDismissalToStartSurface(windowData);
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
        updateDesktopModernMetroModeBodyState();

        if (shouldRouteToContinuumStartSurface) {
            maybeOpenContinuumStartSurfaceAfterDesktopModernDismissal();
        }

        console.log('Classic window minimized:', windowId);
    }, CLASSIC_WINDOW_MINIMIZE_ANIMATION_MS); // Match the animation duration in CSS
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
        windowData = getRunningWindowData(windowIdOrAppId);
        if (windowData) {
            windowId = windowData.windowId;
            appId = windowData.appId;
        }
    }

    if (!windowData) return;

    dismissContinuumStartSurfaceForAppActivation('desktop');

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
    updateDesktopModernMetroModeBodyState();

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
        reconcileContinuumWindowStateAfterClassicRestore(getRunningWindowData(windowId));

        console.log('Classic window restored:', windowId);
    }, CLASSIC_WINDOW_RESTORE_ANIMATION_MS); // Match the animation duration in CSS
}

function setClassicWindowMaximizeButtonState($container, isRestored) {
    const $maximizeBtn = $container.find('.classic-window-control-btn.maximize');
    $maximizeBtn.toggleClass('is-restored', Boolean(isRestored));
}

function getClassicWindowBoundsState($container) {
    return {
        left: $container.css('left'),
        top: $container.css('top'),
        width: $container.css('width'),
        height: $container.css('height')
    };
}

function snapClassicWindowToZone(windowIdOrAppId, snapZone, options = {}) {
    const validSnapZones = ['left', 'right', 'top', 'top-left', 'top-right', 'bottom-left', 'bottom-right'];
    if (!validSnapZones.includes(snapZone)) {
        return false;
    }

    const isWindowId = windowIdOrAppId && windowIdOrAppId.includes('-') &&
        windowIdOrAppId.split('-').length >= 3;

    let windowData;

    if (isWindowId) {
        windowData = AppsManager.getRunningWindow(windowIdOrAppId);
    } else {
        windowData = getRunningWindowData(windowIdOrAppId);
    }

    if (!windowData?.$container?.length) {
        return false;
    }

    const {
        suppressSnapAssist = false,
        ensureVisible = false,
        focusWindow = true
    } = options;

    const $container = windowData.$container;
    closeSnapAssist();

    if (!options.continuumAuto && isContinuumTabletShellMode()) {
        markContinuumWindowStateManuallyAdjusted(windowData);
    }

    if (ensureVisible) {
        $container
            .removeClass('launch-deferred minimizing restoring closing')
            .show();
        AppsManager.setWindowState(windowData.windowId, 'active');
        updateDesktopModernMetroModeBodyState();
    }

    const preSnapState = $container.hasClass('maximized')
        ? ($container.data('prevState') || getClassicWindowBoundsState($container))
        : ($container.data('isSnapped')
            ? ($container.data('preSnapState') || getClassicWindowBoundsState($container))
            : getClassicWindowBoundsState($container));

    // Remove all snap classes
    $container.removeClass('maximized snapped snapped-left snapped-right snapped-top-left snapped-top-right snapped-bottom-left snapped-bottom-right');

    // Get taskbar reserved height from CSS variable
    const taskbarReservedHeight = parseInt(
        getComputedStyle(document.body).getPropertyValue('--taskbar-reserved-height') || '40'
    );
    const availableHeight = window.innerHeight - taskbarReservedHeight;
    const inset = 6; // pixels to inset from edges

    if (snapZone === 'top') {
        $container.data('prevState', preSnapState);
        $container.removeData('isSnapped');
        $container.removeData('snapZone');
        $container.removeData('preSnapState');
        $container.addClass('maximized');
        setClassicWindowMaximizeButtonState($container, true);
    } else if (['left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(snapZone)) {
        $container
            .data('preSnapState', preSnapState)
            .data('isSnapped', true)
            .data('snapZone', snapZone)
            .removeData('prevState');

        const cssProp = {
            'left': {
                left: '0',
                top: '0',
                width: '50%',
                height: '100%'
            },
            'right': {
                left: '50%',
                top: '0',
                width: '50%',
                height: '100%'
            },
            'top-left': {
                left: '0',
                top: '0',
                width: '50%',
                height: '50%'
            },
            'top-right': {
                left: '50%',
                top: '0',
                width: '50%',
                height: '50%'
            },
            'bottom-left': {
                left: '0',
                top: '50%',
                width: '50%',
                height: `calc(50% - ${taskbarReservedHeight}px)`
            },
            'bottom-right': {
                left: '50%',
                top: '50%',
                width: '50%',
                height: `calc(50% - ${taskbarReservedHeight}px)`
            }
        };

        $container.css(cssProp[snapZone]);
        $container.addClass('snapped snapped-' + snapZone);
        setClassicWindowMaximizeButtonState($container, false);
    }

    if (focusWindow) {
        focusClassicWindow(windowData.windowId);
    }

    if (!suppressSnapAssist && (snapZone === 'left' || snapZone === 'right')) {
        void openSnapAssistForSnappedWindow(windowData.windowId, snapZone);
    }

    return true;
}

// Toggle maximize/restore for a classic window
function toggleMaximizeClassicWindow(windowIdOrAppId, options = {}) {
    // Determine if this is a windowId or appId
    const isWindowId = windowIdOrAppId && windowIdOrAppId.includes('-') &&
        windowIdOrAppId.split('-').length >= 3;

    let windowData;

    if (isWindowId) {
        windowData = AppsManager.getRunningWindow(windowIdOrAppId);
    } else {
        windowData = getRunningWindowData(windowIdOrAppId);
    }

    if (!windowData) return;

    closeSnapAssist();

    if (!options.continuumAuto && isContinuumTabletShellMode()) {
        markContinuumWindowStateManuallyAdjusted(windowData);
    }

    const $container = windowData.$container;

    if (
        isModernDesktopWindowData(windowData) &&
        isContinuumTabletShellMode() &&
        !$container.hasClass('metro-mode')
    ) {
        toggleModernDesktopMetroMode(windowData.windowId || windowIdOrAppId);
        return;
    }

    const shouldForceMaximize = options.forceMaximize === true;

    // Clear any stale maximize/restore animation classes before applying new ones
    $container.removeClass('maximizing-window restoring-from-max-window');
    clearTimeout($container.data('maximizeAnimTimer'));

    if ($container.hasClass('maximized') && !shouldForceMaximize) {
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
        $container.removeClass('maximized').addClass('restoring-from-max-window');
        setClassicWindowMaximizeButtonState($container, false);
        const restoreAnimTimer = setTimeout(function () {
            $container.removeClass('restoring-from-max-window');
        }, CLASSIC_WINDOW_RESTORE_FROM_MAX_ANIMATION_MS);
        $container.data('maximizeAnimTimer', restoreAnimTimer);
    } else if (!$container.hasClass('maximized')) {
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
        $container.addClass('maximized maximizing-window');
        setClassicWindowMaximizeButtonState($container, true);
        const maximizeAnimTimer = setTimeout(function () {
            $container.removeClass('maximizing-window');
        }, CLASSIC_WINDOW_MAXIMIZE_ANIMATION_MS);
        $container.data('maximizeAnimTimer', maximizeAnimTimer);
    }
}

// Initialize window dragging
function initClassicWindowDrag($container, $titlebar) {
    let isDragging = false;
    let activePointerId = null;
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

    // Double-tap detection for maximize
    let lastTapTime = 0;
    let lastTapX = 0;
    let lastTapY = 0;
    const DOUBLE_TAP_TIMEOUT = 300; // milliseconds
    const DOUBLE_TAP_DISTANCE = 50; // pixels

    // Create snap preview element if it doesn't exist
    if ($('#snap-preview').length === 0) {
        $snapPreview = $('<div id="snap-preview"></div>');
        $('#desktop').append($snapPreview);
    } else {
        $snapPreview = $('#snap-preview');
    }

    const titlebarInteractiveSelectorParts = [
        '.classic-window-control-btn',
        '.modern-desktop-window-menu-button'
    ];
    const customTitlebarInteractiveSelector = $container.data('titlebarInteractiveSelector');
    if (typeof customTitlebarInteractiveSelector === 'string' && customTitlebarInteractiveSelector.trim()) {
        titlebarInteractiveSelectorParts.push(customTitlebarInteractiveSelector.trim());
    }
    const titlebarInteractiveSelector = titlebarInteractiveSelectorParts.join(', ');

    function getPointerOffsetWithinElement(event, element) {
        const rect = element.getBoundingClientRect();
        const width = rect.width || element.offsetWidth || 1;
        const height = rect.height || element.offsetHeight || 1;

        return {
            x: Math.max(0, Math.min(event.clientX - rect.left, width)),
            y: Math.max(0, Math.min(event.clientY - rect.top, height))
        };
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
        } else if (edge === 'top-left') {
            pulseX = 0;
            pulseY = 0;
        } else if (edge === 'top-right') {
            pulseX = window.innerWidth;
            pulseY = 0;
        } else if (edge === 'bottom-left') {
            pulseX = 0;
            pulseY = window.innerHeight;
        } else if (edge === 'bottom-right') {
            pulseX = window.innerWidth;
            pulseY = window.innerHeight;
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

    // Add double-click to maximize/restore (mouse)
    $titlebar.on('dblclick', function (e) {
        if ($container.hasClass('metro-mode')) {
            return;
        }

        // Don't maximize if clicking on buttons
        if ($(e.target).closest(titlebarInteractiveSelector).length) {
            return;
        }

        // Get the app ID and toggle maximize
        const appId = $container.data('app-id');
        if (appId) {
            toggleMaximizeClassicWindow(appId);
        }
    });

    $titlebar.on('pointerdown', function (e) {
        if ($container.hasClass('metro-mode')) {
            return;
        }

        if (e.pointerType === 'mouse' && e.button !== 0) {
            return;
        }

        if (e.isPrimary === false) {
            return;
        }

        // Don't drag if clicking on buttons
        if ($(e.target).closest(titlebarInteractiveSelector).length) {
            return;
        }

        // Check for double-tap on touch devices (or fast touches)
        const currentTime = Date.now();
        const timeDiff = currentTime - lastTapTime;
        const distanceDiff = Math.sqrt(
            Math.pow(e.clientX - lastTapX, 2) +
            Math.pow(e.clientY - lastTapY, 2)
        );

        if (timeDiff < DOUBLE_TAP_TIMEOUT && distanceDiff < DOUBLE_TAP_DISTANCE) {
            // This is a double-tap
            const appId = $container.data('app-id');
            if (appId) {
                toggleMaximizeClassicWindow(appId);
            }
            // Reset tap tracking to prevent triple-tap issues
            lastTapTime = 0;
            lastTapX = 0;
            lastTapY = 0;
            return; // Don't start dragging on double-tap
        }

        // Update tap tracking for next potential double-tap
        lastTapTime = currentTime;
        lastTapX = e.clientX;
        lastTapY = e.clientY;

        isDragging = true;
        activePointerId = e.pointerId;
        hasMovedAtLeastOnePx = false;
        startX = e.clientX;
        startY = e.clientY;
        pendingRestoreState = null;
        currentSnapZone = null;
        lastSnapZone = null;

        const titlebarElement = $titlebar[0];
        const pointerOffset = getPointerOffsetWithinElement(e, titlebarElement);

        if (typeof titlebarElement.setPointerCapture === 'function') {
            try {
                titlebarElement.setPointerCapture(e.pointerId);
            } catch (error) {
                console.debug('Unable to capture titlebar pointer:', error);
            }
        }

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
            mouseOffsetRatio.x = titlebarWidth > 0 ? pointerOffset.x / titlebarWidth : 0.5;
            mouseOffsetRatio.y = 0;

            // Store pending restore info (don't apply yet)
            pendingRestoreState = {
                type: 'maximized',
                prevState: prevState,
                mouseOffsetRatio: { ...mouseOffsetRatio },
                clickOffsetY: pointerOffset.y
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
                mouseOffsetRatio.x = titlebarWidth > 0 ? pointerOffset.x / titlebarWidth : 0.5;

                // Store pending restore info (don't apply yet)
                pendingRestoreState = {
                    type: 'snapped',
                    preSnapState: preSnapState,
                    mouseOffsetRatio: { ...mouseOffsetRatio },
                    clickOffsetY: pointerOffset.y
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

        const windowId = $container.attr('data-window-id') || $container.data('app-id');
        if (windowId) {
            closeSnapAssist();
            focusClassicWindow(windowId);
        }

        // Disable pointer events on iframe to prevent it from stealing mouse events
        $iframe.css('pointer-events', 'none');

        e.preventDefault();
    });

    $(document).on('pointermove', function (e) {
        if (!isDragging || e.pointerId !== activePointerId) return;

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
                    $container.removeClass('snapped snapped-left snapped-right snapped-top-left snapped-top-right snapped-bottom-left snapped-bottom-right');
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
            const cornerThreshold = 50; // pixels to define corner zone size
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

            // Check for corner snaps first (priority over edge snaps)
            const nearLeftEdge = e.clientX <= snapThreshold;
            const nearRightEdge = e.clientX >= screenWidth - snapThreshold;
            const nearTopEdge = e.clientY <= snapThreshold;
            const nearBottomEdge = e.clientY >= screenHeight - taskbarReservedHeight - snapThreshold;

            if (nearTopEdge && nearLeftEdge) {
                // Top-left corner
                currentSnapZone = 'top-left';
                if (lastSnapZone !== 'top-left') {
                    $snapPreview.css({
                        left: currentLeft + 'px',
                        top: currentTop + 'px',
                        width: currentWidth + 'px',
                        height: currentHeight + 'px',
                        display: 'block'
                    });
                    createSnapPulse(e.clientX, e.clientY, 'top-left');
                    $snapPreview[0].offsetHeight;
                    $snapPreview.css({
                        left: '0',
                        top: '0',
                        width: '50%',
                        height: '50%'
                    });
                }
            } else if (nearTopEdge && nearRightEdge) {
                // Top-right corner
                currentSnapZone = 'top-right';
                if (lastSnapZone !== 'top-right') {
                    $snapPreview.css({
                        left: currentLeft + 'px',
                        top: currentTop + 'px',
                        width: currentWidth + 'px',
                        height: currentHeight + 'px',
                        display: 'block'
                    });
                    createSnapPulse(e.clientX, e.clientY, 'top-right');
                    $snapPreview[0].offsetHeight;
                    $snapPreview.css({
                        left: '50%',
                        top: '0',
                        width: '50%',
                        height: '50%'
                    });
                }
            } else if (nearBottomEdge && nearLeftEdge) {
                // Bottom-left corner
                currentSnapZone = 'bottom-left';
                if (lastSnapZone !== 'bottom-left') {
                    $snapPreview.css({
                        left: currentLeft + 'px',
                        top: currentTop + 'px',
                        width: currentWidth + 'px',
                        height: currentHeight + 'px',
                        display: 'block'
                    });
                    createSnapPulse(e.clientX, e.clientY, 'bottom-left');
                    $snapPreview[0].offsetHeight;
                    $snapPreview.css({
                        left: '0',
                        top: '50%',
                        width: '50%',
                        height: `calc(50% - ${taskbarReservedHeight}px)`
                    });
                }
            } else if (nearBottomEdge && nearRightEdge) {
                // Bottom-right corner
                currentSnapZone = 'bottom-right';
                if (lastSnapZone !== 'bottom-right') {
                    $snapPreview.css({
                        left: currentLeft + 'px',
                        top: currentTop + 'px',
                        width: currentWidth + 'px',
                        height: currentHeight + 'px',
                        display: 'block'
                    });
                    createSnapPulse(e.clientX, e.clientY, 'bottom-right');
                    $snapPreview[0].offsetHeight;
                    $snapPreview.css({
                        left: '50%',
                        top: '50%',
                        width: '50%',
                        height: `calc(50% - ${taskbarReservedHeight}px)`
                    });
                }
            } else if (e.clientX <= snapThreshold) {
                // Left snap
                currentSnapZone = 'left';

                if (lastSnapZone !== 'left') {
                    $snapPreview.css({
                        left: currentLeft + 'px',
                        top: currentTop + 'px',
                        width: currentWidth + 'px',
                        height: currentHeight + 'px',
                        display: 'block'
                    });
                    createSnapPulse(e.clientX, e.clientY, 'left');
                    $snapPreview[0].offsetHeight;
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

                if (lastSnapZone !== 'right') {
                    $snapPreview.css({
                        left: currentLeft + 'px',
                        top: currentTop + 'px',
                        width: currentWidth + 'px',
                        height: currentHeight + 'px',
                        display: 'block'
                    });
                    createSnapPulse(e.clientX, e.clientY, 'right');
                    $snapPreview[0].offsetHeight;
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

                if (lastSnapZone !== 'top') {
                    $snapPreview.css({
                        left: currentLeft + 'px',
                        top: currentTop + 'px',
                        width: currentWidth + 'px',
                        height: currentHeight + 'px',
                        display: 'block'
                    });
                    createSnapPulse(e.clientX, e.clientY, 'top');
                    $snapPreview[0].offsetHeight;
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

    $(document).on('pointerup pointercancel', function (e) {
        if (!isDragging || e.pointerId !== activePointerId) {
            return;
        }

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
                const windowId = $container.attr('data-window-id') || $container.data('app-id');
                if (windowId) {
                    snapClassicWindowToZone(windowId, currentSnapZone);
                }
            } else if (hasMovedAtLeastOnePx && isContinuumTabletShellMode()) {
                const windowId = $container.attr('data-window-id') || $container.data('app-id');
                if (windowId) {
                    markContinuumWindowStateManuallyAdjusted(getRunningWindowData(windowId));
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

        const titlebarElement = $titlebar[0];
        if (typeof titlebarElement.releasePointerCapture === 'function' && activePointerId !== null) {
            try {
                titlebarElement.releasePointerCapture(activePointerId);
            } catch (error) {
                console.debug('Unable to release titlebar pointer:', error);
            }
        }

        isDragging = false;
        activePointerId = null;
        currentSnapZone = null;
    });
}

// Initialize window resizing
function initClassicWindowResize($container) {
    let isResizing = false;
    let activePointerId = null;
    let resizeDirection = null;
    let startX, startY, startWidth, startHeight, startLeft, startTop;
    let resizedDuringGesture = false;

    const $iframe = $container.find('.classic-window-iframe');

    $container.find('.classic-window-resize-handle').on('pointerdown', function (e) {
        if ($container.hasClass('metro-mode')) {
            return;
        }

        // Only handle primary pointer (left mouse button or main touch contact)
        if (e.isPrimary === false) {
            return;
        }

        closeSnapAssist();

        isResizing = true;
        activePointerId = e.pointerId;
        resizeDirection = $(this).attr('class').split(' ')[1];
        startX = e.clientX;
        startY = e.clientY;
        startWidth = $container.outerWidth();
        startHeight = $container.outerHeight();
        startLeft = parseInt($container.css('left'));
        startTop = parseInt($container.css('top'));
        resizedDuringGesture = false;

        // Disable pointer events on iframe to prevent it from interfering with resizing
        $iframe.css('pointer-events', 'none');

        // Discard snap state when manually resizing
        if ($container.data('isSnapped')) {
            $container.removeClass('snapped snapped-left snapped-right');
            $container.removeData('isSnapped');
            $container.removeData('snapZone');
            $container.removeData('preSnapState');
        }

        // Capture the pointer to this element
        const resizeHandle = this;
        if (typeof resizeHandle.setPointerCapture === 'function') {
            try {
                resizeHandle.setPointerCapture(e.pointerId);
            } catch (error) {
                console.debug('Unable to capture resize handle pointer:', error);
            }
        }

        e.preventDefault();
        e.stopPropagation();
    });

    $(document).on('pointermove', function (e) {
        if (!isResizing || e.pointerId !== activePointerId) return;

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
        resizedDuringGesture = true;
    });

    $(document).on('pointerup pointercancel', function (e) {
        if (!isResizing || e.pointerId !== activePointerId) {
            return;
        }

        if (isResizing) {
            // Re-enable pointer events on iframe
            $iframe.css('pointer-events', 'auto');

            if (resizedDuringGesture && isContinuumTabletShellMode()) {
                const windowId = $container.attr('data-window-id') || $container.data('app-id');
                if (windowId) {
                    markContinuumWindowStateManuallyAdjusted(getRunningWindowData(windowId));
                }
            }
        }
        isResizing = false;
        activePointerId = null;
        resizeDirection = null;
        resizedDuringGesture = false;

        // Release pointer capture
        const resizeHandles = $container.find('.classic-window-resize-handle');
        resizeHandles.each(function () {
            if (typeof this.releasePointerCapture === 'function' && e.pointerId !== null) {
                try {
                    this.releasePointerCapture(e.pointerId);
                } catch (error) {
                    // Handle error silently
                }
            }
        });
    });
}

// Apply taskbar settings from Taskbar Properties
async function applyTaskbarSettings(settings) {
    console.log('Applying taskbar settings:', settings);

    const thresholdResolution = reconcileThresholdSettingsChangeRequest(settings);

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

    if (settings.showUserTile !== undefined) {
        setTaskbarUserTileVisible(settings.showUserTile);
    }

    if (settings.taskbarButtons) {
        console.log('[Taskbar] Taskbar button combine mode change requested:', settings.taskbarButtons, '(not yet visualised)');
    }

    if (settings.navigation) {
        const immediateNavigationSettings = { ...settings.navigation };
        delete immediateNavigationSettings.useStartMenu;

        const navChanges = applyNavigationSettingsUpdate(immediateNavigationSettings);

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

    if (thresholdResolution.requiresPrompt) {
        const dialogResult = await promptForThresholdSignOut(thresholdResolution.featureLabel);
        if (dialogResult === 'signout') {
            signOut();
        }
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

function buildPositionedTileGridHtml(apps, layout = null, options = {}) {
    const resolvedLayout = layout || calculateTileLayout(apps);
    let html = '';
    const rowCount = Number.isFinite(options.rowCount) ? options.rowCount : calculatedTileRows;
    const isStartMenuFullscreenMotion = options.motionProfile === 'start-menu-fullscreen';
    const centerColumn = (Math.max(resolvedLayout.maxColumn, 1) + 1) / 2;
    const centerRow = (Math.max(rowCount, 1) + 1) / 2;

    resolvedLayout.tiles.forEach((tileInfo, index) => {
        const tileHTML = AppsManager.generateTileHTML(tileInfo.app);
        const size = tileInfo.size;
        const gridRowStyle = `${tileInfo.row} / span ${size.rows}`;
        const gridColStyle = `${tileInfo.col} / span ${size.cols}`;
        const styleParts = [
            `grid-row: ${gridRowStyle}`,
            `grid-column: ${gridColStyle}`
        ];

        if (isStartMenuFullscreenMotion) {
            const tileCenterColumn = tileInfo.col + ((size.cols - 1) / 2);
            const tileCenterRow = tileInfo.row + ((size.rows - 1) / 2);
            const deltaColumn = centerColumn - tileCenterColumn;
            const deltaRow = centerRow - tileCenterRow;
            const travelX = Math.round(deltaColumn * 10);
            const travelY = Math.round(deltaRow * 12);
            const distance = Math.abs(deltaColumn) + Math.abs(deltaRow);
            const staggerDelay = Math.min(120, Math.round(distance * 14) + ((index % 4) * 10));
            const startScale = [0.9, 0.94, 0.88, 0.92, 0.96][index % 5];

            styleParts.push(`--start-menu-fly-in-x: ${travelX}px`);
            styleParts.push(`--start-menu-fly-in-y: ${travelY}px`);
            styleParts.push(`--start-menu-fly-in-delay: ${staggerDelay}ms`);
            styleParts.push(`--start-menu-fly-in-scale: ${startScale}`);
        }

        const positioned = tileHTML.replace(
            'class="tiles__tile',
            `style="${styleParts.join('; ')};" class="tiles__tile`
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

                // Reserve the entire 2Ã—2 block
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

    // Render desktop/classic apps grouped by folder
    // Separate apps with folders from apps without folders
    const appsWithFolder = desktopApps.filter(app => app.folder);
    const appsWithoutFolder = desktopApps.filter(app => !app.folder);

    // Group apps with folders by folder name
    const folderGroups = {};
    appsWithFolder.forEach(app => {
        if (!folderGroups[app.folder]) {
            folderGroups[app.folder] = [];
        }
        folderGroups[app.folder].push(app);
    });

    // Sort folders alphabetically and render them
    const sortedFolders = Object.keys(folderGroups).sort();
    sortedFolders.forEach(folder => {
        items.push({
            type: 'header',
            html: `<div class="app-list-header app-list-header--folder">${folder}</div>`,
            nextItem: 'app' // This header must have an app below it
        });

        // Sort apps within folder alphabetically
        folderGroups[folder].sort((a, b) => a.name.localeCompare(b.name));
        folderGroups[folder].forEach(app => {
            items.push({
                type: 'app',
                html: AppsManager.generateAppListItemHTML(app)
            });
        });
    });

    // Render apps without folder (shown individually with their own headers)
    appsWithoutFolder.forEach(app => {
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
    const taskbarElement = document.querySelector('.taskbar');

    if ($startButton.length) {
        $startButton.on('click', function () {
            console.log('Start button clicked, currentView:', currentView);
            closeTaskViewPlaceholder();
            toggleStartSurface();
        });

        // Right-click to show Quick Links menu (Win+X)
        $startButton.on('contextmenu', function (e) {
            e.preventDefault();
            console.log('Start button right-clicked');
            showQuickLinksMenu();
        });
    }

    if (taskbarElement) {
        taskbarElement.addEventListener('touchstart', function (event) {
            if (!shouldEnableContinuumTaskbarStartSwipe() || !event.touches || event.touches.length !== 1) {
                resetContinuumTaskbarStartSwipeState();
                return;
            }

            beginContinuumTaskbarStartSwipe(event.touches[0]);
        }, { passive: true });

        taskbarElement.addEventListener('touchmove', function (event) {
            if (!continuumTaskbarStartSwipe.active || !event.touches || event.touches.length !== 1) {
                return;
            }

            if (updateContinuumTaskbarStartSwipe(event.touches[0])) {
                event.preventDefault();
            }
        }, { passive: false });

        const finishTaskbarStartSwipeGesture = function (event) {
            if (!continuumTaskbarStartSwipe.active) {
                return;
            }

            if (event.changedTouches && event.changedTouches.length > 0) {
                continuumTaskbarStartSwipe.currentX = event.changedTouches[0].clientX;
                continuumTaskbarStartSwipe.currentY = event.changedTouches[0].clientY;
            }

            if (finishContinuumTaskbarStartSwipe()) {
                event.preventDefault();
            }
        };

        taskbarElement.addEventListener('touchend', finishTaskbarStartSwipeGesture, { passive: false });
        taskbarElement.addEventListener('touchcancel', function () {
            resetContinuumTaskbarStartSwipeState();
        }, { passive: true });

        document.addEventListener('click', function (event) {
            if (Date.now() >= continuumTaskbarStartSwipe.suppressClickUntil) {
                return;
            }

            if (event.target instanceof Element && event.target.closest('.taskbar')) {
                continuumTaskbarStartSwipe.suppressClickUntil = 0;
                event.preventDefault();
                event.stopPropagation();
            }
        }, true);
    }

    initTaskbarShellButtons();
    initNotificationCenter();
    initTaskbarUserTile();
    initSearchPanel();
    initSearchFlyout();

    if (window.TimeBank && typeof window.TimeBank.subscribe === 'function') {
        window.TimeBank.subscribe(updateTaskbarClock, { immediate: true });
    } else {
        updateTaskbarClock();
        setInterval(updateTaskbarClock, 1000);
    }

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

        if (window.TaskbarDrag &&
            typeof window.TaskbarDrag.consumePendingTaskbarClick === 'function' &&
            window.TaskbarDrag.consumePendingTaskbarClick(appId)) {
            console.log('Taskbar app click suppressed after pointer gesture:', appId);
            return;
        }

        closeTaskViewPlaceholder();
        if (window.TaskbarHoverPreview && typeof window.TaskbarHoverPreview.hide === 'function') {
            window.TaskbarHoverPreview.hide({ immediate: true });
        }

        const appState = AppsManager.getAppState(appId);
        const app = AppsManager.getAppById(appId);
        const shouldPreferActivationOverMinimize =
            isContinuumTabletShellMode() &&
            isStartSurfaceVisible();

        if (!app) return;

        if (!appState || appState === null) {
            // Check if app is running on another virtual desktop before launching new
            if (window.VirtualDesktops && AppsManager.isAppRunningAnywhere(appId)) {
                const desktops = VirtualDesktops.getDesktopsForApp(appId);
                if (desktops.size > 0) {
                    const targetDesktop = desktops.values().next().value;
                    VirtualDesktops.setActiveDesktop(targetDesktop);
                    // Now focus/restore the window on that desktop
                    const newState = AppsManager.getAppState(appId);
                    if (newState === 'minimized') {
                        restoreClassicWindow(appId);
                    } else {
                        focusClassicWindow(appId);
                    }
                    return;
                }
            }
            // App is not running anywhere - launch it
            console.log('Launching app from taskbar:', appId);
            launchApp(app, null, { fromTaskbar: true });
        } else if (shouldPreferActivationOverMinimize) {
            focusOrRestoreTaskbarApp(app);
        } else if (appState === 'active') {
            // If app is already active, minimize it (only if minimizable)
            const windowOptions = app.windowOptions || {};
            const isMinimizable = windowOptions.minimizable !== false;
            const usesDesktopWindowBehavior = isModernDesktopWindow(appId) ||
                app.type === 'meta-classic' ||
                app.type === 'classic';

            if (!isMinimizable) {
                console.log('Cannot minimize app - minimize is disabled:', appId);
                return;
            }

            if (usesDesktopWindowBehavior) {
                minimizeClassicWindow(appId);
            } else if (app.type === 'modern') {
                minimizeModernApp(appId);
            }
        } else if (appState === 'minimized') {
            // If app is minimized, restore it
            if (isModernDesktopWindow(appId) || app.type === 'meta-classic' || app.type === 'classic') {
                restoreClassicWindow(appId);
            } else if (app.type === 'modern') {
                restoreModernApp(appId);
            }
        }
    });

    $(document).on('mousedown', '.taskbar-app', function (e) {
        if (e.button === 1) {
            e.preventDefault();
        }
    });

    $(document).on('mouseup', '.taskbar-app', function (e) {
        if (e.button !== 1) {
            return;
        }

        e.preventDefault();

        const appId = $(this).attr('data-app-id');
        const app = AppsManager.getAppById(appId);
        if (!app || !AppsManager.isAppRunning(appId)) {
            return;
        }

        closeTaskViewPlaceholder();
        if (window.TaskbarHoverPreview && typeof window.TaskbarHoverPreview.hide === 'function') {
            window.TaskbarHoverPreview.hide({ immediate: true });
        }

        tryOpenNewTaskbarAppWindow(app);
    });

    // Initialize taskbar context menu
    initTaskbarContextMenu();
});

// Desktop context menu
function initDesktopContextMenu() {
    const $desktopContent = $('.desktop-content');
    const $desktop = $('#desktop');

    function isDesktopBlankAreaInteractionTarget(target) {
        if (!(target instanceof Element)) {
            return false;
        }

        if (!target.closest('#desktop')) {
            return false;
        }

        if (target.closest(
            '.classic-app-container, .modern-desktop-app-container, .desktop-item, .desktop-context-menu, ' +
            '#task-view-placeholder, #snap-assist-placeholder, .taskbar, .modern-flyout, .charms-bar, ' +
            '.charms-trigger, .classic-flyout, .context-menu, .classic-context-menu, #notification-center-panel, ' +
            '#search-panel, #quick-links-menu, #app-context-menu'
        )) {
            return false;
        }

        return true;
    }

    // Click on desktop to unfocus all windows
    $desktop.on('mousedown', function (e) {
        // Only unfocus if clicking directly on desktop (not on windows or other elements)
        if (e.target === this ||
            $(e.target).hasClass('desktop-content') ||
            e.target.id === 'desktop-wallpaper' ||
            e.target.id === 'desktop-window-layer') {
            clearClassicWindowFocusForShell('desktop');
        }
    });

    function maybeOpenTabletStartHomeFromDesktopInteraction(e) {
        if (!shouldUseTabletStartHomeSurface() || isStartSurfaceVisible() || taskViewPlaceholderOpen) {
            return;
        }

        if (!isDesktopBlankAreaInteractionTarget(e.target)) {
            return;
        }

        startSurfaceDesktopTapSuppressUntil = Date.now() + START_SURFACE_DESKTOP_TAP_CLICK_SUPPRESS_MS;
        e.preventDefault();
        e.stopPropagation();
        openStartSurface();
    }

    $desktop.on('pointerup', function (e) {
        if (e.pointerType === 'mouse' && e.button !== 0) {
            return;
        }

        maybeOpenTabletStartHomeFromDesktopInteraction.call(this, e);
    });

    $desktop.on('click', function (e) {
        maybeOpenTabletStartHomeFromDesktopInteraction.call(this, e);
    });

    $(document).on('pointerup.desktop-tablet-home', function (e) {
        if (e.pointerType === 'mouse' && e.button !== 0) {
            return;
        }

        if (!shouldUseTabletStartHomeSurface() || isStartSurfaceVisible() || taskViewPlaceholderOpen) {
            return;
        }

        if (!isDesktopBlankAreaInteractionTarget(e.target)) {
            return;
        }

        e.preventDefault();
        e.stopPropagation();
        openStartSurface();
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
            case 'sort-by-name':
                if (window.ExplorerEngine && typeof window.ExplorerEngine.setDesktopSort === 'function') {
                    window.ExplorerEngine.setDesktopSort('name');
                }
                break;
            case 'sort-by-size':
                if (window.ExplorerEngine && typeof window.ExplorerEngine.setDesktopSort === 'function') {
                    window.ExplorerEngine.setDesktopSort('size');
                }
                break;
            case 'sort-by-date-modified':
                if (window.ExplorerEngine && typeof window.ExplorerEngine.setDesktopSort === 'function') {
                    window.ExplorerEngine.setDesktopSort('date-modified');
                }
                break;
            case 'sort-by-type':
                if (window.ExplorerEngine && typeof window.ExplorerEngine.setDesktopSort === 'function') {
                    window.ExplorerEngine.setDesktopSort('type');
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
            sortBy: 'name',
            snapToGrid: true,
            arrangeIcons: false,
            showIcons: true
        };

    const iconSize = explorerSettings.iconSize || 'small';
    const sortBy = explorerSettings.sortBy || 'name';
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
        {
            action: 'sort-by',
            text: 'Sort by',
            submenu: [
                { action: 'sort-by-name', text: 'Name', type: 'radio', group: 'desktop-sort', checked: sortBy === 'name' },
                { action: 'sort-by-size', text: 'Size', type: 'radio', group: 'desktop-sort', checked: sortBy === 'size' },
                { action: 'sort-by-date-modified', text: 'Date Modified', type: 'radio', group: 'desktop-sort', checked: sortBy === 'date-modified' },
                { action: 'sort-by-type', text: 'Type', type: 'radio', group: 'desktop-sort', checked: sortBy === 'type' }
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
                { action: 'new-shortcut', text: 'Shortcut', disabled: true },
                { type: 'separator' },
                { action: 'new-text-document', icon: 'resources/images/icons/explorer/text_document/16.png', iconType: 'image', text: 'Text Document' }
            ]
        },
        { type: 'separator' },
        { action: 'screen-resolution', text: 'Screen resolution' },
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
            ? (item.checked ? 'sui-accept' : '')
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
                    ? (subItem.checked ? 'sui-accept' : '')
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
            $button.on('mouseenter focusin', function () {
                positionClassicContextSubmenu($(this));
            });

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

    positionContextMenuAtCursor($contextMenu, x, y, {
        displayValue: 'flex'
    });
}

function hideDesktopContextMenu() {
    $('.desktop-context-menu').remove();
    // Re-enable pointer events on all iframes and webviews
    $('.classic-window-iframe, .modern-app-iframe, webview').css('pointer-events', 'auto');
}

function initTaskbarContextMenu() {
    const $taskbar = $('.taskbar');

    $taskbar.on('mousedown', function (e) {
        if (e.target === this || $(e.target).hasClass('taskbar-apps')) {
            clearClassicWindowFocusForShell('taskbar');
        }
    });

    // Right-click on taskbar blank area
    $taskbar.on('contextmenu', function (e) {
        // Only show menu if clicking on the taskbar itself (not on buttons or other elements)
        if (e.target === this || $(e.target).hasClass('taskbar-apps')) {
            e.preventDefault();
            showTaskbarContextMenu(e.pageX, e.pageY, {
                showRestartExplorer: e.ctrlKey && e.shiftKey
            });
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

        if (!thresholdFeaturesEnabled && (
            action === 'toggle-task-view-button' ||
            action === 'toggle-search-button'
        )) {
            hideTaskbarContextMenu();
            return;
        }

        switch (action) {
            case 'task-manager': {
                console.log('Opening Task Manager...');
                const taskManagerApp = getAppForQuickLink(['task-manager', 'taskmgr'], ['Task Manager']);
                if (taskManagerApp) {
                    launchApp(taskManagerApp);
                } else {
                    console.warn('Taskbar context menu: Task Manager app not available.');
                }
                break;
            }
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
            case 'restart-explorer':
                restartExplorerShell().catch(error => {
                    console.error('[Shell Restart] Taskbar restart command failed:', error);
                });
                break;
        }

        // Hide menu after any action (including lock toggle)
        hideTaskbarContextMenu();
    });

    // Update the lock state display on load
    updateTaskbarContextMenuChecks();
}

function updateTaskbarContextMenuSpecialItems(options = {}) {
    const { showRestartExplorer = false } = options;
    const $restartExplorerItem = $('#taskbar-context-menu [data-action="restart-explorer"]');
    $restartExplorerItem.toggle(!!showRestartExplorer);
}

function showTaskbarContextMenu(x, y, options = {}) {
    // Close all taskbar popups and menus first
    closeAllTaskbarPopupsAndMenus();
    clearClassicWindowFocusForShell('taskbar-context-menu');

    // Close all other classic context menus
    closeAllClassicContextMenus();

    const $contextMenu = $('#taskbar-context-menu');

    // Update lock state display
    updateTaskbarContextMenuChecks();
    updateTaskbarContextMenuSpecialItems(options);

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
function closeAllTaskbarPopupsAndMenus(options = {}) {
    const {
        includeTaskView = true,
        excludeTaskbarHoverPreview = false,
        excludeTrayOverflow = false,
        excludeVolume = false
    } = options;

    if (includeTaskView) {
        closeTaskViewPlaceholder();
    }

    closeSnapAssist();

    if (!excludeTaskbarHoverPreview &&
        window.TaskbarHoverPreview &&
        typeof window.TaskbarHoverPreview.hide === 'function') {
        window.TaskbarHoverPreview.hide({ immediate: true });
    }

    if (!excludeTrayOverflow &&
        window.TrayOverflow &&
        typeof window.TrayOverflow.hide === 'function') {
        window.TrayOverflow.hide({ immediate: true });
    }

    hideNotificationCenterPanel();
    hideSearchPanel();

    // Close all registered classic flyouts (clock, battery, etc.)
    if (window.ClassicFlyoutManager) {
        window.ClassicFlyoutManager.hideAll();
    }

    // Close the volume flyout (managed separately from ClassicFlyoutManager)
    if (!excludeVolume && window.VolumeUI && typeof window.VolumeUI.hideFlyout === 'function') {
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

    // Close bluetooth icon context menu
    if (window.BluetoothTrayMenu) {
        window.BluetoothTrayMenu.hideContextMenu();
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

    $icon.html(checked ? '<span class="sui-accept"></span>' : '<span></span>');
    $icon.closest('.classic-context-menu-item').toggleClass('is-checked', checked);
}

function updateTaskbarContextMenuVisibility() {
    const $taskViewItem = $('#taskbar-context-menu [data-action="toggle-task-view-button"]');
    const $searchItem = $('#taskbar-context-menu [data-action="toggle-search-button"]');
    const $thresholdSeparator = $searchItem.next('.classic-context-menu-separator');
    const shouldShowThresholdItems = !!thresholdFeaturesEnabled;

    $taskViewItem.toggle(shouldShowThresholdItems);
    $searchItem.toggle(shouldShowThresholdItems);
    $thresholdSeparator.toggle(shouldShowThresholdItems);
}

function updateTaskbarContextMenuChecks() {
    setTaskbarContextMenuCheckState('.taskbar-lock-check', taskbarLocked);
    setTaskbarContextMenuCheckState('.taskbar-search-check', taskbarShowSearchButton);
    setTaskbarContextMenuCheckState('.taskbar-task-view-check', taskbarShowTaskViewButton);
    updateTaskbarContextMenuVisibility();
}

function updateTaskbarLockDisplay() {
    updateTaskbarContextMenuChecks();
}

function getDesktopWindowLayer() {
    const $windowLayer = $('#desktop-window-layer');
    return $windowLayer.length ? $windowLayer : $('#desktop');
}

function closeSnapAssist() {
    if (window.SnapAssistShell && typeof window.SnapAssistShell.close === 'function') {
        return window.SnapAssistShell.close();
    }

    return false;
}

function canOpenSnapAssist() {
    return Boolean(
        thresholdFeaturesEnabled &&
        currentView === 'desktop' &&
        $('#desktop').hasClass('visible')
    );
}

async function openSnapAssistForSnappedWindow(windowId, snapZone) {
    if (!windowId || !canOpenSnapAssist() || (snapZone !== 'left' && snapZone !== 'right')) {
        return false;
    }

    if (window.SnapAssistShell && typeof window.SnapAssistShell.open === 'function') {
        return window.SnapAssistShell.open({
            snappedWindowId: windowId,
            snappedSide: snapZone
        });
    }

    return false;
}

function updateTaskViewPlaceholderState() {
    const isOpen = Boolean(taskViewPlaceholderOpen);
    const $taskViewButton = $('.taskbar-task-view-button');
    const $taskViewPlaceholder = $('#task-view-placeholder');

    $('body').toggleClass('task-view-open', isOpen);
    $taskViewButton
        .toggleClass('is-active', isOpen)
        .attr('aria-pressed', isOpen ? 'true' : 'false');

    if ($taskViewPlaceholder.length) {
        $taskViewPlaceholder.attr('aria-hidden', isOpen ? 'false' : 'true');
    }

    updateTaskViewTouchGestureAvailability();
}

function canOpenTaskViewPlaceholder() {
    return Boolean(
        thresholdFeaturesEnabled &&
        taskbarShowTaskViewButton &&
        currentView === 'desktop' &&
        $('#desktop').hasClass('visible')
    );
}

async function openTaskViewPlaceholder() {
    if (taskViewPlaceholderOpen || !canOpenTaskViewPlaceholder()) {
        return false;
    }

    closeSnapAssist();
    clearClassicWindowFocusForShell('task-view');

    if (window.TaskViewShell && typeof window.TaskViewShell.prepareForOpen === 'function') {
        try {
            await window.TaskViewShell.prepareForOpen();
        } catch (error) {
            console.warn('[TaskView] Failed to prepare previews:', error);
        }
    }

    taskViewPlaceholderOpen = true;
    updateTaskViewPlaceholderState();

    if (window.TaskViewShell && typeof window.TaskViewShell.handleOpen === 'function') {
        window.TaskViewShell.handleOpen();
    }

    return true;
}

function closeTaskViewPlaceholder(options = {}) {
    const { reopenTabletHome = false } = options;

    if (!taskViewPlaceholderOpen) {
        return false;
    }

    taskViewPlaceholderOpen = false;
    updateTaskViewPlaceholderState();

    if (window.TaskViewShell && typeof window.TaskViewShell.handleClose === 'function') {
        window.TaskViewShell.handleClose();
    }

    if (reopenTabletHome &&
        shouldUseTabletStartHomeSurface() &&
        !isStartSurfaceVisible() &&
        currentView === 'desktop' &&
        $('#desktop').hasClass('visible')) {
        setTimeout(function () {
            if (!taskViewPlaceholderOpen &&
                shouldUseTabletStartHomeSurface() &&
                !isStartSurfaceVisible() &&
                currentView === 'desktop' &&
                $('#desktop').hasClass('visible')) {
                openStartSurface();
            }
        }, 0);
    }

    return true;
}

async function toggleTaskViewPlaceholder() {
    if (taskViewPlaceholderOpen) {
        closeTaskViewPlaceholder({ reopenTabletHome: true });
        return;
    }

    await openTaskViewPlaceholder();
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

    $('.taskbar-task-view-button').on('click', async function () {
        closeAllTaskbarPopupsAndMenus({ includeTaskView: false });
        closeAllClassicContextMenus();
        closeModernFlyout();
        hideCharmsBar();

        if (isStartSurfaceVisible()) {
            closeStartSurface({ forceDesktop: true, suppressRestore: true });
        }

        await toggleTaskViewPlaceholder();
    });

    $('.taskbar-search-button').on('click', function () {
        toggleSearchPanel();
    });

    $('.taskbar-continuum-back-button').on('click', function () {
        handleContinuumTaskbarBackAction();
    });

    $('#continuum-prompt-toggle-button').on('click', function () {
        openContinuumManualPrompt();
    });

    $(document).on('click.taskview-placeholder', '#task-view-placeholder', function (e) {
        // Close task view when clicking the background or empty grid area,
        // but not when clicking on window cards or desktop bar controls
        const target = e.target;
        const isBackground = target.id === 'task-view-placeholder' ||
            target.id === 'task-view-window-grid' ||
            target.classList.contains('task-view-window-grid__empty');
        if (!isBackground) return;

        e.preventDefault();
        e.stopPropagation();
        closeTaskViewPlaceholder({ reopenTabletHome: true });
    });

    $(document).on('keydown.taskview-placeholder', function (e) {
        if (e.key === 'Escape') {
            closeTaskViewPlaceholder({ reopenTabletHome: true });
        }
    });

    updateTaskbarShellButtonsVisibility();
    updateTaskbarShellButtonIcons();
    updateTaskbarContextMenuChecks();
    updateTaskViewPlaceholderState();

    $(window).on('resize.taskbar-shell-buttons', updateTaskbarShellButtonIcons);
    window.addEventListener('win8-display-settings-changed', updateTaskbarShellButtonIcons);
}

const TASK_VIEW_TOUCH_EDGE_ZONE = 32;
const TASK_VIEW_TOUCH_OPEN_THRESHOLD = 56;
const TASK_VIEW_TOUCH_VERTICAL_CANCEL_THRESHOLD = 72;
const taskViewTouchDrag = {
    active: false,
    startX: 0,
    startY: 0,
    revealWidth: 0
};

function deviceSupportsTouchInput() {
    if (typeof navigator !== 'undefined' && Number(navigator.maxTouchPoints) > 0) {
        return true;
    }

    return typeof window !== 'undefined' && 'ontouchstart' in window;
}

function isTaskViewTouchGestureAllowed() {
    return Boolean(
        deviceSupportsTouchInput() &&
        currentView === 'desktop' &&
        thresholdFeaturesEnabled &&
        taskbarShowTaskViewButton
    );
}

function updateTaskViewTouchGestureAvailability() {
    if (!document.body) {
        return false;
    }

    const enabled = isTaskViewTouchGestureAllowed() && !taskViewPlaceholderOpen;
    document.body.classList.toggle(TASK_VIEW_TOUCH_ENABLED_BODY_CLASS, enabled);
    return enabled;
}

function resetTaskViewTouchDragState() {
    taskViewTouchDrag.active = false;
    taskViewTouchDrag.startX = 0;
    taskViewTouchDrag.startY = 0;
    taskViewTouchDrag.revealWidth = 0;
}

function beginTaskViewTouchDrag(touch) {
    taskViewTouchDrag.active = true;
    taskViewTouchDrag.startX = touch.clientX;
    taskViewTouchDrag.startY = touch.clientY;
    taskViewTouchDrag.revealWidth = 0;
}

function updateTaskViewTouchDrag(touch) {
    const horizontalDistance = Math.max(0, touch.clientX - taskViewTouchDrag.startX);
    const verticalDistance = Math.abs(touch.clientY - taskViewTouchDrag.startY);

    if (verticalDistance > TASK_VIEW_TOUCH_VERTICAL_CANCEL_THRESHOLD &&
        horizontalDistance < TASK_VIEW_TOUCH_OPEN_THRESHOLD) {
        resetTaskViewTouchDragState();
        return false;
    }

    taskViewTouchDrag.revealWidth = horizontalDistance;
    return horizontalDistance > 0;
}

async function completeTaskViewTouchDrag() {
    if (!taskViewTouchDrag.active) {
        return false;
    }

    const shouldOpen = taskViewTouchDrag.revealWidth >= TASK_VIEW_TOUCH_OPEN_THRESHOLD;
    resetTaskViewTouchDragState();

    if (!shouldOpen || taskViewPlaceholderOpen) {
        return false;
    }

    closeAllTaskbarPopupsAndMenus({ includeTaskView: false });
    closeAllClassicContextMenus();
    closeModernFlyout();
    hideCharmsBar();

    if (isStartSurfaceVisible()) {
        closeStartSurface({ forceDesktop: true, suppressRestore: true });
    }

    await openTaskViewPlaceholder();
    return true;
}

$(document).ready(function () {
    $(document).on('touchstart.taskviewedge', function (e) {
        if (!isTaskViewTouchGestureAllowed() || taskViewPlaceholderOpen) {
            return;
        }

        const originalEvent = e.originalEvent;
        if (!originalEvent.touches || originalEvent.touches.length !== 1) {
            return;
        }

        if ($(e.target).closest('.taskbar, .modern-flyout, .charms-bar, #task-view-placeholder').length) {
            return;
        }

        const touch = originalEvent.touches[0];
        if (touch.clientX > TASK_VIEW_TOUCH_EDGE_ZONE) {
            return;
        }

        beginTaskViewTouchDrag(touch);
    });

    $(document).on('touchmove.taskviewedge', function (e) {
        if (!taskViewTouchDrag.active) {
            return;
        }

        const originalEvent = e.originalEvent;
        if (!originalEvent.touches || originalEvent.touches.length !== 1) {
            resetTaskViewTouchDragState();
            return;
        }

        const touch = originalEvent.touches[0];
        if (updateTaskViewTouchDrag(touch)) {
            e.preventDefault();
        }
    });

    $(document).on('touchend.taskviewedge touchcancel.taskviewedge', async function () {
        await completeTaskViewTouchDrag();
    });

    const desktopModernTaskViewEdgeTrigger = document.querySelector('.desktop-modern-task-view-edge-trigger');
    if (!desktopModernTaskViewEdgeTrigger) {
        updateTaskViewTouchGestureAvailability();
        return;
    }

    const handleDesktopModernTaskViewTouchStart = function (event) {
        if (!isTaskViewTouchGestureAllowed() || taskViewPlaceholderOpen || !event.touches || event.touches.length !== 1) {
            return;
        }

        beginTaskViewTouchDrag(event.touches[0]);
        event.preventDefault();
        event.stopPropagation();
    };

    const handleDesktopModernTaskViewTouchMove = function (event) {
        if (!taskViewTouchDrag.active || !event.touches || event.touches.length !== 1) {
            return;
        }

        if (updateTaskViewTouchDrag(event.touches[0])) {
            event.preventDefault();
            event.stopPropagation();
        }
    };

    const handleDesktopModernTaskViewTouchEnd = async function (event) {
        await completeTaskViewTouchDrag();
        if (event) {
            event.stopPropagation();
        }
    };

    desktopModernTaskViewEdgeTrigger.addEventListener('touchstart', handleDesktopModernTaskViewTouchStart, { passive: false });
    desktopModernTaskViewEdgeTrigger.addEventListener('touchmove', handleDesktopModernTaskViewTouchMove, { passive: false });
    desktopModernTaskViewEdgeTrigger.addEventListener('touchend', handleDesktopModernTaskViewTouchEnd, { passive: true });
    desktopModernTaskViewEdgeTrigger.addEventListener('touchcancel', handleDesktopModernTaskViewTouchEnd, { passive: true });

    updateTaskViewTouchGestureAvailability();
});

function applyFullscreenBodyState(isFullscreen) {
    document.body.classList.toggle('fullscreen', !!isFullscreen);
    updateSixPackFullscreenGlyph(!!isFullscreen);
}

function updateSixPackFullscreenGlyph(isFullscreen = isShellFullscreenActive()) {
    const glyph = document.querySelector('.six-pack-item[data-control="fullscreen"] .six-pack-glyph');
    if (!glyph) {
        return;
    }

    glyph.classList.toggle('sui-expand', !isFullscreen);
    glyph.classList.toggle('sui-contract', !!isFullscreen);
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

async function fetchChromeBetaSearchSuggestions(url) {
    if (!electronIpc || typeof electronIpc.invoke !== 'function' || typeof url !== 'string' || !url) {
        return null;
    }

    try {
        return await electronIpc.invoke('chrome-beta:fetch-search-suggestions', { url });
    } catch (_error) {
        return null;
    }
}

async function performChromeBetaDownloadAction(payload) {
    if (!electronIpc || typeof electronIpc.invoke !== 'function' || !payload || typeof payload !== 'object') {
        return { success: false, error: 'Download bridge is unavailable.' };
    }

    try {
        return await electronIpc.invoke('chrome-beta:download-action', payload);
    } catch (error) {
        return {
            success: false,
            error: error?.message || 'Download action failed.'
        };
    }
}

const chromeBetaDownloadWindowTargets = new Map();

if (electronIpc && typeof electronIpc.on === 'function') {
    electronIpc.on('fullscreen-state-changed', (_event, state) => {
        applyFullscreenBodyState(Boolean(state));
    });
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            updateSixPackFullscreenGlyph(isShellFullscreenActive());
        }, { once: true });
    } else {
        updateSixPackFullscreenGlyph(isShellFullscreenActive());
    }
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
    closeTaskViewPlaceholder();
    clearClassicWindowFocusForShell('start-surface');

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
    closeTaskViewPlaceholder();

    if (isStartSurfaceVisible()) {
        closeStartSurface();
    } else {
        openStartSurface();
    }
}

function dismissContinuumStartSurfaceForAppActivation(targetView = 'desktop') {
    if (!isContinuumTabletShellMode() || !isStartSurfaceVisible()) {
        return false;
    }

    clearPendingContinuumStartSurfaceAutoOpen();

    if (isStartMenuEnabled()) {
        closeStartSurface({ forceDesktop: true, suppressRestore: true });
        return true;
    }

    if (targetView === 'modern' && currentView === 'start') {
        const $startScreen = views.start;
        if ($startScreen?.length) {
            $startScreen.removeClass('visible show-content show-content-from-desktop fade-background slide-in opening-from-desktop');
        }

        setCurrentView('desktop');
        $('body').removeClass('view-start').addClass('view-desktop');
        $('body').addClass('charms-allowed');
        updateTaskbarVisibility('desktop');
        return true;
    }

    if (currentView === 'start') {
        transitionToDesktop();
        return true;
    }

    closeStartSurface({ forceDesktop: true, suppressRestore: true });
    return true;
}

function getActiveModernRunningApp() {
    if (typeof AppsManager === 'undefined' || typeof AppsManager.getRunningApps !== 'function') {
        return null;
    }

    return AppsManager.getRunningApps().find(runningApp =>
        isModernAppWindowData(runningApp) && runningApp.state === 'active'
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
    // (skip if caller is already managing popup state, e.g. openModernFlyout)
    if (!options.skipClosePopups) {
        closeAllPopupsAndMenus();
    }
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

function updateTaskbarClock(snapshot) {
    const $clockEl = $('.clock');
    if ($clockEl.length) {
        const now = snapshot && snapshot.now instanceof Date ? snapshot.now : new Date();
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

        // When taskbar is taller than default (40px), show day of week like Windows 8,
        // except in Continuum tablet mode where the clock should stay two-line.
        if (getEffectiveTaskbarHeight() > 40 && !isContinuumTabletShellMode()) {
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

// Track if the remapped Win key (F24) is currently held down
let winKeyHeld = false;

// Helper: check if a key event is the Windows key (native Meta or remapped F24)
const isWinKey = (e) => e.key === 'Meta' || e.key === 'F24';

// Helper: check if the Windows modifier is active (native metaKey or F24 held)
const hasWinModifier = (e) => e.metaKey || winKeyHeld;

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
    // Check if we should gate shortcuts (but not the Win key alone)
    const shouldGateShortcuts = isInputFocused() && !isWinKey(e);

    // Disable shortcuts when system is locked or logged out
    const isSystemLocked = currentView === 'lock' || currentView === 'login' || currentView === 'boot';

    // Win+Arrow - window snapping shortcuts
    if (hasWinModifier(e) &&
        ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) &&
        !e.shiftKey &&
        !e.ctrlKey &&
        !e.altKey) {
        e.preventDefault();
        metaKeyPressedAlone = false; // Prevent Start screen toggle

        if (!isSystemLocked &&
            window.SnapShortcutShell &&
            typeof window.SnapShortcutShell.handleKeydown === 'function') {
            window.SnapShortcutShell.handleKeydown(e);
        }
        return;
    }

    // Win+C - Show Charms bar
    if (hasWinModifier(e) && e.key === 'c' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
        if (!shouldGateShortcuts && !isSystemLocked) {
            e.preventDefault();
            metaKeyPressedAlone = false; // Prevent Start screen toggle

            const $charmsBar = $('.charms-bar');
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

            // Show charms bar with full background and TDBN panel
            // Add keyboard-triggered class for slide-in animation
            $charmsBar.removeClass('hiding stagger-from-top stagger-from-bottom stagger-from-center');
            void $charmsBar[0].offsetWidth;
            $charmsBar.addClass('stagger-from-center visible show-background keyboard-triggered');
            console.log('Win+C: showing charms bar');

            // Remove keyboard-triggered class after animation completes
            setTimeout(function () {
                $charmsBar.removeClass('keyboard-triggered');
            }, 250);
        }
        return;
    }

    // Win+I - Open Settings modern flyout
    if (hasWinModifier(e) && e.key === 'i' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
        if (!shouldGateShortcuts && !isSystemLocked) {
            e.preventDefault();
            metaKeyPressedAlone = false; // Prevent Start screen toggle
            openModernFlyout('settings', { source: 'charms' });
        }
        return;
    }

    // Win+R - Open Run dialog
    if (hasWinModifier(e) && (e.key === 'r' || e.key === 'R') && !e.shiftKey && !e.ctrlKey && !e.altKey) {
        if (!isSystemLocked) {
            e.preventDefault();
            metaKeyPressedAlone = false; // Prevent Start screen toggle
            launchApp('run');
        }
        return;
    }

    // Win+E - Open File Explorer
    if (hasWinModifier(e) && (e.key === 'e' || e.key === 'E') && !e.shiftKey && !e.ctrlKey && !e.altKey) {
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
    if (hasWinModifier(e) && e.key === 'l' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
        if (!shouldGateShortcuts && !isSystemLocked) {
            e.preventDefault();
            metaKeyPressedAlone = false; // Prevent Start screen toggle
            lockSystem();
            console.log('Win+L: locking system');
        }
        return;
    }

    // Win+X - Show Quick Links menu
    if (hasWinModifier(e) && e.key === 'x' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
        if (!shouldGateShortcuts && !isSystemLocked) {
            e.preventDefault();
            metaKeyPressedAlone = false; // Prevent Start screen toggle
            showQuickLinksMenu();
            console.log('Win+X: showing Quick Links menu');
        }
        return;
    }

    // Track if Win key is pressed alone (no other keys)
    if (isWinKey(e) && !e.shiftKey && !e.ctrlKey && !e.altKey) {
        metaKeyPressedAlone = true;
        if (e.key === 'F24') winKeyHeld = true;
    } else if (hasWinModifier(e)) {
        // If any other key is pressed with Win, it's not alone
        metaKeyPressedAlone = false;
    }
});

$(document).on('keyup', function (e) {
    // Windows key (Meta/F24) - toggle Start screen on release
    // This one always works, even with input focused (matching Windows behavior)
    if (isWinKey(e)) {
        if (e.key === 'F24') winKeyHeld = false;

        if (metaKeyPressedAlone) {
            // Only allow on desktop or start screen, not when locked/logged out
            const isSystemLocked = currentView === 'lock' || currentView === 'login' || currentView === 'boot';

            if (!isSystemLocked) {
                e.preventDefault();
                toggleStartSurface();
            }
            metaKeyPressedAlone = false;
        }
    }
});

// IPC fallback for globalShortcut-forwarded Win+key combos (when AHK is not running)
if (electronIpc) {
    electronIpc.on('win-shortcut', (_event, key) => {
        const isSystemLocked = currentView === 'lock' || currentView === 'login' || currentView === 'boot';
        if (isSystemLocked) return;

        switch (key) {
            case 'c': showCharmsBarFully({ keyboardTriggered: true }); break;
            case 'i': openModernFlyout('settings', { source: 'charms' }); break;
            case 'r': launchApp('run'); break;
            case 'e':
                if (isStartSurfaceVisible()) {
                    closeStartSurface({ forceDesktop: true, suppressRestore: true });
                    setTimeout(() => launchApp('explorer'), 500);
                } else {
                    launchApp('explorer');
                }
                break;
            case 'l': lockSystem(); break;
            case 'x': showQuickLinksMenu(); break;
            case 'ArrowLeft':
            case 'ArrowRight':
            case 'ArrowUp':
            case 'ArrowDown':
                if (window.SnapShortcutShell &&
                    typeof window.SnapShortcutShell.handleShortcutKey === 'function') {
                    window.SnapShortcutShell.handleShortcutKey(key);
                }
                break;
        }
    });

    electronIpc.on('chrome-beta:open-url-in-tab', (_event, payload = {}) => {
        if (!payload || typeof payload.url !== 'string' || !payload.url) {
            return;
        }

        let targetWindowData = null;
        if (activeClassicWindow) {
            const activeWindowData = getRunningWindowData(activeClassicWindow);
            if (activeWindowData?.app?.id === 'chrome-beta') {
                targetWindowData = activeWindowData;
            }
        }

        if (!targetWindowData) {
            targetWindowData = getRunningWindowData('chrome-beta');
        }

        if (!targetWindowData?.windowId) {
            return;
        }

        sendClassicWindowCommand(targetWindowData.$container, {
            action: 'chromeBetaOpenUrlInTab',
            appId: 'chrome-beta',
            windowId: targetWindowData.windowId,
            url: payload.url,
            disposition: payload.disposition || 'new-window'
        });
    });

    electronIpc.on('chrome-beta:webview-context-menu', (_event, payload = {}) => {
        const chromeWindows = AppsManager.getAppWindows('chrome-beta') || [];
        if (!chromeWindows.length) {
            return;
        }

        chromeWindows.forEach((windowData) => {
            if (!windowData?.windowId || !windowData.$container?.length) {
                return;
            }

            sendClassicWindowCommand(windowData.$container, {
                action: 'chromeBetaShowWebviewContextMenu',
                appId: 'chrome-beta',
                windowId: windowData.windowId,
                contextMenuParams: payload
            });
        });
    });

    electronIpc.on('chrome-beta:download-event', (_event, payload = {}) => {
        const downloadId = typeof payload.downloadId === 'string' ? payload.downloadId : '';
        if (!downloadId) {
            return;
        }
        const chromeWindows = AppsManager.getAppWindows('chrome-beta') || [];
        if (!chromeWindows.length) {
            return;
        }

        let preferredWindowId = chromeBetaDownloadWindowTargets.get(downloadId) || null;
        if (!preferredWindowId && activeClassicWindow) {
            const activeWindowData = getRunningWindowData(activeClassicWindow);
            if (activeWindowData?.app?.id === 'chrome-beta') {
                preferredWindowId = activeWindowData.windowId;
            }
        }

        if (preferredWindowId) {
            chromeBetaDownloadWindowTargets.set(downloadId, preferredWindowId);
        }

        window.dispatchEvent(new CustomEvent('chrome-beta-download-event', {
            detail: {
                preferredWindowId,
                downloadEvent: payload
            }
        }));

        chromeWindows.forEach((windowData) => {
            if (!windowData?.windowId || !windowData.$container?.length) {
                return;
            }

            const chromeInstance = windowData.$container[0]?.__chromeClassicAppInstance
                || windowData.$container.find('.direct-loaded-content')[0]?.__chromeClassicAppInstance
                || null;
            if (chromeInstance && typeof chromeInstance.processDownloadEventPayload === 'function') {
                try {
                    chromeInstance.processDownloadEventPayload(payload);
                } catch (error) {
                    console.warn('Chrome Beta download instance dispatch failed:', error);
                }
            }

            sendClassicWindowCommand(windowData.$container, {
                action: 'chromeBetaDownloadEvent',
                appId: 'chrome-beta',
                windowId: windowData.windowId,
                preferredWindowId,
                downloadEvent: payload
            });
        });
    });

    electronIpc.on('chrome-beta:navigate-history', (_event, payload = {}) => {
        const command = payload?.command;
        if (command !== 'browser-backward' && command !== 'browser-forward') {
            return;
        }

        let targetWindowData = null;
        if (activeClassicWindow) {
            const activeWindowData = getRunningWindowData(activeClassicWindow);
            if (activeWindowData?.app?.id === 'chrome-beta') {
                targetWindowData = activeWindowData;
            }
        }

        if (!targetWindowData) {
            targetWindowData = getRunningWindowData('chrome-beta');
        }

        if (!targetWindowData?.windowId) {
            return;
        }

        sendClassicWindowCommand(targetWindowData.$container, {
            action: 'chromeBetaNavigateHistory',
            appId: 'chrome-beta',
            windowId: targetWindowData.windowId,
            command
        });
    });
}

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

    $(document).on('mouseenter focusin', '#app-context-menu .context-menu-item-submenu', function () {
        positionModernContextSubmenu($(this));
    });

    // Context menu item clicks
    $(document).on('click', '#app-context-menu .context-menu-item', function (e) {
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
        } else if (action === 'toggle-start-list') {
            const isInStartList = startMenuState.pinnedIds.includes(contextMenuAppId);
            if (isInStartList) {
                startMenuState.pinnedIds = startMenuState.pinnedIds.filter(id => id !== contextMenuAppId);
            } else {
                startMenuState.pinnedIds = [contextMenuAppId, ...startMenuState.pinnedIds];
            }
            saveStartMenuState();
            renderStartMenuLeftPane();
            hideContextMenu();
        } else if (action === 'keep-in-list') {
            startMenuState.pinnedIds = [
                contextMenuAppId,
                ...startMenuState.pinnedIds.filter(id => id !== contextMenuAppId)
            ];
            saveStartMenuState();
            renderStartMenuLeftPane();
            hideContextMenu();
        } else if (action === 'remove-from-list') {
            startMenuState.pinnedIds = startMenuState.pinnedIds.filter(id => id !== contextMenuAppId);
            saveStartMenuState();
            renderStartMenuLeftPane();
            hideContextMenu();
        }
    });

    // Hide context menu on click outside
    $(document).on('click', function (e) {
        // Don't hide if clicking inside the context menu
        if (!$(e.target).closest('.context-menu').length) {
            hideContextMenu();
        }
    });
}

let contextMenuSource = 'start-screen';

function showContextMenu(x, y, appId, sourceElement = null, listMode = null) {
    const $contextMenu = $('#app-context-menu');
    const app = AppsManager.getAppById(appId);
    const $source = sourceElement ? $(sourceElement) : $();

    if (!app) return;

    contextMenuAppId = appId;
    contextMenuListMode = listMode;
    contextMenuSource = $source.closest('#start-menu').length
        ? ($source.closest('#start-menu-tiles').length ? 'start-menu-tile' : 'start-menu-app-list')
        : 'start-screen';

    // Update pin/unpin text
    $contextMenu.find('[data-action="pin"] .context-menu-item-text')
        .text(app.pinned ? 'Unpin from Start' : 'Pin to Start');

    // Add to / Remove from Start List — hidden for 'pinned'/'recent' modes (those have their own list items)
    const isInStartList = startMenuState.pinnedIds.includes(appId);
    const showStartListToggle = listMode !== 'pinned' && listMode !== 'recent';
    $contextMenu.find('[data-action="toggle-start-list"]').toggle(showStartListToggle);
    $contextMenu.find('[data-action="toggle-start-list"] .context-menu-item-text')
        .text(isInStartList ? 'Unpin from Start List' : 'Pin to Start List');

    const shouldShowTaskbarPin =
        app.type !== 'meta' && app.type !== 'meta-classic';
    const $taskbarPinItem = $contextMenu.find('[data-action="pin-taskbar"]');
    $taskbarPinItem.toggle(shouldShowTaskbarPin);
    $taskbarPinItem.find('.context-menu-item-text')
        .text(app.pinnedToTaskbar ? 'Unpin from Taskbar' : 'Pin to Taskbar');

    // Resize — only shown for tiles, not list entries
    const isListEntry = listMode !== null || contextMenuSource === 'start-menu-app-list';
    const shouldShowResize = !isListEntry;
    $contextMenu.find('[data-role="resize-separator"]').toggle(shouldShowResize);
    $contextMenu.find('[data-action="resize"]').toggle(shouldShowResize);

    if (shouldShowResize) {
        // Update resize checkmarks
        $contextMenu.find('.context-submenu .context-menu-item').removeClass('checked');
        $contextMenu.find(`.context-submenu [data-size="${app.size || 'normal'}"]`).addClass('checked');

        const tileOptions = app.tileOptions || {};
        $contextMenu.find('[data-size="wide"]').toggle(tileOptions.allowWide || false);
        $contextMenu.find('[data-size="large"]').toggle(tileOptions.allowLarge || false);
    }

    // List management — shown only for Start List entries
    const showKeepInList = listMode === 'recent';
    const showRemoveFromList = listMode === 'pinned';
    $contextMenu.find('[data-role="list-separator"]').toggle(showKeepInList || showRemoveFromList);
    $contextMenu.find('[data-action="keep-in-list"]').toggle(showKeepInList);
    $contextMenu.find('[data-action="remove-from-list"]').toggle(showRemoveFromList);

    positionStartSurfaceContextMenu($contextMenu, x, y);
    $contextMenu.addClass('active');
}

function hideContextMenu() {
    $('#app-context-menu').removeClass('active');
    contextMenuAppId = null;
    contextMenuListMode = null;
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
        $('.system-icon, .clock, .tray-overflow-toggle').removeClass('active');
    }

    // Close user tile dropdown
    $('.user-tile-dropdown').removeClass('active');

    // Close power menus
    $('.start-power-menu').removeClass('active');
    $('.settings-power-menu').removeClass('active');
    $('.six-pack-item[data-control="power"]').removeClass('active');
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
    const $desktopModernCharmsEdgeTrigger = $('.desktop-modern-charms-edge-trigger');
    const CHARMS_MOUSE_EDGE_THRESHOLD = 2;
    const CHARMS_MOUSE_CORNER_HEIGHT = 14;
    const CHARMS_TOUCH_EDGE_ZONE = 32;
    const CHARMS_TOUCH_REVEAL_ACTIVATION_THRESHOLD = 6;
    const CHARMS_TOUCH_OPEN_THRESHOLD = 56;
    const CHARMS_TOUCH_VERTICAL_CANCEL_THRESHOLD = 72;
    let charmsTimeout = null;
    let charmsInactivityTimeout = null;
    let suppressNextCharmsDocumentClick = false;
    let suppressCharmsIconClickUntil = 0;
    let charmsTouchInteractionCooldownTimeout = null;
    const charmsTouchDrag = {
        active: false,
        startX: 0,
        startY: 0,
        currentX: 0,
        revealWidth: 0
    };

    // Function to check if charms bar should be accessible
    function isCharmsBarAllowed() {
        return currentView === 'desktop' || currentView === 'start' || currentView === 'modern';
    }

    function clearCharmsTimers() {
        clearTimeout(charmsTimeout);
        clearTimeout(charmsInactivityTimeout);
    }

    function clearCharmsTouchInteractionCooldown() {
        clearTimeout(charmsTouchInteractionCooldownTimeout);
        charmsTouchInteractionCooldownTimeout = null;
        $charmsBar.removeClass('touch-open-cooldown');
    }

    function startCharmsTouchInteractionCooldown(durationMs) {
        clearCharmsTouchInteractionCooldown();
        $charmsBar.addClass('touch-open-cooldown');
        charmsTouchInteractionCooldownTimeout = setTimeout(function () {
            $charmsBar.removeClass('touch-open-cooldown');
            charmsTouchInteractionCooldownTimeout = null;
        }, durationMs);
    }

    function getCharmsBarWidth() {
        return $charmsBar.outerWidth() || parseFloat($charmsBar.css('width')) || 86;
    }

    function clearCharmsTouchDragStyles() {
        $charmsBar.removeClass('touch-dragging').css({
            '--charms-touch-offset': '',
            '--charms-stagger-tier1': '',
            '--charms-stagger-tier2': ''
        });
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
        const touchOpened = Boolean(options.touchOpened);

        if (!isCharmsBarAllowed()) return;

        clearCharmsTimers();
        clearCharmsTouchDragStyles();
        closeTransientUiForCharms();

        $charmsBar.removeClass('hiding').addClass('visible show-background');
        if (touchOpened) {
            startCharmsTouchInteractionCooldown(600);
        } else {
            clearCharmsTouchInteractionCooldown();
        }
        if (keyboardTriggered) {
            $charmsBar.addClass('keyboard-triggered');
            setTimeout(function () {
                $charmsBar.removeClass('keyboard-triggered');
            }, 250);
        } else {
            $charmsBar.removeClass('keyboard-triggered');
        }

        updateTabletStartHomeShellState();
    }

    function setTouchDragReveal(revealWidth) {
        const barWidth = getCharmsBarWidth();
        const clampedRevealWidth = Math.max(0, Math.min(revealWidth, barWidth));
        const touchOffset = Math.max(0, barWidth - clampedRevealWidth);

        // Stagger: outer charms lag behind center, tapering to 0 as bar fully reveals
        const progress = barWidth > 0 ? clampedRevealWidth / barWidth : 0;
        const remaining = 1 - progress;
        const tier1 = remaining * 15; // Share, Devices
        const tier2 = remaining * 30; // Search, Settings

        $charmsBar
            .removeClass('hiding show-background keyboard-triggered')
            .addClass('visible touch-dragging')
            .css({
                '--charms-touch-offset': `${touchOffset}px`,
                '--charms-stagger-tier1': `${tier1}px`,
                '--charms-stagger-tier2': `${tier2}px`
            });
        charmsTouchDrag.revealWidth = clampedRevealWidth;
    }

    function isMouseInCharmsHotCorner(event, edge) {
        if (!event) {
            return false;
        }

        const nearRightEdge = event.clientX >= window.innerWidth - CHARMS_MOUSE_EDGE_THRESHOLD;
        if (!nearRightEdge) {
            return false;
        }

        return edge === 'bottom'
            ? event.clientY >= window.innerHeight - CHARMS_MOUSE_CORNER_HEIGHT
            : event.clientY <= CHARMS_MOUSE_CORNER_HEIGHT;
    }

    function isCharmsMouseTriggerSuspended($trigger) {
        if (document.body.classList.contains(CHARMS_MOUSE_TRIGGERS_SUSPENDED_BODY_CLASS)) {
            return true;
        }

        return $trigger.hasClass('top') &&
            document.body.classList.contains(CHARMS_TITLEBAR_GESTURE_GUARD_BODY_CLASS);
    }

    function scheduleCharmsGhostHideAfterInactivity() {
        clearTimeout(charmsInactivityTimeout);
        charmsInactivityTimeout = setTimeout(function () {
            if (!$charmsBar.hasClass('show-background')) {
                $charmsBar.addClass('hiding');
                setTimeout(function () {
                    $charmsBar.removeClass('visible hiding stagger-from-top stagger-from-bottom stagger-from-center');
                }, 250);
                console.log('Inactivity timeout: hiding ghost view');
            }
        }, 4000);
    }

    function showCharmsGhostFromTrigger($trigger) {
        const staggerClass = $trigger.hasClass('bottom') ? 'stagger-from-bottom' : 'stagger-from-top';

        clearCharmsTimers();
        $charmsBar.removeClass('hiding stagger-from-top stagger-from-bottom stagger-from-center');
        void $charmsBar[0].offsetWidth;
        $charmsBar.addClass(staggerClass + ' visible');
        console.log('Trigger hover: showing charms bar');
        scheduleCharmsGhostHideAfterInactivity();
    }

    // Keep the TDBN panel in sync with the current time snapshot.
    function updateTdbnPanel(snapshot) {
        const now = snapshot && snapshot.now instanceof Date ? snapshot.now : new Date();

        // Update time (without AM/PM)
        let timeString = now.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
        timeString = timeString.replace(/\s?(AM|PM)/i, '');
        $('.tdbn-time').text(timeString);

        // Update weekday
        const weekday = now.toLocaleDateString('en-US', {
            weekday: 'long'
        });
        $('.tdbn-date-weekday').text(weekday);

        // Update month and day
        const monthDay = now.toLocaleDateString('en-US', {
            month: 'long',
            day: 'numeric'
        });
        $('.tdbn-date-monthday').text(monthDay);
    }

    if (window.TimeBank && typeof window.TimeBank.subscribe === 'function') {
        window.TimeBank.subscribe(updateTdbnPanel, { immediate: true });
    } else {
        updateTdbnPanel();
        setInterval(updateTdbnPanel, 1000);
    }

    // Show charms bar without background when hovering over trigger areas
    $charmsTriggers.on('mouseenter', function (event) {
        if (!isCharmsBarAllowed() || !navigationSettings.charmsHotCornersEnabled) return;
        const $trigger = $(this);
        const edge = $trigger.hasClass('bottom') ? 'bottom' : 'top';
        if (isCharmsMouseTriggerSuspended($trigger) || !isMouseInCharmsHotCorner(event, edge)) return;

        showCharmsGhostFromTrigger($trigger);
    });

    // Reset inactivity timer on mouse movement over trigger
    $charmsTriggers.on('mousemove', function (event) {
        if (!isCharmsBarAllowed() || !navigationSettings.charmsHotCornersEnabled) return;
        const $trigger = $(this);
        const edge = $trigger.hasClass('bottom') ? 'bottom' : 'top';
        if (isCharmsMouseTriggerSuspended($trigger)) return;

        clearTimeout(charmsInactivityTimeout);

        if (isMouseInCharmsHotCorner(event, edge)) {
            if (!$charmsBar.hasClass('visible') || $charmsBar.hasClass('hiding')) {
                showCharmsGhostFromTrigger($trigger);
                return;
            }

            if (!$charmsBar.hasClass('show-background')) {
                scheduleCharmsGhostHideAfterInactivity();
            }
            return;
        }

        if ($charmsBar.hasClass('visible') && !$charmsBar.hasClass('show-background')) {
            scheduleCharmsGhostHideAfterInactivity();
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
                    $charmsBar.removeClass('visible show-background hiding stagger-from-top stagger-from-bottom stagger-from-center');
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

    document.addEventListener('mousemove', handleCharmsPointerMouseActivity, { passive: true });

    if (typeof window.PointerEvent === 'function') {
        document.addEventListener('pointerdown', function (event) {
            if (event.pointerType !== 'mouse') {
                handleCharmsNonMouseInputActivity();
            }
        }, { passive: true });
    } else {
        document.addEventListener('touchstart', handleCharmsNonMouseInputActivity, { passive: true });
    }

    scheduleCharmsTriggerAvailabilityUpdate();

    const handleCharmsTouchStart = function (event) {
        handleCharmsNonMouseInputActivity();
        if (!isCharmsBarAllowed() || !navigationSettings.charmsHotCornersEnabled) return;
        if (!event.touches || event.touches.length !== 1) return;

        const touch = event.touches[0];
        if (touch.clientX < window.innerWidth - CHARMS_TOUCH_EDGE_ZONE) return;

        clearCharmsTimers();
        charmsTouchDrag.active = true;
        charmsTouchDrag.startX = touch.clientX;
        charmsTouchDrag.startY = touch.clientY;
        charmsTouchDrag.currentX = touch.clientX;
        charmsTouchDrag.revealWidth = 0;
    };

    const handleCharmsTouchMove = function (event) {
        if (!charmsTouchDrag.active) return;
        if (!event.touches || event.touches.length !== 1) {
            resetCharmsTouchDragState();
            hideCharmsBar();
            return;
        }

        const touch = event.touches[0];
        const dragDistance = Math.max(0, window.innerWidth - touch.clientX);
        const verticalDistance = Math.abs(touch.clientY - charmsTouchDrag.startY);

        charmsTouchDrag.currentX = touch.clientX;

        if (verticalDistance > CHARMS_TOUCH_VERTICAL_CANCEL_THRESHOLD && dragDistance < CHARMS_TOUCH_OPEN_THRESHOLD) {
            resetCharmsTouchDragState();
            hideCharmsBar();
            return;
        }

        if (dragDistance < CHARMS_TOUCH_REVEAL_ACTIVATION_THRESHOLD) {
            charmsTouchDrag.revealWidth = 0;
            $charmsBar.removeClass('visible show-background hiding stagger-from-top stagger-from-bottom stagger-from-center');
            clearCharmsTouchDragStyles();
            return;
        }

        setTouchDragReveal(dragDistance);
        event.preventDefault();
    };

    const handleCharmsTouchEnd = function () {
        if (!charmsTouchDrag.active) return;

        const shouldOpenFully = charmsTouchDrag.revealWidth >= CHARMS_TOUCH_OPEN_THRESHOLD;
        resetCharmsTouchDragState();

        suppressNextCharmsDocumentClick = true;
        setTimeout(function () {
            suppressNextCharmsDocumentClick = false;
        }, 400);

        if (shouldOpenFully) {
            suppressCharmsIconClickUntil = Date.now() + 600;
            showCharmsBarFully({ touchOpened: true });
            console.log('Touch edge drag: showing charms bar');
            return;
        }

        hideCharmsBar();
        console.log('Touch edge drag: hiding charms bar');
    };

    document.addEventListener('touchstart', handleCharmsTouchStart, { passive: false });
    document.addEventListener('touchmove', handleCharmsTouchMove, { passive: false });
    document.addEventListener('touchend', handleCharmsTouchEnd, { passive: true });
    document.addEventListener('touchcancel', handleCharmsTouchEnd, { passive: true });

    // Click outside charms bar to close immediately (no delay)
    document.addEventListener('click', function (event) {
        if (Date.now() >= suppressCharmsIconClickUntil) {
            return;
        }

        const isCharmsSurfaceTarget = $(event.target).closest('.charms-bar, .desktop-modern-charms-edge-trigger').length > 0;
        const nearRightEdge = typeof event.clientX === 'number' && event.clientX >= window.innerWidth - CHARMS_TOUCH_EDGE_ZONE;
        if (!isCharmsSurfaceTarget && !nearRightEdge) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') {
            event.stopImmediatePropagation();
        }
    }, true);

    $(document).on('click', function (e) {
        if (suppressNextCharmsDocumentClick) {
            return;
        }

        if (isCharmsBarAllowed() && $charmsBar.hasClass('visible')) {
            // Check if click is outside charms bar, triggers, TDBN panel, and modern flyouts
            if (!$(e.target).closest('.charms-bar, .charms-trigger, .tdbn-panel, .modern-flyout').length) {
                clearCharmsTimers();
                hideCharmsBar();
                console.log('Click outside: hiding charms bar immediately');
            }
        }
    });

    // Charms icon click handlers
    $('.charms-icon[data-charm="search"]').on('click', function () {
        if (Date.now() < suppressCharmsIconClickUntil) return;
        console.log('Search charm clicked');
        openModernFlyout('search');
    });

    $('.charms-icon[data-charm="share"]').on('click', function () {
        if (Date.now() < suppressCharmsIconClickUntil) return;
        console.log('Share charm clicked');
        openModernFlyout('share');
    });

    $('.charms-icon[data-charm="start"]').on('click', function () {
        if (Date.now() < suppressCharmsIconClickUntil) return;
        console.log('Start charm clicked');
        toggleStartSurface();
        hideCharmsBar();
    });

    $('.charms-icon[data-charm="devices"]').on('click', function () {
        if (Date.now() < suppressCharmsIconClickUntil) return;
        console.log('Devices charm clicked');
        openModernFlyout('devices');
    });

    $('.charms-icon[data-charm="settings"]').on('click', function () {
        if (Date.now() < suppressCharmsIconClickUntil) return;
        console.log('Settings charm clicked');
        openModernFlyout('settings', { source: 'charms' });
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
let activeModernFlyoutIntent = null;
let lastSettingsCharmAppContext = null;

function rememberSettingsCharmAppContext(windowDataOrAppId) {
    const windowData = typeof windowDataOrAppId === 'string'
        ? getRunningWindowData(windowDataOrAppId)
        : windowDataOrAppId;

    if (!isModernAppWindowData(windowData) || !windowData?.app?.id) {
        return false;
    }

    lastSettingsCharmAppContext = {
        appId: windowData.app.id,
        appName: windowData.app.name || windowData.app.id,
        windowId: windowData.windowId || null
    };

    return true;
}

function captureSettingsCharmAppContext() {
    const activeModernApp = getActiveModernRunningApp();
    if (rememberSettingsCharmAppContext(activeModernApp)) {
        return true;
    }

    if (activeClassicWindow) {
        const activeWindowData = getRunningWindowData(activeClassicWindow);
        if (rememberSettingsCharmAppContext(activeWindowData)) {
            return true;
        }
    }

    lastSettingsCharmAppContext = null;
    return false;
}

function getRememberedSettingsCharmAppContext() {
    if (!lastSettingsCharmAppContext) {
        return null;
    }

    let windowData = null;
    if (lastSettingsCharmAppContext.windowId &&
        typeof AppsManager !== 'undefined' &&
        typeof AppsManager.getRunningWindow === 'function') {
        windowData = AppsManager.getRunningWindow(lastSettingsCharmAppContext.windowId);
    }

    if (!windowData && lastSettingsCharmAppContext.appId) {
        windowData = getRunningWindowData(lastSettingsCharmAppContext.appId);
    }

    if (!isModernAppWindowData(windowData) || !windowData?.app?.id) {
        lastSettingsCharmAppContext = null;
        return null;
    }

    const $container = windowData.$container;
    const isVisible = !!($container?.length &&
        !$container.data('backgroundPreload') &&
        $container.is(':visible') &&
        !$container.hasClass('minimizing') &&
        !$container.hasClass('closing'));

    if (windowData.state === 'minimized' || !isVisible) {
        return null;
    }

    lastSettingsCharmAppContext = {
        appId: windowData.app.id,
        appName: windowData.app.name || windowData.app.id,
        windowId: windowData.windowId || null
    };

    return { ...lastSettingsCharmAppContext };
}

function setModernFlyoutIntent(flyoutName, intent = {}) {
    activeModernFlyoutIntent = {
        flyoutName,
        source: typeof intent.source === 'string' && intent.source ? intent.source : 'shell',
        windowId: typeof intent.windowId === 'string' && intent.windowId ? intent.windowId : null,
        appId: typeof intent.appId === 'string' && intent.appId ? intent.appId : null
    };
}

function getModernFlyoutIntent(flyoutName) {
    if (!activeModernFlyoutIntent || activeModernFlyoutIntent.flyoutName !== flyoutName) {
        return null;
    }

    return activeModernFlyoutIntent;
}

function clearModernFlyoutIntent(flyoutName = null) {
    if (!activeModernFlyoutIntent) {
        return;
    }

    if (flyoutName && activeModernFlyoutIntent.flyoutName !== flyoutName) {
        return;
    }

    activeModernFlyoutIntent = null;
}

function resolveModernFlyoutIntentAppContext(intent) {
    if (!intent) {
        return null;
    }

    let appId = intent.appId || null;
    let appName = null;

    if (intent.windowId) {
        const windowData = getRunningWindowData(intent.windowId);
        if (!isModernAppWindowData(windowData)) {
            return null;
        }

        appId = appId || windowData.app?.id || null;
        appName = windowData.app?.name || null;
    }

    if (!appId || typeof AppsManager === 'undefined' || typeof AppsManager.getAppById !== 'function') {
        return appId ? { appId, appName: appName || appId } : null;
    }

    const appDefinition = AppsManager.getAppById(appId);
    return {
        appId,
        appName: appName || appDefinition?.name || appId
    };
}

function appendSettingsMenuItems($menuItems, items) {
    if (!Array.isArray(items)) {
        return false;
    }

    let appended = false;
    items.forEach(item => {
        if (!item || typeof item.action !== 'string' || typeof item.label !== 'string') {
            return;
        }

        const $item = $(`
            <div class="settings-menu-item" data-action="${item.action}">
                <span class="settings-menu-item-text">${item.label}</span>
            </div>
        `);
        $menuItems.append($item);
        appended = true;
    });

    return appended;
}

function appendSettingsProviderItems($menuItems, appId) {
    if (!appId) {
        return false;
    }

    const providerKeys = Object.keys(window).filter(k => k.endsWith('AppSettings'));
    for (const key of providerKeys) {
        const provider = window[key];
        if (provider && provider.appId === appId && typeof provider.getMenuItems === 'function') {
            return appendSettingsMenuItems($menuItems, provider.getMenuItems());
        }
    }

    return false;
}

function openModernFlyout(flyoutName, intent = {}) {
    const $flyout = $(`.modern-flyout[data-flyout="${flyoutName}"]`);
    const $charmsBar = $('.charms-bar');

    if ($flyout.length === 0) {
        console.error('Flyout not found:', flyoutName);
        return;
    }

    console.log('Opening flyout:', flyoutName);
    setModernFlyoutIntent(flyoutName, intent);
    if (flyoutName === 'settings' && intent?.source === 'charms') {
        captureSettingsCharmAppContext();
    }
    clearClassicWindowFocusForShell(`modern-flyout:${flyoutName}`);
    closeTaskViewPlaceholder();
    // Close start surface if visible, with skipClosePopups to avoid a race condition:
    // closeStartScreen → closeAllPopupsAndMenus → closeModernFlyout would schedule
    // removal of the flyout's 'visible' class at 300ms, conflicting with us adding
    // 'visible' at 200ms below. We handle popup cleanup ourselves right after this.
    if (isStartSurfaceVisible() && !shouldUseTabletStartHomeSurface()) {
        closeStartSurface({ forceDesktop: true, suppressRestore: true, skipClosePopups: true });
    }

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
    $charmsBar.removeClass('visible show-background stagger-from-top stagger-from-bottom stagger-from-center');

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
        updateTabletStartHomeShellState();

        if (flyoutName === 'search') {
            handleSearchFlyoutOpened();
        }
    }, 200);
}

function updateSettingsFlyout() {
    const $appNameElement = $('#settings-app-name');
    const $menuItems = $('#settings-menu-items');
    const settingsIntent = getModernFlyoutIntent('settings');
    const intendedAppContext =
        settingsIntent?.source === 'app-commands'
            ? resolveModernFlyoutIntentAppContext(settingsIntent)
            : null;

    // Get the current app name based on the current view
    let appName = 'Desktop';
    let settingsAppId = null;
    const activeModernApp = getActiveModernRunningApp();
    const rememberedAppContext = !intendedAppContext && settingsIntent?.source === 'charms'
        ? getRememberedSettingsCharmAppContext()
        : null;
    if (currentView === 'start' || isStartMenuOpen()) {
        appName = 'Start';
    } else if (intendedAppContext) {
        appName = intendedAppContext.appName;
        settingsAppId = intendedAppContext.appId;
    } else if (activeModernApp && activeModernApp.app) {
        appName = activeModernApp.app.name;
        settingsAppId = activeModernApp.app.id;
    } else if (rememberedAppContext) {
        appName = rememberedAppContext.appName;
        settingsAppId = rememberedAppContext.appId;
    } else if (currentView === 'desktop') {
        appName = 'Desktop';
    }

    // Update the app name in the Settings flyout
    $appNameElement.text(appName);

    // Clear existing menu items
    $menuItems.empty();

    // Add Desktop fallback menu items when no app is focused
    if (currentView === 'desktop' && !activeModernApp && !settingsAppId) {
        const $controlPanelItem = $(`
            <div class="settings-menu-item" data-action="desktop-control-panel">
                <span class="settings-menu-item-text">Control Panel</span>
            </div>
        `);
        $menuItems.append($controlPanelItem);

        const $personalizationItem = $(`
            <div class="settings-menu-item" data-action="desktop-personalization">
                <span class="settings-menu-item-text">Personalization</span>
            </div>
        `);
        $menuItems.append($personalizationItem);

        const $pcInfoItem = $(`
            <div class="settings-menu-item" data-action="desktop-pc-info">
                <span class="settings-menu-item-text">PC Info</span>
            </div>
        `);
        $menuItems.append($pcInfoItem);

        const $helpItem = $(`
            <div class="settings-menu-item" data-action="desktop-help">
                <span class="settings-menu-item-text">Help</span>
            </div>
        `);
        $menuItems.append($helpItem);

        // No additional settings for desktop mode beyond these links
    } else if (currentView === 'start' || isStartMenuOpen()) {
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
    } else if (settingsAppId) {
        // Check for per-app settings providers exposed on window.
        // Apps register via window.<AppName>AppSettings = { appId, getMenuItems() }.
        appendSettingsProviderItems($menuItems, settingsAppId);
    }

    console.log('Updated Settings flyout for:', appName);
}

function closeModernFlyout() {
    hideAllSixPackSliderPopups();
    clearModernFlyoutIntent();

    const $openFlyouts = $('.modern-flyout.visible');

    // Add closing animation
    $openFlyouts.addClass('closing');

    // Wait for animation to complete before removing visible class
    setTimeout(function () {
        $openFlyouts.removeClass('visible closing');
        // Reset settings panels when closing
        resetSettingsPanels();
        updateTabletStartHomeShellState();
    }, 300);

    console.log('Closed all flyouts');
    updateTabletStartHomeShellState();
}

// Reset settings panels to their initial state
function resetSettingsPanels() {
    const $mainSettings = $('.settings-panel.main-settings');
    const $personalizePanel = $('.settings-panel.personalize-panel');
    const $tilesPanel = $('.settings-panel.tiles-panel');

    hideAllSixPackSliderPopups();

    // Clear all animation classes
    $mainSettings.removeClass('fade-out hidden');
    $personalizePanel.removeClass('slide-in fade-out');
    $tilesPanel.removeClass('slide-in fade-out');

    // Clear any inline styles
    $mainSettings.css('transition', '').css('transform', '').css('opacity', '');

    // Hide any app-specific settings panels (e.g., Weather Options, About)
    $('.settings-flyout-panel-container .settings-panel').not('.main-settings, .personalize-panel, .tiles-panel').hide();
    $mainSettings.show();
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
let brightnessSystemSupported = false;
let brightnessSystemCapabilityKnown = false;
let brightnessInitializationPromise = null;
const SETTINGS_SLIDER_FADE_DURATION = 200; // ms

function clampNumber(value, min, max) {
    const number = Number(value);
    if (Number.isNaN(number)) {
        return min;
    }
    return Math.min(max, Math.max(min, Math.round(number)));
}

function hideAllSixPackSliderPopups({ except = null } = {}) {
    $('.six-pack-slider-popup').each(function () {
        const $popup = $(this);
        const popupType = ($popup.data('popup') || '').toString();

        if (popupType === except) {
            return;
        }

        scheduleHideSixPackSliderPopup($popup);
    });

    if (!except) {
        $('.six-pack-item[data-control="volume"], .six-pack-item[data-control="brightness"]').removeClass('active-slider');
    }
}

function applyBrightnessLevel(level, { persist = false, syncSlider = true } = {}) {
    const clamped = clampNumber(level, 0, 100);
    currentBrightnessLevel = clamped;

    const overlayLevel = brightnessSystemSupported ? 100 : clamped;
    const normalized = Math.min(1, Math.max(0, overlayLevel / 100));
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

function updateBrightnessSupportState(state) {
    if (!state || typeof state.supported !== 'boolean') {
        return;
    }

    brightnessSystemCapabilityKnown = true;
    brightnessSystemSupported = state.supported;
    applyBrightnessLevel(currentBrightnessLevel, { persist: false });
}

async function loadInitialBrightnessLevel() {
    if (brightnessInitializationPromise) {
        return brightnessInitializationPromise;
    }

    brightnessInitializationPromise = (async () => {
        if (window.BrightnessUI && typeof window.BrightnessUI.prewarm === 'function') {
            try {
                await window.BrightnessUI.prewarm();
            } catch (error) {
                console.error('Failed to prewarm system brightness state:', error);
            }
        }

        if (window.BrightnessUI && typeof window.BrightnessUI.getBrightnessState === 'function') {
            try {
                const state = await window.BrightnessUI.getBrightnessState();
                updateBrightnessSupportState(state);

                if (state.supported && typeof state.brightness === 'number') {
                    applyBrightnessLevel(state.brightness, { persist: true });
                    return state;
                }

                if (state.error) {
                    console.warn('Failed to read system brightness state:', state.error);
                }
            } catch (error) {
                console.error('Failed to initialize system brightness state:', error);
            }
        }

        loadStoredBrightnessLevel();
        return {
            supported: false,
            brightness: currentBrightnessLevel
        };
    })();

    return brightnessInitializationPromise;
}

async function syncSixPackVolumeSlider() {
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

async function syncSixPackBrightnessSlider() {
    if ((!brightnessSystemCapabilityKnown || brightnessSystemSupported) &&
        window.BrightnessUI &&
        typeof window.BrightnessUI.getBrightnessState === 'function') {
        try {
            const state = await window.BrightnessUI.getBrightnessState();
            updateBrightnessSupportState(state);

            if (state.supported && typeof state.brightness === 'number') {
                applyBrightnessLevel(state.brightness);
                return;
            }
        } catch (error) {
            console.error('Failed to sync system brightness state for settings slider:', error);
        }
    }

    applyBrightnessLevel(currentBrightnessLevel);
}

function scheduleHideSixPackSliderPopup($popup) {
    if (!$popup || !$popup.length) {
        return;
    }

    const control = $popup.closest('.six-pack-item');
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
    $popup.find('.six-pack-slider').removeClass('is-active');

    const timer = setTimeout(() => {
        $popup.removeClass('visible closing').removeData('hideTimer');
    }, SETTINGS_SLIDER_FADE_DURATION);

    $popup.data('hideTimer', timer);
}

async function toggleSixPackSliderPopup(type) {
    const $popup = $(`.six-pack-slider-popup[data-popup="${type}"]`);
    const $control = $(`.six-pack-item[data-control="${type}"]`);

    if (!$popup.length || !$control.length) {
        return;
    }

    const isClosing = $popup.hasClass('closing');
    const isVisible = $popup.hasClass('visible') && !isClosing;

    if (isVisible) {
        scheduleHideSixPackSliderPopup($popup);
        return;
    }

    hideAllSixPackSliderPopups({ except: type });

    if (type === 'brightness') {
        try {
            await loadInitialBrightnessLevel();
        } catch (error) {
            console.error('Failed to finish brightness initialization before opening slider:', error);
        }
    }

    const existingTimer = $popup.data('hideTimer');
    if (existingTimer) {
        clearTimeout(existingTimer);
        $popup.removeData('hideTimer');
    }

    $popup.removeClass('closing').addClass('visible').attr('aria-hidden', 'false');
    $control.addClass('active-slider');

    if (type === 'volume') {
        syncSixPackVolumeSlider();
    } else if (type === 'brightness') {
        syncSixPackBrightnessSlider();
    }
}

loadInitialBrightnessLevel();

$(document).on('click', '.six-pack-item[data-control="volume"]', function (e) {
    e.preventDefault();
    e.stopPropagation();
    toggleSixPackSliderPopup('volume');
});

$(document).on('click', '.six-pack-item[data-control="brightness"]', function (e) {
    e.preventDefault();
    e.stopPropagation();
    toggleSixPackSliderPopup('brightness');
});

$(document).on('click', '.six-pack-item[data-control="fullscreen"]', async function (e) {
    e.preventDefault();
    e.stopPropagation();

    const isFullscreen = await toggleShellFullscreen();
    console.log('Six-pack fullscreen button clicked - fullscreen:', isFullscreen);
});

$(document).on('click', '.six-pack-item', function (e) {
    const control = $(this).data('control');
    if (control !== 'volume' && control !== 'brightness') {
        hideAllSixPackSliderPopups();
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

$(document).on('click', '.six-pack-slider', function (e) {
    e.stopPropagation();
});

$(document).on('input', '#settings-brightness-slider', function (e) {
    e.stopPropagation();
    const value = clampNumber(this.value, 0, 100);
    applyBrightnessLevel(value, { persist: false, syncSlider: false });

    if (window.BrightnessUI && typeof window.BrightnessUI.previewBrightness === 'function') {
        window.BrightnessUI.previewBrightness(value);
    }
});

$(document).on('change', '#settings-brightness-slider', async function () {
    const value = clampNumber(this.value, 0, 100);
    applyBrightnessLevel(value, { persist: true, syncSlider: false });

    if (window.BrightnessUI && typeof window.BrightnessUI.setBrightness === 'function') {
        try {
            const state = await window.BrightnessUI.setBrightness(value);
            updateBrightnessSupportState(state);

            if (state.supported && typeof state.brightness === 'number') {
                applyBrightnessLevel(state.brightness, { persist: true });
            } else if (state.error) {
                console.warn('Failed to set system brightness:', state.error);
            }
        } catch (error) {
            console.error('Failed to set system brightness:', error);
        }
    }
});

$(document).on('pointerdown', '.six-pack-slider', function (e) {
    e.stopPropagation();
    $(this).addClass('is-active');
});

$(document).on('pointerup pointercancel', function () {
    $('.six-pack-slider.is-active').removeClass('is-active');
});

$(document).on('click', '.six-pack-slider-popup', function (e) {
    e.stopPropagation();
});

$(document).on('click', function (e) {
    if (!$(e.target).closest('.six-pack-slider-popup, .six-pack-item[data-control="volume"], .six-pack-item[data-control="brightness"]').length) {
        hideAllSixPackSliderPopups();
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

// Desktop-specific Control Panel link
$(document).on('click', '.settings-menu-item[data-action="desktop-control-panel"]', function (e) {
    e.preventDefault();
    e.stopPropagation();
    console.log('Desktop Control Panel menu item clicked');

    const controlPanelApp = AppsManager.getAppById('control-panel');
    if (controlPanelApp) {
        launchApp(controlPanelApp);
    } else {
        console.warn('Control Panel app not available');
    }

    closeModernFlyout();
});

// Desktop-specific Personalization link
$(document).on('click', '.settings-menu-item[data-action="desktop-personalization"]', function (e) {
    e.preventDefault();
    e.stopPropagation();
    console.log('Desktop Personalization menu item clicked');

    openControlPanelApplet('personalization');
    closeModernFlyout();
});

// Desktop-specific PC Info link (nonfunctional placeholder)
$(document).on('click', '.settings-menu-item[data-action="desktop-pc-info"]', function (e) {
    e.preventDefault();
    e.stopPropagation();
    console.log('Desktop PC Info menu item clicked (placeholder)');

    closeModernFlyout();
});

// Desktop-specific Help link (nonfunctional placeholder)
$(document).on('click', '.settings-menu-item[data-action="desktop-help"]', function (e) {
    e.preventDefault();
    e.stopPropagation();
    console.log('Desktop Help menu item clicked (placeholder)');

    closeModernFlyout();
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
    if (!window.WallpaperController) {
        return Promise.resolve();
    }

    return window.WallpaperController.initialize();
}

async function syncHostWallpaperThemeIfNeeded() {
    const themeSettings = loadThemeSettings();
    if (themeSettings.currentTheme !== 'synced' || themeSettings.unsavedTheme) {
        return null;
    }

    const hostWallpaperService = getShellHostWallpaperService();
    if (!hostWallpaperService || typeof hostWallpaperService.loadWallpaper !== 'function') {
        return null;
    }

    const hostWallpaper = await hostWallpaperService.loadWallpaper({ forceRefresh: true });
    if (!hostWallpaper || !hostWallpaper.hasHostWallpaper || !hostWallpaper.wallpaperPath) {
        return null;
    }

    const currentSettings = window.WallpaperController.getSettings();
    const nextSettings = {
        ...currentSettings,
        currentWallpaper: hostWallpaper.wallpaperPath,
        currentWallpaperType: 'custom',
        selectedWallpapers: [hostWallpaper.wallpaperPath],
        selectedWallpapersTypes: ['custom'],
        shuffle: false,
        currentLocation: currentSettings.currentLocation || 'windows'
    };

    return window.WallpaperController.saveSettings(nextSettings, {
        withCrossfade: false,
        reason: 'synced-theme-refresh'
    });
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

// Helper function to adjust brightness, saturation, and optionally hue
function adjustBrightnessAndSaturation(color, brightnessChange, saturationChange, hueShift = 0) {
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

    // Adjust saturation, lightness, and optionally hue
    s = Math.min(1, Math.max(0, s * (1 + saturationChange / 100)));
    l = Math.min(1, Math.max(0, l * (1 + brightnessChange / 100)));
    h = (h + (hueShift / 360) + 1) % 1;

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

    // Compare actual black/white contrast ratios instead of using a loose luminance cutoff.
    // Black wins ties so medium tones do not switch to white too early.
    const luminance = getRelativeLuminance(r, g, b);
    const whiteContrast = 1.05 / (luminance + 0.05);
    const blackContrast = (luminance + 0.05) / 0.05;

    return blackContrast >= whiteContrast ? '#000000' : '#ffffff';
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
        'ui-wall-color': rootStyles.getPropertyValue('--ui-wall-color').trim(),
        'ui-wall-text-contrast': rootStyles.getPropertyValue('--ui-wall-text-contrast').trim()
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

function syncWallColorContrastVariable(color) {
    const textColor = getContrastingTextColor(color);
    document.documentElement.style.setProperty('--ui-wall-text-contrast', textColor);
    return textColor;
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

    if (window.BluetoothTrayMenu && typeof window.BluetoothTrayMenu.hideContextMenu === 'function') {
        window.BluetoothTrayMenu.hideContextMenu();
    }
}

function requestExplorerDesktopRefresh() {
    if (window.ExplorerEngine && typeof window.ExplorerEngine.refreshDesktop === 'function') {
        window.ExplorerEngine.refreshDesktop().catch(error => {
            console.error('ExplorerEngine: Refresh failed.', error);
        });
    }
}

let recycleBinTileEventsBound = false;

function refreshRecycleBinPinnedSurfaces() {
    renderPinnedTiles();

    if (typeof renderStartMenuTiles === 'function') {
        renderStartMenuTiles();
    }
}

function applyRecycleBinTileState(state) {
    if (!window.AppsManager || typeof AppsManager.applyRecycleBinAppState !== 'function') {
        return false;
    }

    return AppsManager.applyRecycleBinAppState(state);
}

async function initializeRecycleBinTileState() {
    if (!electronIpc || typeof electronIpc.invoke !== 'function') {
        return;
    }

    try {
        applyRecycleBinTileState(await electronIpc.invoke('trash:get-info'));
    } catch (error) {
        console.warn('[App] Failed to initialize Recycle Bin tile state:', error);
    }
}

function bindRecycleBinTileEvents() {
    if (recycleBinTileEventsBound || !electronIpc || typeof electronIpc.on !== 'function') {
        return;
    }

    electronIpc.on('trash:state-changed', (event, nextState) => {
        if (!applyRecycleBinTileState(nextState)) {
            return;
        }

        const recycleBinApp = AppsManager.getAppById(APP_RECYCLE_BIN_APP_ID);
        if (recycleBinApp?.pinned) {
            refreshRecycleBinPinnedSurfaces();
        }
    });

    recycleBinTileEventsBound = true;
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
    clearClassicWindowFocusForShell('quick-links');

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

        updateDesktopModernMetroModeBodyState();
        commitPendingThresholdSignOutChanges();

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
    $(document).on('click', '.six-pack-item[data-control="power"]', function (e) {
        e.preventDefault();
        e.stopPropagation();

        const $powerMenu = $('.settings-power-menu');
        const $powerButton = $(this);

        // Toggle menu and button active state
        $powerMenu.toggleClass('active');
        $powerButton.toggleClass('active');

        console.log('Six-pack power button clicked - menu toggled');
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
        const $sixPackPowerButton = $('.six-pack-item[data-control="power"]');

        if (!$(e.target).closest('.settings-power-menu').length &&
            !$(e.target).closest('.six-pack-item[data-control="power"]').length) {
            $settingsPowerMenu.removeClass('active');
            $sixPackPowerButton.removeClass('active');
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
        $('.six-pack-item[data-control="power"]').removeClass('active');

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
        if (typeof networkMonitor !== 'undefined' && networkMonitor.populateNetworkFlyout) {
            networkMonitor.populateNetworkFlyout();
        }
    });

    // Settings charm network button click handler - open network flyout
    $(document).on('click', '.six-pack-item[data-control="network"]', function (e) {
        e.preventDefault();
        e.stopPropagation();

        console.log('Six-pack network button clicked - opening network flyout');
        openModernFlyout('network');
        if (typeof networkMonitor !== 'undefined' && networkMonitor.populateNetworkFlyout) {
            networkMonitor.populateNetworkFlyout();
        }
    });

    // Network flyout back button - close the flyout
    $(document).on('click', '.network-back-button', function (e) {
        e.preventDefault();
        e.stopPropagation();
        closeModernFlyout();
    });
});

// Helper function to hide charms bar
function hideCharmsBar() {
    const $charmsBar = $('.charms-bar');

    $charmsBar
        .removeClass('keyboard-triggered touch-dragging')
        .css({
            '--charms-touch-offset': '',
            '--charms-stagger-tier1': '',
            '--charms-stagger-tier2': ''
        })
        .addClass('hiding');
    setTimeout(function () {
        $charmsBar.removeClass('visible show-background hiding stagger-from-top stagger-from-bottom stagger-from-center');
        updateTabletStartHomeShellState();
    }, 250);

    updateTabletStartHomeShellState();
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
    if ($('body').hasClass('view-modern') && $('.modern-app-container.active .modern-app-titlebar').length > 0) {
        return true;
    }

    return $('body').hasClass('desktop-modern-metro-mode') && getActiveDesktopModernMetroTitlebar().length > 0;
}

function getModernTouchTitlebar(options = {}) {
    if (options.all) {
        return $('.modern-app-titlebar, .modern-desktop-app-container.metro-mode .modern-desktop-window-titlebar');
    }

    if ($('body').hasClass('desktop-modern-metro-mode')) {
        return getActiveDesktopModernMetroTitlebar();
    }

    return $('.modern-app-container.active').last().find('.modern-app-titlebar').first();
}

function getModernTouchBarElement(barName, options = {}) {
    if (barName === 'titlebar') {
        return getModernTouchTitlebar(options);
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

    updateHostedViewPointerLockState();
    scheduleHostedViewPointerLockUpdate();

    if (barName === 'titlebar') {
        scheduleCharmsTriggerAvailabilityUpdate();
    }
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

    updateHostedViewPointerLockState();
    scheduleHostedViewPointerLockUpdate();

    if (barName === 'titlebar') {
        scheduleCharmsTriggerAvailabilityUpdate();
    }
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

    updateHostedViewPointerLockState();
    scheduleHostedViewPointerLockUpdate();

    if (barName === 'titlebar') {
        scheduleCharmsTriggerAvailabilityUpdate();
    }

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
    const handleModernEdgeTouchStart = function (event) {
        if (!isModernTouchBarContext()) {
            hideModernTouchEdgeBars();
            return;
        }

        if (!event.touches || event.touches.length !== 1) {
            return;
        }

        const touch = event.touches[0];
        const $target = $(event.target);
        const insideTitlebar = $target.closest('.modern-app-titlebar, .modern-desktop-window-titlebar').length > 0;
        const insideTaskbar = $target.closest('.taskbar').length > 0 ||
            isTouchWithinVisibleDesktopModernTaskbarRegion(touch);
        let hidExistingBar = false;

        if (insideTitlebar) {
            pinModernTouchBar('titlebar');
        } else if (isModernTouchBarShown('titlebar')) {
            hideModernTouchBar('titlebar');
            hidExistingBar = true;
        }

        if (insideTaskbar) {
            clearDesktopModernTaskbarPeekHideTimer();
            showDesktopModernTaskbarPeek();
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
            event.preventDefault();
            return;
        }

        if (touch.clientY >= window.innerHeight - MODERN_TOUCH_EDGE_ZONE) {
            startModernTouchBarDrag('taskbar', touch);
            event.preventDefault();
        }
    };

    const handleModernEdgeTouchMove = function (event) {
        if (!event.touches || event.touches.length !== 1) {
            if (modernTouchEdgeBars.titlebar.active) {
                hideModernTouchBar('titlebar');
            }

            if (modernTouchEdgeBars.taskbar.active) {
                hideModernTouchBar('taskbar');
            }

            return;
        }

        const touch = event.touches[0];
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
            event.preventDefault();
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
            event.preventDefault();
        }
    };

    const handleModernEdgeTouchEnd = function () {
        const titlebarState = modernTouchEdgeBars.titlebar;
        const taskbarState = modernTouchEdgeBars.taskbar;

        if (titlebarState.active) {
            const shouldOpen = titlebarState.reveal >= MODERN_TOUCH_TITLEBAR_OPEN_THRESHOLD;
            titlebarState.active = false;

            if (shouldOpen) {
                showModernTouchBar('titlebar', { pinned: true });
            } else {
                hideModernTouchBar('titlebar');
            }
        }

        if (taskbarState.active) {
            const shouldOpen = taskbarState.reveal >= MODERN_TOUCH_TASKBAR_OPEN_THRESHOLD;
            taskbarState.active = false;

            if (shouldOpen) {
                showModernTouchBar('taskbar', { pinned: true });
            } else {
                hideModernTouchBar('taskbar');
            }
        }
    };

    document.addEventListener('touchstart', handleModernEdgeTouchStart, { passive: false });
    document.addEventListener('touchmove', handleModernEdgeTouchMove, { passive: false });
    document.addEventListener('touchend', handleModernEdgeTouchEnd, { passive: true });
    document.addEventListener('touchcancel', handleModernEdgeTouchEnd, { passive: true });
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
window.focusClassicWindow = focusClassicWindow;
window.moveClassicWindow = moveClassicWindow;
window.minimizeModernApp = minimizeModernApp;
window.minimizeClassicWindow = minimizeClassicWindow;
window.restoreModernApp = restoreModernApp;
window.restoreClassicWindow = restoreClassicWindow;
window.toggleMaximizeClassicWindow = toggleMaximizeClassicWindow;
window.closeTaskViewPlaceholder = closeTaskViewPlaceholder;
window.closeSnapAssist = closeSnapAssist;
window.snapClassicWindowToZone = snapClassicWindowToZone;
window.launchApp = launchApp;
window.relaunchClassicApp = relaunchClassicApp;
window.fetchChromeBetaSearchSuggestions = fetchChromeBetaSearchSuggestions;
window.performChromeBetaDownloadAction = performChromeBetaDownloadAction;
window.consumeClassicWindowLaunchOptions = consumeClassicWindowLaunchOptions;
window.canOpenNewTaskbarAppWindow = canOpenNewTaskbarAppWindow;
window.tryOpenNewTaskbarAppWindow = tryOpenNewTaskbarAppWindow;
window.focusOrRestoreTaskbarApp = focusOrRestoreTaskbarApp;
window.launchOrFocusTaskbarApp = launchOrFocusTaskbarApp;
window.restartExplorerShell = restartExplorerShell;
window.closeStartScreen = closeStartScreen;
window.updateClassicWindowTitle = updateClassicWindowTitle;
