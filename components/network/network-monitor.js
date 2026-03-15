/**
 * Network Monitor - Manages network status detection and icon updates
 * Uses the 'network' npm package via Electron IPC
 */

const { ipcRenderer } = require('electron');

class NetworkMonitor {
    constructor() {
        this.iconElement = null;
        this.containerElement = null;
        this.currentStatus = {
            connected: false,
            type: 'none',
            hasInternet: false,
            hasGateway: false
        };

        this.init();
    }

    init() {
        // Wait for DOM to be ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.setup());
        } else {
            this.setup();
        }
    }

    async setup() {
        // Get the network icon image element
        this.iconElement = document.getElementById('network-icon-img');
        if (!this.iconElement) {
            console.error('Network icon element not found');
            return;
        }

        // Get the network icon container for tooltip
        this.containerElement = document.getElementById('network-icon');
        if (!this.containerElement) {
            console.error('Network icon container element not found');
            return;
        }

        // Set up IPC listener for network status changes
        this.setupIPCListeners();

        // Get initial network status
        await this.updateNetworkStatus();

        // Start monitoring network changes
        await ipcRenderer.invoke('start-network-monitoring');
    }

    setupIPCListeners() {
        // Listen for network status changes from main process
        ipcRenderer.on('network-status-changed', (event, status) => {
            this.currentStatus = status;
            this.updateNetworkIcon();
        });
    }

    /**
     * Get current network status from main process
     */
    async updateNetworkStatus() {
        try {
            const result = await ipcRenderer.invoke('get-network-status');
            if (result.success) {
                this.currentStatus = result;
                this.updateNetworkIcon();
            }
        } catch (error) {
            console.error('Error getting network status:', error);
        }
    }

    /**
     * Determines the appropriate network icon based on current connection status
     */
    getNetworkIcon() {
        const { connected, type, hasInternet } = this.currentStatus;

        // If completely offline or no connection
        if (!connected || type === 'none') {
            return 'resources/images/tray/network/no_connection.png';
        }

        // For wired/ethernet connections
        if (type === 'ethernet') {
            return hasInternet
                ? 'resources/images/tray/network/wired.png'
                : 'resources/images/tray/network/wired_nointernet.png';
        }

        // For wireless connections
        if (type === 'wifi' || type === 'unknown') {
            // Get signal strength (0-5 bars)
            // For now using default 5 bars, will be improved with node-wifi integration
            const signalBars = this.getWirelessSignalBars();
            const suffix = hasInternet ? '' : '_nointernet';
            return `resources/images/tray/network/wireless_${signalBars}${suffix}.png`;
        }

        // Fallback to no connection
        return 'resources/images/tray/network/no_connection.png';
    }

    /**
     * Get wireless signal strength in bars (0-5)
     * Uses actual RSSI values from node-wifi when available
     */
    getWirelessSignalBars() {
        const { connected, signalBars } = this.currentStatus;

        // Use the signal bars calculated from actual RSSI in the main process
        if (!connected) return 0;

        // If signalBars is provided from main process (via node-wifi), use it
        if (typeof signalBars === 'number') {
            return signalBars;
        }

        // Fallback to full signal if data not available
        return 5;
    }

    /**
     * Updates the network icon image source
     */
    updateNetworkIcon() {
        if (!this.iconElement) {
            return;
        }

        const iconPath = this.getNetworkIcon();

        // Only update if the icon actually changed
        if (this.iconElement.src !== iconPath && !this.iconElement.src.endsWith(iconPath)) {
            this.iconElement.src = iconPath;

            // Log for debugging
            this.logNetworkStatus(iconPath);
        }

        // Update tooltip
        this.updateTooltip();
    }

    /**
     * Update the tooltip text for the network icon
     */
    updateTooltip() {
        if (!this.containerElement) {
            return;
        }

        const tooltip = this.getTooltipText();
        this.containerElement.setAttribute('title', tooltip);
    }

    /**
     * Generate tooltip text based on current network status
     */
    getTooltipText() {
        const { connected, type, hasInternet, wifiDetails, name } = this.currentStatus;

        if (!connected || type === 'none') {
            return 'No connection\nNot connected';
        }

        let line1 = '';
        let line2 = '';

        if (type === 'ethernet') {
            // Ethernet connection
            line1 = name || 'Ethernet';
            line2 = hasInternet ? 'Internet access' : 'No Internet access';
        } else if (type === 'wifi') {
            // WiFi connection - show SSID
            line1 = wifiDetails?.ssid || 'Wi-Fi';
            line2 = hasInternet ? 'Internet access' : 'No Internet access';
        } else {
            // Unknown connection type
            line1 = 'Network';
            line2 = hasInternet ? 'Internet access' : 'No Internet access';
        }

        return `${line1}\n${line2}`;
    }

    /**
     * Log network status for debugging
     */
    logNetworkStatus(iconPath) {
        const status = {
            connected: this.currentStatus.connected,
            type: this.currentStatus.type,
            hasInternet: this.currentStatus.hasInternet,
            hasGateway: this.currentStatus.hasGateway,
            icon: iconPath.split('/').pop(),
        };

        if (this.currentStatus.ip_address) {
            status.ip = this.currentStatus.ip_address;
        }

        // Add WiFi-specific details if available
        if (this.currentStatus.type === 'wifi') {
            status.signalBars = this.currentStatus.signalBars;

            if (this.currentStatus.wifiDetails) {
                status.ssid = this.currentStatus.wifiDetails.ssid;
                status.signal_level = this.currentStatus.wifiDetails.signal_level + ' dBm';
                status.quality = this.currentStatus.wifiDetails.quality + '%';
            }
        }

        console.log('Network status updated:', status);
    }

    /**
     * Get a human-readable description of the current network status
     * (Useful for tooltips or status displays)
     */
    getStatusDescription() {
        const { connected, type, hasInternet, hasGateway, name, wifiDetails } = this.currentStatus;

        if (!connected || type === 'none') {
            return 'No connection';
        }

        if (type === 'ethernet') {
            const status = hasInternet ? 'Connected' : hasGateway ? 'No Internet' : 'Limited';
            const interfaceName = name || 'Ethernet';
            return `${interfaceName} - ${status}`;
        }

        if (type === 'wifi' || type === 'unknown') {
            const bars = this.getWirelessSignalBars();
            const quality = ['No signal', 'Very weak', 'Weak', 'Fair', 'Good', 'Excellent'][bars];
            const networkName = wifiDetails?.ssid || 'Wi-Fi';
            const status = hasInternet ? '' : ' - No Internet';
            return `${networkName} - ${quality}${status}`;
        }

        return 'Connected';
    }

    /**
     * Cleanup when page unloads
     */
    async cleanup() {
        await ipcRenderer.invoke('stop-network-monitoring');
    }
}

// Initialize the network monitor when the script loads
const networkMonitor = new NetworkMonitor();

// Cleanup on window unload
window.addEventListener('beforeunload', () => {
    networkMonitor.cleanup();
});

// Export for potential use by other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = NetworkMonitor;
}
