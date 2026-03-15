/**
 * File Associations Manager
 * Determines which files should open internally (in-simulator) vs externally
 */

let fileAssociationsMap = null;

/**
 * Build the file associations map from apps data
 * Maps file extensions to app IDs
 */
function buildFileAssociationsMap() {
    const apps = window.AppsManager?.getAllApps() || [];
    const associationsMap = new Map();

    apps.forEach(app => {
        if (app.fileAssociations && Array.isArray(app.fileAssociations)) {
            app.fileAssociations.forEach(ext => {
                // Normalize extension (ensure it starts with a dot)
                const normalizedExt = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;

                // Store app ID for this extension
                // If multiple apps handle the same extension, the last one wins
                // In the future, we could support default app selection
                associationsMap.set(normalizedExt, app.id);
            });
        }
    });

    fileAssociationsMap = associationsMap;
    console.log('File associations map built:', fileAssociationsMap);
    return fileAssociationsMap;
}

/**
 * Get the app ID that should handle a given file path
 * @param {string} filePath - The full path to the file
 * @returns {string|null} - The app ID that should handle the file, or null if no internal handler
 */
function getAppForFile(filePath) {
    if (!fileAssociationsMap) {
        buildFileAssociationsMap();
    }

    if (!filePath) {
        return null;
    }

    // Extract extension from file path
    const lastDotIndex = filePath.lastIndexOf('.');
    if (lastDotIndex === -1 || lastDotIndex === filePath.length - 1) {
        return null; // No extension
    }

    const extension = filePath.substring(lastDotIndex).toLowerCase();
    return fileAssociationsMap.get(extension) || null;
}

/**
 * Check if a file should be opened internally (in-simulator)
 * @param {string} filePath - The full path to the file
 * @returns {boolean} - True if file should open internally, false if external
 */
function shouldOpenInternally(filePath) {
    const appId = getAppForFile(filePath);
    return appId !== null;
}

/**
 * Open a file with the appropriate internal app
 * @param {string} filePath - The full path to the file
 * @returns {Promise<boolean>} - True if file was opened internally, false otherwise
 */
async function openFileInternally(filePath) {
    const appId = getAppForFile(filePath);

    if (!appId) {
        console.log('FileAssociations: No internal handler for file:', filePath);
        return false;
    }

    const app = window.AppsManager?.getAppById(appId);
    if (!app) {
        console.error('FileAssociations: App not found:', appId);
        return false;
    }

    console.log('FileAssociations: Opening file internally with app:', appId, filePath);

    try {
        // Use the global launchApp function to open the app inside the simulator
        if (typeof window.launchApp === 'function') {
            // Launch the app with the file path in launch options
            window.launchApp(app, null, {
                openFilePath: filePath
            });
            return true;
        } else {
            console.error('FileAssociations: launchApp function not available');
            return false;
        }
    } catch (error) {
        console.error('FileAssociations: Error opening file internally:', error);
        return false;
    }
}

/**
 * Open a file or folder path (either internally or externally)
 * @param {string} targetPath - The full path to open
 * @param {string} itemType - 'file' or 'folder'
 * @returns {Promise<void>}
 */
async function openPath(targetPath, itemType = 'file') {
    if (!targetPath) {
        console.warn('FileAssociations: No path provided');
        return;
    }

    // Folders open in the File Explorer app
    if (itemType === 'folder') {
        console.log('FileAssociations: Opening folder in File Explorer:', targetPath);
        await openFolderInExplorer(targetPath);
        return;
    }

    // Check if file should open internally
    if (shouldOpenInternally(targetPath)) {
        const opened = await openFileInternally(targetPath);
        if (opened) {
            return; // Successfully opened internally
        }
        // If internal open failed, fall through to external open
    }

    // Open externally
    console.log('FileAssociations: Opening file externally:', targetPath);
    await openPathExternally(targetPath);
}

/**
 * Open a folder in the File Explorer app
 * @param {string} folderPath - The full path to the folder
 * @returns {Promise<boolean>} - True if folder was opened, false otherwise
 */
async function openFolderInExplorer(folderPath) {
    try {
        // Use the global launchApp function to open File Explorer
        if (typeof window.launchApp === 'function') {
            const explorerApp = window.AppsManager?.getAppById('explorer');
            if (!explorerApp) {
                console.error('FileAssociations: File Explorer app not found');
                // Fallback to external opening
                await openPathExternally(folderPath);
                return false;
            }

            // Launch File Explorer with the folder path
            window.launchApp(explorerApp, null, {
                openFolderPath: folderPath
            });
            return true;
        } else {
            console.error('FileAssociations: launchApp function not available');
            // Fallback to external opening
            await openPathExternally(folderPath);
            return false;
        }
    } catch (error) {
        console.error('FileAssociations: Error opening folder in explorer:', error);
        // Fallback to external opening
        await openPathExternally(folderPath);
        return false;
    }
}

/**
 * Open a path externally using the system default handler
 * @param {string} targetPath - The full path to open
 * @returns {Promise<void>}
 */
async function openPathExternally(targetPath) {
    if (typeof shell === 'undefined') {
        console.error('FileAssociations: Electron shell not available');
        return;
    }

    if (typeof shell.openPath === 'function') {
        const result = await shell.openPath(targetPath);
        if (result) {
            console.error('FileAssociations: Electron failed to open path externally:', result);
        }
    } else if (typeof shell.showItemInFolder === 'function') {
        shell.showItemInFolder(targetPath);
    } else {
        console.warn('FileAssociations: No available method to open path externally');
    }
}

/**
 * Rebuild the file associations map (call this when apps data changes)
 */
function rebuildAssociations() {
    buildFileAssociationsMap();
}

// Initialize when apps are loaded
if (window.AppsManager) {
    // If apps are already loaded, build map immediately
    const apps = window.AppsManager.getAllApps();
    if (apps && apps.length > 0) {
        buildFileAssociationsMap();
    }
}

// Export functions
window.FileAssociations = {
    getAppForFile,
    shouldOpenInternally,
    openFileInternally,
    openPath,
    openPathExternally,
    openFolderInExplorer,
    rebuildAssociations
};
