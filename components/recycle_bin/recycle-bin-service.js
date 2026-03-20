const { BrowserWindow, ipcMain } = require('electron');
const DarwinRecycleBinProvider = require('./providers/darwin-provider');
const WindowsRecycleBinProvider = require('./providers/win32-provider');

const POLL_INTERVAL_MS = 5000;

function createProvider() {
    if (process.platform === 'darwin') {
        return new DarwinRecycleBinProvider();
    }

    if (process.platform === 'win32') {
        return new WindowsRecycleBinProvider();
    }

    return {
        getDefaultState() {
            return {
                platform: process.platform,
                available: false,
                path: null,
                empty: true,
                itemCount: 0
            };
        },
        async getState() {
            return this.getDefaultState();
        },
        async open() {
            throw new Error('Opening the recycle bin is not supported on this platform.');
        },
        async empty() {
            throw new Error('Emptying the recycle bin is not supported on this platform.');
        },
        async moveItems(paths) {
            throw new Error(`Moving items to trash is not supported on ${process.platform}.`);
        },
        async listItems() {
            return [];
        }
    };
}

function normalizeState(state, provider) {
    const defaults = provider.getDefaultState();
    return {
        ...defaults,
        ...(state || {}),
        available: Boolean(state?.available ?? defaults.available),
        path: typeof state?.path === 'string' ? state.path : defaults.path,
        empty: Boolean(state?.empty ?? defaults.empty),
        itemCount: Number.isFinite(Number(state?.itemCount))
            ? Number(state.itemCount)
            : Number(defaults.itemCount) || 0
    };
}

function statesEqual(left, right) {
    return left.available === right.available
        && left.path === right.path
        && left.empty === right.empty
        && left.itemCount === right.itemCount
        && left.platform === right.platform;
}

class RecycleBinService {
    constructor() {
        this.provider = createProvider();
        this.currentState = normalizeState(this.provider.getDefaultState(), this.provider);
        this.hasSyncedState = false;
        this.syncInFlight = null;
        this.monitorTimer = null;
    }

    async getState(options = {}) {
        const { force = false } = options;

        if (!force && this.syncInFlight) {
            return this.syncInFlight;
        }

        if (!force && this.hasSyncedState) {
            return this.currentState;
        }

        return this.syncState({ force });
    }

    async syncState(options = {}) {
        const { broadcast = false, force = false } = options;

        if (this.syncInFlight && !force) {
            return this.syncInFlight;
        }

        this.syncInFlight = (async () => {
            let nextState;

            try {
                nextState = normalizeState(await this.provider.getState(), this.provider);
            } catch (error) {
                console.error('RecycleBin: Failed to read state.', error);
                nextState = normalizeState({
                    ...this.provider.getDefaultState(),
                    available: false
                }, this.provider);
            }

            const changed = !statesEqual(this.currentState, nextState);
            this.currentState = nextState;
            this.hasSyncedState = true;

            if (broadcast && changed) {
                this.broadcastState(nextState);
            }

            return nextState;
        })();

        try {
            return await this.syncInFlight;
        } finally {
            this.syncInFlight = null;
        }
    }

    async openRecycleBin() {
        return this.provider.open();
    }

    async emptyRecycleBin() {
        const result = await this.provider.empty();
        await this.syncState({ force: true, broadcast: true });
        return result;
    }

    async moveItemsToTrash(paths) {
        const result = await this.provider.moveItems(paths);
        await this.syncState({ force: true, broadcast: true });
        return result;
    }

    async listItems() {
        if (typeof this.provider.listItems !== 'function') {
            return [];
        }

        return this.provider.listItems();
    }

    startMonitoring() {
        if (this.monitorTimer) {
            return;
        }

        void this.syncState({ force: true });

        this.monitorTimer = setInterval(() => {
            void this.syncState({ broadcast: true });
        }, POLL_INTERVAL_MS);

        if (typeof this.monitorTimer.unref === 'function') {
            this.monitorTimer.unref();
        }
    }

    broadcastState(state = this.currentState) {
        const payload = normalizeState(state, this.provider);

        BrowserWindow.getAllWindows().forEach(windowInstance => {
            if (!windowInstance.isDestroyed()) {
                windowInstance.webContents.send('trash:state-changed', payload);
            }
        });
    }
}

function setupRecycleBinHandlers() {
    const service = new RecycleBinService();

    ipcMain.handle('trash:get-info', async () => {
        return service.getState({ force: true });
    });

    ipcMain.handle('trash:get-path', async () => {
        const state = await service.getState({ force: true });
        return state.path || null;
    });

    ipcMain.handle('trash:has-items', async () => {
        const state = await service.getState({ force: true });
        return !state.empty;
    });

    ipcMain.handle('trash:open', async () => {
        return service.openRecycleBin();
    });

    ipcMain.handle('trash:empty', async () => {
        return service.emptyRecycleBin();
    });

    ipcMain.handle('trash:move-items', async (event, paths) => {
        return service.moveItemsToTrash(paths);
    });

    ipcMain.handle('trash:list-items', async () => {
        return {
            items: await service.listItems()
        };
    });

    service.startMonitoring();
    return service;
}

module.exports = {
    setupRecycleBinHandlers
};
