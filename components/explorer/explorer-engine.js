const fs = require('fs');
const path = require('path');
const os = require('os');
const { shell } = require('electron');

let ExplorerRegistry = null;

try {
    ExplorerRegistry = require('../../registry/explorer-registry.js');
} catch (error) {
    let resolved = null;

    if (!resolved && typeof window !== 'undefined' && typeof window.require === 'function') {
        try {
            resolved = window.require('../../registry/explorer-registry.js');
        } catch (nestedError) {
            if (typeof console !== 'undefined' && console.debug) {
                console.debug('ExplorerEngine: window.require explorer-registry fallback failed:', nestedError);
            }
        }
    }

    if (!resolved && typeof window !== 'undefined') {
        resolved = window.ExplorerRegistry || null;
    }

    ExplorerRegistry = resolved;
}

const ExplorerEngine = (() => {
    const fsp = fs.promises;
    const desktopPath = path.join(os.homedir(), 'Desktop');
    const RECYCLE_BIN_PATH = process.platform === 'darwin'
        ? path.join(os.homedir(), '.Trash')
        : null;

    const RECYCLE_BIN_KEY = '__recycle_bin__';

    const SIZE_PRESETS = {
        small: {
            itemWidth: 96,
            itemHeight: 104,
            iconSize: 56,
            labelFontSize: 12,
            columnGap: 28,
            rowGap: 28
        },
        medium: {
            itemWidth: 116,
            itemHeight: 120,
            iconSize: 68,
            labelFontSize: 13,
            columnGap: 32,
            rowGap: 32
        },
        large: {
            itemWidth: 134,
            itemHeight: 142,
            iconSize: 84,
            labelFontSize: 14,
            columnGap: 38,
            rowGap: 36
        }
    };

    const DEFAULT_SETTINGS = {
        iconSize: 'small',
        snapToGrid: true,
        arrangeIcons: false,
        showIcons: true,
        iconOrder: [],
        iconPositions: {
            grid: {},
            free: {}
        }
    };

    const clone = (value) => {
        if (typeof structuredClone === 'function') {
            return structuredClone(value);
        }
        return JSON.parse(JSON.stringify(value));
    };

    let settings = clone(DEFAULT_SETTINGS);

    let desktopContainer = null;
    let gridElement = null;
    let initialized = false;
    let refreshInFlight = null;
    let eventsBound = false;
    let resizeRaf = null;
    let lastLayoutWidth = 0;
    let lastLayoutHeight = 0;

    const itemEntryMap = new WeakMap();
    let entryElementsByPath = new Map();
    let selectedElements = new Set();
    let pendingSelectPath = null;
    let hoveredItem = null;

    const dragSelectState = {
        active: false,
        originX: 0,
        originY: 0,
        overlay: null
    };

    let dragState = null;
    let clipboardData = null;
    let itemContextMenu = null;
    let renameState = null;
    let contextMenuDismissHandler = null;
    const handleWindowBlur = () => {
        hideItemContextMenu();
    };
    const handleContextMenuKeydown = (event) => {
        if (event.key === 'Escape') {
            hideItemContextMenu();
        }
    };
    const requestWindowDefocus = () => {
        if (typeof window.unfocusAllClassicWindows === 'function') {
            window.unfocusAllClassicWindows();
        }
    };

    function getExplorerRegistryApi() {
        if (ExplorerRegistry && typeof ExplorerRegistry === 'object') {
            return ExplorerRegistry;
        }
        if (typeof window !== 'undefined' && window.ExplorerRegistry) {
            return window.ExplorerRegistry;
        }
        return null;
    }

    function ensureDesktopContainer() {
        if (desktopContainer) {
            return true;
        }

        desktopContainer = document.querySelector('.desktop-content');
        if (!desktopContainer) {
            console.warn('ExplorerEngine: Desktop container not found.');
            return false;
        }

        if (!gridElement) {
            gridElement = document.createElement('div');
            gridElement.className = 'desktop-grid desktop-grid--size-small';
            gridElement.style.height = '0px';
            desktopContainer.appendChild(gridElement);
        }

        return true;
    }

    function bindDesktopEvents() {
        if (!desktopContainer || eventsBound) {
            return;
        }

        desktopContainer.addEventListener('mousedown', handleDesktopMouseDown);
        window.addEventListener('resize', handleWindowResize);
        eventsBound = true;
    }

    function handleWindowResize() {
        if (resizeRaf) {
            cancelAnimationFrame(resizeRaf);
        }
        resizeRaf = requestAnimationFrame(() => {
            resizeRaf = null;

            const width = desktopContainer ? desktopContainer.clientWidth : window.innerWidth;
            const height = desktopContainer ? desktopContainer.clientHeight : window.innerHeight;

            if (!initialized || !settings.showIcons) {
                lastLayoutWidth = width;
                lastLayoutHeight = height;
                return;
            }

            const shrink = width < lastLayoutWidth || height < lastLayoutHeight;
            if (shrink) {
                layoutIcons({ persist: true });
            }

            lastLayoutWidth = width;
            lastLayoutHeight = height;
        });
    }

    function loadSettings() {
        const registryApi = getExplorerRegistryApi();

        try {
            if (registryApi && typeof registryApi.loadExplorerDesktopState === 'function') {
                const loaded = registryApi.loadExplorerDesktopState(DEFAULT_SETTINGS);
                if (loaded && typeof loaded === 'object') {
                    settings = {
                        ...clone(DEFAULT_SETTINGS),
                        ...loaded,
                        iconPositions: {
                            grid: loaded?.iconPositions?.grid || {},
                            free: loaded?.iconPositions?.free || {}
                        },
                        iconOrder: Array.isArray(loaded?.iconOrder) ? loaded.iconOrder.slice() : []
                    };
                    return;
                }
            }
        } catch (error) {
            console.warn('ExplorerEngine: Failed to load settings from registry, using defaults.', error);
        }

        settings = clone(DEFAULT_SETTINGS);
    }

    function saveSettings() {
        const registryApi = getExplorerRegistryApi();
        const data = {
            iconSize: settings.iconSize,
            snapToGrid: !!settings.snapToGrid,
            arrangeIcons: !!settings.arrangeIcons,
            showIcons: !!settings.showIcons,
            iconOrder: Array.isArray(settings.iconOrder) ? settings.iconOrder.slice() : [],
            iconPositions: {
                grid: settings.iconPositions?.grid || {},
                free: settings.iconPositions?.free || {}
            }
        };

        if (registryApi && typeof registryApi.saveExplorerDesktopState === 'function') {
            try {
                registryApi.saveExplorerDesktopState(data);
            } catch (error) {
                console.warn('ExplorerEngine: Failed to persist settings to registry.', error);
            }
        } else {
            console.warn('ExplorerEngine: Explorer registry API unavailable; settings not persisted.');
        }
    }

    function getSettingsSnapshot() {
        return {
            iconSize: settings.iconSize,
            snapToGrid: settings.snapToGrid,
            arrangeIcons: settings.arrangeIcons,
            showIcons: settings.showIcons
        };
    }

    function resolveSizePreset(sizeKey) {
        return SIZE_PRESETS[sizeKey] || SIZE_PRESETS.small;
    }

    function computeCellMetrics(preset) {
        return {
            cellWidth: preset.itemWidth + preset.columnGap,
            cellHeight: preset.itemHeight + preset.rowGap
        };
    }

    function getLayoutMode() {
        if (settings.arrangeIcons) return 'arranged';
        if (settings.snapToGrid) return 'grid';
        return 'free';
    }

    async function initializeDesktop() {
        if (!ensureDesktopContainer()) {
            return;
        }

        loadSettings();
        applySizeClass();
        bindDesktopEvents();
        initialized = true;
        await refreshDesktop();
    }

    async function refreshDesktop() {
        if (!initialized && !ensureDesktopContainer()) {
            return;
        }

        if (!gridElement) {
            return;
        }

        if (refreshInFlight) {
            return refreshInFlight;
        }

        hideItemContextMenu();
        cancelInlineRename();

        const selectionSnapshot = captureSelectionSnapshot();

        refreshInFlight = (async () => {
            try {
                const entries = await readDesktopEntries();

                gridElement.innerHTML = '';
                entryElementsByPath = new Map();
                selectedElements = new Set();
                hoveredItem = null;

                const recycleEntry = buildRecycleEntry();
                const recycleItem = buildDesktopItem(recycleEntry);
                gridElement.appendChild(recycleItem);

                entries.forEach(entry => {
                    const item = buildDesktopItem(entry);
                    gridElement.appendChild(item);
                });

                if (pendingSelectPath) {
                    clearSelection();
                    const target = entryElementsByPath.get(pendingSelectPath);
                    if (target) {
                        addToSelection(target);
                        target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
                    }
                    pendingSelectPath = null;
                } else {
                    applySelectionSnapshot(selectionSnapshot);
                }

                layoutIcons({ persist: true });
            } catch (error) {
                console.error('ExplorerEngine: Failed to refresh desktop.', error);
            } finally {
                refreshInFlight = null;
            }
        })();

        return refreshInFlight;
    }

    async function readDesktopEntries() {
        try {
            const stats = await fsp.stat(desktopPath);
            if (!stats.isDirectory()) {
                console.warn('ExplorerEngine: Desktop path is not a directory.', desktopPath);
                return [];
            }
        } catch (error) {
            console.error('ExplorerEngine: Unable to access desktop path.', desktopPath, error);
            return [];
        }

        try {
            const dirents = await fsp.readdir(desktopPath, { withFileTypes: true });
            return dirents
                .filter(dirent => !dirent.name.startsWith('.'))
                .map(dirent => {
                    const isDirectory = dirent.isDirectory();
                    const entryPath = path.join(desktopPath, dirent.name);
                    const extension = !isDirectory ? path.extname(dirent.name).slice(1).toLowerCase() : '';
                    return {
                        name: dirent.name,
                        path: entryPath,
                        type: isDirectory ? 'folder' : 'file',
                        extension
                    };
                })
                .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
        } catch (error) {
            console.error('ExplorerEngine: Failed to read desktop directory.', error);
            return [];
        }
    }

    function buildRecycleEntry() {
        return {
            name: 'Recycle Bin',
            path: RECYCLE_BIN_PATH,
            type: 'recycle-bin',
            extension: '',
            recycleBinEmpty: true
        };
    }

    function buildDesktopItem(entry) {
        const item = document.createElement('div');
        item.className = 'desktop-item';
        item.setAttribute('data-type', entry.type);

        const itemKey = deriveItemKey(entry);
        item.dataset.itemKey = itemKey;

        if (entry.path) {
            item.setAttribute('data-path', entry.path);
            entryElementsByPath.set(entry.path, item);
        }

        if (entry.extension) {
            item.setAttribute('data-extension', entry.extension);
        }

        if (isEntryClickable(entry)) {
            item.classList.add('desktop-item--clickable');
        } else if (entry.type === 'recycle-bin') {
            item.classList.add('desktop-item--disabled');
        }

        const icon = document.createElement('div');
        icon.className = `desktop-item__icon desktop-item__icon--${resolveIconClass(entry)}`;

        const preset = resolveSizePreset(settings.iconSize);
        const iconSize = preset.iconSize;
        let desiredIconSize = 48;

        if (iconSize <= 56) {
            desiredIconSize = 48;
        } else if (iconSize <= 68) {
            desiredIconSize = 64;
        } else if (iconSize <= 84) {
            desiredIconSize = 64;
        } else {
            desiredIconSize = 96;
        }

        // Check if this is a displayable image file - if so, render thumbnail
        if (isDisplayableImage(entry)) {
            const img = document.createElement('img');
            img.src = `file://${entry.path}`;
            img.className = 'desktop-item__icon-image desktop-item__icon-image--thumbnail';
            img.draggable = false;
            icon.classList.add('desktop-item__icon--thumbnail');
            icon.appendChild(img);
        } else {
            const iconPath = getIconPath(entry, desiredIconSize);
            if (iconPath) {
                const img = document.createElement('img');
                img.src = iconPath;
                img.className = 'desktop-item__icon-image';
                img.draggable = false;
                icon.appendChild(img);
            } else {
                icon.textContent = formatIconLabel(entry);
            }
        }

        const labelContainer = document.createElement('div');
        labelContainer.className = 'desktop-item__label-container';

        const truncatedLabel = document.createElement('div');
        truncatedLabel.className = 'desktop-item__label desktop-item__label--truncated';
        truncatedLabel.textContent = entry.name;

        const fullLabel = document.createElement('div');
        fullLabel.className = 'desktop-item__label desktop-item__label--full';
        fullLabel.textContent = entry.name;

        labelContainer.appendChild(truncatedLabel);
        labelContainer.appendChild(fullLabel);

        item.appendChild(icon);
        item.appendChild(labelContainer);

        itemEntryMap.set(item, entry);

        item.addEventListener('click', handleItemClick);
        item.addEventListener('dblclick', handleItemDoubleClick);
        item.addEventListener('mouseenter', handleItemMouseEnter);
        item.addEventListener('mouseleave', handleItemMouseLeave);
        item.addEventListener('pointerdown', handleItemPointerDown);
        item.addEventListener('contextmenu', handleItemContextMenu);

        return item;
    }

    function deriveItemKey(entry) {
        if (entry.path) return entry.path;
        if (entry.type === 'recycle-bin') return RECYCLE_BIN_KEY;
        return `unknown-${entry.name}-${Date.now()}`;
    }

    function handleItemClick(event) {
        if (!settings.showIcons) {
            return;
        }

        requestWindowDefocus();

        const item = event.currentTarget;
        if (item.dataset.suppressClick === '1') {
            delete item.dataset.suppressClick;
            return;
        }

        if (event.button !== 0) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        const entry = itemEntryMap.get(item);
        if (!entry) {
            return;
        }

        const additive = event.ctrlKey || event.metaKey;

        if (additive) {
            if (selectedElements.has(item)) {
                removeFromSelection(item);
            } else {
                addToSelection(item);
            }
        } else {
            selectExclusive(item);
        }
    }

    function handleItemDoubleClick(event) {
        if (!settings.showIcons) {
            return;
        }

        requestWindowDefocus();

        const item = event.currentTarget;
        if (item.dataset.suppressClick === '1') {
            delete item.dataset.suppressClick;
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        const entry = itemEntryMap.get(item);
        if (!entry) {
            return;
        }

        addToSelection(item);

        if (entry.type === 'recycle-bin') {
            openRecycleBin().catch(error => {
                console.error('ExplorerEngine: Failed to open recycle bin.', error);
            });
            return;
        }

        if (!entry.path) {
            console.warn('ExplorerEngine: No path available for entry.', entry);
            return;
        }

        openEntryPath(entry.path, entry.type).catch(error => {
            console.error('ExplorerEngine: Failed to open entry.', error);
        });
    }

    function handleItemMouseEnter(event) {
        const item = event.currentTarget;

        if (hoveredItem && hoveredItem !== item) {
            hoveredItem.classList.remove('is-hovered');
        }

        if (item.classList.contains('is-selected')) {
            hoveredItem = item;
            item.classList.add('is-hovered');
            updateSelectionHighlight(item);
        } else {
            hoveredItem = null;
        }
    }

    function handleItemMouseLeave(event) {
        const item = event.currentTarget;
        if (item.classList.contains('is-hovered')) {
            item.classList.remove('is-hovered');
        }
        if (hoveredItem === item) {
            hoveredItem = null;
        }
    }

    function handleItemPointerDown(event) {
        if (!settings.showIcons) {
            return;
        }

        if (event.button !== 0) {
            return;
        }

        requestWindowDefocus();

        const item = event.currentTarget;
        if (item.classList.contains('desktop-item--disabled')) {
            return;
        }

        event.preventDefault();

        const initialLeft = parseFloat(item.style.left) || 0;
        const initialTop = parseFloat(item.style.top) || 0;

        dragState = {
            item,
            pointerId: event.pointerId,
            startPointerX: event.clientX,
            startPointerY: event.clientY,
            initialLeft,
            initialTop,
            currentLeft: initialLeft,
            currentTop: initialTop,
            isDragging: false
        };

        item.setPointerCapture(event.pointerId);
        item.classList.add('drag-active');

        document.addEventListener('pointermove', handleItemPointerMove);
        document.addEventListener('pointerup', handleItemPointerUp, { once: false });
    }

    async function handleItemContextMenu(event) {
        if (!settings.showIcons) {
            return;
        }

        const item = event.currentTarget;
        if (!item) {
            return;
        }

        requestWindowDefocus();
        cancelInlineRename();

        event.preventDefault();
        event.stopPropagation();

        const entry = itemEntryMap.get(item);
        if (!entry) {
            return;
        }

        if (!selectedElements.has(item)) {
            selectExclusive(item);
        }

        try {
            await showItemContextMenu(item, entry, event.pageX, event.pageY);
        } catch (error) {
            console.error('ExplorerEngine: Failed to show item context menu.', error);
        }
    }

    function handleItemPointerMove(event) {
        if (!dragState || event.pointerId !== dragState.pointerId) {
            return;
        }

        const dx = event.clientX - dragState.startPointerX;
        const dy = event.clientY - dragState.startPointerY;

        if (!dragState.isDragging) {
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
                dragState.isDragging = true;
                dragState.item.classList.add('desktop-item--dragging');
                dragState.item.style.transition = 'none';
            } else {
                return;
            }
        }

        const newLeft = dragState.initialLeft + dx;
        const newTop = dragState.initialTop + dy;

        dragState.currentLeft = newLeft;
        dragState.currentTop = newTop;

        positionItemImmediate(dragState.item, newLeft, newTop);
    }

    function handleItemPointerUp(event) {
        if (!dragState || event.pointerId !== dragState.pointerId) {
            return;
        }

        const { item, isDragging, currentLeft, currentTop } = dragState;

        item.releasePointerCapture(event.pointerId);
        item.classList.remove('desktop-item--dragging');
        item.classList.remove('drag-active');
        item.style.transition = '';

        document.removeEventListener('pointermove', handleItemPointerMove);
        document.removeEventListener('pointerup', handleItemPointerUp);

        if (isDragging) {
            item.dataset.suppressClick = '1';
            finalizeDrag(item, currentLeft, currentTop);
        }

        dragState = null;
    }

    function finalizeDrag(item, left, top) {
        const mode = getLayoutMode();
        const preset = resolveSizePreset(settings.iconSize);
        const metrics = computeCellMetrics(preset);

        switch (mode) {
            case 'arranged':
                finalizeArrangedDrag(item, left, top, preset, metrics);
                break;
            case 'grid':
                finalizeGridDrag(item, left, top, preset, metrics);
                break;
            default:
                finalizeFreeDrag(item, left, top, preset);
                break;
        }

        layoutIcons({ persist: true });
    }

    function finalizeArrangedDrag(item, left, top, preset, metrics) {
        const items = Array.from(gridElement.querySelectorAll('.desktop-item'));
        syncOrderWithItems(items);

        const itemKey = item.dataset.itemKey;
        const order = settings.iconOrder;

        const containerWidth = gridElement.clientWidth || desktopContainer.clientWidth || window.innerWidth;
        const availableHeight = desktopContainer ? desktopContainer.clientHeight : window.innerHeight;
        const columns = Math.max(1, Math.floor(containerWidth / metrics.cellWidth));
        const rowsPerColumn = Math.max(1, Math.floor(availableHeight / metrics.cellHeight));

        const col = clamp(Math.round(left / metrics.cellWidth), 0, Math.max(columns - 1, 0));
        const row = clamp(Math.round(top / metrics.cellHeight), 0, rowsPerColumn - 1);
        const newIndex = Math.min(col * rowsPerColumn + row, order.length - 1);

        const currentIndex = order.indexOf(itemKey);
        if (currentIndex === -1) {
            order.push(itemKey);
        } else {
            order.splice(currentIndex, 1);
        }
        order.splice(newIndex, 0, itemKey);
    }

    function finalizeGridDrag(item, left, top, preset, metrics) {
        const key = item.dataset.itemKey;
        if (!key) return;

        const positions = settings.iconPositions.grid || {};

        const containerWidth = desktopContainer ? desktopContainer.clientWidth : window.innerWidth;
        const availableHeight = desktopContainer ? desktopContainer.clientHeight : window.innerHeight;

        const col = Math.max(0, Math.round(left / metrics.cellWidth));
        const rowsPerColumn = Math.max(1, Math.floor(Math.max(availableHeight, preset.itemHeight) / metrics.cellHeight));
        const row = clamp(Math.round(top / metrics.cellHeight), 0, rowsPerColumn - 1);

        let existingKey = null;
        Object.entries(positions).forEach(([candidateKey, pos]) => {
            if (pos.col === col && pos.row === row && candidateKey !== key) {
                existingKey = candidateKey;
            }
        });

        const previousPos = positions[key];
        positions[key] = { col, row };

        if (existingKey) {
            if (previousPos && (typeof previousPos.col === 'number') && (typeof previousPos.row === 'number')) {
                positions[existingKey] = { ...previousPos };
            } else {
                const fallback = findNextFreeGridCell(positions, preset, metrics, containerWidth, availableHeight);
                positions[existingKey] = fallback;
            }
        }

        settings.iconPositions.grid = positions;
    }

    function finalizeFreeDrag(item, left, top, preset) {
        const key = item.dataset.itemKey;
        if (!key) return;

        const boundsWidth = desktopContainer ? desktopContainer.clientWidth : window.innerWidth;
        const boundsHeight = desktopContainer ? desktopContainer.clientHeight : window.innerHeight;

        const maxX = Math.max(0, boundsWidth - preset.itemWidth);
        const maxY = Math.max(0, boundsHeight - preset.itemHeight);

        const clampedLeft = clamp(left, 0, maxX);
        const clampedTop = clamp(top, 0, maxY);

        const freePositions = settings.iconPositions.free || {};
        freePositions[key] = { x: clampedLeft, y: clampedTop };
        settings.iconPositions.free = freePositions;
    }

    function positionItem(item, left, top) {
        item.style.left = `${left}px`;
        item.style.top = `${top}px`;
        item.dataset.left = String(left);
        item.dataset.top = String(top);
    }

    function positionItemImmediate(item, left, top) {
        item.style.left = `${left}px`;
        item.style.top = `${top}px`;
    }

    function layoutIcons(options = {}) {
        if (!gridElement) return;

        const { persist = false } = options;

        const containerWidth = desktopContainer ? desktopContainer.clientWidth : window.innerWidth;
        const containerHeight = desktopContainer ? desktopContainer.clientHeight : window.innerHeight;

        gridElement.classList.toggle('desktop-grid--hidden', !settings.showIcons);

        const items = Array.from(gridElement.querySelectorAll('.desktop-item'));

        if (!settings.showIcons) {
            items.forEach(item => {
                item.style.display = 'none';
            });
            gridElement.style.height = '0px';
            lastLayoutWidth = containerWidth;
            lastLayoutHeight = containerHeight;
            if (persist) {
                saveSettings();
            }
            return;
        }

        items.forEach(item => {
            item.style.display = 'flex';
        });

        pruneLayoutState(items);
        applySizeClass();

        const preset = resolveSizePreset(settings.iconSize);
        const metrics = computeCellMetrics(preset);

        let maxBottom = 0;

        const mode = getLayoutMode();
        switch (mode) {
            case 'arranged':
                maxBottom = layoutArranged(items, preset, metrics, containerWidth, containerHeight);
                break;
            case 'grid':
                maxBottom = layoutGrid(items, preset, metrics, containerWidth, containerHeight);
                break;
            default:
                maxBottom = layoutFree(items, preset, containerWidth, containerHeight);
                break;
        }

        gridElement.style.height = `${maxBottom}px`;
        lastLayoutWidth = containerWidth;
        lastLayoutHeight = containerHeight;

        selectedElements.forEach(updateSelectionHighlight);
        items.forEach(updateItemTooltip);

        if (persist) {
            saveSettings();
        }
    }

    function layoutArranged(items, preset, metrics, containerWidth, containerHeight) {
        const order = syncOrderWithItems(items);
        const availableHeight = Math.max(containerHeight, preset.itemHeight);
        const maxColumns = Math.max(1, Math.floor(containerWidth / metrics.cellWidth));
        const maxRows = Math.max(1, Math.floor(availableHeight / metrics.cellHeight));

        let rowsPerColumn = maxRows;
        let columnsNeeded = Math.ceil(order.length / rowsPerColumn);

        if (columnsNeeded > maxColumns && maxColumns > 0) {
            rowsPerColumn = Math.ceil(order.length / maxColumns);
            if (rowsPerColumn > maxRows) {
                rowsPerColumn = maxRows;
            }
        }

        rowsPerColumn = Math.max(1, rowsPerColumn);

        const maxLeft = Math.max(0, containerWidth - preset.itemWidth);
        const maxTop = Math.max(0, availableHeight - preset.itemHeight);

        let currentColumn = 0;
        let currentRow = 0;
        let maxBottom = 0;

        order.forEach(item => {
            const effectiveCol = Math.min(currentColumn, maxColumns - 1);
            const effectiveRow = Math.min(currentRow, rowsPerColumn - 1);
            const left = effectiveCol * metrics.cellWidth;
            const top = effectiveRow * metrics.cellHeight;

            const clampedLeft = clamp(left, 0, maxLeft);
            const clampedTop = clamp(top, 0, maxTop);

            positionItem(item, clampedLeft, clampedTop);
            item.dataset.gridCol = String(effectiveCol);
            item.dataset.gridRow = String(effectiveRow);

            maxBottom = Math.max(maxBottom, clampedTop + preset.itemHeight + preset.rowGap);

            currentRow += 1;
            if (currentRow >= rowsPerColumn) {
                currentRow = 0;
                currentColumn += 1;
            }
        });

        return Math.max(maxBottom, preset.itemHeight + preset.rowGap);
    }

    function layoutGrid(items, preset, metrics, containerWidth, containerHeight) {
        const originalPositions = settings.iconPositions.grid || {};
        const order = syncOrderWithItems(items);
        const availableHeight = Math.max(containerHeight, preset.itemHeight);
        const maxLeft = Math.max(0, containerWidth - preset.itemWidth);
        const maxTop = Math.max(0, availableHeight - preset.itemHeight);

        const newPositions = {};
        const takenCells = new Set();

        let maxBottom = 0;
        order.forEach(item => {
            const key = item.dataset.itemKey;
            let targetPos = null;
            const existing = originalPositions[key];

            if (existing && typeof existing.col === 'number' && typeof existing.row === 'number') {
                const cellKey = `${existing.col},${existing.row}`;
                const existingLeft = existing.col * metrics.cellWidth;
                const existingTop = existing.row * metrics.cellHeight;
                if (!takenCells.has(cellKey) && existingLeft <= maxLeft && existingTop <= maxTop) {
                    targetPos = { col: existing.col, row: existing.row };
                }
            }

            if (!targetPos) {
                targetPos = findNextFreeGridCell(newPositions, preset, metrics, containerWidth, containerHeight);
            }

            let renderLeft = targetPos.col * metrics.cellWidth;
            let renderTop = targetPos.row * metrics.cellHeight;

            renderLeft = clamp(renderLeft, 0, maxLeft);
            renderTop = clamp(renderTop, 0, maxTop);

            const adjustedPos = {
                col: Math.max(0, Math.round(renderLeft / metrics.cellWidth)),
                row: Math.max(0, Math.round(renderTop / metrics.cellHeight))
            };

            newPositions[key] = adjustedPos;
            takenCells.add(`${adjustedPos.col},${adjustedPos.row}`);

            renderLeft = clamp(adjustedPos.col * metrics.cellWidth, 0, maxLeft);
            renderTop = clamp(adjustedPos.row * metrics.cellHeight, 0, maxTop);

            positionItem(item, renderLeft, renderTop);
            item.dataset.gridCol = String(adjustedPos.col);
            item.dataset.gridRow = String(adjustedPos.row);

            maxBottom = Math.max(maxBottom, renderTop + preset.itemHeight + preset.rowGap);
        });

        settings.iconPositions.grid = newPositions;
        return Math.max(maxBottom, preset.itemHeight + preset.rowGap);
    }

    function layoutFree(items, preset, containerWidth, containerHeight) {
        const positions = settings.iconPositions.free || {};
        const order = syncOrderWithItems(items);

        const availableHeight = Math.max(containerHeight, preset.itemHeight);
        const metrics = computeCellMetrics(preset);
        const rowsPerColumn = Math.max(1, Math.floor(availableHeight / metrics.cellHeight));
        const maxX = Math.max(0, containerWidth - preset.itemWidth);
        const maxY = Math.max(0, availableHeight - preset.itemHeight);

        let maxBottom = 0;
        order.forEach((item, index) => {
            const key = item.dataset.itemKey;
            let pos = positions[key];

            if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') {
                const col = Math.floor(index / rowsPerColumn);
                const row = index % rowsPerColumn;
                pos = {
                    x: col * metrics.cellWidth,
                    y: row * metrics.cellHeight
                };
                positions[key] = pos;
            }

            const clampedX = clamp(pos.x, 0, maxX);
            const clampedY = clamp(pos.y, 0, maxY);
            if (clampedX !== pos.x || clampedY !== pos.y) {
                positions[key] = { x: clampedX, y: clampedY };
            }

            positionItem(item, clampedX, clampedY);
            maxBottom = Math.max(maxBottom, clampedY + preset.itemHeight + preset.rowGap);
        });

        settings.iconPositions.free = positions;
        return Math.max(maxBottom, preset.itemHeight + preset.rowGap);
    }

    function syncOrderWithItems(items) {
        if (!items || !items.length) {
            items = Array.from(gridElement ? gridElement.querySelectorAll('.desktop-item') : []);
        }

        const itemMap = new Map();
        items.forEach(item => {
            itemMap.set(item.dataset.itemKey, item);
        });

        const order = [];
        settings.iconOrder = settings.iconOrder.filter(key => itemMap.has(key));

        settings.iconOrder.forEach(key => {
            const item = itemMap.get(key);
            if (item) {
                order.push(item);
            }
        });

        items.forEach(item => {
            const key = item.dataset.itemKey;
            if (!settings.iconOrder.includes(key)) {
                settings.iconOrder.push(key);
                order.push(item);
            }
        });

        return order;
    }

    function pruneLayoutState(items) {
        const validKeys = new Set(items.map(item => item.dataset.itemKey));

        ['grid', 'free'].forEach(mode => {
            const positions = settings.iconPositions[mode] || {};
            Object.keys(positions).forEach(key => {
                if (!validKeys.has(key)) {
                    delete positions[key];
                }
            });
            settings.iconPositions[mode] = positions;
        });

        settings.iconOrder = settings.iconOrder.filter(key => validKeys.has(key));
    }

    function findNextFreeGridCell(positions, preset, metrics, containerWidth, containerHeight) {
        const taken = new Set();
        Object.values(positions).forEach(pos => {
            if (typeof pos.col === 'number' && typeof pos.row === 'number') {
                taken.add(`${pos.col},${pos.row}`);
            }
        });

        const width = containerWidth || gridElement.clientWidth || (desktopContainer ? desktopContainer.clientWidth : window.innerWidth);
        const height = containerHeight || (desktopContainer ? desktopContainer.clientHeight : window.innerHeight);
        const columns = Math.max(1, Math.floor(width / metrics.cellWidth));
        const rowsPerColumn = Math.max(1, Math.floor(Math.max(height, preset.itemHeight) / metrics.cellHeight));

        for (let col = 0; col < columns + 200; col += 1) {
            for (let row = 0; row < rowsPerColumn; row += 1) {
                const key = `${col},${row}`;
                if (!taken.has(key)) {
                    return { col, row };
                }
            }
        }
        return { col: columns, row: 0 };
    }

    function handleDesktopMouseDown(event) {
        if (!settings.showIcons) {
            return;
        }

        requestWindowDefocus();

        if (event.target.closest('.desktop-item')) {
            return;
        }

        event.preventDefault();

        clearSelection();
        beginDragSelection(event);
    }

    function beginDragSelection(event) {
        if (!desktopContainer) {
            return;
        }

        dragSelectState.active = true;
        dragSelectState.originX = event.clientX;
        dragSelectState.originY = event.clientY;
        dragSelectState.overlay = createSelectionOverlay();

        desktopContainer.appendChild(dragSelectState.overlay);
        document.addEventListener('mousemove', handleDragMouseMove);
        document.addEventListener('mouseup', handleDragMouseUp, { once: true });
        document.body.classList.add('desktop-drag-selecting');
    }

    function handleDragMouseMove(event) {
        if (!dragSelectState.active || !desktopContainer) {
            return;
        }

        const bounds = desktopContainer.getBoundingClientRect();
        const current = clampPointToBounds({ x: event.clientX, y: event.clientY }, bounds);
        const origin = clampPointToBounds({ x: dragSelectState.originX, y: dragSelectState.originY }, bounds);

        updateSelectionOverlay(origin, current, bounds);
        selectItemsInRect(origin, current, bounds);
    }

    function handleDragMouseUp(event) {
        if (event.button !== 0) {
            clearDragSelection();
            return;
        }

        clearDragSelection();
    }

    function createSelectionOverlay() {
        const overlay = document.createElement('div');
        overlay.className = 'desktop-selection-rect';
        overlay.style.left = '0px';
        overlay.style.top = '0px';
        overlay.style.width = '0px';
        overlay.style.height = '0px';
        return overlay;
    }

    function updateSelectionOverlay(origin, current, bounds) {
        if (!dragSelectState.overlay) {
            return;
        }

        const { left, top, width, height } = computeSelectionRect(origin, current, bounds);
        dragSelectState.overlay.style.left = `${left}px`;
        dragSelectState.overlay.style.top = `${top}px`;
        dragSelectState.overlay.style.width = `${width}px`;
        dragSelectState.overlay.style.height = `${height}px`;
    }

    function selectItemsInRect(origin, current, bounds) {
        const rect = computeSelectionRect(origin, current, bounds);

        clearSelection();

        const items = gridElement ? gridElement.querySelectorAll('.desktop-item') : [];
        items.forEach(item => {
            const itemRect = item.getBoundingClientRect();
            const relativeRect = {
                left: itemRect.left - bounds.left,
                top: itemRect.top - bounds.top,
                right: itemRect.right - bounds.left,
                bottom: itemRect.bottom - bounds.top
            };

            if (rectanglesIntersect(rect, relativeRect)) {
                addToSelection(item);
            }
        });
    }

    function computeSelectionRect(origin, current, bounds) {
        const left = Math.min(origin.x, current.x) - bounds.left;
        const top = Math.min(origin.y, current.y) - bounds.top;
        const right = Math.max(origin.x, current.x) - bounds.left;
        const bottom = Math.max(origin.y, current.y) - bounds.top;

        return {
            left,
            top,
            right,
            bottom,
            width: right - left,
            height: bottom - top
        };
    }

    function clampPointToBounds(point, bounds) {
        return {
            x: Math.min(Math.max(point.x, bounds.left), bounds.right),
            y: Math.min(Math.max(point.y, bounds.top), bounds.bottom)
        };
    }

    function rectanglesIntersect(a, b) {
        return a.left < b.right &&
            a.right > b.left &&
            a.top < b.bottom &&
            a.bottom > b.top;
    }

    function clearDragSelection() {
        dragSelectState.active = false;

        if (dragSelectState.overlay && dragSelectState.overlay.parentNode) {
            dragSelectState.overlay.parentNode.removeChild(dragSelectState.overlay);
        }

        dragSelectState.overlay = null;
        document.removeEventListener('mousemove', handleDragMouseMove);
        document.body.classList.remove('desktop-drag-selecting');
    }

    function addToSelection(item) {
        if (!selectedElements.has(item)) {
            selectedElements.add(item);
        }
        item.classList.add('is-selected');
        updateSelectionHighlight(item);
    }

    function removeFromSelection(item) {
        if (selectedElements.has(item)) {
            selectedElements.delete(item);
        }
        item.classList.remove('is-selected', 'is-hovered');
        item.style.removeProperty('--label-extra-height');
        if (hoveredItem === item) {
            hoveredItem = null;
        }
    }

    function selectExclusive(item) {
        clearSelection();
        addToSelection(item);
    }

    function clearSelection() {
        selectedElements.forEach(el => {
            el.classList.remove('is-selected', 'is-hovered');
            el.style.removeProperty('--label-extra-height');
        });
        selectedElements.clear();
        hoveredItem = null;
    }

    function captureSelectionSnapshot() {
        if (!selectedElements.size) {
            return null;
        }

        const paths = [];
        let recycleSelected = false;

        selectedElements.forEach(item => {
            const entry = itemEntryMap.get(item);
            if (!entry) {
                return;
            }

            if (entry.type === 'recycle-bin') {
                recycleSelected = true;
            } else if (entry.path) {
                paths.push(entry.path);
            }
        });

        return { paths, recycleSelected };
    }

    function applySelectionSnapshot(snapshot) {
        if (!snapshot) {
            clearSelection();
            return;
        }

        clearSelection();

        snapshot.paths.forEach(pathValue => {
            const target = entryElementsByPath.get(pathValue);
            if (target) {
                addToSelection(target);
            }
        });

        if (snapshot.recycleSelected && gridElement) {
            const recycleItem = gridElement.querySelector('.desktop-item[data-type="recycle-bin"]');
            if (recycleItem) {
                addToSelection(recycleItem);
            }
        }
    }

    function updateSelectionHighlight(item) {
        if (!item.classList.contains('is-selected')) {
            item.style.removeProperty('--label-extra-height');
            return;
        }

        const labelContainer = item.querySelector('.desktop-item__label-container');
        if (!labelContainer) {
            item.style.removeProperty('--label-extra-height');
            return;
        }

        const truncatedLabel = labelContainer.querySelector('.desktop-item__label--truncated');
        const fullLabel = labelContainer.querySelector('.desktop-item__label--full');

        if (!fullLabel || !truncatedLabel) {
            item.style.removeProperty('--label-extra-height');
            return;
        }

        const truncatedHeight = truncatedLabel.offsetHeight || 0;
        const fullHeight = fullLabel.scrollHeight || 0;
        const extraHeight = Math.max(fullHeight - truncatedHeight, 0);

        item.style.setProperty('--label-extra-height', `${extraHeight}px`);
    }

    function updateItemTooltip(item) {
        if (!item) {
            return;
        }

        const truncatedLabel = item.querySelector('.desktop-item__label--truncated');
        if (!truncatedLabel) {
            item.removeAttribute('title');
            return;
        }

        const text = truncatedLabel.textContent || '';
        if (!text) {
            item.removeAttribute('title');
            return;
        }

        const overflow = truncatedLabel.scrollWidth > (truncatedLabel.clientWidth + 0.5);
        if (overflow) {
            item.setAttribute('title', text);
        } else {
            item.removeAttribute('title');
        }
    }

    function canRenameEntry(entry) {
        return Boolean(entry && entry.path && entry.type !== 'recycle-bin');
    }

    function getSelectionPaths(options = {}) {
        const snapshot = captureSelectionSnapshot();
        if (snapshot && Array.isArray(snapshot.paths) && snapshot.paths.length) {
            return snapshot.paths.slice();
        }

        if (options.fallbackEntry && options.fallbackEntry.path) {
            return [options.fallbackEntry.path];
        }

        return [];
    }

    function resolvePasteTargetDirectory(entry) {
        if (!clipboardData || !Array.isArray(clipboardData.paths) || !clipboardData.paths.length) {
            return null;
        }

        if (entry) {
            if (entry.type === 'recycle-bin') {
                return null;
            }
            if (entry.type === 'folder' && entry.path) {
                return entry.path;
            }
            if (entry.path) {
                return path.dirname(entry.path);
            }
        }

        return desktopPath;
    }

    async function showItemContextMenu(item, entry, pageX, pageY) {
        hideItemContextMenu();

        if (typeof window.closeAllClassicContextMenus === 'function') {
            window.closeAllClassicContextMenus();
        } else {
            if (typeof window.hideDesktopContextMenu === 'function') {
                window.hideDesktopContextMenu();
            }
            if (typeof window.hideTaskbarContextMenu === 'function') {
                window.hideTaskbarContextMenu();
            }
        }

        let menuItems = [];

        if (entry.type === 'recycle-bin') {
            const emptyLabel = process.platform === 'darwin' ? 'Empty Trash' : 'Empty Recycle Bin';
            const recycleBinAvailable = Boolean(RECYCLE_BIN_PATH);

            menuItems = [
                {
                    type: 'action',
                    action: 'empty-recycle-bin',
                    label: emptyLabel,
                    icon: 'mif-bin',
                    disabled: !recycleBinAvailable,
                    handler: async () => {
                        await emptyRecycleBin();
                        await refreshDesktop();
                    }
                }
            ];
        } else {
            const copyTargets = getSelectionPaths({ fallbackEntry: entry });
            const pasteTarget = resolvePasteTargetDirectory(entry);
            const canRename = canRenameEntry(entry);
            const canRecycle = copyTargets.length > 0;
            const canCopy = copyTargets.length > 0;
            const canPaste = Boolean(pasteTarget);
            const recycleLabel = process.platform === 'darwin' ? 'Move to Trash' : 'Move to Recycle Bin';

            menuItems = [
                { type: 'action', action: 'rename', label: 'Rename', icon: 'mif-pencil', disabled: !canRename, handler: () => handleRenameEntry(entry, item) },
                { type: 'action', action: 'recycle', label: recycleLabel, icon: 'mif-bin', disabled: !canRecycle, handler: () => moveSelectionToRecycle(entry) },
                { type: 'separator' },
                { type: 'action', action: 'copy', label: 'Copy', icon: 'mif-copy', disabled: !canCopy, handler: () => handleCopySelection(entry) },
                { type: 'action', action: 'paste', label: 'Paste', icon: 'mif-paste', disabled: !canPaste, handler: () => handlePasteInto(entry) }
            ];
        }

        const menu = document.createElement('div');
        menu.className = 'classic-context-menu desktop-item-context-menu';

        menuItems.forEach(itemConfig => {
            if (itemConfig.type === 'separator') {
                const separator = document.createElement('div');
                separator.className = 'classic-context-menu-separator';
                menu.appendChild(separator);
                return;
            }

            const button = document.createElement('div');
            button.className = 'classic-context-menu-item desktop-item-context-menu-button';
            button.setAttribute('data-action', itemConfig.action);

            if (itemConfig.disabled) {
                button.classList.add('is-disabled');
            }

            const iconWrapper = document.createElement('span');
            iconWrapper.className = 'classic-context-menu-item-icon';

            const iconSpan = document.createElement('span');
            if (itemConfig.icon) {
                iconSpan.className = itemConfig.icon;
            }

            iconWrapper.appendChild(iconSpan);

            const textSpan = document.createElement('span');
            textSpan.className = 'classic-context-menu-item-text';
            textSpan.textContent = itemConfig.label;

            button.appendChild(iconWrapper);
            button.appendChild(textSpan);

            if (!itemConfig.disabled && typeof itemConfig.handler === 'function') {
                button.addEventListener('click', async (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    hideItemContextMenu();
                    try {
                        await itemConfig.handler();
                    } catch (error) {
                        console.error('ExplorerEngine: Context menu action failed.', error);
                    }
                });
            } else {
                button.addEventListener('click', (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                });
            }

            menu.appendChild(button);
        });

        menu.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            event.stopPropagation();
        });

        const desktopRoot = document.getElementById('desktop') || document.body;
        menu.style.position = 'absolute';
        menu.style.left = `${pageX}px`;
        menu.style.top = `${pageY}px`;
        menu.style.zIndex = '1000';
        desktopRoot.appendChild(menu);

        const menuWidth = menu.offsetWidth;
        const menuHeight = menu.offsetHeight;
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;

        if (pageX + menuWidth > windowWidth) {
            menu.style.left = `${Math.max(10, windowWidth - menuWidth - 10)}px`;
        }
        if (pageY + menuHeight > windowHeight) {
            menu.style.top = `${Math.max(10, windowHeight - menuHeight - 10)}px`;
        }

        itemContextMenu = menu;

        setFramePointerEvents(false);
        scheduleContextMenuDismissListeners();
        document.addEventListener('keydown', handleContextMenuKeydown);
        window.addEventListener('blur', handleWindowBlur);
    }

    function scheduleContextMenuDismissListeners() {
        if (contextMenuDismissHandler) {
            document.removeEventListener('mousedown', contextMenuDismissHandler);
            document.removeEventListener('contextmenu', contextMenuDismissHandler);
        }

        contextMenuDismissHandler = (event) => {
            if (!itemContextMenu) {
                return;
            }
            if (itemContextMenu.contains(event.target)) {
                return;
            }
            hideItemContextMenu();
        };

        setTimeout(() => {
            document.addEventListener('mousedown', contextMenuDismissHandler);
            document.addEventListener('contextmenu', contextMenuDismissHandler);
        }, 0);
    }

    function hideItemContextMenu() {
        if (itemContextMenu && itemContextMenu.parentNode) {
            itemContextMenu.parentNode.removeChild(itemContextMenu);
        }

        itemContextMenu = null;

        if (contextMenuDismissHandler) {
            document.removeEventListener('mousedown', contextMenuDismissHandler);
            document.removeEventListener('contextmenu', contextMenuDismissHandler);
            contextMenuDismissHandler = null;
        }

        document.removeEventListener('keydown', handleContextMenuKeydown);
        window.removeEventListener('blur', handleWindowBlur);

        setFramePointerEvents(true);
    }

    function setFramePointerEvents(enabled) {
        const targets = document.querySelectorAll('.classic-window-iframe, .modern-app-iframe, webview');
        const value = enabled ? 'auto' : 'none';
        targets.forEach(node => {
            node.style.pointerEvents = value;
        });
    }

    function handleRenameEntry(entry, item) {
        if (!canRenameEntry(entry)) {
            return;
        }

        const targetItem = item || entryElementsByPath.get(entry.path);
        if (!targetItem) {
            console.warn('ExplorerEngine: Rename target item not found.', entry);
            return;
        }

        beginInlineRename(targetItem, entry);
    }

    function beginInlineRename(item, entry) {
        if (renameState && renameState.commitInProgress) {
            return;
        }

        cancelInlineRename();

        const labelContainer = item.querySelector('.desktop-item__label-container');
        if (!labelContainer) {
            return;
        }
        item.removeAttribute('title');

        const truncatedLabel = labelContainer.querySelector('.desktop-item__label--truncated');
        const fullLabel = labelContainer.querySelector('.desktop-item__label--full');
        const currentName = truncatedLabel ? truncatedLabel.textContent : (entry.name || path.basename(entry.path));

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'desktop-item__rename-input';
        input.value = currentName;
        input.setAttribute('spellcheck', 'false');

        if (truncatedLabel) {
            truncatedLabel.style.display = 'none';
        }
        if (fullLabel) {
            fullLabel.style.display = 'none';
        }

        labelContainer.appendChild(input);

        renameState = {
            item,
            entry,
            input,
            truncatedLabel,
            fullLabel,
            originalName: currentName,
            commitInProgress: false
        };

        input.addEventListener('keydown', handleRenameInputKeydown);
        input.addEventListener('blur', handleRenameInputBlur);

        requestAnimationFrame(() => {
            input.focus();
            input.select();
        });
    }

    function handleRenameInputKeydown(event) {
        if (!renameState) {
            return;
        }

        if (event.key === 'Enter') {
            event.preventDefault();
            commitInlineRename();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            cancelInlineRename();
        }
    }

    function handleRenameInputBlur() {
        if (!renameState || renameState.commitInProgress) {
            return;
        }
        commitInlineRename();
    }

    function cancelInlineRename() {
        if (!renameState || renameState.commitInProgress) {
            return;
        }
        finishInlineRename(renameState.originalName);
    }

    function finishInlineRename(labelText) {
        if (!renameState) {
            return;
        }

        const { input, truncatedLabel, fullLabel, item, originalName } = renameState;
        const resolvedLabel = typeof labelText === 'string' && labelText.length ? labelText : originalName;

        input.removeEventListener('keydown', handleRenameInputKeydown);
        input.removeEventListener('blur', handleRenameInputBlur);

        if (input.parentNode) {
            input.parentNode.removeChild(input);
        }

        if (truncatedLabel) {
            truncatedLabel.style.display = '';
            truncatedLabel.textContent = resolvedLabel;
        }
        if (fullLabel) {
            fullLabel.style.display = '';
            fullLabel.textContent = resolvedLabel;
        }

        updateItemTooltip(item);
        renameState = null;
        updateSelectionHighlight(item);
    }

    async function commitInlineRename() {
        if (!renameState || renameState.commitInProgress) {
            return;
        }

        const { entry, input, originalName } = renameState;

        const proposed = input.value.trim();
        if (!proposed) {
            systemDialog.error('Please enter a name.', 'Rename');
            requestAnimationFrame(() => {
                input.focus();
                input.select();
            });
            return;
        }

        if (!isValidFilename(proposed)) {
            systemDialog.error('The name contains invalid characters.', 'Rename');
            requestAnimationFrame(() => {
                input.focus();
                input.select();
            });
            return;
        }

        if (proposed === originalName) {
            finishInlineRename(originalName);
            return;
        }

        const destinationPath = path.join(path.dirname(entry.path), proposed);
        const normalizedSourcePath = entry.path.toLowerCase();
        const normalizedDestinationPath = destinationPath.toLowerCase();
        const skipExistenceCheck = normalizedSourcePath === normalizedDestinationPath;

        renameState.commitInProgress = true;
        input.disabled = true;

        try {
            if (!skipExistenceCheck) {
                const exists = await pathExists(destinationPath);
                if (exists) {
                    throw Object.assign(new Error('An item with that name already exists.'), { code: 'EEXIST' });
                }
            }

            await fsp.rename(entry.path, destinationPath);

            entry.path = destinationPath;
            entry.name = proposed;

            pendingSelectPath = destinationPath;
        } catch (error) {
            renameState.commitInProgress = false;
            input.disabled = false;

            if (error && error.code === 'EEXIST') {
                systemDialog.error('An item with that name already exists.', 'Rename');
            } else {
                console.error('ExplorerEngine: Failed to rename entry.', error);
                systemDialog.error('Unable to rename this item.', 'Rename');
            }

            requestAnimationFrame(() => {
                input.focus();
                input.select();
            });
            return;
        }

        finishInlineRename(proposed);

        try {
            await refreshDesktop();
        } catch (error) {
            console.error('ExplorerEngine: Refresh failed after rename.', error);
        }
    }

    function isValidFilename(value) {
        if (!value) {
            return false;
        }
        return !/[\\/:*?"<>|]/.test(value);
    }

    async function emptyRecycleBin() {
        const recycleLabel = process.platform === 'darwin' ? 'Trash' : 'Recycle Bin';

        try {
            const result = await ipcRenderer.invoke('trash:empty');

            if (result.success && result.deletedCount === 0) {
                systemDialog.info(`The ${recycleLabel.toLowerCase()} is already empty.`, recycleLabel);
            }
        } catch (error) {
            console.error('ExplorerEngine: Failed to empty recycle bin.', error);

            if (error.message) {
                systemDialog.error(error.message, recycleLabel);
            } else {
                systemDialog.error(`Unable to empty the ${recycleLabel.toLowerCase()}.`, recycleLabel);
            }
            throw error;
        }
    }

    async function moveSelectionToRecycle(entry) {
        const targets = getSelectionPaths({ fallbackEntry: entry });
        if (!targets.length) {
            return;
        }

        try {
            for (const targetPath of targets) {
                await movePathToTrash(targetPath);
            }
        } catch (error) {
            console.error('ExplorerEngine: Failed to move item to recycle bin.', error);
            const recycleLabel = process.platform === 'darwin' ? 'Trash' : 'Recycle Bin';
            systemDialog.error(`Unable to move one or more items to the ${recycleLabel.toLowerCase()}.`, recycleLabel);
        } finally {
            pendingSelectPath = null;
            await refreshDesktop();
        }
    }

    async function movePathToTrash(targetPath) {
        if (!targetPath) {
            throw new Error('No path provided for trash operation.');
        }

        if (typeof shell.trashItem === 'function') {
            await shell.trashItem(targetPath);
            return;
        }

        if (typeof shell.moveItemToTrash === 'function') {
            const result = shell.moveItemToTrash(targetPath);
            if (!result) {
                throw new Error('Electron moveItemToTrash failed.');
            }
            return;
        }

        throw new Error('Trash operation is not supported on this platform.');
    }

    function handleCopySelection(entry) {
        const targets = getSelectionPaths({ fallbackEntry: entry });
        if (!targets.length) {
            return;
        }

        clipboardData = {
            type: 'copy',
            paths: targets.slice(),
            timestamp: Date.now()
        };
    }

    async function handlePasteInto(entry) {
        if (!clipboardData || !Array.isArray(clipboardData.paths) || !clipboardData.paths.length) {
            return;
        }

        const targetDirectory = resolvePasteTargetDirectory(entry);
        if (!targetDirectory) {
            return;
        }

        const createdPaths = [];

        for (const sourcePath of clipboardData.paths) {
            try {
                const createdPath = await copyEntryToDirectory(sourcePath, targetDirectory);
                if (createdPath) {
                    createdPaths.push(createdPath);
                }
            } catch (error) {
                console.error('ExplorerEngine: Failed to paste item.', error);
                systemDialog.error(error && error.message ? error.message : 'Unable to paste item.', 'Paste');
                break;
            }
        }

        if (createdPaths.length) {
            pendingSelectPath = createdPaths[createdPaths.length - 1];
        }

        await refreshDesktop();
    }

    function canPasteToDesktop() {
        return Boolean(resolvePasteTargetDirectory(null));
    }

    async function pasteClipboardToDesktop() {
        await handlePasteInto(null);
    }

    async function copyEntryToDirectory(sourcePath, targetDirectory) {
        if (!sourcePath || !targetDirectory) {
            throw new Error('Invalid copy parameters.');
        }

        const stats = await fsp.stat(sourcePath);
        const baseName = path.basename(sourcePath);
        const destination = await findCopyDestinationName(baseName, targetDirectory);

        const normalizedSource = path.resolve(sourcePath);
        const normalizedDestination = path.resolve(destination.path);

        if (stats.isDirectory() && normalizedDestination.startsWith(`${normalizedSource}${path.sep}`)) {
            throw new Error('You cannot copy a folder into itself.');
        }

        if (stats.isDirectory()) {
            if (typeof fsp.cp === 'function') {
                await fsp.cp(sourcePath, destination.path, { recursive: true, force: false, errorOnExist: true });
            } else {
                await copyDirectoryRecursive(sourcePath, destination.path);
            }
        } else {
            await fsp.copyFile(sourcePath, destination.path);
        }

        return destination.path;
    }

    async function findCopyDestinationName(originalName, targetDirectory) {
        const parsed = path.parse(originalName);
        const baseName = parsed.name;
        const extension = parsed.ext || '';
        const copyBase = `${baseName} - Copy`;

        for (let attempt = 0; attempt < 500; attempt += 1) {
            const suffix = attempt === 0 ? '' : ` (${attempt + 1})`;
            const candidateName = `${copyBase}${suffix}${extension}`;
            const candidatePath = path.join(targetDirectory, candidateName);
            const exists = await pathExists(candidatePath);
            if (!exists) {
                return { name: candidateName, path: candidatePath };
            }
        }

        throw new Error('Unable to create a copy of this item.');
    }

    async function copyDirectoryRecursive(sourceDir, destDir) {
        await fsp.mkdir(destDir, { recursive: true });
        const entries = await fsp.readdir(sourceDir, { withFileTypes: true });

        for (const entry of entries) {
            const sourceEntryPath = path.join(sourceDir, entry.name);
            const destEntryPath = path.join(destDir, entry.name);

            if (entry.isDirectory()) {
                await copyDirectoryRecursive(sourceEntryPath, destEntryPath);
            } else if (entry.isSymbolicLink()) {
                const linkTarget = await fsp.readlink(sourceEntryPath);
                await fsp.symlink(linkTarget, destEntryPath);
            } else {
                await fsp.copyFile(sourceEntryPath, destEntryPath);
            }
        }
    }

    async function createNewFolder() {
        try {
            const name = await findAvailableName('New folder', '');
            const folderPath = path.join(desktopPath, name);
            await fsp.mkdir(folderPath);
            pendingSelectPath = folderPath;
            await refreshDesktop();
            return folderPath;
        } catch (error) {
            console.error('ExplorerEngine: Failed to create folder.', error);
            throw error;
        }
    }

    async function createNewTextDocument() {
        try {
            const name = await findAvailableName('New Text Document', '.txt');
            const filePath = path.join(desktopPath, name);
            await fsp.writeFile(filePath, '');
            pendingSelectPath = filePath;
            await refreshDesktop();
            return filePath;
        } catch (error) {
            console.error('ExplorerEngine: Failed to create text document.', error);
            throw error;
        }
    }

    async function findAvailableName(baseName, extension) {
        let attempt = 0;

        while (attempt < 500) {
            const suffix = attempt === 0 ? '' : ` (${attempt})`;
            const candidate = `${baseName}${suffix}${extension}`;
            const targetPath = path.join(desktopPath, candidate);

            const exists = await pathExists(targetPath);
            if (!exists) {
                return candidate;
            }

            attempt += 1;
        }

        throw new Error('Unable to generate unique name.');
    }

    async function pathExists(targetPath) {
        try {
            await fsp.access(targetPath);
            return true;
        } catch (error) {
            if (error.code === 'ENOENT') {
                return false;
            }
            throw error;
        }
    }

    async function openEntryPath(targetPath, itemType = 'file') {
        // Use the file associations system to determine if file should open internally or externally
        if (window.FileAssociations && typeof window.FileAssociations.openPath === 'function') {
            await window.FileAssociations.openPath(targetPath, itemType);
        } else {
            // Fallback to external opening if file associations not available
            console.warn('ExplorerEngine: File associations not available, opening externally.');
            if (typeof shell.openPath === 'function') {
                const result = await shell.openPath(targetPath);
                if (result) {
                    console.error('ExplorerEngine: Electron failed to open path.', result);
                }
            } else if (typeof shell.showItemInFolder === 'function') {
                shell.showItemInFolder(targetPath);
            } else {
                console.warn('ExplorerEngine: No available method to open path.');
            }
        }
    }

    async function openRecycleBin() {
        if (!RECYCLE_BIN_PATH) {
            console.warn('ExplorerEngine: Recycle bin path unavailable for this platform.');
            return;
        }

        try {
            if (typeof shell.openPath === 'function') {
                const result = await shell.openPath(RECYCLE_BIN_PATH);
                if (result) {
                    console.error('ExplorerEngine: Electron failed to open recycle bin.', result);
                }
            } else if (typeof shell.openExternal === 'function') {
                await shell.openExternal(`file://${RECYCLE_BIN_PATH}`);
            } else {
                console.warn('ExplorerEngine: No available method to open recycle bin.');
            }
        } catch (error) {
            console.error('ExplorerEngine: Error opening recycle bin.', error);
            throw error;
        }
    }

    function isEntryClickable(entry) {
        if (entry.type === 'recycle-bin') {
            return Boolean(RECYCLE_BIN_PATH);
        }
        return Boolean(entry.path);
    }

    function isDisplayableImage(entry) {
        if (entry.type !== 'file' || !entry.extension) {
            return false;
        }
        const ext = entry.extension.toLowerCase();
        const displayableExtensions = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg'];
        return displayableExtensions.includes(ext);
    }

    const AVAILABLE_ICON_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];

    const ICON_SIZE_AVAILABILITY = {
        'recycle_bin/empty': [16, 24, 32, 48, 256],
        'recycle_bin/full': [16, 24, 32, 48, 256],
        'generic_folder': [16, 32, 48],
        'folder_of_folders': [16, 32, 48],
        'image/png': [16, 32, 48],
        'image/jpg': [16, 32, 48],
        'video': [16, 32, 48],
        'music': [16, 32, 48],
        'zip': [16, 32, 48],
        'text_document': [16, 32, 48],
        'rich_text_document': [16, 32, 48],
        'explorer': [16, 32, 48, 64, 128],
        'desktop': [16, 20, 24, 32, 40, 48, 128],
        'this_pc': [16, 24, 32, 48, 64],
        'main_drive': [16, 24, 32, 48, 64, 96, 128],
        'uac': [16, 24, 32, 48, 64]
    };

    function selectBestIconSize(iconCategory, desiredSize) {
        const availableSizes = ICON_SIZE_AVAILABILITY[iconCategory] || [16, 32, 48];

        if (availableSizes.includes(desiredSize)) {
            return desiredSize;
        }

        const largerSizes = availableSizes.filter(size => size >= desiredSize);
        if (largerSizes.length > 0) {
            return Math.min(...largerSizes);
        }

        return Math.max(...availableSizes);
    }

    function getIconPath(entry, desiredSize = 48) {
        const baseIconPath = 'resources/images/icons/explorer/';

        if (entry.type === 'recycle-bin') {
            const state = entry.recycleBinEmpty ? 'empty' : 'full';
            const category = `recycle_bin/${state}`;
            const size = selectBestIconSize(category, desiredSize);
            return `${baseIconPath}${category}/${size}.png`;
        }

        if (entry.type === 'folder') {
            const size = selectBestIconSize('generic_folder', desiredSize);
            return `${baseIconPath}generic_folder/${size}.png`;
        }

        if (entry.type === 'file' && entry.extension) {
            const ext = entry.extension.toLowerCase();

            if (ext === 'png') {
                const size = selectBestIconSize('image/png', desiredSize);
                return `${baseIconPath}image/png/${size}.png`;
            }

            const jpgExtensions = ['jpg', 'jpeg'];
            if (jpgExtensions.includes(ext)) {
                const size = selectBestIconSize('image/jpg', desiredSize);
                return `${baseIconPath}image/jpg/${size}.png`;
            }

            const otherImageExtensions = ['gif', 'bmp', 'svg', 'webp', 'tiff', 'tif', 'ico'];
            if (otherImageExtensions.includes(ext)) {
                const size = selectBestIconSize('image/jpg', desiredSize);
                return `${baseIconPath}image/jpg/${size}.png`;
            }

            const videoExtensions = ['mp4', 'mov', 'avi', 'mkv', 'wmv', 'flv', 'webm', 'm4v'];
            if (videoExtensions.includes(ext)) {
                const size = selectBestIconSize('video', desiredSize);
                return `${baseIconPath}video/${size}.png`;
            }

            const musicExtensions = ['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'wma', 'aiff'];
            if (musicExtensions.includes(ext)) {
                const size = selectBestIconSize('music', desiredSize);
                return `${baseIconPath}music/${size}.png`;
            }

            const zipExtensions = ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'];
            if (zipExtensions.includes(ext)) {
                const size = selectBestIconSize('zip', desiredSize);
                return `${baseIconPath}zip/${size}.png`;
            }

            if (ext === 'txt') {
                const size = selectBestIconSize('text_document', desiredSize);
                return `${baseIconPath}text document/${size}.png`;
            }

            if (ext === 'rtf') {
                const size = selectBestIconSize('rich_text_document', desiredSize);
                return `${baseIconPath}rich text document/${size}.png`;
            }
        }

        return null;
    }

    function resolveIconClass(entry) {
        switch (entry.type) {
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
        if (entry.type === 'folder') {
            return 'DIR';
        }

        if (entry.type === 'recycle-bin') {
            return 'BIN';
        }

        if (!entry.extension) {
            return 'FILE';
        }

        return entry.extension.slice(0, 3).toUpperCase();
    }

    function clamp(value, min, max) {
        if (value < min) return min;
        if (value > max) return max;
        return value;
    }

    function applySizeClass() {
        if (!gridElement) return;
        gridElement.classList.remove('desktop-grid--size-small', 'desktop-grid--size-medium', 'desktop-grid--size-large');
        gridElement.classList.add(`desktop-grid--size-${settings.iconSize}`);
    }

    function setIconSize(sizeKey) {
        if (!SIZE_PRESETS[sizeKey]) {
            return;
        }
        if (settings.iconSize === sizeKey) {
            return;
        }

        settings.iconSize = sizeKey;
        applySizeClass();
        layoutIcons({ persist: true });
    }

    function toggleSnapToGrid(forceValue) {
        const previous = !!settings.snapToGrid;
        const nextValue = typeof forceValue === 'boolean' ? forceValue : !settings.snapToGrid;

        if (previous === nextValue) {
            return;
        }

        if (!nextValue) {
            captureFreePositionsFromDom();
            settings.snapToGrid = false;
            if (settings.arrangeIcons) {
                settings.arrangeIcons = false;
            }
            saveSettings();
        } else {
            settings.snapToGrid = true;
            layoutIcons({ persist: true });
        }
    }

    function toggleArrangeIcons(forceValue) {
        const previous = !!settings.arrangeIcons;
        const nextValue = typeof forceValue === 'boolean' ? forceValue : !settings.arrangeIcons;

        if (previous === nextValue) {
            return;
        }

        if (nextValue) {
            settings.arrangeIcons = true;
            settings.snapToGrid = true;
            layoutIcons({ persist: true });
        } else {
            if (settings.snapToGrid) {
                captureGridPositionsFromDom();
            } else {
                captureFreePositionsFromDom();
            }
            settings.arrangeIcons = false;
            saveSettings();
        }
    }

    function toggleShowIcons(forceValue) {
        const nextValue = typeof forceValue === 'boolean' ? forceValue : !settings.showIcons;
        settings.showIcons = nextValue;
        if (!settings.showIcons) {
            clearSelection();
        }
        layoutIcons({ persist: true });
    }

    function captureFreePositionsFromDom() {
        if (!gridElement) return;

        const items = Array.from(gridElement.querySelectorAll('.desktop-item'));
        syncOrderWithItems(items);

        const positions = {};

        items.forEach(item => {
            const key = item.dataset.itemKey;
            if (!key) return;
            const left = getNumericPosition(item, 'x');
            const top = getNumericPosition(item, 'y');
            positions[key] = { x: left, y: top };
        });

        settings.iconPositions.free = positions;
    }

    function captureGridPositionsFromDom() {
        if (!gridElement) return;

        const items = Array.from(gridElement.querySelectorAll('.desktop-item'));
        syncOrderWithItems(items);

        const preset = resolveSizePreset(settings.iconSize);
        const metrics = computeCellMetrics(preset);
        const positions = {};

        items.forEach(item => {
            const key = item.dataset.itemKey;
            if (!key) return;
            const left = getNumericPosition(item, 'x');
            const top = getNumericPosition(item, 'y');
            const col = Math.max(0, Math.round(left / metrics.cellWidth));
            const row = Math.max(0, Math.round(top / metrics.cellHeight));
            positions[key] = { col, row };
        });

        settings.iconPositions.grid = positions;
    }

    function getNumericPosition(item, axis) {
        const dataKey = axis === 'x' ? 'left' : 'top';
        if (item.dataset && item.dataset[dataKey]) {
            const parsed = parseFloat(item.dataset[dataKey]);
            if (!Number.isNaN(parsed)) {
                return parsed;
            }
        }

        const styleValue = parseFloat(item.style[dataKey]) || 0;
        if (!Number.isNaN(styleValue) && styleValue !== 0) {
            return styleValue;
        }

        if (axis === 'x') {
            return typeof item.offsetLeft === 'number' ? item.offsetLeft : 0;
        }
        return typeof item.offsetTop === 'number' ? item.offsetTop : 0;
    }

    return {
        initializeDesktop,
        refreshDesktop,
        createNewFolder,
        createNewTextDocument,
        openRecycleBin,
        clearSelection,
        setIconSize,
        toggleSnapToGrid,
        toggleArrangeIcons,
        toggleShowIcons,
        pasteClipboardToDesktop,
        canPasteToDesktop,
        closeItemContextMenu: hideItemContextMenu,
        getSettings: getSettingsSnapshot,
        getDesktopPath: () => desktopPath
    };
})();

window.ExplorerEngine = ExplorerEngine;

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ExplorerEngine;
}
