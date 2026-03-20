/**
 * Wallpaper Color Extraction Utility
 * Extracts the dominant color from the wallpaper image and sets it as a CSS variable
 */

const {
    getWallpaperColorCache,
    saveWallpaperColorCache
} = require('./registry/wallpaper-registry.js');
const ControlPanelColorRegistry = (function () {
    if (typeof window !== 'undefined') {
        if (window.ControlPanelColorRegistry) {
            return window.ControlPanelColorRegistry;
        }
        if (typeof window.require === 'function') {
            try {
                const module = window.require('./registry/control-panel-color-registry.js');
                window.ControlPanelColorRegistry = module;
                return module;
            } catch (error) {
                console.warn('[WallpaperColor] Failed to require control-panel-color-registry.js:', error);
            }
        }
    }
    try {
        return require('./registry/control-panel-color-registry.js');
    } catch {
        return null;
    }
})();

let colorRegistry = null;
if (typeof window !== 'undefined') {
    if (window.ColorRegistry) {
        colorRegistry = window.ColorRegistry;
    } else if (typeof window.require === 'function') {
        try {
            colorRegistry = window.require('./registry/color-registry.js');
            window.ColorRegistry = colorRegistry;
        } catch (error) {
            console.error('[WallpaperColor] Failed to initialize ColorRegistry:', error);
        }
    }
}

function isAccentAutomaticMode() {
    if (colorRegistry && typeof colorRegistry.isAccentAutomatic === 'function') {
        try {
            return colorRegistry.isAccentAutomatic();
        } catch (error) {
            console.warn('[WallpaperColor] isAccentAutomatic check failed:', error);
        }
    }
    return false;
}

function isWallColorAutomatic() {
    if (ControlPanelColorRegistry && typeof ControlPanelColorRegistry.isControlPanelColorAutomatic === 'function') {
        try {
            return ControlPanelColorRegistry.isControlPanelColorAutomatic();
        } catch (error) {
            console.warn('[WallpaperColor] isWallColorAutomatic check failed:', error);
        }
    }
    return true;
}

function setAccentColorHexSafe(hexColor) {
    if (colorRegistry && typeof colorRegistry.setAccentColorHex === 'function') {
        try {
            colorRegistry.setAccentColorHex(hexColor);
        } catch (error) {
            console.warn('[WallpaperColor] Failed to set accent color hex:', error);
        }
    }
}

function parseColorChannels(color) {
    if (typeof color !== 'string') {
        return null;
    }

    const hexMatch = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hexMatch) {
        let hex = hexMatch[1];
        if (hex.length === 3) {
            hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
        }

        return {
            r: parseInt(hex.substring(0, 2), 16),
            g: parseInt(hex.substring(2, 4), 16),
            b: parseInt(hex.substring(4, 6), 16)
        };
    }

    const rgbaMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/i);
    if (rgbaMatch) {
        return {
            r: parseInt(rgbaMatch[1], 10),
            g: parseInt(rgbaMatch[2], 10),
            b: parseInt(rgbaMatch[3], 10)
        };
    }

    return null;
}

function getRelativeLuminance(r, g, b) {
    const rsRGB = r / 255;
    const gsRGB = g / 255;
    const bsRGB = b / 255;

    const rLinear = rsRGB <= 0.03928 ? rsRGB / 12.92 : Math.pow((rsRGB + 0.055) / 1.055, 2.4);
    const gLinear = gsRGB <= 0.03928 ? gsRGB / 12.92 : Math.pow((gsRGB + 0.055) / 1.055, 2.4);
    const bLinear = bsRGB <= 0.03928 ? bsRGB / 12.92 : Math.pow((bsRGB + 0.055) / 1.055, 2.4);

    return 0.2126 * rLinear + 0.7152 * gLinear + 0.0722 * bLinear;
}

function getWallTextContrastColor(color) {
    const channels = parseColorChannels(color);
    if (!channels) {
        return '#ffffff';
    }

    return getRelativeLuminance(channels.r, channels.g, channels.b) > 0.5
        ? '#000000'
        : '#ffffff';
}

function applyWallColorVariables(color, targetDocument = document) {
    if (!targetDocument || !targetDocument.documentElement || !color) {
        return;
    }

    targetDocument.documentElement.style.setProperty('--ui-wall-color', color);
    targetDocument.documentElement.style.setProperty('--ui-wall-text-contrast', getWallTextContrastColor(color));
}

window.applyWallColorVariables = applyWallColorVariables;

class WallpaperColorExtractor {
    constructor() {
        this.wallpaperPath = null;
        this.dominantColor = null;
    }

    /**
     * Extract the wallpaper path from CSS
     */
    getWallpaperPath() {
        if (window.WallpaperController && typeof window.WallpaperController.getCurrentFullPath === 'function') {
            const controllerPath = window.WallpaperController.getCurrentFullPath();
            if (controllerPath) {
                return controllerPath;
            }
        }

        // Try the new wallpaper layer first
        let wallpaperEl = document.getElementById('desktop-wallpaper');

        // Fallback to old desktop element for compatibility
        if (!wallpaperEl) {
            wallpaperEl = document.getElementById('desktop');
        }

        if (!wallpaperEl) return null;

        const style = window.getComputedStyle(wallpaperEl);
        const backgroundImage = style.backgroundImage;

        // Extract URL from background-image property
        const urlMatch = backgroundImage.match(/url\(['"]?(.+?)['"]?\)/);
        if (urlMatch && urlMatch[1]) {
            return urlMatch[1];
        }

        return null;
    }

    /**
     * Load image and extract dominant color
     */
    async extractDominantColor(imagePath) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'Anonymous';

            img.onload = () => {
                try {
                    const color = this.analyzeImage(img);
                    resolve(color);
                } catch (error) {
                    reject(error);
                }
            };

            img.onerror = () => {
                reject(new Error('Failed to load wallpaper image'));
            };

            img.src = imagePath;
        });
    }

    /**
     * Analyze image pixels to find dominant color
     * Uses a simplified color quantization algorithm
     */
    analyzeImage(img) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        // Scale down for performance (analyze smaller version)
        const scaleFactor = 0.1;
        canvas.width = Math.floor(img.width * scaleFactor);
        canvas.height = Math.floor(img.height * scaleFactor);

        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const pixels = imageData.data;

        // Color bucket approach - group similar colors
        const colorBuckets = {};
        const bucketSize = 32; // Reduce color space to 8x8x8 = 512 buckets

        for (let i = 0; i < pixels.length; i += 4) {
            const r = pixels[i];
            const g = pixels[i + 1];
            const b = pixels[i + 2];
            const a = pixels[i + 3];

            // Skip transparent pixels
            if (a < 128) continue;

            // Bucket the color
            const rBucket = Math.floor(r / bucketSize);
            const gBucket = Math.floor(g / bucketSize);
            const bBucket = Math.floor(b / bucketSize);
            const bucketKey = `${rBucket},${gBucket},${bBucket}`;

            if (!colorBuckets[bucketKey]) {
                colorBuckets[bucketKey] = {
                    count: 0,
                    r: 0,
                    g: 0,
                    b: 0
                };
            }

            colorBuckets[bucketKey].count++;
            colorBuckets[bucketKey].r += r;
            colorBuckets[bucketKey].g += g;
            colorBuckets[bucketKey].b += b;
        }

        // Find the most common bucket
        let maxCount = 0;
        let dominantBucket = null;

        for (const key in colorBuckets) {
            if (colorBuckets[key].count > maxCount) {
                maxCount = colorBuckets[key].count;
                dominantBucket = colorBuckets[key];
            }
        }

        if (!dominantBucket) {
            // Fallback to a default color
            return { r: 32, g: 14, b: 101 };
        }

        // Calculate average color in the dominant bucket
        const avgR = Math.round(dominantBucket.r / dominantBucket.count);
        const avgG = Math.round(dominantBucket.g / dominantBucket.count);
        const avgB = Math.round(dominantBucket.b / dominantBucket.count);

        return { r: avgR, g: avgG, b: avgB };
    }

    /**
     * Convert RGB object to CSS rgba string
     */
    rgbToString(color, alpha = 1) {
        return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
    }

    /**
     * Convert RGB object to hex string
     */
    rgbToHex(color) {
        const clamp = (value) => Math.max(0, Math.min(255, Math.round(value)));
        const toHex = (value) => clamp(value).toString(16).padStart(2, '0');
        return `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`.toUpperCase();
    }

    /**
     * Set the dominant color as a CSS variable
     */
    setCSSVariable(color) {
        const colorString = this.rgbToString(color);
        applyWallColorVariables(colorString);
        console.log('Wallpaper dominant color set:', colorString);
    }

    /**
     * Get cached color data from registry
     */
    getCachedColor() {
        return getWallpaperColorCache();
    }

    /**
     * Save color data to registry
     */
    saveCachedColor(wallpaperPath, color) {
        try {
            const data = {
                path: wallpaperPath,
                color: color,
                timestamp: Date.now()
            };
            saveWallpaperColorCache(data);

            try {
                if (isAccentAutomaticMode()) {
                    const hexColor = this.rgbToHex(color);
                    setAccentColorHexSafe(hexColor);
                }
            } catch (error) {
                console.warn('Error updating accent color from wallpaper extraction:', error);
            }
        } catch (error) {
            console.error('Error saving cached color to registry:', error);
        }
    }

    /**
     * Initialize the wallpaper color extraction
     * Uses cached color immediately, then updates in background if needed
     */
    async initialize() {
        try {
            const wallpaperPath = this.getWallpaperPath();

            if (!wallpaperPath) {
                console.warn('Could not find wallpaper path');
                return;
            }

            this.wallpaperPath = wallpaperPath;

            // Check for cached color
            const cached = this.getCachedColor();

            // Check if user has a custom color selected (not automatic)
            // Only apply wallpaper color if color is set to automatic
            let shouldApplyColor = true;
            try {
                shouldApplyColor = isWallColorAutomatic();
                if (!shouldApplyColor) {
                    console.log('[WallpaperColor] Custom color selected, not applying wallpaper color');
                }
            } catch (e) {
                console.warn('[WallpaperColor] Could not check color settings:', e);
            }

            if (cached && cached.path === wallpaperPath && cached.color) {
                // Use cached color immediately
                this.dominantColor = cached.color;
                if (shouldApplyColor) {
                    this.setCSSVariable(cached.color);
                    console.log('Using cached wallpaper color:', this.rgbToString(cached.color));
                }
            } else {
                // No cache or wallpaper changed - extract immediately on first load
                console.log('No cached color found, extracting from wallpaper:', wallpaperPath);
                const dominantColor = await this.extractDominantColor(wallpaperPath);
                this.dominantColor = dominantColor;
                if (shouldApplyColor) {
                    this.setCSSVariable(dominantColor);
                }
                this.saveCachedColor(wallpaperPath, dominantColor);
            }

            // If we had a cached color, verify in background if wallpaper changed
            if (cached && cached.path === wallpaperPath) {
                this.verifyColorInBackground(wallpaperPath);
            }

            return this.dominantColor;
        } catch (error) {
            console.error('Error extracting wallpaper color:', error);
            // Set a fallback color
            const fallbackColor = { r: 32, g: 14, b: 101 };
            this.setCSSVariable(fallbackColor);
        }
    }

    /**
     * Verify color in background and update if different
     */
    async verifyColorInBackground(wallpaperPath) {
        try {
            // Small delay to not block initial render
            await new Promise(resolve => setTimeout(resolve, 1000));

            const newColor = await this.extractDominantColor(wallpaperPath);

            // Check if color is significantly different (threshold of 10 per channel)
            const isDifferent = Math.abs(newColor.r - this.dominantColor.r) > 10 ||
                                Math.abs(newColor.g - this.dominantColor.g) > 10 ||
                                Math.abs(newColor.b - this.dominantColor.b) > 10;

            if (isDifferent) {
                console.log('Wallpaper color changed, updating:', this.rgbToString(newColor));
                this.dominantColor = newColor;

                // Only apply the color if user hasn't selected a custom color
                let shouldApplyColor = true;
                try {
                    shouldApplyColor = isWallColorAutomatic();
                } catch (e) {
                    console.warn('Could not check color settings:', e);
                }

                if (shouldApplyColor) {
                    this.setCSSVariable(newColor);
                }
                this.saveCachedColor(wallpaperPath, newColor);
            }
        } catch (error) {
            console.error('Error verifying wallpaper color:', error);
        }
    }

    /**
     * Get the current dominant color
     */
    getDominantColor() {
        return this.dominantColor;
    }
}

// Create a global instance
window.WallpaperColorExtractor = new WallpaperColorExtractor();
