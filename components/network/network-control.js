/**
 * Network Control - Main process module for network detection
 * Uses 'network' package for connection type detection
 * Uses 'node-wifi' package for WiFi signal strength
 */

const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const network = require('network');
const wifi = require('node-wifi');
const windowsRadioControl = require('../device_connectivity/windows-radio-control');

const execFilePromise = promisify(execFile);
const WINDOWS_POWERSHELL_PATH = path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
);

class NetworkControl {
    constructor() {
        this.lastStatus = null;
        this.updateInterval = null;
        this.statusRequestPromise = null;
        this.lastResolvedStatus = null;
        this.monitoringActive = false;
        this.wifiInitialized = false;
        this.initWifi();
    }

    /**
     * Initialize node-wifi
     */
    initWifi() {
        try {
            wifi.init({
                iface: null // Network interface, choose a random wifi interface if set to null
            });
            this.wifiInitialized = true;
            console.log('node-wifi initialized successfully');
        } catch (error) {
            console.error('Failed to initialize node-wifi:', error);
            this.wifiInitialized = false;
        }
    }

    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    createDisconnectedStatus(overrides = {}) {
        return {
            connected: false,
            type: 'none',
            name: null,
            ip_address: null,
            mac_address: null,
            gateway_ip: null,
            netmask: null,
            hasInternet: false,
            hasGateway: false,
            wifiDetails: null,
            wifiAvailable: false,
            wifiEnabled: false,
            signalBars: 0,
            ...overrides
        };
    }

    cloneStatus(status) {
        if (!status) {
            return status;
        }

        return {
            ...status,
            wifiDetails: status.wifiDetails ? { ...status.wifiDetails } : status.wifiDetails
        };
    }

    parseWindowsInterfaceStates(stdout) {
        if (!stdout) {
            return [];
        }

        const interfaces = [];
        let inTable = false;

        for (const rawLine of stdout.split(/\r?\n/)) {
            const line = rawLine.trimEnd();
            const trimmedLine = line.trim();

            if (!trimmedLine) {
                continue;
            }

            if (/^Admin State\s+State\s+Type\s+Interface Name$/i.test(trimmedLine)) {
                inTable = true;
                continue;
            }

            if (!inTable || /^-+$/.test(trimmedLine)) {
                continue;
            }

            const parts = trimmedLine.split(/\s{2,}/);
            if (parts.length < 4) {
                continue;
            }

            interfaces.push({
                adminState: parts[0],
                state: parts[1],
                type: parts[2],
                name: parts.slice(3).join('  ')
            });
        }

        return interfaces;
    }

    async getWindowsInterfaceStates() {
        try {
            const { stdout } = await execFilePromise(
                'netsh',
                ['interface', 'show', 'interface'],
                {
                    windowsHide: true,
                    timeout: 7000,
                    maxBuffer: 1024 * 1024
                }
            );

            return this.parseWindowsInterfaceStates(stdout);
        } catch (error) {
            console.error('Failed to query Windows interface states:', error);
            return [];
        }
    }

    rememberResolvedStatus(status) {
        this.lastResolvedStatus = this.cloneStatus(status);
        return status;
    }

    getCachedStatus() {
        if (!this.lastResolvedStatus) {
            return null;
        }

        return this.cloneStatus(this.lastResolvedStatus);
    }

    isTransientStatusError(error) {
        return Boolean(
            error?.code === 'ETIMEDOUT' ||
            error?.signal === 'SIGTERM' ||
            error?.killed
        );
    }

    formatStatusError(error) {
        if (!error) {
            return 'Unknown error';
        }

        if (this.isTransientStatusError(error)) {
            return 'timed out while querying Windows network status';
        }

        if (typeof error.message === 'string' && error.message.trim()) {
            return error.message.split(/\r?\n/, 1)[0];
        }

        return String(error);
    }

    prefixLengthToNetmask(prefixLength) {
        const parsedPrefix = Number(prefixLength);

        if (!Number.isInteger(parsedPrefix) || parsedPrefix < 0 || parsedPrefix > 32) {
            return null;
        }

        if (parsedPrefix === 0) {
            return '0.0.0.0';
        }

        const mask = (0xffffffff << (32 - parsedPrefix)) >>> 0;
        return [
            (mask >>> 24) & 255,
            (mask >>> 16) & 255,
            (mask >>> 8) & 255,
            mask & 255
        ].join('.');
    }

    normalizeConnectionType(...values) {
        const combined = values
            .filter(Boolean)
            .map(value => String(value).toLowerCase())
            .join(' ');

        if (/wi-?fi|wireless|wlan|802\.11|native 802\.11|airport/.test(combined)) {
            return 'wifi';
        }

        if (/ethernet|802\.3|\blan\b|\bwired\b/.test(combined)) {
            return 'ethernet';
        }

        return 'unknown';
    }

    isUsableIpAddress(value) {
        if (!value) {
            return false;
        }

        const normalized = String(value).trim();
        return Boolean(normalized) && normalized !== '0.0.0.0' && !normalized.startsWith('169.254.');
    }

    shouldPreferWindowsWifiStatus(status) {
        if (!status || !status.connected) {
            return true;
        }

        if (status.type === 'wifi' || status.type === 'none' || status.type === 'unknown') {
            return true;
        }

        return false;
    }

    mergeWindowsWifiStatus(status, wifiDetails) {
        if (!wifiDetails || !this.shouldPreferWindowsWifiStatus(status)) {
            return status;
        }

        const hasUsableIp = this.isUsableIpAddress(status?.ip_address);
        const hasGateway = Boolean(status?.hasGateway || status?.gateway_ip);
        const connected = Boolean(status?.connected || hasUsableIp || hasGateway || wifiDetails.ssid || wifiDetails.iface);

        return {
            ...(status || {}),
            connected,
            type: 'wifi',
            name: status?.name || wifiDetails.iface || wifiDetails.ssid || 'Wi-Fi',
            interfaceDescription: status?.interfaceDescription || wifiDetails.iface || null
        };
    }

    async runWindowsPowerShell(script, timeoutMs = 7000) {
        const { stdout } = await execFilePromise(
            WINDOWS_POWERSHELL_PATH,
            ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
            {
                windowsHide: true,
                timeout: timeoutMs,
                maxBuffer: 1024 * 1024
            }
        );

        return (stdout || '').trim();
    }

    async runWindowsPowerShellJson(script, timeoutMs = 7000) {
        const stdout = await this.runWindowsPowerShell(script, timeoutMs);
        if (!stdout) {
            return null;
        }

        return JSON.parse(stdout);
    }

    formatShellError(error, fallbackMessage) {
        const stdout = typeof error?.stdout === 'string' ? error.stdout.trim() : '';
        const stderr = typeof error?.stderr === 'string' ? error.stderr.trim() : '';
        const message = stdout || stderr || error?.message || fallbackMessage;

        if (/requires elevation|run as administrator|access is denied/i.test(message)) {
            return 'This action requires running the simulator as administrator.';
        }

        return message || fallbackMessage;
    }

    parseWindowsWifiInterfaces(stdout) {
        if (!stdout) {
            return [];
        }

        const interfaces = [];
        let currentInterface = null;

        const commitInterface = () => {
            if (currentInterface && Object.keys(currentInterface).length > 0) {
                interfaces.push(currentInterface);
            }
        };

        for (const rawLine of stdout.split(/\r?\n/)) {
            const line = rawLine.trimEnd();
            const match = line.match(/^\s*([^:]+?)\s*:\s*(.*)$/);

            if (!match) {
                continue;
            }

            const key = match[1].trim().toLowerCase();
            const value = match[2].trim();

            if (key === 'name') {
                commitInterface();
                currentInterface = {};
            }

            if (!currentInterface) {
                currentInterface = {};
            }

            currentInterface[key] = value;
        }

        commitInterface();
        return interfaces;
    }

    async getWindowsWiFiDetails() {
        try {
            const { stdout } = await execFilePromise(
                'netsh',
                ['wlan', 'show', 'interfaces'],
                {
                    windowsHide: true,
                    timeout: 7000,
                    maxBuffer: 1024 * 1024
                }
            );

            const interfaces = this.parseWindowsWifiInterfaces(stdout);
            const activeInterface = interfaces.find(entry => (entry.state || '').toLowerCase() === 'connected');

            if (!activeInterface) {
                return null;
            }

            const signalQuality = parseFloat(String(activeInterface.signal || '').replace('%', '').trim());
            const rssi = parseInt(activeInterface.rssi, 10);
            const channel = parseInt(activeInterface.channel, 10);
            const receiveRate = parseFloat(String(activeInterface['receive rate (mbps)'] || '').trim());
            const transmitRate = parseFloat(String(activeInterface['transmit rate (mbps)'] || '').trim());

            return {
                iface: activeInterface.name || null,
                ssid: activeInterface.ssid || null,
                bssid: activeInterface['ap bssid'] || null,
                mac: activeInterface['physical address'] || null,
                channel: Number.isFinite(channel) ? channel : null,
                frequency: null,
                signal_level: Number.isFinite(rssi) ? rssi : null,
                quality: Number.isFinite(signalQuality) ? signalQuality : null,
                security: activeInterface.authentication || null,
                security_flags: activeInterface.cipher || null,
                mode: activeInterface['network type'] || null,
                radio: activeInterface['radio type'] || null,
                receive_rate_mbps: Number.isFinite(receiveRate) ? receiveRate : null,
                transmit_rate_mbps: Number.isFinite(transmitRate) ? transmitRate : null
            };
        } catch (error) {
            console.error('Failed to query Windows Wi-Fi details:', error);
            return null;
        }
    }

    async getWindowsNetworkStatus() {
        const script = [
            "$ErrorActionPreference = 'Stop'",
            '$profiles = @(Get-NetConnectionProfile -ErrorAction SilentlyContinue)',
            '$adapters = @(Get-NetAdapter -ErrorAction SilentlyContinue)',
            '$adaptersByIndex = @{}',
            'foreach ($adapterEntry in $adapters) {',
            '  $adaptersByIndex[[string]$adapterEntry.InterfaceIndex] = $adapterEntry',
            '}',
            '$candidates = foreach ($profile in $profiles) {',
            '  $adapter = $adaptersByIndex[[string]$profile.InterfaceIndex]',
            '  $hasInternet = ($profile.IPv4Connectivity -eq "Internet" -or $profile.IPv6Connectivity -eq "Internet")',
            '  $adapterStatus = if ($adapter) { [string]$adapter.Status } else { "" }',
            '  $hasUsableAdapter = ($adapterStatus -eq "Up" -or $adapterStatus -eq "Connected" -or $adapterStatus -eq "Dormant")',
            '  $adapterName = if ($adapter) { [string]$adapter.Name } else { [string]$profile.InterfaceAlias }',
            '  $adapterDescription = if ($adapter) { [string]$adapter.InterfaceDescription } else { [string]$profile.Name }',
            '  $adapterMediaType = if ($adapter) { [string]$adapter.MediaType } else { "" }',
            '  $adapterPhysicalMediaType = if ($adapter) { [string]$adapter.PhysicalMediaType } else { "" }',
            '  $isWifiAdapter = (($adapterName -match "wi-?fi|wireless|wlan|802\\.11") -or ($adapterDescription -match "wi-?fi|wireless|wlan|802\\.11") -or ($adapterMediaType -match "wi-?fi|wireless|wlan|802\\.11") -or ($adapterPhysicalMediaType -match "wi-?fi|wireless|wlan|802\\.11"))',
            '  $isEthernetAdapter = (($adapterName -match "ethernet|802\\.3|\\blan\\b|\\bwired\\b") -or ($adapterDescription -match "ethernet|802\\.3|\\blan\\b|\\bwired\\b") -or ($adapterMediaType -match "ethernet|802\\.3|\\blan\\b|\\bwired\\b") -or ($adapterPhysicalMediaType -match "ethernet|802\\.3|\\blan\\b|\\bwired\\b"))',
            '  $score = 0',
            '  if ($hasInternet) { $score += 1000 }',
            '  elseif ($profile.IPv4Connectivity -eq "LocalNetwork" -or $profile.IPv6Connectivity -eq "LocalNetwork") { $score += 400 }',
            '  elseif ($profile.IPv4Connectivity -eq "Subnet" -or $profile.IPv6Connectivity -eq "Subnet") { $score += 200 }',
            '  if ($isEthernetAdapter -and $hasUsableAdapter) { $score += 1500 }',
            '  if ($hasUsableAdapter) { $score += 200 }',
            '  if ($isWifiAdapter -and $hasUsableAdapter) { $score += 25 }',
            '  if (($hasUsableAdapter -or $hasInternet) -and $score -gt 0) {',
            '    [pscustomobject]@{',
            '      interfaceIndex = [int]$profile.InterfaceIndex',
            '      interfaceAlias = [string]$profile.InterfaceAlias',
            '      profileName = [string]$profile.Name',
            '      networkCategory = [string]$profile.NetworkCategory',
            '      ipv4Connectivity = [string]$profile.IPv4Connectivity',
            '      ipv6Connectivity = [string]$profile.IPv6Connectivity',
            '      hasInternet = $hasInternet',
            '      connectionType = if ($isEthernetAdapter) { "ethernet" } elseif ($isWifiAdapter) { "wifi" } else { "unknown" }',
            '      score = $score',
            '    }',
            '  }',
            '}',
            '$candidate = $candidates | Sort-Object @{ Expression = { $_.score }; Descending = $true }, @{ Expression = { $_.interfaceIndex }; Descending = $false } | Select-Object -First 1',
            'if ($null -eq $candidate) {',
            "  [Console]::Out.Write((@{ connected = $false } | ConvertTo-Json -Compress))",
            '  exit 0',
            '}',
            '$adapter = $adaptersByIndex[[string]$candidate.interfaceIndex]',
            '$ipConfiguration = Get-NetIPConfiguration -InterfaceIndex $candidate.interfaceIndex -ErrorAction SilentlyContinue',
            '$ipv4Address = @($ipConfiguration.IPv4Address | Where-Object { $_.IPAddress -and $_.IPAddress -notlike "169.254*" }) | Select-Object -First 1',
            '$gateway = @($ipConfiguration.IPv4DefaultGateway) | Select-Object -First 1',
            '$result = @{',
            '  connected = [bool]($adapter -or $candidate.hasInternet)',
            '  name = if ($adapter -and $adapter.Name) { $adapter.Name } else { $candidate.interfaceAlias }',
            '  interfaceDescription = if ($adapter) { $adapter.InterfaceDescription } else { $null }',
            '  mediaType = if ($adapter) { $adapter.MediaType } else { $null }',
            '  physicalMediaType = if ($adapter) { $adapter.PhysicalMediaType } else { $null }',
            '  adapterStatus = if ($adapter) { $adapter.Status } else { $null }',
            '  ip_address = if ($ipv4Address) { $ipv4Address.IPAddress } else { $null }',
            '  mac_address = if ($adapter -and $adapter.MacAddress) { $adapter.MacAddress } else { $null }',
            '  gateway_ip = if ($gateway -and $gateway.NextHop) { $gateway.NextHop } else { $null }',
            '  prefixLength = if ($ipv4Address) { $ipv4Address.PrefixLength } else { $null }',
            '  profileName = $candidate.profileName',
            '  interfaceAlias = $candidate.interfaceAlias',
            '  interfaceIndex = $candidate.interfaceIndex',
            '  networkCategory = $candidate.networkCategory',
            '  ipv4Connectivity = $candidate.ipv4Connectivity',
            '  ipv6Connectivity = $candidate.ipv6Connectivity',
            '  connectionType = [string]$candidate.connectionType',
            '  hasInternet = [bool]$candidate.hasInternet',
            '  hasGateway = ($null -ne $gateway -and [string]::IsNullOrWhiteSpace($gateway.NextHop) -eq $false)',
            '}',
            '[Console]::Out.Write(($result | ConvertTo-Json -Compress))'
        ].join('\n');

        const status = await this.runWindowsPowerShellJson(script, 20000);

        if (!status || !status.connected) {
            return this.createDisconnectedStatus();
        }

        return {
            connected: true,
            type: status.connectionType || this.normalizeConnectionType(
                status.name,
                status.interfaceDescription,
                status.mediaType,
                status.physicalMediaType
            ),
            name: status.name || status.interfaceAlias || null,
            ip_address: status.ip_address || null,
            mac_address: status.mac_address || null,
            gateway_ip: status.gateway_ip || null,
            netmask: this.prefixLengthToNetmask(status.prefixLength),
            hasInternet: Boolean(status.hasInternet),
            hasGateway: Boolean(status.hasGateway),
            interfaceDescription: status.interfaceDescription || null,
            mediaType: status.mediaType || null,
            physicalMediaType: status.physicalMediaType || null,
            networkCategory: status.networkCategory || null,
            networkName: status.profileName || null,
            ipv4Connectivity: status.ipv4Connectivity || null,
            ipv6Connectivity: status.ipv6Connectivity || null
        };
    }

    async getWindowsWifiRadioState() {
        const [wifiInterfaces, interfaceStates] = await Promise.all([
            (async () => {
                try {
                    const { stdout } = await execFilePromise(
                        'netsh',
                        ['wlan', 'show', 'interfaces'],
                        {
                            windowsHide: true,
                            timeout: 7000,
                            maxBuffer: 1024 * 1024
                        }
                    );

                    return this.parseWindowsWifiInterfaces(stdout);
                } catch (error) {
                    console.error('Failed to query Windows Wi-Fi interfaces:', error);
                    return [];
                }
            })(),
            this.getWindowsInterfaceStates()
        ]);

        const interfaceStatesByName = new Map(
            interfaceStates.map((entry) => [String(entry.name || '').trim().toLowerCase(), entry])
        );

        let resolvedInterfaces = wifiInterfaces.map((entry) => {
            const name = String(entry.name || '').trim();
            const interfaceState = interfaceStatesByName.get(name.toLowerCase());
            const adminState = String(interfaceState?.adminState || '').trim().toLowerCase();

            return {
                name,
                adminState,
                state: String(entry.state || '').trim().toLowerCase()
            };
        });

        if (resolvedInterfaces.length === 0) {
            resolvedInterfaces = interfaceStates
                .filter((entry) => /wi-?fi|wireless|wlan/i.test(String(entry.name || '')))
                .map((entry) => ({
                    name: String(entry.name || '').trim(),
                    adminState: String(entry.adminState || '').trim().toLowerCase(),
                    state: String(entry.state || '').trim().toLowerCase()
                }));
        }

        const available = resolvedInterfaces.length > 0;
        const enabled = available && resolvedInterfaces.some((entry) => entry.adminState !== 'disabled');

        return {
            available,
            enabled,
            interfaceNames: resolvedInterfaces.map((entry) => entry.name).filter(Boolean)
        };
    }

    async setWindowsWifiEnabled(enabled) {
        let winRtDeniedReason = null;

        try {
            const radioResult = await windowsRadioControl.setRadioState('WiFi', enabled);
            if (radioResult?.success && radioResult.setResult === 'Allowed') {
                this.statusRequestPromise = null;
                this.lastResolvedStatus = null;
                await this.delay(900);

                const refreshedStatus = await this.getFullNetworkStatus();
                if (Boolean(refreshedStatus.wifiEnabled) === Boolean(enabled)) {
                    return refreshedStatus;
                }
            } else if (radioResult?.setResult) {
                winRtDeniedReason = `WinRT radio access was ${radioResult.setResult}.`;
            } else if (radioResult?.error) {
                winRtDeniedReason = radioResult.error;
            }
        } catch (error) {
            winRtDeniedReason = this.formatShellError(error, 'WinRT Wi-Fi control failed.');
        }

        const radioState = await this.getWindowsWifiRadioState();

        if (!radioState.available || !radioState.interfaceNames.length) {
            throw new Error('No Wi-Fi adapter was found on this system.');
        }

        const adminState = enabled ? 'ENABLED' : 'DISABLED';
        const uniqueInterfaceNames = [...new Set(radioState.interfaceNames)];

        try {
            for (const interfaceName of uniqueInterfaceNames) {
                await execFilePromise(
                    'netsh',
                    ['interface', 'set', 'interface', `name="${interfaceName}"`, `admin=${adminState}`],
                    {
                        windowsHide: true,
                        timeout: 10000,
                        maxBuffer: 1024 * 1024
                    }
                );
            }
        } catch (error) {
            const shellMessage = this.formatShellError(error, 'Unable to change Wi-Fi state.');
            throw new Error(winRtDeniedReason ? `${winRtDeniedReason} ${shellMessage}` : shellMessage);
        }

        this.statusRequestPromise = null;
        this.lastResolvedStatus = null;
        await this.delay(900);
        const refreshedStatus = await this.getFullNetworkStatus();

        if (Boolean(refreshedStatus.wifiEnabled) !== Boolean(enabled)) {
            const fallbackMessage = 'Windows did not apply the Wi-Fi change. The simulator may need administrator privileges.';
            throw new Error(winRtDeniedReason ? `${winRtDeniedReason} ${fallbackMessage}` : fallbackMessage);
        }

        return refreshedStatus;
    }

    async setWifiEnabled(enabled) {
        if (process.platform !== 'win32') {
            throw new Error('Wi-Fi radio toggling is only implemented on Windows hosts.');
        }

        return this.setWindowsWifiEnabled(enabled);
    }

    /**
     * Get current network status
     * Returns a promise that resolves to network information
     */
    async getNetworkStatus() {
        if (process.platform === 'win32') {
            try {
                const windowsStatus = await this.getWindowsNetworkStatus();
                if (windowsStatus.connected) {
                    return windowsStatus;
                }

                const fallbackStatus = await this.getLegacyNetworkStatus();
                if (fallbackStatus.connected) {
                    return fallbackStatus;
                }

                return windowsStatus;
            } catch (error) {
                const fallbackStatus = await this.getLegacyNetworkStatus().catch(() => null);
                if (fallbackStatus?.connected) {
                    return fallbackStatus;
                }

                throw error;
            }
        }

        return this.getLegacyNetworkStatus();
    }

    getLegacyNetworkStatus() {
        return new Promise((resolve) => {
            network.get_active_interface((err, activeInterface) => {
                if (err || !activeInterface) {
                    // No active network interface
                    resolve(this.createDisconnectedStatus());
                    return;
                }

                // Determine if it's wired or wireless
                const interfaceName = activeInterface.name.toLowerCase();
                let type = 'unknown';

                // Common interface name patterns
                if (interfaceName.includes('wi-fi') ||
                    interfaceName.includes('wifi') ||
                    interfaceName.includes('wlan') ||
                    interfaceName.includes('airport') ||
                    (interfaceName.includes('en0') && activeInterface.type === 'Wireless')) {
                    type = 'wifi';
                } else if (interfaceName.includes('ethernet') ||
                           interfaceName.includes('eth') ||
                           interfaceName.includes('en') ||
                           interfaceName.includes('lan')) {
                    type = 'ethernet';
                }

                // Return the network status
                resolve({
                    connected: true,
                    type: type,
                    name: activeInterface.name,
                    ip_address: activeInterface.ip_address,
                    mac_address: activeInterface.mac_address,
                    gateway_ip: activeInterface.gateway_ip,
                    netmask: activeInterface.netmask
                });
            });
        });
    }

    async queryFullNetworkStatus() {
        if (process.platform === 'win32') {
            const [status, wifiRadioState] = await Promise.all([
                this.getNetworkStatus(),
                this.getWindowsWifiRadioState().catch(() => ({
                    available: false,
                    enabled: false,
                    interfaceNames: []
                }))
            ]);
            let wifiDetails = null;

            if (wifiRadioState.enabled && (!status.connected || status.type === 'wifi' || status.type === 'unknown')) {
                wifiDetails = await this.getWiFiDetails().catch(() => null);
            }

            const resolvedStatus = this.mergeWindowsWifiStatus(status, wifiDetails);
            const statusWithWifiRadio = {
                ...resolvedStatus,
                wifiAvailable: Boolean(wifiRadioState.available),
                wifiEnabled: Boolean(wifiRadioState.enabled)
            };
            let signalBars = resolvedStatus.type === 'wifi' ? 5 : 0;

            if (!statusWithWifiRadio.connected) {
                return this.createDisconnectedStatus({
                    ...statusWithWifiRadio
                });
            }

            if (resolvedStatus.type === 'wifi' && wifiDetails) {
                if (wifiDetails.signal_level !== null && wifiDetails.signal_level !== undefined) {
                    signalBars = this.calculateSignalBars(wifiDetails.signal_level);
                } else if (wifiDetails.quality !== null && wifiDetails.quality !== undefined) {
                    signalBars = this.calculateSignalBarsFromQuality(wifiDetails.quality);
                }
            }

            return {
                ...statusWithWifiRadio,
                wifiDetails: resolvedStatus.type === 'wifi' ? wifiDetails : null,
                signalBars
            };
        }

        const status = await this.getNetworkStatus();

        if (!status.connected) {
            return this.createDisconnectedStatus({
                ...status
            });
        }

        // Check internet and gateway access in parallel
        const [hasInternet, hasGateway] = await Promise.all([
            this.hasInternetAccess().catch(() => false),
            this.getGatewayAccess().catch(() => false)
        ]);

        // If connected via WiFi, get signal strength
        let wifiDetails = null;
        let signalBars = 5; // Default for non-WiFi or unknown

        if (status.type === 'wifi') {
            wifiDetails = await this.getWiFiDetails().catch(() => null);

            if (wifiDetails) {
                // Prefer signal_level (dBm) over quality (%) for accuracy
                if (wifiDetails.signal_level !== null && wifiDetails.signal_level !== undefined) {
                    signalBars = this.calculateSignalBars(wifiDetails.signal_level);
                } else if (wifiDetails.quality !== null && wifiDetails.quality !== undefined) {
                    signalBars = this.calculateSignalBarsFromQuality(wifiDetails.quality);
                }
            }
        }

        return {
            ...status,
            hasInternet,
            hasGateway,
            wifiDetails,
            wifiAvailable: status.type === 'wifi',
            wifiEnabled: status.type === 'wifi',
            signalBars
        };
    }

    /**
     * Get WiFi connection details including signal strength
     */
    async getWiFiDetails() {
        if (process.platform === 'win32') {
            return this.getWindowsWiFiDetails();
        }

        if (!this.wifiInitialized) {
            return null;
        }

        return new Promise((resolve) => {
            wifi.getCurrentConnections((error, currentConnections) => {
                if (error || !currentConnections || currentConnections.length === 0) {
                    resolve(null);
                    return;
                }

                // Get the first (current) connection
                const connection = currentConnections[0];

                resolve({
                    ssid: connection.ssid,
                    bssid: connection.bssid,
                    mac: connection.mac,
                    channel: connection.channel,
                    frequency: connection.frequency,
                    signal_level: connection.signal_level, // Signal strength in dB (e.g., -50)
                    quality: connection.quality, // Signal quality percentage (0-100)
                    security: connection.security,
                    security_flags: connection.security_flags,
                    mode: connection.mode
                });
            });
        });
    }

    /**
     * Calculate WiFi signal strength in bars (0-5) from RSSI
     * Based on typical WiFi signal strength ranges
     */
    calculateSignalBars(signalLevel) {
        if (signalLevel === null || signalLevel === undefined) {
            return 5; // Default to full bars if unknown
        }

        // Signal level is in dBm (negative values)
        // Typical ranges:
        // -30 dBm: Amazing signal (5 bars)
        // -50 dBm: Excellent signal (5 bars)
        // -60 dBm: Good signal (4 bars)
        // -67 dBm: Reliable signal (3 bars)
        // -70 dBm: Not great (2 bars)
        // -80 dBm: Weak signal (1 bar)
        // -90 dBm: Very weak (0 bars)

        if (signalLevel >= -50) {
            return 5; // Excellent
        } else if (signalLevel >= -60) {
            return 4; // Very Good
        } else if (signalLevel >= -67) {
            return 3; // Good
        } else if (signalLevel >= -70) {
            return 2; // Fair
        } else if (signalLevel >= -80) {
            return 1; // Weak
        } else {
            return 0; // Very Weak
        }
    }

    /**
     * Alternative: Calculate signal bars from quality percentage
     */
    calculateSignalBarsFromQuality(quality) {
        if (quality === null || quality === undefined) {
            return 5;
        }

        // Quality is 0-100%
        if (quality >= 80) {
            return 5;
        } else if (quality >= 60) {
            return 4;
        } else if (quality >= 40) {
            return 3;
        } else if (quality >= 20) {
            return 2;
        } else if (quality > 0) {
            return 1;
        } else {
            return 0;
        }
    }

    /**
     * Check if we have actual internet connectivity
     * Tests by trying to reach a public DNS server
     */
    async hasInternetAccess() {
        return new Promise((resolve) => {
            network.get_public_ip((err, ip) => {
                // If we can get a public IP, we have internet
                resolve(!err && ip);
            });
        });
    }

    /**
     * Get gateway info to check local network connectivity
     */
    async getGatewayAccess() {
        return new Promise((resolve) => {
            network.get_gateway_ip((err, gateway) => {
                resolve(!err && gateway);
            });
        });
    }

    /**
     * Get comprehensive network status including internet connectivity and WiFi details
     */
    async getFullNetworkStatus() {
        if (this.statusRequestPromise) {
            return this.statusRequestPromise;
        }

        const requestPromise = (async () => {
            try {
                const status = await this.queryFullNetworkStatus();
                this.rememberResolvedStatus(status);
                return this.cloneStatus(status);
            } catch (error) {
                if (this.isTransientStatusError(error)) {
                    const cachedStatus = this.getCachedStatus();
                    if (cachedStatus) {
                        console.warn('Using cached network status after transient query failure:', this.formatStatusError(error));
                        return cachedStatus;
                    }

                    console.warn('Transient network status query failure without cached status:', this.formatStatusError(error));
                    return this.createDisconnectedStatus();
                }

                console.error('Failed to resolve network status:', this.formatStatusError(error));
                return this.getCachedStatus() || this.createDisconnectedStatus();
            } finally {
                if (this.statusRequestPromise === requestPromise) {
                    this.statusRequestPromise = null;
                }
            }
        })();

        this.statusRequestPromise = requestPromise;
        return requestPromise;
    }

    /**
     * Start monitoring network changes
     * Calls the callback whenever network status changes
     */
    startMonitoring(callback, intervalMs = 5000) {
        // Stop any existing monitoring
        this.stopMonitoring();
        this.monitoringActive = true;
        this.runMonitoringCycle(callback, intervalMs);
    }

    /**
     * Stop monitoring network changes
     */
    stopMonitoring() {
        this.monitoringActive = false;
        if (this.updateInterval) {
            clearTimeout(this.updateInterval);
            this.updateInterval = null;
        }
    }

    scheduleNextMonitoringCycle(callback, intervalMs) {
        if (!this.monitoringActive) {
            return;
        }

        this.updateInterval = setTimeout(() => {
            this.runMonitoringCycle(callback, intervalMs);
        }, intervalMs);
    }

    async runMonitoringCycle(callback, intervalMs) {
        if (!this.monitoringActive) {
            return;
        }

        try {
            let status = await this.getFullNetworkStatus();

            if (await this.shouldConfirmOfflineTransition(status)) {
                const confirmedStatus = await this.confirmOfflineTransition();
                if (!confirmedStatus) {
                    return;
                }

                status = confirmedStatus;
            }

            if (this.hasStatusChanged(status)) {
                this.lastStatus = status;
                callback(status);
            }
        } finally {
            this.scheduleNextMonitoringCycle(callback, intervalMs);
        }
    }

    async shouldConfirmOfflineTransition(status) {
        if (!this.lastStatus?.connected) {
            return false;
        }

        if (status?.connected) {
            return false;
        }

        return true;
    }

    async confirmOfflineTransition() {
        await this.delay(750);

        const confirmedStatus = await this.getFullNetworkStatus().catch(() => null);
        if (!confirmedStatus?.connected) {
            return confirmedStatus;
        }

        return null;
    }

    /**
     * Check if network status has meaningfully changed
     */
    hasStatusChanged(newStatus) {
        if (!this.lastStatus) {
            return true;
        }

        // Check basic connectivity changes
        const basicChanged =
            this.lastStatus.connected !== newStatus.connected ||
            this.lastStatus.type !== newStatus.type ||
            this.lastStatus.hasInternet !== newStatus.hasInternet ||
            this.lastStatus.hasGateway !== newStatus.hasGateway ||
            this.lastStatus.ip_address !== newStatus.ip_address ||
            this.lastStatus.wifiAvailable !== newStatus.wifiAvailable ||
            this.lastStatus.wifiEnabled !== newStatus.wifiEnabled;

        if (basicChanged) {
            return true;
        }

        // Check WiFi-specific changes
        if (newStatus.type === 'wifi') {
            // Signal bars changed
            if (this.lastStatus.signalBars !== newStatus.signalBars) {
                return true;
            }

            // WiFi network changed
            if (this.lastStatus.wifiDetails?.ssid !== newStatus.wifiDetails?.ssid) {
                return true;
            }
        }

        return false;
    }

    /**
     * Scan for available Wi-Fi networks using netsh on Windows
     * Returns an array of { ssid, signalBars, security, connected }
     */
    async scanAvailableNetworks() {
        if (process.platform !== 'win32') {
            return [];
        }

        try {
            const wifiRadioState = await this.getWindowsWifiRadioState();
            if (!wifiRadioState.enabled) {
                return [];
            }

            const { stdout } = await execFilePromise(
                'netsh',
                ['wlan', 'show', 'networks', 'mode=Bssid'],
                {
                    windowsHide: true,
                    timeout: 10000,
                    maxBuffer: 1024 * 1024
                }
            );

            if (!stdout) {
                return [];
            }

            const networks = [];
            const seen = new Set();
            const blocks = stdout.split(/^(?=SSID \d+)/m);

            for (const block of blocks) {
                const ssidMatch = block.match(/^SSID \d+\s*:\s*(.*)$/m);
                if (!ssidMatch) continue;

                const ssid = ssidMatch[1].trim();
                if (!ssid || seen.has(ssid)) continue;
                seen.add(ssid);

                const authMatch = block.match(/Authentication\s*:\s*(.*)$/m);
                const signalMatch = block.match(/Signal\s*:\s*(\d+)%/m);

                const quality = signalMatch ? parseInt(signalMatch[1], 10) : 0;
                const signalBars = this.calculateSignalBarsFromQuality(quality);
                const security = authMatch ? authMatch[1].trim() : 'Open';

                networks.push({
                    ssid,
                    signalBars,
                    quality,
                    security,
                    secured: security.toLowerCase() !== 'open'
                });
            }

            // Sort by signal strength descending
            networks.sort((a, b) => b.quality - a.quality);
            return networks;
        } catch (error) {
            console.error('Failed to scan Wi-Fi networks:', error);
            return [];
        }
    }
}

module.exports = new NetworkControl();
