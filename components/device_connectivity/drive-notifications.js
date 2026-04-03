/**
 * Drive Notifications Handler
 * Listens for drive connection events from the main process
 * and displays notifications using the notification component
 */

(function () {
    'use strict';

    // Check if running in Electron renderer process
    if (typeof require === 'undefined') {
        console.warn('[Drive Notifications] Not running in Electron environment');
        return;
    }

    const { ipcRenderer } = require('electron');

    // Listen for drive connected events
    ipcRenderer.on('drive-connected', (event, driveData) => {
        // console.log('[Drive Notifications] Drive connected event received:', driveData);

        // Skip notification if suppressNotification flag is set (startup drives)
        if (driveData.suppressNotification) {
            // console.log('[Drive Notifications] Suppressing notification for startup drive');
            return;
        }

        // Play device connect sound immediately
        if (window.systemSounds) {
            systemSounds.play('device_connect');
        }

        // Show notification using the global notification manager
        // System notifications use ui-accent color (no appId)
        // Add 2s delay for realism (sound plays immediately, notification is delayed)
        if (window.notificationManager) {
            window.notificationManager.show({
                icon: driveData.icon || 'sui-usb',
                title: driveData.name || 'New Drive Connected',
                description: driveData.description || 'Drive connected',
                onClick: () => {
                    handleDriveClick(driveData);
                },
                duration: 0, // Persistent - don't auto-hide
                delay: 2000 // 2 second delay for realism
            });
        } else {
            console.error('[Drive Notifications] Notification manager not available');
        }
    });

    // Listen for drive disconnected events
    ipcRenderer.on('drive-disconnected', (event, driveData) => {
        // console.log('[Drive Notifications] Drive disconnected event received:', driveData);

        // Play device disconnect sound (no notification shown for disconnects)
        if (window.systemSounds) {
            systemSounds.play('device_disconnect');
        }
    });

    /**
     * Handle click on drive notification
     * @param {Object} driveData - Drive information
     */
    function handleDriveClick(driveData) {
        console.log('[Drive Notifications] Drive notification clicked:', driveData);

        // For now, we'll just log the click
        // In the future, this could open File Explorer, show drive properties, etc.

        // If there are mountpoints, we could potentially open the drive
        if (driveData.mountpoints && driveData.mountpoints.length > 0) {
            const mountPath = driveData.mountpoints[0].path;
            console.log('[Drive Notifications] Would open:', mountPath);

            // TODO: Implement action based on device type
            // For example, open File Explorer to the mount point
            // Or show a context menu with options
        }
    }

    console.log('[Drive Notifications] Drive notifications handler initialized');
})();
