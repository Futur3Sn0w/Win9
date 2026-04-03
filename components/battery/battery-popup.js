/**
 * Battery Popup - Manages the popupspritesheet display and frame calculation
 * Provides frame index mapping and spritesheet sizing for the battery popup UI
 */

const POPUP_BATTERY_ICON_SIZES = [32, 64]; // popup@1x = 32px, popup@2x = 64px
const POPUP_BATTERY_BASE_SIZE = 32; // Base size for calculations
const POPUP_BATTERY_SPRITE_FRAME_COUNT = 31; // Total frames in popup spritesheet

// Frame mapping for popup spritesheet (popup@1x and popup@2x)
// 31 total frames: 10 green + 9 yellow + 7 red + 1 empty + 1 no-battery + 2 badges + 1 plug
const POPUP_BATTERY_FRAME_MAP = {
    unpluggedLevels: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],  // Frames 0-9: Green (0%-100% unplugged)
    chargingLevels: [10, 11, 12, 13, 14, 15, 16, 17, 18], // Frames 10-18: Yellow (10%-90% charging)
    lowBatteryWarning: 19,                               // Frame 19: Red battery warning
    error: 20,                                           // Frame 20: Red error state
    empty: 26,                                           // Frame 26: Empty/depleted battery
    noBattery: 27,                                       // Frame 27: No battery detected
    errorBadge: 28,                                      // Frame 28: X badge (error overlay)
    warningBadge: 29,                                    // Frame 29: ! badge (warning overlay)
    plugOverlay: 30                                      // Frame 30: Power plug overlay
};

class BatteryPopup {
    constructor() {
        this.spriteElement = null;
        this.chargeIndicatorElement = null;
        this.statusTextElement = null;
        this.currentStatus = {
            level: 1.0,
            charging: false,
            batteryPresent: true
        };
    }

    /**
     * Initialize popup elements after DOM is ready
     */
    init() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.setup());
        } else {
            this.setup();
        }
    }

    /**
     * Setup DOM elements and determine spritesheet size
     */
    setup() {
        this.spriteElement = document.getElementById('battery-popup-sprite');
        this.chargeIndicatorElement = document.getElementById('battery-popup-charging-indicator');
        this.statusTextElement = document.getElementById('battery-popup-status');

        if (this.spriteElement) {
            // Determine DPI and select appropriate spritesheet
            const dpi = window.devicePixelRatio || 1;
            this.spriteSize = dpi >= 1.5 ? 64 : 32;
            this.initSpritesheet();
        }
    }

    /**
     * Initialize spritesheet background image
     */
    initSpritesheet() {
        const spritesheetFile = this.spriteSize === 64 ? 'popup@2x.png' : 'popup@1x.png';
        const spritesheetPath = `url('resources/images/tray/battery/${spritesheetFile}')`;

        // Set background image for both main battery sprite and charging indicator
        this.spriteElement.style.backgroundImage = spritesheetPath;
        this.chargeIndicatorElement.style.backgroundImage = spritesheetPath;

        this.updateDisplay(this.currentStatus);
    }

    /**
     * Calculate frame index from battery level and charging state
     * @param {number} level - Battery level (0.0 to 1.0)
     * @param {boolean} charging - Whether device is charging
     * @param {boolean} batteryPresent - Whether battery is detected
     * @returns {number} Frame index to display
     */
    calculateFrameIndex(level, charging, batteryPresent) {
        if (!batteryPresent) {
            return POPUP_BATTERY_FRAME_MAP.noBattery;
        }

        if (charging) {
            // For charging, use charging levels 0-8 (10-90%, 9 increments)
            const chargeLevelIndex = Math.floor(level * (POPUP_BATTERY_FRAME_MAP.chargingLevels.length - 1));
            return POPUP_BATTERY_FRAME_MAP.chargingLevels[chargeLevelIndex];
        } else {
            // For unplugged, use unplugged levels 0-9 (0-100%, 10 increments)
            const unpluggedLevelIndex = Math.floor(level * (POPUP_BATTERY_FRAME_MAP.unpluggedLevels.length - 1));
            return POPUP_BATTERY_FRAME_MAP.unpluggedLevels[unpluggedLevelIndex];
        }
    }

    /**
     * Update popup display with battery status
     * @param {Object} status - Battery status object {level, charging, batteryPresent}
     */
    updateDisplay(status) {
        this.currentStatus = status;

        const frameIndex = this.calculateFrameIndex(
            status.level,
            status.charging,
            status.batteryPresent
        );

        // Calculate background position for spritesheet
        const backgroundWidth = POPUP_BATTERY_SPRITE_FRAME_COUNT * this.spriteSize;
        const backgroundOffsetX = frameIndex * -this.spriteSize;

        // Update spritesheet position
        this.spriteElement.style.backgroundPosition = `${backgroundOffsetX}px 0`;
        this.spriteElement.style.backgroundSize = `${backgroundWidth}px ${this.spriteSize}px`;

        // Show/hide charging indicator
        if (status.charging && status.batteryPresent) {
            this.chargeIndicatorElement.classList.add('visible');
            // Set charging indicator (plug icon) background position - frame 30 (last frame)
            const plugOffsetX = POPUP_BATTERY_FRAME_MAP.plugOverlay * -this.spriteSize;
            this.chargeIndicatorElement.style.backgroundPosition = `${plugOffsetX}px 0`;
            this.chargeIndicatorElement.style.backgroundSize = `${backgroundWidth}px ${this.spriteSize}px`;
        } else {
            this.chargeIndicatorElement.classList.remove('visible');
        }

        // Update status text
        this.updateStatusText(status);
    }

    /**
     * Update status text based on battery state
     * @param {Object} status - Battery status object
     */
    updateStatusText(status) {
        if (!status.batteryPresent) {
            this.statusTextElement.textContent = 'No battery detected';
            return;
        }

        const percentage = Math.round(status.level * 100);
        let statusText = '';

        // Debug: Log battery status to console
        console.log('[BatteryPopup] Status:', {
            level: status.level,
            charging: status.charging,
            chargingTime: status.chargingTime,
            dischargingTime: status.dischargingTime,
            batteryPresent: status.batteryPresent
        });

        if (status.charging) {
            // Show time until full when charging
            if (percentage >= 100) {
                statusText = `Fully charged (${percentage}%)`;
            } else {
                statusText = `Charging (${percentage}%)`;

                // Add time remaining if available
                if (status.chargingTime && status.chargingTime !== Infinity && status.chargingTime > 0) {
                    const timeStr = this.formatTime(status.chargingTime);
                    statusText += ` – ${timeStr} until full`;
                }
            }
        } else {
            // Show time remaining when on battery
            if (status.dischargingTime && status.dischargingTime !== Infinity && status.dischargingTime > 0) {
                const timeStr = this.formatTime(status.dischargingTime);
                statusText = `${timeStr} (${percentage}%) remaining`;
            } else {
                statusText = `${percentage}% remaining`;
            }
        }

        this.statusTextElement.textContent = statusText;
    }

    /**
     * Format seconds into human-readable time
     * @param {number} seconds - Time in seconds
     * @returns {string} Formatted time string (e.g., "3 hr 35 min")
     */
    formatTime(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);

        if (hours > 0) {
            return `${hours} hr ${minutes} min`;
        } else if (minutes > 0) {
            return `${minutes} min`;
        } else {
            return 'less than a minute';
        }
    }

    /**
     * Update popup sprite element style for size
     */
    updateElementSize() {
        if (this.spriteElement) {
            this.spriteElement.style.width = `${this.spriteSize}px`;
            this.spriteElement.style.height = `${this.spriteSize}px`;
        }
    }
}

// Export for use in battery-monitor and flyout manager
window.BatteryPopup = BatteryPopup;

// Create global instance
let batteryPopupInstance = null;

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        batteryPopupInstance = new BatteryPopup();
        batteryPopupInstance.init();
        window.batteryPopupInstance = batteryPopupInstance;
    });
} else {
    batteryPopupInstance = new BatteryPopup();
    batteryPopupInstance.init();
    window.batteryPopupInstance = batteryPopupInstance;
}
