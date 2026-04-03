// Notepad Application Logic

const APP_ID = 'notepad';

let ipcRenderer = null;
let path = null;
let fsPromises = null;
let decodeTextBuffer = null;

function resolveRequire() {
    if (typeof require === 'function') {
        return require;
    }

    if (typeof window !== 'undefined' && typeof window.require === 'function') {
        return window.require.bind(window);
    }

    try {
        if (window?.parent && window.parent !== window && typeof window.parent.require === 'function') {
            return window.parent.require.bind(window.parent);
        }
    } catch (error) {
        // ignore cross-origin or unavailable parent
    }

    try {
        if (window?.top && window.top !== window && typeof window.top.require === 'function') {
            return window.top.require.bind(window.top);
        }
    } catch (error) {
        // ignore cross-origin or unavailable top
    }

    return null;
}

function resolveElectronIpc() {
    const requireFn = resolveRequire();
    if (!requireFn) {
        return null;
    }

    try {
        return requireFn('electron').ipcRenderer;
    } catch (error) {
        return null;
    }
}

const requireFn = resolveRequire();
if (requireFn) {
    try {
        ipcRenderer = requireFn('electron').ipcRenderer;
        path = requireFn('path');
        fsPromises = requireFn('fs').promises;
        ({ decodeTextBuffer } = requireFn('../../../components/explorer/file-openability.js'));
    } catch (error) {
        console.warn('Electron APIs are not available in Notepad:', error);
    }
} else {
    console.warn('Electron APIs are not available in Notepad: require function missing');
}

let getRegistry = null;
let RegistryTypeConst = null;

const registryRequireFn = requireFn;
if (registryRequireFn) {
    try {
        const registryModule = registryRequireFn('../../../registry/registry.js');
        ({ getRegistry, RegistryType: RegistryTypeConst } = registryModule);
    } catch (registryError) {
        console.warn('Notepad: registry module unavailable:', registryError);
    }
}

if (!getRegistry && typeof window !== 'undefined' && window.RegistryAPI) {
    getRegistry = window.RegistryAPI.getRegistry || null;
    RegistryTypeConst = window.RegistryAPI.RegistryType || null;
}

const NOTEPAD_REGISTRY_PATH = 'HKCU\\Software\\Microsoft\\Notepad';
const REG_SZ = RegistryTypeConst ? RegistryTypeConst.REG_SZ : 1;

const DEFAULT_FILENAME = 'Untitled.txt';
const PREFERENCE_KEYS = {
    WORD_WRAP: 'notepad.wordWrapEnabled',
    STATUS_BAR: 'notepad.statusBarVisible'
};

class Notepad {
    constructor() {
        this.textarea = document.getElementById('notepad-text');
        this.statusBar = document.getElementById('status-bar');
        this.lineNumber = document.getElementById('line-number');
        this.colNumber = document.getElementById('col-number');
        this.currentFile = null;
        this.currentFilePath = null;
        this.isModified = false;
        this.wordWrapEnabled = false;
        this.statusBarVisible = false;
        this.anyMenuOpen = false;
        this.baseTitle = 'Notepad';
        this.windowId = null;
        this.filePathHint = null;
        this.ipcRenderer = ipcRenderer;
        this.path = path;
        this.fsPromises = fsPromises;
        this.decodeTextBuffer = decodeTextBuffer;
        this.preferenceStore = this.getPreferenceStore();
        this.pendingLaunchFilePath = null;
        this.activeLaunchFilePath = null;
        this.isProcessingLaunchFile = false;

        this.init();
    }

    init() {
        this.setupMenuHandlers();
        this.loadPreferences();
        this.applyWordWrapState();
        this.applyStatusBarState();
        this.setupTextareaHandlers();
        this.setupLaunchOpenHandlers();
        this.setupKeyboardShortcuts();
        this.setupWindowCloseHandler();
        this.updateStatusBar();
        this.updateWindowTitle();
        this.consumeInitialLaunchOptions();
    }

    ensureHostAccess() {
        const requireFn = resolveRequire();

        if (!requireFn) {
            return;
        }

        try {
            if (!this.ipcRenderer) {
                ({ ipcRenderer: this.ipcRenderer } = requireFn('electron'));
            }
        } catch (error) {
            // no-op
        }

        try {
            if (!this.path) {
                this.path = requireFn('path');
            }
        } catch (error) {
            // no-op
        }

        try {
            if (!this.fsPromises) {
                this.fsPromises = requireFn('fs').promises;
            }
        } catch (error) {
            // no-op
        }

        try {
            if (typeof this.decodeTextBuffer !== 'function') {
                ({ decodeTextBuffer: this.decodeTextBuffer } = requireFn('../../../components/explorer/file-openability.js'));
            }
        } catch (error) {
            // no-op
        }
    }

    updateWindowTitle() {
        const showName = Boolean(this.isModified || this.currentFilePath || this.currentFile);
        const displayName = this.currentFile || DEFAULT_FILENAME;
        const dirtyPrefix = this.isModified ? '*' : '';
        const title = showName ? `${dirtyPrefix}${displayName} - ${this.baseTitle}` : this.baseTitle;
        const titleElement = window.frameElement?.closest('.classic-app-container')?.querySelector('.classic-window-name');

        if (titleElement) {
            titleElement.textContent = title;
        }

        document.title = title;
        this.sendToParent('updateWindowTitle', { title });
    }

    setupWindowCloseHandler() {
        // Expose confirmClose method for parent window to call
        window.confirmClose = async () => {
            if (!this.isModified) {
                return true; // Allow close
            }

            const result = await this.confirmSaveChanges();

            if (result === 'cancel') {
                return false; // Cancel close
            } else if (result === 'save') {
                const saved = await this.saveFile();
                return saved; // Only close if save succeeded
            } else {
                return true; // Allow close without saving
            }
        };
    }

    async confirmSaveChanges() {
        const systemDialogInstance = window.parent?.systemDialog || window.systemDialog;
        if (systemDialogInstance) {
            const result = await systemDialogInstance.show({
                title: this.baseTitle,
                body: 'Do you want to save changes to ' + (this.currentFile || 'Untitled') + '?',
                status: 'save',
                buttons: 'savedontsavecancel'
            });
            return result;
        }
        return 'dontsave';
    }

    setupMenuHandlers() {
        // Menu item click handlers
        const menuItems = document.querySelectorAll('.classic-command-bar-item');
        menuItems.forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const wasActive = item.classList.contains('active');
                this.closeAllMenus();

                if (!wasActive) {
                    item.classList.add('active');
                    this.anyMenuOpen = true;
                } else {
                    this.anyMenuOpen = false;
                }
            });

            // Hover to switch when a menu is already open
            item.addEventListener('mouseenter', (e) => {
                if (this.anyMenuOpen) {
                    this.closeAllMenus();
                    item.classList.add('active');
                }
            });
        });

        // Close menus when clicking outside
        document.addEventListener('click', () => {
            this.closeAllMenus();
            this.anyMenuOpen = false;
        });

        // Menu action handlers
        const menuActions = document.querySelectorAll('.classic-context-menu-item');
        menuActions.forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = item.getAttribute('data-action');
                this.handleMenuAction(action);
                this.closeAllMenus();
                this.anyMenuOpen = false;
            });
        });
    }

    closeAllMenus() {
        const activeMenus = document.querySelectorAll('.classic-command-bar-item.active');
        activeMenus.forEach(menu => menu.classList.remove('active'));
    }

    handleMenuAction(action) {
        switch (action) {
            // File menu
            case 'new':
                this.newFile();
                break;
            case 'open':
                this.openFile();
                break;
            case 'save':
                this.saveFile();
                break;
            case 'save-as':
                this.saveFileAs();
                break;
            case 'page-setup':
                this.showNotImplemented('Page Setup');
                break;
            case 'print':
                this.print();
                break;
            case 'exit':
                this.exit();
                break;

            // Edit menu
            case 'undo':
                document.execCommand('undo');
                break;
            case 'cut':
                document.execCommand('cut');
                break;
            case 'copy':
                document.execCommand('copy');
                break;
            case 'paste':
                document.execCommand('paste');
                break;
            case 'delete':
                this.deleteSelection();
                break;
            case 'find':
                this.find();
                break;
            case 'find-next':
                this.showNotImplemented('Find Next');
                break;
            case 'replace':
                this.showNotImplemented('Replace');
                break;
            case 'goto':
                this.showNotImplemented('Go To');
                break;
            case 'select-all':
                this.textarea.select();
                break;
            case 'time-date':
                this.insertTimeDate();
                break;

            // Format menu
            case 'word-wrap':
                this.toggleWordWrap();
                break;
            case 'font':
                this.showNotImplemented('Font');
                break;

            // View menu
            case 'status-bar':
                this.toggleStatusBar();
                break;

            // Help menu
            case 'view-help':
                this.showNotImplemented('Help');
                break;
            case 'about':
                this.showAbout();
                break;
        }
    }

    setupTextareaHandlers() {
        // Track text changes
        this.textarea.addEventListener('input', () => {
            this.isModified = true;
            this.updateStatusBar();
            this.updateWindowTitle();
        });

        // Track cursor position
        this.textarea.addEventListener('keyup', () => {
            this.updateStatusBar();
        });

        this.textarea.addEventListener('click', () => {
            this.updateStatusBar();
        });
    }

    setupLaunchOpenHandlers() {
        if (this.ipcRenderer?.on) {
            this.ipcRenderer.on('setWindowId', (event, data) => {
                if (data?.windowId) {
                    this.windowId = data.windowId;
                    this.updateWindowTitle();
                }
            });

            this.ipcRenderer.on('setLaunchOptions', (event, data) => {
                this.handleLaunchOptions(data?.launchOptions);
            });
        }

        window.addEventListener('message', (event) => {
            if (event.data?.action === 'setWindowId' && event.data.windowId) {
                this.windowId = event.data.windowId;
                this.updateWindowTitle();
                return;
            }

            if (event.data?.action === 'setLaunchOptions') {
                this.handleLaunchOptions(event.data.launchOptions);
                return;
            }

            if (event.data?.action === 'openFileData' && event.data.fileData) {
                this.loadOpenedFileFromLaunch(event.data.fileData);
                return;
            }

            if (event.data?.action === 'openFile' && event.data.filePath) {
                this.queueLaunchFileOpen(event.data.filePath);
            }
        });

        document.addEventListener('openFile', (event) => {
            if (event.detail?.filePath) {
                this.queueLaunchFileOpen(event.detail.filePath);
            }
        });
    }

    consumeInitialLaunchOptions() {
        this.handleLaunchOptions(window.launchOptions);
    }

    handleLaunchOptions(launchOptions) {
        if (typeof launchOptions?.openFilePath === 'string' && launchOptions.openFilePath) {
            this.filePathHint = launchOptions.openFilePath;
        }

        if (typeof launchOptions?.openFileData?.filePath === 'string' && launchOptions.openFileData.filePath) {
            this.filePathHint = launchOptions.openFileData.filePath;
        }

        if (launchOptions?.openFileData) {
            this.loadOpenedFileFromLaunch(launchOptions.openFileData);
            return;
        }

        if (launchOptions?.openFilePath) {
            this.queueLaunchFileOpen(launchOptions.openFilePath);
        }
    }

    queueLaunchFileOpen(filePath) {
        if (!filePath) {
            return;
        }

        this.filePathHint = filePath;

        if (filePath === this.pendingLaunchFilePath || filePath === this.activeLaunchFilePath) {
            return;
        }

        this.pendingLaunchFilePath = filePath;
        if (!this.isProcessingLaunchFile) {
            this.flushLaunchFileQueue();
        }
    }

    async flushLaunchFileQueue() {
        if (this.isProcessingLaunchFile) {
            return;
        }

        this.isProcessingLaunchFile = true;

        try {
            while (this.pendingLaunchFilePath) {
                const nextFilePath = this.pendingLaunchFilePath;
                this.pendingLaunchFilePath = null;
                this.activeLaunchFilePath = nextFilePath;
                await this.loadFileFromLaunch(nextFilePath);
                this.activeLaunchFilePath = null;
            }
        } finally {
            this.activeLaunchFilePath = null;
            this.isProcessingLaunchFile = false;
        }
    }

    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Ctrl+N - New
            if (e.ctrlKey && e.key === 'n') {
                e.preventDefault();
                this.newFile();
            }
            // Ctrl+O - Open
            else if (e.ctrlKey && e.key === 'o') {
                e.preventDefault();
                this.openFile();
            }
            // Ctrl+S - Save
            else if (e.ctrlKey && e.key === 's') {
                e.preventDefault();
                this.saveFile();
            }
            // Ctrl+P - Print
            else if (e.ctrlKey && e.key === 'p') {
                e.preventDefault();
                this.print();
            }
            // Ctrl+F - Find
            else if (e.ctrlKey && e.key === 'f') {
                e.preventDefault();
                this.find();
            }
            // Ctrl+H - Replace
            else if (e.ctrlKey && e.key === 'h') {
                e.preventDefault();
                this.showNotImplemented('Replace');
            }
            // Ctrl+G - Go To
            else if (e.ctrlKey && e.key === 'g') {
                e.preventDefault();
                this.showNotImplemented('Go To');
            }
            // F5 - Time/Date
            else if (e.key === 'F5') {
                e.preventDefault();
                this.insertTimeDate();
            }
        });
    }

    updateStatusBar() {
        if (!this.statusBarVisible) return;

        const text = this.textarea.value;
        const cursorPos = this.textarea.selectionStart;

        // Calculate line and column
        const textBeforeCursor = text.substring(0, cursorPos);
        const lines = textBeforeCursor.split('\n');
        const lineNum = lines.length;
        const colNum = lines[lines.length - 1].length + 1;

        this.lineNumber.textContent = lineNum;
        this.colNumber.textContent = colNum;
    }

    // File operations
    async newFile() {
        if (this.isModified) {
            const result = await this.confirmSaveChanges();

            if (result === 'save') {
                const saved = await this.saveFile();
                if (!saved) {
                    return;
                }
            } else if (result === 'cancel') {
                return;
            }
            // If 'dontsave', continue without saving
        }
        this.textarea.value = '';
        this.currentFile = null;
        this.currentFilePath = null;
        this.isModified = false;
        this.updateStatusBar();
        this.updateWindowTitle();
    }

    async openFile() {
        this.ensureHostAccess();

        const canProceed = await this.ensureCanReplaceCurrentDocument();
        if (!canProceed) {
            return;
        }

        if (this.ipcRenderer) {
            try {
                const result = await this.ipcRenderer.invoke('notepad-open-file');
                if (!result || result.canceled) {
                    return;
                }

                this.applyOpenedFile(result);
            } catch (error) {
                await this.showError('Unable to open the selected file.\n\n' + (error?.message || 'Unknown error.'));
            }
            return;
        }

        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.txt,.text,.rtf,.log,.md,.json,.js,.css,.html,.htm,.xml,.csv,.ini,.cfg';

        input.onchange = (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    this.applyOpenedFile({
                        filePath: typeof file.path === 'string' ? file.path : null,
                        fileName: file.name,
                        content: event.target.result
                    });
                };
                reader.readAsText(file);
            }
        };

        input.click();
    }

    async loadFileFromLaunch(filePath) {
        if (!filePath) {
            return false;
        }

        const canProceed = await this.ensureCanReplaceCurrentDocument();
        if (!canProceed) {
            return false;
        }

        try {
            const result = await this.readFileFromPath(filePath);
            if (!result || result.canceled) {
                if (result?.error) {
                    await this.showError('Unable to open the selected file.\n\n' + result.error);
                }
                return false;
            }

            this.applyOpenedFile(result);
            return true;
        } catch (error) {
            await this.showError('Unable to open the selected file.\n\n' + (error?.message || 'Unknown error.'));
            return false;
        }
    }

    async loadOpenedFileFromLaunch(openedFile) {
        if (!openedFile) {
            return false;
        }

        if (typeof openedFile.filePath === 'string' && openedFile.filePath) {
            this.filePathHint = openedFile.filePath;
        }

        const canProceed = await this.ensureCanReplaceCurrentDocument();
        if (!canProceed) {
            return false;
        }

        this.applyOpenedFile(openedFile);
        return true;
    }

    async readFileFromPath(filePath) {
        this.ensureHostAccess();

        if (this.ipcRenderer?.invoke) {
            return this.ipcRenderer.invoke('notepad-open-file-path', filePath);
        }

        if (this.fsPromises?.readFile && typeof this.decodeTextBuffer === 'function') {
            const buffer = await this.fsPromises.readFile(filePath);
            const decoded = this.decodeTextBuffer(buffer);

            if (!decoded?.canOpen) {
                throw new Error('This file is not in a text format that the simulated Notepad can open.');
            }

            return {
                canceled: false,
                filePath,
                fileName: this.getDisplayName(filePath) || DEFAULT_FILENAME,
                content: decoded.content,
                encoding: decoded.encoding
            };
        }

        throw new Error('File loading is unavailable in this environment.');
    }

    applyOpenedFile(result) {
        this.ensureHostAccess();
        const resolvedFilePath = this.getWritableFilePath(result?.filePath || null);
        this.textarea.value = result?.content ?? '';
        this.currentFilePath = resolvedFilePath;
        this.filePathHint = resolvedFilePath;
        this.currentFile = result?.fileName || this.getDisplayName(this.currentFilePath) || DEFAULT_FILENAME;
        this.isModified = false;
        this.updateStatusBar();
        this.updateWindowTitle();
    }

    async ensureCanReplaceCurrentDocument() {
        if (!this.isModified) {
            return true;
        }

        const result = await this.confirmSaveChanges();

        if (result === 'cancel') {
            return false;
        }

        if (result === 'save') {
            return this.saveFile();
        }

        return true;
    }

    async saveFile() {
        this.ensureHostAccess();
        const writableFilePath = this.getWritableFilePath();

        if (writableFilePath) {
            return this.saveToExistingFile(writableFilePath);
        }

        if (this.ipcRenderer) {
            return this.saveWithHostDialog(true);
        }

        return this.saveWithBrowserDownload(false);
    }

    async saveFileAs() {
        this.ensureHostAccess();
        if (this.ipcRenderer) {
            return this.saveWithHostDialog(true);
        }
        return this.saveWithBrowserDownload(true);
    }

    async saveWithHostDialog(forceDialog) {
        try {
            this.ensureHostAccess();
            const content = this.textarea.value;
            const writableFilePath = this.getWritableFilePath();

            if (forceDialog || !writableFilePath) {
                const defaultPath = writableFilePath || this.currentFile || DEFAULT_FILENAME;
                const result = await this.ipcRenderer.invoke('notepad-save-file-as', {
                    defaultPath,
                    content
                });

                if (!result || result.canceled) {
                    return false;
                }

                if (!result.success) {
                    if (result.error) {
                        await this.showError('Unable to save the file.\n\n' + result.error);
                    }
                    return false;
                }

                this.currentFilePath = result.filePath || null;
                this.filePathHint = this.currentFilePath;
                this.currentFile = this.getDisplayName(this.currentFilePath) || this.currentFile || DEFAULT_FILENAME;
            } else {
                const result = await this.ipcRenderer.invoke('notepad-save-file', {
                    filePath: writableFilePath,
                    content
                });

                if (!result || !result.success) {
                    if (result?.error) {
                        await this.showError('Unable to save the file.\n\n' + result.error);
                    }
                    return false;
                }

                this.currentFilePath = result.filePath || writableFilePath;
                this.filePathHint = this.currentFilePath;
                this.currentFile = this.getDisplayName(this.currentFilePath) || this.currentFile || DEFAULT_FILENAME;
            }

            this.isModified = false;
            this.updateWindowTitle();
            return true;
        } catch (error) {
            await this.showError('Unable to save the file.\n\n' + (error?.message || 'Unknown error.'));
            return false;
        }
    }

    async saveToExistingFile(filePath) {
        try {
            this.ensureHostAccess();
            if (!filePath) {
                return this.saveWithBrowserDownload(false);
            }

            if (this.ipcRenderer?.invoke) {
                const result = await this.ipcRenderer.invoke('notepad-save-file', {
                    filePath,
                    content: this.textarea.value
                });

                if (!result || !result.success) {
                    if (result?.error) {
                        await this.showError('Unable to save the file.\n\n' + result.error);
                    }
                    return false;
                }

                this.currentFilePath = result.filePath || filePath;
            } else if (this.fsPromises?.writeFile) {
                await this.fsPromises.writeFile(filePath, this.textarea.value, 'utf8');
                this.currentFilePath = filePath;
            } else {
                return this.saveWithBrowserDownload(false);
            }

            this.filePathHint = this.currentFilePath;
            this.currentFile = this.getDisplayName(this.currentFilePath) || this.currentFile || DEFAULT_FILENAME;
            this.isModified = false;
            this.updateWindowTitle();
            return true;
        } catch (error) {
            await this.showError('Unable to save the file.\n\n' + (error?.message || 'Unknown error.'));
            return false;
        }
    }

    saveWithBrowserDownload(forceDialog) {
        let filename = this.currentFile;

        if (forceDialog || !filename) {
            filename = prompt('Enter filename:', filename || DEFAULT_FILENAME);
            if (!filename) {
                return false;
            }
        }

        this.downloadFile(filename);
        return true;
    }

    downloadFile(filename) {
        const text = this.textarea.value;
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();

        URL.revokeObjectURL(url);
        this.currentFile = filename;
        this.currentFilePath = null;
        this.isModified = false;
        this.updateWindowTitle();
    }

    getDisplayName(filePath) {
        this.ensureHostAccess();
        if (!filePath) {
            return null;
        }

        if (this.path && typeof this.path.basename === 'function') {
            return this.path.basename(filePath);
        }

        const segments = filePath.split(/[\\/]/);
        return segments[segments.length - 1] || filePath;
    }

    getWritableFilePath(candidatePath = null) {
        const pathCandidates = [
            candidatePath,
            this.currentFilePath,
            this.filePathHint,
            window.launchOptions?.openFilePath,
            window.launchOptions?.openFileData?.filePath,
            this.activeLaunchFilePath,
            this.pendingLaunchFilePath
        ];

        for (const nextPath of pathCandidates) {
            if (typeof nextPath === 'string' && nextPath) {
                return nextPath;
            }
        }

        return null;
    }

    async showError(message) {
        const dialogInstance = window.parent?.systemDialog || window.systemDialog;

        if (dialogInstance?.error) {
            await dialogInstance.error(message, this.baseTitle);
        } else {
            alert(message);
        }
    }

    print() {
        window.print();
    }

    sendToParent(action, data = {}) {
        if (!this.windowId || !window.parent || window.parent === window) {
            return;
        }

        window.parent.postMessage({
            action,
            windowId: this.windowId,
            appId: APP_ID,
            ...data
        }, '*');
    }

    async exit() {
        if (this.isModified) {
            const result = await this.confirmSaveChanges();

            if (result === 'save') {
                const saved = await this.saveFile();
                if (!saved) {
                    return;
                }
            } else if (result === 'cancel') {
                return;
            }
            // If 'dontsave', continue without saving
        }
        window.close();
    }

    // Edit operations
    deleteSelection() {
        const start = this.textarea.selectionStart;
        const end = this.textarea.selectionEnd;

        if (start !== end) {
            const text = this.textarea.value;
            this.textarea.value = text.substring(0, start) + text.substring(end);
            this.textarea.selectionStart = this.textarea.selectionEnd = start;
        } else {
            // Delete character at cursor
            const text = this.textarea.value;
            this.textarea.value = text.substring(0, start) + text.substring(start + 1);
            this.textarea.selectionStart = this.textarea.selectionEnd = start;
        }

        this.isModified = true;
        this.updateStatusBar();
    }

    async find() {
        const searchTerm = prompt('Find what:');
        if (searchTerm) {
            const text = this.textarea.value;
            const index = text.indexOf(searchTerm);

            if (index !== -1) {
                this.textarea.focus();
                this.textarea.setSelectionRange(index, index + searchTerm.length);
            } else {
                await systemDialog.info('Cannot find "' + searchTerm + '"', 'Notepad');
            }
        }
    }

    insertTimeDate() {
        const now = new Date();
        const timeDate = now.toLocaleTimeString() + ' ' + now.toLocaleDateString();

        const start = this.textarea.selectionStart;
        const end = this.textarea.selectionEnd;
        const text = this.textarea.value;

        this.textarea.value = text.substring(0, start) + timeDate + text.substring(end);
        this.textarea.selectionStart = this.textarea.selectionEnd = start + timeDate.length;

        this.isModified = true;
        this.updateStatusBar();
    }

    // Format operations
    toggleWordWrap() {
        this.wordWrapEnabled = !this.wordWrapEnabled;
        this.applyWordWrapState();
        this.persistPreference(PREFERENCE_KEYS.WORD_WRAP, this.wordWrapEnabled);
    }

    // View operations
    toggleStatusBar() {
        this.statusBarVisible = !this.statusBarVisible;
        this.applyStatusBarState();
        this.persistPreference(PREFERENCE_KEYS.STATUS_BAR, this.statusBarVisible);
    }

    // Help operations
    async showAbout() {
        await systemDialog.info('Notepad\n\nA simple text editor for Windows 8 Simulator\n\nVersion 1.0', 'About Notepad');
    }

    async showNotImplemented(feature) {
        await systemDialog.info(feature + ' is not yet implemented.', 'Notepad');
    }

    applyWordWrapState() {
        if (this.wordWrapEnabled) {
            this.textarea.style.whiteSpace = 'pre-wrap';
            this.textarea.style.wordWrap = 'break-word';
        } else {
            this.textarea.style.whiteSpace = 'pre';
            this.textarea.style.wordWrap = 'normal';
        }

        const wordWrapItem = document.querySelector('[data-action="word-wrap"]');
        if (wordWrapItem) {
            wordWrapItem.classList.toggle('checked', this.wordWrapEnabled);
        }
    }

    applyStatusBarState() {
        if (this.statusBarVisible) {
            this.statusBar.style.display = 'flex';
            this.updateStatusBar();
        } else {
            this.statusBar.style.display = 'none';
        }

        const statusBarItem = document.querySelector('[data-action="status-bar"]');
        if (statusBarItem) {
            statusBarItem.classList.toggle('checked', this.statusBarVisible);
        }
    }

    getPreferenceStore() {
        try {
            if (typeof getRegistry === 'function') {
                const registry = getRegistry();
                if (registry) {
                    return {
                        getItem(key) {
                            const value = registry.getValue(NOTEPAD_REGISTRY_PATH, key, null);
                            if (value == null) {
                                return null;
                            }
                            if (typeof value === 'string') {
                                return value;
                            }
                            if (typeof value === 'number') {
                                return value ? 'true' : 'false';
                            }
                            return null;
                        },
                        setItem(key, value) {
                            const stringValue = value === true || value === 'true' ? 'true'
                                : value === false || value === 'false' ? 'false'
                                    : String(value);
                            registry.setValue(
                                NOTEPAD_REGISTRY_PATH,
                                key,
                                stringValue,
                                REG_SZ
                            );
                        }
                    };
                }
            }
        } catch (error) {
            console.warn('Unable to access Notepad preferences registry store:', error);
        }

        try {
            return window.localStorage || null;
        } catch (storageError) {
            console.warn('Unable to access fallback Notepad preferences store:', storageError);
            return null;
        }
    }

    loadPreferences() {
        if (!this.preferenceStore) {
            return;
        }

        try {
            const isLocalStorageStore = typeof window !== 'undefined' && this.preferenceStore === window.localStorage;

            let wordWrapValue = this.preferenceStore.getItem(PREFERENCE_KEYS.WORD_WRAP);
            if (wordWrapValue !== null) {
                this.wordWrapEnabled = wordWrapValue === 'true';
            } else if (!isLocalStorageStore && typeof window !== 'undefined' && window.localStorage) {
                const legacyValue = window.localStorage.getItem(PREFERENCE_KEYS.WORD_WRAP);
                if (legacyValue !== null) {
                    this.wordWrapEnabled = legacyValue === 'true';
                    this.persistPreference(PREFERENCE_KEYS.WORD_WRAP, this.wordWrapEnabled);
                    try {
                        window.localStorage.removeItem(PREFERENCE_KEYS.WORD_WRAP);
                    } catch (cleanupError) {
                        console.warn('Unable to remove legacy Notepad word wrap preference:', cleanupError);
                    }
                }
            }

            let statusBarValue = this.preferenceStore.getItem(PREFERENCE_KEYS.STATUS_BAR);
            if (statusBarValue !== null) {
                this.statusBarVisible = statusBarValue === 'true';
            } else if (!isLocalStorageStore && typeof window !== 'undefined' && window.localStorage) {
                const legacyStatus = window.localStorage.getItem(PREFERENCE_KEYS.STATUS_BAR);
                if (legacyStatus !== null) {
                    this.statusBarVisible = legacyStatus === 'true';
                    this.persistPreference(PREFERENCE_KEYS.STATUS_BAR, this.statusBarVisible);
                    try {
                        window.localStorage.removeItem(PREFERENCE_KEYS.STATUS_BAR);
                    } catch (cleanupError) {
                        console.warn('Unable to remove legacy Notepad status bar preference:', cleanupError);
                    }
                }
            }
        } catch (error) {
            console.warn('Unable to load Notepad preferences:', error);
        }
    }

    persistPreference(key, value) {
        if (!this.preferenceStore) {
            return;
        }

        try {
            this.preferenceStore.setItem(key, value ? 'true' : 'false');
        } catch (error) {
            console.warn('Unable to save Notepad preference:', error);
        }
    }
}

// Initialize Notepad when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new Notepad();
});
