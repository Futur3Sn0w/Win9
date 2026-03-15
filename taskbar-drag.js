/**
 * Taskbar Drag and Drop
 * Enables reordering of taskbar items via drag and drop
 * Only pinned app positions are saved; running apps always appear at the end
 */

(function () {
    'use strict';

    let draggedElement = null;
    let draggedAppId = null;
    let dragStartX = 0;
    let dragStartY = 0;
    let isDragging = false;
    let originalIndex = -1;
    let targetIndex = -1;
    let allItems = [];

    // Minimum distance to start dragging (prevents accidental drags on clicks)
    const DRAG_THRESHOLD = 1;

    /**
     * Initialize drag and drop for taskbar items
     */
    function init() {
        console.log('[TASKBAR DRAG] Initializing taskbar drag and drop');

        const $taskbarApps = $('.taskbar-apps');

        // Use event delegation for dynamically added taskbar items
        $taskbarApps.on('mousedown', '.taskbar-app', handleMouseDown);
        $(document).on('mousemove', handleMouseMove);
        $(document).on('mouseup', handleMouseUp);

        console.log('[TASKBAR DRAG] Event handlers registered');
    }

    /**
     * Handle mouse down on taskbar item
     */
    function handleMouseDown(e) {
        // Only left mouse button
        if (e.button !== 0) return;

        // Don't interfere with right-click context menu
        if (e.button === 2) return;

        const $target = $(e.currentTarget);
        draggedElement = $target[0];
        draggedAppId = $target.attr('data-app-id');
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        isDragging = false; // Not dragging yet, waiting for threshold

        // Store original index
        originalIndex = $target.index();

        // Prevent text selection during drag
        e.preventDefault();
    }

    /**
     * Handle mouse move for dragging
     */
    function handleMouseMove(e) {
        if (!draggedElement) return;

        const deltaX = Math.abs(e.clientX - dragStartX);
        const deltaY = Math.abs(e.clientY - dragStartY);

        // Check if we've moved beyond the threshold
        if (!isDragging && (deltaX > DRAG_THRESHOLD || deltaY > DRAG_THRESHOLD)) {
            // Only allow horizontal dragging (check that horizontal movement is greater)
            if (deltaX < deltaY) {
                // More vertical than horizontal - cancel drag
                cancelDrag();
                return;
            }

            // Start dragging
            startDrag();
        }

        if (!isDragging) return;

        // Update dragged element position (horizontal only)
        const offsetX = e.clientX - dragStartX;
        $(draggedElement).css({
            transform: `translateX(${offsetX}px)`,
            pointerEvents: 'none'
        });

        // Calculate where the dragged item should be inserted based on cursor position
        const draggedRect = draggedElement.getBoundingClientRect();
        const draggedCenterX = draggedRect.left + draggedRect.width / 2;

        // Determine target index based on cursor position
        let newTargetIndex = originalIndex;

        for (let i = 0; i < allItems.length; i++) {
            if (allItems[i] === draggedElement) continue;

            const itemRect = allItems[i].getBoundingClientRect();
            const itemCenterX = itemRect.left + itemRect.width / 2;

            if (draggedCenterX < itemCenterX) {
                newTargetIndex = i;
                break;
            } else {
                newTargetIndex = i + 1;
            }
        }

        // Clamp to valid range
        newTargetIndex = Math.max(0, Math.min(allItems.length - 1, newTargetIndex));

        // Only update transforms if target index changed
        if (newTargetIndex !== targetIndex) {
            targetIndex = newTargetIndex;
            updateItemTransforms();
        }
    }

    /**
     * Handle mouse up to complete drag
     */
    function handleMouseUp(e) {
        if (!draggedElement) return;

        if (isDragging) {
            completeDrag();
        }

        // Reset drag state
        draggedElement = null;
        draggedAppId = null;
        isDragging = false;
    }

    /**
     * Start the drag operation
     */
    function startDrag() {
        isDragging = true;
        targetIndex = originalIndex;

        // Get all taskbar items
        const $taskbarApps = $('.taskbar-apps');
        allItems = $taskbarApps.find('.taskbar-app').get();

        // Add dragging class for styling
        $(draggedElement).addClass('taskbar-app-dragging');

        // Add body class to prevent other interactions
        $('body').addClass('taskbar-dragging');

        console.log('[TASKBAR DRAG] Started dragging:', draggedAppId);
    }

    /**
     * Update transforms of all items to create sliding effect
     */
    function updateItemTransforms() {
        const itemWidth = 62; // 60px width + 2px gap

        allItems.forEach((item, currentIndex) => {
            if (item === draggedElement) {
                // Don't transform the dragged element
                return;
            }

            let offset = 0;

            // Determine if this item should shift
            if (targetIndex > originalIndex) {
                // Dragging forward - items between original and target shift left
                if (currentIndex > originalIndex && currentIndex <= targetIndex) {
                    offset = -itemWidth;
                }
            } else if (targetIndex < originalIndex) {
                // Dragging backward - items between target and original shift right
                if (currentIndex >= targetIndex && currentIndex < originalIndex) {
                    offset = itemWidth;
                }
            }

            $(item).css('transform', offset !== 0 ? `translateX(${offset}px)` : '');
        });
    }

    /**
     * Complete the drag operation
     */
    function completeDrag() {
        const $taskbarApps = $('.taskbar-apps');

        // Disable transitions on non-dragged items so they don't animate when we clear transforms
        allItems.forEach(item => {
            if (item !== draggedElement) {
                $(item).css('transition', 'none');
            }
        });

        // Clear all transforms from other items (they snap instantly to final position)
        allItems.forEach(item => {
            if (item !== draggedElement) {
                $(item).css('transform', '');
            }
        });

        // Force reflow to apply the transform clear
        if (allItems.length > 0) {
            allItems[0].offsetHeight;
        }

        // Re-enable transitions on non-dragged items
        allItems.forEach(item => {
            if (item !== draggedElement) {
                $(item).css('transition', '');
            }
        });

        // Reset dragged element styles (this one can animate smoothly)
        $(draggedElement).css({
            transform: '',
            pointerEvents: ''
        });
        $(draggedElement).removeClass('taskbar-app-dragging');

        // Only reorder if position changed
        if (targetIndex !== originalIndex) {
            // Move dragged element to new position in the DOM
            $(draggedElement).detach();

            const $items = $taskbarApps.find('.taskbar-app');

            if (targetIndex === 0) {
                $taskbarApps.prepend(draggedElement);
            } else if (targetIndex >= $items.length) {
                $taskbarApps.append(draggedElement);
            } else {
                // Insert before the item at targetIndex
                // Account for the fact that we removed the dragged element
                const adjustedIndex = targetIndex > originalIndex ? targetIndex - 1 : targetIndex;
                $items.eq(adjustedIndex).before(draggedElement);
            }

            console.log('[TASKBAR DRAG] Completed drag. Original index:', originalIndex, 'New index:', targetIndex);

            // Save the new order (only for pinned apps)
            saveTaskbarOrder();
        } else {
            console.log('[TASKBAR DRAG] Drag cancelled - no position change');
        }

        // Remove body class
        $('body').removeClass('taskbar-dragging');

        // Reset state
        originalIndex = -1;
        targetIndex = -1;
        allItems = [];
    }

    /**
     * Cancel the drag operation
     */
    function cancelDrag() {
        if (isDragging) {
            // Clear all transforms from other items
            allItems.forEach(item => {
                $(item).css('transform', '');
            });

            // Reset dragged element styles
            $(draggedElement).css({
                transform: '',
                pointerEvents: ''
            });
            $(draggedElement).removeClass('taskbar-app-dragging');

            // Remove body class
            $('body').removeClass('taskbar-dragging');
        }

        // Reset drag state
        draggedElement = null;
        draggedAppId = null;
        isDragging = false;
        originalIndex = -1;
        targetIndex = -1;
        allItems = [];
    }

    /**
     * Save the taskbar order via registry
     * Only saves positions of pinned apps; running apps are excluded
     */
    function saveTaskbarOrder() {
        const $taskbarApps = $('.taskbar-apps');
        const allTaskbarItems = $taskbarApps.find('.taskbar-app').get();

        // Get all app IDs in current order
        const currentOrder = allTaskbarItems.map(item => $(item).attr('data-app-id'));

        // Filter to only include pinned apps
        const pinnedOrder = currentOrder.filter(appId => {
            const app = AppsManager.getAppById(appId);
            return app && app.pinnedToTaskbar;
        });

        const layoutRegistry = window.TileLayoutRegistry;

        if (layoutRegistry && typeof layoutRegistry.saveTaskbarOrder === 'function') {
            try {
                layoutRegistry.saveTaskbarOrder(pinnedOrder);
                console.log('[TASKBAR DRAG] Saved taskbar order to registry (pinned apps only):', pinnedOrder);
            } catch (error) {
                console.error('[TASKBAR DRAG] Failed to save taskbar order to registry:', error);
            }
        } else {
            console.warn('[TASKBAR DRAG] Tile layout registry API unavailable; taskbar order not persisted');
        }
    }

    /**
     * Load taskbar order (with legacy migration)
     * Returns array of app IDs in saved order
     */
    function loadTaskbarOrder() {
        const layoutRegistry = window.TileLayoutRegistry;
        if (layoutRegistry && typeof layoutRegistry.loadTaskbarOrder === 'function') {
            try {
                const order = layoutRegistry.loadTaskbarOrder();
                if (Array.isArray(order) && order.length > 0) {
                    console.log('[TASKBAR DRAG] Loaded taskbar order from registry:', order);
                    return order;
                }
            } catch (error) {
                console.error('[TASKBAR DRAG] Error loading taskbar order from registry:', error);
            }
        }

        if (typeof localStorage !== 'undefined') {
            const saved = localStorage.getItem('taskbarOrder');
            if (saved) {
                try {
                    const order = JSON.parse(saved);
                    console.log('[TASKBAR DRAG] Loaded taskbar order from localStorage:', order);

                    if (layoutRegistry && typeof layoutRegistry.saveTaskbarOrder === 'function' && Array.isArray(order)) {
                        try {
                            layoutRegistry.saveTaskbarOrder(order);
                            console.log('[TASKBAR DRAG] Migrated taskbar order to registry');
                        } catch (error) {
                            console.warn('[TASKBAR DRAG] Failed to migrate taskbar order to registry:', error);
                        }
                    }

                    try {
                        localStorage.removeItem('taskbarOrder');
                    } catch (cleanupError) {
                        console.warn('[TASKBAR DRAG] Failed to remove legacy taskbarOrder key:', cleanupError);
                    }

                    return Array.isArray(order) ? order : [];
                } catch (e) {
                    console.error('[TASKBAR DRAG] Error loading taskbar order from localStorage:', e);
                }
            }
        }
        return [];
    }

    /**
     * Apply saved order to an array of apps
     * Used by updateTaskbar to sort pinned apps according to saved order
     */
    function applySavedOrder(apps) {
        const savedOrder = loadTaskbarOrder();
        if (savedOrder.length === 0) {
            return apps;
        }

        // Create a map for quick lookup
        const orderMap = {};
        savedOrder.forEach((appId, index) => {
            orderMap[appId] = index;
        });

        // Sort apps according to saved order
        // Apps not in saved order go to the end
        return apps.sort((a, b) => {
            const indexA = orderMap[a.id] !== undefined ? orderMap[a.id] : Infinity;
            const indexB = orderMap[b.id] !== undefined ? orderMap[b.id] : Infinity;
            return indexA - indexB;
        });
    }

    // Initialize when DOM is ready
    $(document).ready(function () {
        // Wait for taskbar to be ready
        const checkAndInit = () => {
            const taskbarReady = $('.taskbar-apps').length > 0;

            if (taskbarReady) {
                init();
            } else {
                setTimeout(checkAndInit, 100);
            }
        };

        checkAndInit();
    });

    // Export for use by apps-manager
    window.TaskbarDrag = {
        applySavedOrder,
        loadTaskbarOrder,
        saveTaskbarOrder
    };
})();
