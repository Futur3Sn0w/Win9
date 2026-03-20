const os = require('os');
const path = require('path');
const fs = require('fs/promises');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');
const { nativeImage } = require('electron');

const execFilePromise = promisify(execFile);

const DEFAULT_PROFILE_NAME = 'User';
const WINDOWS_DISPLAY_NAME_SCRIPT = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$username = $env:USERNAME
$displayName = $null

try {
    if (Get-Command Get-LocalUser -ErrorAction SilentlyContinue) {
        $localUser = Get-LocalUser -Name $username -ErrorAction SilentlyContinue
        if ($localUser -and $localUser.FullName) {
            $displayName = [string]$localUser.FullName
        }
    }
} catch {}

if (-not $displayName) {
    try {
        Add-Type -AssemblyName System.DirectoryServices.AccountManagement -ErrorAction SilentlyContinue
        $context = New-Object System.DirectoryServices.AccountManagement.PrincipalContext([System.DirectoryServices.AccountManagement.ContextType]::Machine)
        $principal = [System.DirectoryServices.AccountManagement.UserPrincipal]::FindByIdentity($context, $username)
        if ($principal -and $principal.DisplayName) {
            $displayName = [string]$principal.DisplayName
        }
    } catch {}
}

if (-not $displayName) {
    $displayName = $username
}

@{
    username = $username
    displayName = $displayName
} | ConvertTo-Json -Compress
`;

let cachedHostUserProfilePromise = null;

function normalizeString(value) {
    if (typeof value !== 'string') {
        return '';
    }

    return value.replace(/\s+/g, ' ').trim();
}

async function fileExists(targetPath) {
    if (!targetPath || typeof targetPath !== 'string') {
        return false;
    }

    try {
        const stat = await fs.stat(targetPath);
        return stat.isFile();
    } catch (_error) {
        return false;
    }
}

async function directoryExists(targetPath) {
    if (!targetPath || typeof targetPath !== 'string') {
        return false;
    }

    try {
        const stat = await fs.stat(targetPath);
        return stat.isDirectory();
    } catch (_error) {
        return false;
    }
}

function isImageExtension(extension) {
    const normalized = normalizeString(extension).toLowerCase();
    return normalized === '.png' || normalized === '.jpg' || normalized === '.jpeg' || normalized === '.bmp';
}

async function getLatestFileInDirectory(directoryPath, matcher) {
    if (!(await directoryExists(directoryPath))) {
        return null;
    }

    let entries;
    try {
        entries = await fs.readdir(directoryPath, { withFileTypes: true });
    } catch (_error) {
        return null;
    }

    let bestMatch = null;
    for (const entry of entries) {
        if (!entry.isFile()) {
            continue;
        }

        const extension = path.extname(entry.name);
        if (!matcher(entry.name, extension)) {
            continue;
        }

        const fullPath = path.join(directoryPath, entry.name);
        try {
            const stat = await fs.stat(fullPath);
            if (!stat.isFile()) {
                continue;
            }

            if (!bestMatch || stat.mtimeMs > bestMatch.mtimeMs) {
                bestMatch = {
                    path: fullPath,
                    mtimeMs: stat.mtimeMs
                };
            }
        } catch (_error) {
            continue;
        }
    }

    return bestMatch ? bestMatch.path : null;
}

function parseJsonSafely(value) {
    if (typeof value !== 'string' || !value.trim()) {
        return null;
    }

    try {
        return JSON.parse(value);
    } catch (_error) {
        return null;
    }
}

function runPowerShellScript(script, timeout = 4000) {
    return new Promise((resolve, reject) => {
        const child = spawn(
            'powershell.exe',
            ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '-'],
            {
                windowsHide: true,
                stdio: ['pipe', 'pipe', 'pipe']
            }
        );

        let stdout = '';
        let stderr = '';
        let settled = false;
        let timeoutId = null;

        function finish(callback) {
            if (settled) {
                return;
            }

            settled = true;
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
            callback();
        }

        timeoutId = setTimeout(() => {
            finish(() => {
                child.kill();
                reject(new Error('PowerShell host profile lookup timed out.'));
            });
        }, timeout);

        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString('utf8');
        });

        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString('utf8');
        });

        child.on('error', (error) => {
            finish(() => reject(error));
        });

        child.on('close', (code) => {
            finish(() => {
                if (code === 0) {
                    resolve({ stdout, stderr, code });
                    return;
                }

                const message = stderr.trim() || `PowerShell exited with code ${code}.`;
                reject(new Error(message));
            });
        });

        child.stdin.end(String(script || ''));
    });
}

function parseDsclAttributes(stdout) {
    const attributes = {};
    let currentKey = null;

    String(stdout || '')
        .split(/\r?\n/)
        .forEach((line) => {
            if (!line.trim()) {
                return;
            }

            const match = line.match(/^([A-Za-z0-9:_-]+):\s*(.*)$/);
            if (match) {
                currentKey = match[1];
                attributes[currentKey] = [];
                if (match[2]) {
                    attributes[currentKey].push(match[2].trim());
                }
                return;
            }

            if (currentKey) {
                attributes[currentKey].push(line.trim());
            }
        });

    return attributes;
}

async function imagePathToDataUrl(imagePath) {
    if (!(await fileExists(imagePath))) {
        return null;
    }

    try {
        const image = nativeImage.createFromPath(imagePath);
        if (image && !image.isEmpty()) {
            return image.toDataURL();
        }
    } catch (error) {
        console.warn('[ShellUserProfile] Failed to convert image via nativeImage:', imagePath, error);
    }

    return null;
}

async function resolveWindowsHostUserProfile(baseProfile) {
    let displayName = baseProfile.displayName;
    let imagePath = '';

    try {
        const { stdout } = await runPowerShellScript(WINDOWS_DISPLAY_NAME_SCRIPT, 3000);
        const parsed = parseJsonSafely(stdout);
        if (parsed && typeof parsed === 'object') {
            displayName = normalizeString(parsed.displayName) || displayName;
        }
    } catch (error) {
        console.warn('[ShellUserProfile] Failed to resolve Windows host profile:', error.message || error);
    }

    if (!displayName || displayName === baseProfile.username) {
        try {
            const { stdout } = await execFilePromise(
                'net.exe',
                ['user', baseProfile.username],
                {
                    encoding: 'utf8',
                    timeout: 3000,
                    windowsHide: true
                }
            );

            const fullNameLine = String(stdout || '')
                .split(/\r?\n/)
                .map((line) => line.trim())
                .find((line) => /^Full Name\s+/i.test(line));

            if (fullNameLine) {
                displayName = normalizeString(fullNameLine.replace(/^Full Name\s+/i, '')) || displayName;
            }
        } catch (error) {
            console.warn('[ShellUserProfile] Failed to resolve Windows display name via net user:', error.message || error);
        }
    }

    const roamingAccountPictures = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'AccountPictures');
    const localAccountPictures = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Windows', 'AccountPictures');
    const localPackagesDir = path.join(process.env.LOCALAPPDATA || '', 'Packages');

    imagePath = await getLatestFileInDirectory(
        roamingAccountPictures,
        (_name, extension) => isImageExtension(extension)
    ) || imagePath;

    if (!imagePath) {
        imagePath = await getLatestFileInDirectory(
            localAccountPictures,
            (_name, extension) => isImageExtension(extension)
        ) || imagePath;
    }

    if (!imagePath && await directoryExists(localPackagesDir)) {
        try {
            const packageEntries = await fs.readdir(localPackagesDir, { withFileTypes: true });
            let bestPackageImage = null;

            for (const packageEntry of packageEntries) {
                if (!packageEntry.isDirectory()) {
                    continue;
                }

                const localStateDir = path.join(localPackagesDir, packageEntry.name, 'LocalState');
                const candidatePath = await getLatestFileInDirectory(
                    localStateDir,
                    (name, extension) => name.startsWith('CurrentAccount_') && isImageExtension(extension)
                );

                if (!candidatePath) {
                    continue;
                }

                try {
                    const stat = await fs.stat(candidatePath);
                    if (!bestPackageImage || stat.mtimeMs > bestPackageImage.mtimeMs) {
                        bestPackageImage = {
                            path: candidatePath,
                            mtimeMs: stat.mtimeMs
                        };
                    }
                } catch (_error) {
                    continue;
                }
            }

            if (bestPackageImage) {
                imagePath = bestPackageImage.path;
            }
        } catch (error) {
            console.warn('[ShellUserProfile] Failed to scan Windows package LocalState folders for account image:', error.message || error);
        }
    }

    return {
        username: baseProfile.username,
        displayName: normalizeString(displayName) || baseProfile.displayName,
        imagePath: normalizeString(imagePath)
    };
}

async function resolveMacHostUserProfile(baseProfile) {
    try {
        const { stdout } = await execFilePromise(
            'dscl',
            ['.', '-read', `/Users/${baseProfile.username}`],
            {
                encoding: 'utf8',
                timeout: 2500
            }
        );

        const attributes = parseDsclAttributes(stdout);
        return {
            username: baseProfile.username,
            displayName: normalizeString(attributes.RealName && attributes.RealName[0]) || baseProfile.displayName,
            imagePath: normalizeString(attributes.Picture && attributes.Picture[0])
        };
    } catch (error) {
        console.warn('[ShellUserProfile] Failed to resolve macOS host profile:', error.message || error);
        return baseProfile;
    }
}

async function resolveLinuxHostUserProfile(baseProfile) {
    let displayName = baseProfile.displayName;
    let imagePath = '';

    try {
        const { stdout } = await execFilePromise(
            'getent',
            ['passwd', baseProfile.username],
            {
                encoding: 'utf8',
                timeout: 2000
            }
        );

        const fields = String(stdout || '').trim().split(':');
        if (fields.length >= 5) {
            const gecosName = normalizeString((fields[4] || '').split(',')[0]);
            if (gecosName) {
                displayName = gecosName;
            }
        }
    } catch (error) {
        console.warn('[ShellUserProfile] Failed to resolve Linux display name:', error.message || error);
    }

    const homeDirectory = os.homedir();
    const linuxImageCandidates = [
        path.join(homeDirectory, '.face'),
        path.join(homeDirectory, '.face.icon')
    ];

    for (const candidatePath of linuxImageCandidates) {
        if (await fileExists(candidatePath)) {
            imagePath = candidatePath;
            break;
        }
    }

    return {
        username: baseProfile.username,
        displayName,
        imagePath
    };
}

async function buildHostUserProfile() {
    const username = normalizeString(os.userInfo().username) || DEFAULT_PROFILE_NAME;
    const baseProfile = {
        username,
        displayName: username,
        imagePath: ''
    };

    let resolvedProfile = baseProfile;
    if (process.platform === 'win32') {
        resolvedProfile = await resolveWindowsHostUserProfile(baseProfile);
    } else if (process.platform === 'darwin') {
        resolvedProfile = await resolveMacHostUserProfile(baseProfile);
    } else {
        resolvedProfile = await resolveLinuxHostUserProfile(baseProfile);
    }

    const normalizedImagePath = normalizeString(resolvedProfile.imagePath);
    const imageDataUrl = normalizedImagePath
        ? await imagePathToDataUrl(normalizedImagePath)
        : null;

    return {
        username: normalizeString(resolvedProfile.username) || username,
        displayName: normalizeString(resolvedProfile.displayName) || username,
        imageDataUrl,
        hasHostImage: Boolean(imageDataUrl),
        sourcePlatform: process.platform
    };
}

async function getHostUserProfile(options = {}) {
    const shouldRefresh = Boolean(options && options.refresh);
    if (!shouldRefresh && cachedHostUserProfilePromise) {
        return cachedHostUserProfilePromise;
    }

    cachedHostUserProfilePromise = buildHostUserProfile().catch((error) => {
        console.warn('[ShellUserProfile] Falling back to default profile:', error.message || error);
        return {
            username: DEFAULT_PROFILE_NAME,
            displayName: DEFAULT_PROFILE_NAME,
            imageDataUrl: null,
            hasHostImage: false,
            sourcePlatform: process.platform
        };
    });

    return cachedHostUserProfilePromise;
}

module.exports = {
    getHostUserProfile
};
