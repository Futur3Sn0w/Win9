(() => {
    const state = {
        open: false,
        snappedWindowId: null,
        snappedSide: null
    };

    function getPlaceholder() {
        return document.getElementById('snap-assist-placeholder');
    }

    function getGridElement() {
        return document.getElementById('snap-assist-window-grid');
    }

    function getSnappedWindowElement() {
        if (!state.snappedWindowId || !window.AppsManager || typeof window.AppsManager.getRunningWindow !== 'function') {
            return null;
        }

        return window.AppsManager.getRunningWindow(state.snappedWindowId)?.$container?.[0] || null;
    }

    function getAssistSide(snappedSide) {
        // Map snap zones to their opposite zones for snap assist
        const oppositeMap = {
            'left': 'right',
            'right': 'left',
            'top-left': 'top-right',
            'top-right': 'top-left',
            'bottom-left': 'bottom-right',
            'bottom-right': 'bottom-left'
        };
        return oppositeMap[snappedSide] || 'right';
    }

    function isSnapEligibleWindow(windowData) {
        if (!windowData?.windowId || !windowData?.$container?.length) {
            return false;
        }

        return windowData.$container.hasClass('classic-app-container');
    }

    function getCandidateEntries(snappedWindowId) {
        if (!window.TaskViewShell || typeof window.TaskViewShell.getRunningWindowEntries !== 'function') {
            return [];
        }

        return window.TaskViewShell
            .getRunningWindowEntries({
                excludeWindowIds: [snappedWindowId]
            })
            .filter(isSnapEligibleWindow);
    }

    function clearGrid() {
        const grid = getGridElement();
        if (grid) {
            grid.replaceChildren();
        }
    }

    function syncSnappedWindowAnchorState() {
        document.querySelectorAll('.classic-app-container.snap-assist-anchor').forEach((element) => {
            element.classList.remove('snap-assist-anchor');
        });

        if (!state.open) {
            return;
        }

        const snappedWindow = getSnappedWindowElement();
        if (snappedWindow) {
            snappedWindow.classList.add('snap-assist-anchor');
        }
    }

    function applyPlaceholderState() {
        const placeholder = getPlaceholder();
        if (!placeholder) {
            return;
        }

        const isOpen = state.open;
        placeholder.dataset.side = isOpen ? getAssistSide(state.snappedSide) : '';
        placeholder.dataset.snappedSide = isOpen ? state.snappedSide : '';
        placeholder.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
        document.body.classList.toggle('snap-assist-open', isOpen);
        syncSnappedWindowAnchorState();
    }

    function close() {
        if (!state.open) {
            return false;
        }

        state.open = false;
        state.snappedWindowId = null;
        state.snappedSide = null;
        clearGrid();
        applyPlaceholderState();
        return true;
    }

    function handleCardSelect(windowData) {
        const targetSide = getAssistSide(state.snappedSide);
        close();

        if (window.snapClassicWindowToZone && windowData?.windowId) {
            window.snapClassicWindowToZone(windowData.windowId, targetSide, {
                suppressSnapAssist: true,
                ensureVisible: true,
                focusWindow: true
            });
            return;
        }

        if (typeof window.focusClassicWindow === 'function' && windowData?.windowId) {
            window.focusClassicWindow(windowData.windowId);
        }
    }

    async function render() {
        if (!state.open) {
            return false;
        }

        const grid = getGridElement();
        if (!grid || !window.TaskViewShell || typeof window.TaskViewShell.prepareForOpen !== 'function') {
            close();
            return false;
        }

        const entries = getCandidateEntries(state.snappedWindowId);
        if (entries.length === 0) {
            close();
            return false;
        }

        await window.TaskViewShell.prepareForOpen({
            target: grid,
            entries,
            allowCloseButton: false,
            emptyMessage: null,
            cardClassName: 'snap-assist-window-card',
            onCardSelect: handleCardSelect
        });

        return true;
    }

    async function open(options = {}) {
        const snappedWindowId = options.snappedWindowId || null;
        const snappedSide = options.snappedSide;

        // Validate snappedSide - allow left, right, and corner zones
        const validSides = ['left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right'];
        if (!snappedWindowId || !validSides.includes(snappedSide)) {
            return false;
        }

        const candidates = getCandidateEntries(snappedWindowId);
        if (candidates.length === 0) {
            close();
            return false;
        }

        if (typeof window.closeTaskViewPlaceholder === 'function') {
            window.closeTaskViewPlaceholder();
        }

        state.open = true;
        state.snappedWindowId = snappedWindowId;
        state.snappedSide = snappedSide;
        applyPlaceholderState();

        return render();
    }

    function shouldRemainOpen() {
        if (!state.open || !window.AppsManager || typeof window.AppsManager.getRunningWindow !== 'function') {
            return false;
        }

        const snappedWindow = window.AppsManager.getRunningWindow(state.snappedWindowId);
        if (!snappedWindow?.$container?.length) {
            return false;
        }

        const $container = snappedWindow.$container;
        if (!$container.data('isSnapped') || $container.data('snapZone') !== state.snappedSide) {
            return false;
        }

        return window.getComputedStyle($container[0]).display !== 'none';
    }

    function handleDocumentPointerDown(event) {
        if (!state.open) {
            return;
        }

        const target = event.target;
        if (target && typeof target.closest === 'function' && target.closest('.task-view-window-card')) {
            return;
        }

        close();
    }

    function handleKeyDown(event) {
        if (state.open && event.key === 'Escape') {
            close();
        }
    }

    function handleWindowsChanged() {
        if (!state.open) {
            return;
        }

        if (!shouldRemainOpen()) {
            close();
            return;
        }

        syncSnappedWindowAnchorState();
        void render();
    }

    document.addEventListener('pointerdown', handleDocumentPointerDown, true);
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('win9:running-windows-changed', handleWindowsChanged);
    window.addEventListener('resize', handleWindowsChanged);

    window.SnapAssistShell = {
        open,
        close,
        isOpen: () => state.open
    };
})();
