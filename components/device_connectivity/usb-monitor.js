const drivelist = require('drivelist');

class USBMonitor {
    constructor(mainWindow = null) {
        this.isMonitoring = false;
        this.pollInterval = null;
        this.previousDrives = new Map();
        this.checkIntervalMs = 2000; // Check every 2 seconds
        this.mainWindow = mainWindow;
        this.isInitialScan = true; // Flag to suppress notifications on first scan
    }

    async start() {
        if (this.isMonitoring) {
            console.log('[Drive Monitor] Already monitoring drives');
            return;
        }

        console.log('[Drive Monitor] Starting drive monitoring...');
        this.isMonitoring = true;

        // Get initial drive list
        await this.updateDriveList();

        // Start polling for changes
        this.pollInterval = setInterval(async () => {
            await this.updateDriveList();
        }, this.checkIntervalMs);

        console.log('[Drive Monitor] Drive monitoring started');
    }

    stop() {
        if (!this.isMonitoring) {
            console.log('[Drive Monitor] Not currently monitoring');
            return;
        }

        console.log('[Drive Monitor] Stopping drive monitoring...');

        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }

        this.isMonitoring = false;
        this.previousDrives.clear();
        console.log('[Drive Monitor] Drive monitoring stopped');
    }

    hasMountpoints(drive) {
        return Array.isArray(drive?.mountpoints) && drive.mountpoints.length > 0;
    }

    shouldExcludeDrive(drive) {
        // Exclude drives mounted in /private/ directory (Xcode temp drives)
        if (this.hasMountpoints(drive)) {
            for (const mp of drive.mountpoints) {
                if (mp.path && mp.path.startsWith('/private/')) {
                    console.log('[Drive Monitor] Excluding Xcode temp drive:', mp.path);
                    return true;
                }
            }
        }

        // Exclude drives with "Xcode" in description
        if (drive.description && drive.description.includes('Xcode')) {
            console.log('[Drive Monitor] Excluding Xcode drive:', drive.description);
            return true;
        }

        // Exclude drives with "Xcode" in the device path
        const devicePath = drive.device || drive.devicePath;
        if (devicePath && devicePath.includes('Xcode')) {
            console.log('[Drive Monitor] Excluding Xcode drive:', devicePath);
            return true;
        }

        return false;
    }

    isExternalRemovableDrive(drive) {
        if (!drive || drive.isSystem || drive.isVirtual) {
            return false;
        }

        const busType = typeof drive.busType === 'string' ? drive.busType.toUpperCase() : '';
        const enumerator = typeof drive.enumerator === 'string' ? drive.enumerator.toUpperCase() : '';

        if (drive.isUSB || busType === 'USB' || drive.isUAS) {
            return true;
        }

        if (drive.isCard || busType === 'SD' || busType === 'MMC') {
            return true;
        }

        if (drive.isRemovable && enumerator !== 'IDE' && enumerator !== 'SCSI') {
            return true;
        }

        return drive.isRemovable && this.hasMountpoints(drive);
    }

    getDriveType(drive) {
        const busType = typeof drive?.busType === 'string' ? drive.busType.toUpperCase() : '';

        if (drive?.isUSB || busType === 'USB' || drive?.isUAS) {
            return 'USB Drive';
        }

        if (drive?.isCard || busType === 'SD' || busType === 'MMC') {
            return 'Memory Card';
        }

        if (drive?.isRemovable) {
            return 'Removable Drive';
        }

        return 'Drive';
    }

    buildDrivePayload(drive, suppressNotification = false) {
        const devicePath = drive.device || drive.devicePath;

        return {
            name: this.getDriveName(drive),
            description: `${this.getDriveType(drive)} - ${this.formatSize(drive.size)}`,
            icon: this.getDriveIcon(drive),
            device: devicePath,
            devicePath,
            mountpoints: drive.mountpoints || [],
            busType: drive.busType || '',
            enumerator: drive.enumerator || '',
            isUSB: Boolean(drive.isUSB),
            isRemovable: Boolean(drive.isRemovable),
            isCard: Boolean(drive.isCard),
            isUAS: Boolean(drive.isUAS),
            isSystem: Boolean(drive.isSystem),
            isVirtual: Boolean(drive.isVirtual),
            trayEligible: this.isExternalRemovableDrive(drive),
            suppressNotification
        };
    }

    async updateDriveList() {
        try {
            const drives = await drivelist.list();
            const currentDrives = new Map();
            const currentMountedDrives = new Map();

            // Build map of current drives (all drives, mounted or not)
            drives.forEach(drive => {
                const devicePath = drive.device || drive.devicePath;
                const hasMountpoints = this.hasMountpoints(drive);

                // Filter out Xcode temporary drives
                if (this.shouldExcludeDrive(drive)) {
                    return;
                }

                currentDrives.set(devicePath, drive);

                // Track which drives are actually mounted and usable
                if (hasMountpoints) {
                    currentMountedDrives.set(devicePath, drive);
                }
            });

            // Detect newly mounted drives (connected and ready to use)
            currentMountedDrives.forEach((drive, devicePath) => {
                if (!this.previousDrives.has(devicePath)) {
                    // Brand new drive
                    this.onDriveConnected(drive, this.isInitialScan);
                } else {
                    // Drive existed before - check if it was previously unmounted
                    const previousDrive = this.previousDrives.get(devicePath);
                    const previouslyHadMountpoints = this.hasMountpoints(previousDrive);

                    if (!previouslyHadMountpoints) {
                        // Drive was unmounted but now has mountpoints again (rare case)
                        this.onDriveConnected(drive, false);
                    }
                }
            });

            // After first scan, clear the initial scan flag
            if (this.isInitialScan) {
                this.isInitialScan = false;
            }

            // Detect drives that became unavailable (either ejected or physically removed)
            this.previousDrives.forEach((previousDrive, devicePath) => {
                const previouslyHadMountpoints = this.hasMountpoints(previousDrive);

                // Only care about drives that were previously mounted/usable
                if (!previouslyHadMountpoints) {
                    return;
                }

                const stillMounted = currentMountedDrives.has(devicePath);

                // Drive was ejected (unmounted) OR physically removed
                if (!stillMounted) {
                    this.onDriveDisconnected(previousDrive);
                }
            });

            // Update previous drives list with ALL current drives (mounted or not)
            this.previousDrives = currentDrives;
        } catch (error) {
            console.error('[Drive Monitor] Error updating drive list:', error);
        }
    }

    onDriveConnected(drive, suppressNotification = false) {
        // Some example information we can use later on
        // console.log('[Drive Monitor] Drive connected:');
        // console.log('  - Device:', drive.device || drive.devicePath || 'Unknown');
        // console.log('  - Description:', drive.description || 'Unknown');
        // console.log('  - Size:', this.formatSize(drive.size));
        // console.log('  - Removable:', drive.isRemovable ? 'Yes' : 'No');
        // console.log('  - System:', drive.isSystem ? 'Yes' : 'No');

        if (this.hasMountpoints(drive)) {
            drive.mountpoints.forEach(mp => {
                console.log(`    * ${mp.path}${mp.label ? ' (' + mp.label + ')' : ''}`);
            });
        }

        // Send notification to renderer process
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('drive-connected', this.buildDrivePayload(drive, suppressNotification));
        }
    }

    onDriveDisconnected(drive) {
        // Send notification to renderer process
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('drive-disconnected', this.buildDrivePayload(drive));
        }
    }

    formatSize(bytes) {
        if (!bytes) return 'Unknown';

        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        if (bytes === 0) return '0 B';

        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        const size = (bytes / Math.pow(1024, i)).toFixed(2);

        return `${size} ${sizes[i]}`;
    }

    getDriveName(drive) {
        // Try to get a friendly name from mountpoint label
        if (this.hasMountpoints(drive)) {
            const labeledMount = drive.mountpoints.find(mp => mp.label);
            if (labeledMount && labeledMount.label) {
                return labeledMount.label;
            }

            // Return first mountpoint path if no label
            if (drive.mountpoints[0].path) {
                return drive.mountpoints[0].path;
            }
        }

        // Fall back to description or device path
        return drive.description || drive.device || drive.devicePath || 'Unknown Drive';
    }

    getDriveIcon(drive) {
        // Determine icon based on drive type
        const busType = typeof drive?.busType === 'string' ? drive.busType.toLowerCase() : '';

        if (drive.isUSB || busType === 'usb' || drive.isUAS) {
            return 'sui-usb';
        }

        if (drive.isCard || busType === 'sd' || busType === 'mmc') {
            return 'sui-sd-card';
        }

        if (drive.isRemovable) {
            if (drive.description && drive.description.toLowerCase().includes('sd')) {
                return 'sui-sd-card';
            }

            return 'sui-drive';
        }

        return 'sui-drive';
    }

    async getDrives() {
        try {
            const drives = await drivelist.list();
            return drives;
        } catch (error) {
            console.error('[Drive Monitor] Error getting drives:', error);
            return [];
        }
    }

    async getDevices() {
        return this.getDrives();
    }
}

module.exports = USBMonitor;
