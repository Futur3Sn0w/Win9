(() => {
    const PREVIEW_CAPTURE_MAX_WIDTH = 540;
    const previewCache = new Map();
    let pendingPreparePromise = null;

    let electronIpc = null;
    try {
        ({ ipcRenderer: electronIpc } = require('electron'));
    } catch (error) {
        console.debug('[TaskView] ipcRenderer unavailable:', error.message || error);
    }

    function getGridElement(target = null) {
        if (target instanceof Element) {
            return target;
        }

        if (typeof target === 'string' && target) {
            return document.getElementById(target) || document.querySelector(target);
        }

        return document.getElementById('task-view-window-grid');
    }

    function isTaskViewOpen() {
        return document.body.classList.contains('task-view-open');
    }

    function getRunningWindowEntries(options = {}) {
        if (!window.AppsManager || typeof window.AppsManager.getRunningWindowsSnapshot !== 'function') {
            return [];
        }

        const excludedWindowIds = new Set(
            (options.excludeWindowIds || [])
                .filter(Boolean)
        );

        // Optional desktop filtering
        const filterDesktopId = options.desktopId !== undefined
            ? options.desktopId
            : (options.allDesktops ? null : (window.VirtualDesktops ? window.VirtualDesktops.getActiveDesktopId() : null));

        return window.AppsManager
            .getRunningWindowsSnapshot()
            .filter((windowData) => {
                if (!windowData || windowData.appId === 'desktop') {
                    return false;
                }

                if (excludedWindowIds.has(windowData.windowId)) {
                    return false;
                }

                if (windowData.$container?.data('backgroundPreload')) {
                    return false;
                }

                // Filter by desktop if VirtualDesktops is active and we have a target desktop
                if (filterDesktopId && window.VirtualDesktops) {
                    const winDesktop = window.VirtualDesktops.getWindowDesktopId(windowData.windowId);
                    if (winDesktop && winDesktop !== filterDesktopId) {
                        return false;
                    }
                }

                return true;
            })
            .sort((left, right) => {
                const focusedDelta = Number(isWindowFocused(right)) - Number(isWindowFocused(left));
                if (focusedDelta !== 0) {
                    return focusedDelta;
                }

                const minimizedDelta = Number(isWindowMinimized(left)) - Number(isWindowMinimized(right));
                if (minimizedDelta !== 0) {
                    return minimizedDelta;
                }

                return getWindowZIndex(right) - getWindowZIndex(left);
            });
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

    async function captureWindowPreview(windowData) {
        if (!electronIpc || typeof electronIpc.invoke !== 'function') {
            return null;
        }

        const rect = getWindowRect(windowData);
        if (!rect) {
            return null;
        }

        const boundsKey = getBoundsKey(rect);
        const cachedPreview = previewCache.get(windowData.windowId);
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
            return null;
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

    async function captureVisibleWindowPreviews(entries) {
        const visibleEntries = entries.filter((windowData) => !isWindowMinimized(windowData));
        for (const windowData of visibleEntries) {
            try {
                await captureWindowPreview(windowData);
            } catch (error) {
                console.warn('[TaskView] Window preview capture failed:', windowData.windowId, error);
            }
        }
    }

    function prunePreviewCache(entries) {
        const liveWindowIds = new Set(entries.map((windowData) => windowData.windowId));
        for (const windowId of previewCache.keys()) {
            if (!liveWindowIds.has(windowId)) {
                previewCache.delete(windowId);
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
        iconContainer.className = `task-view-window-card__icon${plateClass}`;

        let iconPath = displayModel.iconPath;
        if (!iconPath && windowData?.app?.type === 'modern' && window.AppsManager && typeof window.AppsManager.getAppListLogo === 'function') {
            iconPath = window.AppsManager.getAppListLogo(windowData.app || {});
        }
        if (!iconPath && window.AppsManager && typeof window.AppsManager.getIconImage === 'function') {
            iconPath = window.AppsManager.getIconImage(windowData.app || {}, large ? 40 : 18);
        }
        if (!iconPath && large && window.AppsManager && typeof window.AppsManager.getAppListLogo === 'function') {
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
        fallback.className = 'task-view-window-card__preview-fallback';

        const largeIcon = buildAppIconNode(windowData, true);
        fallback.appendChild(largeIcon);

        const note = document.createElement('div');
        note.className = 'task-view-window-card__preview-note';
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

        const isFullscreenModernApp = windowData.$container?.hasClass('modern-app-container');
        const isMinimized = isWindowMinimized(windowData);

        if (isFullscreenModernApp) {
            if (typeof window.restoreModernApp === 'function') {
                window.restoreModernApp(windowData.appId);
            }
        } else if (isMinimized) {
            if (typeof window.restoreClassicWindow === 'function') {
                window.restoreClassicWindow(windowData.windowId);
            }
        } else if (typeof window.focusClassicWindow === 'function') {
            window.focusClassicWindow(windowData.windowId);
        }

        if (typeof window.closeTaskViewPlaceholder === 'function') {
            window.closeTaskViewPlaceholder();
        }
    }

    function closeWindowFromCard(windowData) {
        if (!windowData) {
            return;
        }

        const isFullscreenModernApp = windowData.$container?.hasClass('modern-app-container');
        if (isFullscreenModernApp) {
            if (typeof window.closeModernApp === 'function') {
                window.closeModernApp(windowData.appId);
            }
            return;
        }

        if (typeof window.closeClassicApp === 'function') {
            window.closeClassicApp(windowData.windowId);
        }
    }

    function createWindowCard(windowData, options = {}) {
        const displayModel = getWindowDisplayModel(windowData);
        const card = document.createElement('article');
        card.className = 'task-view-window-card';
        if (options.cardClassName) {
            card.classList.add(options.cardClassName);
        }
        card.dataset.windowId = windowData.windowId;
        card.dataset.appId = windowData.appId;
        card.tabIndex = 0;

        const header = document.createElement('div');
        header.className = 'task-view-window-card__header';
        header.appendChild(buildAppIconNode(windowData));

        const title = document.createElement('div');
        title.className = 'task-view-window-card__title';
        title.textContent = displayModel.title;
        header.appendChild(title);
        card.appendChild(header);

        if (options.allowCloseButton !== false) {
            const closeButton = document.createElement('button');
            closeButton.className = 'task-view-window-card__close';
            closeButton.type = 'button';
            closeButton.setAttribute('aria-label', `Close ${title.textContent}`);
            closeButton.textContent = '\u00d7';
            closeButton.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                closeWindowFromCard(windowData);
            });
            card.appendChild(closeButton);
        }

        const preview = document.createElement('div');
        preview.className = 'task-view-window-card__preview';
        const cachedPreview = previewCache.get(windowData.windowId);
        preview.style.aspectRatio = getPreviewAspectRatio(windowData, cachedPreview);

        if (cachedPreview && cachedPreview.dataUrl) {
            const image = document.createElement('img');
            image.className = 'task-view-window-card__preview-image';
            image.src = cachedPreview.dataUrl;
            image.alt = `${title.textContent} preview`;
            preview.appendChild(image);
        } else {
            preview.appendChild(buildFallbackPreview(windowData));
        }

        card.appendChild(preview);

        const handleSelect = typeof options.onCardSelect === 'function'
            ? options.onCardSelect
            : focusWindowFromCard;

        card.addEventListener('click', () => {
            handleSelect(windowData);
        });
        card.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                handleSelect(windowData);
            }
        });

        return card;
    }

    function renderWindowCards(target = null, options = {}) {
        const grid = getGridElement(target);
        if (!grid) {
            return [];
        }

        const liveEntries = getRunningWindowEntries();
        const entries = Array.isArray(options.entries)
            ? options.entries
            : getRunningWindowEntries(options);
        prunePreviewCache(liveEntries);
        grid.replaceChildren();

        if (entries.length === 0) {
            if (options.emptyMessage !== null && options.emptyMessage !== false) {
                const emptyState = document.createElement('div');
                emptyState.className = 'task-view-window-grid__empty';
                emptyState.textContent = options.emptyMessage || 'No open windows';
                grid.appendChild(emptyState);
            }

            return entries;
        }

        const fragment = document.createDocumentFragment();
        entries.forEach((windowData) => {
            fragment.appendChild(createWindowCard(windowData, options));
        });
        grid.appendChild(fragment);
        return entries;
    }

    async function prepareForOpen(options = {}) {
        if (pendingPreparePromise) {
            return pendingPreparePromise;
        }

        pendingPreparePromise = (async () => {
            const liveEntries = getRunningWindowEntries();
            const entries = Array.isArray(options.entries)
                ? options.entries
                : getRunningWindowEntries(options);
            prunePreviewCache(liveEntries);
            await captureVisibleWindowPreviews(entries);
            renderWindowCards(options.target || null, {
                ...options,
                entries
            });
            return entries;
        })().finally(() => {
            pendingPreparePromise = null;
        });

        return pendingPreparePromise;
    }

    // ── Desktop bar ─────────────────────────────────────────────────
    let desktopHoverTimer = null;
    let hoveredDesktopId = null;
    let newlyAddedDesktopId = null;

    function renderDesktopBar() {
        const container = document.getElementById('task-view-desktop-cards');
        if (!container || !window.VirtualDesktops) return;

        container.replaceChildren();

        const vd = window.VirtualDesktops;
        const allDesktops = vd.getDesktops();

        // Only show cards when there are 2+ desktops
        if (allDesktops.length < 2) return;

        const activeId = vd.getActiveDesktopId();

        allDesktops.forEach((desktop) => {
            const card = document.createElement('div');
            card.className = 'task-view-desktop-card';
            if (desktop.id === activeId) {
                card.classList.add('task-view-desktop-card--active');
            }
            card.dataset.desktopId = desktop.id;

            // Thumbnail: wallpaper + miniature window rectangles
            const thumb = document.createElement('div');
            thumb.className = 'task-view-desktop-card__thumbnail';

            // Use the current wallpaper as background
            const wallpaperEl = document.getElementById('desktop-wallpaper');
            if (wallpaperEl) {
                const wpStyle = window.getComputedStyle(wallpaperEl);
                // Copy the full background shorthand, falling back to individual properties
                if (wpStyle.backgroundImage && wpStyle.backgroundImage !== 'none') {
                    thumb.style.backgroundImage = wpStyle.backgroundImage;
                    thumb.style.backgroundSize = 'cover';
                    thumb.style.backgroundPosition = 'center';
                } else {
                    thumb.style.background = wpStyle.background;
                }
            }

            // Draw mini window rectangles
            const windowsOnDesktop = vd.getWindowsOnDesktop(desktop.id);
            const screenW = window.innerWidth;
            const screenH = window.innerHeight;
            windowsOnDesktop.forEach(windowId => {
                const wd = window.AppsManager && AppsManager.getRunningWindow(windowId);
                if (!wd || !wd.$container) return;
                if (AppsManager.isBackgroundWindow(wd)) return;
                const el = wd.$container[0];
                // Skip minimized/hidden windows for the thumbnail
                if (wd.state === 'minimized') return;
                if (el.style.display === 'none' && !el.classList.contains('vd-hidden')) return;

                const rect = {
                    left: parseInt(el.style.left) || 0,
                    top: parseInt(el.style.top) || 0,
                    width: el.offsetWidth || parseInt(el.style.width) || 200,
                    height: el.offsetHeight || parseInt(el.style.height) || 150
                };
                const miniWin = document.createElement('div');
                miniWin.className = 'task-view-desktop-card__mini-window';
                miniWin.style.left = (rect.left / screenW * 100) + '%';
                miniWin.style.top = (rect.top / screenH * 100) + '%';
                miniWin.style.width = (rect.width / screenW * 100) + '%';
                miniWin.style.height = (rect.height / screenH * 100) + '%';
                thumb.appendChild(miniWin);
            });

            card.appendChild(thumb);

            // Close button (hidden until hover-highlight)
            const closeBtn = document.createElement('button');
            closeBtn.className = 'task-view-desktop-card__close';
            closeBtn.type = 'button';
            closeBtn.setAttribute('aria-label', 'Close ' + desktop.label);
            closeBtn.innerHTML = '<span>\u00d7</span>';
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                clearDesktopHover();
                vd.removeDesktop(desktop.id);
                renderDesktopBar();
                // Re-render window grid for the now-active desktop
                renderWindowCards();
            });
            card.appendChild(closeBtn);

            // Click → switch to desktop
            card.addEventListener('click', () => {
                clearDesktopHover();
                if (desktop.id !== vd.getActiveDesktopId()) {
                    vd.setActiveDesktop(desktop.id);
                }
                if (typeof window.closeTaskViewPlaceholder === 'function') {
                    window.closeTaskViewPlaceholder();
                }
            });

            // Hover → after 2s, highlight and show that desktop's windows
            card.addEventListener('mouseenter', () => {
                clearDesktopHover();
                desktopHoverTimer = setTimeout(() => {
                    hoveredDesktopId = desktop.id;
                    card.classList.add('task-view-desktop-card--highlighted');
                    // Show windows for this desktop
                    renderWindowCards(null, { desktopId: desktop.id });
                }, 2000);
            });
            card.addEventListener('mouseleave', () => {
                clearDesktopHover();
                card.classList.remove('task-view-desktop-card--highlighted');
                // Restore window grid to active desktop
                renderWindowCards();
            });

            // Animate newly added desktop card
            if (desktop.id === newlyAddedDesktopId) {
                card.classList.add('task-view-desktop-card--entering');
                card.addEventListener('animationend', () => {
                    card.classList.remove('task-view-desktop-card--entering');
                }, { once: true });
            }

            container.appendChild(card);
        });

        newlyAddedDesktopId = null;
    }

    function clearDesktopHover() {
        if (desktopHoverTimer) {
            clearTimeout(desktopHoverTimer);
            desktopHoverTimer = null;
        }
        hoveredDesktopId = null;
        // Remove highlighted class from all cards
        const container = document.getElementById('task-view-desktop-cards');
        if (container) {
            container.querySelectorAll('.task-view-desktop-card--highlighted').forEach(el => {
                el.classList.remove('task-view-desktop-card--highlighted');
            });
        }
    }

    function handleAddDesktopClick() {
        if (!window.VirtualDesktops) return;
        newlyAddedDesktopId = window.VirtualDesktops.addDesktop();
        renderDesktopBar();
        renderWindowCards();
    }

    // Wire up the add-desktop button
    document.addEventListener('DOMContentLoaded', () => {
        const addBtn = document.querySelector('.task-view-add-desktop-button');
        if (addBtn) {
            addBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                handleAddDesktopClick();
            });
        }
    });

    function handleOpen() {
        renderDesktopBar();
        renderWindowCards();
    }

    function handleClose() {
        clearDesktopHover();
        // Keep the current preview cache so re-opening Task View is faster.
    }

    function handleWindowsChanged(event) {
        if (!isTaskViewOpen()) {
            return;
        }

        renderWindowCards();
    }

    document.addEventListener('DOMContentLoaded', () => {
        renderWindowCards();
    });
    document.addEventListener('win9:running-windows-changed', handleWindowsChanged);

    window.TaskViewShell = {
        getRunningWindowEntries,
        prepareForOpen,
        handleOpen,
        handleClose,
        renderWindowCards,
        renderDesktopBar
    };
})();
