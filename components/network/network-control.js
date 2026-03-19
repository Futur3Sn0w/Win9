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
            '$profiles = Get-NetConnectionProfile -ErrorAction Stop',
            '$profile = $profiles | Sort-Object @{ Expression = { if ($_.IPv4Connectivity -eq "Internet" -or $_.IPv6Connectivity -eq "Internet") { 0 } else { 1 } } }, InterfaceIndex | Select-Object -First 1',
            'if ($null -eq $profile) {',
            "  [Console]::Out.Write((@{ connected = $false } | ConvertTo-Json -Compress))",
            '  exit 0',
            '}',
            '$adapter = Get-NetAdapter -InterfaceIndex $profile.InterfaceIndex -ErrorAction SilentlyContinue',
            '$ip = Get-NetIPAddress -InterfaceIndex $profile.InterfaceIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -and $_.IPAddress -notlike "169.254*" } | Select-Object -First 1',
            '$route = Get-NetRoute -InterfaceIndex $profile.InterfaceIndex -DestinationPrefix "0.0.0.0/0" -ErrorAction SilentlyContinue | Sort-Object RouteMetric | Select-Object -First 1',
            '$result = @{',
            '  connected = $true',
            '  name = if ($adapter -and $adapter.Name) { $adapter.Name } else { $profile.InterfaceAlias }',
            '  interfaceDescription = if ($adapter) { $adapter.InterfaceDescription } else { $null }',
            '  mediaType = if ($adapter) { $adapter.MediaType } else { $null }',
            '  physicalMediaType = if ($adapter) { $adapter.PhysicalMediaType } else { $null }',
            '  adapterStatus = if ($adapter) { $adapter.Status } else { $null }',
            '  ip_address = if ($ip) { $ip.IPAddress } else { $null }',
            '  mac_address = if ($adapter -and $adapter.MacAddress) { $adapter.MacAddress } else { $null }',
            '  gateway_ip = if ($route -and $route.NextHop) { $route.NextHop } else { $null }',
            '  prefixLength = if ($ip) { $ip.PrefixLength } else { $null }',
            '  profileName = $profile.Name',
            '  interfaceAlias = $profile.InterfaceAlias',
            '  interfaceIndex = $profile.InterfaceIndex',
            '  networkCategory = [string]$profile.NetworkCategory',
            '  ipv4Connectivity = [string]$profile.IPv4Connectivity',
            '  ipv6Connectivity = [string]$profile.IPv6Connectivity',
            '  hasInternet = ($profile.IPv4Connectivity -eq "Internet" -or $profile.IPv6Connectivity -eq "Internet")',
            '  hasGateway = ($null -ne $route -and [string]::IsNullOrWhiteSpace($route.NextHop) -eq $false)',
            '}',
            '[Console]::Out.Write(($result | ConvertTo-Json -Compress))'
        ].join('\n');

        try {
            const status = await this.runWindowsPowerShellJson(script, 8000);

            if (!status || !status.connected) {
                return {
                    connected: false,
                    type: 'none',
                    name: null,
                    ip_address: null,
                    mac_address: null,
                    gateway_ip: null,
                    netmask: null,
                    hasInternet: false,
                    hasGateway: false
                };
            }

            return {
                connected: true,
                type: this.normalizeConnectionType(
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
        } catch (error) {
            console.error('Failed to query Windows network status:', error);
            return {
                connected: false,
                type: 'none',
                name: null,
                ip_address: null,
                mac_address: null,
                gateway_ip: null,
                netmask: null,
                hasInternet: false,
                hasGateway: false
            };
        }
    }

    /**
     * Get current network status
     * Returns a promise that resolves to network information
     */
    async getNetworkStatus() {
        if (process.platform === 'win32') {
            return this.getWindowsNetworkStatus();
        }

        return new Promise((resolve) => {
            network.get_active_interface((err, activeInterface) => {
                if (err || !activeInterface) {
                    // No active network interface
                    resolve({
                        connected: false,
                        type: 'none',
                        name: null,
                        ip_address: null,
                        mac_address: null,
                        gateway_ip: null
                    });
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
        const status = await this.getNetworkStatus();

        if (!status.connected) {
            return {
                ...status,
                hasInternet: false,
                hasGateway: false,
                wifiDetails: null,
                signalBars: 0
            };
        }

        if (process.platform === 'win32') {
            let wifiDetails = null;
            let signalBars = status.type === 'wifi' ? 5 : 0;

            if (status.type === 'wifi') {
                wifiDetails = await this.getWiFiDetails().catch(() => null);

                if (wifiDetails) {
                    if (wifiDetails.signal_level !== null && wifiDetails.signal_level !== undefined) {
                        signalBars = this.calculateSignalBars(wifiDetails.signal_level);
                    } else if (wifiDetails.quality !== null && wifiDetails.quality !== undefined) {
                        signalBars = this.calculateSignalBarsFromQuality(wifiDetails.quality);
                    }
                }
            }

            return {
                ...status,
                wifiDetails,
                signalBars
            };
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
            signalBars
        };
    }

    /**
     * Start monitoring network changes
     * Calls the callback whenever network status changes
     */
    startMonitoring(callback, intervalMs = 5000) {
        // Stop any existing monitoring
        this.stopMonitoring();

        // Initial check
        this.getFullNetworkStatus().then(status => {
            this.lastStatus = status;
            callback(status);
        });

        // Set up periodic checks
        this.updateInterval = setInterval(async () => {
            const status = await this.getFullNetworkStatus();

            // Only trigger callback if status changed
            if (this.hasStatusChanged(status)) {
                this.lastStatus = status;
                callback(status);
            }
        }, intervalMs);
    }

    /**
     * Stop monitoring network changes
     */
    stopMonitoring() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
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
            this.lastStatus.ip_address !== newStatus.ip_address;

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
}

module.exports = new NetworkControl();
