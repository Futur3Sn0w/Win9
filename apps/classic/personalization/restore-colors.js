// Restore Color Settings on Application Startup
// This file should be loaded in the main application to restore user's saved color choice
(function () {
    'use strict';

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
                console.warn('[RestoreColors] Could not require control-panel-color-registry.js:', error);
            }
        }

        return null;
    }

    const WallColorRegistry = resolveWallColorRegistry();

    function applyWallColor(color) {
        const contexts = [window, window.parent, window.top];
        for (const ctx of contexts) {
            try {
                if (ctx && typeof ctx.applyWallColorVariables === 'function' && ctx.document) {
                    ctx.applyWallColorVariables(color, ctx.document);
                    return;
                }
            } catch (error) {
                console.warn('[RestoreColors] Could not apply wall color via shared helper:', error);
            }
        }

        document.documentElement.style.setProperty('--ui-wall-color', color);
        document.documentElement.style.setProperty('--ui-wall-text-contrast', '#ffffff');
    }

    // Function to restore saved color
    function restoreSavedColor() {
        try {
            if (!WallColorRegistry || typeof WallColorRegistry.loadControlPanelColor !== 'function') {
                console.log('Control panel color registry unavailable - using default handling');
                return;
            }

            const settings = WallColorRegistry.loadControlPanelColor();
            if (settings.mode === 'custom' && settings.color) {
                applyWallColor(settings.color);
                console.log('Restored saved control panel color:', settings.color);
            } else {
                console.log('Control panel color set to automatic - wallpaper color will determine UI shade');
            }
        } catch (e) {
            console.error('Failed to restore color settings:', e);
        }
    }

    // Expose function globally so it can be called from main app
    window.restoreSavedColor = restoreSavedColor;

    // Auto-restore on script load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', restoreSavedColor);
    } else {
        restoreSavedColor();
    }
})();
