// Color Settings
(function () {
    'use strict';

    function getWallpaperController() {
        const contexts = [window, window.parent, window.top];
        for (const ctx of contexts) {
            try {
                if (ctx && ctx.WallpaperController) {
                    return ctx.WallpaperController;
                }
            } catch (error) {
                console.warn('[Colors] Could not access wallpaper controller:', error);
            }
        }
        return null;
    }

    function resolveWallColorRegistry() {
        const contexts = [window, window.parent, window.top];
        for (const ctx of contexts) {
            if (ctx && ctx.ControlPanelColorRegistry) {
                return ctx.ControlPanelColorRegistry;
            }
        }

        if (typeof window.require === 'function') {
            try {
                const module = window.require('../../../registry/control-panel-color-registry.js');
                window.ControlPanelColorRegistry = module;
                return module;
            } catch (error) {
                console.warn('[Colors] Could not require control-panel-color-registry.js:', error);
            }
        }

        return null;
    }

    const WallColorRegistry = resolveWallColorRegistry();

    // Available colors (excluding automatic)
    const availableColors = [
        '#ABABAB',
        '#8ACFFF',
        '#F598D6',
        '#F3D240',
        '#ADD85F',
        '#78D9D9',
        '#FFAF51',
        '#FF6F6F',
        '#F359A8',
        '#47CF74',
        '#C48AFF',
        '#58B1FC',
        '#9898FF',
        '#C3B5A8',
        '#FCFCFC'
    ];

    // State management
    let state = {
        selectedColorMode: 'automatic', // 'automatic' or 'custom'
        selectedColor: null, // Hex string when mode is custom
        originalWallpaperColor: null, // Store the original wallpaper color
        savedState: null
    };

    // DOM elements
    let elements = {};

    // Initialize
    function init() {
        // Cache DOM elements
        elements.colorsGrid = document.getElementById('colors-grid');
        elements.saveButton = document.getElementById('save-button');
        elements.cancelButton = document.getElementById('cancel-button');

        // Load saved settings or defaults
        loadSavedSettings();

        // Store the original wallpaper color
        storeOriginalWallpaperColor();

        // Apply the saved color on load
        if (state.selectedColorMode === 'custom' && state.selectedColor) {
            applyColor(state.selectedColor);
        } else {
            applyColor(state.originalWallpaperColor);
        }

        // Save initial state for cancel functionality
        saveCurrentState();

        // Render color boxes
        renderColors();

        // Bind events
        bindEvents();

        // Notify parent window that we've loaded
        notifyParentPageLoaded();
    }

    // Notify parent Control Panel that the page has loaded
    function notifyParentPageLoaded() {
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({
                action: 'subPageLoaded',
                page: 'colors',
                title: 'Color'
            }, '*');
        }
    }

    // Navigate back to personalization page
    function navigateBack() {
        if (window.parent && window.parent !== window) {
            // We're in an iframe, send message to parent
            window.parent.postMessage({
                action: 'navigateBack'
            }, '*');
        } else {
            // Standalone mode, just navigate
            window.location.href = 'personalization.html';
        }
    }

    // Load saved settings from registry
    function loadSavedSettings() {
        try {
            if (WallColorRegistry && typeof WallColorRegistry.loadControlPanelColor === 'function') {
                const settings = WallColorRegistry.loadControlPanelColor();
                state.selectedColorMode = settings.mode;
                state.selectedColor = settings.mode === 'custom' ? settings.color : null;
            } else {
                state.selectedColorMode = 'automatic';
                state.selectedColor = null;
            }
        } catch (e) {
            console.error('Failed to load color settings:', e);
            state.selectedColorMode = 'automatic';
            state.selectedColor = null;
        }
    }

    // Store the original wallpaper color from CSS variable
    function storeOriginalWallpaperColor() {
        let resolvedColor = null;

        const resolveFromExtractor = () => {
            const candidates = [window, window.parent, window.top].filter(ctx => ctx && ctx !== window);
            candidates.unshift(window);

            for (const ctx of candidates) {
                try {
                    const extractor = ctx.WallpaperColorExtractor;
                    if (extractor && extractor.dominantColor) {
                        if (typeof extractor.rgbToString === 'function') {
                            return extractor.rgbToString(extractor.dominantColor);
                        }
                        const { r, g, b } = extractor.dominantColor;
                        if (typeof r === 'number' && typeof g === 'number' && typeof b === 'number') {
                            return `rgb(${r}, ${g}, ${b})`;
                        }
                    }
                } catch (error) {
                    console.warn('Unable to access wallpaper color extractor:', error);
                }
            }
            return null;
        };

        resolvedColor = resolveFromExtractor();

        if (!resolvedColor) {
            const stylesToCheck = [];
            try {
                stylesToCheck.push(getComputedStyle(document.documentElement));
            } catch {}
            if (window.parent && window.parent !== window) {
                try {
                    stylesToCheck.push(getComputedStyle(window.parent.document.documentElement));
                } catch (error) {
                    console.warn('Could not access parent wallpaper color:', error);
                }
            }
            if (window.top && window.top !== window) {
                try {
                    stylesToCheck.push(getComputedStyle(window.top.document.documentElement));
                } catch (error) {
                    console.warn('Could not access top wallpaper color:', error);
                }
            }

            for (const style of stylesToCheck) {
                const candidate = style.getPropertyValue('--ui-wall-color').trim();
                if (candidate) {
                    resolvedColor = candidate;
                    break;
                }
            }
        }

        state.originalWallpaperColor = resolvedColor || '#0078d7';
    }

    // Save current state for cancel functionality
    function saveCurrentState() {
        state.savedState = {
            selectedColorMode: state.selectedColorMode,
            selectedColor: state.selectedColor,
            originalWallpaperColor: state.originalWallpaperColor
        };
    }

    // Render color boxes
    function renderColors() {
        elements.colorsGrid.innerHTML = '';

        // Create automatic color box
        const automaticBox = createColorBox('automatic', null);
        elements.colorsGrid.appendChild(automaticBox);

        // Create color boxes for each available color
        availableColors.forEach(color => {
            const colorBox = createColorBox('color', color);
            elements.colorsGrid.appendChild(colorBox);
        });
    }

    // Create a color box element
    function createColorBox(type, color) {
        const box = document.createElement('div');
        box.className = 'color-box';

        if (type === 'automatic') {
            box.classList.add('automatic');
            box.dataset.type = 'automatic';

            // Check if automatic is selected
            if (state.selectedColorMode !== 'custom') {
                box.classList.add('selected');
            }
        } else {
            box.style.backgroundColor = color;
            box.dataset.type = 'color';
            box.dataset.color = color;

            // Check if this color is selected
            if (state.selectedColorMode === 'custom' && state.selectedColor === color) {
                box.classList.add('selected');
            }
        }

        // Click handler
        box.addEventListener('click', () => {
            handleColorClick(box, type, color);
        });

        return box;
    }

    // Handle color box click
    function handleColorClick(box, type, color) {
        // Remove selected class from all boxes
        document.querySelectorAll('.color-box').forEach(el => {
            el.classList.remove('selected');
        });

        // Add selected class to clicked box
        box.classList.add('selected');

        // Update state
        if (type === 'automatic') {
            state.selectedColorMode = 'automatic';
            state.selectedColor = null;
            // Apply the original wallpaper color
            applyColor(state.originalWallpaperColor);
        } else {
            state.selectedColorMode = 'custom';
            state.selectedColor = color;
            // Apply the selected color
            applyColor(color);
        }
    }

    // Apply color to UI
    function applyColor(color) {
        if (!color) {
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

        console.log('Applied color:', color);
    }

    // Bind event listeners
    function bindEvents() {
        // Save button
        elements.saveButton.addEventListener('click', () => {
            saveSettings();
            saveCurrentState(); // Update saved state after saving
            // Navigate back to personalization page
            navigateBack();
        });

        // Cancel button
        elements.cancelButton.addEventListener('click', () => {
            restoreSavedState();
            // Navigate back to personalization page
            navigateBack();
        });
    }

    // Save settings to registry
    function saveSettings() {
        try {
            if (state.selectedColorMode !== 'custom' || !state.selectedColor) {
                if (WallColorRegistry && typeof WallColorRegistry.saveControlPanelColor === 'function') {
                    WallColorRegistry.saveControlPanelColor({ mode: 'automatic' });
                }

                // Re-extract the wallpaper color if possible
                extractAndApplyWallpaperColor();
            } else {
                if (WallColorRegistry && typeof WallColorRegistry.saveControlPanelColor === 'function') {
                    WallColorRegistry.saveControlPanelColor({
                        mode: 'custom',
                        color: state.selectedColor
                    });
                }

                // Apply the selected color
                applyColor(state.selectedColor);
            }

            const message = { action: 'colorSettingsChanged' };
            if (window.parent && window.parent !== window) {
                window.parent.postMessage(message, '*');
            } else if (window.top && window.top !== window) {
                try {
                    window.top.postMessage(message, '*');
                } catch (error) {
                    console.warn('Unable to notify parent about color change:', error);
                }
            }
        } catch (e) {
            console.error('Failed to save color settings:', e);
            systemDialog.error('Failed to save color settings. Please try again.', 'Color');
        }
    }

    // Extract wallpaper color and apply it
    function extractAndApplyWallpaperColor() {
        // Try to access the WallpaperColorExtractor from the main window
        let colorExtractor = null;
        let currentWallpaper = null;
        const controller = getWallpaperController();

        if (controller && typeof controller.getCurrentFullPath === 'function') {
            currentWallpaper = controller.getCurrentFullPath();
        }

        // Get the current wallpaper path
        if (window.parent && window.parent !== window) {
            try {
                const wallpaperEl = window.parent.document.getElementById('desktop-wallpaper');
                if (!currentWallpaper && wallpaperEl) {
                    const bgImage = wallpaperEl.style.backgroundImage;
                    if (bgImage) {
                        // Extract URL from background-image
                        currentWallpaper = bgImage.replace(/url\(['"]?(.*?)['"]?\)/i, '$1');
                    }
                }
                colorExtractor = window.parent.WallpaperColorExtractor;
            } catch (e) {
                console.warn('Could not access parent wallpaper:', e);
            }
        }

        if (!colorExtractor && window.top && window.top !== window) {
            try {
                const wallpaperEl = window.top.document.getElementById('desktop-wallpaper');
                if (!currentWallpaper && wallpaperEl) {
                    const bgImage = wallpaperEl.style.backgroundImage;
                    if (bgImage) {
                        currentWallpaper = bgImage.replace(/url\(['"]?(.*?)['"]?\)/i, '$1');
                    }
                }
                colorExtractor = window.top.WallpaperColorExtractor;
            } catch (e) {
                console.warn('Could not access top wallpaper:', e);
            }
        }

        if (colorExtractor && currentWallpaper) {
            // Extract color and update CSS variable
            colorExtractor.extractDominantColor(currentWallpaper)
                .then(color => {
                    colorExtractor.dominantColor = color;
                    colorExtractor.setCSSVariable(color);
                    colorExtractor.saveCachedColor(currentWallpaper, color);
                    let cssColor = null;
                    if (typeof colorExtractor.rgbToString === 'function') {
                        cssColor = colorExtractor.rgbToString(color);
                    } else if (color && typeof color.r === 'number' && typeof color.g === 'number' && typeof color.b === 'number') {
                        cssColor = `rgb(${color.r}, ${color.g}, ${color.b})`;
                    }
                    if (cssColor) {
                        state.originalWallpaperColor = cssColor;
                        applyColor(cssColor);
                        console.log('Wallpaper color extracted and applied:', cssColor);
                    }
                })
                .catch(error => {
                    console.error('Failed to extract wallpaper color:', error);
                    // Fallback to stored original color
                    applyColor(state.originalWallpaperColor);
                });
        } else {
            // Fallback to stored original color
            applyColor(state.originalWallpaperColor);
            console.warn('WallpaperColorExtractor or current wallpaper not available');
        }
    }

    // Restore saved state (for cancel functionality)
    function restoreSavedState() {
        if (state.savedState) {
            state.selectedColorMode = state.savedState.selectedColorMode;
            state.selectedColor = state.savedState.selectedColor;
            state.originalWallpaperColor = state.savedState.originalWallpaperColor;

            // Reapply the previous color
            if (state.selectedColorMode !== 'custom' || !state.selectedColor) {
                applyColor(state.originalWallpaperColor);
            } else {
                applyColor(state.selectedColor);
            }

            // Re-render colors to update selection
            renderColors();
        }
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
