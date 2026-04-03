const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const windowsRadioControl = require('../device_connectivity/windows-radio-control');

const execFilePromise = promisify(execFile);
const WINDOWS_ROOT = process.env.SystemRoot || 'C:\\Windows';
const PNPUTIL_CANDIDATES = [
    path.join(WINDOWS_ROOT, 'Sysnative', 'pnputil.exe'),
    path.join(WINDOWS_ROOT, 'System32', 'pnputil.exe'),
    'pnputil.exe'
];

class BluetoothControl {
    constructor() {
        this.enabled = true;
        this.devices = [
            {
                id: 'arc-touch-mouse',
                name: 'Arc Touch Mouse',
                type: 'mouse',
                connected: true,
                paired: true
            },
            {
                id: 'surface-headphones',
                name: 'Surface Headphones',
                type: 'audio',
                connected: true,
                paired: true
            },
            {
                id: 'wedge-mobile-keyboard',
                name: 'Wedge Mobile Keyboard',
                type: 'keyboard',
                connected: false,
                paired: true
            },
            {
                id: 'lumia-920',
                name: 'Lumia 920',
                type: 'phone',
                connected: false,
                paired: false
            },
            {
                id: 'beats-pill',
                name: 'Beats Pill',
                type: 'speaker',
                connected: false,
                paired: false
            }
        ];
    }

    async delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    async runPnPUtil(args, timeoutMs = 15000) {
        let lastError = null;

        for (const executablePath of PNPUTIL_CANDIDATES) {
            try {
                const { stdout } = await execFilePromise(
                    executablePath,
                    args,
                    {
                        windowsHide: true,
                        timeout: timeoutMs,
                        maxBuffer: 1024 * 1024
                    }
                );

                return (stdout || '').trim();
            } catch (error) {
                lastError = error;
                if (error?.code !== 'ENOENT') {
                    throw error;
                }
            }
        }

        throw lastError || new Error('Unable to locate pnputil.exe.');
    }

    formatCommandError(error, fallbackMessage) {
        const stdout = typeof error?.stdout === 'string' ? error.stdout.trim() : '';
        const stderr = typeof error?.stderr === 'string' ? error.stderr.trim() : '';
        const message = stdout || stderr || error?.message || fallbackMessage;

        if (/requires elevation|run as administrator|access is denied/i.test(message)) {
            return 'This action requires running the simulator as administrator.';
        }

        return message || fallbackMessage;
    }

    parsePnPUtilDevices(stdout) {
        if (!stdout) {
            return [];
        }

        const devices = [];
        let currentDevice = null;

        const commitDevice = () => {
            if (currentDevice && Object.keys(currentDevice).length > 0) {
                devices.push(currentDevice);
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

            if (key === 'instance id') {
                commitDevice();
                currentDevice = {};
            }

            if (!currentDevice) {
                currentDevice = {};
            }

            currentDevice[key] = value;
        }

        commitDevice();
        return devices;
    }

    slugifyDeviceId(value) {
        return String(value || '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'bluetooth-device';
    }

    inferBluetoothDeviceType(name = '') {
        const normalized = String(name).toLowerCase();

        if (/mouse|trackpad/.test(normalized)) {
            return 'mouse';
        }

        if (/keyboard/.test(normalized)) {
            return 'keyboard';
        }

        if (/phone|iphone|android|pixel|lumia|galaxy/.test(normalized)) {
            return 'phone';
        }

        if (/speaker|soundbar|homepod|pill|boombox/.test(normalized)) {
            return 'speaker';
        }

        if (/buds|headphones|headset|airpods|earbuds|pods/.test(normalized)) {
            return 'audio';
        }

        return 'bluetooth';
    }

    getHostBluetoothDeviceAddress(device) {
        const instanceId = String(device['instance id'] || '');
        const devMatch = instanceId.match(/\\Dev_([0-9A-F]+)\\/i);
        if (devMatch) {
            return devMatch[1].toUpperCase();
        }

        const enumMatch = instanceId.match(/&([0-9A-F]{12})(?:_|$)/i);
        if (enumMatch) {
            return enumMatch[1].toUpperCase();
        }

        return '';
    }

    isHostBluetoothEndpoint(device) {
        const instanceId = String(device['instance id'] || '');
        const description = String(device['device description'] || '');

        if (/^BTHENUM\\Dev_/i.test(instanceId) || /^BTHLE\\Dev_/i.test(instanceId)) {
            return Boolean(description.trim());
        }

        return false;
    }

    buildHostBluetoothDevices(devices) {
        const hostEntries = devices.filter((device) => this.isHostBluetoothEndpoint(device));
        const groupedByAddress = new Map();

        for (const device of hostEntries) {
            const address = this.getHostBluetoothDeviceAddress(device) || String(device['instance id'] || '');
            if (!groupedByAddress.has(address)) {
                groupedByAddress.set(address, []);
            }

            groupedByAddress.get(address).push(device);
        }

        return Array.from(groupedByAddress.values())
            .map((group) => {
                const preferredDevice = group
                    .slice()
                    .sort((left, right) => {
                        const leftClassic = /^BTHENUM\\Dev_/i.test(String(left['instance id'] || '')) ? 1 : 0;
                        const rightClassic = /^BTHENUM\\Dev_/i.test(String(right['instance id'] || '')) ? 1 : 0;
                        return rightClassic - leftClassic;
                    })[0];

                const name = String(preferredDevice['device description'] || 'Bluetooth device').trim();
                const connected = group.some((entry) => String(entry.status || '').trim().toLowerCase() === 'started');
                const address = this.getHostBluetoothDeviceAddress(preferredDevice);

                return {
                    id: this.slugifyDeviceId(address || name),
                    name,
                    type: this.inferBluetoothDeviceType(name),
                    connected,
                    paired: true,
                    statusText: connected ? 'Connected' : 'Paired',
                    hostBacked: true
                };
            })
            .sort((left, right) => {
                if (left.connected !== right.connected) {
                    return left.connected ? -1 : 1;
                }

                return left.name.localeCompare(right.name);
            });
    }

    isBluetoothHostCandidate(device) {
        const instanceId = String(device['instance id'] || '').toLowerCase();
        const manufacturer = String(device['manufacturer name'] || '').toLowerCase();
        const description = String(device['device description'] || '').toLowerCase();

        if (!instanceId) {
            return false;
        }

        if (manufacturer === 'microsoft') {
            return false;
        }

        if (
            instanceId.startsWith('bthenum\\') ||
            instanceId.startsWith('bthle') ||
            instanceId.startsWith('bth\\ms_') ||
            instanceId.startsWith('{') ||
            instanceId.includes('\\render&')
        ) {
            return false;
        }

        if (
            description.includes('generic attribute') ||
            description.includes('device information service') ||
            description.includes('service discovery') ||
            description.includes('enumerator')
        ) {
            return false;
        }

        return true;
    }

    isCandidateEnabled(device) {
        const status = String(device.status || '').trim().toLowerCase();
        return status === 'started' || status === 'ok' || status === 'disconnected';
    }

    async getWindowsBluetoothRadioState() {
        try {
            const radioResult = await windowsRadioControl.queryRadios();
            const bluetoothRadio = Array.isArray(radioResult?.radios)
                ? radioResult.radios.find((radio) => radio.kind === 'Bluetooth')
                : null;

            if (bluetoothRadio) {
                return {
                    available: true,
                    enabled: bluetoothRadio.state === 'On',
                    accessStatus: radioResult?.accessStatus || null,
                    hostDevices: []
                };
            }
        } catch (error) {
            console.error('Failed to query Bluetooth radio via WinRT:', error);
        }

        try {
            const stdout = await this.runPnPUtil(['/enum-devices', '/class', 'Bluetooth']);
            const devices = this.parsePnPUtilDevices(stdout);
            const hostDevices = devices.filter((device) => this.isBluetoothHostCandidate(device));

            return {
                available: hostDevices.length > 0,
                enabled: hostDevices.some((device) => this.isCandidateEnabled(device)),
                accessStatus: null,
                hostDevices: hostDevices.map((device) => ({
                    instanceId: device['instance id'] || '',
                    description: device['device description'] || 'Bluetooth adapter',
                    manufacturer: device['manufacturer name'] || '',
                    status: device.status || ''
                }))
            };
        } catch (error) {
            console.error('Failed to query Windows Bluetooth devices:', error);
            return {
                available: false,
                enabled: false,
                accessStatus: null,
                hostDevices: []
            };
        }
    }

    async getWindowsHostBluetoothDevices() {
        try {
            const stdout = await this.runPnPUtil(['/enum-devices', '/class', 'Bluetooth']);
            return this.buildHostBluetoothDevices(this.parsePnPUtilDevices(stdout));
        } catch (error) {
            console.error('Failed to query host Bluetooth devices:', error);
            return [];
        }
    }

    async setWindowsBluetoothEnabled(enabled) {
        try {
            const radioResult = await windowsRadioControl.setRadioState('Bluetooth', enabled);
            if (radioResult?.success && radioResult.setResult === 'Allowed') {
                await this.delay(900);
                this.enabled = Boolean(enabled);
                return this.getState();
            }

            if (radioResult?.setResult) {
                throw new Error(`WinRT radio access was ${radioResult.setResult}.`);
            }

            if (radioResult?.error) {
                throw new Error(radioResult.error);
            }
        } catch (error) {
            const winRtMessage = this.formatCommandError(error, 'Unable to change Bluetooth state.');

            if (/WinRT radio access was/i.test(winRtMessage) || /DeniedBy/i.test(winRtMessage)) {
                throw new Error(winRtMessage);
            }

            console.error('Bluetooth WinRT toggle failed, falling back to device control:', error);
        }

        const radioState = await this.getWindowsBluetoothRadioState();

        if (!radioState.available || !radioState.hostDevices.length) {
            throw new Error('No Bluetooth adapter was found on this system.');
        }

        const targetDevices = enabled
            ? radioState.hostDevices
            : radioState.hostDevices.filter((device) => this.isCandidateEnabled(device));

        if (targetDevices.length === 0) {
            this.enabled = Boolean(enabled);
            return this.getState();
        }

        const commandOutputs = [];

        try {
            for (const device of targetDevices) {
                const args = enabled
                    ? ['/enable-device', device.instanceId]
                    : ['/disable-device', device.instanceId];
                const stdout = await this.runPnPUtil(args, 20000);
                commandOutputs.push(stdout);
            }
        } catch (error) {
            throw new Error(this.formatCommandError(error, 'Unable to change Bluetooth state.'));
        }

        await this.delay(900);
        const refreshedRadioState = await this.getWindowsBluetoothRadioState();
        this.enabled = refreshedRadioState.enabled;

        if (Boolean(refreshedRadioState.enabled) !== Boolean(enabled)) {
            const combinedOutput = commandOutputs.filter(Boolean).join('\n').trim();
            if (/requires elevation|run as administrator|access is denied/i.test(combinedOutput)) {
                throw new Error('This action requires running the simulator as administrator.');
            }

            throw new Error('Windows did not apply the Bluetooth change. The adapter may require elevation or may not expose software radio control this way.');
        }

        return this.getState();
    }

    getDeviceById(deviceId) {
        const device = this.devices.find((entry) => entry.id === deviceId);
        if (!device) {
            throw new Error(`Bluetooth device not found: ${deviceId}`);
        }

        return device;
    }

    getStatusText(device) {
        if (device.connected) {
            return 'Connected';
        }

        if (device.paired) {
            return 'Paired';
        }

        return 'Ready to pair';
    }

    formatDevice(device) {
        return {
            id: device.id,
            name: device.name,
            type: device.type,
            connected: Boolean(device.connected),
            paired: Boolean(device.paired),
            hostBacked: Boolean(device.hostBacked),
            statusText: this.getStatusText(device)
        };
    }

    async getState() {
        if (process.platform === 'win32') {
            const radioState = await this.getWindowsBluetoothRadioState();
            const hostDevices = await this.getWindowsHostBluetoothDevices();
            this.enabled = radioState.enabled;

            if (!radioState.enabled) {
                return {
                    available: radioState.available,
                    enabled: false,
                    searching: false,
                    connectedDevices: [],
                    discoveredDevices: hostDevices.map((device) => this.formatDevice(device))
                };
            }

            const sourceDevices = hostDevices;

            const connectedDevices = sourceDevices
                .filter((device) => device.connected)
                .map((device) => this.formatDevice(device));

            const discoveredDevices = sourceDevices
                .filter((device) => !device.connected)
                .map((device) => this.formatDevice(device))
                .sort((left, right) => {
                    if (left.paired !== right.paired) {
                        return left.paired ? -1 : 1;
                    }

                    return left.name.localeCompare(right.name);
                });

            return {
                available: radioState.available,
                enabled: true,
                searching: true,
                connectedDevices,
                discoveredDevices
            };
        }

        if (!this.enabled) {
            return {
                available: true,
                enabled: false,
                searching: false,
                connectedDevices: [],
                discoveredDevices: []
            };
        }

        const connectedDevices = this.devices
            .filter((device) => device.connected)
            .map((device) => this.formatDevice(device));

        const discoveredDevices = this.devices
            .filter((device) => !device.connected)
            .map((device) => this.formatDevice(device))
            .sort((left, right) => {
                if (left.paired !== right.paired) {
                    return left.paired ? -1 : 1;
                }

                return left.name.localeCompare(right.name);
            });

        return {
            available: true,
            enabled: true,
            searching: true,
            connectedDevices,
            discoveredDevices
        };
    }

    async setEnabled(enabled) {
        if (process.platform === 'win32') {
            const state = await this.setWindowsBluetoothEnabled(enabled);
            if (!enabled) {
                this.devices.forEach((device) => {
                    device.connected = false;
                });
            }

            return state;
        }

        this.enabled = Boolean(enabled);

        if (!this.enabled) {
            this.devices.forEach((device) => {
                device.connected = false;
            });
        }

        return this.getState();
    }

    async connectDevice(deviceId) {
        if (!this.enabled) {
            throw new Error('Bluetooth is turned off.');
        }

        const device = this.getDeviceById(deviceId);
        device.connected = true;
        device.paired = true;
        return this.getState();
    }

    async disconnectDevice(deviceId) {
        const device = this.getDeviceById(deviceId);
        device.connected = false;
        device.paired = true;
        return this.getState();
    }

    async removeDevice(deviceId) {
        const device = this.getDeviceById(deviceId);
        device.connected = false;
        device.paired = false;
        return this.getState();
    }
}

module.exports = new BluetoothControl();
