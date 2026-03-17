// Desktop Background Settings
(function () {
    'use strict';

    const {
        loadDesktopBackgroundSettings,
        saveDesktopBackgroundSettings
    } = require('../../../registry/wallpaper-registry.js');

    function getWallpaperController() {
        const contexts = [window, window.parent, window.top];
        for (const ctx of contexts) {
            try {
                if (ctx && ctx.WallpaperController) {
                    return ctx.WallpaperController;
                }
            } catch (error) {
                console.warn('[DesktopBackground] Could not access wallpaper controller:', error);
            }
        }
        return null;
    }

    function resolveColorRegistry() {
        const contexts = [window, window.parent, window.top];
        for (const ctx of contexts) {
            if (ctx && ctx.ColorRegistry) {
                return ctx.ColorRegistry;
            }
        }

        if (typeof window.require === 'function') {
            try {
        const module = window.require('../../../registry/color-registry.js');
                window.ColorRegistry = module;
                return module;
            } catch (error) {
                console.warn('[DesktopBackground] Could not require color-registry.js:', error);
            }
        }

        return null;
    }

    const ColorRegistry = resolveColorRegistry();

    function isAccentAutomaticMode() {
        if (ColorRegistry && typeof ColorRegistry.isAccentAutomatic === 'function') {
            try {
                return ColorRegistry.isAccentAutomatic();
            } catch (error) {
                console.warn('[DesktopBackground] isAccentAutomatic failed:', error);
            }
        }
        // If accent mode cannot be determined, assume custom to avoid overwriting user choice.
        return false;
    }

    // State management
    let state = {
        currentWallpaper: null,
        currentWallpaperType: 'builtin', // Track whether current wallpaper is 'builtin' or 'custom'
        selectedWallpapers: [],
        selectedWallpapersTypes: [], // Parallel array to track types of selected wallpapers
        picturePosition: 'fill',
        changeInterval: '30m',
        shuffle: false,
        pauseOnBattery: false,
        savedState: null,
        customFolders: [], // Array of {name, path} objects
        currentLocation: 'windows', // Current selected location in dropdown
        currentFolderData: null // Current folder's images and subfolders
    };

    // Wallpaper collections (stored as relative paths from wallpapers folder)
    const wallpaperCollections = {
        'Flowers (7)': [
            'Theme2/img7.jpg',
            'Theme2/img8.jpg',
            'Theme2/img9.jpg',
            'Theme2/img10.jpg',
            'Theme2/img11.jpg',
            'Theme2/img12.jpg'
        ],
        'Lines and colors (6)': [
            'Theme1/img1.jpg',
            'Theme1/img2.jpg',
            'Theme1/img3.jpg',
            'Theme1/img4.jpg',
            'Theme1/img5.jpg',
            'Theme1/img6.jpg',
            'Theme1/img13.jpg'
        ],
        'Windows (1)': [
            'Windows/img0.jpg'
        ]
    };

    // Base path to wallpapers folder from this file's location
    const WALLPAPERS_BASE_PATH = '../../../resources/images/wallpapers/';

    // Helper function to get full path for display (from relative path)
    function getFullPath(relativePath) {
        return WALLPAPERS_BASE_PATH + relativePath;
    }

    // Helper function to get the wallpapers base path for the main app
    function getMainAppWallpapersPath() {
        return 'resources/images/wallpapers/';
    }

    // DOM elements
    let elements = {};

    // Initialize
    function init() {
        // Cache DOM elements
        elements.wallpapersScrollArea = document.getElementById('wallpapers-scroll-area');
        elements.pictureLocation = document.getElementById('picture-location');
        elements.browseButton = document.getElementById('browse-button');
        elements.selectAllButton = document.getElementById('select-all-button');
        elements.clearAllButton = document.getElementById('clear-all-button');
        elements.picturePosition = document.getElementById('picture-position');
        elements.positionPreview = document.getElementById('position-preview');
        elements.changePicture = document.getElementById('change-picture');
        elements.shuffleCheckbox = document.getElementById('shuffle-checkbox');
        elements.batteryPauseCheckbox = document.getElementById('battery-pause-checkbox');
        elements.saveButton = document.getElementById('save-button');
        elements.cancelButton = document.getElementById('cancel-button');

        // Load saved state or defaults
        loadSavedSettings();

        // Save initial state for cancel functionality
        saveCurrentState();

        // Update location dropdown with custom folders
        updateLocationDropdown();

        // Set the dropdown to the current location
        elements.pictureLocation.value = state.currentLocation;

        // Load the current location's content if needed
        if (state.currentLocation === 'pictures') {
            loadPicturesLibrary().then(() => {
                // After loading, restore the selected wallpaper if it exists
                if (state.currentWallpaper) {
                    applyWallpaper(state.currentWallpaper, state.currentWallpaperType);
                }
            }).catch(console.error);
        } else if (state.currentLocation.startsWith('custom-')) {
            const folderIndex = parseInt(state.currentLocation.replace('custom-', ''));
            if (folderIndex >= 0 && folderIndex < state.customFolders.length) {
                const folder = state.customFolders[folderIndex];
                loadCustomFolder(folder.path).then(() => {
                    // After loading, restore the selected wallpaper if it exists
                    if (state.currentWallpaper) {
                        applyWallpaper(state.currentWallpaper, state.currentWallpaperType);
                    }
                }).catch(console.error);
            }
        } else {
            // Render wallpapers for Windows location
            renderWallpapers();
            // Restore the selected wallpaper if it exists
            if (state.currentWallpaper) {
                applyWallpaper(state.currentWallpaper, state.currentWallpaperType);
            }
        }

        // Bind events
        bindEvents();

        // Update UI
        updateUI();

        // Notify parent window that we've loaded (for Control Panel navigation)
        notifyParentPageLoaded();
    }

    // Notify parent Control Panel that the page has loaded
    function notifyParentPageLoaded() {
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({
                action: 'subPageLoaded',
                page: 'desktop-background',
                title: 'Desktop Background'
            }, '*');
        }

        // Pause any running slideshow in the main app
        pauseMainAppSlideshow();
    }

    // Pause slideshow in main app
    function pauseMainAppSlideshow() {
        const controller = getWallpaperController();
        if (controller && typeof controller.pauseSlideshow === 'function') {
            controller.pauseSlideshow();
            return;
        }

        if (window.parent && window.parent !== window && window.parent.pauseWallpaperSlideshow) {
            window.parent.pauseWallpaperSlideshow();
        } else if (window.top && window.top !== window) {
            try {
                if (window.top.pauseWallpaperSlideshow) {
                    window.top.pauseWallpaperSlideshow();
                }
            } catch (e) {
                console.warn('Could not pause slideshow:', e);
            }
        }
    }

    // Resume slideshow in main app
    function resumeMainAppSlideshow() {
        const controller = getWallpaperController();
        if (controller && typeof controller.resumeSlideshow === 'function') {
            controller.resumeSlideshow();
            return;
        }

        if (window.parent && window.parent !== window && window.parent.resumeWallpaperSlideshow) {
            window.parent.resumeWallpaperSlideshow();
        } else if (window.top && window.top !== window) {
            try {
                if (window.top.resumeWallpaperSlideshow) {
                    window.top.resumeWallpaperSlideshow();
                }
            } catch (e) {
                console.warn('Could not resume slideshow:', e);
            }
        }
    }

    // Navigate back to personalization page
    function navigateBack() {
        // Resume slideshow before leaving (if it was paused)
        resumeMainAppSlideshow();

        if (window.parent && window.parent !== window) {
            // We're in an iframe, send message to parent
            window.parent.postMessage({
                action: 'navigateBack'
            }, '*');
        } else {
            // Standalone mode, just navigate
            window.location.href = 'personalization.html';
        }
    }

    // Load saved settings from registry
    function loadSavedSettings() {
        try {
            const controller = getWallpaperController();
            const settings = controller && typeof controller.getSettings === 'function'
                ? controller.getSettings()
                : loadDesktopBackgroundSettings();
            state.currentWallpaper = settings.currentWallpaper || null;
            state.currentWallpaperType = settings.currentWallpaperType || 'builtin';
            state.selectedWallpapers = Array.isArray(settings.selectedWallpapers) ? [...settings.selectedWallpapers] : [];
            state.selectedWallpapersTypes = Array.isArray(settings.selectedWallpapersTypes) ? [...settings.selectedWallpapersTypes] : [];
            state.picturePosition = settings.picturePosition || 'fill';
            state.changeInterval = settings.changeInterval || '30m';
            state.shuffle = !!settings.shuffle;
            state.pauseOnBattery = !!settings.pauseOnBattery;
            state.customFolders = Array.isArray(settings.customFolders)
                ? settings.customFolders.map(folder => ({ ...folder }))
                : [];
            state.currentLocation = settings.currentLocation || 'windows';
        } catch (e) {
            console.error('Failed to load wallpaper settings from registry:', e);
        }
    }

    // Save current state for cancel functionality
    function saveCurrentState() {
        state.savedState = {
            currentWallpaper: state.currentWallpaper,
            currentWallpaperType: state.currentWallpaperType,
            selectedWallpapers: [...state.selectedWallpapers],
            selectedWallpapersTypes: [...state.selectedWallpapersTypes],
            picturePosition: state.picturePosition,
            changeInterval: state.changeInterval,
            shuffle: state.shuffle,
            pauseOnBattery: state.pauseOnBattery,
            customFolders: [...state.customFolders],
            currentLocation: state.currentLocation
        };
    }

    // Render wallpapers in the scroll area
    function renderWallpapers() {
        elements.wallpapersScrollArea.innerHTML = '';

        // Render based on current location
        if (state.currentLocation === 'windows') {
            // Render built-in Windows wallpapers
            Object.keys(wallpaperCollections).forEach(sectionName => {
                const section = createWallpaperSection(sectionName, wallpaperCollections[sectionName], 'builtin');
                elements.wallpapersScrollArea.appendChild(section);
            });
        } else if (state.currentLocation === 'pictures' || state.currentLocation.startsWith('custom-')) {
            // Render custom folder content
            if (state.currentFolderData) {
                renderCustomFolderContent(state.currentFolderData);
            }
        }
    }

    // Create a wallpaper section element
    function createWallpaperSection(sectionName, wallpapers, type = 'builtin') {
        const section = document.createElement('div');
        section.className = 'wallpaper-section';

        const title = document.createElement('h2');
        title.className = 'section-title';
        title.textContent = sectionName;
        title.style.cursor = 'pointer';

        // Toggle section collapse
        title.addEventListener('click', () => {
            section.classList.toggle('collapsed');
        });

        const grid = document.createElement('div');
        grid.className = 'wallpaper-grid';

        wallpapers.forEach(wallpaperPath => {
            const item = createWallpaperItem(wallpaperPath, type);
            grid.appendChild(item);
        });

        section.appendChild(title);
        section.appendChild(grid);
        return section;
    }

    // Render custom folder content with subfolders
    function renderCustomFolderContent(folderData) {
        // If there are images directly in the folder, show them first
        if (folderData.images && folderData.images.length > 0) {
            const section = createCustomImageSection('All Pictures', folderData.images);
            elements.wallpapersScrollArea.appendChild(section);
        }

        // Render each subfolder as a collapsible section
        if (folderData.subfolders && folderData.subfolders.length > 0) {
            folderData.subfolders.forEach(subfolder => {
                const section = createSubfolderSection(subfolder);
                elements.wallpapersScrollArea.appendChild(section);
            });
        }

        // If no images or subfolders found
        if ((!folderData.images || folderData.images.length === 0) &&
            (!folderData.subfolders || folderData.subfolders.length === 0)) {
            const message = document.createElement('p');
            message.className = 'no-images-message';
            message.textContent = 'No images found in this folder.';
            message.style.padding = '20px';
            message.style.textAlign = 'center';
            message.style.color = '#666';
            elements.wallpapersScrollArea.appendChild(message);
        }
    }

    // Create a section for custom images
    function createCustomImageSection(sectionName, images) {
        const section = document.createElement('div');
        section.className = 'wallpaper-section';

        const title = document.createElement('h2');
        title.className = 'section-title';
        title.textContent = `${sectionName} (${images.length})`;
        title.style.cursor = 'pointer';

        title.addEventListener('click', () => {
            section.classList.toggle('collapsed');
        });

        const grid = document.createElement('div');
        grid.className = 'wallpaper-grid';

        images.forEach(image => {
            const item = createWallpaperItem(image.path, 'custom');
            grid.appendChild(item);
        });

        section.appendChild(title);
        section.appendChild(grid);
        return section;
    }

    // Create a subfolder section that loads images on demand
    function createSubfolderSection(subfolder) {
        const section = document.createElement('div');
        section.className = 'wallpaper-section collapsed';
        section.dataset.subfolderPath = subfolder.path;
        section.dataset.loaded = 'false';

        const title = document.createElement('h2');
        title.className = 'section-title';
        title.textContent = subfolder.name;
        title.style.cursor = 'pointer';

        const grid = document.createElement('div');
        grid.className = 'wallpaper-grid';

        // Load subfolder content on first expand
        title.addEventListener('click', async () => {
            section.classList.toggle('collapsed');

            // Load images if not already loaded
            if (section.dataset.loaded === 'false' && !section.classList.contains('collapsed')) {
                await loadSubfolderImages(subfolder.path, grid, title, subfolder.name);
                section.dataset.loaded = 'true';
            }
        });

        section.appendChild(title);
        section.appendChild(grid);
        return section;
    }

    // Load images from a subfolder
    async function loadSubfolderImages(folderPath, gridElement, titleElement, folderName) {
        try {
            if (!require) {
                console.error('Node.js integration not available');
                return;
            }

            const { ipcRenderer } = require('electron');
            const result = await ipcRenderer.invoke('desktop-background-read-folder', folderPath);

            if (result.success && result.images.length > 0) {
                // Update title with count
                titleElement.textContent = `${folderName} (${result.images.length})`;

                // Add images to grid
                result.images.forEach(image => {
                    const item = createWallpaperItem(image.path, 'custom');
                    gridElement.appendChild(item);
                });
            } else {
                titleElement.textContent = `${folderName} (0)`;
                const message = document.createElement('p');
                message.textContent = 'No images in this folder';
                message.style.padding = '10px';
                message.style.color = '#666';
                gridElement.appendChild(message);
            }
        } catch (error) {
            console.error('Failed to load subfolder images:', error);
        }
    }

    // Create a wallpaper item element
    function createWallpaperItem(wallpaperPath, type = 'builtin') {
        const item = document.createElement('div');
        item.className = 'wallpaper-item';
        item.dataset.path = wallpaperPath;
        item.dataset.type = type;

        // Add selected class if this is the current wallpaper
        if (state.currentWallpaper === wallpaperPath) {
            item.classList.add('selected');
        }

        // Checkbox for multi-select
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'wallpaper-checkbox';
        checkbox.checked = state.selectedWallpapers.includes(wallpaperPath);

        checkbox.addEventListener('click', (e) => {
            e.stopPropagation();
            handleWallpaperCheckbox(wallpaperPath, checkbox.checked, type);
        });

        // Thumbnail
        const thumbnail = document.createElement('div');
        thumbnail.className = 'wallpaper-thumbnail';

        const img = document.createElement('img');
        // For custom images, use the full path directly; for builtin, use the relative path
        img.src = type === 'custom' ? wallpaperPath : getFullPath(wallpaperPath);
        img.alt = 'Wallpaper';
        thumbnail.appendChild(img);

        item.appendChild(checkbox);
        item.appendChild(thumbnail);

        // Click handler for selection
        item.addEventListener('click', () => {
            handleWallpaperClick(wallpaperPath, item, type);
        });

        return item;
    }

    // Handle wallpaper click
    function handleWallpaperClick(wallpaperPath, item, type = 'builtin') {
        // Remove selected class from all items
        document.querySelectorAll('.wallpaper-item').forEach(el => {
            el.classList.remove('selected');
        });

        // Add selected class to clicked item
        item.classList.add('selected');

        // Update state - single wallpaper selected
        state.currentWallpaper = wallpaperPath;
        state.currentWallpaperType = type;

        // Clear all checkboxes and update selected list to only include this wallpaper
        document.querySelectorAll('.wallpaper-checkbox').forEach(checkbox => {
            const checkboxItem = checkbox.closest('.wallpaper-item');
            if (checkboxItem.dataset.path === wallpaperPath) {
                checkbox.checked = true;
            } else {
                checkbox.checked = false;
            }
        });

        // Update selected wallpapers list to only include clicked wallpaper
        state.selectedWallpapers = [wallpaperPath];
        state.selectedWallpapersTypes = [type];

        // Stop any running slideshow since we're selecting a single wallpaper
        stopSlideshow();

        // Update slideshow controls (will disable them since only 1 selected)
        updateSlideshowControls();

        // Apply wallpaper immediately (preview)
        applyWallpaper(wallpaperPath, type);
    }

    // Handle checkbox change
    function handleWallpaperCheckbox(wallpaperPath, checked, type = 'builtin') {
        if (checked) {
            if (!state.selectedWallpapers.includes(wallpaperPath)) {
                state.selectedWallpapers.push(wallpaperPath);
                state.selectedWallpapersTypes.push(type);
            }
        } else {
            const index = state.selectedWallpapers.indexOf(wallpaperPath);
            if (index > -1) {
                state.selectedWallpapers.splice(index, 1);
                state.selectedWallpapersTypes.splice(index, 1);
            }
        }

        updateSlideshowControls();
    }

    // Apply wallpaper to desktop
    function applyWallpaper(wallpaperPath, type = 'builtin') {
        const controller = getWallpaperController();
        if (controller && typeof controller.previewWallpaper === 'function') {
            controller.previewWallpaper({
                currentWallpaper: wallpaperPath,
                currentWallpaperType: type,
                picturePosition: state.picturePosition
            }, {
                withCrossfade: false,
                updateTile: true,
                keepSlideshowPaused: true,
                reason: 'control-panel-preview'
            });
            return;
        }

        // For builtin wallpapers, convert to main app's path format
        // For custom wallpapers, use the full path directly
        const mainAppPath = type === 'custom' ? wallpaperPath : (getMainAppWallpapersPath() + wallpaperPath);

        // Check if user has a custom color selected (not automatic)
        // Only extract color from wallpaper if color is set to automatic
        const shouldExtractColor = isAccentAutomaticMode();

        // Try to use the main app's unified function
        if (window.parent && window.parent !== window && window.parent.applyDesktopWallpaper) {
            window.parent.applyDesktopWallpaper(mainAppPath, {
                withCrossfade: false,
                updateTile: true,
                extractColor: shouldExtractColor
            });
            return;
        } else if (window.top && window.top !== window) {
            try {
                if (window.top.applyDesktopWallpaper) {
                    window.top.applyDesktopWallpaper(mainAppPath, {
                        withCrossfade: false,
                        updateTile: true,
                        extractColor: shouldExtractColor
                    });
                    return;
                }
            } catch (e) {
                console.warn('Could not access top window function:', e);
            }
        }

        // Fallback: Try to access the wallpaper element directly
        let wallpaperEl = null;

        // First try: direct access (if running standalone)
        wallpaperEl = document.getElementById('desktop-wallpaper');

        // Second try: access through parent windows (if in iframe)
        if (!wallpaperEl && window.parent && window.parent !== window) {
            try {
                wallpaperEl = window.parent.document.getElementById('desktop-wallpaper');
            } catch (e) {
                console.warn('Could not access parent wallpaper:', e);
            }
        }

        // Third try: access through top window (if nested iframes)
        if (!wallpaperEl && window.top && window.top !== window) {
            try {
                wallpaperEl = window.top.document.getElementById('desktop-wallpaper');
            } catch (e) {
                console.warn('Could not access top window wallpaper:', e);
            }
        }

        if (wallpaperEl) {
            wallpaperEl.style.backgroundImage = `url(${mainAppPath})`;
            updateBackgroundPosition(wallpaperEl);

            // Trigger color extraction for the new wallpaper
            extractWallpaperColor(mainAppPath);
        } else {
            console.warn('Could not find wallpaper element to apply wallpaper');
        }
    }

    // Extract dominant color from wallpaper and update UI
    function extractWallpaperColor(wallpaperPath) {
        // Try to access the WallpaperColorExtractor from the main window
        let colorExtractor = null;

        if (window.WallpaperColorExtractor) {
            colorExtractor = window.WallpaperColorExtractor;
        } else if (window.parent && window.parent !== window && window.parent.WallpaperColorExtractor) {
            colorExtractor = window.parent.WallpaperColorExtractor;
        } else if (window.top && window.top !== window && window.top.WallpaperColorExtractor) {
            try {
                colorExtractor = window.top.WallpaperColorExtractor;
            } catch (e) {
                console.warn('Could not access WallpaperColorExtractor:', e);
            }
        }

        if (colorExtractor) {
            // Extract color and update CSS variable
            colorExtractor.extractDominantColor(wallpaperPath)
                .then(color => {
                    colorExtractor.dominantColor = color;
                    colorExtractor.setCSSVariable(color);
                    colorExtractor.saveCachedColor(wallpaperPath, color);
                    console.log('Wallpaper color extracted and applied:', color);
                })
                .catch(error => {
                    console.error('Failed to extract wallpaper color:', error);
                });
        } else {
            console.warn('WallpaperColorExtractor not available');
        }
    }

    // Update background position based on selected mode
    function updateBackgroundPosition(wallpaperElement) {
        let wallpaperEl = wallpaperElement;

        // If no wallpaper element provided, try to find it
        if (!wallpaperEl) {
            wallpaperEl = document.getElementById('desktop-wallpaper');
            if (!wallpaperEl && window.parent && window.parent !== window) {
                try {
                    wallpaperEl = window.parent.document.getElementById('desktop-wallpaper');
                } catch (e) {
                    console.warn('Could not access parent wallpaper:', e);
                }
            }
            if (!wallpaperEl && window.top && window.top !== window) {
                try {
                    wallpaperEl = window.top.document.getElementById('desktop-wallpaper');
                } catch (e) {
                    console.warn('Could not access top wallpaper:', e);
                }
            }
        }

        if (!wallpaperEl) return;

        const position = state.picturePosition;

        switch (position) {
            case 'fill':
                wallpaperEl.style.backgroundSize = 'cover';
                wallpaperEl.style.backgroundPosition = 'center';
                wallpaperEl.style.backgroundRepeat = 'no-repeat';
                break;
            case 'fit':
                wallpaperEl.style.backgroundSize = 'contain';
                wallpaperEl.style.backgroundPosition = 'center';
                wallpaperEl.style.backgroundRepeat = 'no-repeat';
                break;
            case 'stretch':
                wallpaperEl.style.backgroundSize = '100% 100%';
                wallpaperEl.style.backgroundPosition = 'center';
                wallpaperEl.style.backgroundRepeat = 'no-repeat';
                break;
            case 'tile':
                wallpaperEl.style.backgroundSize = 'auto';
                wallpaperEl.style.backgroundPosition = 'top left';
                wallpaperEl.style.backgroundRepeat = 'repeat';
                break;
            case 'center':
                wallpaperEl.style.backgroundSize = 'auto';
                wallpaperEl.style.backgroundPosition = 'center';
                wallpaperEl.style.backgroundRepeat = 'no-repeat';
                break;
        }
    }

    // Update slideshow controls state
    function updateSlideshowControls() {
        const hasMultipleSelected = state.selectedWallpapers.length > 1;
        elements.changePicture.disabled = !hasMultipleSelected;
        elements.shuffleCheckbox.disabled = !hasMultipleSelected;
        elements.batteryPauseCheckbox.disabled = !hasMultipleSelected;
    }

    // Update UI to reflect current state
    function updateUI() {
        elements.picturePosition.value = state.picturePosition;
        elements.changePicture.value = state.changeInterval;
        elements.shuffleCheckbox.checked = state.shuffle;
        elements.batteryPauseCheckbox.checked = state.pauseOnBattery;

        updateSlideshowControls();
    }

    // Bind event listeners
    function bindEvents() {
        // Select All button
        elements.selectAllButton.addEventListener('click', () => {
            state.selectedWallpapers = [];
            state.selectedWallpapersTypes = [];
            document.querySelectorAll('.wallpaper-checkbox').forEach(checkbox => {
                checkbox.checked = true;
                const item = checkbox.closest('.wallpaper-item');
                const path = item.dataset.path;
                const type = item.dataset.type || 'builtin';
                if (!state.selectedWallpapers.includes(path)) {
                    state.selectedWallpapers.push(path);
                    state.selectedWallpapersTypes.push(type);
                }
            });
            updateSlideshowControls();
        });

        // Clear All button
        elements.clearAllButton.addEventListener('click', () => {
            state.selectedWallpapers = [];
            state.selectedWallpapersTypes = [];
            document.querySelectorAll('.wallpaper-checkbox').forEach(checkbox => {
                checkbox.checked = false;
            });
            updateSlideshowControls();
        });

        // Picture Position dropdown
        elements.picturePosition.addEventListener('change', () => {
            state.picturePosition = elements.picturePosition.value;
            applyWallpaper(state.currentWallpaper, state.currentWallpaperType);
        });

        // Change Picture dropdown
        elements.changePicture.addEventListener('change', () => {
            state.changeInterval = elements.changePicture.value;
        });

        // Shuffle checkbox
        elements.shuffleCheckbox.addEventListener('change', () => {
            state.shuffle = elements.shuffleCheckbox.checked;
        });

        // Battery Pause checkbox
        elements.batteryPauseCheckbox.addEventListener('change', () => {
            state.pauseOnBattery = elements.batteryPauseCheckbox.checked;
        });

        // Save button
        elements.saveButton.addEventListener('click', async () => {
            const saved = await saveSettings();
            if (saved) {
                saveCurrentState();
                navigateBack();
            }
        });

        // Cancel button
        elements.cancelButton.addEventListener('click', () => {
            restoreSavedState();
            // Navigate back to personalization page
            navigateBack();
        });

        // Picture location dropdown
        elements.pictureLocation.addEventListener('change', async () => {
            await handleLocationChange(elements.pictureLocation.value);
        });

        // Browse button - select a folder
        elements.browseButton.addEventListener('click', async () => {
            await handleBrowseFolder();
        });
    }

    // Handle location change in dropdown
    async function handleLocationChange(location) {
        state.currentLocation = location;

        if (location === 'windows') {
            // Show built-in Windows wallpapers
            state.currentFolderData = null;
            renderWallpapers();
        } else if (location === 'pictures') {
            // Load Pictures Library folder
            await loadPicturesLibrary();
        } else if (location.startsWith('custom-')) {
            // Load custom folder
            const folderIndex = parseInt(location.replace('custom-', ''));
            if (folderIndex >= 0 && folderIndex < state.customFolders.length) {
                const folder = state.customFolders[folderIndex];
                await loadCustomFolder(folder.path);
            }
        }
    }

    // Load Pictures Library
    async function loadPicturesLibrary() {
        try {
            if (!require) {
                await systemDialog.error('This feature requires Electron integration.', 'Desktop Background');
                return;
            }

            const { ipcRenderer } = require('electron');
            const result = await ipcRenderer.invoke('desktop-background-get-pictures-folder');

            if (result.success) {
                await loadCustomFolder(result.folderPath);
            } else {
                await systemDialog.error('Failed to access Pictures Library.', 'Desktop Background');
            }
        } catch (error) {
            console.error('Failed to load Pictures Library:', error);
            await systemDialog.error('Failed to load Pictures Library.', 'Desktop Background');
        }
    }

    // Load a custom folder
    async function loadCustomFolder(folderPath) {
        try {
            if (!require) {
                await systemDialog.error('This feature requires Electron integration.', 'Desktop Background');
                return;
            }

            const { ipcRenderer } = require('electron');
            const result = await ipcRenderer.invoke('desktop-background-read-folder', folderPath);

            if (result.success) {
                state.currentFolderData = result;
                renderWallpapers();
            } else {
                await systemDialog.error('Failed to load folder images.', 'Desktop Background');
            }
        } catch (error) {
            console.error('Failed to load custom folder:', error);
            await systemDialog.error('Failed to load folder.', 'Desktop Background');
        }
    }

    // Handle Browse button click
    async function handleBrowseFolder() {
        try {
            if (!require) {
                await systemDialog.error('This feature requires Electron integration.', 'Desktop Background');
                return;
            }

            const { ipcRenderer } = require('electron');
            const result = await ipcRenderer.invoke('desktop-background-select-folder');

            if (!result.canceled && result.folderPath) {
                // Check if folder already exists in custom folders
                const existingIndex = state.customFolders.findIndex(f => f.path === result.folderPath);

                if (existingIndex === -1) {
                    // Add new custom folder
                    state.customFolders.push({
                        name: result.folderName,
                        path: result.folderPath
                    });

                    // Update dropdown
                    updateLocationDropdown();

                    // Select the newly added folder
                    const newIndex = state.customFolders.length - 1;
                    elements.pictureLocation.value = `custom-${newIndex}`;
                    state.currentLocation = `custom-${newIndex}`;
                } else {
                    // Select existing folder
                    elements.pictureLocation.value = `custom-${existingIndex}`;
                    state.currentLocation = `custom-${existingIndex}`;
                }

                // Load the folder
                await loadCustomFolder(result.folderPath);
            }
        } catch (error) {
            console.error('Failed to browse folder:', error);
            await systemDialog.error('Failed to select folder.', 'Desktop Background');
        }
    }

    // Update the location dropdown with custom folders
    function updateLocationDropdown() {
        // Remove all custom folder options
        const options = Array.from(elements.pictureLocation.options);
        options.forEach(option => {
            if (option.value.startsWith('custom-')) {
                option.remove();
            }
        });

        // Add custom folders
        state.customFolders.forEach((folder, index) => {
            const option = document.createElement('option');
            option.value = `custom-${index}`;
            option.textContent = folder.name;
            elements.pictureLocation.appendChild(option);
        });
    }

    // Save settings to registry
    async function saveSettings() {
        const settings = {
            currentWallpaper: state.currentWallpaper,
            currentWallpaperType: state.currentWallpaperType,
            selectedWallpapers: state.selectedWallpapers,
            selectedWallpapersTypes: state.selectedWallpapersTypes,
            picturePosition: state.picturePosition,
            changeInterval: state.changeInterval,
            shuffle: state.shuffle,
            pauseOnBattery: state.pauseOnBattery,
            customFolders: state.customFolders,
            currentLocation: state.currentLocation
        };

        try {
            const controller = getWallpaperController();
            const normalized = controller && typeof controller.saveSettings === 'function'
                ? await controller.saveSettings(settings, {
                    withCrossfade: false,
                    keepSlideshowPaused: true,
                    reason: 'control-panel-save'
                })
                : saveDesktopBackgroundSettings(settings);

            state.currentWallpaper = normalized.currentWallpaper;
            state.currentWallpaperType = normalized.currentWallpaperType;
            state.selectedWallpapers = [...normalized.selectedWallpapers];
            state.selectedWallpapersTypes = [...normalized.selectedWallpapersTypes];
            state.picturePosition = normalized.picturePosition;
            state.changeInterval = normalized.changeInterval;
            state.shuffle = normalized.shuffle;
            state.pauseOnBattery = normalized.pauseOnBattery;
            state.customFolders = normalized.customFolders.map(folder => ({ ...folder }));
            state.currentLocation = normalized.currentLocation;

            // Persist new baseline for cancel functionality
            saveCurrentState();

            // Notify parent window so summary UI updates immediately
            const message = {
                action: 'wallpaperSettingsChanged',
                settings: normalized
            };
            if (window.parent && window.parent !== window) {
                window.parent.postMessage(message, '*');
            } else if (window.top && window.top !== window) {
                try {
                    window.top.postMessage(message, '*');
                } catch (error) {
                    console.warn('Unable to notify parent about wallpaper change:', error);
                }
            }
            return true;
        } catch (e) {
            console.error('Failed to save settings:', e);
            systemDialog.error('Failed to save settings. Please try again.', 'Desktop Background');
            return false;
        }
    }

    // Restore saved state (for cancel functionality)
    function restoreSavedState() {
        if (state.savedState) {
            state.currentWallpaper = state.savedState.currentWallpaper;
            state.currentWallpaperType = state.savedState.currentWallpaperType;
            state.selectedWallpapers = [...state.savedState.selectedWallpapers];
            state.selectedWallpapersTypes = [...state.savedState.selectedWallpapersTypes];
            state.picturePosition = state.savedState.picturePosition;
            state.changeInterval = state.savedState.changeInterval;
            state.shuffle = state.savedState.shuffle;
            state.pauseOnBattery = state.savedState.pauseOnBattery;
            state.customFolders = [...state.savedState.customFolders];
            state.currentLocation = state.savedState.currentLocation;

            // Reapply the previous wallpaper
            if (state.currentWallpaper) {
                const controller = getWallpaperController();
                if (controller && typeof controller.previewWallpaper === 'function') {
                    controller.previewWallpaper({
                        currentWallpaper: state.currentWallpaper,
                        currentWallpaperType: state.currentWallpaperType,
                        selectedWallpapers: state.selectedWallpapers,
                        selectedWallpapersTypes: state.selectedWallpapersTypes,
                        picturePosition: state.picturePosition,
                        changeInterval: state.changeInterval,
                        shuffle: state.shuffle,
                        pauseOnBattery: state.pauseOnBattery
                    }, {
                        withCrossfade: false,
                        updateTile: true,
                        keepSlideshowPaused: true,
                        reason: 'control-panel-restore'
                    });
                } else {
                    applyWallpaper(state.currentWallpaper, state.currentWallpaperType);
                }
            }

            updateUI();
            updateLocationDropdown();
            elements.pictureLocation.value = state.currentLocation;
            renderWallpapers();
        }
    }

    // Stop slideshow (delegates to main app)
    function stopSlideshow() {
        const controller = getWallpaperController();
        if (controller && typeof controller.stopSlideshow === 'function') {
            controller.stopSlideshow();
            return;
        }

        // Stop slideshow in main app
        if (window.parent && window.parent !== window && window.parent.stopWallpaperSlideshow) {
            window.parent.stopWallpaperSlideshow();
        } else if (window.top && window.top !== window) {
            try {
                if (window.top.stopWallpaperSlideshow) {
                    window.top.stopWallpaperSlideshow();
                }
            } catch (e) {
                console.warn('Could not access top window slideshow functions:', e);
            }
        }
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
