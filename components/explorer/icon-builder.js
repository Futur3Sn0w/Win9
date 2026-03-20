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
    const BASE_ICON_PATH = 'resources/images/icons/explorer/';

    const ICON_SIZE_AVAILABILITY = {
        'bat': [16, 32, 48, 256],
        'dll': [16, 32, 48, 256],
        'generic_file': [16, 32, 48, 256],
        'generic_program': [16, 20, 24, 32, 40, 48, 64, 256],
        'recycle_bin/empty': [16, 20, 24, 32, 40, 48, 64, 80, 96, 128, 256],
        'recycle_bin/full': [16, 20, 24, 32, 40, 48, 64, 80, 96, 128, 256],
        'folder_home': [16, 20, 24, 32, 40, 48, 64, 80, 96, 768],
        'generic_folder': [16, 32, 48],
        'homegroup': [16, 20, 24, 32, 40, 48, 64, 80, 96, 256, 512, 768],
        'image/png': [16, 32, 48],
        'image/jpg': [16, 32, 48],
        'ini': [16, 32, 48, 256],
        'iso': [16, 24, 32, 48, 256],
        'video': [16, 32, 48],
        'music': [16, 32, 48],
        'zip': [16, 32, 48],
        'text_document': [16, 32, 48],
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

    function isDisplayableImage(entry) {
        if (entry?.type !== 'file' || !entry.extension) {
            return false;
        }

        return DISPLAYABLE_IMAGE_EXTENSIONS.has(normalizeExtension(entry.extension));
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

        if (!entry?.extension) {
            return 'FILE';
        }

        return entry.extension.slice(0, 3).toUpperCase();
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

        if (!entry.extension) {
            return 'generic_file';
        }

        const extension = normalizeExtension(entry.extension);

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

    function createDesktopIconElement({ entry, displaySize = 48, documentRef } = {}) {
        const doc = documentRef || globalRef.document;
        if (!doc) {
            throw new Error('ExplorerIconBuilder: document is required to build icon elements.');
        }

        const icon = doc.createElement('div');
        icon.className = `desktop-item__icon desktop-item__icon--${resolveIconClass(entry)}`;

        if (isDisplayableImage(entry) && entry.path) {
            const img = doc.createElement('img');
            img.src = `file://${entry.path}`;
            img.className = 'desktop-item__icon-image desktop-item__icon-image--thumbnail';
            img.draggable = false;
            icon.classList.add('desktop-item__icon--thumbnail');
            icon.appendChild(img);
            return icon;
        }

        const desiredSize = getDesiredIconResourceSize(displaySize);
        const sourceCandidates = getIconSourceCandidates(entry, desiredSize);

        if (sourceCandidates.length === 0) {
            icon.textContent = formatIconLabel(entry);
            return icon;
        }

        const img = doc.createElement('img');
        img.className = 'desktop-item__icon-image';
        img.draggable = false;
        icon.appendChild(img);

        attachFallbackImageSources(img, sourceCandidates, () => {
            icon.textContent = formatIconLabel(entry);
        });

        return icon;
    }

    const api = {
        createDesktopIconElement,
        formatIconLabel,
        getDesiredIconResourceSize,
        getIconCategory,
        getIconSourceCandidates,
        isDisplayableImage,
        resolveIconClass
    };

    globalRef.ExplorerIconBuilder = api;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
