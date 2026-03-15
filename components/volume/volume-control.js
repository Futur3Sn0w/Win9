/**
 * Volume Control Module
 * Handles system volume get/set operations with platform detection
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const execPromise = promisify(exec);

const platform = process.platform;

/**
 * Get current system volume (0-100)
 * @returns {Promise<number>}
 */
async function getVolume() {
    try {
        if (platform === 'darwin') {
            // macOS
            const { stdout } = await execPromise('osascript -e "output volume of (get volume settings)"');
            return parseInt(stdout.trim());
        } else if (platform === 'win32') {
            // Windows - would need nircmd or powershell
            console.warn('Windows volume control not yet implemented');
            return 50;
        } else if (platform === 'linux') {
            // Linux - using amixer
            const { stdout } = await execPromise('amixer get Master | grep -o "[0-9]*%" | head -1 | tr -d "%"');
            return parseInt(stdout.trim());
        }
    } catch (error) {
        console.error('Error getting volume:', error);
        return 50; // Default fallback
    }
}

/**
 * Set system volume (0-100)
 * @param {number} volume - Volume level 0-100
 * @returns {Promise<boolean>}
 */
async function setVolume(volume) {
    try {
        // Clamp volume between 0 and 100
        const clampedVolume = Math.max(0, Math.min(100, Math.round(volume)));

        if (platform === 'darwin') {
            // macOS
            await execPromise(`osascript -e "set volume output volume ${clampedVolume}"`);
            return true;
        } else if (platform === 'win32') {
            // Windows - would need nircmd or powershell
            console.warn('Windows volume control not yet implemented');
            return false;
        } else if (platform === 'linux') {
            // Linux - using amixer
            await execPromise(`amixer set Master ${clampedVolume}%`);
            return true;
        }
    } catch (error) {
        console.error('Error setting volume:', error);
        return false;
    }
}

/**
 * Get mute state
 * @returns {Promise<boolean>}
 */
async function getMuted() {
    try {
        if (platform === 'darwin') {
            // macOS
            const { stdout } = await execPromise('osascript -e "output muted of (get volume settings)"');
            return stdout.trim() === 'true';
        } else if (platform === 'win32') {
            // Windows
            console.warn('Windows mute detection not yet implemented');
            return false;
        } else if (platform === 'linux') {
            // Linux - using amixer
            const { stdout } = await execPromise('amixer get Master | grep -o "\\[on\\]\\|\\[off\\]" | head -1');
            return stdout.trim() === '[off]';
        }
    } catch (error) {
        console.error('Error getting mute state:', error);
        return false;
    }
}

/**
 * Set mute state
 * @param {boolean} muted - True to mute, false to unmute
 * @returns {Promise<boolean>}
 */
async function setMuted(muted) {
    try {
        if (platform === 'darwin') {
            // macOS
            await execPromise(`osascript -e "set volume output muted ${muted}"`);
            return true;
        } else if (platform === 'win32') {
            // Windows
            console.warn('Windows mute control not yet implemented');
            return false;
        } else if (platform === 'linux') {
            // Linux - using amixer
            const muteCommand = muted ? 'mute' : 'unmute';
            await execPromise(`amixer set Master ${muteCommand}`);
            return true;
        }
    } catch (error) {
        console.error('Error setting mute state:', error);
        return false;
    }
}

/**
 * Get both volume and mute state at once (more efficient)
 * @returns {Promise<{volume: number, muted: boolean}>}
 */
async function getVolumeState() {
    try {
        if (platform === 'darwin') {
            // macOS - get both in one call
            const { stdout } = await execPromise('osascript -e "get volume settings"');
            // Parse output like: "output volume:50, input volume:46, alert volume:100, output muted:false"
            const volumeMatch = stdout.match(/output volume:(\d+)/);
            const mutedMatch = stdout.match(/output muted:(true|false)/);

            return {
                volume: volumeMatch ? parseInt(volumeMatch[1]) : 50,
                muted: mutedMatch ? mutedMatch[1] === 'true' : false
            };
        } else {
            // For other platforms, make separate calls
            const [volume, muted] = await Promise.all([getVolume(), getMuted()]);
            return { volume, muted };
        }
    } catch (error) {
        console.error('Error getting volume state:', error);
        return { volume: 50, muted: false };
    }
}

/**
 * Get the appropriate Metro icon class based on volume level and mute state
 * @param {number} volume - Volume level 0-100
 * @param {boolean} muted - Whether audio is muted
 * @returns {string} - Metro icon class name
 */
function getVolumeIcon(volume, muted) {
    if (muted) {
        return 'mif-volume-mute2'; // Muted state
    } else if (volume === 0) {
        return 'mif-volume-mute'; // Volume at 0
    } else if (volume <= 33) {
        return 'mif-volume-low';
    } else if (volume <= 66) {
        return 'mif-volume-medium';
    } else {
        return 'mif-volume-high';
    }
}

module.exports = {
    getVolume,
    setVolume,
    getMuted,
    setMuted,
    getVolumeState,
    getVolumeIcon
};
