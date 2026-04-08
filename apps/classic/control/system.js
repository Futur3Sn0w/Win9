/**
 * System Page Controller
 * Displays system information gathered from host and simulated data
 */

(function () {
    // Get ipcRenderer from the window context or require it
    let ipcRenderer;
    try {
        // First try window context (if available)
        if (window.ipcRenderer) {
            ipcRenderer = window.ipcRenderer;
        } else if (typeof require === 'function') {
            // Fall back to require if available in Node integration
            ipcRenderer = require('electron').ipcRenderer;
        }
    } catch (error) {
        console.warn('Could not access ipcRenderer:', error);
    }

    /**
     * Format bytes into human-readable format
     */
    function formatBytes(bytes) {
        if (bytes >= 1073741824) {
            return (bytes / 1073741824).toFixed(2) + ' GB';
        } else if (bytes >= 1048576) {
            return (bytes / 1048576).toFixed(2) + ' MB';
        }
        return bytes + ' B';
    }

    /**
     * Load system information from host
     */
    async function loadSystemInfo() {
        try {
            if (!ipcRenderer) {
                console.warn('ipcRenderer not available, using placeholder data');
                loadPlaceholderData();
                return;
            }

            // Invoke IPC handler to get system hardware info
            const systemInfo = await ipcRenderer.invoke('system:get-hardware-info');
            
            if (systemInfo) {
                populateSystemInfo(systemInfo);
            } else {
                loadPlaceholderData();
            }
        } catch (error) {
            console.error('Error loading system information:', error);
            loadPlaceholderData();
        }
    }

    /**
     * Populate UI with system information
     */
    function populateSystemInfo(info) {
        // Windows Edition
        const windowsEdition = document.getElementById('windowsEdition');
        if (windowsEdition) {
            windowsEdition.textContent = info.windowsEdition || 'Windows 9';
        }

        // Manufacturer
        const manufacturer = document.getElementById('manufacturer');
        if (manufacturer) {
            manufacturer.textContent = info.manufacturer || 'Unknown';
        }

        // Model
        const model = document.getElementById('model');
        if (model) {
            model.textContent = info.model || 'Unknown';
        }

        // Processor
        const processor = document.getElementById('processor');
        if (processor && info.processor) {
            processor.textContent = info.processor.model + ' ' + info.processor.speed;
        }

        // Installed Memory (RAM)
        const installedMemory = document.getElementById('installedMemory');
        if (installedMemory && info.totalMemory) {
            installedMemory.textContent = formatBytes(info.totalMemory);
        }

        // System Type
        const systemType = document.getElementById('systemType');
        if (systemType) {
            systemType.textContent = info.systemType || 'Unknown';
        }

        // Pen and Touch
        const penAndTouch = document.getElementById('penAndTouch');
        if (penAndTouch) {
            penAndTouch.textContent = info.penAndTouch || 'Not available';
        }

        // Computer Name
        const computerName = document.getElementById('computerName');
        if (computerName) {
            computerName.textContent = info.computerName || 'Unknown';
        }

        // Full Computer Name
        const fullComputerName = document.getElementById('fullComputerName');
        if (fullComputerName) {
            fullComputerName.textContent = info.fullComputerName || 'Unknown';
        }

        // Computer Description
        const computerDescription = document.getElementById('computerDescription');
        if (computerDescription) {
            computerDescription.textContent = info.computerDescription || 'Not Available';
        }

        // Workgroup
        const workgroup = document.getElementById('workgroup');
        if (workgroup) {
            workgroup.textContent = info.workgroup || 'Not Available';
        }
    }

    /**
     * Load placeholder data when system info is not available
     */
    function loadPlaceholderData() {
        populateSystemInfo({
            windowsEdition: 'Windows 9',
            manufacturer: 'Microsoft',
            model: 'Microsoft Surface',
            processor: {
                model: 'NVIDIA(R) TEGRA(R) 3 Quad Core CPU',
                speed: '1.30 GHz'
            },
            totalMemory: 2147483648, // 2 GB
            systemType: '32-bit Operating System, ARM-based processor',
            penAndTouch: 'Full Windows Touch Support with 5 Touch Points',
            computerName: 'thomas-tab',
            fullComputerName: 'thomas-tab',
            computerDescription: 'Not Available',
            workgroup: 'Not Available'
        });
    }

    // Set up event listeners when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            loadSystemInfo();
        });
    } else {
        loadSystemInfo();
    }

    // Button event listeners
    const changeSettingsButton = document.getElementById('changeSettingsButton');
    if (changeSettingsButton) {
        changeSettingsButton.addEventListener('click', () => {
            console.log('Change computer name/domain settings clicked');
            // This would open a system properties dialog in real Windows
        });
    }

    const changeProductKeyButton = document.getElementById('changeProductKeyButton');
    if (changeProductKeyButton) {
        changeProductKeyButton.addEventListener('click', () => {
            console.log('Change product key clicked');
            // This would open a product key dialog in real Windows
        });
    }
})();
