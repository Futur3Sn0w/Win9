/**
 * Brightness Control Module
 * Handles internal display brightness retrieval and updates on Windows via WMI.
 */

const path = require('path');
const { spawn } = require('child_process');
const readline = require('readline');

const DEFAULT_BRIGHTNESS = 100;
const WINDOWS_POWERSHELL_PATH = path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
);
const WINDOWS_RESULT_MARKER = '__WIN8_BRIGHTNESS_RESULT__';
const WINDOWS_BRIGHTNESS_BRIDGE_STARTUP_TIMEOUT_MS = 2000;
const WINDOWS_BRIGHTNESS_REQUEST_TIMEOUT_MS = 2000;

const WINDOWS_BRIGHTNESS_BRIDGE = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Get-ActiveBrightnessMonitor {
    return @(Get-WmiObject -Namespace root\\WMI -Class WmiMonitorBrightness -ErrorAction Stop | Where-Object { $_.Active }) | Select-Object -First 1
}

function Get-BrightnessMethod {
    return @(Get-WmiObject -Namespace root\\WMI -Class WmiMonitorBrightnessMethods -ErrorAction Stop) | Select-Object -First 1
}

function New-BrightnessPayload {
    param(
        [bool]$Success,
        [bool]$Supported,
        [int]$Brightness,
        [string]$Error
    )

    return @{
        success = $Success
        supported = $Supported
        brightness = $Brightness
        error = $Error
    }
}

$resultMarker = '${WINDOWS_RESULT_MARKER}'
[Console]::Out.WriteLine($resultMarker + 'ready')

while (($line = [Console]::In.ReadLine()) -ne $null) {
    if ([string]::IsNullOrWhiteSpace($line)) {
        continue
    }

    $request = $null

    try {
        $request = $line | ConvertFrom-Json
        $result = $null

        switch ($request.action) {
            'getBrightness' {
                $monitor = Get-ActiveBrightnessMonitor
                if ($null -eq $monitor) {
                    $result = New-BrightnessPayload -Success $false -Supported $false -Brightness 100 -Error 'No active brightness-capable internal display was found.'
                } else {
                    $result = New-BrightnessPayload -Success $true -Supported $true -Brightness ([int]$monitor.CurrentBrightness) -Error $null
                }
            }
            'setBrightness' {
                $targetBrightness = [Math]::Max(0, [Math]::Min(100, [int]$request.value))
                $monitor = Get-ActiveBrightnessMonitor
                if ($null -eq $monitor) {
                    $result = New-BrightnessPayload -Success $false -Supported $false -Brightness 100 -Error 'No active brightness-capable internal display was found.'
                } else {
                    $methods = Get-BrightnessMethod
                    if ($null -eq $methods) {
                        $result = New-BrightnessPayload -Success $false -Supported $false -Brightness ([int]$monitor.CurrentBrightness) -Error 'Brightness control methods are unavailable for the active display.'
                    } else {
                        $setResult = $methods.WmiSetBrightness(0, [byte]$targetBrightness)
                        $updatedMonitor = Get-ActiveBrightnessMonitor
                        $resolvedBrightness = if ($null -ne $updatedMonitor) { [int]$updatedMonitor.CurrentBrightness } else { $targetBrightness }
                        $returnValue = if ($null -ne $setResult -and $null -ne $setResult.ReturnValue) { [int]$setResult.ReturnValue } else { 0 }
                        $errorMessage = if ($returnValue -eq 0) { $null } else { 'WmiSetBrightness returned code ' + $returnValue + '.' }
                        $result = New-BrightnessPayload -Success ($returnValue -eq 0) -Supported $true -Brightness $resolvedBrightness -Error $errorMessage
                    }
                }
            }
            default {
                throw "Unknown action: $($request.action)"
            }
        }

        $payload = @{
            id = $request.id
            success = $true
            result = $result
        } | ConvertTo-Json -Compress
    } catch {
        $payload = @{
            id = if ($request) { $request.id } else { -1 }
            success = $false
            error = $_.Exception.Message
        } | ConvertTo-Json -Compress
    }

    [Console]::Out.WriteLine($resultMarker + $payload)
}
`;

let windowsBrightnessBridgePromise = null;
let windowsBrightnessBridge = null;
let windowsBrightnessRequestId = 0;
let brightnessPrewarmPromise = null;

function clampBrightness(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
        return DEFAULT_BRIGHTNESS;
    }

    return Math.max(0, Math.min(100, Math.round(numericValue)));
}

function createResult(overrides = {}) {
    return {
        success: false,
        supported: false,
        brightness: DEFAULT_BRIGHTNESS,
        error: null,
        ...overrides
    };
}

function normalizeResult(result, fallbackBrightness = DEFAULT_BRIGHTNESS) {
    return createResult({
        success: !!result?.success,
        supported: !!result?.supported,
        brightness: clampBrightness(
            typeof result?.brightness === 'number' ? result.brightness : fallbackBrightness
        ),
        error: result?.error || null
    });
}

function resetWindowsBrightnessBridge(error) {
    const bridge = windowsBrightnessBridge;
    if (bridge) {
        for (const pendingRequest of bridge.pending.values()) {
            pendingRequest.reject(error);
        }

        bridge.pending.clear();

        if (bridge.child && !bridge.child.killed) {
            try {
                bridge.child.kill();
            } catch (killError) {
                console.warn('Brightness Control: Failed to terminate Windows brightness bridge:', killError);
            }
        }
    }

    windowsBrightnessBridge = null;
    windowsBrightnessBridgePromise = null;
}

function getWindowsBridgeError(errorLines, fallbackMessage) {
    if (errorLines.length > 0) {
        return new Error(errorLines.join('\n'));
    }

    return new Error(fallbackMessage);
}

function ensureWindowsBrightnessBridge() {
    if (windowsBrightnessBridgePromise) {
        return windowsBrightnessBridgePromise;
    }

    windowsBrightnessBridgePromise = new Promise((resolve, reject) => {
        const child = spawn(
            WINDOWS_POWERSHELL_PATH,
            ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '-'],
            { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }
        );

        const stdout = readline.createInterface({ input: child.stdout });
        const stderr = readline.createInterface({ input: child.stderr });
        const startupErrors = [];
        let startupSettled = false;
        const startupTimeout = setTimeout(() => {
            failStartup(new Error('Windows brightness bridge startup timed out.'));
        }, WINDOWS_BRIGHTNESS_BRIDGE_STARTUP_TIMEOUT_MS);

        windowsBrightnessBridge = {
            child,
            pending: new Map()
        };

        const failStartup = (error) => {
            if (startupSettled) {
                return;
            }

            startupSettled = true;
            clearTimeout(startupTimeout);
            stdout.close();
            stderr.close();
            resetWindowsBrightnessBridge(error);
            reject(error);
        };

        stdout.on('line', (line) => {
            if (line === `${WINDOWS_RESULT_MARKER}ready`) {
                if (startupSettled) {
                    return;
                }

                startupSettled = true;
                clearTimeout(startupTimeout);
                resolve(windowsBrightnessBridge);
                return;
            }

            if (!line.startsWith(WINDOWS_RESULT_MARKER)) {
                return;
            }

            let message;
            try {
                message = JSON.parse(line.slice(WINDOWS_RESULT_MARKER.length));
            } catch (error) {
                failStartup(new Error(`Failed to parse Windows brightness bridge response: ${error.message}`));
                return;
            }

            const pendingRequest = windowsBrightnessBridge && windowsBrightnessBridge.pending.get(message.id);
            if (!pendingRequest) {
                return;
            }

            windowsBrightnessBridge.pending.delete(message.id);

            if (message.success) {
                pendingRequest.resolve(message.result);
            } else {
                pendingRequest.reject(new Error(message.error || 'Windows brightness bridge request failed'));
            }
        });

        stderr.on('line', (line) => {
            if (line && !line.startsWith('#< CLIXML')) {
                startupErrors.push(line);
            }
        });

        child.on('error', (error) => {
            if (!startupSettled) {
                failStartup(error);
            } else {
                resetWindowsBrightnessBridge(error);
            }
        });

        child.on('exit', (code, signal) => {
            const error = getWindowsBridgeError(
                startupErrors,
                `Windows brightness bridge exited unexpectedly (code ${code}, signal ${signal || 'none'})`
            );

            if (!startupSettled) {
                failStartup(error);
            } else {
                resetWindowsBrightnessBridge(error);
            }
        });

        child.stdin.write(`${WINDOWS_BRIGHTNESS_BRIDGE}\n`);
    });

    return windowsBrightnessBridgePromise;
}

async function runWindowsBrightnessRequest(action, value) {
    const bridge = await ensureWindowsBrightnessBridge();

    return new Promise((resolve, reject) => {
        const id = ++windowsBrightnessRequestId;
        const timeoutId = setTimeout(() => {
            if (!bridge.pending.has(id)) {
                return;
            }

            bridge.pending.delete(id);
            const error = new Error('Windows brightness request timed out.');
            resetWindowsBrightnessBridge(error);
            reject(error);
        }, WINDOWS_BRIGHTNESS_REQUEST_TIMEOUT_MS);

        bridge.pending.set(id, {
            resolve(result) {
                clearTimeout(timeoutId);
                resolve(result);
            },
            reject(error) {
                clearTimeout(timeoutId);
                reject(error);
            }
        });

        const request = JSON.stringify({ id, action, value });
        bridge.child.stdin.write(`${request}\n`, (error) => {
            clearTimeout(timeoutId);
            if (!error) {
                return;
            }

            bridge.pending.delete(id);
            reject(error);
        });
    });
}

async function getBrightnessState() {
    if (process.platform !== 'win32') {
        return createResult({
            error: 'Brightness control is currently implemented for Windows internal displays only.'
        });
    }

    try {
        return normalizeResult(await runWindowsBrightnessRequest('getBrightness'));
    } catch (error) {
        console.error('Brightness Control: Error getting brightness state:', error);
        return createResult({
            error: error.message || 'Failed to query system brightness.'
        });
    }
}

async function setBrightness(level) {
    if (process.platform !== 'win32') {
        return createResult({
            brightness: clampBrightness(level),
            error: 'Brightness control is currently implemented for Windows internal displays only.'
        });
    }

    const clampedLevel = clampBrightness(level);

    try {
        return normalizeResult(
            await runWindowsBrightnessRequest('setBrightness', clampedLevel),
            clampedLevel
        );
    } catch (error) {
        console.error('Brightness Control: Error setting brightness:', error);
        return createResult({
            brightness: clampedLevel,
            error: error.message || 'Failed to set system brightness.'
        });
    }
}

async function prewarm() {
    if (process.platform !== 'win32') {
        return createResult({
            error: 'Brightness control is currently implemented for Windows internal displays only.'
        });
    }

    if (brightnessPrewarmPromise) {
        return brightnessPrewarmPromise;
    }

    brightnessPrewarmPromise = (async () => {
        await ensureWindowsBrightnessBridge();
        return getBrightnessState();
    })().catch((error) => {
        brightnessPrewarmPromise = null;
        throw error;
    });

    return brightnessPrewarmPromise;
}

module.exports = {
    DEFAULT_BRIGHTNESS,
    clampBrightness,
    prewarm,
    getBrightnessState,
    setBrightness
};
