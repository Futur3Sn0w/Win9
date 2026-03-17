const path = require('path');
const { execFile } = require('child_process');

let trashModule = null;

async function loadTrashModule() {
    if (!trashModule) {
        trashModule = await import('trash');
    }
    return trashModule.default;
}

class WindowsRecycleBinProvider {
    constructor() {
        const systemRoot = process.env.SystemRoot || 'C:\\Windows';
        this.powerShellPath = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    }

    getDefaultState() {
        return {
            platform: 'win32',
            available: true,
            path: null,
            empty: true,
            itemCount: 0
        };
    }

    async getState() {
        const script = [
            "$ErrorActionPreference = 'Stop'",
            '$shell = New-Object -ComObject Shell.Application',
            '$folder = $shell.Namespace(10)',
            '$count = 0',
            'if ($null -ne $folder) { $count = [int]$folder.Items().Count }',
            "[Console]::Out.Write((@{ available = ($null -ne $folder); empty = ($count -eq 0); itemCount = $count } | ConvertTo-Json -Compress))"
        ].join('; ');

        try {
            const result = await this.runPowerShellJson(script);
            return {
                ...this.getDefaultState(),
                available: Boolean(result.available),
                empty: Boolean(result.empty),
                itemCount: Number.isFinite(Number(result.itemCount)) ? Number(result.itemCount) : 0
            };
        } catch (error) {
            console.warn('RecycleBin: Failed to query Windows recycle bin state.', error);
            return {
                ...this.getDefaultState(),
                available: false
            };
        }
    }

    async open() {
        const script = [
            "$ErrorActionPreference = 'Stop'",
            "Start-Process 'shell:RecycleBinFolder' | Out-Null"
        ].join('; ');

        await this.runPowerShell(script, { timeoutMs: 7000 });
        return { success: true };
    }

    async empty() {
        const script = [
            "$ErrorActionPreference = 'Stop'",
            '$shell = New-Object -ComObject Shell.Application',
            '$folder = $shell.Namespace(10)',
            '$count = 0',
            'if ($null -ne $folder) { $count = [int]$folder.Items().Count }',
            'if ($count -gt 0) {',
            '  if (Get-Command Clear-RecycleBin -ErrorAction SilentlyContinue) {',
            '    Clear-RecycleBin -Force -Confirm:$false -ErrorAction Stop | Out-Null',
            "  } else { throw 'Clear-RecycleBin is unavailable on this host.' }",
            '}',
            "[Console]::Out.Write((@{ success = $true; deletedCount = $count } | ConvertTo-Json -Compress))"
        ].join('; ');

        try {
            const result = await this.runPowerShellJson(script, { timeoutMs: 15000 });
            return {
                success: true,
                deletedCount: Number.isFinite(Number(result.deletedCount)) ? Number(result.deletedCount) : 0
            };
        } catch (error) {
            throw {
                success: false,
                error: error.message || 'Unknown error',
                code: error.code,
                message: 'Unable to empty the recycle bin.'
            };
        }
    }

    async moveItems(paths) {
        if (!Array.isArray(paths) || paths.length === 0) {
            throw new Error('No paths provided for trash operation.');
        }

        const trash = await loadTrashModule();
        await trash(paths, { glob: false });
        return { success: true, count: paths.length };
    }

    runPowerShell(script, options = {}) {
        const {
            timeoutMs = 7000
        } = options;

        return new Promise((resolve, reject) => {
            execFile(
                this.powerShellPath,
                ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
                {
                    windowsHide: true,
                    timeout: timeoutMs,
                    maxBuffer: 1024 * 1024
                },
                (error, stdout, stderr) => {
                    if (error) {
                        const wrappedError = new Error((stderr || stdout || error.message || 'PowerShell command failed.').trim());
                        wrappedError.code = error.code;
                        reject(wrappedError);
                        return;
                    }

                    resolve((stdout || '').trim());
                }
            );
        });
    }

    async runPowerShellJson(script, options = {}) {
        const stdout = await this.runPowerShell(script, options);
        if (!stdout) {
            return {};
        }
        return JSON.parse(stdout);
    }
}

module.exports = WindowsRecycleBinProvider;
