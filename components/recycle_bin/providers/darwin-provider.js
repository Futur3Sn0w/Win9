const fs = require('fs');
const os = require('os');
const path = require('path');
const { shell } = require('electron');

let trashModule = null;

async function loadTrashModule() {
    if (!trashModule) {
        trashModule = await import('trash');
    }
    return trashModule.default;
}

function isMeaningfulRecycleEntry(name) {
    return name && name !== '.' && name !== '..' && name !== '.DS_Store';
}

async function deleteEntryPermanently(targetPath) {
    await fs.promises.rm(targetPath, {
        recursive: true,
        force: false,
        maxRetries: 2,
        retryDelay: 50
    });
}

class DarwinRecycleBinProvider {
    constructor() {
        this.recycleBinPath = path.join(os.homedir(), '.Trash');
    }

    getDefaultState() {
        return {
            platform: 'darwin',
            available: true,
            path: this.recycleBinPath,
            empty: true,
            itemCount: 0
        };
    }

    async getState() {
        const defaultState = this.getDefaultState();

        try {
            const entries = await fs.promises.readdir(this.recycleBinPath);
            const meaningfulEntries = entries.filter(isMeaningfulRecycleEntry);

            return {
                ...defaultState,
                empty: meaningfulEntries.length === 0,
                itemCount: meaningfulEntries.length
            };
        } catch (error) {
            if (error.code === 'ENOENT' || error.code === 'EPERM' || error.code === 'EACCES') {
                return defaultState;
            }
            throw error;
        }
    }

    async open() {
        const result = await shell.openPath(this.recycleBinPath);
        if (result) {
            throw new Error(result);
        }

        return { success: true };
    }

    async empty() {
        try {
            const entries = await fs.promises.readdir(this.recycleBinPath);
            const meaningfulEntries = entries.filter(isMeaningfulRecycleEntry);

            if (meaningfulEntries.length === 0) {
                return { success: true, deletedCount: 0 };
            }

            const pathsToDelete = meaningfulEntries.map(entryName => path.join(this.recycleBinPath, entryName));
            await Promise.all(pathsToDelete.map(deleteEntryPermanently));

            return { success: true, deletedCount: pathsToDelete.length };
        } catch (error) {
            const errorResult = {
                success: false,
                error: error.message || 'Unknown error',
                code: error.code
            };

            if (error.code === 'EPERM' || error.code === 'EACCES') {
                errorResult.message = 'Permission denied. This app needs Full Disk Access to manage the trash.\n\nGo to System Settings > Privacy & Security > Full Disk Access and add this application.';
            } else {
                errorResult.message = 'Unable to empty the trash.';
            }

            throw errorResult;
        }
    }

    async moveItems(paths) {
        if (!Array.isArray(paths) || paths.length === 0) {
            throw new Error('No paths provided for trash operation.');
        }

        const trash = await loadTrashModule();
        await trash(paths, { glob: false });
        return { success: true, count: paths.length };
    }
}

module.exports = DarwinRecycleBinProvider;
