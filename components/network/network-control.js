/**
 * Network Control - Main process module for network detection
 * Uses 'network' package for connection type detection
 * Uses 'node-wifi' package for WiFi signal strength
 */

const network = require('network');
const wifi = require('node-wifi');

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

    /**
     * Get current network status
     * Returns a promise that resolves to network information
     */
    async getNetworkStatus() {
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
