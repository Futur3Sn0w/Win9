(function () {
    'use strict';

    const root = document.getElementById('photos-app');
    if (!root) { console.error('[Photos] #photos-app not found'); return; }

    const $ = (sel) => root.querySelector(sel);
    const $$ = (sel) => Array.from(root.querySelectorAll(sel));

    // --- Node.js / Electron ---
    const fs = require('fs');
    const fsPromises = require('fs/promises');
    const pathMod = require('path');
    const { ipcRenderer } = require('electron');

    // --- Constants ---
    const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff', '.tif', '.ico']);
    const STORAGE_KEY = 'photos-app-state-v2';
    const THUMB_SIZE = 120;
    const SLIDESHOW_INTERVAL = 5000;

    // --- State ---
    let state = loadState();
    let allPhotos = [];          // { name, path, dirPath, ext, date, size }
    let filteredPhotos = [];
    let monthGroups = [];        // [{ key, label, photos[] }]
    let albums = [];             // [{ name, coverPath, photos[] }]
    let selectedSet = new Set(); // paths of selected photos
    let isSelectMode = false;
    let currentFilter = 'all';

    // Viewer state
    let viewerPhotos = [];       // flat list currently being viewed
    let viewerIndex = 0;
    let viewerUITimeout = null;

    // Slideshow state
    let slideshowTimer = null;
    let slideshowPaused = false;

    // Editor state
    let editorFilters = { brightness: 0, contrast: 0, highlights: 0, shadows: 0, temperature: 0, tint: 0, saturation: 0, vignette: 0 };
    let editorRotation = 0;

    // --- Elements ---
    const els = {
        splash: $('#photos-splash'),
        nav: $('#photos-nav'),
        hamburger: $('#photos-hamburger'),
        content: $('#photos-content'),
        // Collection
        collectionGrid: $('#photos-collection-grid'),
        collectionEmpty: $('#photos-collection-empty'),
        selectBtn: $('#photos-select-btn'),
        selectBar: $('#photos-select-bar'),
        selectCount: $('#photos-select-count'),
        // Albums
        albumsGrid: $('#photos-albums-grid'),
        albumsEmpty: $('#photos-albums-empty'),
        // Album detail
        albumTitle: $('#photos-album-title'),
        albumCount: $('#photos-album-count'),
        albumDetailGrid: $('#photos-album-detail-grid'),
        albumBack: $('#photos-album-back'),
        // Sources
        sourcesList: $('#photos-sources-list'),
        settingsSources: $('#photos-settings-sources'),
        addFolderBtn: $('#photos-add-folder'),
        // Viewer
        viewer: $('#photos-viewer'),
        viewerImg: $('#photos-viewer-img'),
        viewerImgNext: $('#photos-viewer-img-next'),
        viewerFilename: $('#photos-viewer-filename'),
        viewerPrev: $('#photos-viewer-prev'),
        viewerNext: $('#photos-viewer-next'),
        viewerBack: $('#photos-viewer-back'),
        viewerInfoBtn: $('#photos-viewer-info-btn'),
        viewerProperties: $('#photos-viewer-properties'),
        // Editor
        editor: $('#photos-editor'),
        editorImg: $('#photos-editor-img'),
        // Slideshow
        slideshow: $('#photos-slideshow'),
        slideshowImg: $('#photos-slideshow-img'),
    };

    // =================================================================
    //  INITIALIZATION
    // =================================================================
    initialize();

    async function initialize() {
        attachNavigation();
        attachViewerEvents();
        attachEditorEvents();
        attachSlideshowEvents();
        attachSelectMode();
        attachFilterChips();

        // Default sources: user's Pictures folder
        if (!state.sources || state.sources.length === 0) {
            try {
                const result = await ipcRenderer.invoke('desktop-background-get-pictures-folder');
                if (result.success) {
                    state.sources = [{ name: 'Pictures Library', path: result.folderPath }];
                    saveState();
                }
            } catch (e) {
                console.error('[Photos] Could not resolve Pictures folder:', e);
                state.sources = [];
            }
        }

        await scanAllSources();
        renderSourcesList();
        renderCollection();

        // Dismiss splash
        setTimeout(() => {
            els.splash.classList.add('is-hidden');
        }, 800);
    }

    // =================================================================
    //  STATE PERSISTENCE
    // =================================================================
    function loadState() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            return saved ? JSON.parse(saved) : {};
        } catch (e) { return {}; }
    }

    function saveState() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }

    // =================================================================
    //  NAVIGATION
    // =================================================================
    function attachNavigation() {
        els.hamburger.addEventListener('click', () => {
            els.nav.classList.toggle('is-expanded');
        });

        $$('.photos-nav__item').forEach(btn => {
            btn.addEventListener('click', () => {
                const viewName = btn.dataset.view;
                switchView(viewName);
                // Update active nav
                $$('.photos-nav__item').forEach(b => b.classList.remove('is-active'));
                btn.classList.add('is-active');
                // Collapse nav on small
                els.nav.classList.remove('is-expanded');
            });
        });
    }

    function switchView(viewName) {
        $$('.photos-view').forEach(v => v.classList.remove('is-active'));
        const target = root.querySelector(`.photos-view[data-view="${viewName}"]`);
        if (target) target.classList.add('is-active');

        if (viewName === 'collection') renderCollection();
        if (viewName === 'albums') renderAlbums();
        if (viewName === 'folders') renderSourcesList();
        if (viewName === 'settings') renderSettingsSources();
    }

    // =================================================================
    //  SCANNING PHOTOS
    // =================================================================
    async function scanAllSources() {
        allPhotos = [];
        const sources = state.sources || [];
        for (const source of sources) {
            await scanDirectory(source.path, 3); // recurse up to 3 levels
        }

        // Sort by date descending (newest first)
        allPhotos.sort((a, b) => b.date - a.date);
        applyFilter(currentFilter);
    }

    async function scanDirectory(dirPath, depth) {
        if (depth < 0) return;
        try {
            const entries = await fsPromises.readdir(dirPath, { withFileTypes: true });
            const statPromises = [];

            for (const entry of entries) {
                const fullPath = pathMod.join(dirPath, entry.name);
                if (entry.isDirectory() && !entry.name.startsWith('.')) {
                    await scanDirectory(fullPath, depth - 1);
                } else if (entry.isFile()) {
                    const ext = pathMod.extname(entry.name).toLowerCase();
                    if (IMAGE_EXTENSIONS.has(ext)) {
                        statPromises.push(
                            fsPromises.stat(fullPath).then(stat => {
                                allPhotos.push({
                                    name: entry.name,
                                    path: fullPath,
                                    dirPath: dirPath,
                                    ext: ext,
                                    date: stat.mtime.getTime(),
                                    size: stat.size,
                                    birthtime: stat.birthtime.getTime()
                                });
                            }).catch(() => { /* skip inaccessible files */ })
                        );
                    }
                }
            }
            await Promise.all(statPromises);
        } catch (e) {
            console.warn('[Photos] Could not scan:', dirPath, e.message);
        }
    }

    // =================================================================
    //  TIME FILTERING
    // =================================================================
    function attachFilterChips() {
        $$('.photos-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                $$('.photos-chip').forEach(c => c.classList.remove('is-active'));
                chip.classList.add('is-active');
                currentFilter = chip.dataset.filter;
                applyFilter(currentFilter);
                renderCollection();
            });
        });
    }

    function applyFilter(filter) {
        const now = Date.now();
        const WEEK = 7 * 24 * 3600 * 1000;
        const MONTH = 30 * 24 * 3600 * 1000;
        const YEAR = 365 * 24 * 3600 * 1000;

        switch (filter) {
            case 'lastweek':
                filteredPhotos = allPhotos.filter(p => now - p.date < WEEK); break;
            case 'lastmonth':
                filteredPhotos = allPhotos.filter(p => now - p.date < MONTH); break;
            case 'lastyear':
                filteredPhotos = allPhotos.filter(p => now - p.date < YEAR); break;
            default:
                filteredPhotos = [...allPhotos]; break;
        }

        // Build month groups
        buildMonthGroups();
        // Build auto-albums from top-level directories
        buildAlbums();
    }

    function buildMonthGroups() {
        const groupMap = new Map();
        for (const photo of filteredPhotos) {
            const d = new Date(photo.date);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            const label = d.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
            if (!groupMap.has(key)) {
                groupMap.set(key, { key, label, photos: [] });
            }
            groupMap.get(key).photos.push(photo);
        }
        monthGroups = Array.from(groupMap.values());
    }

    function buildAlbums() {
        // Auto-generate albums from distinct parent folders
        const folderMap = new Map();
        for (const photo of allPhotos) {
            const dirName = pathMod.basename(photo.dirPath);
            if (!folderMap.has(photo.dirPath)) {
                folderMap.set(photo.dirPath, { name: dirName, coverPath: photo.path, photos: [] });
            }
            folderMap.get(photo.dirPath).photos.push(photo);
        }
        albums = Array.from(folderMap.values()).filter(a => a.photos.length > 0);
        albums.sort((a, b) => b.photos.length - a.photos.length);
    }

    // =================================================================
    //  RENDER: COLLECTION
    // =================================================================
    function renderCollection() {
        const grid = els.collectionGrid;
        grid.innerHTML = '';

        if (filteredPhotos.length === 0) {
            els.collectionEmpty.hidden = false;
            return;
        }
        els.collectionEmpty.hidden = true;

        for (const group of monthGroups) {
            const groupEl = document.createElement('div');
            groupEl.className = 'photos-month-group';

            // Month header
            const header = document.createElement('div');
            header.className = 'photos-month-header';
            header.innerHTML = `
                <h2 class="photos-month-header__title">${group.label}</h2>
                <span class="photos-month-header__count">${group.photos.length} ${group.photos.length === 1 ? 'item' : 'items'}</span>
                <button class="photos-month-header__select-all" type="button">Select all</button>
            `;
            header.querySelector('.photos-month-header__select-all').addEventListener('click', () => {
                group.photos.forEach(p => selectedSet.add(p.path));
                updateSelectUI();
                renderCollection();
            });
            groupEl.appendChild(header);

            // Subgroup by day within the month
            const dayMap = new Map();
            for (const photo of group.photos) {
                const d = new Date(photo.date);
                const dayKey = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
                if (!dayMap.has(dayKey)) dayMap.set(dayKey, []);
                dayMap.get(dayKey).push(photo);
            }

            for (const [dayLabel, dayPhotos] of dayMap) {
                // Day subgroup header
                const subHeader = document.createElement('div');
                subHeader.className = 'photos-subgroup-header';
                subHeader.innerHTML = `<span class="photos-subgroup-header__date">${dayLabel}</span>`;
                groupEl.appendChild(subHeader);

                // Photo row
                const row = document.createElement('div');
                row.className = 'photos-photo-row';
                for (const photo of dayPhotos) {
                    row.appendChild(createThumb(photo, filteredPhotos));
                }
                groupEl.appendChild(row);
            }

            grid.appendChild(groupEl);
        }
    }

    function createThumb(photo, contextList) {
        const thumb = document.createElement('div');
        thumb.className = 'photos-thumb';
        if (selectedSet.has(photo.path)) thumb.classList.add('is-selected');

        const img = document.createElement('img');
        img.className = 'photos-thumb__img';
        img.alt = photo.name;
        img.draggable = false;
        img.dataset.loaded = 'false';
        img.loading = 'lazy';

        // Use file:// protocol for local images
        img.src = fileURL(photo.path);
        img.onload = () => { img.dataset.loaded = 'true'; };
        img.onerror = () => { img.style.display = 'none'; };

        const check = document.createElement('div');
        check.className = 'photos-thumb__check';

        thumb.appendChild(img);
        thumb.appendChild(check);

        thumb.addEventListener('click', (e) => {
            if (isSelectMode) {
                toggleSelect(photo.path, thumb);
            } else {
                openViewer(photo, contextList);
            }
        });

        return thumb;
    }

    function fileURL(filePath) {
        // Convert Windows path to file:// URL
        return 'file:///' + filePath.replace(/\\/g, '/').replace(/ /g, '%20');
    }

    // =================================================================
    //  RENDER: ALBUMS
    // =================================================================
    function renderAlbums() {
        const grid = els.albumsGrid;
        grid.innerHTML = '';

        if (albums.length === 0) {
            els.albumsEmpty.hidden = false;
            return;
        }
        els.albumsEmpty.hidden = true;

        for (const album of albums) {
            const card = document.createElement('div');
            card.className = 'photos-album-card';
            card.innerHTML = `
                <div class="photos-album-card__cover">
                    <img class="photos-album-card__cover-img" src="${fileURL(album.coverPath)}" alt="${album.name}" draggable="false">
                </div>
                <div class="photos-album-card__info">
                    <span class="photos-album-card__name">${album.name}</span>
                    <span class="photos-album-card__count">${album.photos.length} ${album.photos.length === 1 ? 'item' : 'items'}</span>
                </div>
            `;
            card.addEventListener('click', () => openAlbumDetail(album));
            grid.appendChild(card);
        }
    }

    function openAlbumDetail(album) {
        els.albumTitle.textContent = album.name;
        els.albumCount.textContent = `${album.photos.length} ${album.photos.length === 1 ? 'item' : 'items'}`;

        const grid = els.albumDetailGrid;
        grid.innerHTML = '';

        const row = document.createElement('div');
        row.className = 'photos-photo-row';
        for (const photo of album.photos) {
            row.appendChild(createThumb(photo, album.photos));
        }
        grid.appendChild(row);

        switchView('album-detail');
    }

    // =================================================================
    //  RENDER: SOURCES
    // =================================================================
    function renderSourcesList() {
        renderSourcesInto(els.sourcesList);
    }

    function renderSettingsSources() {
        renderSourcesInto(els.settingsSources);
    }

    function renderSourcesInto(container) {
        if (!container) return;
        container.innerHTML = '';
        const sources = state.sources || [];

        for (const source of sources) {
            const item = document.createElement('div');
            item.className = 'photos-source-item';
            item.innerHTML = `
                <i class="phi photos-source-item__icon" style="font-size:20px">&#xE7AC;</i>
                <div class="photos-source-item__info">
                    <div class="photos-source-item__name">${source.name}</div>
                    <div class="photos-source-item__path">${source.path}</div>
                </div>
                <button class="photos-source-item__remove" type="button" aria-label="Remove source">
                    <i class="phi phi--sm">&#xE711;</i>
                </button>
            `;
            item.querySelector('.photos-source-item__remove').addEventListener('click', (e) => {
                e.stopPropagation();
                state.sources = state.sources.filter(s => s.path !== source.path);
                saveState();
                renderSourcesList();
                renderSettingsSources();
                // Re-scan
                scanAllSources().then(() => { renderCollection(); renderAlbums(); });
            });
            container.appendChild(item);
        }
    }

    // Add folder button
    if (els.addFolderBtn) {
        els.addFolderBtn.addEventListener('click', async () => {
            try {
                const { canceled, filePaths } = await ipcRenderer.invoke('photos-select-folder')
                    .catch(() => ({ canceled: true, filePaths: [] }));

                // desktop-background-select-folder might not exist; fallback to dialog
                if (!canceled && filePaths && filePaths.length > 0) {
                    const folderPath = filePaths[0];
                    const folderName = pathMod.basename(folderPath);
                    if (!state.sources) state.sources = [];
                    if (!state.sources.some(s => s.path === folderPath)) {
                        state.sources.push({ name: folderName, path: folderPath });
                        saveState();
                        renderSourcesList();
                        renderSettingsSources();
                        await scanAllSources();
                        renderCollection();
                        renderAlbums();
                    }
                }
            } catch (e) {
                console.error('[Photos] Add folder failed:', e);
            }
        });
    }

    // Album back button
    if (els.albumBack) {
        els.albumBack.addEventListener('click', () => {
            switchView('albums');
            // Restore albums nav active
            $$('.photos-nav__item').forEach(b => {
                b.classList.toggle('is-active', b.dataset.view === 'albums');
            });
        });
    }

    // =================================================================
    //  SELECT MODE
    // =================================================================
    function attachSelectMode() {
        els.selectBtn.addEventListener('click', () => {
            isSelectMode = !isSelectMode;
            root.classList.toggle('is-select-mode', isSelectMode);
            els.selectBar.hidden = !isSelectMode;
            els.selectBtn.textContent = isSelectMode ? 'Cancel' : 'Select';
            if (!isSelectMode) {
                selectedSet.clear();
                updateSelectUI();
                // Remove selected class from all thumbs
                $$('.photos-thumb.is-selected').forEach(t => t.classList.remove('is-selected'));
            }
        });

        $('#photos-select-cancel').addEventListener('click', () => {
            isSelectMode = false;
            root.classList.remove('is-select-mode');
            els.selectBar.hidden = true;
            els.selectBtn.textContent = 'Select';
            selectedSet.clear();
            updateSelectUI();
            $$('.photos-thumb.is-selected').forEach(t => t.classList.remove('is-selected'));
        });

        $('#photos-select-delete').addEventListener('click', () => {
            if (selectedSet.size === 0) return;
            const count = selectedSet.size;
            const msg = count === 1 ? 'This photo will be deleted.' : `These ${count} photos will be deleted.`;
            if (confirm(msg)) {
                // Just deselect for now (real deletion would use shell.moveItemToTrash)
                selectedSet.clear();
                updateSelectUI();
            }
        });
    }

    function toggleSelect(photoPath, thumbEl) {
        if (selectedSet.has(photoPath)) {
            selectedSet.delete(photoPath);
            thumbEl.classList.remove('is-selected');
        } else {
            selectedSet.add(photoPath);
            thumbEl.classList.add('is-selected');
        }
        updateSelectUI();
    }

    function updateSelectUI() {
        const count = selectedSet.size;
        if (count === 0) {
            els.selectCount.textContent = 'No item selected';
        } else if (count === 1) {
            els.selectCount.textContent = '1 item selected';
        } else {
            els.selectCount.textContent = `${count} items selected`;
        }
    }

    // =================================================================
    //  VIEWER
    // =================================================================
    function attachViewerEvents() {
        els.viewerBack.addEventListener('click', closeViewer);
        els.viewerPrev.addEventListener('click', () => navigateViewer(-1));
        els.viewerNext.addEventListener('click', () => navigateViewer(1));

        // Keyboard
        document.addEventListener('keydown', (e) => {
            if (els.viewer.hidden) return;
            if (e.key === 'Escape') closeViewer();
            if (e.key === 'ArrowLeft') navigateViewer(-1);
            if (e.key === 'ArrowRight') navigateViewer(1);
        });

        // Toggle UI on tap (only if not swiping)
        const stage = $('.photos-viewer__stage');
        stage.addEventListener('click', (e) => {
            if (swipe.didSwipe) return;
            if (e.target.closest('.photos-viewer__arrow')) return;
            els.viewer.classList.toggle('ui-hidden');
        });

        // Auto-hide UI
        els.viewer.addEventListener('mousemove', () => {
            els.viewer.classList.remove('ui-hidden');
            clearTimeout(viewerUITimeout);
            viewerUITimeout = setTimeout(() => {
                if (!els.viewer.hidden) els.viewer.classList.add('ui-hidden');
            }, 4000);
        });

        // Properties panel
        els.viewerInfoBtn.addEventListener('click', () => {
            els.viewerProperties.hidden = !els.viewerProperties.hidden;
        });

        // App bar buttons
        $('#photos-viewer-edit').addEventListener('click', openEditor);
        $('#photos-viewer-slideshow').addEventListener('click', openSlideshow);
        $('#photos-viewer-rotate').addEventListener('click', () => {
            editorRotation = (editorRotation + 90) % 360;
            els.viewerImg.style.transform = `rotate(${editorRotation}deg)`;
        });

        // --- Gesture-driven swipe ---
        attachSwipeGesture(stage);
    }

    // Swipe state
    const swipe = { active: false, startX: 0, currentX: 0, startTime: 0, didSwipe: false, pointerId: null };

    function attachSwipeGesture(stage) {
        const nextImg = $('#photos-viewer-img-next');

        stage.addEventListener('pointerdown', (e) => {
            // Only primary button / single touch; ignore if on a button
            if (e.button !== 0) return;
            if (e.target.closest('button')) return;
            if (viewerPhotos.length <= 1) return;

            swipe.active = true;
            swipe.didSwipe = false;
            swipe.startX = e.clientX;
            swipe.currentX = e.clientX;
            swipe.startTime = Date.now();
            swipe.pointerId = e.pointerId;

            stage.setPointerCapture(e.pointerId);
            stage.classList.add('is-swiping');
            stage.classList.remove('is-settling');

            // Reset neighbour image
            nextImg.dataset.path = '';
            nextImg.src = '';
            nextImg.classList.remove('is-visible');
        });

        stage.addEventListener('pointermove', (e) => {
            if (!swipe.active || e.pointerId !== swipe.pointerId) return;
            swipe.currentX = e.clientX;
            const dx = swipe.currentX - swipe.startX;
            const absDx = Math.abs(dx);

            // After a comfortable threshold, consider it a swipe (not a tap)
            if (absDx > 15) swipe.didSwipe = true;

            const stageW = stage.offsetWidth;

            // Move current image
            els.viewerImg.style.transform = `translateX(${dx}px)`;

            // Determine which neighbour to show
            if (absDx > 10) {
                const dir = dx < 0 ? 1 : -1; // swipe left = next (+1), swipe right = prev (-1)
                const neighbourIdx = (viewerIndex + dir + viewerPhotos.length) % viewerPhotos.length;
                const neighbourPhoto = viewerPhotos[neighbourIdx];
                const neighbourUrl = fileURL(neighbourPhoto.path);

                if (nextImg.dataset.path !== neighbourPhoto.path) {
                    nextImg.dataset.path = neighbourPhoto.path;
                    nextImg.src = neighbourUrl;
                }
                nextImg.classList.add('is-visible');

                // Position incoming image: slides in from the edge
                const incoming = dx < 0
                    ? stageW + dx   // from right: starts at stageW, moves left
                    : -stageW + dx; // from left: starts at -stageW, moves right
                nextImg.style.transform = `translateX(${incoming}px)`;
            } else {
                nextImg.classList.remove('is-visible');
            }
        });

        const endSwipe = (e) => {
            if (!swipe.active || e.pointerId !== swipe.pointerId) return;
            swipe.active = false;

            const dx = swipe.currentX - swipe.startX;
            const absDx = Math.abs(dx);
            const stageW = stage.offsetWidth;
            const threshold = stageW * 0.15; // 15% of stage width to commit

            stage.classList.remove('is-swiping');
            stage.classList.add('is-settling');

            if (absDx > threshold && viewerPhotos.length > 1) {
                // Commit navigation: animate out current + in next
                const dir = dx < 0 ? 1 : -1;
                const exitX = dx < 0 ? -stageW : stageW;

                els.viewerImg.style.transform = `translateX(${exitX}px)`;
                nextImg.style.transform = 'translateX(0)';

                // After settle animation, swap to the new image
                const onSettle = () => {
                    stage.classList.remove('is-settling');
                    viewerIndex = (viewerIndex + dir + viewerPhotos.length) % viewerPhotos.length;
                    editorRotation = 0;
                    els.viewerImg.style.transform = '';
                    nextImg.classList.remove('is-visible');
                    nextImg.style.transform = '';
                    updateViewerImage();
                    els.viewerImg.removeEventListener('transitionend', onSettle);
                };
                els.viewerImg.addEventListener('transitionend', onSettle);

                // Safety timeout in case transitionend doesn't fire
                setTimeout(() => {
                    if (stage.classList.contains('is-settling')) onSettle();
                }, 300);
            } else {
                // Snap back
                els.viewerImg.style.transform = '';
                nextImg.style.transform = '';
                nextImg.classList.remove('is-visible');

                const onSnap = () => {
                    stage.classList.remove('is-settling');
                    els.viewerImg.removeEventListener('transitionend', onSnap);
                };
                els.viewerImg.addEventListener('transitionend', onSnap);
                setTimeout(() => {
                    if (stage.classList.contains('is-settling')) onSnap();
                }, 300);
            }
        };

        stage.addEventListener('pointerup', endSwipe);
        stage.addEventListener('pointercancel', endSwipe);
    }

    function openViewer(photo, contextList) {
        viewerPhotos = contextList || filteredPhotos;
        viewerIndex = viewerPhotos.findIndex(p => p.path === photo.path);
        if (viewerIndex < 0) viewerIndex = 0;
        editorRotation = 0;

        els.viewer.hidden = false;
        els.viewer.classList.remove('ui-hidden');
        updateViewerImage();
    }

    function closeViewer() {
        els.viewer.hidden = true;
        els.viewerProperties.hidden = true;
        els.viewerImg.style.transform = '';
        els.viewerImgNext.style.transform = '';
        els.viewerImgNext.classList.remove('is-visible');
        editorRotation = 0;
    }

    function navigateViewer(delta) {
        viewerIndex = (viewerIndex + delta + viewerPhotos.length) % viewerPhotos.length;
        editorRotation = 0;
        els.viewerImg.style.transform = '';
        updateViewerImage();
    }

    function updateViewerImage() {
        const photo = viewerPhotos[viewerIndex];
        if (!photo) return;

        els.viewerImg.src = fileURL(photo.path);
        els.viewerFilename.textContent = photo.name;

        // Update properties
        const d = new Date(photo.date);
        setTextContent('#photos-prop-filename', photo.name);
        setTextContent('#photos-prop-date', d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }));
        setTextContent('#photos-prop-time', d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }));
        setTextContent('#photos-prop-filetype', photo.ext.replace('.', '').toUpperCase());
        setTextContent('#photos-prop-size', formatFileSize(photo.size));
        setTextContent('#photos-prop-source', 'Local');

        // Resolution (async via Image object)
        const tempImg = new Image();
        tempImg.onload = () => {
            setTextContent('#photos-prop-resolution', `${tempImg.naturalWidth} × ${tempImg.naturalHeight} px`);
        };
        tempImg.src = fileURL(photo.path);

        // Show/hide arrows
        els.viewerPrev.style.visibility = viewerPhotos.length > 1 ? 'visible' : 'hidden';
        els.viewerNext.style.visibility = viewerPhotos.length > 1 ? 'visible' : 'hidden';
    }

    function setTextContent(selector, text) {
        const el = $(selector);
        if (el) el.textContent = text;
    }

    function formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    // =================================================================
    //  SLIDESHOW
    // =================================================================
    function attachSlideshowEvents() {
        $('#photos-slideshow-exit').addEventListener('click', closeSlideshow);
        $('#photos-slideshow-prev').addEventListener('click', () => slideshowNav(-1));
        $('#photos-slideshow-next').addEventListener('click', () => slideshowNav(1));
        $('#photos-slideshow-pause').addEventListener('click', toggleSlideshowPause);

        document.addEventListener('keydown', (e) => {
            if (els.slideshow.hidden) return;
            if (e.key === 'Escape') closeSlideshow();
        });
    }

    function openSlideshow() {
        if (viewerPhotos.length === 0) return;
        els.slideshow.hidden = false;
        slideshowPaused = false;
        updateSlideshowImage();
        slideshowTimer = setInterval(() => {
            if (!slideshowPaused) slideshowNav(1);
        }, SLIDESHOW_INTERVAL);
    }

    function closeSlideshow() {
        els.slideshow.hidden = true;
        clearInterval(slideshowTimer);
        slideshowTimer = null;
    }

    function slideshowNav(delta) {
        viewerIndex = (viewerIndex + delta + viewerPhotos.length) % viewerPhotos.length;
        updateSlideshowImage();
    }

    function updateSlideshowImage() {
        const photo = viewerPhotos[viewerIndex];
        if (photo) {
            els.slideshowImg.src = fileURL(photo.path);
        }
    }

    function toggleSlideshowPause() {
        slideshowPaused = !slideshowPaused;
        const btn = $('#photos-slideshow-pause');
        if (slideshowPaused) {
            btn.innerHTML = '<i class="phi phi--xl">&#xE768;</i>';
            btn.setAttribute('aria-label', 'Play');
        } else {
            btn.innerHTML = '<i class="phi phi--xl">&#xE769;</i>';
            btn.setAttribute('aria-label', 'Pause');
        }
    }

    // =================================================================
    //  EDITOR
    // =================================================================
    function attachEditorEvents() {
        // Category tabs
        $$('.photos-editor__category').forEach(cat => {
            cat.addEventListener('click', () => {
                $$('.photos-editor__category').forEach(c => c.classList.remove('is-active'));
                cat.classList.add('is-active');
                const toolsId = cat.dataset.editCategory;
                $$('.photos-editor__tools').forEach(t => t.hidden = true);
                const target = root.querySelector(`.photos-editor__tools[data-edit-tools="${toolsId}"]`);
                if (target) target.hidden = false;
            });
        });

        // Sliders
        $$('.photos-editor__slider').forEach(slider => {
            slider.addEventListener('input', () => {
                const filterName = slider.dataset.filter;
                const value = parseInt(slider.value, 10);
                editorFilters[filterName] = value;
                // Update value display
                const valueSpan = slider.nextElementSibling;
                if (valueSpan) valueSpan.textContent = value;
                applyEditorFilters();
            });
        });

        // Tool buttons
        $$('.photos-editor__tool-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const action = btn.dataset.action;
                handleEditorAction(action);
            });
        });

        // Top bar
        $('#photos-edit-cancel').addEventListener('click', closeEditor);
        $('#photos-edit-compare').addEventListener('click', () => {
            // Toggle compare — show original
            const img = els.editorImg;
            if (img.style.filter) {
                img.dataset.savedFilter = img.style.filter;
                img.style.filter = 'none';
            } else {
                img.style.filter = img.dataset.savedFilter || '';
            }
        });
    }

    function openEditor() {
        const photo = viewerPhotos[viewerIndex];
        if (!photo) return;

        // Reset filters
        editorFilters = { brightness: 0, contrast: 0, highlights: 0, shadows: 0, temperature: 0, tint: 0, saturation: 0, vignette: 0 };
        $$('.photos-editor__slider').forEach(s => {
            s.value = 0;
            const valSpan = s.nextElementSibling;
            if (valSpan) valSpan.textContent = '0';
        });

        els.editorImg.src = fileURL(photo.path);
        els.editorImg.style.filter = '';
        els.editorImg.style.transform = '';
        els.editor.hidden = false;

        // Show basic fixes first
        $$('.photos-editor__category').forEach(c => c.classList.toggle('is-active', c.dataset.editCategory === 'basic'));
        $$('.photos-editor__tools').forEach(t => t.hidden = t.dataset.editTools !== 'basic');
    }

    function closeEditor() {
        els.editor.hidden = true;
        els.editorImg.style.filter = '';
    }

    function applyEditorFilters() {
        const f = editorFilters;
        const filters = [];

        // Brightness: CSS brightness() 0-2, centered at 1
        filters.push(`brightness(${1 + f.brightness / 100})`);
        // Contrast
        filters.push(`contrast(${1 + f.contrast / 100})`);
        // Saturation
        filters.push(`saturate(${1 + f.saturation / 100})`);
        // Temperature → sepia + hue-rotate approximation
        if (f.temperature > 0) {
            filters.push(`sepia(${f.temperature / 200})`);
        } else if (f.temperature < 0) {
            filters.push(`hue-rotate(${f.temperature * 0.5}deg)`);
        }
        // Highlights → approximate with brightness overlay
        if (f.highlights !== 0) {
            filters.push(`brightness(${1 + f.highlights / 250})`);
        }
        // Shadows — approximate with contrast
        if (f.shadows !== 0) {
            filters.push(`contrast(${1 + f.shadows / 250})`);
        }
        // Tint — hue-rotate
        if (f.tint !== 0) {
            filters.push(`hue-rotate(${f.tint * 0.3}deg)`);
        }

        els.editorImg.style.filter = filters.join(' ');
    }

    function handleEditorAction(action) {
        switch (action) {
            case 'enhance':
                // Auto-enhance: bump brightness/contrast/saturation slightly
                editorFilters.brightness = 8;
                editorFilters.contrast = 12;
                editorFilters.saturation = 15;
                updateSliderUI();
                applyEditorFilters();
                break;
            case 'rotate':
                editorRotation = (editorRotation + 90) % 360;
                els.editorImg.style.transform = `rotate(${editorRotation}deg)`;
                break;
            case 'crop':
                const cropOverlay = $('#photos-crop-overlay');
                cropOverlay.hidden = !cropOverlay.hidden;
                break;
            default:
                break;
        }
    }

    function updateSliderUI() {
        for (const [key, val] of Object.entries(editorFilters)) {
            const slider = root.querySelector(`.photos-editor__slider[data-filter="${key}"]`);
            if (slider) {
                slider.value = val;
                const valSpan = slider.nextElementSibling;
                if (valSpan) valSpan.textContent = val;
            }
        }
    }

    // =================================================================
    //  INITIAL RENDER
    // =================================================================
    renderCollection();

})();
