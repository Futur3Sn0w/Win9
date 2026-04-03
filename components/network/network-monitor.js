/**
 * Network Monitor - Manages network status detection and icon updates
 * Uses the 'network' npm package via Electron IPC
 */

const { ipcRenderer } = require('electron');

const NETWORK_ICON_SIZES = [16, 24, 32];
const NETWORK_BASE_RENDER_SIZE = 16;

class NetworkMonitor {
    constructor() {
        this.iconElement = null;
        this.containerElement = null;
        this.baseRenderSize = NETWORK_BASE_RENDER_SIZE;
        this.displaySettingsState = null;
        this.statusUpdatePromise = null;
        this.pendingStatusRefresh = false;
        this.handleViewportChange = this.handleViewportChange.bind(this);
        this.handleDisplaySettingsChange = this.handleDisplaySettingsChange.bind(this);
        this.handleWindowFocus = this.handleWindowFocus.bind(this);
        this.handleVisibilityChange = this.handleVisibilityChange.bind(this);
        this.handleWifiToggleClick = this.handleWifiToggleClick.bind(this);
        this.currentStatus = {
            connected: false,
            type: 'none',
            hasInternet: false,
            hasGateway: false,
            wifiAvailable: false,
            wifiEnabled: false
        };
        this.cachedWifiNetworks = null;
        this.isTogglingWifi = false;
        this.pendingWifiEnabledState = null;

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

        this.baseRenderSize = this.measureIconRenderSize();

        // Set up IPC listener for network status changes
        this.setupIPCListeners();
        this.setupViewportListeners();
        this.setupFlyoutControls();

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

    setupViewportListeners() {
        window.addEventListener('resize', this.handleViewportChange);
        window.addEventListener('load', this.handleViewportChange, { once: true });
        window.addEventListener('focus', this.handleWindowFocus);
        document.addEventListener('visibilitychange', this.handleVisibilityChange);
        window.addEventListener('win8-display-settings-changed', this.handleDisplaySettingsChange);
    }

    setupFlyoutControls() {
        const wifiToggle = document.getElementById('wifi-toggle');
        if (wifiToggle && !wifiToggle.dataset.networkToggleBound) {
            wifiToggle.dataset.networkToggleBound = 'true';
            wifiToggle.addEventListener('click', this.handleWifiToggleClick);
        }

        const airplaneToggle = document.getElementById('airplane-mode-toggle');
        if (airplaneToggle) {
            airplaneToggle.disabled = true;
            airplaneToggle.setAttribute('aria-disabled', 'true');
        }

        this.updateFlyoutControls();
    }

    getWifiToggleElement() {
        return document.getElementById('wifi-toggle');
    }

    getWifiToggleLabelElement() {
        return document.getElementById('wifi-toggle-label');
    }

    getAirplaneToggleElement() {
        return document.getElementById('airplane-mode-toggle');
    }

    getAirplaneToggleLabelElement() {
        return document.getElementById('airplane-mode-label');
    }

    handleViewportChange() {
        this.updateNetworkIcon();
    }

    handleDisplaySettingsChange(event) {
        this.displaySettingsState = event?.detail?.state || null;
        this.updateNetworkIcon();
    }

    handleWindowFocus() {
        this.updateNetworkStatus();
    }

    handleVisibilityChange() {
        if (!document.hidden) {
            this.updateNetworkStatus();
        }
    }

    async handleWifiToggleClick(event) {
        event.preventDefault();
        event.stopPropagation();

        if (this.isTogglingWifi || !this.currentStatus.wifiAvailable) {
            return;
        }

        const nextEnabledState = !this.currentStatus.wifiEnabled;
        this.isTogglingWifi = true;
        this.pendingWifiEnabledState = nextEnabledState;
        this.updateFlyoutControls();

        try {
            const result = await ipcRenderer.invoke('set-wifi-enabled', nextEnabledState);
            if (!result || !result.success) {
                throw new Error(result?.error || 'Unable to change Wi-Fi state.');
            }

            this.currentStatus = result;
            if (!nextEnabledState) {
                this.cachedWifiNetworks = null;
            }

            this.updateNetworkIcon();
            await this.populateNetworkFlyout();
        } catch (error) {
            console.error('Error setting Wi-Fi enabled state:', error);
            this.updateFlyoutControls();
        } finally {
            this.isTogglingWifi = false;
            this.pendingWifiEnabledState = null;
            this.updateFlyoutControls();
        }
    }

    updateFlyoutControls() {
        const wifiToggle = this.getWifiToggleElement();
        const wifiLabel = this.getWifiToggleLabelElement();
        const airplaneToggle = this.getAirplaneToggleElement();
        const airplaneLabel = this.getAirplaneToggleLabelElement();

        const wifiAvailable = Boolean(this.currentStatus.wifiAvailable);
        const wifiEnabled = this.isTogglingWifi
            ? Boolean(this.pendingWifiEnabledState)
            : Boolean(this.currentStatus.wifiEnabled);

        if (wifiToggle) {
            wifiToggle.classList.toggle('is-on', wifiEnabled);
            wifiToggle.setAttribute('aria-pressed', wifiEnabled ? 'true' : 'false');
            wifiToggle.disabled = this.isTogglingWifi || !wifiAvailable;
        }

        if (wifiLabel) {
            if (!wifiAvailable) {
                wifiLabel.textContent = 'Unavailable';
            } else if (this.isTogglingWifi) {
                wifiLabel.textContent = wifiEnabled ? 'Turning on' : 'Turning off';
            } else {
                wifiLabel.textContent = wifiEnabled ? 'On' : 'Off';
            }
        }

        if (airplaneToggle) {
            airplaneToggle.classList.remove('is-on');
            airplaneToggle.setAttribute('aria-pressed', 'false');
            airplaneToggle.disabled = true;
        }

        if (airplaneLabel) {
            airplaneLabel.textContent = 'Off';
        }
    }

    /**
     * Get current network status from main process
     */
    async updateNetworkStatus() {
        if (this.statusUpdatePromise) {
            this.pendingStatusRefresh = true;
            return this.statusUpdatePromise;
        }

        this.statusUpdatePromise = (async () => {
            try {
                const result = await ipcRenderer.invoke('get-network-status');
                if (result.success) {
                    this.currentStatus = result;
                    this.updateNetworkIcon();
                }
            } catch (error) {
                console.error('Error getting network status:', error);
            } finally {
                this.statusUpdatePromise = null;

                if (this.pendingStatusRefresh) {
                    this.pendingStatusRefresh = false;
                    this.updateNetworkStatus();
                }
            }
        })();

        return this.statusUpdatePromise;
    }

    /**
     * Get the network icon state folder for the current connection status
     */
    getNetworkIconState() {
        const { connected, type, hasInternet } = this.currentStatus;

        // If completely offline or no connection
        if (!connected || type === 'none') {
            return 'no_connection';
        }

        // For wired/ethernet connections
        if (type === 'ethernet') {
            return hasInternet
                ? 'wired'
                : 'wired_nointernet';
        }

        // For wireless connections
        if (type === 'wifi' || type === 'unknown') {
            const signalBars = this.getWirelessSignalBars();
            const suffix = hasInternet ? '' : '_nointernet';
            return `wireless_${signalBars}${suffix}`;
        }

        // Fallback to no connection
        return 'no_connection';
    }

    measureIconRenderSize() {
        if (!this.iconElement) {
            return NETWORK_BASE_RENDER_SIZE;
        }

        const computedStyle = window.getComputedStyle(this.iconElement);
        const width = parseFloat(computedStyle.width) || 0;
        const height = parseFloat(computedStyle.height) || 0;

        return Math.max(width, height, NETWORK_BASE_RENDER_SIZE);
    }

    getBaseRenderSize() {
        return Math.max(this.baseRenderSize || 0, NETWORK_BASE_RENDER_SIZE);
    }

    getIconAssetScaleFactor() {
        if (typeof window.getTaskbarShellButtonAssetScaleFactor === 'function') {
            const scaleFactor = Number(window.getTaskbarShellButtonAssetScaleFactor());
            if (Number.isFinite(scaleFactor) && scaleFactor > 0) {
                return scaleFactor;
            }
        }

        const displayScale = Number(this.displaySettingsState?.display?.scaleFactor) || 0;
        const zoomScale = Number(this.displaySettingsState?.zoomFactor) || 0;
        if (displayScale > 0 && zoomScale > 0) {
            return Math.max(1, displayScale * zoomScale);
        }

        return Math.max(1, Number(window.devicePixelRatio) || 1);
    }

    selectIconSize(targetSize) {
        let bestSize = NETWORK_ICON_SIZES[0];
        let bestDistance = Math.abs(targetSize - bestSize);

        for (const size of NETWORK_ICON_SIZES) {
            const distance = Math.abs(targetSize - size);
            if (distance < bestDistance) {
                bestSize = size;
                bestDistance = distance;
                continue;
            }

            if (distance === bestDistance && size < bestSize) {
                bestSize = size;
            }
        }

        return bestSize;
    }

    /**
     * Determines the appropriate network icon path based on connection status and render scale
     */
    getNetworkIconSelection() {
        const iconState = this.getNetworkIconState();
        const scaleFactor = this.getIconAssetScaleFactor();
        const targetAssetSize = Math.max(1, Math.ceil(this.getBaseRenderSize() * scaleFactor));
        const iconSize = this.selectIconSize(targetAssetSize);

        return {
            path: `resources/images/tray/network/${iconState}/${iconSize}.png`,
            renderSize: this.getBaseRenderSize()
        };
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
     * Get the highest-quality icon path for a given icon state (always 32px)
     */
    getHighQualityIconPath(iconState) {
        return `resources/images/tray/network/${iconState || this.getNetworkIconState()}/32.png`;
    }

    /**
     * Updates the network icon image source
     */
    updateNetworkIcon() {
        if (!this.iconElement) {
            return;
        }

        const { path: iconPath, renderSize } = this.getNetworkIconSelection();

        this.iconElement.style.width = `${renderSize}px`;
        this.iconElement.style.height = `${renderSize}px`;

        // Only update if the icon actually changed
        if (this.iconElement.getAttribute('src') !== iconPath) {
            this.iconElement.setAttribute('src', iconPath);

            // Log for debugging
            this.logNetworkStatus(iconPath);
        }

        // Update tooltip
        this.updateTooltip();

        // Update TDBN and six-pack icons
        this.updateTdbnNetworkIcon();
        this.updateSixPackNetworkIcon();
        this.updateFlyoutControls();
    }

    /**
     * Update the network icon in the TDBN panel
     */
    updateTdbnNetworkIcon() {
        const tdbnIcon = document.getElementById('tdbn-network-icon');
        if (!tdbnIcon) return;

        const iconPath = this.getHighQualityIconPath();
        if (tdbnIcon.getAttribute('src') !== iconPath) {
            tdbnIcon.setAttribute('src', iconPath);
        }
    }

    /**
     * Update the network icon and label in the six-pack
     */
    updateSixPackNetworkIcon() {
        const sixPackIcon = document.getElementById('six-pack-network-icon');
        const sixPackLabel = document.getElementById('six-pack-network-label');

        if (sixPackIcon) {
            const iconPath = this.getHighQualityIconPath();
            if (sixPackIcon.getAttribute('src') !== iconPath) {
                sixPackIcon.setAttribute('src', iconPath);
            }
        }

        if (sixPackLabel) {
            sixPackLabel.textContent = this.getSixPackNetworkLabel();
        }
    }

    /**
     * Get the label for the six-pack network control
     */
    getSixPackNetworkLabel() {
        const { connected, type, wifiDetails, name } = this.currentStatus;

        if (!connected || type === 'none') {
            return 'Not connected';
        }

        if (type === 'ethernet') {
            return 'Wired';
        }

        if (type === 'wifi') {
            return wifiDetails?.ssid || 'Wi-Fi';
        }

        return name || 'Network';
    }

    /**
     * Populate the network flyout with current connections and available Wi-Fi networks
     */
    async populateNetworkFlyout() {
        this.updateFlyoutControls();
        this.populateConnections();
        await this.populateWifiList();
    }

    /**
     * Populate the connections section of the network flyout
     */
    populateConnections() {
        const container = document.getElementById('network-connections-list');
        if (!container) return;

        container.innerHTML = '';
        const { connected, type, wifiDetails, name, hasInternet } = this.currentStatus;

        if (!connected || type === 'none') {
            const item = document.createElement('div');
            item.className = 'network-connection-item';
            item.innerHTML = `
                <img class="network-connection-icon" src="${this.getHighQualityIconPath('no_connection')}" alt="">
                <div class="network-connection-info">
                    <div class="network-connection-name">Not connected</div>
                </div>
            `;
            container.appendChild(item);
            return;
        }

        const iconState = this.getNetworkIconState();
        const connectionName = type === 'ethernet'
            ? (name || 'Ethernet')
            : (wifiDetails?.ssid || name || 'Wi-Fi');
        const statusText = hasInternet ? 'Connected' : 'No Internet access';

        const item = document.createElement('div');
        item.className = 'network-connection-item';
        item.innerHTML = `
            <img class="network-connection-icon" src="${this.getHighQualityIconPath(iconState)}" alt="">
            <div class="network-connection-info">
                <div class="network-connection-name">${this.escapeHtml(connectionName)}</div>
                <div class="network-connection-status">${statusText}</div>
            </div>
        `;
        container.appendChild(item);
    }

    /**
     * Populate the Wi-Fi list with available networks
     */
    async populateWifiList() {
        const container = document.getElementById('network-wifi-list');
        if (!container) return;

        if (!this.currentStatus.wifiAvailable) {
            container.innerHTML = '<div class="network-wifi-loading">No Wi-Fi adapter available</div>';
            return;
        }

        if (!this.currentStatus.wifiEnabled) {
            container.innerHTML = '<div class="network-wifi-loading">Wi-Fi is turned off</div>';
            return;
        }

        container.innerHTML = '<div class="network-wifi-loading">Searching for networks...</div>';

        try {
            const result = await ipcRenderer.invoke('scan-wifi-networks');
            container.innerHTML = '';

            if (!result.success || !result.networks || result.networks.length === 0) {
                container.innerHTML = '<div class="network-wifi-loading">No networks found</div>';
                return;
            }

            // Cache results for next time
            this.cachedWifiNetworks = result.networks;

            this.renderWifiList(container, result.networks);
        } catch (error) {
            console.error('Error scanning Wi-Fi networks:', error);
            // Show cached results if available
            if (this.cachedWifiNetworks && this.cachedWifiNetworks.length > 0) {
                container.innerHTML = '';
                this.renderWifiList(container, this.cachedWifiNetworks);
            } else {
                container.innerHTML = '<div class="network-wifi-loading">Unable to scan networks</div>';
            }
        }
    }

    /**
     * Render a list of Wi-Fi networks into a container
     */
    renderWifiList(container, networks) {
        const currentSsid = this.currentStatus.wifiDetails?.ssid;

        for (const network of networks) {
            // Skip the currently connected network (it's shown in Connections)
            if (network.ssid === currentSsid) continue;

            const iconState = `wireless_${network.signalBars}`;
            const item = document.createElement('div');
            item.className = 'network-wifi-item';
            item.innerHTML = `
                <img class="network-wifi-icon" src="resources/images/tray/network/${iconState}/32.png" alt="">
                <span class="network-wifi-name">${this.escapeHtml(network.ssid)}</span>
            `;
            container.appendChild(item);
        }

        if (container.children.length === 0) {
            container.innerHTML = '<div class="network-wifi-loading">No other networks found</div>';
        }
    }

    /**
     * Escape HTML special characters
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
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
            wifiEnabled: this.currentStatus.wifiEnabled,
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
        window.removeEventListener('resize', this.handleViewportChange);
        window.removeEventListener('focus', this.handleWindowFocus);
        document.removeEventListener('visibilitychange', this.handleVisibilityChange);
        window.removeEventListener('win8-display-settings-changed', this.handleDisplaySettingsChange);
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
