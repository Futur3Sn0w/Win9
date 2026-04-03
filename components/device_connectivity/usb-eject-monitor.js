/**
 * USB Eject Monitor
 * Manages the system tray icon for safely removing USB drives
 * and provides a context menu for ejecting drives
 */

(function () {
    'use strict';

    const { ipcRenderer } = require('electron');

    // DOM Elements
    const $ejectIcon = $('#eject-icon');
    const $ejectContextMenu = $('#eject-icon-context-menu');

    // Track currently connected removable drives that belong in the eject tray.
    let connectedUSBDrives = new Map();

    function isTrayEligibleDrive(driveData) {
        if (!driveData || driveData.isSystem || driveData.isVirtual) {
            return false;
        }

        if (typeof driveData.trayEligible === 'boolean') {
            return driveData.trayEligible;
        }

        return Boolean(driveData.isUSB || driveData.isRemovable || driveData.isCard);
    }

    /**
     * Update the visibility of the eject icon based on connected drives
     */
    function updateEjectIconVisibility() {
        if (connectedUSBDrives.size > 0) {
            $ejectIcon.show();
        } else {
            $ejectIcon.hide();
            hideContextMenu();
        }
    }

    /**
     * Get drive friendly name for display
     */
    function getDriveName(drive) {
        // Try mountpoint label first
        if (drive.mountpoints && drive.mountpoints.length > 0) {
            const labeledMount = drive.mountpoints.find(mp => mp.label);
            if (labeledMount && labeledMount.label) {
                return labeledMount.label;
            }
            // Try path (drive letter)
            if (drive.mountpoints[0].path) {
                const path = drive.mountpoints[0].path;
                // Extract drive letter for Windows (e.g., "E:\" -> "E:")
                const driveLetter = path.match(/^([A-Z]:)/);
                if (driveLetter) {
                    return `Drive (${driveLetter[1]})`;
                }
                return path;
            }
        }
        // Fall back to description
        return drive.description || 'Removable Drive';
    }

    /**
     * Show the context menu for the eject icon
     */
    function showContextMenu(event) {
        event.preventDefault();
        event.stopPropagation();

        // Close all taskbar popups and menus first (mutual exclusion)
        if (typeof window.closeAllTaskbarPopupsAndMenus === 'function') {
            window.closeAllTaskbarPopupsAndMenus();
        }

        // Build menu content
        const menuItems = buildMenuItems();

        // Set menu HTML directly (no nested div needed)
        const menuHTML = menuItems.join('');
        $ejectContextMenu.html(menuHTML);

        // Set width and ensure pointer events work
        $ejectContextMenu.css({
            'width': '200px',
            'pointer-events': 'auto',
            'z-index': '10000'
        });

        // Position menu centered above the eject icon
        positionMenu();

        // Disable pointer events on all iframes and webviews
        $('.classic-window-iframe, .modern-app-iframe, webview').css('pointer-events', 'none');

        // Show menu
        $ejectContextMenu.css('display', 'flex');
    }

    /**
     * Build menu items
     */
    function buildMenuItems() {
        const items = [];

        // First item: "Open Devices and Printers" (disabled)
        items.push(`
            <div class="classic-context-menu-item is-disabled">
                <span class="classic-context-menu-item-icon">
                    <img src="resources/images/icons/charms_devices.png" alt="" style="width: 16px; height: 16px;" />
                </span>
                <span class="classic-context-menu-item-text">Open Devices and Printers</span>
            </div>
        `);

        // Separator
        items.push(`<div class="classic-context-menu-separator"></div>`);

        // Add an item for each connected removable drive
        if (connectedUSBDrives.size === 0) {
            items.push(`
                <div class="classic-context-menu-item is-disabled">
                    <span class="classic-context-menu-item-icon"></span>
                    <span class="classic-context-menu-item-text">No removable drives detected</span>
                </div>
            `);
        } else {
            connectedUSBDrives.forEach((drive, devicePath) => {
                const driveName = getDriveName(drive);
                const driveIcon = drive.icon || 'sui-usb';

                items.push(`
                    <div class="classic-context-menu-item eject-drive-item" data-device-path="${devicePath}">
                        <span class="classic-context-menu-item-icon">
                            <span class="${driveIcon}"></span>
                        </span>
                        <span class="classic-context-menu-item-text">Eject ${driveName}</span>
                    </div>
                `);
            });
        }

        return items;
    }

    /**
     * Position menu centered above the eject icon
     */
    function positionMenu() {
        const iconRect = $ejectIcon[0].getBoundingClientRect();
        const menuWidth = $ejectContextMenu.outerWidth();
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

        $ejectContextMenu.css({
            left: leftPosition + 'px',
            bottom: '50px' // Position above the taskbar
        });
    }

    /**
     * Hide the context menu
     */
    function hideContextMenu() {
        if ($ejectContextMenu.css('display') === 'none') {
            return;
        }

        // Re-enable pointer events on all iframes and webviews
        $('.classic-window-iframe, .modern-app-iframe, webview').css('pointer-events', 'auto');

        // Hide menu
        $ejectContextMenu.css('display', 'none');
    }

    /**
     * Handle eject button click
     */
    function handleEjectClick(devicePath) {
        const drive = connectedUSBDrives.get(devicePath);
        if (!drive) {
            console.error('[USB EJECT] Drive not found:', devicePath);
            return;
        }

        const driveName = getDriveName(drive);
        console.log('[USB EJECT] Requesting eject for:', driveName, devicePath);

        // Send eject request to main process
        ipcRenderer.send('eject-drive', devicePath);

        // Hide menu immediately
        hideContextMenu();
    }

    /**
     * Handle drive connected event
     */
    function onDriveConnected(driveData) {

        // Only track drives that should appear in the hardware eject tray.
        if (!isTrayEligibleDrive(driveData)) {
            console.log('[USB EJECT] Ignoring drive (not tray-eligible)');
            return;
        }

        const devicePath = driveData.device || driveData.devicePath;
        connectedUSBDrives.set(devicePath, driveData);

        updateEjectIconVisibility();
        console.log('[USB EJECT] Total USB drives:', connectedUSBDrives.size);
    }

    /**
     * Handle drive disconnected event
     */
    function onDriveDisconnected(driveData) {

        const devicePath = driveData.device || driveData.devicePath;
        connectedUSBDrives.delete(devicePath);

        updateEjectIconVisibility();
        console.log('[USB EJECT] Total USB drives:', connectedUSBDrives.size);
    }

    /**
     * Handle eject result from main process
     */
    function onEjectResult(event, result) {
        const { success, devicePath, error } = result;
        const drive = connectedUSBDrives.get(devicePath);
        const driveName = drive ? getDriveName(drive) : 'Drive';

        if (success) {

            // Show success notification
            if (window.notificationManager) {
                window.notificationManager.show({
                    icon: 'sui-accept',
                    title: 'Safe To Remove Hardware',
                    description: `${driveName} can now be safely removed`,
                    duration: 5000
                });
            }

            // Play device disconnect sound
            if (window.systemSounds) {
                window.systemSounds.play('device_disconnect');
            }

            // Remove from our tracking (will be removed by disconnect event too)
            connectedUSBDrives.delete(devicePath);
            updateEjectIconVisibility();
        } else {
            console.error('[USB EJECT] Failed to eject:', driveName, error);

            // Show error notification
            if (window.notificationManager) {
                window.notificationManager.show({
                    icon: 'sui-cancel',
                    title: 'Problem Ejecting USB Mass Storage Device',
                    description: error || `${driveName} is currently in use. Close any programs using the device and try again.`,
                    duration: 0 // Persistent notification for errors
                });
            }

            // Play error sound
            if (window.systemSounds) {
                window.systemSounds.play('critical_stop');
            }
        }
    }

    /**
     * Initialize the USB eject monitor
     */
    function init() {
        console.log('[USB EJECT] Initializing USB Eject Monitor');

        // Listen for drive connection/disconnection events
        ipcRenderer.on('drive-connected', (event, driveData) => {
            onDriveConnected(driveData);
        });

        ipcRenderer.on('drive-disconnected', (event, driveData) => {
            onDriveDisconnected(driveData);
        });

        // Listen for eject results
        ipcRenderer.on('eject-result', onEjectResult);

        // Show context menu on left or right click
        $ejectIcon.on('click contextmenu', function (e) {
            showContextMenu(e);
        });

        // Handle eject button clicks
        $(document).on('click', '.eject-drive-item', function (e) {
            e.preventDefault();
            e.stopPropagation();

            const devicePath = $(this).attr('data-device-path');
            handleEjectClick(devicePath);
        });


        // Click outside to close menu
        $(document).on('click', function (e) {
            if (!$(e.target).closest('#eject-icon-context-menu, #eject-icon').length) {
                hideContextMenu();
            }
        });

        // Request initial drive list from main process after a short delay
        // to ensure the main process USB monitor is fully initialized
        setTimeout(() => {
            console.log('[USB EJECT] Requesting initial drive list...');
            ipcRenderer.send('get-drive-list');
        }, 1000);

        console.log('[USB EJECT] Initialization complete');
    }

    // Initialize when DOM is ready
    $(document).ready(function () {
        init();
    });

    // Export for debugging
    window.USBEjectMonitor = {
        connectedUSBDrives,
        showContextMenu,
        hideContextMenu
    };
})();
