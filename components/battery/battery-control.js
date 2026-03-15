/**
 * Battery Control Module
 * Handles system battery status retrieval using Electron's powerMonitor API
 * This module runs in the main process
 */

const { powerMonitor } = require('electron');

/**
 * Get current battery status
 * @returns {Promise<{level: number, charging: boolean, batteryPresent: boolean}>}
 */
async function getBatteryStatus() {
    try {
        // Check if battery is present (some desktop machines don't have batteries)
        const isOnBattery = powerMonitor.isOnBatteryPower();

        // On some systems, we need to check if navigator.getBattery is available
        // However, in Electron main process, we use powerMonitor instead

        // For now, we'll use a simple approach:
        // - If on AC power and never been on battery, might not have a battery
        // - This is a simplified check; Electron doesn't expose battery presence directly

        return {
            success: true,
            level: 0.75, // Default placeholder - will be updated via IPC from renderer if needed
            charging: !isOnBattery,
            batteryPresent: true, // Assume battery is present by default
            // Note: Electron's powerMonitor doesn't directly expose battery level
            // We'll need to get this from the renderer process using navigator.getBattery()
        };
    } catch (error) {
        console.error('Error getting battery status:', error);
        return {
            success: false,
            level: null,
            charging: false,
            batteryPresent: false
        };
    }
}

/**
 * Start monitoring battery status changes
 * Returns an object with event handlers that can be used to stop monitoring
 */
function startBatteryMonitoring(callback) {
    // Set up event listeners for power state changes
    const onBatteryHandler = () => {
        console.log('System switched to battery power');
        getBatteryStatus().then(callback);
    };

    const onACHandler = () => {
        console.log('System switched to AC power');
        getBatteryStatus().then(callback);
    };

    powerMonitor.on('on-battery', onBatteryHandler);
    powerMonitor.on('on-ac', onACHandler);

    // Return cleanup function
    return {
        stop: () => {
            powerMonitor.removeListener('on-battery', onBatteryHandler);
            powerMonitor.removeListener('on-ac', onACHandler);
        }
    };
}

/**
 * Check if system is on battery power
 * @returns {boolean}
 */
function isOnBatteryPower() {
    return powerMonitor.isOnBatteryPower();
}

module.exports = {
    getBatteryStatus,
    startBatteryMonitoring,
    isOnBatteryPower
};
