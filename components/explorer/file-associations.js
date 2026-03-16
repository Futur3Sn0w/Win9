/**
 * File director / associations manager.
 * Resolves whether a target path should open inside the simulator, prompt for a compatible app,
 * or fall back to the host OS.
 */

let directAssociationsMap = null;
let compatibleAssociationsMap = null;
let electronShell = null;
let pathModule = null;
let fsPromises = null;
let fileOpenability = null;

try {
    ({ shell: electronShell } = require('electron'));
    pathModule = require('path');
    fsPromises = require('fs').promises;
    fileOpenability = require('./components/explorer/file-openability.js');
} catch (error) {
    if (typeof window !== 'undefined' && typeof window.require === 'function') {
        try {
            ({ shell: electronShell } = window.require('electron'));
            pathModule = window.require('path');
            fsPromises = window.require('fs').promises;
            fileOpenability = window.require('./components/explorer/file-openability.js');
        } catch (nestedError) {
            console.warn('FileAssociations: Electron helpers unavailable in fallback require.', nestedError);
        }
    }
}

function normalizeExtension(extension) {
    if (!extension || typeof extension !== 'string') {
        return '';
    }

    return extension.startsWith('.') ? extension.toLowerCase() : `.${extension.toLowerCase()}`;
}

function buildFileAssociationsMap() {
    const apps = window.AppsManager?.getAllApps() || [];
    const nextDirectMap = new Map();
    const nextCompatibleMap = new Map();

    apps.forEach(app => {
        if (Array.isArray(app.fileAssociations)) {
            app.fileAssociations.forEach(extension => {
                const normalizedExtension = normalizeExtension(extension);
                if (!normalizedExtension) {
                    return;
                }

                nextDirectMap.set(normalizedExtension, app.id);

                if (!nextCompatibleMap.has(normalizedExtension)) {
                    nextCompatibleMap.set(normalizedExtension, new Set());
                }
                nextCompatibleMap.get(normalizedExtension).add(app.id);
            });
        }

        if (Array.isArray(app.compatibleFileAssociations)) {
            app.compatibleFileAssociations.forEach(extension => {
                const normalizedExtension = normalizeExtension(extension);
                if (!normalizedExtension) {
                    return;
                }

                if (!nextCompatibleMap.has(normalizedExtension)) {
                    nextCompatibleMap.set(normalizedExtension, new Set());
                }
                nextCompatibleMap.get(normalizedExtension).add(app.id);
            });
        }
    });

    directAssociationsMap = nextDirectMap;
    compatibleAssociationsMap = nextCompatibleMap;
    return {
        directAssociationsMap,
        compatibleAssociationsMap
    };
}

function ensureAssociationsLoaded() {
    if (!directAssociationsMap || !compatibleAssociationsMap) {
        buildFileAssociationsMap();
    }
}

function getFileExtension(filePath) {
    if (!filePath) {
        return '';
    }

    if (pathModule && typeof pathModule.extname === 'function') {
        return pathModule.extname(filePath).toLowerCase();
    }

    const lastDotIndex = filePath.lastIndexOf('.');
    if (lastDotIndex === -1 || lastDotIndex === filePath.length - 1) {
        return '';
    }

    return filePath.substring(lastDotIndex).toLowerCase();
}

async function resolveItemType(targetPath, itemType) {
    if (itemType === 'folder' || itemType === 'file') {
        return itemType;
    }

    if (!targetPath || !fsPromises || typeof fsPromises.stat !== 'function') {
        return 'file';
    }

    try {
        const stats = await fsPromises.stat(targetPath);
        return stats.isDirectory() ? 'folder' : 'file';
    } catch (error) {
        console.warn('FileAssociations: Failed to inspect path, defaulting to file.', targetPath, error);
        return 'file';
    }
}

function getAppForFile(filePath) {
    ensureAssociationsLoaded();

    const extension = getFileExtension(filePath);
    if (!extension) {
        return null;
    }

    return directAssociationsMap.get(extension) || null;
}

function getSavedOpenChoice(extension) {
    const normalizedExtension = normalizeExtension(extension);
    if (!normalizedExtension || !window.FileAssociationsRegistry) {
        return null;
    }

    if (typeof window.FileAssociationsRegistry.getOpenChoice !== 'function') {
        return null;
    }

    return window.FileAssociationsRegistry.getOpenChoice(normalizedExtension);
}

function saveOpenChoice(extension, choice) {
    const normalizedExtension = normalizeExtension(extension);
    if (!normalizedExtension || !window.FileAssociationsRegistry) {
        return;
    }

    if (typeof window.FileAssociationsRegistry.saveOpenChoice === 'function') {
        window.FileAssociationsRegistry.saveOpenChoice(normalizedExtension, choice);
    }
}

function removeSavedOpenChoice(extension) {
    const normalizedExtension = normalizeExtension(extension);
    if (!normalizedExtension || !window.FileAssociationsRegistry) {
        return;
    }

    if (typeof window.FileAssociationsRegistry.removeOpenChoice === 'function') {
        window.FileAssociationsRegistry.removeOpenChoice(normalizedExtension);
    }
}

async function validateCandidateAppIds(filePath, appIds) {
    if (!Array.isArray(appIds) || appIds.length === 0) {
        return [];
    }

    const validated = [];

    for (const appId of appIds) {
        if (!appId) {
            continue;
        }

        if (!fileOpenability || typeof fileOpenability.canAppOpenFile !== 'function') {
            validated.push(appId);
            continue;
        }

        try {
            const result = await fileOpenability.canAppOpenFile(appId, filePath, fsPromises);
            if (result?.canOpen) {
                validated.push(appId);
            }
        } catch (error) {
            console.warn('FileAssociations: Failed to validate compatible app.', appId, filePath, error);
        }
    }

    return validated;
}

async function getCompatibleAppIds(filePath) {
    ensureAssociationsLoaded();

    const extension = getFileExtension(filePath);
    if (!extension) {
        return [];
    }

    const orderedCandidates = [];
    const seen = new Set();
    const directAppId = directAssociationsMap.get(extension) || null;

    if (directAppId) {
        orderedCandidates.push(directAppId);
        seen.add(directAppId);
    }

    const compatibleApps = compatibleAssociationsMap.get(extension);
    if (compatibleApps) {
        compatibleApps.forEach(appId => {
            if (!seen.has(appId)) {
                seen.add(appId);
                orderedCandidates.push(appId);
            }
        });
    }

    return validateCandidateAppIds(filePath, orderedCandidates);
}

async function getOpenDirective(targetPath, itemType = 'file') {
    const resolvedItemType = await resolveItemType(targetPath, itemType);

    if (resolvedItemType === 'folder') {
        return {
            path: targetPath,
            itemType: 'folder',
            extension: '',
            appId: 'explorer',
            openInternally: true,
            useChooser: false,
            compatibleApps: []
        };
    }

    const extension = getFileExtension(targetPath);
    const directAppId = getAppForFile(targetPath);
    const compatibleAppIds = await getCompatibleAppIds(targetPath);
    const savedChoice = getSavedOpenChoice(extension);

    if (savedChoice?.kind === 'host') {
        return {
            path: targetPath,
            itemType: 'file',
            extension,
            appId: null,
            openInternally: false,
            useChooser: false,
            compatibleApps: compatibleAppIds,
            preferHost: true
        };
    }

    if (savedChoice?.kind === 'app' && savedChoice.appId) {
        if (compatibleAppIds.includes(savedChoice.appId)) {
            return {
                path: targetPath,
                itemType: 'file',
                extension,
                appId: savedChoice.appId,
                openInternally: true,
                useChooser: false,
                compatibleApps: compatibleAppIds
            };
        }

        removeSavedOpenChoice(extension);
    }

    if (directAppId && compatibleAppIds.includes(directAppId)) {
        return {
            path: targetPath,
            itemType: 'file',
            extension,
            appId: directAppId,
            openInternally: true,
            useChooser: false,
            compatibleApps: compatibleAppIds
        };
    }

    if (compatibleAppIds.length > 0) {
        return {
            path: targetPath,
            itemType: 'file',
            extension,
            appId: null,
            openInternally: false,
            useChooser: true,
            compatibleApps: compatibleAppIds
        };
    }

    return {
        path: targetPath,
        itemType: 'file',
        extension,
        appId: null,
        openInternally: false,
        useChooser: false,
        compatibleApps: []
    };
}

function shouldOpenInternally(filePath) {
    return getAppForFile(filePath) !== null;
}

async function canOpenInternally(filePath) {
    const compatibleAppIds = await getCompatibleAppIds(filePath);
    return compatibleAppIds.length > 0;
}

async function openFileInternally(filePath, resolvedAppId = null) {
    const appId = resolvedAppId || getAppForFile(filePath);
    if (!appId) {
        console.log('FileAssociations: No internal handler for file:', filePath);
        return false;
    }

    const app = window.AppsManager?.getAppById(appId);
    if (!app) {
        console.error('FileAssociations: App not found:', appId);
        return false;
    }

    try {
        if (typeof window.launchApp === 'function') {
            window.launchApp(app, null, {
                openFilePath: filePath
            });
            return true;
        }

        console.error('FileAssociations: launchApp function not available');
        return false;
    } catch (error) {
        console.error('FileAssociations: Error opening file internally:', error);
        return false;
    }
}

async function showOpenWithChooser(filePath, extension, compatibleAppIds) {
    if (!window.OpenWithChooser || typeof window.OpenWithChooser.show !== 'function') {
        return undefined;
    }

    const candidates = compatibleAppIds
        .map(appId => ({
            appId,
            app: window.AppsManager?.getAppById(appId) || null
        }))
        .filter(candidate => candidate.app);

    if (!candidates.length) {
        return undefined;
    }

    return window.OpenWithChooser.show({
        filePath,
        extension,
        candidates
    });
}

async function openPath(targetPath, itemType = 'file') {
    if (!targetPath) {
        console.warn('FileAssociations: No path provided');
        return;
    }

    const directive = await getOpenDirective(targetPath, itemType);

    if (directive.itemType === 'folder') {
        await openFolderInExplorer(targetPath);
        return;
    }

    if (directive.useChooser) {
        const choice = await showOpenWithChooser(targetPath, directive.extension, directive.compatibleApps);
        if (typeof choice === 'undefined') {
            await openPathExternally(targetPath);
            return;
        }

        if (!choice) {
            return;
        }

        if (choice.remember && directive.extension) {
            if (choice.kind === 'app' && choice.appId) {
                saveOpenChoice(directive.extension, {
                    kind: 'app',
                    appId: choice.appId
                });
            } else if (choice.kind === 'host') {
                saveOpenChoice(directive.extension, {
                    kind: 'host'
                });
            }
        }

        if (choice.kind === 'app' && choice.appId) {
            await openFileInternally(targetPath, choice.appId);
            return;
        }

        if (choice.kind === 'host') {
            await openPathExternally(targetPath);
            return;
        }

        return;
    }

    if (directive.openInternally && directive.appId) {
        const opened = await openFileInternally(targetPath, directive.appId);
        if (opened) {
            return;
        }
    }

    await openPathExternally(targetPath);
}

async function openFolderInExplorer(folderPath) {
    try {
        if (typeof window.launchApp === 'function') {
            const explorerApp = window.AppsManager?.getAppById('explorer');
            if (!explorerApp) {
                await openPathExternally(folderPath);
                return false;
            }

            window.launchApp(explorerApp, null, {
                openFolderPath: folderPath
            });
            return true;
        }

        await openPathExternally(folderPath);
        return false;
    } catch (error) {
        console.error('FileAssociations: Error opening folder in explorer:', error);
        await openPathExternally(folderPath);
        return false;
    }
}

async function openPathExternally(targetPath) {
    if (!electronShell) {
        console.error('FileAssociations: Electron shell not available');
        return;
    }

    if (typeof electronShell.openPath === 'function') {
        const result = await electronShell.openPath(targetPath);
        if (result) {
            console.error('FileAssociations: Electron failed to open path externally:', result);
        }
    } else if (typeof electronShell.openExternal === 'function') {
        const externalTarget = /^file:\/\//i.test(targetPath) ? targetPath : `file://${targetPath}`;
        await electronShell.openExternal(externalTarget);
    } else if (typeof electronShell.showItemInFolder === 'function') {
        electronShell.showItemInFolder(targetPath);
    } else {
        console.warn('FileAssociations: No available method to open path externally');
    }
}

function rebuildAssociations() {
    buildFileAssociationsMap();
}

if (window.AppsManager) {
    const apps = window.AppsManager.getAllApps();
    if (apps && apps.length > 0) {
        buildFileAssociationsMap();
    }
}

const FileDirector = {
    getAppForFile,
    getCompatibleAppIds,
    getFileExtension,
    getOpenDirective,
    shouldOpenInternally,
    canOpenInternally,
    openFileInternally,
    openPath,
    openPathExternally,
    openFolderInExplorer,
    rebuildAssociations
};

window.FileAssociations = FileDirector;
window.FileDirector = FileDirector;
