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
    let dragStartOrder = [];
    let layoutSyncFrame = null;

    // Configuration
    const CONFIG = {
        containerSelector: '#pinned-tiles',
        storageKey: 'tileOrder'
    };
    const REORDER_ANIMATION = {
        duration: 220,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)'
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
            dataIdAttr: 'data-app',
            ghostClass: 'tile-drag-ghost',     // Class for the drop placeholder
            dragClass: 'tile-dragging',        // Class for the dragging item
            chosenClass: 'tile-chosen',        // Class for the chosen item
            forceFallback: true,
            fallbackClass: 'tile-drag-fallback',
            fallbackOnBody: true,
            fallbackTolerance: 4,
            swapThreshold: 0.65,               // Threshold for swapping items

            // Dragging callbacks
            onStart: function(evt) {
                console.log('[TileDrag] Started dragging');
                dragStartOrder = getCurrentOrder();
                // Add body class to shrink other tiles
                document.body.classList.add('tile-drag-active');
            },

            onChange: function() {
                syncLiveLayout(getCurrentOrder());
            },

            onSort: function() {
                syncLiveLayout(getCurrentOrder());
            },

            onEnd: function(evt) {
                console.log('[TileDrag] Finished dragging');
                // Remove body class
                document.body.classList.remove('tile-drag-active');

                const newOrder = getCurrentOrder();
                syncLiveLayout(newOrder);

                // Save new order if position changed
                if (!ordersMatch(dragStartOrder, newOrder)) {
                    saveOrder(newOrder);
                    console.log('[TileDrag] New order:', newOrder);

                    requestAnimationFrame(() => {
                        if (typeof renderPinnedTiles === 'function') {
                            renderPinnedTiles();
                        }
                    });
                }

                dragStartOrder = [];
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

        if (layoutSyncFrame !== null) {
            cancelAnimationFrame(layoutSyncFrame);
            layoutSyncFrame = null;
        }

        document.body.classList.remove('tile-drag-active');
        dragStartOrder = [];
        tilesContainer = null;
        console.log('[TileDrag] Destroyed successfully');
    }

    /**
     * Get current order of tiles (array of app IDs)
     */
    function getCurrentOrder() {
        if (!tilesContainer) return [];

        if (sortableInstance && typeof sortableInstance.toArray === 'function') {
            const sortableOrder = sortableInstance.toArray().filter(id => id);
            if (sortableOrder.length > 0) {
                return sortableOrder;
            }
        }

        const tiles = tilesContainer.querySelectorAll('.tiles__tile');
        return Array.from(tiles)
            .map(tile => tile.getAttribute('data-app'))
            .filter(id => id); // Remove any nulls
    }

    function syncLiveLayout(order) {
        if (!tilesContainer || !Array.isArray(order) || order.length === 0) {
            return;
        }

        if (layoutSyncFrame !== null) {
            cancelAnimationFrame(layoutSyncFrame);
        }

        layoutSyncFrame = requestAnimationFrame(() => {
            layoutSyncFrame = null;
            applyOrderLayout(order);
        });
    }

    function applyOrderLayout(order) {
        if (!tilesContainer ||
            !window.AppsManager ||
            typeof window.AppsManager.getAppById !== 'function' ||
            typeof window.calculateTileLayout !== 'function') {
            return;
        }

        const shouldAnimate = document.body.classList.contains('tile-drag-active');
        const previousRects = shouldAnimate ? captureTileRects() : null;

        const orderedApps = order
            .map(appId => window.AppsManager.getAppById(appId))
            .filter(Boolean);

        if (orderedApps.length === 0) {
            return;
        }

        const layout = window.calculateTileLayout(orderedApps);
        if (!layout || !Array.isArray(layout.tiles)) {
            return;
        }

        const tilesById = new Map(
            Array.from(tilesContainer.querySelectorAll('.tiles__tile'))
                .map(tile => [tile.getAttribute('data-app'), tile])
        );

        layout.tiles.forEach(tileInfo => {
            const tile = tilesById.get(tileInfo.app.id);
            if (!tile || !tileInfo.size) {
                return;
            }

            tile.style.gridRow = `${tileInfo.row} / span ${tileInfo.size.rows}`;
            tile.style.gridColumn = `${tileInfo.col} / span ${tileInfo.size.cols}`;
        });

        if (previousRects) {
            animateTileReflow(previousRects, tilesById);
        }
    }

    function ordersMatch(left, right) {
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

    function captureTileRects() {
        const rects = new Map();
        const tiles = tilesContainer ? tilesContainer.querySelectorAll('.tiles__tile') : [];

        Array.from(tiles).forEach(tile => {
            if (shouldSkipTileAnimation(tile)) {
                return;
            }

            rects.set(tile.getAttribute('data-app'), tile.getBoundingClientRect());
        });

        return rects;
    }

    function animateTileReflow(previousRects, tilesById) {
        tilesById.forEach((tile, appId) => {
            if (shouldSkipTileAnimation(tile)) {
                return;
            }

            const previousRect = previousRects.get(appId);
            if (!previousRect) {
                return;
            }

            const nextRect = tile.getBoundingClientRect();
            const deltaX = previousRect.left - nextRect.left;
            const deltaY = previousRect.top - nextRect.top;

            if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) {
                return;
            }

            if (tile._tileReflowAnimation && typeof tile._tileReflowAnimation.cancel === 'function') {
                tile._tileReflowAnimation.cancel();
            }

            try {
                const animation = tile.animate(
                    [
                        { transform: `translate(${deltaX}px, ${deltaY}px)` },
                        { transform: 'translate(0px, 0px)' }
                    ],
                    {
                        duration: REORDER_ANIMATION.duration,
                        easing: REORDER_ANIMATION.easing,
                        composite: 'add'
                    }
                );

                tile._tileReflowAnimation = animation;

                const clearAnimationRef = () => {
                    if (tile._tileReflowAnimation === animation) {
                        tile._tileReflowAnimation = null;
                    }
                };

                animation.onfinish = clearAnimationRef;
                animation.oncancel = clearAnimationRef;
            } catch (error) {
                // Ignore animation failures and keep the layout update functional.
                tile._tileReflowAnimation = null;
            }
        });
    }

    function shouldSkipTileAnimation(tile) {
        return !tile ||
            tile.classList.contains('sortable-drag') ||
            tile.classList.contains('tile-drag-fallback') ||
            tile.classList.contains('tile-drag-ghost') ||
            tile.classList.contains('tile-chosen') ||
            tile.classList.contains('tile-dragging');
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
