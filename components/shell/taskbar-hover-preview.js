(() => {
    const PREVIEW_CAPTURE_MAX_WIDTH = 420;
    const PREVIEW_SHOW_DELAY_MS = 500;
    const PREVIEW_HIDE_DELAY_MS = 120;
    const PREVIEW_MIN_WIDTH = 248;
    const PREVIEW_VIEWPORT_MARGIN = 24;
    const PREVIEW_SURFACE_WIDTH_BUFFER = 6;
    const PREVIEW_TRACK_PADDING = 10;
    const PREVIEW_CARD_GAP = 10;
    const PREVIEW_CARD_MAX_WIDTH = 230;
    const PREVIEW_CARD_MIN_WIDTH = 112;
    const CLOSE_ICON_PATH = 'resources/images/icons/context menus/taskbar/close/16.png';

    const previewCache = new Map();
    let pendingShowTimer = null;
    let pendingHideTimer = null;
    let pendingPrepareTimer = null;
    let activeAppId = null;
    let activeIconElement = null;
    let renderSequence = 0;

    let electronIpc = null;
    try {
        ({ ipcRenderer: electronIpc } = require('electron'));
    } catch (error) {
        console.debug('[TaskbarHoverPreview] ipcRenderer unavailable:', error.message || error);
    }

    function getLayerElement() {
        return document.getElementById('taskbar-hover-preview-layer');
    }

    function getSurfaceElement() {
        return document.getElementById('taskbar-hover-preview-surface');
    }

    function getTrackElement() {
        return document.getElementById('taskbar-hover-preview-track');
    }

    function getTaskbarElement() {
        return document.querySelector('.taskbar');
    }

    function isVisible() {
        return getLayerElement()?.classList.contains('is-visible') || false;
    }

    function clearHideTimer() {
        if (pendingHideTimer) {
            clearTimeout(pendingHideTimer);
            pendingHideTimer = null;
        }
    }

    function clearShowTimer() {
        if (pendingShowTimer) {
            clearTimeout(pendingShowTimer);
            pendingShowTimer = null;
        }
    }

    function clearPrepareTimer() {
        if (pendingPrepareTimer) {
            clearTimeout(pendingPrepareTimer);
            pendingPrepareTimer = null;
        }
    }

    function scheduleHide(delay = PREVIEW_HIDE_DELAY_MS) {
        clearShowTimer();
        clearHideTimer();
        pendingHideTimer = setTimeout(() => {
            hide({ immediate: true });
        }, delay);
    }

    function cancelHide() {
        clearHideTimer();
    }

    function finalizePreparedState() {
        const layer = getLayerElement();
        if (!layer) {
            return;
        }

        clearPrepareTimer();
        pendingPrepareTimer = setTimeout(() => {
            layer.classList.remove('is-preparing');
            pendingPrepareTimer = null;
        }, 220);
    }

    function scheduleShow(appId, iconElement) {
        clearHideTimer();
        clearShowTimer();

        if (isVisible()) {
            showForTaskbarIcon(appId, iconElement);
            return;
        }

        pendingShowTimer = setTimeout(() => {
            pendingShowTimer = null;
            showForTaskbarIcon(appId, iconElement);
        }, PREVIEW_SHOW_DELAY_MS);
    }

    function canShowPreview() {
        if (!document.body) {
            return false;
        }

        if (document.body.classList.contains('task-view-open') ||
            document.body.classList.contains('snap-assist-open') ||
            document.body.classList.contains('taskbar-dragging') ||
            document.body.classList.contains('taskbar-menu-gesturing')) {
            return false;
        }

        if (window.TaskbarItemContextMenu &&
            typeof window.TaskbarItemContextMenu.isVisible === 'function' &&
            window.TaskbarItemContextMenu.isVisible()) {
            return false;
        }

        return true;
    }

    function getWindowElement(windowData) {
        return windowData?.$container?.[0] || null;
    }

    function getWindowZIndex(windowData) {
        const element = getWindowElement(windowData);
        if (!element) {
            return 0;
        }

        return Number.parseInt(window.getComputedStyle(element).zIndex, 10) || 0;
    }

    function isWindowFocused(windowData) {
        const element = getWindowElement(windowData);
        if (!element) {
            return false;
        }

        return element.classList.contains('active') || windowData.state === 'active';
    }

    function isWindowMinimized(windowData) {
        if (!windowData) {
            return true;
        }

        if (windowData.state === 'minimized') {
            return true;
        }

        const element = getWindowElement(windowData);
        if (!element) {
            return true;
        }

        return window.getComputedStyle(element).display === 'none';
    }

    function isFullscreenModernWindow(windowData) {
        const $container = windowData?.$container;
        return !!$container?.hasClass('modern-app-container') &&
            !$container.hasClass('modern-desktop-app-container');
    }

    function getWindowRect(windowData) {
        const element = getWindowElement(windowData);
        if (!element) {
            return null;
        }

        const rect = element.getBoundingClientRect();
        if (!rect || rect.width < 2 || rect.height < 2) {
            return null;
        }

        return rect;
    }

    function getBoundsKey(rect) {
        return `${Math.round(rect.left)}:${Math.round(rect.top)}:${Math.round(rect.width)}:${Math.round(rect.height)}`;
    }

    function getPreviewAspectRatio(windowData, cachedPreview = null) {
        const rect = getWindowRect(windowData);
        if (rect && rect.width > 0 && rect.height > 0) {
            return `${Math.round(rect.width)} / ${Math.round(rect.height)}`;
        }

        if (cachedPreview && cachedPreview.width > 0 && cachedPreview.height > 0) {
            return `${cachedPreview.width} / ${cachedPreview.height}`;
        }

        return '4 / 3';
    }

    function compareWindowEntries(left, right) {
        const focusedDelta = Number(isWindowFocused(right)) - Number(isWindowFocused(left));
        if (focusedDelta !== 0) {
            return focusedDelta;
        }

        const minimizedDelta = Number(isWindowMinimized(left)) - Number(isWindowMinimized(right));
        if (minimizedDelta !== 0) {
            return minimizedDelta;
        }

        const zIndexDelta = getWindowZIndex(right) - getWindowZIndex(left);
        if (zIndexDelta !== 0) {
            return zIndexDelta;
        }

        return Number(right?.sequence || 0) - Number(left?.sequence || 0);
    }

    function getAppWindowEntries(appId) {
        if (!window.AppsManager || typeof window.AppsManager.getVisibleAppWindows !== 'function') {
            return [];
        }

        return window.AppsManager
            .getVisibleAppWindows(appId)
            .filter((windowData) => {
                if (!windowData || windowData.appId === 'desktop') {
                    return false;
                }

                return windowData.app?.windowOptions?.showInTaskbar !== false;
            })
            .sort(compareWindowEntries);
    }

    function prunePreviewCache() {
        if (!window.AppsManager || typeof window.AppsManager.getRunningWindowsSnapshot !== 'function') {
            previewCache.clear();
            return;
        }

        const liveWindowIds = new Set(
            window.AppsManager
                .getRunningWindowsSnapshot()
                .map((windowData) => windowData?.windowId)
                .filter(Boolean)
        );

        for (const windowId of previewCache.keys()) {
            if (!liveWindowIds.has(windowId)) {
                previewCache.delete(windowId);
            }
        }
    }

    async function captureWindowPreview(windowData) {
        const cachedPreview = previewCache.get(windowData.windowId);
        if (isWindowMinimized(windowData) && cachedPreview?.dataUrl) {
            return cachedPreview;
        }

        if (!electronIpc || typeof electronIpc.invoke !== 'function') {
            return cachedPreview || null;
        }

        const rect = getWindowRect(windowData);
        if (!rect) {
            return cachedPreview || null;
        }

        const boundsKey = getBoundsKey(rect);
        if (cachedPreview && cachedPreview.boundsKey === boundsKey && cachedPreview.dataUrl) {
            return cachedPreview;
        }

        const dataUrl = await electronIpc.invoke('shell:capture-window-preview', {
            x: rect.left,
            y: rect.top,
            width: rect.width,
            height: rect.height,
            maxWidth: PREVIEW_CAPTURE_MAX_WIDTH
        });

        if (!dataUrl) {
            return cachedPreview || null;
        }

        const preview = {
            dataUrl,
            boundsKey,
            width: Math.max(1, Math.round(rect.width)),
            height: Math.max(1, Math.round(rect.height))
        };

        previewCache.set(windowData.windowId, preview);
        return preview;
    }

    async function captureWindowPreviews(entries) {
        for (const windowData of entries) {
            try {
                await captureWindowPreview(windowData);
            } catch (error) {
                console.warn('[TaskbarHoverPreview] Window preview capture failed:', windowData.windowId, error);
            }
        }
    }

    function getWindowDisplayModel(windowData) {
        const app = windowData?.app || {};
        const $container = windowData?.$container;
        const model = {
            title: app.name || windowData?.appId || 'Window',
            iconPath: null,
            iconGlyphClass: app.icon || ''
        };

        if ($container?.length) {
            const titleElement = $container.find('.classic-window-name, .modern-app-name').first();
            const liveTitle = titleElement.text().trim();
            if (liveTitle) {
                model.title = liveTitle;
            }

            const liveIconImage = $container.find('.classic-window-icon img, .modern-app-icon img').first();
            const liveIconPath = liveIconImage.attr('src');
            if (liveIconPath) {
                model.iconPath = liveIconPath;
            } else {
                const liveGlyph = $container.find('.classic-window-icon span, .modern-app-icon span').first();
                const liveGlyphClass = (liveGlyph.attr('class') || '').trim();
                if (liveGlyphClass) {
                    model.iconGlyphClass = liveGlyphClass;
                }
            }
        }

        if (!model.iconPath && window.AppsManager && typeof window.AppsManager.getIconImage === 'function') {
            model.iconPath = window.AppsManager.getIconImage(app, 18);
        }

        if (!model.iconPath && window.AppsManager && typeof window.AppsManager.getAppListLogo === 'function') {
            model.iconPath = window.AppsManager.getAppListLogo(app);
        }

        return model;
    }

    function buildAppIconNode(windowData, large = false) {
        const displayModel = getWindowDisplayModel(windowData);
        const iconContainer = document.createElement('span');
        const plateClass = windowData?.app?.type === 'modern' && windowData?.app?.color
            ? ` app-icon-plate--${windowData.app.color}`
            : '';
        iconContainer.className = `taskbar-hover-preview-card__icon${plateClass}`;

        let iconPath = displayModel.iconPath;
        if (!iconPath && window.AppsManager && typeof window.AppsManager.getIconImage === 'function') {
            iconPath = window.AppsManager.getIconImage(windowData.app || {}, large ? 40 : 18);
        }
        if (!iconPath && window.AppsManager && typeof window.AppsManager.getAppListLogo === 'function') {
            iconPath = window.AppsManager.getAppListLogo(windowData.app || {});
        }

        if (iconPath) {
            const image = document.createElement('img');
            image.src = iconPath;
            image.alt = '';
            iconContainer.appendChild(image);
            return iconContainer;
        }

        if (displayModel.iconGlyphClass) {
            const glyph = document.createElement('span');
            glyph.className = displayModel.iconGlyphClass;
            iconContainer.appendChild(glyph);
        }

        return iconContainer;
    }

    function buildFallbackPreview(windowData) {
        const fallback = document.createElement('div');
        fallback.className = 'taskbar-hover-preview-card__preview-fallback';

        const largeIcon = buildAppIconNode(windowData, true);
        fallback.appendChild(largeIcon);

        const note = document.createElement('div');
        note.className = 'taskbar-hover-preview-card__preview-note';
        note.textContent = isWindowMinimized(windowData)
            ? 'Window minimized'
            : 'Preview unavailable';
        fallback.appendChild(note);

        return fallback;
    }

    function focusWindowFromCard(windowData) {
        if (!windowData) {
            return;
        }

        if (isFullscreenModernWindow(windowData)) {
            if (typeof window.restoreModernApp === 'function') {
                window.restoreModernApp(windowData.appId);
            }
        } else if (isWindowMinimized(windowData)) {
            if (typeof window.restoreClassicWindow === 'function') {
                window.restoreClassicWindow(windowData.windowId);
            }
        } else if (typeof window.focusClassicWindow === 'function') {
            window.focusClassicWindow(windowData.windowId);
        }

        hide({ immediate: true });
    }

    function closeWindowFromCard(windowData) {
        if (!windowData) {
            return;
        }

        if (isFullscreenModernWindow(windowData)) {
            if (typeof window.closeModernApp === 'function') {
                window.closeModernApp(windowData.appId);
            }
            return;
        }

        if (typeof window.closeClassicApp === 'function') {
            window.closeClassicApp(windowData.windowId);
        }
    }

    function createWindowCard(windowData) {
        const displayModel = getWindowDisplayModel(windowData);
        const card = document.createElement('article');
        card.className = 'taskbar-hover-preview-card';
        card.dataset.windowId = windowData.windowId;
        card.dataset.appId = windowData.appId;
        card.tabIndex = 0;

        const header = document.createElement('div');
        header.className = 'taskbar-hover-preview-card__header';
        header.appendChild(buildAppIconNode(windowData));

        const title = document.createElement('div');
        title.className = 'taskbar-hover-preview-card__title';
        title.textContent = displayModel.title;
        header.appendChild(title);
        card.appendChild(header);

        const closeButton = document.createElement('button');
        closeButton.className = 'taskbar-hover-preview-card__close';
        closeButton.type = 'button';
        closeButton.setAttribute('aria-label', `Close ${title.textContent}`);
        closeButton.innerHTML = `<img src="${CLOSE_ICON_PATH}" alt="">`;
        closeButton.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            closeWindowFromCard(windowData);
        });
        card.appendChild(closeButton);

        const preview = document.createElement('div');
        preview.className = 'taskbar-hover-preview-card__preview';
        const cachedPreview = previewCache.get(windowData.windowId);
        preview.style.aspectRatio = getPreviewAspectRatio(windowData, cachedPreview);

        if (cachedPreview?.dataUrl) {
            const image = document.createElement('img');
            image.className = 'taskbar-hover-preview-card__preview-image';
            image.src = cachedPreview.dataUrl;
            image.alt = `${title.textContent} preview`;
            preview.appendChild(image);
        } else {
            preview.appendChild(buildFallbackPreview(windowData));
        }

        card.appendChild(preview);

        card.addEventListener('click', () => {
            focusWindowFromCard(windowData);
        });
        card.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                focusWindowFromCard(windowData);
            }
        });

        return card;
    }

    function renderWindowCards(appId) {
        const track = getTrackElement();
        if (!track) {
            return [];
        }

        const entries = getAppWindowEntries(appId);
        track.replaceChildren();

        const fragment = document.createDocumentFragment();
        entries.forEach((windowData) => {
            fragment.appendChild(createWindowCard(windowData));
        });
        track.appendChild(fragment);

        return entries;
    }

    function getSurfaceLayout(entryCount) {
        const count = Math.max(1, entryCount);
        const totalGap = PREVIEW_CARD_GAP * Math.max(0, count - 1);
        const horizontalPadding = PREVIEW_TRACK_PADDING * 2;
        const maxSurfaceWidth = Math.max(PREVIEW_MIN_WIDTH, window.innerWidth - PREVIEW_VIEWPORT_MARGIN);
        const availableCardSpace = Math.max(
            PREVIEW_CARD_MIN_WIDTH,
            maxSurfaceWidth - horizontalPadding - totalGap - PREVIEW_SURFACE_WIDTH_BUFFER
        );
        const cardWidth = Math.max(
            PREVIEW_CARD_MIN_WIDTH,
            Math.min(PREVIEW_CARD_MAX_WIDTH, Math.floor(availableCardSpace / count))
        );
        const contentWidth = horizontalPadding + totalGap + (cardWidth * count);
        const surfaceWidth = Math.min(
            maxSurfaceWidth,
            Math.max(PREVIEW_MIN_WIDTH, contentWidth + PREVIEW_SURFACE_WIDTH_BUFFER)
        );

        return {
            cardWidth,
            surfaceWidth
        };
    }

    function updateSurfaceWidth(entryCount = 1) {
        const surface = getSurfaceElement();
        if (!surface) {
            return;
        }

        const { cardWidth, surfaceWidth } = getSurfaceLayout(entryCount);
        surface.style.setProperty('--taskbar-hover-preview-card-width', `${cardWidth}px`);
        surface.style.width = `${surfaceWidth}px`;
    }

    function positionLayer(iconElement = activeIconElement) {
        const layer = getLayerElement();
        const taskbar = getTaskbarElement();
        const surface = getSurfaceElement();
        if (!layer || !iconElement || !taskbar) {
            return;
        }

        const iconRect = iconElement.getBoundingClientRect();
        const taskbarRect = taskbar.getBoundingClientRect();

        // Center on icon, but constrain to stay on screen
        let left = iconRect.left + (iconRect.width / 2);
        const surfaceWidth = surface?.offsetWidth || 300;
        const halfSurfaceWidth = surfaceWidth / 2;

        // Ensure preview doesn't go off left edge
        left = Math.max(halfSurfaceWidth, left);
        // Ensure preview doesn't go off right edge
        left = Math.min(window.innerWidth - halfSurfaceWidth, left);

        layer.style.left = `${Math.round(left)}px`;
        layer.style.bottom = `${Math.max(0, Math.round(window.innerHeight - taskbarRect.top + 5))}px`;
    }

    async function showForTaskbarIcon(appId, iconElement) {
        if (!appId || !iconElement || !canShowPreview()) {
            hide({ immediate: true });
            return;
        }

        const entries = getAppWindowEntries(appId);
        if (!entries.length) {
            hide({ immediate: true });
            return;
        }

        if (typeof window.closeAllTaskbarPopupsAndMenus === 'function') {
            window.closeAllTaskbarPopupsAndMenus({ excludeTaskbarHoverPreview: true });
        }

        cancelHide();
        prunePreviewCache();

        const nextRenderSequence = ++renderSequence;
        activeAppId = appId;
        activeIconElement = iconElement;

        const layer = getLayerElement();
        if (!layer) {
            return;
        }

        const shouldAnimateEntrance = !isVisible();
        layer.setAttribute('aria-hidden', 'false');
        layer.classList.remove('is-visible');
        if (shouldAnimateEntrance) {
            layer.classList.add('is-preparing');
        } else {
            layer.classList.remove('is-preparing');
        }
        renderWindowCards(appId);
        updateSurfaceWidth(entries.length);
        positionLayer(iconElement);

        const reveal = () => {
            if (renderSequence !== nextRenderSequence) {
                return;
            }

            layer.classList.add('is-visible');
            if (shouldAnimateEntrance) {
                finalizePreparedState();
            }
        };

        if (shouldAnimateEntrance) {
            requestAnimationFrame(() => {
                if (renderSequence !== nextRenderSequence) {
                    return;
                }

                requestAnimationFrame(reveal);
            });
        } else {
            reveal();
        }

        await captureWindowPreviews(entries);
        if (renderSequence !== nextRenderSequence || activeAppId !== appId) {
            return;
        }

        renderWindowCards(appId);
        updateSurfaceWidth(entries.length);
        positionLayer(iconElement);
    }

    function hide(options = {}) {
        const { immediate = false } = options;

        clearShowTimer();
        clearHideTimer();
        clearPrepareTimer();
        renderSequence += 1;
        activeAppId = null;
        activeIconElement = null;

        const layer = getLayerElement();
        if (!layer) {
            return;
        }

        layer.classList.remove('is-visible');
        layer.classList.remove('is-preparing');
        layer.setAttribute('aria-hidden', 'true');

        if (immediate) {
            return;
        }
    }

    function handleWindowsChanged() {
        prunePreviewCache();

        if (!activeAppId || !isVisible()) {
            return;
        }

        const entries = getAppWindowEntries(activeAppId);
        if (!entries.length) {
            hide({ immediate: true });
            return;
        }

        showForTaskbarIcon(activeAppId, activeIconElement);
    }

    function handleViewportChange() {
        if (!activeAppId || !isVisible()) {
            return;
        }

        updateSurfaceWidth(getAppWindowEntries(activeAppId).length);
        positionLayer(activeIconElement);
    }

    $(document).on('mouseenter', '.taskbar-app', function () {
        if ($(this).attr('data-running') !== 'true') {
            scheduleHide(60);
            return;
        }

        scheduleShow($(this).attr('data-app-id'), this);
    });

    $(document).on('mouseleave', '.taskbar-app', function () {
        scheduleHide();
    });

    $(document).on('mousedown', function (event) {
        if (!$(event.target).closest('#taskbar-hover-preview-layer, .taskbar-app').length) {
            hide({ immediate: true });
        }
    });

    document.addEventListener('win9:running-windows-changed', handleWindowsChanged);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('blur', () => hide({ immediate: true }));
    document.addEventListener('DOMContentLoaded', () => {
        const layer = getLayerElement();
        if (!layer) {
            return;
        }

        layer.addEventListener('mouseenter', cancelHide);
        layer.addEventListener('mouseleave', () => {
            scheduleHide();
        });
    });

    window.TaskbarHoverPreview = {
        showForTaskbarIcon,
        hide,
        scheduleHide,
        cancelHide,
        isVisible
    };
})();
