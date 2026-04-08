(() => {
    let continuumIpcRenderer = null;
    let continuumIpcResolutionAttempted = false;

    const DEVICE_POSTURE_CLASS_PREFIXES = [
        'device-posture-',
        'device-form-'
    ];
    const TASKBAR_ADVANCED_PATH = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced';

    function resolveElectronIpc() {
        if (continuumIpcRenderer) {
            return continuumIpcRenderer;
        }

        if (window.Win9ElectronBridge &&
            typeof window.Win9ElectronBridge.invoke === 'function' &&
            typeof window.Win9ElectronBridge.on === 'function') {
            continuumIpcRenderer = window.Win9ElectronBridge;
            return continuumIpcRenderer;
        }

        const requireCandidates = [];
        if (typeof window !== 'undefined' && typeof window.require === 'function') {
            requireCandidates.push(window.require.bind(window));
        }
        if (typeof require === 'function') {
            requireCandidates.push(require);
        }

        for (const candidate of requireCandidates) {
            try {
                const electronModule = candidate('electron');
                if (electronModule?.ipcRenderer) {
                    continuumIpcRenderer = electronModule.ipcRenderer;
                    return continuumIpcRenderer;
                }
            } catch (error) {
                if (!continuumIpcResolutionAttempted) {
                    console.debug('[DevicePostureDOM] ipcRenderer unavailable during resolution:', error.message || error);
                }
            }
        }

        continuumIpcResolutionAttempted = true;
        return null;
    }

    function resolveRegistryModule() {
        const contexts = [window, window.parent, window.top];
        for (const context of contexts) {
            if (!context) {
                continue;
            }

            if (context.RegistryAPI) {
                return context.RegistryAPI;
            }
        }

        if (typeof window !== 'undefined' && typeof window.require === 'function') {
            try {
                return window.require('./registry/registry.js');
            } catch (error) {
                console.debug('[DevicePostureDOM] Registry module unavailable via window.require:', error.message || error);
            }
        }

        if (typeof require === 'function') {
            try {
                return require('./registry/registry.js');
            } catch (error) {
                console.debug('[DevicePostureDOM] Registry module unavailable via require:', error.message || error);
            }
        }

        return null;
    }

    class DevicePostureDomMonitor {
        constructor() {
            this.ipc = null;
            this.currentState = null;
            this.continuumSettings = { enabled: true };
            this.retrySetupTimer = null;
            this.isSetupComplete = false;
            this.handlePostureChanged = this.handlePostureChanged.bind(this);
            this.handleContinuumSettingsChanged = this.handleContinuumSettingsChanged.bind(this);
            this.init();
        }

        init() {
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => this.setup(), { once: true });
            } else {
                this.setup();
            }
        }

        async setup() {
            if (this.isSetupComplete) {
                return;
            }

            this.ipc = resolveElectronIpc();
            if (!this.ipc) {
                if (!this.retrySetupTimer) {
                    this.retrySetupTimer = window.setTimeout(() => {
                        this.retrySetupTimer = null;
                        this.setup();
                    }, 250);
                }
                return;
            }

            this.isSetupComplete = true;
            console.log('[DevicePostureDOM] IPC bridge ready.');
            window.addEventListener('win9-continuum-settings-changed', this.handleContinuumSettingsChanged);
            this.refreshContinuumSettings();
            this.ipc.on('device-posture:changed', this.handlePostureChanged);

            try {
                const state = await this.ipc.invoke('device-posture:get-state');
                console.log('[DevicePostureDOM] Initial posture state loaded:', state);
                this.applyState(state);
            } catch (error) {
                console.warn('[DevicePostureDOM] Failed to load initial posture state:', error);
            }
        }

        handlePostureChanged(_event, state) {
            console.log('[DevicePostureDOM] IPC posture update received:', state);
            this.applyState(state);
        }

        handleContinuumSettingsChanged(event) {
            this.applyContinuumSettings(event?.detail || {});
            this.applyState(this.currentState);
        }

        refreshContinuumSettings() {
            this.applyContinuumSettings();
        }

        applyContinuumSettings() {
            this.continuumSettings = { enabled: true };
            console.log('[DevicePostureDOM] Continuum settings resolved:', this.continuumSettings);
        }

        applyState(state) {
            if (!document.body) {
                return;
            }

            this.currentState = state || null;
            window.Win9DevicePosture = {
                currentState: this.currentState,
                isEnabled: () => this.continuumSettings.enabled,
                getCurrentState: () => this.currentState
            };

            this.clearManagedClasses(document.body);

            document.body.dataset.devicePostureEnabled = this.continuumSettings.enabled ? 'true' : 'false';

            console.log('[DevicePostureDOM] Applying state to DOM:', {
                enabled: this.continuumSettings.enabled,
                posture: state?.posture || 'unknown',
                isTabletPosture: state?.isTabletPosture ?? null,
                deviceForm: state?.deviceForm || 'unknown'
            });

            if (!this.continuumSettings.enabled || !state) {
                delete document.body.dataset.devicePosture;
                delete document.body.dataset.deviceForm;
                delete document.body.dataset.devicePostureSupported;
                delete document.body.dataset.deviceDocked;
                delete document.body.dataset.deviceKeyboardAccessible;

                window.dispatchEvent(new CustomEvent('win9-device-posture-changed', {
                    detail: {
                        enabled: false,
                        state
                    }
                }));
                return;
            }

            const classes = new Set([
                'device-posture-initialized',
                state.supported ? 'device-posture-supported' : 'device-posture-unsupported',
                `device-posture-${state.posture || 'unknown'}`,
                state.isTabletPosture ? 'device-posture-tablet-active' : 'device-posture-desktop-active',
                state.isDocked ? 'device-posture-docked' : 'device-posture-undocked',
                state.keyboardAccessible ? 'device-posture-keyboard-accessible' : 'device-posture-keyboard-hidden',
                state.isPostureAwareDevice ? 'device-posture-aware-device' : 'device-posture-nonadaptive-device',
                state.isConvertibleDevice ? 'device-posture-convertible-capable' : 'device-posture-nonconvertible-device',
                state.isDetachableLikeDevice ? 'device-posture-detachable-capable' : 'device-posture-nondetachable-device',
                state.isSlateCapableDevice ? 'device-posture-slate-capable' : 'device-posture-nonslate-device',
                `device-form-${state.deviceForm || 'unknown'}`
            ]);

            document.body.classList.add(...Array.from(classes));
            document.body.dataset.devicePosture = state.posture || 'unknown';
            document.body.dataset.deviceForm = state.deviceForm || 'unknown';
            document.body.dataset.devicePostureSupported = state.supported ? 'true' : 'false';
            document.body.dataset.deviceDocked = state.isDocked ? 'true' : 'false';
            document.body.dataset.deviceKeyboardAccessible = state.keyboardAccessible ? 'true' : 'false';

            window.dispatchEvent(new CustomEvent('win9-device-posture-changed', {
                detail: {
                    enabled: true,
                    state
                }
            }));
        }

        clearManagedClasses(target) {
            const classesToRemove = [];

            for (const className of target.classList) {
                if (DEVICE_POSTURE_CLASS_PREFIXES.some(prefix => className.startsWith(prefix))) {
                    classesToRemove.push(className);
                }
            }

            if (classesToRemove.length > 0) {
                target.classList.remove(...classesToRemove);
            }
        }
    }

    window.devicePostureDomMonitor = new DevicePostureDomMonitor();
})();
