(() => {
    const ARROW_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);

    function isStartSurfaceVisible() {
        const body = document.body;
        const startScreen = document.getElementById('start-screen');
        const startMenu = document.getElementById('start-menu');

        const startScreenVisible =
            body?.classList.contains('view-start') === true &&
            startScreen?.classList.contains('visible') === true;

        const startMenuVisible =
            startMenu?.classList.contains('visible') === true ||
            body?.classList.contains('start-menu-open') === true;

        return startScreenVisible || startMenuVisible;
    }

    function getActiveWindowElement() {
        return document.querySelector('.classic-app-container.active[data-window-id]');
    }

    function getActiveWindowData() {
        const element = getActiveWindowElement();
        const windowId = element?.getAttribute('data-window-id');
        if (!windowId || !window.AppsManager || typeof window.AppsManager.getRunningWindow !== 'function') {
            return null;
        }

        return window.AppsManager.getRunningWindow(windowId) || null;
    }

    function getSnapZone(windowData) {
        return windowData?.$container?.data('snapZone') || null;
    }

    function isMinimized(windowData) {
        if (!windowData?.$container?.length) {
            return true;
        }

        if (windowData.state === 'minimized') {
            return true;
        }

        return window.getComputedStyle(windowData.$container[0]).display === 'none';
    }

    function isMaximized(windowData) {
        return !!windowData?.$container?.hasClass('maximized');
    }

    function canSnapWindow(windowData) {
        const $container = windowData?.$container;
        if (!$container?.length) {
            return false;
        }

        if ($container.data('backgroundPreload')) {
            return false;
        }

        if ($container.hasClass('closing') || $container.hasClass('metro-mode')) {
            return false;
        }

        return true;
    }

    function getHorizontalSide(snapZone) {
        if (snapZone === 'left' || snapZone === 'top-left' || snapZone === 'bottom-left') {
            return 'left';
        }

        if (snapZone === 'right' || snapZone === 'top-right' || snapZone === 'bottom-right') {
            return 'right';
        }

        return null;
    }

    function getTopQuadrant(snapZone) {
        if (snapZone === 'left' || snapZone === 'bottom-left') {
            return 'top-left';
        }

        if (snapZone === 'right' || snapZone === 'bottom-right') {
            return 'top-right';
        }

        return null;
    }

    function getBottomQuadrant(snapZone) {
        if (snapZone === 'left' || snapZone === 'top-left') {
            return 'bottom-left';
        }

        if (snapZone === 'right' || snapZone === 'top-right') {
            return 'bottom-right';
        }

        return null;
    }

    function snapWindow(windowId, snapZone, options = {}) {
        if (typeof window.snapClassicWindowToZone !== 'function') {
            return false;
        }

        return window.snapClassicWindowToZone(windowId, snapZone, options);
    }

    function minimizeWindow(windowId) {
        if (typeof window.minimizeClassicWindow !== 'function') {
            return false;
        }

        window.minimizeClassicWindow(windowId);
        return true;
    }

    function toggleMaximize(windowId) {
        if (typeof window.toggleMaximizeClassicWindow !== 'function') {
            return false;
        }

        window.toggleMaximizeClassicWindow(windowId);
        return true;
    }

    function handleHorizontalSnap(windowData, direction) {
        const currentSide = getHorizontalSide(getSnapZone(windowData));
        if (currentSide === direction) {
            // The current shell only exposes one active display, so monitor traversal is a no-op.
            return false;
        }

        return snapWindow(windowData.windowId, direction, {
            ensureVisible: isMinimized(windowData),
            focusWindow: true
        });
    }

    function handleUpSnap(windowData) {
        const snapZone = getSnapZone(windowData);

        if (isMaximized(windowData)) {
            return false;
        }

        const topQuadrant = getTopQuadrant(snapZone);
        if (topQuadrant) {
            return snapWindow(windowData.windowId, topQuadrant, {
                ensureVisible: isMinimized(windowData),
                focusWindow: true
            });
        }

        if (snapZone === 'top-left' || snapZone === 'top-right') {
            return snapWindow(windowData.windowId, 'top', {
                ensureVisible: isMinimized(windowData),
                focusWindow: true
            });
        }

        return snapWindow(windowData.windowId, 'top', {
            ensureVisible: isMinimized(windowData),
            focusWindow: true
        });
    }

    function handleDownSnap(windowData) {
        const snapZone = getSnapZone(windowData);

        if (isMaximized(windowData)) {
            return toggleMaximize(windowData.windowId);
        }

        const bottomQuadrant = getBottomQuadrant(snapZone);
        if (bottomQuadrant) {
            return snapWindow(windowData.windowId, bottomQuadrant, {
                ensureVisible: isMinimized(windowData),
                focusWindow: true
            });
        }

        if (snapZone === 'bottom-left' || snapZone === 'bottom-right') {
            return minimizeWindow(windowData.windowId);
        }

        if (isMinimized(windowData)) {
            return false;
        }

        return minimizeWindow(windowData.windowId);
    }

    function handleShortcutKey(key) {
        if (!ARROW_KEYS.has(key) || isStartSurfaceVisible()) {
            return false;
        }

        const windowData = getActiveWindowData();
        if (!canSnapWindow(windowData)) {
            return false;
        }

        switch (key) {
            case 'ArrowLeft':
                return handleHorizontalSnap(windowData, 'left');
            case 'ArrowRight':
                return handleHorizontalSnap(windowData, 'right');
            case 'ArrowUp':
                return handleUpSnap(windowData);
            case 'ArrowDown':
                return handleDownSnap(windowData);
            default:
                return false;
        }
    }

    function handleKeydown(event) {
        return handleShortcutKey(event?.key);
    }

    window.SnapShortcutShell = {
        handleKeydown,
        handleShortcutKey
    };
})();
