/**
 * Battery Monitor - Manages battery status detection and icon updates
 * Uses sprite sheet positioned background images to display battery states
 */

// const { ipcRenderer } = require('electron');

const BATTERY_ICON_SIZES = [16, 24, 32];
const BATTERY_BASE_RENDER_SIZE = 16;
const BATTERY_SPRITE_FRAME_COUNT = 44;

// Charms/TDBN battery sprite sheet constants
const CHARMS_BATTERY_SPRITE_FRAME_COUNT = 32;
const CHARMS_BATTERY_NORMAL_FRAMES  = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];   // 10 normal states
const CHARMS_BATTERY_CHARGING_FRAMES = [10, 11, 12, 13, 14, 15, 16, 17, 18]; // 9 charging states
const BATTERY_FRAME_MAP = {
    unpluggedLevels: [0, 1, 2, 3, 4, 5, 6, 7, 8],
    warning: 18,
    error: 19,
    chargingEmpty: 20,
    noBattery: 30,
    pluggedNoBattery: 31,
    chargingLevels: [33, 34, 35, 36, 37, 38, 39, 40, 41]
};

class BatteryMonitor {
    constructor() {
        this.iconElement = null;
        this.containerElement = null;
        this.baseRenderSize = BATTERY_BASE_RENDER_SIZE;
        this.displaySettingsState = null;
        this.handleViewportChange = this.handleViewportChange.bind(this);
        this.handleDisplaySettingsChange = this.handleDisplaySettingsChange.bind(this);
        this.currentStatus = {
            level: 1.0,
            charging: false,
            batteryPresent: true
        };

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

        this.baseRenderSize = this.measureIconRenderSize();

        // Set up IPC listener for battery status changes
        this.setupIPCListeners();
        this.setupViewportListeners();

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

    setupViewportListeners() {
        window.addEventListener('resize', this.handleViewportChange);
        window.addEventListener('load', this.handleViewportChange, { once: true });
        window.addEventListener('win9-display-settings-changed', this.handleDisplaySettingsChange);
    }

    handleViewportChange() {
        this.updateBatteryIcon();
    }

    handleDisplaySettingsChange(event) {
        this.displaySettingsState = event?.detail?.state || null;
        this.updateBatteryIcon();
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

                    console.log('[BatteryMonitor] Battery API update:', {
                        level: battery.level,
                        charging: battery.charging,
                        chargingTime: battery.chargingTime,
                        dischargingTime: battery.dischargingTime
                    });

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
     * Returns a tentative frame index based on the new 44-frame battery strip.
     * This maps the clearly identifiable families and leaves the ambiguous leaf-only
     * frames unused until the atlas is fully documented.
     */
    getBatteryFrameIndex() {
        const { level, charging, batteryPresent } = this.currentStatus;

        // Error state - battery status unavailable
        if (level === null || level === undefined) {
            return BATTERY_FRAME_MAP.error;
        }

        // No battery present
        if (!batteryPresent) {
            return charging ? BATTERY_FRAME_MAP.pluggedNoBattery : BATTERY_FRAME_MAP.noBattery;
        }

        // Convert level (0.0-1.0) to percentage
        const percentage = Math.round(level * 100);

        // Determine battery level index (0-8 for 10%-100%)
        // 0 = 0-15%, 1 = 16-25%, 2 = 26-35%, etc.
        let levelIndex;
        if (percentage <= 5) {
            // Very low battery
            if (charging) {
                return BATTERY_FRAME_MAP.chargingEmpty;
            } else {
                return BATTERY_FRAME_MAP.warning;
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
            return BATTERY_FRAME_MAP.chargingLevels[levelIndex];
        }

        return BATTERY_FRAME_MAP.unpluggedLevels[levelIndex];
    }

    measureIconRenderSize() {
        if (!this.iconElement) {
            return BATTERY_BASE_RENDER_SIZE;
        }

        const computedStyle = window.getComputedStyle(this.iconElement);
        const width = parseFloat(computedStyle.width) || 0;
        const height = parseFloat(computedStyle.height) || 0;

        return Math.max(width, height, BATTERY_BASE_RENDER_SIZE);
    }

    getBaseRenderSize() {
        return Math.max(this.baseRenderSize || 0, BATTERY_BASE_RENDER_SIZE);
    }

    getIconAssetScaleFactor() {
        if (typeof window.getTaskbarShellButtonAssetScaleFactor === 'function') {
            const scaleFactor = Number(window.getTaskbarShellButtonAssetScaleFactor());
            if (Number.isFinite(scaleFactor) && scaleFactor > 0) {
                return scaleFactor;
            }
        }

        const displayScale = Number(this.displaySettingsState?.display?.scaleFactor) || 0;
        const zoomScale = Number(this.displaySettingsState?.zoomFactor) || 0;
        if (displayScale > 0 && zoomScale > 0) {
            return Math.max(1, displayScale * zoomScale);
        }

        return Math.max(1, Number(window.devicePixelRatio) || 1);
    }

    selectSpriteSheetSize(targetSize) {
        let bestSize = BATTERY_ICON_SIZES[0];
        let bestDistance = Math.abs(targetSize - bestSize);

        for (const size of BATTERY_ICON_SIZES) {
            const distance = Math.abs(targetSize - size);
            if (distance < bestDistance) {
                bestSize = size;
                bestDistance = distance;
                continue;
            }

            if (distance === bestDistance && size < bestSize) {
                bestSize = size;
            }
        }

        return bestSize;
    }

    /**
     * Calculate the sprite frame index for the charms/TDBN battery sheet.
     * Normal states: frames 0–9 (10 levels, 0 = empty … 9 = full)
     * Charging states: frames 10–18 (9 levels, 10 = lowest … 18 = full)
     */
    getCharmsBatteryFrameIndex() {
        const { level, charging, batteryPresent } = this.currentStatus;

        if (!batteryPresent || level === null || level === undefined) {
            return null; // caller should hide the icon
        }

        const percentage = Math.round(level * 100);

        // Map percentage to a 0–9 normal level index
        let normalIndex;
        if (percentage <= 5)       normalIndex = 0;
        else if (percentage <= 15) normalIndex = 1;
        else if (percentage <= 25) normalIndex = 2;
        else if (percentage <= 35) normalIndex = 3;
        else if (percentage <= 45) normalIndex = 4;
        else if (percentage <= 55) normalIndex = 5;
        else if (percentage <= 65) normalIndex = 6;
        else if (percentage <= 75) normalIndex = 7;
        else if (percentage <= 85) normalIndex = 8;
        else                       normalIndex = 9;

        if (charging) {
            // Charging has 9 frames; clamp the top of the normal range down by one
            const chargingIndex = Math.min(normalIndex, CHARMS_BATTERY_CHARGING_FRAMES.length - 1);
            return CHARMS_BATTERY_CHARGING_FRAMES[chargingIndex];
        }

        return CHARMS_BATTERY_NORMAL_FRAMES[normalIndex];
    }

    /**
     * Update the battery sprite in the TDBN panel
     */
    updateTdbnBatteryIcon() {
        const tdbnBattery = document.getElementById('tdbn-battery-icon');
        if (!tdbnBattery) return;

        const frameIndex = this.getCharmsBatteryFrameIndex();

        if (frameIndex === null) {
            tdbnBattery.style.display = 'none';
            return;
        }

        const renderSize = 32;
        const backgroundOffsetX = frameIndex * -renderSize;
        const backgroundWidth = renderSize * CHARMS_BATTERY_SPRITE_FRAME_COUNT;

        tdbnBattery.style.display = '';
        tdbnBattery.style.backgroundImage = `url('resources/images/icons/charms/TDBN/bat/44.png')`;
        tdbnBattery.style.backgroundPosition = `${backgroundOffsetX}px 0`;
        tdbnBattery.style.backgroundSize = `${backgroundWidth}px ${renderSize}px`;
    }

    /**
     * Updates the battery icon using CSS background-position for sprite sheet
     */
    updateBatteryIcon() {
        if (!this.iconElement) {
            return;
        }

        const frameIndex = this.getBatteryFrameIndex();
        const scaleFactor = this.getIconAssetScaleFactor();
        const targetAssetSize = Math.max(1, Math.ceil(this.getBaseRenderSize() * scaleFactor));
        const spriteSheetSize = this.selectSpriteSheetSize(targetAssetSize);
        const renderSize = this.getBaseRenderSize();
        const backgroundOffsetX = frameIndex * -renderSize;
        const backgroundWidth = renderSize * BATTERY_SPRITE_FRAME_COUNT;

        // Scale the higher-resolution strip into the logical tray icon box.
        this.iconElement.style.width = `${renderSize}px`;
        this.iconElement.style.height = `${renderSize}px`;
        this.iconElement.style.backgroundImage = `url('resources/images/tray/battery/${spriteSheetSize}.png')`;
        this.iconElement.style.backgroundPosition = `${backgroundOffsetX}px 0`;
        this.iconElement.style.backgroundRepeat = 'no-repeat';
        this.iconElement.style.backgroundSize = `${backgroundWidth}px ${renderSize}px`;
        this.iconElement.style.imageRendering = 'auto';

        // Log for debugging
        this.logBatteryStatus(frameIndex);

        // Update tooltip
        this.updateTooltip();

        // Update popup if visible
        this.updateBatteryPopup();

        // Update TDBN battery icon
        this.updateTdbnBatteryIcon();
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
     * Update the battery popup display if available
     */
    updateBatteryPopup() {
        if (window.BatteryPopup && window.batteryPopupInstance) {
            window.batteryPopupInstance.updateDisplay(this.currentStatus);
        }
    }

    /**
     * Cleanup when page unloads
     */
    async cleanup() {
        window.removeEventListener('resize', this.handleViewportChange);
        window.removeEventListener('win9-display-settings-changed', this.handleDisplaySettingsChange);
        await ipcRenderer.invoke('stop-battery-monitoring');
    }
}

// Initialize the battery monitor when the script loads
const batteryMonitor = new BatteryMonitor();
window.batteryMonitor = batteryMonitor;

// Cleanup on window unload
window.addEventListener('beforeunload', () => {
    batteryMonitor.cleanup();
});

// Export for potential use by other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = BatteryMonitor;
}
