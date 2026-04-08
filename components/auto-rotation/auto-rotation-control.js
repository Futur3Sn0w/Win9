/**
 * Auto-Rotation Control Module
 * Reads and controls the Windows display auto-rotation lock via the registry.
 * Only meaningful on tablet/convertible devices where the AutoRotation registry
 * key exists. On desktops or unsupported devices, `supported` will be false.
 */

const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFilePromise = promisify(execFile);

const WINDOWS_POWERSHELL_PATH = path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
);

const AUTO_ROTATION_REG_PATH = 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\AutoRotation';

function createResult(overrides = {}) {
    return {
        supported: false,
        rotationLocked: false,
        rotation: 0,
        error: null,
        ...overrides
    };
}

async function runPowerShellJson(script, timeoutMs = 8000) {
    const { stdout } = await execFilePromise(
        WINDOWS_POWERSHELL_PATH,
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
        {
            windowsHide: true,
            timeout: timeoutMs,
            maxBuffer: 1024 * 1024
        }
    );

    const trimmed = (stdout || '').trim();
    if (!trimmed) {
        return null;
    }

    return JSON.parse(trimmed);
}

function getCurrentRotation() {
    try {
        const { screen } = require('electron');
        const display = screen.getPrimaryDisplay();
        return typeof display.rotation === 'number' ? display.rotation : 0;
    } catch (_error) {
        return 0;
    }
}

async function getState() {
    if (process.platform !== 'win32') {
        return createResult({
            error: 'Auto-rotation control is only supported on Windows.'
        });
    }

    try {
        const script = [
            "$ErrorActionPreference = 'Stop'",
            '$enable = $null',
            `try { $enable = (Get-ItemProperty -Path '${AUTO_ROTATION_REG_PATH}' -Name 'Enable' -ErrorAction Stop).Enable } catch {}`,
            '[Console]::Out.Write((@{ enable = $enable } | ConvertTo-Json -Compress))'
        ].join('\n');

        const result = await runPowerShellJson(script);
        const enableValue = result?.enable;

        if (enableValue === null || enableValue === undefined) {
            return createResult({
                supported: false,
                rotation: getCurrentRotation()
            });
        }

        return createResult({
            supported: true,
            rotationLocked: enableValue === 0,
            rotation: getCurrentRotation()
        });
    } catch (error) {
        console.error('Auto-rotation Control: Error getting state:', error);
        return createResult({
            error: error.message || 'Failed to query auto-rotation state.'
        });
    }
}

async function setRotationLock(locked) {
    if (process.platform !== 'win32') {
        return createResult({
            error: 'Auto-rotation control is only supported on Windows.'
        });
    }

    const enableValue = locked ? 0 : 1;

    try {
        const script = [
            "$ErrorActionPreference = 'Stop'",
            `$regPath = '${AUTO_ROTATION_REG_PATH}'`,
            'if (-not (Test-Path $regPath)) { New-Item -Path $regPath -Force | Out-Null }',
            `Set-ItemProperty -Path $regPath -Name 'Enable' -Value ${enableValue} -Type DWord`,
            'Add-Type -MemberDefinition \'[DllImport("user32.dll")] public static extern bool SendNotifyMessage(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam);\' -Name \'Win9AutoRotationMsg\' -Namespace \'Win9\' -ErrorAction SilentlyContinue',
            '[Win9.Win9AutoRotationMsg]::SendNotifyMessage([IntPtr]0xffff, 0x001A, [UIntPtr]::Zero, \'AutoRotation\') | Out-Null',
            '[Console]::Out.Write((@{ success = $true } | ConvertTo-Json -Compress))'
        ].join('\n');

        await runPowerShellJson(script, 12000);

        return createResult({
            supported: true,
            rotationLocked: locked,
            rotation: getCurrentRotation()
        });
    } catch (error) {
        console.error('Auto-rotation Control: Error setting rotation lock:', error);
        return createResult({
            error: error.message || 'Failed to set auto-rotation lock.'
        });
    }
}

module.exports = {
    getState,
    setRotationLock
};
