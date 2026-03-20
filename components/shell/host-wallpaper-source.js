const path = require('path');
const fs = require('fs/promises');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFilePromise = promisify(execFile);

const WINDOWS_DESKTOP_REGISTRY_KEY = 'HKCU\\Control Panel\\Desktop';
const WINDOWS_THEMES_DIRECTORY = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Themes');
const WINDOWS_TRANSCODED_WALLPAPER = path.join(WINDOWS_THEMES_DIRECTORY, 'TranscodedWallpaper');
const WINDOWS_TRANSCODED_WALLPAPER_FALLBACK = path.join(WINDOWS_THEMES_DIRECTORY, 'Transcoded_000');

let cachedHostWallpaperPromise = null;

function normalizeString(value) {
    if (typeof value !== 'string') {
        return '';
    }

    return value.trim();
}

async function fileExists(targetPath) {
    if (!targetPath || typeof targetPath !== 'string') {
        return false;
    }

    try {
        const stat = await fs.stat(targetPath);
        return stat.isFile();
    } catch (_error) {
        return false;
    }
}

function createUnavailableWallpaper() {
    return {
        wallpaperPath: '',
        hasHostWallpaper: false,
        sourceKind: '',
        sourcePlatform: process.platform
    };
}

function parseRegistryQueryValue(stdout, valueName) {
    const normalizedValueName = normalizeString(valueName);
    if (!normalizedValueName) {
        return '';
    }

    const lines = String(stdout || '').split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.toLowerCase().startsWith(normalizedValueName.toLowerCase())) {
            continue;
        }

        const match = trimmed.match(/^[^\s]+\s+REG_\w+\s+(.+)$/i);
        if (match && match[1]) {
            return normalizeString(match[1]);
        }
    }

    return '';
}

async function resolveWindowsHostWallpaper() {
    const transcodedCandidates = [
        WINDOWS_TRANSCODED_WALLPAPER,
        WINDOWS_TRANSCODED_WALLPAPER_FALLBACK
    ];

    for (const candidatePath of transcodedCandidates) {
        if (await fileExists(candidatePath)) {
            return {
                wallpaperPath: candidatePath,
                hasHostWallpaper: true,
                sourceKind: 'transcoded',
                sourcePlatform: process.platform
            };
        }
    }

    try {
        const { stdout } = await execFilePromise(
            'reg.exe',
            ['query', WINDOWS_DESKTOP_REGISTRY_KEY, '/v', 'WallPaper'],
            {
                encoding: 'utf8',
                timeout: 2500,
                windowsHide: true
            }
        );

        const wallpaperPath = parseRegistryQueryValue(stdout, 'WallPaper');
        if (wallpaperPath && await fileExists(wallpaperPath)) {
            return {
                wallpaperPath,
                hasHostWallpaper: true,
                sourceKind: 'registry',
                sourcePlatform: process.platform
            };
        }
    } catch (error) {
        console.warn('[ShellHostWallpaper] Failed to query Windows wallpaper registry:', error.message || error);
    }

    return createUnavailableWallpaper();
}

async function buildHostWallpaper() {
    if (process.platform === 'win32') {
        return resolveWindowsHostWallpaper();
    }

    return createUnavailableWallpaper();
}

async function getHostWallpaper(options = {}) {
    const shouldRefresh = Boolean(options && options.refresh);
    if (!shouldRefresh && cachedHostWallpaperPromise) {
        return cachedHostWallpaperPromise;
    }

    cachedHostWallpaperPromise = buildHostWallpaper().catch((error) => {
        console.warn('[ShellHostWallpaper] Falling back to unavailable wallpaper:', error.message || error);
        return createUnavailableWallpaper();
    });

    return cachedHostWallpaperPromise;
}

module.exports = {
    getHostWallpaper
};
