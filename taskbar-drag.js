/**
 * Taskbar Drag and Drop
 * Enables pointer-based reordering of taskbar items and
 * upward drag-to-reveal for the taskbar app menu.
 */

(function () {
    'use strict';

    const AXIS_LOCK_BIAS_PX = 4;
    const CLICK_SUPPRESSION_MS = 400;
    const DEFAULT_ITEM_STRIDE_PX = 62;
    const HORIZONTAL_DRAG_THRESHOLD_PX = {
        mouse: 6,
        pen: 9,
        touch: 12
    };
    const MENU_DRAG_THRESHOLD_PX = {
        mouse: 12,
        pen: 14,
        touch: 18
    };
    const MENU_REVEAL_DISTANCE_PX = {
        mouse: 72,
        pen: 80,
        touch: 92
    };
    const MENU_COMMIT_PROGRESS = 0.45;

    let dragState = createEmptyDragState();
    let suppressedClick = {
        appId: null,
        until: 0
    };

    function createEmptyDragState() {
        return {
            sourceEl: null,
            appId: null,
            pointerId: null,
            pointerType: 'mouse',
            startX: 0,
            startY: 0,
            lastX: 0,
            lastY: 0,
            isReordering: false,
            isMenuGesture: false,
            menuProgress: 0,
            originalIndex: -1,
            targetIndex: -1,
            allItems: []
        };
    }

    function normalizePointerType(pointerType) {
        if (pointerType === 'touch' || pointerType === 'pen') {
            return pointerType;
        }

        return 'mouse';
    }

    function getThreshold(map, pointerType) {
        return map[normalizePointerType(pointerType)] ?? map.mouse;
    }

    function clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    function matchesActivePointer(event) {
        if (!dragState.sourceEl) {
            return false;
        }

        if (dragState.pointerId === null || dragState.pointerId === undefined) {
            return true;
        }

        return (event.pointerId ?? null) === dragState.pointerId;
    }

    function suppressNextClick(appId) {
        suppressedClick = {
            appId,
            until: Date.now() + CLICK_SUPPRESSION_MS
        };
    }

    function getTaskbarItemStride() {
        if (!dragState.sourceEl) {
            return DEFAULT_ITEM_STRIDE_PX;
        }

        const taskbarApps = document.querySelector('.taskbar-apps');
        if (!taskbarApps) {
            return DEFAULT_ITEM_STRIDE_PX;
        }

        const width = dragState.sourceEl.getBoundingClientRect().width || 60;
        const computedStyle = window.getComputedStyle(taskbarApps);
        const gap = Number.parseFloat(computedStyle.columnGap || computedStyle.gap || '0');

        return Math.round(width + (Number.isFinite(gap) ? gap : 2));
    }

    function releasePointerCapture() {
        if (!dragState.sourceEl || dragState.pointerId === null || dragState.pointerId === undefined) {
            return;
        }

        if (typeof dragState.sourceEl.releasePointerCapture !== 'function') {
            return;
        }

        try {
            dragState.sourceEl.releasePointerCapture(dragState.pointerId);
        } catch (error) {
            console.debug('[TASKBAR DRAG] Unable to release pointer capture:', error);
        }
    }

    function resetState() {
        releasePointerCapture();
        dragState = createEmptyDragState();
    }

    /**
     * Initialize drag and gesture support for taskbar items
     */
    function init() {
        console.log('[TASKBAR DRAG] Initializing taskbar drag and menu gestures');

        const $taskbarApps = $('.taskbar-apps');

        $taskbarApps.off('.taskbardrag');
        $(document).off('.taskbardrag');

        $taskbarApps.on('pointerdown.taskbardrag', '.taskbar-app', handlePointerDown);
        $(document).on('pointermove.taskbardrag', handlePointerMove);
        $(document).on('pointerup.taskbardrag pointercancel.taskbardrag', handlePointerEnd);

        console.log('[TASKBAR DRAG] Event handlers registered');
    }

    /**
     * Handle pointer down on taskbar item
     */
    function handlePointerDown(event) {
        if (dragState.sourceEl) {
            return;
        }

        const pointerType = normalizePointerType(event.pointerType);
        if (pointerType === 'mouse' && event.button !== 0) {
            return;
        }

        const sourceEl = event.currentTarget;
        dragState.sourceEl = sourceEl;
        dragState.appId = $(sourceEl).attr('data-app-id');
        dragState.pointerId = event.pointerId ?? null;
        dragState.pointerType = pointerType;
        dragState.startX = event.clientX;
        dragState.startY = event.clientY;
        dragState.lastX = event.clientX;
        dragState.lastY = event.clientY;

        if (typeof sourceEl.setPointerCapture === 'function' && dragState.pointerId !== null) {
            try {
                sourceEl.setPointerCapture(dragState.pointerId);
            } catch (error) {
                console.debug('[TASKBAR DRAG] Unable to capture pointer:', error);
            }
        }
    }

    /**
     * Handle pointer move for dragging / menu reveal
     */
    function handlePointerMove(event) {
        if (!matchesActivePointer(event)) {
            return;
        }

        dragState.lastX = event.clientX;
        dragState.lastY = event.clientY;

        const deltaX = event.clientX - dragState.startX;
        const deltaY = event.clientY - dragState.startY;
        const absDeltaX = Math.abs(deltaX);
        const upwardDistance = Math.max(0, dragState.startY - event.clientY);

        if (dragState.isReordering) {
            updateReorderPosition(event.clientX);
            event.preventDefault();
            return;
        }

        if (dragState.isMenuGesture) {
            updateMenuGesture(upwardDistance);
            event.preventDefault();
            return;
        }

        const horizontalThreshold = getThreshold(HORIZONTAL_DRAG_THRESHOLD_PX, dragState.pointerType);
        const menuThreshold = getThreshold(MENU_DRAG_THRESHOLD_PX, dragState.pointerType);

        const shouldStartReorder =
            absDeltaX >= horizontalThreshold &&
            absDeltaX > Math.abs(deltaY) + AXIS_LOCK_BIAS_PX;
        const shouldStartMenuGesture =
            upwardDistance >= menuThreshold &&
            upwardDistance > absDeltaX + AXIS_LOCK_BIAS_PX &&
            canUseMenuGesture();

        if (shouldStartReorder) {
            startReorder();
            updateReorderPosition(event.clientX);
            event.preventDefault();
            return;
        }

        if (shouldStartMenuGesture) {
            startMenuGesture();
            updateMenuGesture(upwardDistance);
            event.preventDefault();
        }
    }

    /**
     * Handle pointer end to complete the active gesture
     */
    function handlePointerEnd(event) {
        if (!matchesActivePointer(event)) {
            return;
        }

        const appId = dragState.appId;
        const wasReordering = dragState.isReordering;
        const wasMenuGesture = dragState.isMenuGesture;
        const isCancelled = event.type === 'pointercancel';

        if (wasReordering) {
            if (isCancelled) {
                cancelReorder();
            } else {
                completeReorder();
            }
        } else if (wasMenuGesture) {
            finishMenuGesture(isCancelled);
        }

        if (wasReordering || wasMenuGesture) {
            suppressNextClick(appId);
        }

        resetState();
    }

    function canUseMenuGesture() {
        return Boolean(
            window.TaskbarItemContextMenu &&
            typeof window.TaskbarItemContextMenu.showContextMenu === 'function' &&
            typeof window.TaskbarItemContextMenu.setRevealProgress === 'function'
        );
    }

    function startReorder() {
        dragState.isReordering = true;
        dragState.originalIndex = $(dragState.sourceEl).index();
        dragState.targetIndex = dragState.originalIndex;
        dragState.allItems = $('.taskbar-apps').find('.taskbar-app').get();

        if (typeof window.closeAllTaskbarPopupsAndMenus === 'function') {
            window.closeAllTaskbarPopupsAndMenus();
        }

        $(dragState.sourceEl).addClass('taskbar-app-dragging');
        $('body').addClass('taskbar-dragging');

        console.log('[TASKBAR DRAG] Started reordering:', dragState.appId);
    }

    /**
     * Update transforms of all items to create sliding effect
     */
    function updateItemTransforms() {
        const itemStride = getTaskbarItemStride();

        dragState.allItems.forEach((item, currentIndex) => {
            if (item === dragState.sourceEl) {
                return;
            }

            let offset = 0;

            if (dragState.targetIndex > dragState.originalIndex) {
                if (currentIndex > dragState.originalIndex && currentIndex <= dragState.targetIndex) {
                    offset = -itemStride;
                }
            } else if (dragState.targetIndex < dragState.originalIndex) {
                if (currentIndex >= dragState.targetIndex && currentIndex < dragState.originalIndex) {
                    offset = itemStride;
                }
            }

            $(item).css('transform', offset !== 0 ? `translateX(${offset}px)` : '');
        });
    }

    function updateReorderPosition(clientX) {
        const offsetX = clientX - dragState.startX;
        $(dragState.sourceEl).css({
            transform: `translateX(${offsetX}px)`,
            pointerEvents: 'none'
        });

        const draggedRect = dragState.sourceEl.getBoundingClientRect();
        const draggedCenterX = draggedRect.left + draggedRect.width / 2;

        let newTargetIndex = dragState.originalIndex;

        for (let i = 0; i < dragState.allItems.length; i++) {
            const item = dragState.allItems[i];
            if (item === dragState.sourceEl) {
                continue;
            }

            const itemRect = item.getBoundingClientRect();
            const itemCenterX = itemRect.left + itemRect.width / 2;

            if (draggedCenterX < itemCenterX) {
                newTargetIndex = i;
                break;
            }

            newTargetIndex = i + 1;
        }

        newTargetIndex = clamp(newTargetIndex, 0, dragState.allItems.length - 1);

        if (newTargetIndex !== dragState.targetIndex) {
            dragState.targetIndex = newTargetIndex;
            updateItemTransforms();
        }
    }

    function startMenuGesture() {
        dragState.isMenuGesture = true;
        dragState.menuProgress = 0;

        $('body').addClass('taskbar-menu-gesturing');
        window.TaskbarItemContextMenu.showContextMenu(dragState.appId, $(dragState.sourceEl), {
            gestureControlled: true,
            revealProgress: 0
        });
    }

    function updateMenuGesture(upwardDistance) {
        if (!dragState.isMenuGesture) {
            return;
        }

        const revealDistance = getThreshold(MENU_REVEAL_DISTANCE_PX, dragState.pointerType);
        const progress = clamp(upwardDistance / revealDistance, 0, 1);

        dragState.menuProgress = progress;
        window.TaskbarItemContextMenu.setRevealProgress(progress);
    }

    /**
     * Complete the drag operation
     */
    function completeReorder() {
        const $taskbarApps = $('.taskbar-apps');

        dragState.allItems.forEach(item => {
            if (item !== dragState.sourceEl) {
                $(item).css('transition', 'none');
            }
        });

        dragState.allItems.forEach(item => {
            if (item !== dragState.sourceEl) {
                $(item).css('transform', '');
            }
        });

        if (dragState.allItems.length > 0) {
            dragState.allItems[0].offsetHeight;
        }

        dragState.allItems.forEach(item => {
            if (item !== dragState.sourceEl) {
                $(item).css('transition', '');
            }
        });

        $(dragState.sourceEl).css({
            transform: '',
            pointerEvents: ''
        });
        $(dragState.sourceEl).removeClass('taskbar-app-dragging');

        if (dragState.targetIndex !== dragState.originalIndex) {
            $(dragState.sourceEl).detach();

            const $items = $taskbarApps.find('.taskbar-app');

            if (dragState.targetIndex === 0) {
                $taskbarApps.prepend(dragState.sourceEl);
            } else if (dragState.targetIndex >= $items.length) {
                $taskbarApps.append(dragState.sourceEl);
            } else {
                const adjustedIndex = dragState.targetIndex > dragState.originalIndex
                    ? dragState.targetIndex - 1
                    : dragState.targetIndex;
                $items.eq(adjustedIndex).before(dragState.sourceEl);
            }

            console.log(
                '[TASKBAR DRAG] Completed reorder. Original index:',
                dragState.originalIndex,
                'New index:',
                dragState.targetIndex
            );

            saveTaskbarOrder();
        } else {
            console.log('[TASKBAR DRAG] Reorder ended with no position change');
        }

        $('body').removeClass('taskbar-dragging');
    }

    /**
     * Cancel the drag operation
     */
    function cancelReorder() {
        if (dragState.isReordering) {
            dragState.allItems.forEach(item => {
                $(item).css('transform', '');
            });

            $(dragState.sourceEl).css({
                transform: '',
                pointerEvents: ''
            });
            $(dragState.sourceEl).removeClass('taskbar-app-dragging');

            $('body').removeClass('taskbar-dragging');
        }
    }

    function finishMenuGesture(cancelled) {
        const shouldCommit = !cancelled && dragState.menuProgress >= MENU_COMMIT_PROGRESS;

        if (shouldCommit) {
            window.TaskbarItemContextMenu.commitGestureMenu();
        } else {
            window.TaskbarItemContextMenu.hideContextMenu({ immediate: true });
        }

        $('body').removeClass('taskbar-menu-gesturing');
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
        saveTaskbarOrder,
        consumePendingTaskbarClick(appId) {
            const isSuppressed =
                suppressedClick.appId === appId &&
                suppressedClick.until > Date.now();

            if (isSuppressed) {
                suppressedClick = {
                    appId: null,
                    until: 0
                };
                return true;
            }

            return false;
        }
    };
})();
