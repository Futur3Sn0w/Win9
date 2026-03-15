const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

let trashModule = null;

async function loadTrashModule() {
    if (!trashModule) {
        trashModule = await import('trash');
    }
    return trashModule.default;
}

const RECYCLE_BIN_PATH = process.platform === 'darwin'
    ? path.join(os.homedir(), '.Trash')
    : null;

function isMeaningfulRecycleEntry(name) {
    return name && name !== '.' && name !== '..' && name !== '.DS_Store';
}

function setupTrashHandlers() {
    ipcMain.handle('trash:get-path', async () => {
        return RECYCLE_BIN_PATH;
    });

    ipcMain.handle('trash:has-items', async () => {
        if (!RECYCLE_BIN_PATH) {
            return false;
        }

        try {
            const entries = await fs.promises.readdir(RECYCLE_BIN_PATH);
            return entries.some(isMeaningfulRecycleEntry);
        } catch (error) {
            if (error.code === 'ENOENT' || error.code === 'EPERM' || error.code === 'EACCES') {
                return false;
            }
            throw error;
        }
    });

    ipcMain.handle('trash:empty', async () => {
        const recycleLabel = process.platform === 'darwin' ? 'Trash' : 'Recycle Bin';

        if (!RECYCLE_BIN_PATH) {
            throw new Error(`Emptying the ${recycleLabel.toLowerCase()} is not supported on this platform.`);
        }

        try {
            const entries = await fs.promises.readdir(RECYCLE_BIN_PATH);
            const meaningfulEntries = entries.filter(isMeaningfulRecycleEntry);

            if (meaningfulEntries.length === 0) {
                return { success: true, deletedCount: 0 };
            }

            const pathsToDelete = meaningfulEntries.map(entryName => path.join(RECYCLE_BIN_PATH, entryName));

            const trash = await loadTrashModule();
            await trash(pathsToDelete, { glob: false });

            return { success: true, deletedCount: pathsToDelete.length };
        } catch (error) {
            console.error('TrashManager: Failed to empty recycle bin.', error);

            const errorResult = {
                success: false,
                error: error.message || 'Unknown error',
                code: error.code
            };

            if (error.code === 'EPERM' || error.code === 'EACCES') {
                errorResult.message = `Permission denied. This app needs Full Disk Access to manage the ${recycleLabel.toLowerCase()}.\n\nGo to System Settings > Privacy & Security > Full Disk Access and add this application.`;
            } else {
                errorResult.message = `Unable to empty the ${recycleLabel.toLowerCase()}.`;
            }

            throw errorResult;
        }
    });

    ipcMain.handle('trash:move-items', async (event, paths) => {
        if (!Array.isArray(paths) || paths.length === 0) {
            throw new Error('No paths provided for trash operation.');
        }

        try {
            const trash = await loadTrashModule();
            await trash(paths, { glob: false });
            return { success: true, count: paths.length };
        } catch (error) {
            console.error('TrashManager: Failed to move items to trash.', error);
            throw {
                success: false,
                error: error.message || 'Unknown error',
                code: error.code
            };
        }
    });
}

module.exports = {
    setupTrashHandlers
};
