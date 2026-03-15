/**
 * System Sounds Component
 * Plays system sound files for various actions, popups, alerts, and notifications
 */

class SystemSounds {
    constructor() {
        this.soundsPath = 'resources/sounds/';
        this.soundMap = {};
        this.soundMapPath = 'components/system_sounds/sound-map.json';
        this.isReady = false;
        this.init();
    }

    /**
     * Initialize the component by loading the sound map from JSON
     */
    async init() {
        await this.loadSoundMap();
        this.isReady = true;
    }

    /**
     * Load the sound map from the JSON file
     */
    async loadSoundMap() {
        try {
            const response = await fetch(this.soundMapPath);
            if (!response.ok) {
                throw new Error(`Failed to load sound map: ${response.statusText}`);
            }
            this.soundMap = await response.json();
            console.log('System sounds map loaded successfully');
        } catch (error) {
            console.error('Error loading sound map:', error);
            // Fallback to empty map
            this.soundMap = {};
        }
    }

    /**
     * Reload the sound map from the JSON file
     * Useful if the JSON file is updated during runtime
     */
    async reloadSoundMap() {
        await this.loadSoundMap();
    }

    /**
     * Play a system sound by its ID
     * @param {string} soundId - The ID of the sound to play (from soundMap)
     * @param {Object} options - Optional parameters
     * @param {number} options.delay - Optional delay in milliseconds before playing (default: 0)
     */
    async play(soundId, options = {}) {
        const {
            delay = 0
        } = options;

        // Wait for sound map to be loaded
        if (!this.isReady) {
            console.warn('Sound map not yet loaded, waiting...');
            await this.init();
        }

        // Validate sound ID
        if (!this.soundMap.hasOwnProperty(soundId)) {
            console.error(`Invalid sound ID: ${soundId}`);
            return;
        }

        const filename = this.soundMap[soundId];

        // Check if filename is configured
        if (!filename || filename === '') {
            console.warn(`Sound ID '${soundId}' has no filename configured`);
            return;
        }

        const soundPath = `${this.soundsPath}${filename}`;

        // Apply delay if specified
        if (delay > 0) {
            await new Promise(resolve => setTimeout(resolve, delay));
        }

        // Play the sound
        this.playSound(soundPath);
    }

    /**
     * Internal method to play a sound file
     * @param {string} soundPath - Path to the sound file
     */
    playSound(soundPath) {
        try {
            // Use HTML5 Audio element at full volume
            // System volume will control the actual output level
            const audio = new Audio(soundPath);
            audio.volume = 1.0;

            // Play the audio
            const playPromise = audio.play();

            if (playPromise !== undefined) {
                playPromise
                    .then(() => {
                        console.log(`Playing sound: ${soundPath}`);
                    })
                    .catch(error => {
                        console.error(`Error playing sound ${soundPath}:`, error);
                    });
            }
        } catch (error) {
            console.error(`Failed to play sound ${soundPath}:`, error);
        }
    }

    /**
     * Get the current sound map
     * @returns {Object} The current sound ID to filename mapping
     */
    getSoundMap() {
        return { ...this.soundMap };
    }

    /**
     * Update the filename for a specific sound ID
     * @param {string} soundId - The sound ID to update
     * @param {string} filename - The new filename
     */
    updateSoundFilename(soundId, filename) {
        if (!this.soundMap.hasOwnProperty(soundId)) {
            console.error(`Invalid sound ID: ${soundId}`);
            return false;
        }

        this.soundMap[soundId] = filename;
        console.log(`Updated sound ID '${soundId}' to filename '${filename}'`);
        return true;
    }

    /**
     * Add a new sound ID to the map
     * @param {string} soundId - The new sound ID
     * @param {string} filename - The filename for the sound
     */
    addSound(soundId, filename = '') {
        if (this.soundMap.hasOwnProperty(soundId)) {
            console.warn(`Sound ID '${soundId}' already exists. Use updateSoundFilename() to modify it.`);
            return false;
        }

        this.soundMap[soundId] = filename;
        console.log(`Added new sound ID '${soundId}' with filename '${filename}'`);
        return true;
    }

    /**
     * List all available sound IDs
     * @returns {Array<string>} Array of all sound IDs
     */
    listSoundIds() {
        return Object.keys(this.soundMap);
    }

    /**
     * Preload a sound file into memory for faster playback
     * @param {string} soundId - The sound ID to preload
     */
    async preload(soundId) {
        if (!this.soundMap.hasOwnProperty(soundId)) {
            console.error(`Invalid sound ID: ${soundId}`);
            return;
        }

        const filename = this.soundMap[soundId];
        if (!filename || filename === '') {
            console.warn(`Sound ID '${soundId}' has no filename configured`);
            return;
        }

        const soundPath = `${this.soundsPath}${filename}`;

        try {
            const audio = new Audio(soundPath);
            audio.preload = 'auto';
            audio.load();
            console.log(`Preloaded sound: ${soundId}`);
        } catch (error) {
            console.error(`Failed to preload sound ${soundId}:`, error);
        }
    }
}

// Create global instance
if (typeof window !== 'undefined') {
    window.systemSounds = new SystemSounds();
}

// Export for Node.js environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SystemSounds;
}
