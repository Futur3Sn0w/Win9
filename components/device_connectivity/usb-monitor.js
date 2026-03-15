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

    shouldExcludeDrive(drive) {
        // Exclude drives mounted in /private/ directory (Xcode temp drives)
        if (drive.mountpoints && drive.mountpoints.length > 0) {
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

    async updateDriveList() {
        try {
            const drives = await drivelist.list();
            const currentDrives = new Map();
            const currentMountedDrives = new Map();

            // Build map of current drives (all drives, mounted or not)
            drives.forEach(drive => {
                const devicePath = drive.device || drive.devicePath;
                const hasMountpoints = drive.mountpoints && drive.mountpoints.length > 0;

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
                    const previouslyHadMountpoints = previousDrive.mountpoints && previousDrive.mountpoints.length > 0;

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
                const previouslyHadMountpoints = previousDrive.mountpoints && previousDrive.mountpoints.length > 0;

                // Only care about drives that were previously mounted/usable
                if (!previouslyHadMountpoints) {
                    return;
                }

                const stillExists = currentDrives.has(devicePath);
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

        let driveType = 'Drive';
        if (drive.isUSB) {
            driveType = 'USB Drive';
        } else if (drive.isRemovable) {
            driveType = 'Removable Drive';
        }

        if (drive.mountpoints && drive.mountpoints.length > 0) {
            drive.mountpoints.forEach(mp => {
                console.log(`    * ${mp.path}${mp.label ? ' (' + mp.label + ')' : ''}`);
            });
        }

        // Send notification to renderer process
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            const driveName = this.getDriveName(drive);
            const driveIcon = this.getDriveIcon(drive);

            this.mainWindow.webContents.send('drive-connected', {
                name: driveName,
                description: `${driveType} • ${this.formatSize(drive.size)}`,
                icon: driveIcon,
                device: drive.device || drive.devicePath,
                devicePath: drive.device || drive.devicePath,
                mountpoints: drive.mountpoints || [],
                isUSB: drive.isUSB,
                isRemovable: drive.isRemovable,
                isSystem: drive.isSystem,
                suppressNotification: suppressNotification // Flag to suppress UI notification
            });
        }
    }

    onDriveDisconnected(drive) {

        let driveType = 'Drive';
        if (drive.isUSB) {
            driveType = 'USB Drive';
        } else if (drive.isRemovable) {
            driveType = 'Removable Drive';
        }

        // Send notification to renderer process
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            const driveName = this.getDriveName(drive);
            const driveIcon = this.getDriveIcon(drive);

            this.mainWindow.webContents.send('drive-disconnected', {
                name: driveName,
                description: `${driveType} • ${this.formatSize(drive.size)}`,
                icon: driveIcon,
                device: drive.device || drive.devicePath,
                devicePath: drive.device || drive.devicePath,
                isUSB: drive.isUSB,
                isRemovable: drive.isRemovable,
                isSystem: drive.isSystem
            });
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
        if (drive.mountpoints && drive.mountpoints.length > 0) {
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
        if (drive.isUSB) {
            return 'mif-usb';
        } else if (drive.isRemovable) {
            // Could be SD card, removable HDD, etc.
            if (drive.description && drive.description.toLowerCase().includes('sd')) {
                return 'mif-sd-card';
            }
            return 'mif-drive';
        } else {
            return 'mif-drive';
        }
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
}

module.exports = USBMonitor;
