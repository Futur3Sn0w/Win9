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
            '    try { Clear-RecycleBin -Force -Confirm:$false -ErrorAction Stop | Out-Null } catch { }',
            '    $afterFolder = (New-Object -ComObject Shell.Application).Namespace(10)',
            '    $afterCount = if ($null -ne $afterFolder) { [int]$afterFolder.Items().Count } else { 0 }',
            "    if ($afterCount -gt 0) { throw 'Failed to empty the recycle bin.' }",
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

    async listItems() {
        const script = [
            "$ErrorActionPreference = 'Stop'",
            '$shell = New-Object -ComObject Shell.Application',
            '$folder = $shell.Namespace(10)',
            '$items = @()',
            'if ($null -ne $folder) {',
            '  foreach ($item in $folder.Items()) {',
            '    $name = [string]$item.Name',
            '    $isFolder = $false',
            '    try { $isFolder = [bool]$item.IsFolder } catch {}',
            '    $deletedFrom = $null',
            "    try { $deletedFrom = [string]$item.ExtendedProperty('System.Recycle.DeletedFrom') } catch {}",
            '    if ([string]::IsNullOrWhiteSpace($deletedFrom)) {',
            "      try { $deletedFrom = [string]$item.ExtendedProperty('System.ItemFolderPathDisplay') } catch {}",
            '    }',
            '    $dateDeleted = $null',
            "    try { $rawDeleted = $item.ExtendedProperty('System.DateDeleted'); if ($null -ne $rawDeleted) { $dateDeleted = [string]$rawDeleted } } catch {}",
            "    $resolvedOriginalPath = if ([string]::IsNullOrWhiteSpace($deletedFrom)) { $null } else { $deletedFrom }",
            "    $extension = if ($isFolder) { '' } else { [System.IO.Path]::GetExtension($name).TrimStart('.').ToLowerInvariant() }",
            '    $items += [pscustomobject]@{',
            '      id = [string]([guid]::NewGuid())',
            '      name = $name',
            '      path = $null',
            '      originalPath = $resolvedOriginalPath',
            '      deletedAt = $dateDeleted',
            '      isDirectory = $isFolder',
            '      extension = $extension',
            '    }',
            '  }',
            '}',
            "[Console]::Out.Write((@{ items = @($items) } | ConvertTo-Json -Compress -Depth 4))"
        ].join('\n');

        try {
            const result = await this.runPowerShellJson(script, { timeoutMs: 15000 });
            return Array.isArray(result.items)
                ? result.items
                : (result.items ? [result.items] : []);
        } catch (error) {
            console.warn('RecycleBin: Failed to list Windows recycle bin items.', error);
            return [];
        }
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
