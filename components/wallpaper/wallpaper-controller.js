const {
  loadDesktopBackgroundSettings,
  saveDesktopBackgroundSettings,
  normalizeSettings,
  toFullWallpaperPath,
  toRelativeWallpaperPath,
  intervalStringToMs
} = require('../../registry/wallpaper-registry.js');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createWallpaperController(options = {}) {
  const {
    getWallpaperElement = () => document.getElementById('desktop-wallpaper'),
    toAssetUrl = value => value,
    setDesktopTileImage = () => {},
    shouldExtractColor = () => false,
    onStateChanged = null
  } = options;

  let state = normalizeSettings(loadDesktopBackgroundSettings());
  let wallpaperSlideshowInterval = null;
  let wallpaperSlideshowEntries = [];
  let wallpaperSlideshowIndex = 0;
  let wallpaperSlideshowPaused = false;
  let currentAppliedWallpaperPath = toFullWallpaperPath(state.currentWallpaper, state.currentWallpaperType);

  function getWallpaperElementSafe() {
    try {
      return getWallpaperElement();
    } catch (error) {
      console.warn('[WallpaperController] Failed to resolve wallpaper element:', error);
      return null;
    }
  }

  function applyPosition(position = state.picturePosition, wallpaperEl = getWallpaperElementSafe()) {
    if (!wallpaperEl) {
      return;
    }

    switch (position) {
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
      case 'fill':
      default:
        wallpaperEl.style.backgroundSize = 'cover';
        wallpaperEl.style.backgroundPosition = 'center';
        wallpaperEl.style.backgroundRepeat = 'no-repeat';
        break;
    }
  }

  function getCurrentFullPath(settings = state) {
    return toFullWallpaperPath(settings.currentWallpaper, settings.currentWallpaperType);
  }

  function getSelectionEntries(settings = state) {
    const selectedWallpapers = Array.isArray(settings.selectedWallpapers) ? settings.selectedWallpapers : [];
    const selectedWallpapersTypes = Array.isArray(settings.selectedWallpapersTypes) ? settings.selectedWallpapersTypes : [];

    return selectedWallpapers.map((wallpaper, index) => {
      const type = selectedWallpapersTypes[index] === 'custom' ? 'custom' : 'builtin';
      const normalizedPath = type === 'custom'
        ? wallpaper
        : (toRelativeWallpaperPath(wallpaper) || wallpaper);
      const fullPath = toFullWallpaperPath(normalizedPath, type);

      if (!normalizedPath || !fullPath) {
        return null;
      }

      return {
        path: normalizedPath,
        type,
        fullPath,
        key: `${type}:${normalizedPath}`
      };
    }).filter(Boolean);
  }

  function getResolvedState() {
    const settings = clone(state);
    return {
      settings,
      currentWallpaperPath: currentAppliedWallpaperPath || getCurrentFullPath(settings),
      slideshowActive: !!wallpaperSlideshowInterval,
      slideshowPaused: wallpaperSlideshowPaused
    };
  }

  function notify(reason, extra = {}) {
    const detail = {
      ...getResolvedState(),
      reason,
      ...extra
    };

    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
      window.dispatchEvent(new CustomEvent('win8-wallpaper-state-changed', { detail }));
    }

    if (typeof onStateChanged === 'function') {
      onStateChanged(detail);
    }
  }

  function updateDesktopTile(path) {
    try {
      setDesktopTileImage(path);
    } catch (error) {
      console.warn('[WallpaperController] Failed to update desktop tile image:', error);
    }
  }

  function extractWallpaperColor(path, extractColor) {
    if (!extractColor || !window.WallpaperColorExtractor) {
      return;
    }

    window.WallpaperColorExtractor.extractDominantColor(path)
      .then(color => {
        window.WallpaperColorExtractor.dominantColor = color;
        window.WallpaperColorExtractor.setCSSVariable(color);
        window.WallpaperColorExtractor.saveCachedColor(path, color);
      })
      .catch(error => {
        console.error('[WallpaperController] Failed to extract wallpaper color:', error);
      });
  }

  function applyWallpaperPath(path, options = {}) {
    const {
      withCrossfade = false,
      updateTile = true,
      extractColor = shouldExtractColor(),
      position = state.picturePosition
    } = options;

    const wallpaperEl = getWallpaperElementSafe();
    if (!wallpaperEl || !path) {
      return Promise.resolve(path);
    }

    applyPosition(position, wallpaperEl);

    const formattedPath = toAssetUrl(path);
    currentAppliedWallpaperPath = path;

    return new Promise(resolve => {
      const finalize = () => {
        wallpaperEl.style.backgroundImage = `url("${formattedPath}")`;
        if (updateTile) {
          updateDesktopTile(path);
        }
        extractWallpaperColor(path, extractColor);
        resolve(path);
      };

      const img = new Image();
      img.onload = () => {
        if (!withCrossfade) {
          finalize();
          return;
        }

        const tempWallpaper = document.createElement('div');
        tempWallpaper.style.position = 'fixed';
        tempWallpaper.style.top = '0';
        tempWallpaper.style.left = '0';
        tempWallpaper.style.width = '100%';
        tempWallpaper.style.height = '100%';
        tempWallpaper.style.backgroundImage = `url("${formattedPath}")`;
        tempWallpaper.style.backgroundSize = wallpaperEl.style.backgroundSize || window.getComputedStyle(wallpaperEl).backgroundSize || 'cover';
        tempWallpaper.style.backgroundPosition = wallpaperEl.style.backgroundPosition || window.getComputedStyle(wallpaperEl).backgroundPosition || 'center';
        tempWallpaper.style.backgroundRepeat = wallpaperEl.style.backgroundRepeat || window.getComputedStyle(wallpaperEl).backgroundRepeat || 'no-repeat';
        tempWallpaper.style.zIndex = '598';
        tempWallpaper.style.opacity = '0';
        tempWallpaper.style.transition = 'opacity 1s ease-in-out';
        tempWallpaper.style.pointerEvents = 'none';
        document.body.appendChild(tempWallpaper);

        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            tempWallpaper.style.opacity = '1';
          });
        });

        setTimeout(() => {
          finalize();
          if (tempWallpaper.parentNode) {
            tempWallpaper.parentNode.removeChild(tempWallpaper);
          }
        }, 1050);
      };

      img.onerror = error => {
        console.error('[WallpaperController] Failed to preload wallpaper image:', formattedPath, error);
        finalize();
      };

      img.src = formattedPath;
    });
  }

  function stopSlideshow(options = {}) {
    const { clearPaused = true } = options;

    if (wallpaperSlideshowInterval) {
      clearInterval(wallpaperSlideshowInterval);
      wallpaperSlideshowInterval = null;
    }

    wallpaperSlideshowEntries = [];
    wallpaperSlideshowIndex = 0;

    if (clearPaused) {
      wallpaperSlideshowPaused = false;
    }
  }

  async function canAdvanceSlideshow() {
    if (!state.pauseOnBattery || typeof navigator === 'undefined' || typeof navigator.getBattery !== 'function') {
      return true;
    }

    try {
      const battery = await navigator.getBattery();
      return !!battery.charging;
    } catch (error) {
      console.warn('[WallpaperController] Failed to read battery state for slideshow:', error);
      return true;
    }
  }

  function getShuffledEntries(entries) {
    const shuffled = [...entries];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  function rebuildSlideshowEntries(settings = state) {
    const entries = getSelectionEntries(settings);
    if (entries.length <= 1) {
      return [];
    }
    return settings.shuffle ? getShuffledEntries(entries) : entries;
  }

  async function advanceSlideshow(options = {}) {
    const {
      withCrossfade = true,
      reason = 'slideshow-advance'
    } = options;

    if (wallpaperSlideshowPaused || wallpaperSlideshowEntries.length <= 1) {
      return;
    }

    const shouldAdvance = await canAdvanceSlideshow();
    if (!shouldAdvance) {
      return;
    }

    if (wallpaperSlideshowIndex >= wallpaperSlideshowEntries.length) {
      wallpaperSlideshowEntries = rebuildSlideshowEntries(state);
      wallpaperSlideshowIndex = 0;
    }

    const entry = wallpaperSlideshowEntries[wallpaperSlideshowIndex];
    if (!entry) {
      return;
    }

    wallpaperSlideshowIndex += 1;
    if (wallpaperSlideshowIndex >= wallpaperSlideshowEntries.length && state.shuffle) {
      wallpaperSlideshowEntries = rebuildSlideshowEntries(state);
      wallpaperSlideshowIndex = 0;
    }

    state = saveDesktopBackgroundSettings({
      ...state,
      currentWallpaper: entry.path,
      currentWallpaperType: entry.type
    });

    await applyWallpaperPath(entry.fullPath, {
      withCrossfade,
      updateTile: true,
      extractColor: shouldExtractColor(),
      position: state.picturePosition
    });

    notify(reason, { source: 'slideshow' });
  }

  function startSlideshow(settings = state) {
    stopSlideshow();

    wallpaperSlideshowEntries = rebuildSlideshowEntries(settings);
    if (wallpaperSlideshowEntries.length <= 1) {
      return;
    }

    const currentKey = `${settings.currentWallpaperType === 'custom' ? 'custom' : 'builtin'}:${settings.currentWallpaper}`;
    const currentIndex = wallpaperSlideshowEntries.findIndex(entry => entry.key === currentKey);

    wallpaperSlideshowIndex = currentIndex >= 0
      ? (currentIndex + 1) % wallpaperSlideshowEntries.length
      : 0;

    wallpaperSlideshowPaused = false;

    wallpaperSlideshowInterval = setInterval(() => {
      advanceSlideshow().catch(error => {
        console.error('[WallpaperController] Slideshow advance failed:', error);
      });
    }, intervalStringToMs(settings.changeInterval));
  }

  async function applySettings(nextSettings, options = {}) {
    const {
      persist = false,
      withCrossfade = false,
      notifyChange = true,
      updateTile = true,
      keepSlideshowPaused = false,
      extractColor,
      reason = persist ? 'settings-saved' : 'settings-preview'
    } = options;

    const preservePausedState = keepSlideshowPaused || wallpaperSlideshowPaused;
    const normalized = normalizeSettings({
      ...state,
      ...(nextSettings || {})
    });

    state = persist
      ? saveDesktopBackgroundSettings(normalized)
      : normalized;

    const fullPath = getCurrentFullPath(state);
    await applyWallpaperPath(fullPath, {
      withCrossfade,
      updateTile,
      extractColor: typeof extractColor === 'boolean' ? extractColor : shouldExtractColor(),
      position: state.picturePosition
    });

    if (getSelectionEntries(state).length > 1) {
      startSlideshow(state);
      if (preservePausedState) {
        pauseSlideshow();
      }
    } else {
      stopSlideshow();
    }

    if (notifyChange) {
      notify(reason, { source: persist ? 'registry' : 'preview' });
    }

    return clone(state);
  }

  function getSettings() {
    return clone(state);
  }

  function reloadFromRegistry(options = {}) {
    const settings = loadDesktopBackgroundSettings();
    return applySettings(settings, {
      persist: false,
      withCrossfade: false,
      notifyChange: options.notifyChange !== false,
      reason: options.reason || 'registry-reload'
    });
  }

  function pauseSlideshow() {
    wallpaperSlideshowPaused = true;
  }

  function resumeSlideshow() {
    wallpaperSlideshowPaused = false;
  }

  return {
    initialize() {
      return reloadFromRegistry({
        notifyChange: true,
        reason: 'initialize'
      });
    },
    getSettings,
    getResolvedState,
    getCurrentFullPath() {
      return currentAppliedWallpaperPath || getCurrentFullPath(state);
    },
    applySettings,
    saveSettings(nextSettings, options = {}) {
      return applySettings(nextSettings, {
        ...options,
        persist: true,
        reason: options.reason || 'settings-saved'
      });
    },
    previewWallpaper(nextSettings, options = {}) {
      return applySettings(nextSettings, {
        ...options,
        persist: false,
        reason: options.reason || 'settings-preview'
      });
    },
    applyPosition(position) {
      state = normalizeSettings({
        ...state,
        picturePosition: position
      });
      applyPosition(position);
      notify('position-preview', { source: 'preview' });
    },
    startSlideshow,
    stopSlideshow,
    pauseSlideshow,
    resumeSlideshow,
    reloadFromRegistry,
    refresh() {
      return applyWallpaperPath(getCurrentFullPath(state), {
        withCrossfade: false,
        updateTile: true,
        extractColor: shouldExtractColor(),
        position: state.picturePosition
      }).then(() => {
        notify('refresh', { source: 'refresh' });
      });
    }
  };
}

module.exports = {
  createWallpaperController
};
