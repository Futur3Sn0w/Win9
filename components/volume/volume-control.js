/**
 * Volume Control Module
 * Handles system volume get/set operations with platform detection
 */

const { exec, spawn } = require('child_process');
const readline = require('readline');
const { promisify } = require('util');
const execPromise = promisify(exec);

const platform = process.platform;

const WINDOWS_AUDIO_BRIDGE = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

[ComImport]
[Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
public class MMDeviceEnumeratorComObject {}

public enum EDataFlow
{
    eRender,
    eCapture,
    eAll,
    EDataFlow_enum_count
}

public enum ERole
{
    eConsole,
    eMultimedia,
    eCommunications,
    ERole_enum_count
}

[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDeviceEnumerator
{
    int NotImpl1();
    [PreserveSig]
    int GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, out IMMDevice endpoint);
    int NotImpl2();
    int NotImpl3();
    int NotImpl4();
    int NotImpl5();
}

[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDevice
{
    [PreserveSig]
    int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.Interface)] out IAudioEndpointVolume endpointVolume);
}

[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioEndpointVolume
{
    int RegisterControlChangeNotify(IntPtr notify);
    int UnregisterControlChangeNotify(IntPtr notify);
    int GetChannelCount(out uint channelCount);
    int SetMasterVolumeLevel(float levelDB, Guid eventContext);
    int SetMasterVolumeLevelScalar(float level, Guid eventContext);
    int GetMasterVolumeLevel(out float levelDB);
    int GetMasterVolumeLevelScalar(out float level);
    int SetChannelVolumeLevel(uint channelNumber, float levelDB, Guid eventContext);
    int SetChannelVolumeLevelScalar(uint channelNumber, float level, Guid eventContext);
    int GetChannelVolumeLevel(uint channelNumber, out float levelDB);
    int GetChannelVolumeLevelScalar(uint channelNumber, out float level);
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, Guid eventContext);
    int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
    int GetVolumeStepInfo(out uint step, out uint stepCount);
    int VolumeStepUp(Guid eventContext);
    int VolumeStepDown(Guid eventContext);
    int QueryHardwareSupport(out uint hardwareSupportMask);
    int GetVolumeRange(out float volumeMinDB, out float volumeMaxDB, out float volumeIncrementDB);
}

public static class AudioEndpointVolumeBridge
{
    private static IAudioEndpointVolume GetEndpointVolume()
    {
        var enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
        IMMDevice device;
        Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(EDataFlow.eRender, ERole.eMultimedia, out device));

        IAudioEndpointVolume endpointVolume;
        var endpointVolumeGuid = typeof(IAudioEndpointVolume).GUID;
        Marshal.ThrowExceptionForHR(device.Activate(ref endpointVolumeGuid, 23, IntPtr.Zero, out endpointVolume));
        return endpointVolume;
    }

    public static int GetVolume()
    {
        float level;
        Marshal.ThrowExceptionForHR(GetEndpointVolume().GetMasterVolumeLevelScalar(out level));
        return (int)Math.Round(level * 100.0f);
    }

    public static bool GetMute()
    {
        bool muted;
        Marshal.ThrowExceptionForHR(GetEndpointVolume().GetMute(out muted));
        return muted;
    }

    public static void SetVolume(float level)
    {
        var clamped = Math.Max(0.0f, Math.Min(1.0f, level));
        Marshal.ThrowExceptionForHR(GetEndpointVolume().SetMasterVolumeLevelScalar(clamped, Guid.Empty));
    }

    public static void SetMute(bool muted)
    {
        Marshal.ThrowExceptionForHR(GetEndpointVolume().SetMute(muted, Guid.Empty));
    }
}
"@

$resultMarker = '__WIN8_VOLUME_RESULT__'
[Console]::Out.WriteLine($resultMarker + 'ready')

while (($line = [Console]::In.ReadLine()) -ne $null) {
    if ([string]::IsNullOrWhiteSpace($line)) {
        continue
    }

    try {
        $request = $line | ConvertFrom-Json
        $result = $null

        switch ($request.action) {
            'getVolume' {
                $result = [AudioEndpointVolumeBridge]::GetVolume()
            }
            'setVolume' {
                [AudioEndpointVolumeBridge]::SetVolume(([float]$request.value) / 100.0)
                $result = $true
            }
            'getMuted' {
                $result = [AudioEndpointVolumeBridge]::GetMute()
            }
            'setMuted' {
                [AudioEndpointVolumeBridge]::SetMute([bool]$request.value)
                $result = $true
            }
            'getVolumeState' {
                $result = @{
                    volume = [AudioEndpointVolumeBridge]::GetVolume()
                    muted = [AudioEndpointVolumeBridge]::GetMute()
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

const WINDOWS_RESULT_MARKER = '__WIN8_VOLUME_RESULT__';
let windowsVolumeBridgePromise = null;
let windowsVolumeBridge = null;
let windowsVolumeRequestId = 0;

function resetWindowsVolumeBridge(error) {
    if (windowsVolumeBridge) {
        for (const pendingRequest of windowsVolumeBridge.pending.values()) {
            pendingRequest.reject(error);
        }
    }

    windowsVolumeBridge = null;
    windowsVolumeBridgePromise = null;
}

function getWindowsBridgeError(errorLines, fallbackMessage) {
    if (errorLines.length > 0) {
        return new Error(errorLines.join('\n'));
    }

    return new Error(fallbackMessage);
}

function ensureWindowsVolumeBridge() {
    if (windowsVolumeBridgePromise) {
        return windowsVolumeBridgePromise;
    }

    windowsVolumeBridgePromise = new Promise((resolve, reject) => {
        const child = spawn(
            'powershell.exe',
            ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '-'],
            { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }
        );

        const stdout = readline.createInterface({ input: child.stdout });
        const stderr = readline.createInterface({ input: child.stderr });
        const startupErrors = [];

        windowsVolumeBridge = {
            child,
            pending: new Map()
        };

        const failStartup = (error) => {
            stdout.close();
            stderr.close();
            resetWindowsVolumeBridge(error);
            reject(error);
        };

        stdout.on('line', (line) => {
            if (line === `${WINDOWS_RESULT_MARKER}ready`) {
                resolve(windowsVolumeBridge);
                return;
            }

            if (!line.startsWith(WINDOWS_RESULT_MARKER)) {
                return;
            }

            let message;
            try {
                message = JSON.parse(line.slice(WINDOWS_RESULT_MARKER.length));
            } catch (error) {
                failStartup(new Error(`Failed to parse Windows volume bridge response: ${error.message}`));
                return;
            }

            const pendingRequest = windowsVolumeBridge && windowsVolumeBridge.pending.get(message.id);
            if (!pendingRequest) {
                return;
            }

            windowsVolumeBridge.pending.delete(message.id);

            if (message.success) {
                pendingRequest.resolve(message.result);
            } else {
                pendingRequest.reject(new Error(message.error || 'Windows volume bridge request failed'));
            }
        });

        stderr.on('line', (line) => {
            if (line && !line.startsWith('#< CLIXML')) {
                startupErrors.push(line);
            }
        });

        child.on('error', (error) => {
            if (windowsVolumeBridgePromise) {
                failStartup(error);
            } else {
                resetWindowsVolumeBridge(error);
            }
        });

        child.on('exit', (code, signal) => {
            const error = getWindowsBridgeError(
                startupErrors,
                `Windows volume bridge exited unexpectedly (code ${code}, signal ${signal || 'none'})`
            );

            if (windowsVolumeBridgePromise) {
                failStartup(error);
            } else {
                resetWindowsVolumeBridge(error);
            }
        });

        child.stdin.write(`${WINDOWS_AUDIO_BRIDGE}\n`);
    });

    return windowsVolumeBridgePromise;
}

async function runWindowsVolumeRequest(action, value) {
    const bridge = await ensureWindowsVolumeBridge();

    return new Promise((resolve, reject) => {
        const id = ++windowsVolumeRequestId;
        bridge.pending.set(id, { resolve, reject });

        const request = JSON.stringify({ id, action, value });
        bridge.child.stdin.write(`${request}\n`, (error) => {
            if (!error) {
                return;
            }

            bridge.pending.delete(id);
            reject(error);
        });
    });
}

/**
 * Get current system volume (0-100)
 * @returns {Promise<number>}
 */
async function getVolume() {
    try {
        if (platform === 'darwin') {
            // macOS
            const { stdout } = await execPromise('osascript -e "output volume of (get volume settings)"');
            return parseInt(stdout.trim());
        } else if (platform === 'win32') {
            return await runWindowsVolumeRequest('getVolume');
        } else if (platform === 'linux') {
            // Linux - using amixer
            const { stdout } = await execPromise('amixer get Master | grep -o "[0-9]*%" | head -1 | tr -d "%"');
            return parseInt(stdout.trim());
        }
    } catch (error) {
        console.error('Error getting volume:', error);
        return 50; // Default fallback
    }
}

/**
 * Set system volume (0-100)
 * @param {number} volume - Volume level 0-100
 * @returns {Promise<boolean>}
 */
async function setVolume(volume) {
    try {
        // Clamp volume between 0 and 100
        const clampedVolume = Math.max(0, Math.min(100, Math.round(volume)));

        if (platform === 'darwin') {
            // macOS
            await execPromise(`osascript -e "set volume output volume ${clampedVolume}"`);
            return true;
        } else if (platform === 'win32') {
            await runWindowsVolumeRequest('setVolume', clampedVolume);
            return true;
        } else if (platform === 'linux') {
            // Linux - using amixer
            await execPromise(`amixer set Master ${clampedVolume}%`);
            return true;
        }
    } catch (error) {
        console.error('Error setting volume:', error);
        return false;
    }
}

/**
 * Get mute state
 * @returns {Promise<boolean>}
 */
async function getMuted() {
    try {
        if (platform === 'darwin') {
            // macOS
            const { stdout } = await execPromise('osascript -e "output muted of (get volume settings)"');
            return stdout.trim() === 'true';
        } else if (platform === 'win32') {
            return await runWindowsVolumeRequest('getMuted');
        } else if (platform === 'linux') {
            // Linux - using amixer
            const { stdout } = await execPromise('amixer get Master | grep -o "\\[on\\]\\|\\[off\\]" | head -1');
            return stdout.trim() === '[off]';
        }
    } catch (error) {
        console.error('Error getting mute state:', error);
        return false;
    }
}

/**
 * Set mute state
 * @param {boolean} muted - True to mute, false to unmute
 * @returns {Promise<boolean>}
 */
async function setMuted(muted) {
    try {
        if (platform === 'darwin') {
            // macOS
            await execPromise(`osascript -e "set volume output muted ${muted}"`);
            return true;
        } else if (platform === 'win32') {
            await runWindowsVolumeRequest('setMuted', muted);
            return true;
        } else if (platform === 'linux') {
            // Linux - using amixer
            const muteCommand = muted ? 'mute' : 'unmute';
            await execPromise(`amixer set Master ${muteCommand}`);
            return true;
        }
    } catch (error) {
        console.error('Error setting mute state:', error);
        return false;
    }
}

/**
 * Get both volume and mute state at once (more efficient)
 * @returns {Promise<{volume: number, muted: boolean}>}
 */
async function getVolumeState() {
    try {
        if (platform === 'darwin') {
            // macOS - get both in one call
            const { stdout } = await execPromise('osascript -e "get volume settings"');
            // Parse output like: "output volume:50, input volume:46, alert volume:100, output muted:false"
            const volumeMatch = stdout.match(/output volume:(\d+)/);
            const mutedMatch = stdout.match(/output muted:(true|false)/);

            return {
                volume: volumeMatch ? parseInt(volumeMatch[1]) : 50,
                muted: mutedMatch ? mutedMatch[1] === 'true' : false
            };
        } else if (platform === 'win32') {
            return await runWindowsVolumeRequest('getVolumeState');
        } else {
            // For other platforms, make separate calls
            const [volume, muted] = await Promise.all([getVolume(), getMuted()]);
            return { volume, muted };
        }
    } catch (error) {
        console.error('Error getting volume state:', error);
        return { volume: 50, muted: false };
    }
}

/**
 * Get the appropriate Metro icon class based on volume level and mute state
 * @param {number} volume - Volume level 0-100
 * @param {boolean} muted - Whether audio is muted
 * @returns {string} - Metro icon class name
 */
function getVolumeIcon(volume, muted) {
    if (muted) {
        return 'sui-volume-mute2'; // Muted state
    } else if (volume === 0) {
        return 'sui-volume-mute'; // Volume at 0
    } else if (volume <= 33) {
        return 'sui-volume-low';
    } else if (volume <= 66) {
        return 'sui-volume-medium';
    } else {
        return 'sui-volume-high';
    }
}

module.exports = {
    getVolume,
    setVolume,
    getMuted,
    setMuted,
    getVolumeState,
    getVolumeIcon
};
