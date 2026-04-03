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

class WindowsRadioControl {
    buildBootstrapLines() {
        return [
            "$ErrorActionPreference = 'Stop'",
            'Add-Type -AssemblyName System.Runtime.WindowsRuntime',
            '$null = [Windows.Devices.Radios.Radio, Windows.System.Devices, ContentType=WindowsRuntime]',
            "$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and $_.GetGenericArguments().Count -eq 1 -and $_.GetParameters().Count -eq 1 })[0]",
            '$radioListType = [System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]]',
            '$accessOp = [Windows.Devices.Radios.Radio]::RequestAccessAsync()',
            '$accessTask = $asTaskGeneric.MakeGenericMethod([Windows.Devices.Radios.RadioAccessStatus]).Invoke($null, @($accessOp))',
            '$accessTask.Wait(5000) | Out-Null',
            '$accessStatus = [string]$accessTask.Result'
        ];
    }

    async runPowerShell(script, timeoutMs = 12000) {
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

    async runPowerShellJson(script, timeoutMs = 12000) {
        const stdout = await this.runPowerShell(script, timeoutMs);
        if (!stdout) {
            return null;
        }

        return JSON.parse(stdout);
    }

    async queryRadios() {
        const script = [
            ...this.buildBootstrapLines(),
            '$radiosOp = [Windows.Devices.Radios.Radio]::GetRadiosAsync()',
            '$radiosTask = $asTaskGeneric.MakeGenericMethod($radioListType).Invoke($null, @($radiosOp))',
            '$radiosTask.Wait(5000) | Out-Null',
            '$radios = @($radiosTask.Result | ForEach-Object {',
            '  [pscustomobject]@{',
            '    name = [string]$_.Name',
            '    kind = [string]$_.Kind',
            '    state = [string]$_.State',
            '  }',
            '})',
            '$result = @{ success = $true; accessStatus = $accessStatus; radios = $radios }',
            '[Console]::Out.Write(($result | ConvertTo-Json -Compress -Depth 4))'
        ].join('\n');

        return this.runPowerShellJson(script, 15000);
    }

    async setRadioState(kind, enabled) {
        const targetState = enabled ? 'On' : 'Off';
        const escapedKind = String(kind || '').replace(/'/g, "''");

        const script = [
            ...this.buildBootstrapLines(),
            '$radiosOp = [Windows.Devices.Radios.Radio]::GetRadiosAsync()',
            '$radiosTask = $asTaskGeneric.MakeGenericMethod($radioListType).Invoke($null, @($radiosOp))',
            '$radiosTask.Wait(5000) | Out-Null',
            `$target = @($radiosTask.Result | Where-Object { [string]$_.Kind -eq '${escapedKind}' }) | Select-Object -First 1`,
            'if ($null -eq $target) {',
            "  [Console]::Out.Write((@{ success = $false; error = 'Radio not found.'; accessStatus = $accessStatus } | ConvertTo-Json -Compress))",
            '  exit 0',
            '}',
            `$setOp = $target.SetStateAsync([Windows.Devices.Radios.RadioState]::${targetState})`,
            '$setTask = $asTaskGeneric.MakeGenericMethod([Windows.Devices.Radios.RadioAccessStatus]).Invoke($null, @($setOp))',
            '$setTask.Wait(5000) | Out-Null',
            '$result = @{',
            '  success = $true',
            '  accessStatus = $accessStatus',
            '  setResult = [string]$setTask.Result',
            '  name = [string]$target.Name',
            '  kind = [string]$target.Kind',
            `  targetState = '${targetState}'`,
            '}',
            '[Console]::Out.Write(($result | ConvertTo-Json -Compress -Depth 4))'
        ].join('\n');

        return this.runPowerShellJson(script, 15000);
    }
}

module.exports = new WindowsRadioControl();
