(function () {
    'use strict';

    const requireFn = resolveRequireFunction();
    const osModule = resolveOsModule();
    const childProcessModule = resolveChildProcessModule();
    const ipcRenderer = resolveIpcRenderer();
    const drivelistModule = resolveDrivelistModule();
    const shellWindow = resolveShellWindow();
    const shellDocument = shellWindow?.document || null;
    const appsManager = shellWindow?.AppsManager || null;
    const systemDialog = shellWindow?.systemDialog || window.systemDialog || null;

    const REFRESH_INTERVALS = { high: 1000, normal: 2000, low: 4000, paused: 0 };
    const PANEL_STYLES = {
        cpu: { line: '#4f9ed3', fill: 'rgba(79, 158, 211, 0.16)' },
        memory: { line: '#9a68bf', fill: 'rgba(154, 104, 191, 0.16)' },
        disk: { line: '#7aa548', fill: 'rgba(122, 165, 72, 0.14)' },
        network: { line: '#c47a26', fill: 'rgba(196, 122, 38, 0.14)' }
    };

    const state = {
        activeView: 'processes',
        detailedView: true,
        selectedWindowId: null,
        ownWindowId: null,
        performancePanel: 'cpu',
        windows: [],
        cpuHistory: [],
        memoryHistory: [],
        diskHistory: [],
        networkHistory: [],
        cpuUsage: 0,
        memoryUsage: 0,
        memoryUsedBytes: 0,
        memoryTotalBytes: 0,
        cpuSpeedGhz: 0,
        logicalProcessors: 0,
        hostUser: resolveHostUser(),
        hostMachine: resolveHostMachine(),
        lastCpuSnapshot: null,
        refreshTimer: null,
        shellListenerAttached: false,
        activeMenu: null,
        updateSpeed: 'normal',
        networkInfo: null,
        samplePromise: null,
        lastStaticTelemetryRefreshAt: 0,
        lastNetworkStatusRefreshAt: 0,
        lastPerfCounterRefreshAt: 0,
        cpuDetails: null,
        memoryDetails: null,
        diskDetails: null,
        diskActiveTime: 0,
        diskReadBytesPerSec: 0,
        diskWriteBytesPerSec: 0,
        diskResponseMs: 0,
        memoryCachedBytes: 0,
        memoryPagedPoolBytes: 0,
        memoryNonPagedPoolBytes: 0,
        memoryCommittedBytes: 0,
        memoryCommitLimitBytes: 0,
        networkSendBitsPerSec: 0,
        networkReceiveBitsPerSec: 0,
        networkTotalBitsPerSec: 0,
        options: {
            alwaysOnTop: true,
            minimizeOnUse: true,
            hideWhenMinimized: false,
            showFullAccountName: false
        }
    };

    const tabs = Array.from(document.querySelectorAll('.taskmgr-tab'));
    const views = Array.from(document.querySelectorAll('.taskmgr-view'));
    const menuItems = Array.from(document.querySelectorAll('.classic-command-bar-item[data-menu]'));
    const menuActions = Array.from(document.querySelectorAll('.classic-context-menu-item[data-action]'));
    const performanceButtons = Array.from(document.querySelectorAll('.taskmgr-performance-item'));

    const shellRoot = document.querySelector('.taskmgr-shell');
    const processesBody = document.getElementById('taskmgr-processes-body');
    const usersBody = document.getElementById('taskmgr-users-body');
    const detailsBody = document.getElementById('taskmgr-details-body');
    const statusText = document.getElementById('taskmgr-status-text');
    const statusCpu = document.getElementById('taskmgr-status-cpu');
    const statusMemory = document.getElementById('taskmgr-status-memory');
    const endTaskButton = document.getElementById('taskmgr-end-task');
    const detailsToggleButton = document.getElementById('taskmgr-details-toggle');
    const rowContextMenu = document.getElementById('taskmgr-row-context-menu');

    const sidebarCpu = document.getElementById('taskmgr-sidebar-cpu');
    const sidebarCpuMeta = document.getElementById('taskmgr-sidebar-cpu-meta');
    const sidebarMemory = document.getElementById('taskmgr-sidebar-memory');
    const sidebarMemoryMeta = document.getElementById('taskmgr-sidebar-memory-meta');
    const sidebarDisk = document.getElementById('taskmgr-sidebar-disk');
    const sidebarDiskMeta = document.getElementById('taskmgr-sidebar-disk-meta');
    const sidebarNetworkTitle = document.getElementById('taskmgr-sidebar-network-title');
    const sidebarNetwork = document.getElementById('taskmgr-sidebar-network');
    const sidebarNetworkMeta = document.getElementById('taskmgr-sidebar-network-meta');

    const sidebarCharts = {
        cpu: document.getElementById('taskmgr-sidebar-cpu-chart'),
        memory: document.getElementById('taskmgr-sidebar-memory-chart'),
        disk: document.getElementById('taskmgr-sidebar-disk-chart'),
        network: document.getElementById('taskmgr-sidebar-network-chart')
    };

    const performanceTitle = document.getElementById('taskmgr-performance-title');
    const performanceSubtitle = document.getElementById('taskmgr-performance-subtitle');
    const performanceDevice = document.getElementById('taskmgr-performance-device');
    const performanceSummary = document.getElementById('taskmgr-performance-summary');
    const performanceSpecs = document.getElementById('taskmgr-performance-specs');
    const performanceChartLabel = document.getElementById('taskmgr-performance-chart-label');
    const performanceChartScale = document.getElementById('taskmgr-performance-chart-scale');
    const performanceChart = document.getElementById('taskmgr-performance-chart');

    function resolveRequireFunction() {
        if (typeof require === 'function') {
            return require;
        }

        if (typeof window.require === 'function') {
            return window.require.bind(window);
        }

        try {
            if (window.parent && window.parent !== window && typeof window.parent.require === 'function') {
                return window.parent.require.bind(window.parent);
            }
        } catch (error) {
            // Ignore cross-frame access issues.
        }

        return null;
    }

    function resolveOsModule() {
        try {
            return requireFn ? requireFn('os') : null;
        } catch (error) {
            return null;
        }
    }

    function resolveChildProcessModule() {
        try {
            return requireFn ? requireFn('child_process') : null;
        } catch (error) {
            return null;
        }
    }

    function resolveIpcRenderer() {
        try {
            return requireFn ? requireFn('electron').ipcRenderer : null;
        } catch (error) {
            return null;
        }
    }

    function resolveDrivelistModule() {
        try {
            return requireFn ? requireFn('drivelist') : null;
        } catch (error) {
            return null;
        }
    }

    function resolveShellWindow() {
        try {
            if (window.parent && window.parent !== window && window.parent.AppsManager) {
                return window.parent;
            }
        } catch (error) {
            // Ignore same-origin access issues and fall back to the current window.
        }

        return window;
    }

    function resolveHostUser() {
        if (!osModule || typeof osModule.userInfo !== 'function') {
            return 'Current user';
        }

        try {
            const info = osModule.userInfo();
            return info.username || 'Current user';
        } catch (error) {
            return 'Current user';
        }
    }

    function resolveHostMachine() {
        if (!osModule || typeof osModule.hostname !== 'function') {
            return 'Host';
        }

        try {
            return osModule.hostname() || 'Host';
        } catch (error) {
            return 'Host';
        }
    }

    function resolveAssetPath(path) {
        if (!path || typeof path !== 'string') {
            return '';
        }

        if (/^(?:[a-z]+:)?\/\//i.test(path) || /^[A-Z]:[\\/]/i.test(path)) {
            return path;
        }

        if (path.startsWith('apps/') || path.startsWith('resources/')) {
            return `../../../${path}`;
        }

        return path;
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function formatPercent(value) {
        return `${Math.round(Number(value) || 0)}%`;
    }

    function formatBytes(value) {
        const bytes = Number(value) || 0;
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let size = bytes;
        let unitIndex = 0;

        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex += 1;
        }

        const decimals = unitIndex >= 3 ? 2 : unitIndex >= 2 ? 1 : 0;
        return `${size.toFixed(decimals)} ${units[unitIndex]}`;
    }

    function formatGigahertz(value) {
        return `${(Number(value) || 0).toFixed(2)} GHz`;
    }

    function formatGigabytes(value) {
        const bytes = Number(value) || 0;
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    }

    function formatBitsPerSecond(value) {
        const bits = Number(value) || 0;
        if (bits >= 1000000000) {
            return `${(bits / 1000000000).toFixed(1)} Gbps`;
        }
        if (bits >= 1000000) {
            return `${(bits / 1000000).toFixed(1)} Mbps`;
        }
        if (bits >= 1000) {
            return `${Math.round(bits / 1000)} Kbps`;
        }
        return `${Math.round(bits)} bps`;
    }

    function formatDuration(secondsValue) {
        const seconds = Math.max(0, Math.floor(Number(secondsValue) || 0));
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);

        if (days > 0) {
            return `${days}d ${hours}h ${minutes}m`;
        }

        return `${hours}h ${minutes}m`;
    }

    function mapMemoryFormFactor(value) {
        const code = Number(value) || 0;
        const map = {
            8: 'DIMM',
            12: 'SODIMM',
            13: 'SRIMM',
            26: 'DDR4',
            27: 'LPDDR',
            28: 'LPDDR2',
            29: 'LPDDR3',
            30: 'LPDDR4'
        };

        return map[code] || '--';
    }

    function formatVirtualization(details) {
        if (!details) {
            return '--';
        }

        if (details.virtualizationFirmwareEnabled === true) {
            return 'Enabled';
        }

        if (details.secondLevelAddressTranslationExtensions === true) {
            return 'Available';
        }

        if (details.virtualizationFirmwareEnabled === false) {
            return 'Disabled';
        }

        return '--';
    }

    function normalizeCounterName(value) {
        return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    function queryPowerShellJson(script, timeoutMs) {
        if (!childProcessModule || typeof childProcessModule.execFile !== 'function') {
            return Promise.resolve(null);
        }

        return new Promise(resolve => {
            childProcessModule.execFile(
                'powershell.exe',
                ['-NoProfile', '-Command', script],
                {
                    windowsHide: true,
                    timeout: timeoutMs || 3000,
                    maxBuffer: 1024 * 1024
                },
                (error, stdout) => {
                    if (error || !stdout) {
                        resolve(null);
                        return;
                    }

                    try {
                        resolve(JSON.parse(stdout.trim()));
                    } catch (parseError) {
                        resolve(null);
                    }
                }
            );
        });
    }

    async function refreshStaticHostDetails(force) {
        const now = Date.now();
        if (!force && now - state.lastStaticTelemetryRefreshAt < 30000) {
            return;
        }

        state.lastStaticTelemetryRefreshAt = now;

        const staticScript = [
            "$ErrorActionPreference='SilentlyContinue'",
            "$cpuReg=Get-ItemProperty 'HKLM:\\HARDWARE\\DESCRIPTION\\System\\CentralProcessor\\0'",
            "$drive=[System.IO.DriveInfo]::GetDrives() | Where-Object { $_.Name -eq 'C:\\' } | Select-Object -First 1 Name,DriveFormat,TotalSize,AvailableFreeSpace,VolumeLabel",
            '$processes=Get-Process',
            '$threadCount=($processes | ForEach-Object { $_.Threads.Count } | Measure-Object -Sum).Sum',
            '$handleCount=($processes | Measure-Object -Property Handles -Sum).Sum',
            '[pscustomobject]@{',
            ' cpu=[pscustomobject]@{ name=$cpuReg.ProcessorNameString; mhz=$cpuReg."~MHz" };',
            ' memory=[pscustomobject]@{ slotsUsed=$null; slotsTotal=$null; speed=$null; formFactor=$null };',
            ' processCount=@($processes).Count;',
            ' threadCount=$threadCount;',
            ' handleCount=$handleCount;',
            " disk=[pscustomobject]@{ deviceId='C:'; size=$drive.TotalSize; freeSpace=$drive.AvailableFreeSpace; fileSystem=$drive.DriveFormat; volumeName=$drive.VolumeLabel; pageFile=$null };",
            '} | ConvertTo-Json -Compress'
        ].join('; ');

        const [staticDetails, drives] = await Promise.all([
            queryPowerShellJson(staticScript, 4000),
            drivelistModule && typeof drivelistModule.list === 'function'
                ? drivelistModule.list().catch(() => [])
                : Promise.resolve([])
        ]);

        if (staticDetails && typeof staticDetails === 'object') {
            state.cpuDetails = {
                model: staticDetails.cpu?.name || null,
                coreCount: Number(staticDetails.cpu?.NumberOfCores) || 0,
                logicalProcessorCount: Number(staticDetails.cpu?.NumberOfLogicalProcessors) || state.logicalProcessors,
                maxSpeedGhz: (Number(staticDetails.cpu?.mhz) || 0) / 1000,
                l2CacheKb: Number(staticDetails.cpu?.L2CacheSize) || 0,
                l3CacheKb: Number(staticDetails.cpu?.L3CacheSize) || 0,
                virtualizationFirmwareEnabled: staticDetails.cpu?.VirtualizationFirmwareEnabled,
                secondLevelAddressTranslationExtensions: staticDetails.cpu?.SecondLevelAddressTranslationExtensions,
                processCount: Number(staticDetails.processCount) || 0,
                threadCount: Number(staticDetails.threadCount) || 0,
                handleCount: Number(staticDetails.handleCount) || 0
            };

            state.memoryDetails = {
                slotsUsed: Number(staticDetails.memory?.slotsUsed) || 0,
                slotsTotal: Number(staticDetails.memory?.slotsTotal) || 0,
                speedMhz: Number(staticDetails.memory?.speed) || 0,
                formFactor: mapMemoryFormFactor(staticDetails.memory?.formFactor)
            };

            state.diskDetails = {
                deviceId: staticDetails.disk?.deviceId || 'C:',
                capacityBytes: Number(staticDetails.disk?.size) || 0,
                freeBytes: Number(staticDetails.disk?.freeSpace) || 0,
                fileSystem: staticDetails.disk?.fileSystem || '--',
                volumeName: staticDetails.disk?.volumeName || null,
                pageFile: typeof staticDetails.disk?.pageFile === 'boolean' ? staticDetails.disk.pageFile : null,
                description: null,
                type: '--'
            };
        }

        if (Array.isArray(drives) && drives.length > 0) {
            const drive = drives.find(entry => Array.isArray(entry.mountpoints) && entry.mountpoints.some(point => /^C:/i.test(point.path || '')))
                || drives.find(entry => entry.isSystem)
                || drives[0];

            if (drive) {
                state.diskDetails = {
                    ...(state.diskDetails || {}),
                    description: drive.description || drive.device || 'System disk',
                    type: drive.isUSB ? 'USB' : drive.isRemovable ? 'Removable' : (drive.busType || 'Fixed'),
                    systemDisk: Boolean(drive.isSystem)
                };
            }
        }
    }

    async function refreshNetworkStatus(force) {
        const now = Date.now();
        if (!force && now - state.lastNetworkStatusRefreshAt < 5000) {
            return;
        }

        state.lastNetworkStatusRefreshAt = now;

        if (!ipcRenderer || typeof ipcRenderer.invoke !== 'function') {
            state.networkInfo = resolvePrimaryNetworkInfo();
            return;
        }

        try {
            const status = await ipcRenderer.invoke('get-network-status');
            if (!status || !status.success) {
                state.networkInfo = resolvePrimaryNetworkInfo();
                return;
            }

            const isWifi = status.type === 'wifi' || status.type === 'unknown';
            const title = isWifi ? 'Wireless' : status.type === 'ethernet' ? 'Ethernet' : 'Network';
            const adapterName = status.connected
                ? (status.wifiDetails?.ssid || status.name || title)
                : 'Not connected';
            const signal = isWifi && typeof status.signalBars === 'number'
                ? `${status.signalBars}/5`
                : (status.connected ? 'N/A' : '--');

            state.networkInfo = {
                title,
                adapterName,
                counterName: status.name || adapterName,
                connectionType: isWifi ? 'Wi-Fi' : 'Ethernet',
                ipv4: status.ip_address || '--',
                ipv6: status.ipv6_address || '--',
                signal,
                hasInternet: Boolean(status.hasInternet),
                connected: Boolean(status.connected),
                ssid: status.wifiDetails?.ssid || null
            };
        } catch (error) {
            state.networkInfo = resolvePrimaryNetworkInfo();
        }
    }

    function pickNetworkCounterSample(samples, pathFragment) {
        const candidates = samples.filter(sample => typeof sample?.Path === 'string' && sample.Path.includes(pathFragment));
        if (candidates.length === 0) {
            return null;
        }

        const targetNames = [
            state.networkInfo?.counterName,
            state.networkInfo?.adapterName,
            state.networkInfo?.ssid
        ].filter(Boolean).map(normalizeCounterName);

        for (const targetName of targetNames) {
            const matched = candidates.find(sample => {
                const instanceName = normalizeCounterName(sample.InstanceName);
                return instanceName && (instanceName.includes(targetName) || targetName.includes(instanceName));
            });

            if (matched) {
                return matched;
            }
        }

        return candidates.sort((left, right) => (Number(right.CookedValue) || 0) - (Number(left.CookedValue) || 0))[0];
    }

    async function refreshPerfCounters(force) {
        const now = Date.now();
        if (!force && now - state.lastPerfCounterRefreshAt < 700) {
            return;
        }

        state.lastPerfCounterRefreshAt = now;

        const counterScript = [
            "$ErrorActionPreference='SilentlyContinue'",
            "$paths=@('\\Processor Information(_Total)\\Processor Frequency','\\Memory\\Cache Bytes','\\Memory\\Pool Paged Bytes','\\Memory\\Pool Nonpaged Bytes','\\Memory\\Committed Bytes','\\Memory\\Commit Limit','\\PhysicalDisk(_Total)\\% Disk Time','\\PhysicalDisk(_Total)\\Disk Read Bytes/sec','\\PhysicalDisk(_Total)\\Disk Write Bytes/sec','\\PhysicalDisk(_Total)\\Avg. Disk sec/Transfer','\\Network Interface(*)\\Bytes Total/sec','\\Network Interface(*)\\Bytes Received/sec','\\Network Interface(*)\\Bytes Sent/sec')",
            'Get-Counter -Counter $paths | Select-Object -ExpandProperty CounterSamples | Select-Object Path,InstanceName,CookedValue | ConvertTo-Json -Compress'
        ].join('; ');

        const samples = await queryPowerShellJson(counterScript, 2500);
        const list = Array.isArray(samples) ? samples : (samples ? [samples] : []);
        if (list.length === 0) {
            return;
        }

        const findSample = fragment => list.find(sample => typeof sample?.Path === 'string' && sample.Path.includes(fragment));
        const cpuFrequency = findSample('Processor Frequency');
        const cacheBytes = findSample('Cache Bytes');
        const pagedPoolBytes = findSample('Pool Paged Bytes');
        const nonPagedPoolBytes = findSample('Pool Nonpaged Bytes');
        const committedBytes = findSample('Committed Bytes');
        const commitLimit = findSample('Commit Limit');
        const diskTime = findSample('% Disk Time');
        const diskRead = findSample('Disk Read Bytes/sec');
        const diskWrite = findSample('Disk Write Bytes/sec');
        const diskResponse = findSample('Avg. Disk sec/Transfer');

        if (Number(cpuFrequency?.CookedValue) > 0) {
            state.cpuSpeedGhz = Number(cpuFrequency.CookedValue) / 1000;
        }

        state.memoryCachedBytes = Math.max(0, Number(cacheBytes?.CookedValue) || 0);
        state.memoryPagedPoolBytes = Math.max(0, Number(pagedPoolBytes?.CookedValue) || 0);
        state.memoryNonPagedPoolBytes = Math.max(0, Number(nonPagedPoolBytes?.CookedValue) || 0);
        state.memoryCommittedBytes = Math.max(0, Number(committedBytes?.CookedValue) || 0);
        state.memoryCommitLimitBytes = Math.max(0, Number(commitLimit?.CookedValue) || 0);

        state.diskActiveTime = Math.max(0, Math.min(100, Number(diskTime?.CookedValue) || 0));
        state.diskReadBytesPerSec = Math.max(0, Number(diskRead?.CookedValue) || 0);
        state.diskWriteBytesPerSec = Math.max(0, Number(diskWrite?.CookedValue) || 0);
        state.diskResponseMs = Math.max(0, (Number(diskResponse?.CookedValue) || 0) * 1000);

        const networkTotal = pickNetworkCounterSample(list, 'Bytes Total/sec');
        const networkReceive = pickNetworkCounterSample(list, 'Bytes Received/sec');
        const networkSend = pickNetworkCounterSample(list, 'Bytes Sent/sec');

        state.networkTotalBitsPerSec = Math.max(0, (Number(networkTotal?.CookedValue) || 0) * 8);
        state.networkReceiveBitsPerSec = Math.max(0, (Number(networkReceive?.CookedValue) || 0) * 8);
        state.networkSendBitsPerSec = Math.max(0, (Number(networkSend?.CookedValue) || 0) * 8);
    }

    function getHistoryCapacity() {
        const effectiveSpeed = state.updateSpeed === 'paused' ? 'normal' : state.updateSpeed;
        const interval = REFRESH_INTERVALS[effectiveSpeed] || REFRESH_INTERVALS.normal;
        return Math.max(30, Math.round(60000 / interval));
    }

    function ensureHistoryCapacity(key) {
        const capacity = getHistoryCapacity();
        const current = Array.isArray(state[key]) ? state[key].slice(-capacity) : [];
        while (current.length < capacity) {
            current.unshift(0);
        }
        state[key] = current;
    }

    function pushHistory(key, value) {
        ensureHistoryCapacity(key);
        state[key].push(Number(value) || 0);
        state[key] = state[key].slice(-getHistoryCapacity());
    }

    function getDisplayedUserName() {
        if (!state.options.showFullAccountName) {
            return state.hostUser;
        }

        return `${state.hostUser}@${state.hostMachine}`;
    }

    function normalizeWindowState(windowData) {
        if (!windowData) {
            return 'Unknown';
        }

        if (windowData.state === 'minimized') {
            return 'Minimized';
        }

        if (windowData.state === 'active') {
            return 'Running';
        }

        return 'Background';
    }

    function normalizeWindowType(windowData) {
        const container = windowData?.$container;
        if (container?.hasClass('modern-app-container')) {
            return 'Immersive';
        }
        if (container?.hasClass('modern-desktop-app-container')) {
            return 'Modern desktop';
        }
        return 'Classic';
    }

    function extractWindowTitle(windowData) {
        const container = windowData?.$container;
        if (!container?.length) {
            return windowData?.app?.name || 'Untitled window';
        }

        const titleCandidates = [
            container.find('.classic-window-name').first().text().trim(),
            container.find('.modern-desktop-window-title').first().text().trim(),
            container.find('.modern-app-title').first().text().trim()
        ];

        return titleCandidates.find(Boolean) || windowData?.app?.name || 'Untitled window';
    }

    function extractWindowIcon(windowData) {
        const app = windowData?.app;
        if (!app || !appsManager || typeof appsManager.getIconImage !== 'function') {
            return '';
        }

        try {
            return resolveAssetPath(appsManager.getIconImage(app, 16));
        } catch (error) {
            return '';
        }
    }

    function getRunningWindows() {
        if (!appsManager || typeof appsManager.getRunningWindowsSnapshot !== 'function') {
            return [];
        }

        return appsManager.getRunningWindowsSnapshot()
            .filter(windowData => {
                if (!windowData?.$container?.length) {
                    return false;
                }

                if (typeof appsManager.isBackgroundWindow === 'function' && appsManager.isBackgroundWindow(windowData)) {
                    return false;
                }

                return !windowData.$container.hasClass('closing');
            })
            .map(windowData => ({
                windowId: windowData.windowId,
                appId: windowData.appId,
                appName: windowData.app?.name || windowData.appId || 'App',
                title: extractWindowTitle(windowData),
                state: normalizeWindowState(windowData),
                rawState: windowData.state || 'unknown',
                type: normalizeWindowType(windowData),
                iconPath: extractWindowIcon(windowData)
            }))
            .sort((left, right) => {
                const activeBias = Number(right.rawState === 'active') - Number(left.rawState === 'active');
                if (activeBias !== 0) {
                    return activeBias;
                }

                return left.title.localeCompare(right.title);
            });
    }

    function buildIconMarkup(entry) {
        if (entry.iconPath) {
            return `<img class="taskmgr-app-icon" src="${escapeHtml(entry.iconPath)}" alt="">`;
        }

        const fallback = (entry.appName || entry.title || '?').trim().charAt(0).toUpperCase() || '?';
        return `<span class="taskmgr-app-icon taskmgr-app-icon--fallback">${escapeHtml(fallback)}</span>`;
    }

    function getSelectedWindowEntry() {
        return state.windows.find(entry => entry.windowId === state.selectedWindowId) || null;
    }

    function bindSelectableRows(container) {
        Array.from(container.querySelectorAll('.taskmgr-row[data-window-id]')).forEach(row => {
            row.addEventListener('click', () => {
                state.selectedWindowId = row.dataset.windowId || null;
                closeRowContextMenu();
                renderProcessesView();
            });

            row.addEventListener('dblclick', () => {
                const windowId = row.dataset.windowId || null;
                if (windowId) {
                    focusWindow(windowId);
                }
            });

            row.addEventListener('contextmenu', event => {
                event.preventDefault();
                state.selectedWindowId = row.dataset.windowId || null;
                renderProcessesView();
                openRowContextMenu(event.clientX, event.clientY);
            });
        });
    }

    function renderProcessesView() {
        state.windows = getRunningWindows();

        if (state.selectedWindowId && !state.windows.some(entry => entry.windowId === state.selectedWindowId)) {
            state.selectedWindowId = null;
        }

        const rows = [`<div class="taskmgr-table__row taskmgr-table__row--group"><span>Apps (${state.windows.length})</span></div>`];

        if (state.windows.length === 0) {
            rows.push('<div class="taskmgr-table__row taskmgr-table__row--empty"><span>No Win9 windows are currently running.</span></div>');
        } else {
            state.windows.forEach(entry => {
                const selectedClass = entry.windowId === state.selectedWindowId ? ' is-selected' : '';
                rows.push(
                    `<div class="taskmgr-table__row taskmgr-row${selectedClass}" data-window-id="${escapeHtml(entry.windowId)}">` +
                        `<span class="taskmgr-name-cell">` +
                            `${buildIconMarkup(entry)}` +
                            `<span class="taskmgr-name-copy">` +
                                `<strong>${escapeHtml(entry.title)}</strong>` +
                                `<span>${escapeHtml(`${entry.type} app`)}</span>` +
                            `</span>` +
                        `</span>` +
                        `<span>${escapeHtml(entry.state)}</span>` +
                        `<span class="taskmgr-muted">--</span>` +
                        `<span class="taskmgr-muted">--</span>` +
                        `<span class="taskmgr-muted">--</span>` +
                        `<span class="taskmgr-muted">--</span>` +
                    `</div>`
                );
            });
        }

        processesBody.innerHTML = rows.join('');
        bindSelectableRows(processesBody);
        renderUsersView();
        renderDetailsView();
        updateStatusBar();
        updateEndTaskButton();
    }

    function renderUsersView() {
        usersBody.innerHTML = [
            '<div class="taskmgr-table__row taskmgr-row taskmgr-table__row--users">',
            `<span>${escapeHtml(getDisplayedUserName())}</span>`,
            '<span>Active</span>',
            `<span>${escapeHtml(String(state.windows.length))}</span>`,
            `<span>${escapeHtml(formatPercent(state.cpuUsage))}</span>`,
            `<span>${escapeHtml(formatPercent(state.memoryUsage))}</span>`,
            '</div>'
        ].join('');
    }

    function renderDetailsView() {
        if (state.windows.length === 0) {
            detailsBody.innerHTML = '<div class="taskmgr-table__row taskmgr-table__row--empty"><span>No shell windows are currently available.</span></div>';
            return;
        }

        detailsBody.innerHTML = state.windows.map(entry => {
            const selectedClass = entry.windowId === state.selectedWindowId ? ' is-selected' : '';
            return (
                `<div class="taskmgr-table__row taskmgr-row taskmgr-table__row--details${selectedClass}" data-window-id="${escapeHtml(entry.windowId)}">` +
                    `<span>${escapeHtml(entry.title)}</span>` +
                    `<span>${escapeHtml(entry.windowId)}</span>` +
                    `<span>${escapeHtml(entry.type)}</span>` +
                    `<span>${escapeHtml(entry.state)}</span>` +
                `</div>`
            );
        }).join('');

        bindSelectableRows(detailsBody);
    }

    function takeCpuSnapshot() {
        if (!osModule || typeof osModule.cpus !== 'function') {
            return [];
        }

        return osModule.cpus().map(cpu => {
            const times = cpu.times || {};
            const total = Object.values(times).reduce((sum, value) => sum + value, 0);
            return {
                idle: times.idle || 0,
                total,
                speed: cpu.speed || 0
            };
        });
    }

    function guessNetworkType(interfaceName) {
        if (/wi-?fi|wlan|wireless/i.test(interfaceName)) {
            return 'Wi-Fi';
        }

        return 'Ethernet';
    }

    function resolvePrimaryNetworkInfo() {
        const fallback = {
            title: 'Ethernet',
            adapterName: 'Not connected',
            counterName: null,
            connectionType: 'Ethernet',
            ipv4: '--',
            ipv6: '--',
            signal: '--',
            hasInternet: false,
            connected: false,
            ssid: null
        };

        if (!osModule || typeof osModule.networkInterfaces !== 'function') {
            return fallback;
        }

        try {
            const interfaces = osModule.networkInterfaces();
            const names = Object.keys(interfaces || {});

            for (const name of names) {
                const entries = Array.isArray(interfaces[name]) ? interfaces[name] : [];
                const usableEntries = entries.filter(entry => entry && !entry.internal);
                if (usableEntries.length === 0) {
                    continue;
                }

                const type = guessNetworkType(name);
                const ipv4 = usableEntries.find(entry => entry.family === 'IPv4')?.address || '--';
                const ipv6 = usableEntries.find(entry => entry.family === 'IPv6')?.address || '--';

                return {
                    title: type,
                    adapterName: name,
                    counterName: name,
                    connectionType: type,
                    ipv4,
                    ipv6,
                    signal: type === 'Wi-Fi' ? '--' : 'N/A',
                    hasInternet: true,
                    connected: true,
                    ssid: null
                };
            }
        } catch (error) {
            return fallback;
        }

        return fallback;
    }

    function sampleSystemStats(force) {
        if (state.updateSpeed === 'paused' && !force) {
            return Promise.resolve();
        }

        if (state.samplePromise) {
            return state.samplePromise;
        }

        state.samplePromise = (async () => {
            const nextSnapshot = takeCpuSnapshot();
            if (nextSnapshot.length > 0) {
                if (state.lastCpuSnapshot && state.lastCpuSnapshot.length === nextSnapshot.length) {
                    let totalDelta = 0;
                    let idleDelta = 0;

                    nextSnapshot.forEach((snapshot, index) => {
                        const previous = state.lastCpuSnapshot[index];
                        totalDelta += Math.max(0, snapshot.total - previous.total);
                        idleDelta += Math.max(0, snapshot.idle - previous.idle);
                    });

                    if (totalDelta > 0) {
                        state.cpuUsage = Math.max(0, Math.min(100, 100 - ((idleDelta / totalDelta) * 100)));
                    }
                }

                state.lastCpuSnapshot = nextSnapshot;
                state.logicalProcessors = nextSnapshot.length;
                state.cpuSpeedGhz = (nextSnapshot.reduce((sum, snapshot) => sum + snapshot.speed, 0) / nextSnapshot.length) / 1000;
            }

            if (osModule && typeof osModule.totalmem === 'function' && typeof osModule.freemem === 'function') {
                state.memoryTotalBytes = osModule.totalmem();
                state.memoryUsedBytes = state.memoryTotalBytes - osModule.freemem();
                state.memoryUsage = state.memoryTotalBytes > 0
                    ? (state.memoryUsedBytes / state.memoryTotalBytes) * 100
                    : 0;
            }

            await Promise.all([
                refreshStaticHostDetails(force),
                refreshNetworkStatus(force),
                refreshPerfCounters(force)
            ]);

            if (!state.networkInfo?.connected) {
                state.networkTotalBitsPerSec = 0;
                state.networkReceiveBitsPerSec = 0;
                state.networkSendBitsPerSec = 0;
            }

            pushHistory('cpuHistory', state.cpuUsage);
            pushHistory('memoryHistory', state.memoryUsage);
            pushHistory('diskHistory', state.diskActiveTime);
            pushHistory('networkHistory', Math.min(100, state.networkTotalBitsPerSec > 0 ? (state.networkTotalBitsPerSec / 10000000) : 0));

            renderPerformanceView();
            updateStatusBar();
            renderUsersView();
        })().finally(() => {
            state.samplePromise = null;
        });

        return state.samplePromise;
    }

    function updateStatusBar() {
        statusText.textContent = `Processes: ${state.windows.length}`;
        statusCpu.textContent = `CPU: ${formatPercent(state.cpuUsage)}`;
        statusMemory.textContent = `Memory: ${formatPercent(state.memoryUsage)}`;
    }

    function updateEndTaskButton() {
        const canEndTask = Boolean(state.selectedWindowId) && (state.activeView === 'processes' || state.activeView === 'details');
        endTaskButton.disabled = !canEndTask;
    }

    function setActiveView(viewName) {
        state.activeView = viewName;

        tabs.forEach(tab => {
            tab.classList.toggle('is-active', tab.dataset.view === viewName);
        });

        views.forEach(view => {
            view.classList.toggle('is-active', view.dataset.viewPanel === viewName);
        });

        if (viewName === 'performance') {
            sampleSystemStats(true);
            renderPerformanceView();
        }

        scheduleRefresh();
        updateEndTaskButton();
        closeRowContextMenu();
    }

    function setPerformancePanel(panelName) {
        state.performancePanel = panelName;
        performanceButtons.forEach(button => {
            button.classList.toggle('is-active', button.dataset.performancePanel === panelName);
        });
        renderPerformanceView();
    }

    function buildMetricMarkup(label, value) {
        return (
            `<div class="taskmgr-metric">` +
                `<span class="taskmgr-metric__label">${escapeHtml(label)}</span>` +
                `<span class="taskmgr-metric__value">${escapeHtml(value)}</span>` +
            `</div>`
        );
    }

    function buildSpecMarkup(label, value) {
        return (
            `<span class="taskmgr-spec__label">${escapeHtml(label)}</span>` +
            `<span class="taskmgr-spec__value">${escapeHtml(value)}</span>`
        );
    }

    function getPerformancePanelData() {
        const styles = PANEL_STYLES[state.performancePanel] || PANEL_STYLES.cpu;
        const cpuInfo = osModule && typeof osModule.cpus === 'function' ? osModule.cpus() : [];
        const cpuDetails = state.cpuDetails || null;
        const memoryDetails = state.memoryDetails || null;
        const diskDetails = state.diskDetails || null;
        const cpuModel = cpuDetails?.model || cpuInfo[0]?.model || 'Host processor';
        const maxCpuSpeed = cpuDetails?.maxSpeedGhz || (cpuInfo.length > 0
            ? Math.max(...cpuInfo.map(cpu => Number(cpu.speed) || 0)) / 1000
            : state.cpuSpeedGhz);
        const installedMemoryBytes = state.memoryTotalBytes;

        if (state.performancePanel === 'memory') {
            return {
                title: 'Memory',
                device: `${formatGigabytes(installedMemoryBytes)} installed`,
                subtitle: 'Physical memory usage sampled from the host machine.',
                chartLabel: 'Memory usage',
                chartScale: '100%',
                history: state.memoryHistory,
                style: styles,
                summaryMetrics: [
                    ['In use', formatBytes(state.memoryUsedBytes)],
                    ['Available', formatBytes(state.memoryTotalBytes - state.memoryUsedBytes)],
                    ['Committed', `${formatBytes(state.memoryCommittedBytes)} / ${formatBytes(state.memoryCommitLimitBytes)}`],
                    ['Cached', formatBytes(state.memoryCachedBytes)],
                    ['Paged pool', formatBytes(state.memoryPagedPoolBytes)],
                    ['Non-paged pool', formatBytes(state.memoryNonPagedPoolBytes)]
                ],
                specMetrics: [
                    ['Slots used', memoryDetails?.slotsUsed && memoryDetails?.slotsTotal ? `${memoryDetails.slotsUsed} / ${memoryDetails.slotsTotal}` : '--'],
                    ['Form factor', memoryDetails?.formFactor || '--'],
                    ['Speed', memoryDetails?.speedMhz ? `${memoryDetails.speedMhz} MHz` : '--'],
                    ['Hardware reserved', '--']
                ]
            };
        }

        if (state.performancePanel === 'disk') {
            return {
                title: `Disk 0 (${diskDetails?.deviceId || 'C:'})`,
                device: diskDetails?.description || 'Host storage',
                subtitle: 'Live host disk activity sampled from Windows performance counters.',
                chartLabel: 'Active time',
                chartScale: '100%',
                history: state.diskHistory,
                style: styles,
                summaryMetrics: [
                    ['Active time', formatPercent(state.diskActiveTime)],
                    ['Average response time', `${state.diskResponseMs.toFixed(1)} ms`],
                    ['Read speed', `${formatBytes(state.diskReadBytesPerSec)}/s`],
                    ['Write speed', `${formatBytes(state.diskWriteBytesPerSec)}/s`]
                ],
                specMetrics: [
                    ['Capacity', diskDetails?.capacityBytes ? formatBytes(diskDetails.capacityBytes) : '--'],
                    ['Formatted', diskDetails?.fileSystem || '--'],
                    ['System disk', diskDetails?.systemDisk ? 'Yes' : '--'],
                    ['Page file', typeof diskDetails?.pageFile === 'boolean' ? (diskDetails.pageFile ? 'Yes' : 'No') : '--'],
                    ['Type', diskDetails?.type || '--']
                ]
            };
        }

        if (state.performancePanel === 'network') {
            const networkInfo = state.networkInfo || resolvePrimaryNetworkInfo();
            return {
                title: networkInfo.title,
                device: networkInfo.adapterName,
                subtitle: networkInfo.connected ? `${networkInfo.adapterName} on the host machine.` : 'No active host network connection.',
                chartLabel: 'Throughput',
                chartScale: 'Throughput',
                history: state.networkHistory,
                style: styles,
                summaryMetrics: [
                    ['Send', formatBitsPerSecond(state.networkSendBitsPerSec)],
                    ['Receive', formatBitsPerSecond(state.networkReceiveBitsPerSec)]
                ],
                specMetrics: [
                    ['Adapter name', networkInfo.adapterName],
                    ['Connection type', networkInfo.connectionType],
                    ['IPv4 address', networkInfo.ipv4],
                    ['IPv6 address', networkInfo.ipv6],
                    ['Signal strength', networkInfo.signal],
                    ['Internet', networkInfo.hasInternet ? 'Connected' : 'No internet']
                ]
            };
        }

        return {
            title: 'CPU',
            device: cpuModel,
            subtitle: 'CPU utilization sampled from the host machine.',
            chartLabel: '% Utilization',
            chartScale: '100%',
            history: state.cpuHistory,
            style: styles,
            summaryMetrics: [
                ['Utilization', formatPercent(state.cpuUsage)],
                ['Speed', formatGigahertz(state.cpuSpeedGhz)],
                ['Processes', String(cpuDetails?.processCount || 0)],
                ['Threads', String(cpuDetails?.threadCount || 0)],
                ['Handles', String(cpuDetails?.handleCount || 0)],
                ['Up time', formatDuration(osModule && typeof osModule.uptime === 'function' ? osModule.uptime() : 0)]
            ],
            specMetrics: [
                ['Maximum speed', formatGigahertz(maxCpuSpeed)],
                ['Physical processors', String(cpuDetails?.coreCount ? 1 : 1)],
                ['Logical processors', String(cpuDetails?.logicalProcessorCount || state.logicalProcessors || 0)],
                ['Virtualization', formatVirtualization(cpuDetails)],
                ['L1 cache', '--'],
                ['L2 cache', cpuDetails?.l2CacheKb ? `${cpuDetails.l2CacheKb} KB` : '--'],
                ['L3 cache', cpuDetails?.l3CacheKb ? `${cpuDetails.l3CacheKb} KB` : '--']
            ]
        };
    }

    function renderPerformanceView() {
        const networkInfo = state.networkInfo || resolvePrimaryNetworkInfo();
        const panelData = getPerformancePanelData();
        const diskDetails = state.diskDetails || null;

        sidebarCpu.textContent = `${formatPercent(state.cpuUsage)} ${formatGigahertz(state.cpuSpeedGhz)}`;
        sidebarCpuMeta.textContent = '';
        sidebarMemory.textContent = `${formatGigabytes(state.memoryUsedBytes)} / ${formatGigabytes(state.memoryTotalBytes)}`;
        sidebarMemoryMeta.textContent = `(${formatPercent(state.memoryUsage)})`;
        sidebarDisk.textContent = formatPercent(state.diskActiveTime);
        sidebarDiskMeta.textContent = diskDetails?.type || '';
        sidebarNetworkTitle.textContent = networkInfo.title;
        sidebarNetwork.textContent = networkInfo.adapterName === 'Not connected' ? 'Not connected' : formatBitsPerSecond(state.networkTotalBitsPerSec);
        sidebarNetworkMeta.textContent = networkInfo.adapterName === 'Not connected' ? '' : networkInfo.adapterName;

        drawSparkline(sidebarCharts.cpu, state.cpuHistory, PANEL_STYLES.cpu);
        drawSparkline(sidebarCharts.memory, state.memoryHistory, PANEL_STYLES.memory);
        drawSparkline(sidebarCharts.disk, state.diskHistory, PANEL_STYLES.disk);
        drawSparkline(sidebarCharts.network, state.networkHistory, PANEL_STYLES.network);

        performanceTitle.textContent = panelData.title;
        performanceDevice.textContent = panelData.device || '';
        performanceSubtitle.textContent = panelData.subtitle;
        performanceChartLabel.textContent = panelData.chartLabel;
        performanceChartScale.textContent = panelData.chartScale;
        performanceSummary.innerHTML = panelData.summaryMetrics.map(entry => buildMetricMarkup(entry[0], entry[1])).join('');
        performanceSpecs.innerHTML = panelData.specMetrics.map(entry => buildSpecMarkup(entry[0], entry[1])).join('');

        drawChart(performanceChart, panelData.history, panelData.style);
    }

    function drawSparkline(canvas, history, style) {
        if (!canvas) {
            return;
        }

        const width = canvas.width;
        const height = canvas.height;
        const context = canvas.getContext('2d');
        if (!context) {
            return;
        }

        const values = history.length > 0 ? history : [0];
        const stepX = values.length > 1 ? width / (values.length - 1) : width;

        context.clearRect(0, 0, width, height);
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, width, height);
        context.strokeStyle = 'rgba(180, 210, 228, 0.9)';
        context.strokeRect(0.5, 0.5, width - 1, height - 1);

        context.beginPath();
        values.forEach((value, index) => {
            const x = index * stepX;
            const y = height - ((Math.max(0, Math.min(100, value)) / 100) * height);
            if (index === 0) {
                context.moveTo(x, y);
            } else {
                context.lineTo(x, y);
            }
        });
        context.strokeStyle = style.line;
        context.lineWidth = 1.5;
        context.stroke();
    }

    function drawChart(canvas, history, style) {
        if (!canvas) {
            return;
        }

        const rect = canvas.getBoundingClientRect();
        const width = Math.max(320, Math.round(rect.width || 640));
        const height = Math.max(220, Math.round(rect.height || 260));

        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
        }

        const context = canvas.getContext('2d');
        if (!context) {
            return;
        }

        const values = history.length > 0 ? history : [0];
        const stepX = values.length > 1 ? width / (values.length - 1) : width;

        context.clearRect(0, 0, width, height);
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, width, height);

        context.strokeStyle = 'rgba(189, 218, 237, 0.9)';
        context.lineWidth = 1;

        for (let row = 0; row <= 10; row += 1) {
            const y = (height / 10) * row;
            context.beginPath();
            context.moveTo(0, y);
            context.lineTo(width, y);
            context.stroke();
        }

        for (let column = 0; column <= 10; column += 1) {
            const x = (width / 10) * column;
            context.beginPath();
            context.moveTo(x, 0);
            context.lineTo(x, height);
            context.stroke();
        }

        context.strokeStyle = style.line;
        context.strokeRect(0.5, 0.5, width - 1, height - 1);

        context.beginPath();
        values.forEach((value, index) => {
            const x = index * stepX;
            const y = height - ((Math.max(0, Math.min(100, value)) / 100) * height);
            if (index === 0) {
                context.moveTo(x, y);
            } else {
                context.lineTo(x, y);
            }
        });
        context.strokeStyle = style.line;
        context.lineWidth = 1.2;
        context.stroke();
    }

    function focusWindow(windowId) {
        if (!windowId || !shellWindow || typeof shellWindow.focusClassicWindow !== 'function') {
            return;
        }

        shellWindow.focusClassicWindow(windowId);

        if (state.options.minimizeOnUse && state.ownWindowId && typeof shellWindow.minimizeClassicWindow === 'function') {
            shellWindow.minimizeClassicWindow(state.ownWindowId);
        }
    }

    function closeSelectedTask() {
        if (!state.selectedWindowId || !shellWindow || typeof shellWindow.closeClassicApp !== 'function') {
            return;
        }

        shellWindow.closeClassicApp(state.selectedWindowId);
        state.selectedWindowId = null;
        closeRowContextMenu();
        updateEndTaskButton();
        window.setTimeout(renderProcessesView, 50);
    }

    function restartSelectedTask() {
        const entry = getSelectedWindowEntry();
        if (!entry || !shellWindow || typeof shellWindow.relaunchClassicApp !== 'function') {
            return;
        }

        shellWindow.relaunchClassicApp(entry.windowId, entry.appId);
    }

    function toggleDetailsMode() {
        state.detailedView = !state.detailedView;
        shellRoot.classList.toggle('is-compact', !state.detailedView);
        detailsToggleButton.textContent = state.detailedView ? 'Fewer details' : 'More details';

        if (!state.detailedView) {
            setActiveView('processes');
        }
    }

    function showInfo(message, title) {
        if (systemDialog && typeof systemDialog.info === 'function') {
            systemDialog.info(message, title || 'Task Manager');
            return;
        }

        window.alert(message);
    }

    function launchRunDialog() {
        if (shellWindow && typeof shellWindow.launchApp === 'function') {
            shellWindow.launchApp('run', null, {});
            return;
        }

        showInfo('Run new task is not available in this environment.', 'Task Manager');
    }

    function closeTaskManagerWindow() {
        if (state.ownWindowId && shellWindow && typeof shellWindow.closeClassicApp === 'function') {
            shellWindow.closeClassicApp(state.ownWindowId);
            return;
        }

        window.close();
    }

    function setUpdateSpeed(mode) {
        if (!Object.prototype.hasOwnProperty.call(REFRESH_INTERVALS, mode)) {
            return;
        }

        state.updateSpeed = mode;
        ['cpuHistory', 'memoryHistory', 'diskHistory', 'networkHistory'].forEach(ensureHistoryCapacity);
        syncMenuState();
        scheduleRefresh();

        if (mode !== 'paused') {
            sampleSystemStats(true);
        }
    }

    function syncMenuState() {
        const optionMap = {
            'toggle-always-on-top': state.options.alwaysOnTop,
            'toggle-minimize-on-use': state.options.minimizeOnUse,
            'toggle-hide-when-minimized': state.options.hideWhenMinimized,
            'toggle-show-full-account-name': state.options.showFullAccountName
        };

        Object.keys(optionMap).forEach(action => {
            const item = document.querySelector(`[data-action="${action}"]`);
            if (item) {
                item.classList.toggle('checked', optionMap[action]);
            }
        });

        ['high', 'normal', 'low', 'paused'].forEach(mode => {
            const item = document.querySelector(`[data-action="update-speed-${mode}"]`);
            if (item) {
                item.classList.toggle('checked', state.updateSpeed === mode);
            }
        });
    }

    function scheduleRefresh() {
        if (state.refreshTimer) {
            window.clearInterval(state.refreshTimer);
            state.refreshTimer = null;
        }

        if (state.activeView !== 'performance') {
            return;
        }

        const interval = REFRESH_INTERVALS[state.updateSpeed];
        if (!interval) {
            return;
        }

        state.refreshTimer = window.setInterval(() => {
            sampleSystemStats(false);
        }, interval);
    }

    function closeCommandMenus() {
        menuItems.forEach(item => item.classList.remove('active'));
        state.activeMenu = null;
    }

    function openCommandMenu(menuName) {
        state.activeMenu = menuName;
        menuItems.forEach(item => {
            item.classList.toggle('active', item.dataset.menu === menuName);
        });
    }

    function closeRowContextMenu() {
        if (!rowContextMenu) {
            return;
        }

        rowContextMenu.classList.remove('is-open');
        rowContextMenu.style.left = '0px';
        rowContextMenu.style.top = '0px';
    }

    function updateRowContextMenuState() {
        const hasSelection = Boolean(getSelectedWindowEntry());
        Array.from(rowContextMenu.querySelectorAll('.classic-context-menu-item[data-action]')).forEach(item => {
            const action = item.dataset.action;
            let isDisabled = !hasSelection;

            if (hasSelection && (action === 'open-file-location' || action === 'properties')) {
                isDisabled = true;
            }

            item.classList.toggle('is-disabled', isDisabled);
        });
    }

    function openRowContextMenu(x, y) {
        if (!rowContextMenu) {
            return;
        }

        closeCommandMenus();
        updateRowContextMenuState();
        rowContextMenu.classList.add('is-open');

        const rect = rowContextMenu.getBoundingClientRect();
        const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
        const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
        rowContextMenu.style.left = `${Math.min(x, maxLeft)}px`;
        rowContextMenu.style.top = `${Math.min(y, maxTop)}px`;
    }

    function handleMenuAction(action) {
        switch (action) {
            case 'run-new-task':
                launchRunDialog();
                break;
            case 'exit':
                closeTaskManagerWindow();
                break;
            case 'toggle-always-on-top':
                state.options.alwaysOnTop = !state.options.alwaysOnTop;
                syncMenuState();
                break;
            case 'toggle-minimize-on-use':
                state.options.minimizeOnUse = !state.options.minimizeOnUse;
                syncMenuState();
                break;
            case 'toggle-hide-when-minimized':
                state.options.hideWhenMinimized = !state.options.hideWhenMinimized;
                syncMenuState();
                break;
            case 'toggle-show-full-account-name':
                state.options.showFullAccountName = !state.options.showFullAccountName;
                syncMenuState();
                renderUsersView();
                break;
            case 'refresh-now':
                sampleSystemStats(true);
                renderProcessesView();
                break;
            case 'update-speed-high':
                setUpdateSpeed('high');
                break;
            case 'update-speed-normal':
                setUpdateSpeed('normal');
                break;
            case 'update-speed-low':
                setUpdateSpeed('low');
                break;
            case 'update-speed-paused':
                setUpdateSpeed('paused');
                break;
            case 'about-task-manager':
                showInfo('Task Manager\n\nModeled after the 6.4-era shell resources extracted from the original executable.', 'About Task Manager');
                break;
            case 'switch-to':
                if (state.selectedWindowId) {
                    focusWindow(state.selectedWindowId);
                }
                break;
            case 'go-to-details':
                if (state.selectedWindowId) {
                    setActiveView('details');
                }
                break;
            case 'restart-process':
                restartSelectedTask();
                break;
            case 'open-file-location':
                showInfo('Open file location is not available for simulated shell windows.', 'Task Manager');
                break;
            case 'properties':
                showInfo('Properties is not available for simulated shell windows.', 'Task Manager');
                break;
            case 'end-task':
                closeSelectedTask();
                break;
            default:
                break;
        }
    }

    function handleShellWindowsChanged() {
        renderProcessesView();
    }

    function attachShellListener() {
        if (!shellDocument || state.shellListenerAttached) {
            return;
        }

        shellDocument.addEventListener('win9:running-windows-changed', handleShellWindowsChanged);
        state.shellListenerAttached = true;
    }

    function captureWindowIdentity() {
        window.addEventListener('message', event => {
            if (event.data?.action === 'setWindowId' && event.data.windowId) {
                state.ownWindowId = event.data.windowId;
                renderProcessesView();
            }
        });

        try {
            const electron = require('electron');
            if (electron?.ipcRenderer?.on) {
                electron.ipcRenderer.on('setWindowId', (event, data) => {
                    if (data?.windowId) {
                        state.ownWindowId = data.windowId;
                        renderProcessesView();
                    }
                });
            }
        } catch (error) {
            // Ignore if Electron IPC is unavailable in this context.
        }
    }

    function bindMenuEvents() {
        menuItems.forEach(item => {
            item.addEventListener('click', event => {
                event.stopPropagation();
                closeRowContextMenu();

                const menuName = item.dataset.menu;
                if (!menuName) {
                    return;
                }

                if (state.activeMenu === menuName) {
                    closeCommandMenus();
                    return;
                }

                openCommandMenu(menuName);
            });

            item.addEventListener('mouseenter', () => {
                if (state.activeMenu) {
                    openCommandMenu(item.dataset.menu);
                }
            });
        });

        menuActions.forEach(item => {
            item.addEventListener('click', event => {
                event.stopPropagation();

                if (item.classList.contains('is-disabled')) {
                    return;
                }

                const action = item.dataset.action;
                closeCommandMenus();
                closeRowContextMenu();

                if (action) {
                    handleMenuAction(action);
                }
            });
        });
    }

    function bindEvents() {
        bindMenuEvents();

        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const nextView = tab.dataset.view;
                if (nextView) {
                    setActiveView(nextView);
                }
            });
        });

        performanceButtons.forEach(button => {
            button.addEventListener('click', () => {
                const panel = button.dataset.performancePanel;
                if (panel) {
                    setPerformancePanel(panel);
                }
            });
        });

        detailsToggleButton.addEventListener('click', toggleDetailsMode);
        endTaskButton.addEventListener('click', closeSelectedTask);

        document.addEventListener('click', event => {
            if (rowContextMenu && rowContextMenu.contains(event.target)) {
                return;
            }

            closeCommandMenus();
            closeRowContextMenu();
        });

        document.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                closeCommandMenus();
                closeRowContextMenu();
                return;
            }

            if (event.key === 'F5') {
                event.preventDefault();
                sampleSystemStats(true);
                renderProcessesView();
            }
        });

        window.addEventListener('resize', () => renderPerformanceView());
    }

    function cleanup() {
        if (state.refreshTimer) {
            window.clearInterval(state.refreshTimer);
            state.refreshTimer = null;
        }

        if (shellDocument && state.shellListenerAttached) {
            shellDocument.removeEventListener('win9:running-windows-changed', handleShellWindowsChanged);
        }
    }

    function init() {
        ['cpuHistory', 'memoryHistory', 'diskHistory', 'networkHistory'].forEach(ensureHistoryCapacity);
        bindEvents();
        syncMenuState();
        captureWindowIdentity();
        attachShellListener();
        renderProcessesView();
        sampleSystemStats(true);
        scheduleRefresh();
        window.addEventListener('beforeunload', cleanup);
    }

    init();
})();
