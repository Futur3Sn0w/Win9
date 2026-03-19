/**
 * Taskbar Item Context Menu
 * Handles right-click context menu for taskbar items
 */

(function () {
    'use strict';

    // DOM Elements
    const $contextMenu = $('#taskbar-item-context-menu');
    let currentAppId = null;
    let currentAppData = null;
    let hideTimeoutId = null;
    const TASKBAR_CONTEXT_ICON_SIZES = {
        close: [16, 20, 24, 32],
        pin: [16, 20, 24, 32, 40, 48, 64, 80, 96, 128, 256],
        unpin: [16, 20, 24, 32, 40, 48, 64, 80, 96, 128, 256]
    };

    function getTaskbarContextIconPath(iconName, desiredSize = 16) {
        const sizes = TASKBAR_CONTEXT_ICON_SIZES[iconName];
        if (!Array.isArray(sizes) || sizes.length === 0) {
            return `resources/images/icons/context menus/taskbar/${iconName}/16.png`;
        }

        const exactSizes = sizes.filter(size => size === desiredSize);
        const largerSizes = sizes.filter(size => size > desiredSize);
        const smallerSizes = sizes.filter(size => size < desiredSize).sort((left, right) => right - left);
        const candidateSize = [...exactSizes, ...largerSizes, ...smallerSizes][0] || 16;

        return `resources/images/icons/context menus/taskbar/${iconName}/${candidateSize}.png`;
    }

    /**
     * Show the context menu for a taskbar item
     */
    function showContextMenu(appId, $taskbarIcon) {
        console.log('[CONTEXT MENU] showContextMenu called for:', appId);

        // Close all taskbar popups and menus first (mutual exclusion)
        if (typeof window.closeAllTaskbarPopupsAndMenus === 'function') {
            window.closeAllTaskbarPopupsAndMenus();
        }

        if (hideTimeoutId) {
            clearTimeout(hideTimeoutId);
            hideTimeoutId = null;
        }

        currentAppId = appId;
        currentAppData = AppsManager.getAppById(appId);

        if (!currentAppData) {
            console.error('[CONTEXT MENU] App not found:', appId);
            return;
        }

        console.log('[CONTEXT MENU] App data:', currentAppData);

        // Build menu content
        const menuItems = buildMenuItems(currentAppData);
        console.log('[CONTEXT MENU] Built', menuItems.length, 'menu items');

        // Create menu HTML
        const menuHTML = `
            <div class="taskbar-item-context-menu-content">
                ${menuItems.join('')}
            </div>
        `;

        $contextMenu.html(menuHTML);
        console.log('[CONTEXT MENU] Menu HTML set:', menuHTML);

        // Attach click handlers directly to the buttons (in addition to delegated handler)
        $contextMenu.find('.taskbar-item-context-menu-item').each(function () {
            const $button = $(this);
            const action = $button.attr('data-action');
            console.log('[CONTEXT MENU] Found button with action:', action);

            // Attach direct click handler
            $button.off('click').on('click', function (e) {
                console.log('[CONTEXT MENU] DIRECT HANDLER - Button clicked!', action);
                e.preventDefault();
                e.stopPropagation();
                handleMenuAction(action);
            });
        });

        // Position menu centered above the taskbar icon
        positionMenu($taskbarIcon);

        // Disable pointer events on all iframes and webviews
        $('.classic-window-iframe, .modern-app-iframe, webview').css('pointer-events', 'none');

        // Show menu with animation
        $contextMenu.removeClass('exiting');
        $contextMenu.css('display', 'flex');
        // Trigger reflow to ensure the transition happens
        $contextMenu[0].offsetHeight;
        $contextMenu.addClass('visible');

        console.log('[CONTEXT MENU] Menu visible, buttons in DOM:', $contextMenu.find('.taskbar-item-context-menu-item').length);
    }

    /**
     * Hide the context menu
     */
    function hideContextMenu() {
        if (hideTimeoutId) {
            clearTimeout(hideTimeoutId);
            hideTimeoutId = null;
        }

        const isVisible = $contextMenu.hasClass('visible') || $contextMenu.css('display') !== 'none';

        if (!isVisible) {
            $('.classic-window-iframe, .modern-app-iframe, webview').css('pointer-events', 'auto');
            return;
        }

        // Animate out
        $contextMenu.removeClass('visible').addClass('exiting');

        // Re-enable pointer events on all iframes and webviews
        $('.classic-window-iframe, .modern-app-iframe, webview').css('pointer-events', 'auto');

        // After animation completes, hide completely
        hideTimeoutId = setTimeout(() => {
            $contextMenu.css('display', 'none');
            $contextMenu.removeClass('exiting');
            currentAppId = null;
            currentAppData = null;
            hideTimeoutId = null;
        }, 150); // Match the CSS transition duration
    }

    /**
     * Build menu items based on app state
     */
    function buildMenuItems(app) {
        const items = [];
        const isRunning = AppsManager.isAppRunning(app.id);
        const isPinnedToTaskbar = app.pinnedToTaskbar || false;
        const windowCount = AppsManager.getAppWindowCount ? AppsManager.getAppWindowCount(app.id) : 0;
        const hasMultipleWindows = windowCount > 1;

        // Item 1: Activate app (with app icon and name)
        // Use 16px icon if available, otherwise fall back to MIF icon
        const icon16 = AppsManager.getIconImage ? AppsManager.getIconImage(app, 16) : null;
        let iconHTML;

        if (icon16) {
            // Use the 16px icon image
            const plateClass = app.type === 'modern' && app.color ? `context-icon-plate--${app.color}` : '';
            iconHTML = `<span class="taskbar-item-context-menu-item-icon ${plateClass}">
                <img src="${icon16}" alt="" style="width: 16px; height: 16px;" />
            </span>`;
        } else {
            // Fall back to MIF icon with plate for modern apps only
            const plateClass = app.type === 'modern' && app.color ? `context-icon-plate--${app.color}` : '';
            iconHTML = `<span class="taskbar-item-context-menu-item-icon ${plateClass}">
                <span class="${app.icon}"></span>
            </span>`;
        }

        items.push(`
            <button class="taskbar-item-context-menu-item" data-action="activate">
                ${iconHTML}
                <span class="taskbar-item-context-menu-item-text">${app.name}</span>
            </button>
        `);

        // Item 2: Pin/Unpin from taskbar (skip for meta windows)
        const shouldShowPin =
            app.type !== 'meta' && app.type !== 'meta-classic';
        if (shouldShowPin) {
            const pinIconPath = isPinnedToTaskbar
                ? getTaskbarContextIconPath('unpin', 16)
                : getTaskbarContextIconPath('pin', 16);
            const pinText = isPinnedToTaskbar ? 'Unpin this program from taskbar' : 'Pin this program to taskbar';
            items.push(`
                <button class="taskbar-item-context-menu-item" data-action="pin">
                    <span class="taskbar-item-context-menu-item-icon">
                        <img src="${pinIconPath}" alt="" style="width: 16px; height: 16px;" />
                    </span>
                    <span class="taskbar-item-context-menu-item-text">${pinText}</span>
                </button>
            `);
        }

        // Item 3: Close window (only if running)
        if (isRunning) {
            if (hasMultipleWindows) {
                // Show "Close all windows" if multiple windows are open
                items.push(`
                    <button class="taskbar-item-context-menu-item" data-action="close-all">
                        <span class="taskbar-item-context-menu-item-icon">
                            <img src="${getTaskbarContextIconPath('close', 16)}" alt="" style="width: 16px; height: 16px;" />
                        </span>
                        <span class="taskbar-item-context-menu-item-text">Close all windows</span>
                    </button>
                `);
            } else {
                // Show "Close window" for single window
                items.push(`
                    <button class="taskbar-item-context-menu-item" data-action="close">
                        <span class="taskbar-item-context-menu-item-icon">
                            <img src="${getTaskbarContextIconPath('close', 16)}" alt="" style="width: 16px; height: 16px;" />
                        </span>
                        <span class="taskbar-item-context-menu-item-text">Close window</span>
                    </button>
                `);
            }
        }

        return items;
    }

    /**
     * Position menu centered above the taskbar icon
     */
    function positionMenu($taskbarIcon) {
        const iconRect = $taskbarIcon[0].getBoundingClientRect();
        const menuWidth = $contextMenu.outerWidth();
        const iconCenterX = iconRect.left + iconRect.width / 2;

        // Center horizontally above the icon
        let leftPosition = iconCenterX - menuWidth / 2;

        // Ensure menu doesn't go off screen
        const screenWidth = $(window).width();
        if (leftPosition < 10) {
            leftPosition = 10;
        } else if (leftPosition + menuWidth > screenWidth - 10) {
            leftPosition = screenWidth - menuWidth - 10;
        }

        $contextMenu.css({
            left: leftPosition + 'px'
        });
    }

    /**
     * Handle menu item clicks
     */
    function handleMenuAction(action) {
        console.log('[CONTEXT MENU] handleMenuAction called with action:', action);
        console.log('[CONTEXT MENU] currentAppId:', currentAppId);
        console.log('[CONTEXT MENU] currentAppData:', currentAppData);

        if (!currentAppId || !currentAppData) {
            console.error('[CONTEXT MENU] Missing app data, cannot perform action');
            return;
        }

        console.log('[CONTEXT MENU] Executing action:', action);

        switch (action) {
            case 'activate':
                console.log('[CONTEXT MENU] Calling activateApp()');
                activateApp();
                break;
            case 'pin':
                console.log('[CONTEXT MENU] Calling togglePinToTaskbar()');
                togglePinToTaskbar();
                break;
            case 'close':
                console.log('[CONTEXT MENU] Calling closeApp()');
                closeApp();
                break;
            case 'close-all':
                console.log('[CONTEXT MENU] Calling closeAllWindows()');
                closeAllWindows();
                break;
            default:
                console.warn('[CONTEXT MENU] Unknown action:', action);
        }

        console.log('[CONTEXT MENU] Hiding menu');
        hideContextMenu();
    }

    /**
     * Activate the app (same as left-clicking the taskbar icon)
     */
    function activateApp() {
        console.log('[CONTEXT MENU] activateApp() called for:', currentAppId);

        const isRunning = AppsManager.isAppRunning(currentAppId);
        const appState = AppsManager.getAppState(currentAppId);

        console.log('[CONTEXT MENU] isRunning:', isRunning, 'appState:', appState);

        if (!isRunning || appState === null) {
            // App is not running - launch it fresh
            console.log('[CONTEXT MENU] App not running, launching fresh...');
            if (window.launchApp) {
                window.launchApp(currentAppData, null, { fromTaskbar: true });
            }
        } else if (appState === 'active') {
            // App is already active - minimize it
            console.log('[CONTEXT MENU] App is active, minimizing...');
            if (currentAppData.type === 'modern' && window.minimizeModernApp) {
                window.minimizeModernApp(currentAppId);
            } else if (window.minimizeClassicWindow) {
                window.minimizeClassicWindow(currentAppId);
            }
        } else if (appState === 'minimized') {
            // App is minimized - restore it
            console.log('[CONTEXT MENU] App is minimized, restoring...');
            if (currentAppData.type === 'modern' && window.restoreModernApp) {
                window.restoreModernApp(currentAppId);
            } else if (window.restoreClassicWindow) {
                window.restoreClassicWindow(currentAppId);
            }
        }
    }

    /**
     * Toggle pin to taskbar status (separate from Start Screen pinning)
     */
    function togglePinToTaskbar() {
        console.log('Toggling taskbar pin for app:', currentAppId);

        if (AppsManager && typeof AppsManager.toggleTaskbarPin === 'function') {
            AppsManager.toggleTaskbarPin(currentAppId);
        } else {
            console.warn('[TaskbarContextMenu] AppsManager.toggleTaskbarPin() is unavailable');
        }
    }

    /**
     * Close the app window (same as clicking X button)
     */
    function closeApp() {
        console.log('[CONTEXT MENU] closeApp() called');
        console.log('[CONTEXT MENU] App ID:', currentAppId);
        console.log('[CONTEXT MENU] App Type:', currentAppData.type);
        console.log('[CONTEXT MENU] window.closeModernApp exists?', typeof window.closeModernApp);
        console.log('[CONTEXT MENU] window.closeClassicApp exists?', typeof window.closeClassicApp);

        // Call the appropriate close function based on app type
        if (currentAppData.type === 'modern') {
            console.log('[CONTEXT MENU] Calling window.closeModernApp(' + currentAppId + ')');
            window.closeModernApp(currentAppId);
            console.log('[CONTEXT MENU] window.closeModernApp() call completed');
        } else {
            console.log('[CONTEXT MENU] Calling window.closeClassicApp(' + currentAppId + ')');
            window.closeClassicApp(currentAppId);
            console.log('[CONTEXT MENU] window.closeClassicApp() call completed');
        }
    }

    /**
     * Close all windows for the current app
     */
    function closeAllWindows() {
        console.log('[CONTEXT MENU] closeAllWindows() called');
        console.log('[CONTEXT MENU] App ID:', currentAppId);
        console.log('[CONTEXT MENU] App Type:', currentAppData.type);

        // Get all windows for this app
        const windowIds = AppsManager.getAppWindowIds ? AppsManager.getAppWindowIds(currentAppId) : [];
        console.log('[CONTEXT MENU] Found', windowIds.length, 'windows to close');

        // Close each window
        windowIds.forEach(windowId => {
            console.log('[CONTEXT MENU] Closing window:', windowId);
            if (currentAppData.type === 'modern') {
                window.closeModernApp(windowId);
            } else {
                window.closeClassicApp(windowId);
            }
        });

        console.log('[CONTEXT MENU] closeAllWindows() completed');
    }

    /**
     * Save pinned taskbar apps via registry
     */
    function savePinnedTaskbarApps() {
        if (AppsManager && typeof AppsManager.saveTaskbarPins === 'function') {
            AppsManager.saveTaskbarPins();
        } else {
            console.warn('[TaskbarContextMenu] AppsManager.saveTaskbarPins() is unavailable');
        }
    }

    /**
     * Load pinned taskbar apps (with legacy migration)
     */
    function loadPinnedTaskbarApps() {
        const registry = window.TileLayoutRegistry;
        if (registry && typeof registry.loadTaskbarPins === 'function') {
            try {
                const pinnedIds = registry.loadTaskbarPins();
                if (Array.isArray(pinnedIds) && pinnedIds.length) {
                    console.log('[TaskbarContextMenu] Loaded pinned taskbar apps from registry:', pinnedIds);
                    return pinnedIds;
                }
            } catch (error) {
                console.error('[TaskbarContextMenu] Failed to load pinned taskbar apps from registry:', error);
            }
        }

        try {
            const saved = localStorage.getItem('pinnedTaskbarApps');
            if (saved) {
                const pinnedIds = JSON.parse(saved);
                console.log('[TaskbarContextMenu] Loaded pinned taskbar apps from localStorage:', pinnedIds);
                if (registry && typeof registry.saveTaskbarPins === 'function' && Array.isArray(pinnedIds) && pinnedIds.length) {
                    try {
                        registry.saveTaskbarPins(pinnedIds);
                        console.log('[TaskbarContextMenu] Migrated taskbar pins to registry');
                    } catch (error) {
                        console.warn('[TaskbarContextMenu] Failed to migrate taskbar pins to registry:', error);
                    }
                }
                try {
                    localStorage.removeItem('pinnedTaskbarApps');
                } catch (cleanupError) {
                    console.warn('[TaskbarContextMenu] Failed to remove legacy pinnedTaskbarApps key:', cleanupError);
                }
                return Array.isArray(pinnedIds) ? pinnedIds : [];
            }
        } catch (error) {
            console.error('[TaskbarContextMenu] Error loading pinned taskbar apps from localStorage:', error);
        }

        return [];
    }

    /**
     * Initialize the context menu system
     */
    function init() {
        console.log('[CONTEXT MENU] ========================================');
        console.log('[CONTEXT MENU] Initializing Taskbar Item Context Menu');
        console.log('[CONTEXT MENU] ========================================');

        // Load pinned apps from registry and set pinnedToTaskbar property
        const pinnedIds = loadPinnedTaskbarApps();
        console.log('[CONTEXT MENU] Loaded pinned taskbar apps:', pinnedIds);

        if (pinnedIds.length > 0) {
            const allApps = AppsManager.getAllApps();
            console.log('[CONTEXT MENU] Setting pinnedToTaskbar on', pinnedIds.length, 'apps');
            allApps.forEach(app => {
                if (pinnedIds.includes(app.id)) {
                    app.pinnedToTaskbar = true;
                }
            });
        }

        // Right-click on taskbar items to show context menu
        $(document).on('contextmenu', '.taskbar-app', function (e) {
            console.log('[CONTEXT MENU] Right-click detected on taskbar item!');
            e.preventDefault();
            e.stopPropagation();

            const appId = $(this).attr('data-app-id');
            console.log('[CONTEXT MENU] App ID from data-app-id:', appId);

            showContextMenu(appId, $(this));
        });

        // Click on menu items
        $(document).on('click', '.taskbar-item-context-menu-item', function (e) {
            console.log('[CONTEXT MENU] Menu item clicked!');
            console.log('[CONTEXT MENU] Event target:', e.target);
            console.log('[CONTEXT MENU] This element:', this);

            e.stopPropagation();

            const action = $(this).attr('data-action');
            console.log('[CONTEXT MENU] Action from data-action:', action);

            handleMenuAction(action);
        });

        // Click outside to close menu
        $(document).on('click', function (e) {
            if (!$(e.target).closest('.taskbar-item-context-menu, .taskbar-app').length) {
                hideContextMenu();
            }
        });

        // Prevent menu from closing when clicking inside it
        $contextMenu.on('click', function (e) {
            e.stopPropagation();
        });

        console.log('[CONTEXT MENU] Event handlers registered');
        console.log('[CONTEXT MENU] Initialization complete!');
        console.log('[CONTEXT MENU] ========================================');
    }

    // Initialize when DOM is ready AND apps are loaded
    $(document).ready(function () {
        // Wait for taskbar to be ready AND apps to be loaded
        const checkAndInit = () => {
            const appsLoaded = AppsManager && AppsManager.getAllApps && AppsManager.getAllApps().length > 0;
            const taskbarReady = $('body').hasClass('taskbar-visible') || $('body').hasClass('taskbar-autohide');

            if (appsLoaded && taskbarReady) {
                init();
            } else {
                setTimeout(checkAndInit, 100);
            }
        };

        checkAndInit();
    });

    // Export for debugging
    window.TaskbarItemContextMenu = {
        showContextMenu,
        hideContextMenu,
        loadPinnedTaskbarApps
    };
})();
