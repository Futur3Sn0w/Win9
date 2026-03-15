/**
 * Tile Drag-and-Drop Module (Sortable.js Implementation)
 * Provides drag-and-drop reordering for Start Screen tiles
 * Self-contained and easy to remove if needed
 *
 * Requires: Sortable.js (https://sortablejs.github.io/Sortable/)
 */

const TileDrag = (function() {
    'use strict';

    let enabled = false;
    let sortableInstance = null;
    let tilesContainer = null;

    // Configuration
    const CONFIG = {
        containerSelector: '#pinned-tiles',
        storageKey: 'tileOrder'
    };

    /**
     * Initialize drag-and-drop functionality
     */
    function init() {
        console.log('[TileDrag] Initializing with Sortable.js...');

        // Check if Sortable is available
        if (typeof Sortable === 'undefined') {
            console.error('[TileDrag] Sortable.js library not found! Please include it in your HTML.');
            return false;
        }

        tilesContainer = document.querySelector(CONFIG.containerSelector);

        if (!tilesContainer) {
            console.warn('[TileDrag] Tiles container not found');
            return false;
        }

        // Initialize Sortable
        sortableInstance = Sortable.create(tilesContainer, {
            animation: 250,                    // Animation speed in ms
            easing: 'cubic-bezier(0.4, 0, 0.2, 1)', // Smooth easing
            ghostClass: 'tile-drag-ghost',     // Class for the drop placeholder
            dragClass: 'tile-dragging',        // Class for the dragging item
            chosenClass: 'tile-chosen',        // Class for the chosen item
            forceFallback: false,              // Use native HTML5 drag
            fallbackClass: 'tile-drag-fallback',
            fallbackOnBody: true,
            swapThreshold: 0.65,               // Threshold for swapping items

            // Dragging callbacks
            onStart: function(evt) {
                console.log('[TileDrag] Started dragging');
                // Add body class to shrink other tiles
                document.body.classList.add('tile-drag-active');
            },

            onEnd: function(evt) {
                console.log('[TileDrag] Finished dragging');
                // Remove body class
                document.body.classList.remove('tile-drag-active');

                // Save new order if position changed
                if (evt.oldIndex !== evt.newIndex) {
                    const newOrder = getCurrentOrder();
                    saveOrder(newOrder);
                    console.log('[TileDrag] New order:', newOrder);

                    // Trigger layout recalculation after reordering
                    // Use a small delay to ensure Sortable has finished updating the DOM
                    setTimeout(() => {
                        if (typeof renderPinnedTiles === 'function') {
                            renderPinnedTiles();
                        }
                    }, 50);
                }
            },

            // Filter function - prevent dragging certain elements
            filter: function(evt, target) {
                // Don't allow dragging if right-clicking
                if (evt.button === 2) {
                    return true;
                }
                return false;
            }
        });

        enabled = true;
        console.log('[TileDrag] Initialized successfully with Sortable.js');
        return true;
    }

    /**
     * Destroy drag-and-drop functionality and clean up
     */
    function destroy() {
        console.log('[TileDrag] Destroying...');
        enabled = false;

        if (sortableInstance) {
            sortableInstance.destroy();
            sortableInstance = null;
        }

        document.body.classList.remove('tile-drag-active');
        tilesContainer = null;
        console.log('[TileDrag] Destroyed successfully');
    }

    /**
     * Get current order of tiles (array of app IDs)
     */
    function getCurrentOrder() {
        if (!tilesContainer) return [];

        const tiles = tilesContainer.querySelectorAll('.tiles__tile');
        return Array.from(tiles)
            .map(tile => tile.getAttribute('data-app'))
            .filter(id => id); // Remove any nulls
    }

    /**
     * Save tile order via registry
     */
    function saveOrder(order) {
        const layoutRegistry = window.TileLayoutRegistry;

        if (layoutRegistry && typeof layoutRegistry.saveTileOrder === 'function') {
            try {
                layoutRegistry.saveTileOrder('start-screen', order);
                console.log('[TileDrag] Order saved to registry');
            } catch (error) {
                console.error('[TileDrag] Failed to save order to registry:', error);
            }
        } else {
            console.warn('[TileDrag] Tile layout registry API unavailable; tile order not persisted');
        }
    }

    /**
     * Load tile order (with legacy migration)
     */
    function loadOrder() {
        const layoutRegistry = window.TileLayoutRegistry;

        if (layoutRegistry && typeof layoutRegistry.loadTileOrder === 'function') {
            try {
                const registryOrder = layoutRegistry.loadTileOrder('start-screen');
                if (Array.isArray(registryOrder) && registryOrder.length > 0) {
                    console.log('[TileDrag] Loaded order from registry:', registryOrder);
                    return registryOrder;
                }
            } catch (error) {
                console.error('[TileDrag] Failed to load order from registry:', error);
            }
        }

        if (typeof localStorage !== 'undefined') {
            try {
                const saved = localStorage.getItem(CONFIG.storageKey);
                if (saved) {
                    const order = JSON.parse(saved);
                    console.log('[TileDrag] Loaded order from localStorage:', order);

                    if (layoutRegistry && typeof layoutRegistry.saveTileOrder === 'function') {
                        try {
                            layoutRegistry.saveTileOrder('start-screen', order);
                            console.log('[TileDrag] Migrated localStorage order to registry');
                        } catch (error) {
                            console.warn('[TileDrag] Failed to migrate order to registry:', error);
                        }
                    }

                    try {
                        localStorage.removeItem(CONFIG.storageKey);
                    } catch (cleanupError) {
                        console.warn('[TileDrag] Failed to remove legacy tile order key:', cleanupError);
                    }

                    return order;
                }
            } catch (error) {
                console.error('[TileDrag] Failed to load order from localStorage:', error);
            }
        }

        return null;
    }

    /**
     * Clear saved order
     */
    function clearOrder() {
        const layoutRegistry = window.TileLayoutRegistry;
        if (layoutRegistry && typeof layoutRegistry.clearTileOrder === 'function') {
            try {
                layoutRegistry.clearTileOrder('start-screen');
            } catch (error) {
                console.warn('[TileDrag] Failed to clear registry order:', error);
            }
        }

        if (typeof localStorage !== 'undefined') {
            localStorage.removeItem(CONFIG.storageKey);
        }

        console.log('[TileDrag] Cleared saved order');
    }

    /**
     * Apply saved order to apps array
     */
    function applySavedOrder(apps) {
        const savedOrder = loadOrder();
        if (!savedOrder || savedOrder.length === 0) {
            return apps; // Return original if no saved order
        }

        // Create a map of app IDs to apps
        const appMap = new Map();
        apps.forEach(app => appMap.set(app.id, app));

        // Reorder based on saved order
        const orderedApps = [];
        savedOrder.forEach(appId => {
            if (appMap.has(appId)) {
                orderedApps.push(appMap.get(appId));
                appMap.delete(appId);
            }
        });

        // Add any apps that weren't in the saved order (newly pinned)
        appMap.forEach(app => orderedApps.push(app));

        return orderedApps;
    }

    /**
     * Check if drag-and-drop is enabled
     */
    function isEnabled() {
        return enabled;
    }

    /**
     * Refresh - reinitialize with current tiles
     */
    function refresh() {
        if (!enabled) return;

        console.log('[TileDrag] Refreshing...');

        // Destroy old instance
        if (sortableInstance) {
            sortableInstance.destroy();
        }

        // Reinitialize
        tilesContainer = document.querySelector(CONFIG.containerSelector);
        if (tilesContainer) {
            init();
        }
    }

    // Public API
    return {
        init,
        destroy,
        refresh,
        isEnabled,
        applySavedOrder,
        loadOrder,
        saveOrder,
        clearOrder,
        getCurrentOrder
    };
})();

// Export for use in other scripts
if (typeof window !== 'undefined') {
    window.TileDrag = TileDrag;
}
