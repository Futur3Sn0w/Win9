const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_COMMIT_SCAN_LIMIT = 40;
const VERSION_TITLE_PATTERN = /^\s*(\d+(?:\.\d+)*)\b(?:\s*:)?/;

let cachedRepositoryBuildInfo = null;

function createEmptyBuildInfo() {
    return {
        available: false,
        sourceTitle: '',
        anchorVersion: '',
        commitsSinceAnchor: 0,
        versionSuffix: ''
    };
}

function parseVersionPrefix(title) {
    if (!title || typeof title !== 'string') {
        return '';
    }

    const match = title.match(VERSION_TITLE_PATTERN);
    return match ? match[1] : '';
}

function incrementVersion(baseVersion, incrementBy = 0) {
    const normalizedBaseVersion = String(baseVersion || '').trim();
    if (!normalizedBaseVersion) {
        return '';
    }

    const parts = normalizedBaseVersion.split('.').map((part) => Number.parseInt(part, 10));
    if (!parts.length || parts.some((part) => !Number.isFinite(part))) {
        return normalizedBaseVersion;
    }

    const normalizedIncrement = Math.max(0, Number.parseInt(incrementBy, 10) || 0);
    if (normalizedIncrement === 0) {
        return parts.join('.');
    }

    if (parts.length === 1) {
        return `${parts[0]}.${normalizedIncrement}`;
    }

    parts[parts.length - 1] += normalizedIncrement;
    return parts.join('.');
}

function readRecentCommitTitles(limit = DEFAULT_COMMIT_SCAN_LIMIT) {
    const normalizedLimit = Math.max(1, Number.parseInt(limit, 10) || DEFAULT_COMMIT_SCAN_LIMIT);
    const output = execFileSync(
        'git',
        ['log', `-${normalizedLimit}`, '--pretty=%s'],
        {
            cwd: REPO_ROOT,
            encoding: 'utf8',
            timeout: 1500,
            windowsHide: true
        }
    );

    return output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
}

function deriveRepositoryBuildInfo(commitTitles) {
    const titles = Array.isArray(commitTitles) ? commitTitles : readRecentCommitTitles();

    for (let index = 0; index < titles.length; index += 1) {
        const sourceTitle = titles[index];
        const anchorVersion = parseVersionPrefix(sourceTitle);
        if (!anchorVersion) {
            continue;
        }

        return {
            available: true,
            sourceTitle,
            anchorVersion,
            commitsSinceAnchor: index,
            versionSuffix: incrementVersion(anchorVersion, index)
        };
    }

    return createEmptyBuildInfo();
}

function getRepositoryBuildInfo() {
    if (cachedRepositoryBuildInfo !== null) {
        return cachedRepositoryBuildInfo;
    }

    try {
        cachedRepositoryBuildInfo = deriveRepositoryBuildInfo();
    } catch (error) {
        console.warn('[BuildInfo] Unable to derive repository build info:', error.message || error);
        cachedRepositoryBuildInfo = createEmptyBuildInfo();
    }

    return cachedRepositoryBuildInfo;
}

function formatCompositeVersion(baseVersion, repositoryBuildInfo = getRepositoryBuildInfo()) {
    const normalizedBaseVersion = String(baseVersion || '').trim();
    if (!normalizedBaseVersion) {
        return '';
    }

    const versionSuffix = repositoryBuildInfo && repositoryBuildInfo.available
        ? String(repositoryBuildInfo.versionSuffix || '').trim()
        : '';

    return versionSuffix ? `${normalizedBaseVersion}-${versionSuffix}` : normalizedBaseVersion;
}

function formatWinverVersionLabel(baseVersion, buildLabel, repositoryBuildInfo = getRepositoryBuildInfo()) {
    const normalizedBuildLabel = String(buildLabel || '').trim();
    return `Version ${formatCompositeVersion(baseVersion, repositoryBuildInfo)} (${normalizedBuildLabel})`;
}

module.exports = {
    parseVersionPrefix,
    incrementVersion,
    readRecentCommitTitles,
    deriveRepositoryBuildInfo,
    getRepositoryBuildInfo,
    formatCompositeVersion,
    formatWinverVersionLabel
};
