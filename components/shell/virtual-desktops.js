/**
 * Virtual Desktops — manages multiple desktops, each with its own set of windows.
 * Windows on inactive desktops are hidden via the `.vd-hidden` CSS class.
 * Exposes window.VirtualDesktops.
 */
(function () {
    'use strict';

    // ── State ──────────────────────────────────────────────────────────
    // Each desktop: { id, label, sequence, lastActiveWindowId }
    const desktops = new Map();
    // windowId → desktopId
    const windowDesktopMap = new Map();
    let activeDesktopId = null;
    let nextDesktopSequence = 0;

    // ── Helpers ────────────────────────────────────────────────────────
    function generateDesktopId() {
        return 'vd-' + Date.now() + '-' + Math.floor(Math.random() * 10000);
    }

    function relabelDesktops() {
        const ordered = getDesktopsOrdered();
        ordered.forEach((desktop, i) => {
            desktop.label = 'Desktop ' + (i + 1);
        });
    }

    function getDesktopsOrdered() {
        return Array.from(desktops.values()).sort((a, b) => a.sequence - b.sequence);
    }

    function emitChange(reason, detail = {}) {
        document.dispatchEvent(new CustomEvent('win8:virtual-desktop-changed', {
            detail: Object.assign({ reason }, detail)
        }));
    }

    // ── Core API ───────────────────────────────────────────────────────

    function getActiveDesktopId() {
        return activeDesktopId;
    }

    function getDesktops() {
        return getDesktopsOrdered();
    }

    function getDesktopCount() {
        return desktops.size;
    }

    function getDesktop(desktopId) {
        return desktops.get(desktopId) || null;
    }

    /**
     * Create a new virtual desktop. Returns its id.
     */
    function addDesktop() {
        const id = generateDesktopId();
        const seq = ++nextDesktopSequence;
        desktops.set(id, {
            id: id,
            label: 'Desktop ' + desktops.size + 1,
            sequence: seq,
            lastActiveWindowId: null
        });
        relabelDesktops();
        console.log('Virtual desktop added:', id, '— total:', desktops.size);
        emitChange('add', { desktopId: id });
        return id;
    }

    /**
     * Remove a desktop. Its windows migrate to the previous (or next) desktop.
     * Cannot remove the last remaining desktop.
     */
    function removeDesktop(desktopId) {
        if (desktops.size <= 1) return false;
        if (!desktops.has(desktopId)) return false;

        const ordered = getDesktopsOrdered();
        const idx = ordered.findIndex(d => d.id === desktopId);

        // Pick target: prefer previous, fall back to next
        const targetDesktop = idx > 0 ? ordered[idx - 1] : ordered[idx + 1];
        const targetId = targetDesktop.id;

        // If removing the active desktop, switch to target first
        if (activeDesktopId === desktopId) {
            setActiveDesktop(targetId);
        }

        // Migrate windows to target
        const windowsToMigrate = getWindowsOnDesktop(desktopId);
        windowsToMigrate.forEach(windowId => {
            windowDesktopMap.set(windowId, targetId);
            // If target is the active desktop, make the window visible
            if (targetId === activeDesktopId) {
                const windowData = window.AppsManager && AppsManager.getRunningWindow(windowId);
                if (windowData && windowData.$container) {
                    windowData.$container[0].classList.remove('vd-hidden');
                }
            }
        });

        desktops.delete(desktopId);
        relabelDesktops();

        console.log('Virtual desktop removed:', desktopId, '→ windows migrated to', targetId);
        emitChange('remove', { desktopId: desktopId, targetDesktopId: targetId });

        // Refresh taskbar to reflect changes
        if (window.AppsManager && typeof AppsManager.updateTaskbar === 'function') {
            AppsManager.updateTaskbar();
        }

        return true;
    }

    /**
     * Switch to a different desktop. Hides/shows windows via .vd-hidden class.
     */
    function setActiveDesktop(desktopId) {
        if (!desktops.has(desktopId)) return;
        if (desktopId === activeDesktopId) return;

        const previousDesktopId = activeDesktopId;

        // Save the currently active window on the old desktop
        if (previousDesktopId && desktops.has(previousDesktopId)) {
            const oldDesktop = desktops.get(previousDesktopId);
            // activeClassicWindow is a global in app.js
            oldDesktop.lastActiveWindowId = window.activeClassicWindow || null;
        }

        activeDesktopId = desktopId;

        // Toggle .vd-hidden on all tracked windows
        if (window.AppsManager) {
            const allWindows = AppsManager.getRunningWindowsSnapshot();
            allWindows.forEach(windowData => {
                if (!windowData.$container) return;
                const el = windowData.$container[0];
                const winDesktop = windowDesktopMap.get(windowData.windowId);
                if (winDesktop === desktopId) {
                    el.classList.remove('vd-hidden');
                } else {
                    el.classList.add('vd-hidden');
                }
            });
        }

        // Restore focus on the new desktop
        const newDesktop = desktops.get(desktopId);
        if (newDesktop.lastActiveWindowId) {
            const windowData = window.AppsManager && AppsManager.getRunningWindow(newDesktop.lastActiveWindowId);
            if (windowData && windowData.$container && !windowData.$container[0].classList.contains('vd-hidden')) {
                // Defer focus so DOM updates settle
                setTimeout(() => {
                    if (typeof window.focusClassicWindow === 'function') {
                        window.focusClassicWindow(newDesktop.lastActiveWindowId);
                    }
                }, 0);
            }
        } else {
            // No last active window — unfocus all
            if (typeof window.unfocusAllClassicWindows === 'function') {
                window.unfocusAllClassicWindows();
            }
        }

        console.log('Switched to virtual desktop:', desktopId);
        emitChange('switch', { desktopId, previousDesktopId });

        // Refresh taskbar
        if (window.AppsManager && typeof AppsManager.updateTaskbar === 'function') {
            AppsManager.updateTaskbar();
        }
    }

    // ── Window ↔ Desktop mapping ───────────────────────────────────────

    function assignNewWindow(windowId) {
        if (!activeDesktopId) return;
        windowDesktopMap.set(windowId, activeDesktopId);
    }

    function removeWindow(windowId) {
        windowDesktopMap.delete(windowId);
    }

    function getWindowDesktopId(windowId) {
        return windowDesktopMap.get(windowId) || null;
    }

    function setWindowDesktop(windowId, desktopId) {
        if (!desktops.has(desktopId)) return;
        windowDesktopMap.set(windowId, desktopId);
        emitChange('window-moved', { windowId, desktopId });
    }

    function getWindowsOnDesktop(desktopId) {
        const result = [];
        windowDesktopMap.forEach((dId, wId) => {
            if (dId === desktopId) result.push(wId);
        });
        return result;
    }

    // ── App ↔ Desktop queries ──────────────────────────────────────────

    /**
     * Returns a Set of desktopIds that have at least one visible (non-background)
     * window for the given appId.
     */
    function getDesktopsForApp(appId) {
        const result = new Set();
        if (!window.AppsManager) return result;

        const windows = AppsManager.getAppWindows(appId);
        windows.forEach(windowData => {
            if (AppsManager.isBackgroundWindow(windowData)) return;
            const dId = windowDesktopMap.get(windowData.windowId);
            if (dId) result.add(dId);
        });
        return result;
    }

    function isAppOnCurrentDesktop(appId) {
        return getDesktopsForApp(appId).has(activeDesktopId);
    }

    function isAppOnOtherDesktop(appId) {
        const desktopIds = getDesktopsForApp(appId);
        for (const dId of desktopIds) {
            if (dId !== activeDesktopId) return true;
        }
        return false;
    }

    // ── Initialisation ─────────────────────────────────────────────────

    function init() {
        // Create the default desktop
        const defaultId = generateDesktopId();
        nextDesktopSequence++;
        desktops.set(defaultId, {
            id: defaultId,
            label: 'Desktop 1',
            sequence: nextDesktopSequence,
            lastActiveWindowId: null
        });
        activeDesktopId = defaultId;

        // Listen for window register/unregister to auto-track
        document.addEventListener('win8:running-windows-changed', function (e) {
            const detail = e.detail || {};
            if (detail.reason === 'register' && detail.windowId) {
                assignNewWindow(detail.windowId);
            } else if (detail.reason === 'unregister' && detail.windowId) {
                removeWindow(detail.windowId);
            }
        });

        console.log('VirtualDesktops initialised — default desktop:', defaultId);
    }

    init();

    // ── Public API ─────────────────────────────────────────────────────
    window.VirtualDesktops = {
        getActiveDesktopId,
        setActiveDesktop,
        getDesktops,
        getDesktopCount,
        getDesktop,
        addDesktop,
        removeDesktop,
        getWindowDesktopId,
        assignNewWindow,
        setWindowDesktop,
        getWindowsOnDesktop,
        getDesktopsForApp,
        isAppOnCurrentDesktop,
        isAppOnOtherDesktop
    };

})();
