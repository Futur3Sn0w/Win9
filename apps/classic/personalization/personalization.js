// Personalization Themes Manager
console.log('Personalization.js loaded');

const {
    loadDesktopBackgroundSettings,
    saveDesktopBackgroundSettings
} = require('../../../registry/wallpaper-registry.js');
const {
    loadThemeSettings,
    saveThemeSettings,
    getDefaultThemeSettings,
    isDefaultThemeSettings
} = require('../../../registry/theme-registry.js');
const { pathToFileURL } = require('url');

function getWallpaperController() {
    const contexts = [window, window.parent, window.top];
    for (const ctx of contexts) {
        try {
            if (ctx && ctx.WallpaperController) {
                return ctx.WallpaperController;
            }
        } catch (error) {
            console.warn('[Personalization] Could not access wallpaper controller:', error);
        }
    }
    return null;
}

function loadCurrentWallpaperSettings() {
    const controller = getWallpaperController();
    if (controller && typeof controller.getSettings === 'function') {
        return controller.getSettings();
    }
    return loadDesktopBackgroundSettings();
}

var ColorRegistry = (function () {
    const contexts = [window, window.parent, window.top];
    for (const ctx of contexts) {
        if (ctx && ctx.ColorRegistry) {
            return ctx.ColorRegistry;
        }
    }

        if (typeof window !== 'undefined' && typeof window.require === 'function') {
            try {
                const module = window.require('../../../registry/color-registry.js');
                window.ColorRegistry = module;
                return module;
            } catch (error) {
                console.warn('[Personalization] Could not require color-registry.js:', error);
            }
        }

        return null;
})();

var ControlPanelColorRegistry = (function () {
    const contexts = [window, window.parent, window.top];
    for (const ctx of contexts) {
        if (ctx && ctx.ControlPanelColorRegistry) {
            return ctx.ControlPanelColorRegistry;
        }
    }

    if (typeof window !== 'undefined' && typeof window.require === 'function') {
        try {
            const module = window.require('../../../registry/control-panel-color-registry.js');
            window.ControlPanelColorRegistry = module;
            return module;
        } catch (error) {
            console.warn('[Personalization] Could not require control-panel-color-registry.js:', error);
        }
    }

    try {
        return require('../../../registry/control-panel-color-registry.js');
    } catch (error) {
        console.warn('[Personalization] Could not require control-panel-color-registry.js (node fallback):', error);
        return null;
    }
})();

function personalizationLoadColorSettings() {
    if (ColorRegistry && typeof ColorRegistry.loadColorSettings === 'function') {
        return ColorRegistry.loadColorSettings();
    }
    return { selectedColor: 'automatic', customColor: null };
}

function personalizationSaveColorSettings(options) {
    if (ColorRegistry && typeof ColorRegistry.saveColorSettings === 'function') {
        return ColorRegistry.saveColorSettings(options);
    }
    console.warn('[Personalization] ColorRegistry unavailable, skipping color save');
    return options;
}

function loadControlPanelColorSettings() {
    if (ControlPanelColorRegistry && typeof ControlPanelColorRegistry.loadControlPanelColor === 'function') {
        return ControlPanelColorRegistry.loadControlPanelColor();
    }
    return { mode: 'automatic', color: null };
}

function applyWallColorVariables(color, targetWindow = window) {
    if (!targetWindow || !targetWindow.document || !color) {
        return;
    }

    if (typeof targetWindow.applyWallColorVariables === 'function') {
        targetWindow.applyWallColorVariables(color, targetWindow.document);
        return;
    }

    targetWindow.document.documentElement.style.setProperty('--ui-wall-color', color);
    targetWindow.document.documentElement.style.setProperty('--ui-wall-text-contrast', '#ffffff');
}

function toPreviewAssetUrl(path) {
    if (!path || typeof path !== 'string') {
        return path;
    }

    if (path.startsWith('http://') || path.startsWith('https://') ||
        path.startsWith('file://') || path.startsWith('resources/')) {
        return path;
    }

    if (path.startsWith('/') || path.startsWith('\\\\') || /^[A-Z]:[\\/]/i.test(path)) {
        try {
            return pathToFileURL(path).href;
        } catch (error) {
            console.warn('[Personalization] Failed to convert preview asset path to file URL:', path, error);
        }
    }

    return path;
}

function getHostWallpaperService() {
    const contexts = [window, window.parent, window.top];
    for (const ctx of contexts) {
        try {
            if (ctx && ctx.ShellHostWallpaper) {
                return ctx.ShellHostWallpaper;
            }
        } catch (error) {
            console.warn('[Personalization] Could not access ShellHostWallpaper:', error);
        }
    }

    return null;
}

function normalizeString(value) {
    if (typeof value !== 'string') {
        return '';
    }

    return value.trim();
}

function inferWallpaperType(wallpaperPath) {
    const normalizedPath = normalizeString(wallpaperPath);
    if (!normalizedPath) {
        return 'builtin';
    }

    if (normalizedPath.startsWith('resources/')) {
        return 'builtin';
    }

    if (normalizedPath.startsWith('/') || normalizedPath.startsWith('\\\\') || /^[A-Z]:[\\/]/i.test(normalizedPath) ||
        normalizedPath.startsWith('file://') || normalizedPath.startsWith('http://') || normalizedPath.startsWith('https://')) {
        return 'custom';
    }

    return 'builtin';
}

function normalizeWallpaperTypes(wallpapers, wallpaperTypes) {
    const normalizedWallpapers = Array.isArray(wallpapers) ? wallpapers.filter(Boolean) : [];
    return normalizedWallpapers.map((wallpaper, index) => {
        const explicitType = Array.isArray(wallpaperTypes) ? wallpaperTypes[index] : null;
        if (explicitType === 'custom' || explicitType === 'builtin') {
            return explicitType;
        }
        return inferWallpaperType(wallpaper);
    });
}

function normalizeTheme(theme, fallback = {}) {
    if (!theme || typeof theme !== 'object') {
        return null;
    }

    const wallpapers = Array.isArray(theme.wallpapers) ? theme.wallpapers.filter(Boolean) : [];
    const wallpaperTypes = normalizeWallpaperTypes(wallpapers, theme.wallpaperTypes);

    return {
        ...cloneDeep(fallback || {}),
        ...cloneDeep(theme),
        wallpapers,
        wallpaperTypes,
        currentLocation: normalizeString(theme.currentLocation) || normalizeString(fallback.currentLocation) || 'windows'
    };
}

function wallpaperListsMatch(left, right) {
    return JSON.stringify(Array.isArray(left) ? left : []) === JSON.stringify(Array.isArray(right) ? right : []);
}

function wallpaperTypesMatch(left, right) {
    return JSON.stringify(Array.isArray(left) ? left : []) === JSON.stringify(Array.isArray(right) ? right : []);
}

function resolveThemeWallpaperPath(wallpaperPath, wallpaperType) {
    const normalizedPath = normalizeString(wallpaperPath);
    const normalizedType = wallpaperType === 'custom' ? 'custom' : inferWallpaperType(normalizedPath);

    if (!normalizedPath) {
        return '';
    }

    if (normalizedType === 'custom') {
        return normalizedPath;
    }

    if (normalizedPath.startsWith('resources/')) {
        return normalizedPath;
    }

    return `${WALLPAPERS_BASE_PATH}${normalizedPath}`;
}

const WALLPAPERS_BASE_PATH = '../../../resources/images/wallpapers/';
const SYNCED_THEME_ID = 'synced';

// Define the default Windows themes
const defaultThemes = {
    windows: {
        id: 'windows',
        name: 'Windows',
        wallpapers: ['Windows/img0.jpg'],
        wallpaperTypes: ['builtin'],
        color: '#58B1FC', // Blue from available colors
        type: 'default',
        currentLocation: 'windows'
    },
    linesAndColors: {
        id: 'linesAndColors',
        name: 'Lines and colors',
        wallpapers: [
            'Theme1/img1.jpg',
            'Theme1/img2.jpg',
            'Theme1/img3.jpg',
            'Theme1/img4.jpg',
            'Theme1/img5.jpg',
            'Theme1/img6.jpg',
            'Theme1/img13.jpg'
        ],
        wallpaperTypes: ['builtin', 'builtin', 'builtin', 'builtin', 'builtin', 'builtin', 'builtin'],
        color: '#47CF74', // Green from available colors
        type: 'default',
        currentLocation: 'windows'
    },
    flowers: {
        id: 'flowers',
        name: 'Flowers',
        wallpapers: [
            'Theme2/img7.jpg',
            'Theme2/img8.jpg',
            'Theme2/img9.jpg',
            'Theme2/img10.jpg',
            'Theme2/img11.jpg',
            'Theme2/img12.jpg'
        ],
        wallpaperTypes: ['builtin', 'builtin', 'builtin', 'builtin', 'builtin', 'builtin'],
        color: '#F359A8', // Magenta from available colors
        type: 'default',
        currentLocation: 'windows'
    }
};

// State management
let state = {
    currentTheme: null, // Current selected theme ID
    customThemes: [], // User-saved custom themes
    syncedTheme: null, // Synthetic host wallpaper theme
    unsavedTheme: null, // Temporary unsaved theme when user modifies settings
    currentWallpaper: null, // Current wallpaper setting from desktop-background
    currentWallpaperTypes: [], // Current wallpaper types from desktop-background
    currentWallpaperType: 'builtin', // Current active wallpaper type
    currentLocation: 'windows', // Current desktop background location
    currentColor: null, // Current accent color setting from modern personalize
    currentWallColorMode: 'automatic', // Control Panel wall color mode
    currentWallColor: null, // Control Panel wall color (when custom)
    savedState: null // For cancel functionality
};

function cloneDeep(value) {
    if (value == null) {
        return value;
    }
    try {
        return JSON.parse(JSON.stringify(value));
    } catch (error) {
        console.warn('[Personalization] Failed to clone value, returning original:', error);
        return value;
    }
}

function getSyncedTheme() {
    return state.syncedTheme ? normalizeTheme(state.syncedTheme) : null;
}

function resolveTheme(themeId) {
    if (!themeId) {
        return null;
    }

    if (defaultThemes[themeId]) {
        return normalizeTheme(defaultThemes[themeId], { type: 'default' });
    }

    if (themeId === SYNCED_THEME_ID) {
        return getSyncedTheme();
    }

    if (state.unsavedTheme && state.unsavedTheme.id === themeId) {
        return normalizeTheme(state.unsavedTheme, { type: 'unsaved' });
    }

    const customTheme = state.customThemes.find((theme) => theme && theme.id === themeId);
    return customTheme ? normalizeTheme(customTheme, { type: 'custom' }) : null;
}

async function loadSyncedTheme(options = {}) {
    const service = getHostWallpaperService();
    if (!service || typeof service.loadWallpaper !== 'function') {
        state.syncedTheme = null;
        return null;
    }

    try {
        const hostWallpaper = await service.loadWallpaper({
            forceRefresh: Boolean(options && options.forceRefresh)
        });

        if (hostWallpaper && hostWallpaper.hasHostWallpaper && hostWallpaper.wallpaperPath) {
            state.syncedTheme = {
                id: SYNCED_THEME_ID,
                name: 'Synced',
                wallpapers: [hostWallpaper.wallpaperPath],
                wallpaperTypes: ['custom'],
                color: 'automatic',
                type: 'synced',
                currentLocation: 'windows',
                syncSource: hostWallpaper.sourceKind || 'host-wallpaper'
            };
        } else {
            state.syncedTheme = null;
        }
    } catch (error) {
        console.warn('[Personalization] Failed to load synced host wallpaper:', error);
        state.syncedTheme = null;
    }

    renderCustomThemes();
    updateThemeSelection();
    updateActionButtons();

    if (state.currentTheme === SYNCED_THEME_ID && !state.unsavedTheme) {
        checkForUnsavedTheme();
    }

    return getSyncedTheme();
}

// Initialize the personalization page
function init() {
    console.log('init() called');
    loadSavedSettings();
    console.log('After loadSavedSettings, state:', state);

    // Check if current settings match the selected theme on initial load
    if (state.currentTheme && !state.unsavedTheme) {
        console.log('Checking for unsaved theme on init');
        checkForUnsavedTheme();
    }

    renderThemes();
    updateThemeSelection(); // Update visual selection after rendering
    updateActionButtons();
    setupEventListeners();
    loadSyncedTheme({ forceRefresh: true }).catch((error) => {
        console.warn('[Personalization] Synced theme initialization failed:', error);
    });

    // Listen for storage changes from other pages (colors, desktop-background)
    // Note: storage events don't work between iframes in same window,
    // so we'll check on visibility/focus changes instead
    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('focus', checkForSettingsChanges);
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            checkForSettingsChanges();
        }
    });

    // Also check periodically for changes
    setInterval(checkForSettingsChanges, 1000);

    // Notify parent that page has loaded
    if (window.parent && window.parent !== window) {
        window.parent.postMessage({
            action: 'subPageLoaded',
            page: 'personalization',
            title: 'Personalization'
        }, '*');
    }
}

// Load saved settings from localStorage
function loadSavedSettings() {
    let themeSettings = getDefaultThemeSettings();

    try {
        themeSettings = loadThemeSettings();
    } catch (error) {
        console.error('Failed to load theme settings from registry:', error);
    }

    // Migrate legacy localStorage data if present
    let legacyThemeSettings = null;
    try {
        const legacyRaw = window.localStorage ? window.localStorage.getItem('themeSettings') : null;
        if (legacyRaw) {
            try {
                legacyThemeSettings = JSON.parse(legacyRaw);
            } catch (error) {
                console.warn('[Personalization] Failed to parse legacy themeSettings from localStorage:', error);
            }
        }
    } catch (error) {
        console.warn('[Personalization] Unable to access legacy themeSettings from localStorage:', error);
    }

    if (legacyThemeSettings && isDefaultThemeSettings(themeSettings)) {
        const migrated = saveThemeSettings(legacyThemeSettings);
        themeSettings = migrated;
        console.log('[Personalization] Migrated legacy theme settings from localStorage to registry');
    }

    // Clean up legacy keys
    if (legacyThemeSettings) {
        try {
            window.localStorage.removeItem('themeSettings');
        } catch (error) {
            console.warn('[Personalization] Failed to remove legacy themeSettings key:', error);
        }
    }

    // Apply theme settings to state
    state.currentTheme = themeSettings.currentTheme || 'windows';
    state.customThemes = Array.isArray(themeSettings.customThemes)
        ? themeSettings.customThemes.map((theme) => normalizeTheme(theme, { type: 'custom' })).filter(Boolean)
        : [];
    state.unsavedTheme = themeSettings.unsavedTheme
        ? normalizeTheme(themeSettings.unsavedTheme, { type: 'unsaved' })
        : null;
    state.syncedTheme = null;

    // Load current wallpaper settings
    try {
        const bgSettings = loadCurrentWallpaperSettings();
        if (Array.isArray(bgSettings.selectedWallpapers) && bgSettings.selectedWallpapers.length > 0) {
            state.currentWallpaper = [...bgSettings.selectedWallpapers];
            state.currentWallpaperTypes = normalizeWallpaperTypes(bgSettings.selectedWallpapers, bgSettings.selectedWallpapersTypes);
            state.currentWallpaperType = state.currentWallpaperTypes[0] || 'builtin';
        } else if (bgSettings.currentWallpaper) {
            state.currentWallpaper = [bgSettings.currentWallpaper];
            state.currentWallpaperType = bgSettings.currentWallpaperType === 'custom' ? 'custom' : inferWallpaperType(bgSettings.currentWallpaper);
            state.currentWallpaperTypes = [state.currentWallpaperType];
        } else {
            state.currentWallpaper = null;
            state.currentWallpaperType = 'builtin';
            state.currentWallpaperTypes = [];
        }
        state.currentLocation = normalizeString(bgSettings.currentLocation) || 'windows';
    } catch (error) {
        console.error('Failed to load desktop background settings from registry:', error);
        state.currentWallpaperTypes = [];
        state.currentWallpaperType = 'builtin';
        state.currentLocation = 'windows';
    }

    // Load current color settings
    try {
        const colorSettings = personalizationLoadColorSettings();
        if (colorSettings.selectedColor === 'custom' && colorSettings.customColor) {
            state.currentColor = colorSettings.customColor;
        } else {
            state.currentColor = 'automatic';
        }
    } catch (error) {
        console.error('Failed to load color settings from registry:', error);
    }

    // Load control panel wall color settings
    try {
        const wallColorSettings = loadControlPanelColorSettings();
        state.currentWallColorMode = wallColorSettings.mode;
        state.currentWallColor = wallColorSettings.mode === 'custom' ? wallColorSettings.color : null;
    } catch (error) {
        console.error('Failed to load control panel wall color settings:', error);
        state.currentWallColorMode = 'automatic';
        state.currentWallColor = null;
    }

    // IMPORTANT: If we loaded an unsaved theme, check if it still matches current settings
    // If not, it means the user changed wallpaper/color in another page
    if (state.unsavedTheme) {
        const wallpapersMatch = wallpaperListsMatch(state.unsavedTheme.wallpapers, state.currentWallpaper);
        const typesMatch = wallpaperTypesMatch(state.unsavedTheme.wallpaperTypes, state.currentWallpaperTypes);
        const colorMatch = state.unsavedTheme.color === state.currentColor;

        if (!wallpapersMatch || !typesMatch || !colorMatch) {
            console.log('Loaded unsaved theme is outdated, updating it with current settings');
            console.log('Old unsaved theme wallpapers:', state.unsavedTheme.wallpapers, 'New:', state.currentWallpaper);
            console.log('Old unsaved theme color:', state.unsavedTheme.color, 'New:', state.currentColor);

            // Update the unsaved theme with current wallpaper/color
            state.unsavedTheme.wallpapers = state.currentWallpaper || [];
            state.unsavedTheme.wallpaperTypes = [...state.currentWallpaperTypes];
            state.unsavedTheme.color = state.currentColor || 'automatic';
            state.unsavedTheme.currentLocation = state.currentLocation || 'windows';
        }
    }

    // Save initial state for cancel functionality
    state.savedState = JSON.parse(JSON.stringify(state));
}

// Save settings to localStorage
function saveSettings() {
    saveThemeSettings({
        currentTheme: state.currentTheme,
        customThemes: state.customThemes,
        unsavedTheme: state.unsavedTheme
    });
}

// Render all themes
function renderThemes() {
    renderDefaultThemes();
    renderCustomThemes();
}

// Render default Windows themes
function renderDefaultThemes() {
    const themeGrid = document.querySelector('.theme-section.windows-themes .theme-grid');
    if (!themeGrid) {
        console.error('Could not find Windows Default Themes grid');
        return;
    }

    themeGrid.innerHTML = '';

    // Render each default theme
    Object.values(defaultThemes).forEach(theme => {
        const themeElement = createThemeElement(theme);
        themeGrid.appendChild(themeElement);
    });
}

// Render custom themes (My themes section)
function renderCustomThemes() {
    console.log('renderCustomThemes called');
    console.log('state.unsavedTheme:', state.unsavedTheme);
    console.log('state.syncedTheme:', state.syncedTheme);
    console.log('state.customThemes:', state.customThemes);

    // Get the My themes section (now in HTML)
    const myThemesSection = document.querySelector('.theme-section.my-themes');
    if (!myThemesSection) {
        console.error('My Themes section not found in HTML!');
        return;
    }

    // Only show the section if there are custom themes or an unsaved theme
    const hasThemes = state.customThemes.length > 0 || state.unsavedTheme || state.syncedTheme;
    console.log('Has themes to display:', hasThemes);

    if (!hasThemes) {
        // Hide the section if there are no themes
        console.log('Hiding My Themes section (no themes)');
        myThemesSection.style.display = 'none';
        return;
    }

    // Show the section
    myThemesSection.style.display = 'block';
    console.log('Showing My Themes section');

    // Count themes
    const themeCount = (state.unsavedTheme ? 1 : 0) + (state.syncedTheme ? 1 : 0) + state.customThemes.length;
    console.log('Theme count:', themeCount);

    // Update section title
    const sectionTitle = myThemesSection.querySelector('.section-title');
    if (sectionTitle) {
        sectionTitle.textContent = `My themes (${themeCount})`;
    }

    // Clear and populate the theme grid
    const themeGrid = myThemesSection.querySelector('.theme-grid');
    if (!themeGrid) {
        console.error('Theme grid not found in My Themes section!');
        return;
    }

    themeGrid.innerHTML = '';
    console.log('Theme grid cleared');

    // Render unsaved theme first
    if (state.unsavedTheme) {
        console.log('Rendering unsaved theme with wallpapers:', state.unsavedTheme.wallpapers, 'and color:', state.unsavedTheme.color);
        const unsavedElement = createThemeElement(state.unsavedTheme, true);
        themeGrid.appendChild(unsavedElement);
        console.log('Unsaved theme element appended to cleared grid');
    }

    if (state.syncedTheme) {
        console.log('Rendering synced theme with wallpapers:', state.syncedTheme.wallpapers);
        const syncedElement = createThemeElement(state.syncedTheme);
        themeGrid.appendChild(syncedElement);
    }

    // Render custom themes
    state.customThemes.forEach(theme => {
        console.log('Rendering custom theme:', theme.name);
        const themeElement = createThemeElement(theme);
        themeGrid.appendChild(themeElement);
    });

    console.log('My Themes section rendering complete');
}

// Create a theme element
function createThemeElement(theme, isUnsaved = false) {
    theme = normalizeTheme(theme) || theme;
    console.log('createThemeElement called for theme:', theme.name, 'with wallpapers:', theme.wallpapers);

    const themeItem = document.createElement('div');
    themeItem.className = 'theme-item';
    themeItem.dataset.themeId = theme.id;

    // Add selected class if this is the current theme
    if (theme.id === state.currentTheme) {
        themeItem.classList.add('selected');
    }

    // Create thumbnail
    const thumbnail = document.createElement('div');
    thumbnail.className = 'theme-thumbnail';

    // Create wallpaper preview (stacked if multiple, single if one)
    if (theme.wallpapers.length === 1) {
        // Single wallpaper thumbnail
        const wallpaperPath = resolveThemeWallpaperPath(theme.wallpapers[0], theme.wallpaperTypes[0]);
        console.log('Setting single wallpaper thumbnail to:', wallpaperPath);
        thumbnail.style.backgroundImage = `url('${toPreviewAssetUrl(wallpaperPath)}')`;
        thumbnail.style.backgroundSize = 'cover';
        thumbnail.style.backgroundPosition = 'center';
    } else {
        // Stacked wallpapers (show up to 3)
        const stackCount = Math.min(theme.wallpapers.length, 3);
        thumbnail.classList.add('stacked');

        for (let i = 0; i < stackCount; i++) {
            const layer = document.createElement('div');
            layer.className = 'stack-layer';
            layer.style.backgroundImage = `url('${toPreviewAssetUrl(resolveThemeWallpaperPath(theme.wallpapers[i], theme.wallpaperTypes[i]))}')`;
            layer.style.backgroundSize = 'cover';
            layer.style.backgroundPosition = 'center';
            layer.style.zIndex = stackCount - i;

            // Offset each layer slightly
            const offset = i * 3;
            layer.style.top = `${offset}px`;
            layer.style.left = `${offset}px`;

            thumbnail.appendChild(layer);
        }
    }

    // Add color indicator box in bottom-left
    const colorBox = document.createElement('div');
    colorBox.className = 'theme-color-indicator';
    colorBox.style.backgroundColor = theme.color === 'automatic' ? 'var(--ui-wall-color, #58B1FC)' : theme.color;
    thumbnail.appendChild(colorBox);

    themeItem.appendChild(thumbnail);

    // Create theme name with save button if unsaved
    const nameContainer = document.createElement('div');
    nameContainer.className = 'theme-name-container';

    const themeName = document.createElement('div');
    themeName.className = 'theme-name';
    themeName.textContent = theme.name;
    nameContainer.appendChild(themeName);

    if (isUnsaved) {
        const saveButton = document.createElement('button');
        saveButton.className = 'save-theme-button';
        saveButton.textContent = 'Save theme';
        saveButton.addEventListener('click', (e) => {
            e.stopPropagation();
            saveUnsavedTheme();
        });
        nameContainer.appendChild(saveButton);
    }

    // Add delete button for custom themes
    if (theme.type === 'custom') {
        const deleteButton = document.createElement('button');
        deleteButton.className = 'delete-theme-button';
        deleteButton.textContent = 'Delete';
        deleteButton.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteCustomTheme(theme.id);
        });
        nameContainer.appendChild(deleteButton);
    }

    themeItem.appendChild(nameContainer);

    // Add click handler to select theme
    themeItem.addEventListener('click', () => {
        selectTheme(theme.id).catch(error => {
            console.error('Failed to select theme:', error);
        });
    });

    return themeItem;
}

// Select a theme
async function selectTheme(themeId) {
    console.log('Selecting theme:', themeId);

    if (themeId === SYNCED_THEME_ID) {
        await loadSyncedTheme({ forceRefresh: true });
    }

    const theme = resolveTheme(themeId);
    if (!theme) {
        console.error('Theme not found:', themeId);
        return;
    }

    console.log('Applying theme:', theme);

    // Update current theme
    state.currentTheme = themeId;

    // Apply theme settings
    applyTheme(theme);

    // Update UI
    updateThemeSelection();
    updateActionButtons();

    // Save settings
    saveSettings();
}

// Apply a theme (wallpaper + color)
function applyTheme(theme) {
    theme = normalizeTheme(theme) || theme;
    console.log('applyTheme called with:', theme);

    if (!theme || !Array.isArray(theme.wallpapers) || theme.wallpapers.length === 0) {
        console.warn('[Personalization] Cannot apply theme without wallpapers:', theme);
        return;
    }

    // IMPORTANT: Apply color FIRST before wallpaper to prevent override
    const targetColor = theme.color;
    const wallpaperTypes = normalizeWallpaperTypes(theme.wallpapers, theme.wallpaperTypes);
    const currentWallpaperType = wallpaperTypes[0] || inferWallpaperType(theme.wallpapers[0]);
    const currentLocation = normalizeString(theme.currentLocation) || state.currentLocation || 'windows';

    // Save to BOTH color registries to prevent wallpaper extractor from overriding
    personalizationSaveColorSettings({ selectedColor: targetColor });

    // Also save to ControlPanelColorRegistry so wallpaper extractor respects the theme color
    if (targetColor === 'automatic') {
        if (ControlPanelColorRegistry && typeof ControlPanelColorRegistry.saveControlPanelColor === 'function') {
            ControlPanelColorRegistry.saveControlPanelColor({ mode: 'automatic' });
        }
    } else {
        if (ControlPanelColorRegistry && typeof ControlPanelColorRegistry.saveControlPanelColor === 'function') {
            ControlPanelColorRegistry.saveControlPanelColor({ mode: 'custom', color: targetColor });
        }
    }

    // Apply color to UI (current window, parent, and top)
    applyColorToUI(targetColor);

    // Update state immediately (before async wallpaper application)
    state.currentTheme = theme.id;
    state.currentColor = targetColor;
    state.currentWallpaper = [...theme.wallpapers];
    state.currentWallpaperTypes = [...wallpaperTypes];
    state.currentWallpaperType = currentWallpaperType;
    state.currentLocation = currentLocation;

    // CRITICAL: Ensure registry write is complete before applying wallpaper
    // Use a small delay to ensure color settings are saved before wallpaper extraction
    const applyWallpaperAfterColorSaved = async () => {
        // Now apply wallpaper
        const wallpaperSettings = {
            selectedWallpapers: theme.wallpapers,
            selectedWallpapersTypes: wallpaperTypes,
            currentWallpaper: theme.wallpapers[0],
            currentWallpaperType,
            picturePosition: 'fill',
            changeInterval: '30m',
            shuffle: false,
            pauseOnBattery: false,
            customFolders: [],
            currentLocation
        };

        const controller = getWallpaperController();
        const normalized = controller && typeof controller.saveSettings === 'function'
            ? await controller.saveSettings(wallpaperSettings, {
                withCrossfade: true,
                reason: 'theme-apply'
            })
            : saveDesktopBackgroundSettings(wallpaperSettings);
        state.currentWallpaper = [...normalized.selectedWallpapers];
        state.currentWallpaperTypes = normalizeWallpaperTypes(normalized.selectedWallpapers, normalized.selectedWallpapersTypes);
        state.currentWallpaperType = normalized.currentWallpaperType === 'custom' ? 'custom' : inferWallpaperType(normalized.currentWallpaper);
        state.currentLocation = normalizeString(normalized.currentLocation) || currentLocation;
        console.log('Saved wallpaper settings to registry');

        // If the color is not automatic, re-apply it after wallpaper to ensure it sticks
        // Use multiple timeouts to combat async color extraction
        if (theme.color !== 'automatic') {
            console.log('Re-applying custom color after wallpaper to prevent override');

            // Re-apply immediately
            setTimeout(() => {
                applyColorToUI(theme.color);
            }, 50);

            // Re-apply after color extraction might happen
            setTimeout(() => {
                applyColorToUI(theme.color);
            }, 200);

            // Final re-apply to ensure it sticks
            setTimeout(() => {
                applyColorToUI(theme.color);
                console.log('Final color re-application complete');
            }, 500);
        }

        // State was already updated before this timeout
    };

    // Call the wallpaper application after a small delay to ensure color is saved
    setTimeout(() => {
        applyWallpaperAfterColorSaved().catch(error => {
            console.error('Failed to apply theme wallpaper:', error);
        });
    }, 10);
}

// Apply color to UI across all windows
function applyColorToUI(color) {
    if (color === 'automatic') {
        // For automatic, we rely on the wallpaper color extraction
        // which happens in applyDesktopWallpaper
        return;
    }

    // Set CSS variable in current document
    applyWallColorVariables(color, window);

    // Try to set in parent window
    if (window.parent && window.parent !== window) {
        try {
            applyWallColorVariables(color, window.parent);
        } catch (e) {
            console.warn('Could not set color in parent window:', e);
        }
    }

    // Try to set in top window
    if (window.top && window.top !== window) {
        try {
            applyWallColorVariables(color, window.top);
        } catch (e) {
            console.warn('Could not set color in top window:', e);
        }
    }
}

// Update theme selection UI
function updateThemeSelection() {
    // Remove selected class from all themes
    document.querySelectorAll('.theme-item').forEach(item => {
        item.classList.remove('selected');
    });

    // Add selected class to current theme
    const currentThemeElement = document.querySelector(`.theme-item[data-theme-id="${state.currentTheme}"]`);
    if (currentThemeElement) {
        currentThemeElement.classList.add('selected');
    }
}

// Check for settings changes (called periodically and on focus)
function checkForSettingsChanges() {
    let wallpaperChanged = false;
    let wallpaperTypeChanged = false;
    let colorChanged = false;
    let wallColorChanged = false;

    console.log('checkForSettingsChanges - checking registry');

    try {
        const bgSettings = loadCurrentWallpaperSettings();
        const newWallpaper = Array.isArray(bgSettings.selectedWallpapers) && bgSettings.selectedWallpapers.length > 0
            ? bgSettings.selectedWallpapers
            : (bgSettings.currentWallpaper ? [bgSettings.currentWallpaper] : null);
        const newWallpaperTypes = Array.isArray(bgSettings.selectedWallpapers) && bgSettings.selectedWallpapers.length > 0
            ? normalizeWallpaperTypes(bgSettings.selectedWallpapers, bgSettings.selectedWallpapersTypes)
            : (bgSettings.currentWallpaper ? [bgSettings.currentWallpaperType === 'custom' ? 'custom' : inferWallpaperType(bgSettings.currentWallpaper)] : []);

        console.log('Current wallpaper in state:', state.currentWallpaper);
        console.log('New wallpaper from registry:', newWallpaper);

        if (!wallpaperListsMatch(newWallpaper, state.currentWallpaper)) {
            console.log('Wallpaper CHANGED!');
            state.currentWallpaper = newWallpaper ? [...newWallpaper] : null;
            wallpaperChanged = true;
        }

        if (!wallpaperTypesMatch(newWallpaperTypes, state.currentWallpaperTypes)) {
            state.currentWallpaperTypes = [...newWallpaperTypes];
            state.currentWallpaperType = newWallpaperTypes[0] || 'builtin';
            wallpaperTypeChanged = true;
        }

        state.currentLocation = normalizeString(bgSettings.currentLocation) || state.currentLocation || 'windows';
    } catch (error) {
        console.error('Failed to read wallpaper settings when checking for changes:', error);
    }

    try {
        const colorSettings = personalizationLoadColorSettings();
        const newColor = colorSettings.selectedColor === 'custom' && colorSettings.customColor
            ? colorSettings.customColor
            : 'automatic';

        console.log('Current color in state:', state.currentColor);
        console.log('New color from registry:', newColor);

        if (newColor !== state.currentColor) {
            console.log('Color CHANGED!');
            state.currentColor = newColor;
            colorChanged = true;
        }
    } catch (error) {
        console.error('Failed to read color settings when checking for changes:', error);
    }

    try {
        const wallColorSettings = loadControlPanelColorSettings();
        const newMode = wallColorSettings.mode;
        const newWallColor = wallColorSettings.mode === 'custom' ? wallColorSettings.color : null;

        if (newMode !== state.currentWallColorMode || newWallColor !== state.currentWallColor) {
            state.currentWallColorMode = newMode;
            state.currentWallColor = newWallColor;
            wallColorChanged = true;
        }
    } catch (error) {
        console.error('Failed to read wall color settings when checking for changes:', error);
    }

    console.log('wallpaperChanged:', wallpaperChanged, 'wallpaperTypeChanged:', wallpaperTypeChanged, 'colorChanged:', colorChanged);
    console.log('state.currentTheme:', state.currentTheme);

    // If wallpaper or color changed and we have a theme selected, create unsaved theme
    if ((wallpaperChanged || wallpaperTypeChanged || colorChanged) && state.currentTheme) {
        console.log('Calling checkForUnsavedTheme because settings changed');
        checkForUnsavedTheme();
    }

    // Update action buttons
    if (wallpaperChanged || wallpaperTypeChanged || colorChanged) {
        updateActionButtons();
    }

    if (wallColorChanged) {
        updateColorButton();
    }
}

// Handle storage changes from other pages (fallback)
function handleStorageChange() {
    checkForSettingsChanges();
}

// Check if current settings match the selected theme, create unsaved theme if not
function checkForUnsavedTheme() {
    console.log('checkForUnsavedTheme called');
    console.log('Current theme:', state.currentTheme);
    console.log('Current wallpaper:', state.currentWallpaper);
    console.log('Current color:', state.currentColor);

    if (!state.currentTheme) return;

    // If we're already on unsaved theme, just update it
    if (state.currentTheme === 'unsaved') {
        console.log('Already on unsaved theme, updating it');
        createUnsavedTheme();
        return;
    }

    // Get current theme
    const currentTheme = resolveTheme(state.currentTheme);

    if (!currentTheme) return;

    console.log('Comparing with theme:', currentTheme);

    // Check if settings match
    const wallpapersMatch = wallpaperListsMatch(currentTheme.wallpapers, state.currentWallpaper);
    const typesMatch = wallpaperTypesMatch(currentTheme.wallpaperTypes, state.currentWallpaperTypes);
    const colorMatch = currentTheme.color === state.currentColor;

    console.log('Wallpapers match:', wallpapersMatch);
    console.log('Wallpaper types match:', typesMatch);
    console.log('Color match:', colorMatch);

    if (!wallpapersMatch || !typesMatch || !colorMatch) {
        // Create unsaved theme
        console.log('Settings differ, creating unsaved theme');
        createUnsavedTheme();
    } else {
        // Settings match, remove unsaved theme if it exists
        if (state.unsavedTheme) {
            console.log('Settings match, removing unsaved theme');
            state.unsavedTheme = null;
            saveSettings();
            renderCustomThemes();
        }
    }
}

// Create an unsaved theme
function createUnsavedTheme() {
    const isUpdating = state.unsavedTheme !== null;
    console.log(isUpdating ? 'UPDATING existing unsaved theme' : 'CREATING new unsaved theme');
    console.log('With wallpaper:', state.currentWallpaper, 'and color:', state.currentColor);

    state.unsavedTheme = {
        id: 'unsaved',
        name: 'Unsaved theme',
        wallpapers: state.currentWallpaper || [],
        wallpaperTypes: [...state.currentWallpaperTypes],
        color: state.currentColor || 'automatic',
        type: 'unsaved',
        currentLocation: state.currentLocation || 'windows'
    };

    console.log('Unsaved theme ' + (isUpdating ? 'updated' : 'created') + ':', state.unsavedTheme);

    // Update current theme to unsaved
    state.currentTheme = 'unsaved';

    saveSettings();
    renderCustomThemes();
    updateThemeSelection();
    updateActionButtons();

    console.log('My Themes section should now be ' + (isUpdating ? 'updated' : 'visible'));
}

// Save the unsaved theme as a custom theme
function saveUnsavedTheme() {
    if (!state.unsavedTheme) return;

    // Prompt for theme name
    const themeName = prompt('Enter a name for your theme:', 'My Custom Theme');
    if (!themeName) return;

    // Create custom theme from unsaved theme
    const customTheme = {
        id: 'custom_' + Date.now(),
        name: themeName,
        wallpapers: state.unsavedTheme.wallpapers,
        wallpaperTypes: normalizeWallpaperTypes(state.unsavedTheme.wallpapers, state.unsavedTheme.wallpaperTypes),
        color: state.unsavedTheme.color,
        type: 'custom',
        currentLocation: normalizeString(state.unsavedTheme.currentLocation) || state.currentLocation || 'windows'
    };

    // Add to custom themes
    state.customThemes.push(customTheme);

    // Update current theme
    state.currentTheme = customTheme.id;

    // Clear unsaved theme
    state.unsavedTheme = null;

    // Save and re-render
    saveSettings();
    renderCustomThemes();
    updateThemeSelection();
}

// Delete a custom theme
function deleteCustomTheme(themeId) {
    if (!confirm('Are you sure you want to delete this theme?')) return;

    // Remove from custom themes
    state.customThemes = state.customThemes.filter(t => t.id !== themeId);

    // If this was the current theme, switch to Windows default
    if (state.currentTheme === themeId) {
        selectTheme('windows');
    }

    // Save and re-render
    saveSettings();
    renderCustomThemes();
}

// Update action buttons with current settings
function updateActionButtons() {
    console.log('updateActionButtons called - current wallpaper:', state.currentWallpaper, 'current accent:', state.currentColor, 'wall color mode:', state.currentWallColorMode, 'wall color:', state.currentWallColor);
    updateDesktopBackgroundButton();
    updateColorButton();
}

// Update desktop background button
function updateDesktopBackgroundButton() {
    const desktopBgIcon = document.querySelector('.action-icon.desktop-bg .icon-preview');
    const desktopBgSubtitle = document.querySelector('.action-icon-item:nth-child(1) .action-subtitle');

    if (!desktopBgIcon || !desktopBgSubtitle) return;

    const wallpapers = Array.isArray(state.currentWallpaper)
        ? state.currentWallpaper
        : (typeof state.currentWallpaper === 'string' && state.currentWallpaper.length
            ? [state.currentWallpaper]
            : []);

    if (wallpapers.length > 0) {
        if (wallpapers.length === 1) {
            // Single wallpaper
            const wallpaperEntry = wallpapers[0];
            const wallpaperPath = wallpaperEntry.startsWith('resources/') || wallpaperEntry.startsWith('file://') || /^[a-zA-Z]:\\/.test(wallpaperEntry)
                ? wallpaperEntry
                : `${WALLPAPERS_BASE_PATH}${wallpaperEntry}`;
            const previewPath = toPreviewAssetUrl(wallpaperPath);
            console.log('updateDesktopBackgroundButton: Setting single wallpaper to:', previewPath);
            desktopBgIcon.style.backgroundImage = `url('${previewPath}')`;
            desktopBgIcon.style.backgroundSize = 'cover';
            desktopBgIcon.style.backgroundPosition = 'center';

            // Extract filename without extension
            const filename = wallpaperEntry.split(/[\\/]/).pop().replace(/\.[^/.]+$/, '');
            const isSyncedWallpaper = state.currentTheme === SYNCED_THEME_ID && state.currentWallpaperTypes[0] === 'custom';
            desktopBgSubtitle.textContent = isSyncedWallpaper ? 'Synced wallpaper' : filename;
        } else {
            // Multiple wallpapers - create stack
            desktopBgIcon.innerHTML = '';
            desktopBgIcon.style.position = 'relative';

            const stackCount = Math.min(wallpapers.length, 3);

            for (let i = 0; i < stackCount; i++) {
                const layer = document.createElement('div');
                layer.className = 'wallpaper-stack-layer';
                const wallpaperEntry = wallpapers[i];
                const wallpaperPath = wallpaperEntry.startsWith('resources/') || wallpaperEntry.startsWith('file://') || /^[a-zA-Z]:\\/.test(wallpaperEntry)
                    ? wallpaperEntry
                    : `${WALLPAPERS_BASE_PATH}${wallpaperEntry}`;
                layer.style.backgroundImage = `url('${toPreviewAssetUrl(wallpaperPath)}')`;
                layer.style.backgroundSize = 'cover';
                layer.style.backgroundPosition = 'center';
                layer.style.position = 'absolute';
                layer.style.width = '100%';
                layer.style.height = '100%';
                layer.style.border = '1px solid #ccc';
                layer.style.zIndex = stackCount - i;

                // Offset each layer
                const offset = i * 2;
                layer.style.top = `${offset}px`;
                layer.style.left = `${offset}px`;
                layer.style.width = `calc(100% - ${offset}px)`;
                layer.style.height = `calc(100% - ${offset}px)`;

                desktopBgIcon.appendChild(layer);
            }

            desktopBgSubtitle.textContent = 'Slide Show';
        }

        // Add color indicator
        if (state.currentColor && state.currentColor !== 'automatic') {
            let colorIndicator = desktopBgIcon.querySelector('.button-color-indicator');
            if (!colorIndicator) {
                colorIndicator = document.createElement('div');
                colorIndicator.className = 'button-color-indicator';
                desktopBgIcon.appendChild(colorIndicator);
            }
            colorIndicator.style.backgroundColor = state.currentColor;
        }
    } else {
        desktopBgIcon.style.backgroundImage = '';
        desktopBgIcon.innerHTML = '';
        desktopBgIcon.removeAttribute('style');
        const indicator = desktopBgIcon.querySelector('.button-color-indicator');
        if (indicator) {
            indicator.remove();
        }
        desktopBgSubtitle.textContent = 'Harmony';
    }
}

// Update color button
function updateColorButton() {
    const colorPreview = document.querySelector('.action-icon.color .color-preview');
    const colorSubtitle = document.querySelector('.action-icon-item:nth-child(2) .action-subtitle');

    if (!colorPreview || !colorSubtitle) return;

    if (state.currentWallColorMode !== 'custom' || !state.currentWallColor) {
        colorPreview.style.background = 'linear-gradient(135deg, #f5a623 0%, #f5a623 50%, var(--ui-wall-color, #0078d7) 50%, var(--ui-wall-color, #0078d7) 100%)';
        colorPreview.style.borderRadius = '0';
        colorPreview.style.width = '50px';
        colorPreview.style.height = '50px';
        colorPreview.style.boxShadow = 'inset 0 0 0 1px #999999, inset 0 0 0 2px #ffffff99';
        colorPreview.style.position = 'relative';

        let autoLabel = colorPreview.querySelector('.auto-label');
        if (!autoLabel) {
            autoLabel = document.createElement('div');
            autoLabel.className = 'auto-label';
            autoLabel.textContent = 'A';
            autoLabel.style.position = 'absolute';
            autoLabel.style.top = '50%';
            autoLabel.style.left = '50%';
            autoLabel.style.transform = 'translate(-50%, -50%)';
            autoLabel.style.color = '#fff';
            autoLabel.style.fontWeight = '600';
            autoLabel.style.fontSize = '24px';
            autoLabel.style.textShadow = '0 1px 2px rgba(0,0,0,0.5)';
            autoLabel.style.pointerEvents = 'none';
            colorPreview.appendChild(autoLabel);
        }

        colorSubtitle.textContent = 'Automatic';
    } else {
        colorPreview.style.background = state.currentWallColor;
        colorPreview.style.borderRadius = '0';
        colorPreview.style.width = '50px';
        colorPreview.style.height = '50px';
        colorPreview.style.boxShadow = 'inset 0 0 0 1px #999999, inset 0 0 0 2px #ffffff99';
        colorPreview.style.position = 'relative';

        const autoLabel = colorPreview.querySelector('.auto-label');
        if (autoLabel) {
            autoLabel.remove();
        }

        colorSubtitle.textContent = 'Custom color';
    }
}

// Setup event listeners
function setupEventListeners() {
    // Theme item clicks are handled in createThemeElement

    // Action button clicks are already handled in the HTML

    window.addEventListener('message', (event) => {
        const data = event?.data;
        if (!data || typeof data !== 'object') {
            return;
        }

        if (data.action === 'wallpaperSettingsChanged') {
            console.log('[Personalization] Received wallpaper settings change message');
            checkForSettingsChanges();
            return;
        }

        if (data.action === 'colorSettingsChanged') {
            console.log('[Personalization] Received color settings change message');
            try {
                const wallColorSettings = loadControlPanelColorSettings();
                state.currentWallColorMode = wallColorSettings.mode;
                state.currentWallColor = wallColorSettings.mode === 'custom' ? wallColorSettings.color : null;
                updateColorButton();
            } catch (error) {
                console.error('Failed to refresh control panel color state:', error);
            }
            checkForSettingsChanges();
        }
    });
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
