/**
 * Battery Monitor - Manages battery status detection and icon updates
 * Uses sprite sheet positioned background images to display battery states
 */

// const { ipcRenderer } = require('electron');

class BatteryMonitor {
    constructor() {
        this.iconElement = null;
        this.containerElement = null;
        this.currentStatus = {
            level: 1.0,
            charging: false,
            batteryPresent: true
        };

        // Sprite sheet configuration - each frame is 16x16px
        this.spriteFrameWidth = 16;
        this.spriteFrameHeight = 16;

        this.init();
    }

    init() {
        // Wait for DOM to be ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.setup());
        } else {
            this.setup();
        }
    }

    async setup() {
        // Get the battery icon image element
        this.iconElement = document.getElementById('battery-icon-img');
        if (!this.iconElement) {
            console.error('Battery icon element not found');
            return;
        }

        // Get the battery icon container for tooltip
        this.containerElement = document.getElementById('battery-icon');
        if (!this.containerElement) {
            console.error('Battery icon container element not found');
            return;
        }

        // Set up IPC listener for battery status changes
        this.setupIPCListeners();

        // Set up Web Battery API monitoring (more accurate than powerMonitor)
        const batteryAPIAvailable = await this.setupBatteryAPI();

        // Only use IPC fallback if Web Battery API is not available
        if (!batteryAPIAvailable) {
            await this.updateBatteryStatus();
        }
    }

    setupIPCListeners() {
        // Listen for battery status changes from main process
        ipcRenderer.on('battery-status-changed', (event, status) => {
            this.currentStatus = status;
            this.updateBatteryIcon();
        });
    }

    /**
     * Set up Web Battery API for accurate battery information
     * This provides real battery level and charging status
     * @returns {Promise<boolean>} True if Battery API is available and working
     */
    async setupBatteryAPI() {
        try {
            if ('getBattery' in navigator) {
                const battery = await navigator.getBattery();

                // Update status from battery API
                const updateFromBattery = () => {
                    this.currentStatus = {
                        level: battery.level,
                        charging: battery.charging,
                        batteryPresent: true,
                        chargingTime: battery.chargingTime,
                        dischargingTime: battery.dischargingTime
                    };
                    this.updateBatteryIcon();
                };

                // Initial update
                updateFromBattery();

                // Listen for battery events
                battery.addEventListener('levelchange', updateFromBattery);
                battery.addEventListener('chargingchange', updateFromBattery);
                battery.addEventListener('chargingtimechange', updateFromBattery);
                battery.addEventListener('dischargingtimechange', updateFromBattery);

                console.log('Web Battery API monitoring started');
                return true;
            } else {
                console.log('Web Battery API not available, using IPC fallback');
                return false;
            }
        } catch (error) {
            console.error('Error setting up Battery API:', error);
            return false;
        }
    }

    /**
     * Get current battery status from main process (fallback method)
     * Only used if Web Battery API is not available
     */
    async updateBatteryStatus() {
        try {
            const result = await ipcRenderer.invoke('get-battery-status');
            if (result.success) {
                this.currentStatus = result;
                this.updateBatteryIcon();
            }
        } catch (error) {
            console.warn('IPC battery status not available, using Web Battery API instead');
            // This is expected when Web Battery API is being used
        }
    }

    /**
     * Calculate which sprite frame to display based on battery state
     * Returns the frame index (0-32) based on the 33-frame sprite sheet
     *
     * Frame layout (33 frames total, 0-32):
     * 0-8:   Unplugged states (10%, 20%, 30%, 40%, 50%, 60%, 70%, 80%, 90%/100%)
     * 9:     Warning badge (yellow triangle)
     * 10:    Error badge (red X)
     * 11:    Plugged in 0-9%
     * 12-20: Fill states (unused - 9 frames)
     * 21:    Plugged in no battery
     * 22:    Plugged in unknown battery state
     * 23:    Plugged in no battery (duplicate)
     * 24-32: Plugged in states (10%, 20%, 30%, 40%, 50%, 60%, 70%, 80%, 90%/100%)
     */
    getBatteryFrameIndex() {
        const { level, charging, batteryPresent } = this.currentStatus;

        // Error state - battery status unavailable
        if (level === null || level === undefined) {
            return 10; // Red X error badge
        }

        // No battery present
        if (!batteryPresent) {
            return charging ? 21 : 21; // Plugged in without battery
        }

        // Convert level (0.0-1.0) to percentage
        const percentage = Math.round(level * 100);

        // Determine battery level index (0-8 for 10%-100%)
        // 0 = 0-15%, 1 = 16-25%, 2 = 26-35%, etc.
        let levelIndex;
        if (percentage <= 5) {
            // Very low battery
            if (charging) {
                return 11; // Charging at 0-9%
            } else {
                return 9; // Warning badge for critically low battery
            }
        } else if (percentage <= 15) {
            levelIndex = 0; // 10%
        } else if (percentage <= 25) {
            levelIndex = 1; // 20%
        } else if (percentage <= 35) {
            levelIndex = 2; // 30%
        } else if (percentage <= 45) {
            levelIndex = 3; // 40%
        } else if (percentage <= 55) {
            levelIndex = 4; // 50%
        } else if (percentage <= 65) {
            levelIndex = 5; // 60%
        } else if (percentage <= 75) {
            levelIndex = 6; // 70%
        } else if (percentage <= 85) {
            levelIndex = 7; // 80%
        } else {
            levelIndex = 8; // 90-100%
        }

        // Return appropriate frame based on charging state
        if (charging) {
            // Frames 24-32 for charging states
            return 24 + levelIndex;
        } else {
            // Frames 0-8 for unplugged states
            return levelIndex;
        }
    }

    /**
     * Updates the battery icon using CSS background-position for sprite sheet
     */
    updateBatteryIcon() {
        if (!this.iconElement) {
            return;
        }

        const frameIndex = this.getBatteryFrameIndex();

        // Calculate the horizontal offset for the sprite
        // Each frame is 16px wide, so offset = frameIndex * -16px
        // Shift left by 1px to prevent right-side cutoff
        const xOffset = (frameIndex * -this.spriteFrameWidth);

        // Apply the sprite sheet as background with proper positioning
        this.iconElement.style.width = `${this.spriteFrameWidth}px`;
        this.iconElement.style.height = `${this.spriteFrameHeight}px`;
        this.iconElement.style.background = `url('resources/images/tray/battery/battery.png') ${xOffset}px 0`;
        this.iconElement.style.imageRendering = 'pixelated';

        // Log for debugging
        this.logBatteryStatus(frameIndex);

        // Update tooltip
        this.updateTooltip();
    }

    /**
     * Update the tooltip text for the battery icon
     */
    updateTooltip() {
        if (!this.containerElement) {
            return;
        }

        const tooltip = this.getTooltipText();
        this.containerElement.setAttribute('title', tooltip);
    }

    /**
     * Generate tooltip text based on current battery status
     */
    getTooltipText() {
        const { level, charging, batteryPresent, chargingTime, dischargingTime } = this.currentStatus;

        if (!batteryPresent) {
            return 'No battery detected - Plugged in';
        }

        if (level === null || level === undefined) {
            return 'Battery status unavailable';
        }

        const percentage = Math.round(level * 100);
        let text = `${percentage}% available`;

        // Add time remaining information if available
        if (charging && chargingTime && chargingTime !== Infinity) {
            const hours = Math.floor(chargingTime / 3600);
            const minutes = Math.floor((chargingTime % 3600) / 60);
            if (hours > 0) {
                text += ` ${hours} hr ${minutes} min until full`;
            } else if (minutes > 0) {
                text += ` ${minutes} min until full`;
            }
        } else if (!charging && dischargingTime && dischargingTime !== Infinity) {
            const hours = Math.floor(dischargingTime / 3600);
            const minutes = Math.floor((dischargingTime % 3600) / 60);
            if (hours > 0) {
                text += ` ${hours} hr ${minutes} min remaining`;
            } else if (minutes > 0) {
                text += ` ${minutes} min remaining`;
            }
        } else {
            // Fallback to simple charging status
            const chargingText = charging ? '(plugged in, charging)' : '(on battery)';
            text += ` ${chargingText}`;
        }

        return text;
    }

    /**
     * Log battery status for debugging
     */
    logBatteryStatus(frameIndex) {
        const { level, charging, batteryPresent } = this.currentStatus;

        const status = {
            percentage: level !== null ? Math.round(level * 100) + '%' : 'unknown',
            charging: charging,
            batteryPresent: batteryPresent,
            spriteFrame: frameIndex
        };

        console.log('Battery status updated:', status);
    }

    /**
     * Get a human-readable description of the current battery status
     */
    getStatusDescription() {
        const { level, charging, batteryPresent } = this.currentStatus;

        if (!batteryPresent) {
            return 'Plugged in (no battery)';
        }

        if (level === null || level === undefined) {
            return 'Battery status unavailable';
        }

        const percentage = Math.round(level * 100);

        if (charging) {
            if (percentage >= 100) {
                return 'Fully charged';
            } else {
                return `${percentage}% - Charging`;
            }
        } else {
            return `${percentage}% - On battery`;
        }
    }

    /**
     * Cleanup when page unloads
     */
    async cleanup() {
        await ipcRenderer.invoke('stop-battery-monitoring');
    }
}

// Initialize the battery monitor when the script loads
const batteryMonitor = new BatteryMonitor();

// Cleanup on window unload
window.addEventListener('beforeunload', () => {
    batteryMonitor.cleanup();
});

// Export for potential use by other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = BatteryMonitor;
}
