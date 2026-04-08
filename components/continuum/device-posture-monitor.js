const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFilePromise = promisify(execFile);

const WINDOWS_POWERSHELL_PATH = path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
);

const WM_SETTINGCHANGE = 0x001A;
const WM_DEVICECHANGE = 0x0219;
const SM_CONVERTIBLESLATEMODE = 0x2003;
const SM_SYSTEMDOCKED = 0x2004;
const REFRESH_DEBOUNCE_MS = 80;
const DEFAULT_POSTURE_STATE = Object.freeze({
    platform: process.platform,
    supported: process.platform === 'win32',
    isPostureAwareDevice: false,
    isConvertibleDevice: false,
    isDetachableLikeDevice: false,
    isSlateCapableDevice: false,
    posture: 'desktop',
    isTabletPosture: false,
    isDesktopPosture: true,
    keyboardAccessible: true,
    isDocked: false,
    deviceForm: 'unknown',
    deviceFormRaw: null,
    chassisTypes: [],
    convertibilityEnabled: null,
    convertibleSlateMode: null,
    systemDockedMetric: null,
    electronTabletMode: null,
    source: 'unsupported',
    lastUpdatedAt: null
});

function createWindowsHelpersScript() {
    return [
        "$ErrorActionPreference = 'Stop'",
        '$ProgressPreference = \'SilentlyContinue\'',
        'function Get-ItemValueSafe([string]$Path, [string]$Name) {',
        '  try {',
        '    $item = Get-ItemProperty -Path $Path -Name $Name -ErrorAction Stop',
        '    return $item.$Name',
        '  } catch {',
        '    return $null',
        '  }',
        '}',
        'Add-Type -TypeDefinition @"',
        'using System.Runtime.InteropServices;',
        'public static class Win9DevicePostureNativeMethods {',
        '  [DllImport("user32.dll")]',
        '  public static extern int GetSystemMetrics(int nIndex);',
        '}',
        '"@'
    ].join('\n');
}

function createWindowsStaticQueryScript() {
    return [
        createWindowsHelpersScript(),
        '$chassisTypes = @()',
        'try {',
        '  $enclosures = Get-CimInstance -ClassName Win32_SystemEnclosure -ErrorAction Stop',
        '  foreach ($enclosure in @($enclosures)) {',
        '    foreach ($type in @($enclosure.ChassisTypes)) {',
        '      if ($null -ne $type) {',
        '        $chassisTypes += [int]$type',
        '      }',
        '    }',
        '  }',
        '} catch {}',
        '$result = @{',
        "  deviceForm = Get-ItemValueSafe 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\OOBE' 'DeviceForm'",
        "  convertibilityEnabled = Get-ItemValueSafe 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\PriorityControl' 'ConvertibilityEnabled'",
        '  chassisTypes = @($chassisTypes | Select-Object -Unique)',
        '}',
        '[Console]::Out.Write(($result | ConvertTo-Json -Compress -Depth 4))'
    ].join('\n');
}

function createWindowsDynamicQueryScript() {
    return [
        createWindowsHelpersScript(),
        '$result = @{',
        `  convertibleSlateMode = [Win9DevicePostureNativeMethods]::GetSystemMetrics(${SM_CONVERTIBLESLATEMODE})`,
        `  systemDocked = [Win9DevicePostureNativeMethods]::GetSystemMetrics(${SM_SYSTEMDOCKED})`,
        "  registryConvertibleSlateMode = Get-ItemValueSafe 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\PriorityControl' 'ConvertibleSlateMode'",
        '}',
        '[Console]::Out.Write(($result | ConvertTo-Json -Compress -Depth 4))'
    ].join('\n');
}

function parseNullableNumber(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDeviceForm(value) {
    if (value === null || value === undefined || value === '') {
        return 'unknown';
    }

    const raw = String(value).trim();
    const numeric = Number(raw);
    if (Number.isFinite(numeric)) {
        switch (numeric) {
            case 2:
                return 'tablet';
            case 3:
                return 'desktop';
            case 4:
                return 'notebook';
            case 5:
                return 'convertible';
            case 6:
                return 'detachable';
            default:
                break;
        }
    }

    const normalized = raw.toLowerCase();
    if (normalized === 'tablet' || normalized === 'desktop' || normalized === 'notebook' ||
        normalized === 'convertible' || normalized === 'detachable') {
        return normalized;
    }

    return 'unknown';
}

function normalizeChassisTypes(values) {
    if (!Array.isArray(values)) {
        return [];
    }

    const uniqueTypes = new Set();
    for (const value of values) {
        const parsed = parseNullableNumber(value);
        if (parsed !== null) {
            uniqueTypes.add(parsed);
        }
    }

    return Array.from(uniqueTypes).sort((left, right) => left - right);
}

function inferDeviceFormFromChassisTypes(chassisTypes) {
    if (chassisTypes.includes(32)) {
        return 'detachable';
    }
    if (chassisTypes.includes(31)) {
        return 'convertible';
    }
    if (chassisTypes.includes(30)) {
        return 'tablet';
    }
    if (chassisTypes.some(type => [8, 9, 10, 14].includes(type))) {
        return 'notebook';
    }
    if (chassisTypes.some(type => [3, 4, 5, 6, 7, 13, 15, 16].includes(type))) {
        return 'desktop';
    }
    return 'unknown';
}

function buildStaticClassification(rawState = {}) {
    const deviceFormRaw = rawState.deviceForm ?? null;
    const normalizedDeviceForm = normalizeDeviceForm(deviceFormRaw);
    const chassisTypes = normalizeChassisTypes(rawState.chassisTypes);
    const chassisDeviceForm = inferDeviceFormFromChassisTypes(chassisTypes);
    const deviceForm = normalizedDeviceForm !== 'unknown' ? normalizedDeviceForm : chassisDeviceForm;
    const convertibilityEnabled = parseNullableNumber(rawState.convertibilityEnabled);
    const isDetachableLikeDevice = deviceForm === 'detachable' || chassisTypes.includes(32);
    const isConvertibleDevice = isDetachableLikeDevice ||
        deviceForm === 'convertible' ||
        chassisTypes.includes(31) ||
        convertibilityEnabled > 0;
    const isSlateCapableDevice = isConvertibleDevice ||
        deviceForm === 'tablet' ||
        chassisTypes.includes(30);

    return {
        deviceForm,
        deviceFormRaw,
        chassisTypes,
        convertibilityEnabled,
        isConvertibleDevice,
        isDetachableLikeDevice,
        isSlateCapableDevice
    };
}

function buildStateFingerprint(state) {
    return JSON.stringify({
        supported: state.supported,
        isPostureAwareDevice: state.isPostureAwareDevice,
        isConvertibleDevice: state.isConvertibleDevice,
        isDetachableLikeDevice: state.isDetachableLikeDevice,
        isSlateCapableDevice: state.isSlateCapableDevice,
        posture: state.posture,
        isTabletPosture: state.isTabletPosture,
        isDesktopPosture: state.isDesktopPosture,
        keyboardAccessible: state.keyboardAccessible,
        isDocked: state.isDocked,
        deviceForm: state.deviceForm,
        deviceFormRaw: state.deviceFormRaw,
        chassisTypes: state.chassisTypes,
        convertibilityEnabled: state.convertibilityEnabled,
        convertibleSlateMode: state.convertibleSlateMode,
        systemDockedMetric: state.systemDockedMetric,
        electronTabletMode: state.electronTabletMode,
        source: state.source
    });
}

class DevicePostureMonitor {
    constructor(mainWindow = null) {
        this.mainWindow = mainWindow;
        this.isMonitoring = false;
        this.currentState = { ...DEFAULT_POSTURE_STATE };
        this.staticClassification = null;
        this.staticClassificationPromise = null;
        this.refreshPromise = null;
        this.pendingRefreshReason = null;
        this.pendingRefreshImmediate = false;
        this.refreshTimer = null;
        this.windowHooksBound = false;

        this.handleSettingChange = this.handleSettingChange.bind(this);
        this.handleDeviceChange = this.handleDeviceChange.bind(this);
        this.handleWindowResize = this.handleWindowResize.bind(this);
        this.handleWindowClosed = this.handleWindowClosed.bind(this);
        this.handleRendererLoaded = this.handleRendererLoaded.bind(this);
    }

    attachWindow(mainWindow) {
        if (this.mainWindow === mainWindow) {
            return;
        }

        this.detachWindow();
        this.mainWindow = mainWindow;

        if (this.isMonitoring) {
            this.bindWindowHooks();
            this.scheduleRefresh('window-attached');
        }
    }

    detachWindow() {
        if (!this.mainWindow) {
            return;
        }

        this.unbindWindowHooks();
        this.mainWindow = null;
    }

    async start() {
        this.isMonitoring = true;

        if (process.platform !== 'win32') {
            this.currentState = {
                ...DEFAULT_POSTURE_STATE,
                lastUpdatedAt: new Date().toISOString()
            };
            return this.currentState;
        }

        this.bindWindowHooks();
        return this.refreshState({ forceEmit: true, reason: 'start' });
    }

    stop() {
        this.isMonitoring = false;
        this.pendingRefreshReason = null;

        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
            this.refreshTimer = null;
        }

        this.unbindWindowHooks();
    }

    async getState() {
        if (!this.isMonitoring) {
            await this.start();
        }

        if (!this.currentState.lastUpdatedAt) {
            return this.refreshState({ forceEmit: false, reason: 'lazy-get-state' });
        }

        return this.currentState;
    }

    bindWindowHooks() {
        if (!this.mainWindow || this.mainWindow.isDestroyed() || this.windowHooksBound) {
            return;
        }

        if (process.platform === 'win32' && typeof this.mainWindow.hookWindowMessage === 'function') {
            this.mainWindow.hookWindowMessage(WM_SETTINGCHANGE, this.handleSettingChange);
            this.mainWindow.hookWindowMessage(WM_DEVICECHANGE, this.handleDeviceChange);
        }

        this.mainWindow.on('resize', this.handleWindowResize);
        this.mainWindow.on('closed', this.handleWindowClosed);

        if (this.mainWindow.webContents && !this.mainWindow.webContents.isDestroyed()) {
            this.mainWindow.webContents.on('did-finish-load', this.handleRendererLoaded);
        }

        this.windowHooksBound = true;
    }

    unbindWindowHooks() {
        if (!this.mainWindow || this.mainWindow.isDestroyed() || !this.windowHooksBound) {
            this.windowHooksBound = false;
            return;
        }

        if (process.platform === 'win32' && typeof this.mainWindow.unhookWindowMessage === 'function') {
            try {
                this.mainWindow.unhookWindowMessage(WM_SETTINGCHANGE);
            } catch (_error) {}
            try {
                this.mainWindow.unhookWindowMessage(WM_DEVICECHANGE);
            } catch (_error) {}
        }

        this.mainWindow.removeListener('resize', this.handleWindowResize);
        this.mainWindow.removeListener('closed', this.handleWindowClosed);

        if (this.mainWindow.webContents && !this.mainWindow.webContents.isDestroyed()) {
            this.mainWindow.webContents.removeListener('did-finish-load', this.handleRendererLoaded);
        }

        this.windowHooksBound = false;
    }

    handleSettingChange() {
        this.scheduleRefresh('wm-settingchange', { immediate: true });
    }

    handleDeviceChange() {
        this.scheduleRefresh('wm-devicechange', { immediate: true });
    }

    handleWindowResize() {
        this.scheduleRefresh('window-resize');
    }

    handleWindowClosed() {
        this.windowHooksBound = false;
    }

    handleRendererLoaded() {
        this.emitState();
    }

    scheduleRefresh(reason = 'scheduled', options = {}) {
        if (!this.isMonitoring) {
            return;
        }

        const immediate = !!options.immediate;
        this.pendingRefreshReason = reason;
        this.pendingRefreshImmediate = this.pendingRefreshImmediate || immediate;

        if (immediate) {
            if (this.refreshTimer) {
                clearTimeout(this.refreshTimer);
                this.refreshTimer = null;
            }

            if (this.refreshPromise) {
                return;
            }

            const nextReason = this.pendingRefreshReason || reason;
            this.pendingRefreshReason = null;
            this.pendingRefreshImmediate = false;
            this.refreshState({ forceEmit: false, reason: nextReason }).catch((error) => {
                console.warn('[DevicePosture] Failed to refresh posture state:', error);
            });
            return;
        }

        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
        }

        this.refreshTimer = setTimeout(() => {
            this.refreshTimer = null;
            const nextReason = this.pendingRefreshReason || reason;
            this.pendingRefreshReason = null;
            this.pendingRefreshImmediate = false;
            this.refreshState({ forceEmit: false, reason: nextReason }).catch((error) => {
                console.warn('[DevicePosture] Failed to refresh posture state:', error);
            });
        }, REFRESH_DEBOUNCE_MS);
    }

    async refreshState({ forceEmit = false, reason = 'refresh' } = {}) {
        if (this.refreshPromise) {
            return this.refreshPromise;
        }

        this.refreshPromise = (async () => {
            const staticClassification = await this.ensureStaticClassification();
            const dynamicState = await this.queryDynamicState();
            const nextState = this.buildState(staticClassification, dynamicState);
            const didChange = buildStateFingerprint(nextState) !== buildStateFingerprint(this.currentState);

            this.currentState = {
                ...nextState,
                lastUpdatedAt: new Date().toISOString()
            };

            if (forceEmit || didChange) {
                console.log(`[DevicePosture] State updated (${reason}):`, {
                    posture: this.currentState.posture,
                    deviceForm: this.currentState.deviceForm,
                    isTabletPosture: this.currentState.isTabletPosture,
                    isDocked: this.currentState.isDocked,
                    isConvertibleDevice: this.currentState.isConvertibleDevice
                });
                this.emitState();
            }

            return this.currentState;
        })().finally(() => {
            this.refreshPromise = null;

            if (this.pendingRefreshReason) {
                const queuedReason = this.pendingRefreshReason;
                const queuedImmediate = this.pendingRefreshImmediate;
                this.pendingRefreshReason = null;
                this.pendingRefreshImmediate = false;
                this.scheduleRefresh(queuedReason, { immediate: queuedImmediate });
            }
        });

        return this.refreshPromise;
    }

    async ensureStaticClassification() {
        if (this.staticClassification) {
            return this.staticClassification;
        }

        if (!this.staticClassificationPromise) {
            this.staticClassificationPromise = this.queryStaticClassification()
                .then((classification) => {
                    this.staticClassification = classification;
                    return classification;
                })
                .finally(() => {
                    this.staticClassificationPromise = null;
                });
        }

        return this.staticClassificationPromise;
    }

    async queryStaticClassification() {
        if (process.platform !== 'win32') {
            return buildStaticClassification({});
        }

        try {
            const rawState = await this.runPowerShellJson(createWindowsStaticQueryScript(), 12000);
            return buildStaticClassification(rawState || {});
        } catch (error) {
            console.warn('[DevicePosture] Failed to query static device classification:', error.message || error);
            return buildStaticClassification({});
        }
    }

    async queryDynamicState() {
        if (process.platform !== 'win32') {
            return {
                convertibleSlateMode: null,
                systemDockedMetric: null,
                electronTabletMode: null,
                source: 'unsupported'
            };
        }

        let metricState = null;
        try {
            metricState = await this.runPowerShellJson(createWindowsDynamicQueryScript(), 8000);
        } catch (error) {
            console.warn('[DevicePosture] Failed to query dynamic posture metrics:', error.message || error);
        }

        let electronTabletMode = null;
        if (this.mainWindow && !this.mainWindow.isDestroyed() && typeof this.mainWindow.isTabletMode === 'function') {
            try {
                electronTabletMode = this.mainWindow.isTabletMode();
            } catch (error) {
                console.warn('[DevicePosture] Failed to query BrowserWindow.isTabletMode():', error.message || error);
            }
        }

        const convertibleSlateMode = parseNullableNumber(
            metricState && metricState.convertibleSlateMode !== undefined
                ? metricState.convertibleSlateMode
                : metricState && metricState.registryConvertibleSlateMode !== undefined
                    ? metricState.registryConvertibleSlateMode
                    : null
        );
        const systemDockedMetric = parseNullableNumber(metricState && metricState.systemDocked);

        return {
            convertibleSlateMode,
            systemDockedMetric,
            electronTabletMode,
            source: convertibleSlateMode !== null
                ? 'windows-system-metrics'
                : typeof electronTabletMode === 'boolean'
                    ? 'electron-tablet-mode'
                    : 'windows-fallback'
        };
    }

    buildState(staticClassification, dynamicState) {
        const convertibleSlateMode = dynamicState.convertibleSlateMode;
        const electronTabletMode = typeof dynamicState.electronTabletMode === 'boolean'
            ? dynamicState.electronTabletMode
            : null;
        const postureFromSystemMetrics = convertibleSlateMode !== null
            ? convertibleSlateMode === 0
            : null;
        const isTabletPosture = postureFromSystemMetrics !== null
            ? postureFromSystemMetrics
            : electronTabletMode === true;
        const posture = isTabletPosture ? 'tablet' : 'desktop';
        const isDocked = dynamicState.systemDockedMetric !== null
            ? dynamicState.systemDockedMetric !== 0
            : false;

        return {
            platform: process.platform,
            supported: true,
            isPostureAwareDevice: staticClassification.isSlateCapableDevice,
            isConvertibleDevice: staticClassification.isConvertibleDevice,
            isDetachableLikeDevice: staticClassification.isDetachableLikeDevice,
            isSlateCapableDevice: staticClassification.isSlateCapableDevice,
            posture,
            isTabletPosture,
            isDesktopPosture: !isTabletPosture,
            keyboardAccessible: !isTabletPosture,
            isDocked,
            deviceForm: staticClassification.deviceForm,
            deviceFormRaw: staticClassification.deviceFormRaw,
            chassisTypes: staticClassification.chassisTypes,
            convertibilityEnabled: staticClassification.convertibilityEnabled,
            convertibleSlateMode,
            systemDockedMetric: dynamicState.systemDockedMetric,
            electronTabletMode,
            source: dynamicState.source
        };
    }

    emitState() {
        if (!this.mainWindow || this.mainWindow.isDestroyed()) {
            return;
        }

        const webContents = this.mainWindow.webContents;
        if (!webContents || webContents.isDestroyed()) {
            return;
        }

        webContents.send('device-posture:changed', this.currentState);
    }

    async runPowerShellJson(script, timeoutMs = 8000) {
        const { stdout } = await execFilePromise(
            WINDOWS_POWERSHELL_PATH,
            ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
            {
                windowsHide: true,
                timeout: timeoutMs,
                maxBuffer: 1024 * 1024
            }
        );

        const trimmed = (stdout || '').trim();
        if (!trimmed) {
            return null;
        }

        return JSON.parse(trimmed);
    }
}

module.exports = DevicePostureMonitor;
