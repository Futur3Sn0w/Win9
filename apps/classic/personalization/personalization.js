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

const WALLPAPERS_BASE_PATH = '../../../resources/images/wallpapers/';

// Define the default Windows themes
const defaultThemes = {
    windows: {
        id: 'windows',
        name: 'Windows',
        wallpapers: ['Windows/img0.jpg'],
        color: '#58B1FC', // Blue from available colors
        type: 'default'
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
        color: '#47CF74', // Green from available colors
        type: 'default'
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
        color: '#F359A8', // Magenta from available colors
        type: 'default'
    }
};

// State management
let state = {
    currentTheme: null, // Current selected theme ID
    customThemes: [], // User-saved custom themes
    unsavedTheme: null, // Temporary unsaved theme when user modifies settings
    currentWallpaper: null, // Current wallpaper setting from desktop-background
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
    state.customThemes = Array.isArray(themeSettings.customThemes) ? cloneDeep(themeSettings.customThemes) : [];
    state.unsavedTheme = themeSettings.unsavedTheme ? cloneDeep(themeSettings.unsavedTheme) : null;

    // Load current wallpaper settings
    try {
        const bgSettings = loadCurrentWallpaperSettings();
        if (Array.isArray(bgSettings.selectedWallpapers) && bgSettings.selectedWallpapers.length > 0) {
            state.currentWallpaper = [...bgSettings.selectedWallpapers];
        } else if (bgSettings.currentWallpaper) {
            state.currentWallpaper = [bgSettings.currentWallpaper];
        } else {
            state.currentWallpaper = null;
        }
    } catch (error) {
        console.error('Failed to load desktop background settings from registry:', error);
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
        const wallpapersMatch = JSON.stringify(state.unsavedTheme.wallpapers) === JSON.stringify(state.currentWallpaper);
        const colorMatch = state.unsavedTheme.color === state.currentColor;

        if (!wallpapersMatch || !colorMatch) {
            console.log('Loaded unsaved theme is outdated, updating it with current settings');
            console.log('Old unsaved theme wallpapers:', state.unsavedTheme.wallpapers, 'New:', state.currentWallpaper);
            console.log('Old unsaved theme color:', state.unsavedTheme.color, 'New:', state.currentColor);

            // Update the unsaved theme with current wallpaper/color
            state.unsavedTheme.wallpapers = state.currentWallpaper || [];
            state.unsavedTheme.color = state.currentColor || 'automatic';
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
    console.log('state.customThemes:', state.customThemes);

    // Get the My themes section (now in HTML)
    const myThemesSection = document.querySelector('.theme-section.my-themes');
    if (!myThemesSection) {
        console.error('My Themes section not found in HTML!');
        return;
    }

    // Only show the section if there are custom themes or an unsaved theme
    const hasThemes = state.customThemes.length > 0 || state.unsavedTheme;
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
    const themeCount = (state.unsavedTheme ? 1 : 0) + state.customThemes.length;
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
        const wallpaperPath = `${WALLPAPERS_BASE_PATH}${theme.wallpapers[0]}`;
        console.log('Setting single wallpaper thumbnail to:', wallpaperPath);
        thumbnail.style.backgroundImage = `url('${wallpaperPath}')`;
        thumbnail.style.backgroundSize = 'cover';
        thumbnail.style.backgroundPosition = 'center';
    } else {
        // Stacked wallpapers (show up to 3)
        const stackCount = Math.min(theme.wallpapers.length, 3);
        thumbnail.classList.add('stacked');

        for (let i = 0; i < stackCount; i++) {
            const layer = document.createElement('div');
            layer.className = 'stack-layer';
            layer.style.backgroundImage = `url('${WALLPAPERS_BASE_PATH}${theme.wallpapers[i]}')`;
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
        selectTheme(theme.id);
    });

    return themeItem;
}

// Select a theme
function selectTheme(themeId) {
    console.log('Selecting theme:', themeId);

    // Find the theme
    let theme = null;

    if (defaultThemes[themeId]) {
        theme = defaultThemes[themeId];
    } else if (state.unsavedTheme && state.unsavedTheme.id === themeId) {
        theme = state.unsavedTheme;
    } else {
        theme = state.customThemes.find(t => t.id === themeId);
    }

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
    console.log('applyTheme called with:', theme);

    // IMPORTANT: Apply color FIRST before wallpaper to prevent override
    const targetColor = theme.color;

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
    state.currentColor = targetColor;
    state.currentWallpaper = theme.wallpapers;

    // CRITICAL: Ensure registry write is complete before applying wallpaper
    // Use a small delay to ensure color settings are saved before wallpaper extraction
    const applyWallpaperAfterColorSaved = async () => {
        // Now apply wallpaper
        const wallpaperSettings = {
            selectedWallpapers: theme.wallpapers,
            selectedWallpapersTypes: theme.wallpapers.map(() => 'builtin'),
            currentWallpaper: theme.wallpapers[0],
            currentWallpaperType: 'builtin',
            picturePosition: 'fill',
            changeInterval: '30m',
            shuffle: false,
            pauseOnBattery: false,
            customFolders: [],
            currentLocation: 'windows'
        };

        const controller = getWallpaperController();
        const normalized = controller && typeof controller.saveSettings === 'function'
            ? await controller.saveSettings(wallpaperSettings, {
                withCrossfade: true,
                reason: 'theme-apply'
            })
            : saveDesktopBackgroundSettings(wallpaperSettings);
        state.currentWallpaper = [...normalized.selectedWallpapers];
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
    document.documentElement.style.setProperty('--ui-wall-color', color);

    // Try to set in parent window
    if (window.parent && window.parent !== window) {
        try {
            window.parent.document.documentElement.style.setProperty('--ui-wall-color', color);
        } catch (e) {
            console.warn('Could not set color in parent window:', e);
        }
    }

    // Try to set in top window
    if (window.top && window.top !== window) {
        try {
            window.top.document.documentElement.style.setProperty('--ui-wall-color', color);
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
    let colorChanged = false;
    let wallColorChanged = false;

    console.log('checkForSettingsChanges - checking registry');

    try {
        const bgSettings = loadCurrentWallpaperSettings();
        const newWallpaper = Array.isArray(bgSettings.selectedWallpapers) && bgSettings.selectedWallpapers.length > 0
            ? bgSettings.selectedWallpapers
            : (bgSettings.currentWallpaper ? [bgSettings.currentWallpaper] : null);

        console.log('Current wallpaper in state:', state.currentWallpaper);
        console.log('New wallpaper from registry:', newWallpaper);

        if (JSON.stringify(newWallpaper) !== JSON.stringify(state.currentWallpaper)) {
            console.log('Wallpaper CHANGED!');
            state.currentWallpaper = newWallpaper ? [...newWallpaper] : null;
            wallpaperChanged = true;
        }
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

    console.log('wallpaperChanged:', wallpaperChanged, 'colorChanged:', colorChanged);
    console.log('state.currentTheme:', state.currentTheme);

    // If wallpaper or color changed and we have a theme selected, create unsaved theme
    if ((wallpaperChanged || colorChanged) && state.currentTheme) {
        console.log('Calling checkForUnsavedTheme because settings changed');
        checkForUnsavedTheme();
    }

    // Update action buttons
    if (wallpaperChanged || colorChanged) {
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
    let currentTheme = null;
    if (defaultThemes[state.currentTheme]) {
        currentTheme = defaultThemes[state.currentTheme];
    } else {
        currentTheme = state.customThemes.find(t => t.id === state.currentTheme);
    }

    if (!currentTheme) return;

    console.log('Comparing with theme:', currentTheme);

    // Check if settings match
    const wallpapersMatch = JSON.stringify(currentTheme.wallpapers) === JSON.stringify(state.currentWallpaper);
    const colorMatch = currentTheme.color === state.currentColor;

    console.log('Wallpapers match:', wallpapersMatch);
    console.log('Color match:', colorMatch);

    if (!wallpapersMatch || !colorMatch) {
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
        color: state.currentColor || 'automatic',
        type: 'unsaved'
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
        color: state.unsavedTheme.color,
        type: 'custom'
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
            desktopBgSubtitle.textContent = filename;
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
