;(function (root) {
    const globalRef = root || {};

    if (globalRef.ExplorerIconBuilder) {
        if (typeof module !== 'undefined' && module.exports) {
            module.exports = globalRef.ExplorerIconBuilder;
        }
        return;
    }

    const DISPLAYABLE_IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg']);
    const AVAILABLE_ICON_SIZES = [16, 20, 24, 32, 40, 48, 64, 80, 96, 128, 256, 512, 768];
    const SHORTCUT_BADGE_SIZES = [8, 16, 24, 32, 48];
    const BASE_ICON_PATH = 'resources/images/icons/explorer/';
    const RECYCLE_BIN_CACHE_IDENTITY = '__recycle_bin__';
    const DESKTOP_ICON_DESCRIPTOR_CACHE = new Map();
    const DESKTOP_ICON_CACHE_KEYS_BY_ENTRY = new Map();

    const ICON_SIZE_AVAILABILITY = {
        'bat': [16, 32, 48, 256],
        'dll': [16, 32, 48, 256],
        'generic_file': [16, 20, 24, 32, 40, 48, 64, 256],
        'generic_program': [16, 20, 24, 32, 40, 48, 64, 256],
        'recycle_bin/empty': [16, 20, 24, 32, 40, 48, 64, 80, 96, 128, 256],
        'recycle_bin/full': [16, 20, 24, 32, 40, 48, 64, 80, 96, 128, 256],
        'folder_home': [16, 20, 24, 32, 40, 48, 64, 80, 96, 768],
        'generic_folder': [16, 32, 48, 96],
        'folder_of_folders': [16, 32, 48, 96],
        'homegroup': [16, 20, 24, 32, 40, 48, 64, 80, 96, 256, 512, 768],
        'image/png': [16, 32, 48],
        'image/jpg': [16, 32, 48],
        'ini': [16, 32, 48, 256],
        'iso': [16, 24, 32, 48, 256],
        'video': [16, 32, 48],
        'music': [16, 32, 48],
        'zip': [16, 32, 48, 256],
        'text_document': [16, 20, 24, 32, 40, 48, 64, 256],
        'rich_text_document': [16, 32, 48]
    };

    const ICON_DIRECTORY_BY_CATEGORY = {
        'bat': 'bat',
        'dll': 'dll',
        'generic_file': 'generic_file',
        'generic_program': 'generic_program',
        'recycle_bin/empty': 'recycle_bin/empty',
        'recycle_bin/full': 'recycle_bin/full',
        'folder_home': 'folder_home',
        'generic_folder': 'generic_folder',
        'folder_of_folders': 'folder_of_folders',
        'homegroup': 'homegroup',
        'image/png': 'image/png',
        'image/jpg': 'image/jpg',
        'ini': 'ini',
        'iso': 'iso',
        'video': 'video',
        'music': 'music',
        'zip': 'zip',
        'text_document': 'text_document',
        'rich_text_document': 'rich_text_document'
    };

    function normalizeExtension(extension) {
        if (!extension || typeof extension !== 'string') {
            return '';
        }

        return extension.toLowerCase();
    }

    function getShortcutInfo(entry) {
        if (entry?.type !== 'file') {
            return null;
        }

        const extension = normalizeExtension(entry.extension);
        if (extension !== 'ink' && extension !== 'lnk') {
            return null;
        }

        const parsedName = entry.name && typeof entry.name === 'string'
            ? entry.name
            : (entry.path ? entry.path.split(/[\\/]/).pop() : '');
        const baseWithoutShortcut = parsedName.replace(/\.(ink|lnk)$/i, '').replace(/\s*-\s*Shortcut$/i, '');
        const targetExtension = normalizeExtension((baseWithoutShortcut.split('.').pop() || ''));

        return {
            targetExtension: targetExtension && targetExtension !== baseWithoutShortcut.toLowerCase()
                ? targetExtension
                : ''
        };
    }

    function isDisplayableImage(entry) {
        const shortcutInfo = getShortcutInfo(entry);
        const effectiveExtension = shortcutInfo?.targetExtension || entry?.extension;

        if (entry?.type !== 'file' || !effectiveExtension || shortcutInfo) {
            return false;
        }

        return DISPLAYABLE_IMAGE_EXTENSIONS.has(normalizeExtension(effectiveExtension));
    }

    function resolveIconClass(entry) {
        switch (entry?.type) {
            case 'folder':
                return 'folder';
            case 'file':
                return 'file';
            case 'recycle-bin':
                return 'recycle';
            default:
                return 'file';
        }
    }

    function formatIconLabel(entry) {
        if (entry?.type === 'folder') {
            return 'DIR';
        }

        if (entry?.type === 'recycle-bin') {
            return 'BIN';
        }

        const shortcutInfo = getShortcutInfo(entry);
        const effectiveExtension = shortcutInfo?.targetExtension || entry?.extension;

        if (!effectiveExtension) {
            return 'FILE';
        }

        return effectiveExtension.slice(0, 3).toUpperCase();
    }

    function getDesiredIconResourceSize(displaySize = 48) {
        const normalizedDisplaySize = Number(displaySize);
        const targetSize = Number.isFinite(normalizedDisplaySize) && normalizedDisplaySize > 0
            ? normalizedDisplaySize
            : 48;

        // Favor the next icon resource size at or above the rendered size so desktop
        // icons stay sharper on scaled displays instead of upscaling a smaller asset.
        return AVAILABLE_ICON_SIZES.find(size => size >= targetSize)
            || AVAILABLE_ICON_SIZES[AVAILABLE_ICON_SIZES.length - 1]
            || 48;
    }

    function getAvailableSizes(iconCategory) {
        const configuredSizes = ICON_SIZE_AVAILABILITY[iconCategory];
        const sourceSizes = Array.isArray(configuredSizes) && configuredSizes.length > 0
            ? configuredSizes
            : AVAILABLE_ICON_SIZES;

        return Array.from(new Set(sourceSizes)).sort((a, b) => a - b);
    }

    function getIconCandidateSizes(iconCategory, desiredSize) {
        const sizes = getAvailableSizes(iconCategory);
        if (sizes.length === 0) {
            return [];
        }

        const exactSize = sizes.filter(size => size === desiredSize);
        const largerSizes = sizes.filter(size => size > desiredSize);
        const smallerSizes = sizes.filter(size => size < desiredSize).sort((a, b) => b - a);

        return [...exactSize, ...largerSizes, ...smallerSizes];
    }

    function getIconCategory(entry) {
        if (!entry) {
            return null;
        }

        if (entry.type === 'recycle-bin') {
            return entry.recycleBinEmpty ? 'recycle_bin/empty' : 'recycle_bin/full';
        }

        if (typeof entry.iconCategory === 'string' && entry.iconCategory) {
            return entry.iconCategory;
        }

        if (entry.type === 'folder') {
            return 'generic_folder';
        }

        if (entry.type !== 'file') {
            return null;
        }

        const shortcutInfo = getShortcutInfo(entry);
        const effectiveExtension = normalizeExtension(shortcutInfo?.targetExtension || entry.extension);

        if (!effectiveExtension) {
            return 'generic_file';
        }

        const extension = effectiveExtension;

        if (extension === 'png') {
            return 'image/png';
        }

        if (['jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp', 'tiff', 'tif', 'ico'].includes(extension)) {
            return 'image/jpg';
        }

        if (['mp4', 'mov', 'avi', 'mkv', 'wmv', 'flv', 'webm', 'm4v'].includes(extension)) {
            return 'video';
        }

        if (['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'wma', 'aiff'].includes(extension)) {
            return 'music';
        }

        if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'].includes(extension)) {
            return 'zip';
        }

        if (['exe', 'app'].includes(extension)) {
            return 'generic_program';
        }

        if (['bat', 'cmd'].includes(extension)) {
            return 'bat';
        }

        if (extension === 'dll') {
            return 'dll';
        }

        if (extension === 'ini') {
            return 'ini';
        }

        if (extension === 'iso') {
            return 'iso';
        }

        if (extension === 'txt') {
            return 'text_document';
        }

        if (extension === 'rtf') {
            return 'rich_text_document';
        }

        return 'generic_file';
    }

    function getIconSourceCandidates(entry, desiredSize = 48) {
        const iconCategory = getIconCategory(entry);
        if (!iconCategory) {
            return [];
        }

        const iconDirectory = ICON_DIRECTORY_BY_CATEGORY[iconCategory] || iconCategory;
        return getIconCandidateSizes(iconCategory, desiredSize)
            .map(size => `${BASE_ICON_PATH}${iconDirectory}/${size}.png`);
    }

    function getShortcutBadgeSourceCandidates(displaySize = 48) {
        const desiredSize = getDesiredIconResourceSize(Math.max(8, Math.round(displaySize * 0.5)));
        const exactSizes = SHORTCUT_BADGE_SIZES.filter(size => size === desiredSize);
        const largerSizes = SHORTCUT_BADGE_SIZES.filter(size => size > desiredSize);
        const smallerSizes = SHORTCUT_BADGE_SIZES.filter(size => size < desiredSize).sort((a, b) => b - a);

        return [...exactSizes, ...largerSizes, ...smallerSizes]
            .map(size => `${BASE_ICON_PATH}shortcut_badge/${size}.png`);
    }

    function getEntryCacheIdentity(entry) {
        if (entry?.type === 'recycle-bin') {
            return RECYCLE_BIN_CACHE_IDENTITY;
        }

        if (typeof entry?.path === 'string' && entry.path) {
            return entry.path.toLowerCase();
        }

        return `${entry?.type || 'unknown'}:${String(entry?.name || '').toLowerCase()}`;
    }

    function trackDesktopIconCacheKey(entry, cacheKey) {
        const identity = getEntryCacheIdentity(entry);
        const existingKeys = DESKTOP_ICON_CACHE_KEYS_BY_ENTRY.get(identity) || new Set();
        existingKeys.add(cacheKey);
        DESKTOP_ICON_CACHE_KEYS_BY_ENTRY.set(identity, existingKeys);
    }

    function buildDesktopIconCacheKey(entry, displaySize = 48) {
        const desiredSize = getDesiredIconResourceSize(displaySize);
        const modifiedTime = Number.isFinite(Number(entry?.modifiedTime))
            ? Number(entry.modifiedTime)
            : 0;

        return [
            getEntryCacheIdentity(entry),
            entry?.type || '',
            entry?.name || '',
            normalizeExtension(entry?.extension || ''),
            getIconCategory(entry) || '',
            getShortcutInfo(entry)?.targetExtension || '',
            desiredSize,
            isDisplayableImage(entry) ? 'thumbnail' : 'icon',
            entry?.type === 'recycle-bin' ? (entry.recycleBinEmpty ? 'empty' : 'full') : '',
            modifiedTime
        ].join('|');
    }

    function getDesktopIconDescriptor(entry, displaySize = 48) {
        const cacheKey = buildDesktopIconCacheKey(entry, displaySize);
        const cachedDescriptor = DESKTOP_ICON_DESCRIPTOR_CACHE.get(cacheKey);
        if (cachedDescriptor) {
            return cachedDescriptor;
        }

        let descriptor = null;

        if (isDisplayableImage(entry) && entry.path) {
            descriptor = {
                kind: 'thumbnail',
                src: `file://${entry.path}`,
                shortcutBadgeSources: getShortcutInfo(entry) ? getShortcutBadgeSourceCandidates(displaySize) : []
            };
        } else {
            const desiredSize = getDesiredIconResourceSize(displaySize);
            const sourceCandidates = getIconSourceCandidates(entry, desiredSize);

            descriptor = sourceCandidates.length > 0
                ? {
                    kind: 'image',
                    sources: sourceCandidates,
                    shortcutBadgeSources: getShortcutInfo(entry) ? getShortcutBadgeSourceCandidates(displaySize) : []
                }
                : {
                    kind: 'label',
                    text: formatIconLabel(entry),
                    shortcutBadgeSources: getShortcutInfo(entry) ? getShortcutBadgeSourceCandidates(displaySize) : []
                };
        }

        DESKTOP_ICON_DESCRIPTOR_CACHE.set(cacheKey, descriptor);
        trackDesktopIconCacheKey(entry, cacheKey);

        return descriptor;
    }

    function invalidateIconCacheForIdentity(identity) {
        if (!identity) {
            return;
        }

        const cacheKeys = DESKTOP_ICON_CACHE_KEYS_BY_ENTRY.get(identity);
        if (!cacheKeys) {
            return;
        }

        cacheKeys.forEach(cacheKey => {
            DESKTOP_ICON_DESCRIPTOR_CACHE.delete(cacheKey);
        });

        DESKTOP_ICON_CACHE_KEYS_BY_ENTRY.delete(identity);
    }

    function invalidateIconCacheForEntry(entry) {
        invalidateIconCacheForIdentity(getEntryCacheIdentity(entry));
    }

    function invalidateIconCacheForPath(targetPath) {
        if (typeof targetPath !== 'string' || !targetPath) {
            return;
        }

        invalidateIconCacheForIdentity(targetPath.toLowerCase());
    }

    function clearIconCache() {
        DESKTOP_ICON_DESCRIPTOR_CACHE.clear();
        DESKTOP_ICON_CACHE_KEYS_BY_ENTRY.clear();
    }

    function attachFallbackImageSources(img, sources, onExhausted) {
        const uniqueSources = Array.from(new Set((sources || []).filter(Boolean)));
        if (uniqueSources.length === 0) {
            onExhausted();
            return;
        }

        let currentIndex = 0;

        const tryNextSource = () => {
            if (currentIndex >= uniqueSources.length) {
                img.removeAttribute('src');
                onExhausted();
                return;
            }

            img.src = uniqueSources[currentIndex];
            currentIndex += 1;
        };

        img.addEventListener('error', tryNextSource);
        tryNextSource();
    }

    function attachShortcutBadge(icon, doc, sources) {
        const badgeSources = Array.from(new Set((sources || []).filter(Boolean)));
        if (!badgeSources.length) {
            return;
        }

        const badge = doc.createElement('img');
        badge.className = 'desktop-item__icon-shortcut-badge';
        badge.draggable = false;
        icon.appendChild(badge);

        attachFallbackImageSources(badge, badgeSources, () => {
            if (badge.parentNode) {
                badge.parentNode.removeChild(badge);
            }
        });
    }

    function createDesktopIconElement({ entry, displaySize = 48, documentRef } = {}) {
        const doc = documentRef || globalRef.document;
        if (!doc) {
            throw new Error('ExplorerIconBuilder: document is required to build icon elements.');
        }

        const icon = doc.createElement('div');
        icon.className = `desktop-item__icon desktop-item__icon--${resolveIconClass(entry)}`;
        const descriptor = getDesktopIconDescriptor(entry, displaySize);

        if (descriptor?.kind === 'thumbnail') {
            const img = doc.createElement('img');
            img.src = descriptor.src;
            img.className = 'desktop-item__icon-image desktop-item__icon-image--thumbnail';
            img.draggable = false;
            icon.classList.add('desktop-item__icon--thumbnail');
            icon.appendChild(img);
            attachShortcutBadge(icon, doc, descriptor.shortcutBadgeSources);
            return icon;
        }

        if (descriptor?.kind === 'label') {
            icon.textContent = descriptor.text;
            attachShortcutBadge(icon, doc, descriptor.shortcutBadgeSources);
            return icon;
        }

        const img = doc.createElement('img');
        img.className = 'desktop-item__icon-image';
        img.draggable = false;
        icon.appendChild(img);

        attachFallbackImageSources(img, descriptor?.sources || [], () => {
            icon.textContent = formatIconLabel(entry);
        });
        attachShortcutBadge(icon, doc, descriptor.shortcutBadgeSources);

        return icon;
    }

    const api = {
        createDesktopIconElement,
        formatIconLabel,
        getDesiredIconResourceSize,
        getDesktopIconDescriptor,
        getIconCategory,
        getIconSourceCandidates,
        invalidateIconCacheForEntry,
        invalidateIconCacheForPath,
        isDisplayableImage,
        resolveIconClass,
        clearIconCache
    };

    globalRef.ExplorerIconBuilder = api;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
