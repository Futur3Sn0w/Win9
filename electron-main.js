const { app, BrowserWindow, ipcMain, dialog, globalShortcut, Menu, shell } = require('electron');
const Store = require('electron-store');
const volumeControl = require('./components/volume/volume-control');
const brightnessControl = require('./components/brightness/brightness-control');
const networkControl = require('./components/network/network-control');
const bluetoothControl = require('./components/bluetooth/bluetooth-control');
const batteryControl = require('./components/battery/battery-control');
const USBMonitor = require('./components/device_connectivity/usb-monitor');
const { setupRecycleBinHandlers } = require('./components/recycle_bin');
const { decodeTextBuffer } = require('./components/explorer/file-openability');
const DevicePostureMonitor = require('./components/continuum/device-posture-monitor');
const { spawn } = require('child_process');
const crypto = require('crypto');
const https = require('https');
const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const { applyDefaultRegistryState } = require('./setup-registry');
const { getHostUserProfile } = require('./components/shell/host-user-profile');
const { getHostWallpaper } = require('./components/shell/host-wallpaper-source');
const { registerGoogleWorkspaceHandlers } = require('./services/google-workspace');

if (process.platform === 'win32' && typeof brightnessControl.prewarm === 'function') {
  brightnessControl.prewarm().catch((error) => {
    console.warn('Brightness control prewarm failed:', error);
  });
}

// Initialize electron-store
// This will be used as the new storage backend, replacing localStorage
const store = new Store({
  name: 'config', // Creates config.json in app userData folder
  // We'll add schema validation in Phase 2
  // For now, allow any data structure during migration
});

registerGoogleWorkspaceHandlers();

// Keep a global reference of the window object
let mainWindow;
let installWindow;
// Store for child windows (apps)
let appWindows = new Map();
// USB Monitor instance
let usbMonitor = null;
let devicePostureMonitor = null;
let resetInProgress = false;

const RESET_FLAG = '--reset-setup';
const SKIP_SETUP_FLAG = '--skip-setup';
const SKIP_BOOT_FLAG = '--skip-boot';
const FULLSCREEN_FLAG = '--fullscreen';

const MUSIC_FILE_EXTENSIONS = new Set([
  '.aac',
  '.flac',
  '.m4a',
  '.mp3',
  '.oga',
  '.ogg',
  '.opus',
  '.wav',
  '.webm'
]);

const MUSIC_ART_EXTENSIONS = new Set([
  '.bmp',
  '.gif',
  '.jpeg',
  '.jpg',
  '.png',
  '.webp'
]);

const MUSIC_ART_BASENAMES = new Set([
  'album',
  'albumart',
  'album_art',
  'album art',
  'artwork',
  'cover',
  'folder',
  'front'
]);

const MUSIC_TRANSCODE_EXTENSION = '.mp3';
const musicTranscodeJobs = new Map();

const resetModeEnabled = process.argv.includes(RESET_FLAG);
const skipBootSequenceEnabled = process.argv.includes(SKIP_BOOT_FLAG);
const skipSetupSequenceEnabled = skipBootSequenceEnabled || process.argv.includes(SKIP_SETUP_FLAG);
const startFullscreenEnabled = process.argv.includes(FULLSCREEN_FLAG);

function hideWindowMenuBar(window) {
  if (!window || window.isDestroyed()) {
    return;
  }

  window.setAutoHideMenuBar(true);
  window.setMenuBarVisibility(false);
}

function sendFullscreenState(window) {
  if (!window || window.isDestroyed()) {
    return;
  }

  window.webContents.send('fullscreen-state-changed', window.isFullScreen());
}

function enterStartupFullscreen(window) {
  if (!startFullscreenEnabled || !window || window.isDestroyed()) {
    return;
  }

  setTimeout(() => {
    if (!window || window.isDestroyed() || window.isFullScreen()) {
      return;
    }

    window.setFullScreen(true);
  }, 0);
}

const chromeBetaDownloadItems = new Map();
let chromeBetaDownloadCounter = 0;

function getChromeBetaDownloadId() {
  chromeBetaDownloadCounter += 1;
  return `chrome-beta-download-${Date.now()}-${chromeBetaDownloadCounter}`;
}

function getUniqueDownloadPath(basePath) {
  if (!basePath) {
    return '';
  }

  if (!fsSync.existsSync(basePath)) {
    return basePath;
  }

  const parsed = path.parse(basePath);
  let attempt = 1;
  while (attempt < 1000) {
    const nextPath = path.join(parsed.dir, `${parsed.name} (${attempt})${parsed.ext}`);
    if (!fsSync.existsSync(nextPath)) {
      return nextPath;
    }
    attempt += 1;
  }

  return path.join(parsed.dir, `${parsed.name}-${Date.now()}${parsed.ext}`);
}

function inferChromeBetaDownloadKind(fileName, mimeType = '') {
  const extension = path.extname(fileName || '').toLowerCase();
  const normalizedMime = String(mimeType || '').toLowerCase();

  if (normalizedMime.startsWith('image/') || ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg', '.ico'].includes(extension)) {
    return 'image';
  }

  if (normalizedMime === 'application/pdf' || extension === '.pdf') {
    return 'pdf';
  }

  if (['.exe', '.msi', '.bat', '.cmd'].includes(extension)) {
    return 'exe';
  }

  if (['.zip', '.rar', '.7z', '.tar', '.gz'].includes(extension)) {
    return 'archive';
  }

  if (['.doc', '.docx', '.txt', '.rtf', '.md'].includes(extension)) {
    return 'document';
  }

  return 'file';
}

function getChromeBetaDownloadState(item, terminalState = '') {
  if (terminalState === 'completed') {
    return 'completed';
  }

  if (terminalState === 'cancelled') {
    return 'cancelled';
  }

  if (terminalState === 'interrupted') {
    return 'interrupted';
  }

  if (!item || typeof item.isPaused !== 'function') {
    return 'in-progress';
  }

  return item.isPaused() ? 'paused' : 'in-progress';
}

function serializeChromeBetaDownloadItem(item, overrides = {}) {
  if (!item) {
    return null;
  }

  let address = '';
  try {
    address = typeof item.getURL === 'function' ? item.getURL() : '';
  } catch (_error) {
    address = '';
  }

  let domain = '';
  try {
    domain = address ? new URL(address).host : '';
  } catch (_error) {
    domain = '';
  }

  let filePath = '';
  try {
    filePath = typeof item.getSavePath === 'function' ? item.getSavePath() : '';
  } catch (_error) {
    filePath = '';
  }

  const name = typeof item.getFilename === 'function' ? item.getFilename() : (overrides.name || 'Download');
  const mimeType = typeof item.getMimeType === 'function' ? item.getMimeType() : '';
  const totalBytes = Math.max(0, Number(typeof item.getTotalBytes === 'function' ? item.getTotalBytes() : 0) || 0);
  const receivedBytes = Math.max(0, Number(typeof item.getReceivedBytes === 'function' ? item.getReceivedBytes() : 0) || 0);
  const rawPercent = Number(typeof item.getPercentComplete === 'function' ? item.getPercentComplete() : -1);
  const percentComplete = Number.isFinite(rawPercent) && rawPercent >= 0
    ? rawPercent
    : (totalBytes > 0 ? Math.max(0, Math.min(100, Math.round((receivedBytes / totalBytes) * 100))) : -1);

  return {
    downloadId: overrides.downloadId || item.__chromeBetaDownloadId || '',
    name,
    address,
    domain,
    mimeType,
    kind: overrides.kind || inferChromeBetaDownloadKind(name, mimeType),
    totalBytes,
    receivedBytes,
    percentComplete,
    filePath: overrides.filePath || filePath,
    state: overrides.state || getChromeBetaDownloadState(item),
    startedAt: overrides.startedAt || item.__chromeBetaStartedAt || new Date().toISOString()
  };
}

function installChromeBetaDownloadHandler(downloadSession, appWindow) {
  if (!downloadSession || downloadSession.__chromeBetaDownloadHandlerInstalled) {
    return;
  }

  downloadSession.__chromeBetaDownloadHandlerInstalled = true;
  downloadSession.on('will-download', (event, item, sourceWebContents) => {
    if (!item || !sourceWebContents || sourceWebContents.isDestroyed()) {
      return;
    }

    if (!appWindow || appWindow.isDestroyed()) {
      return;
    }

    const downloadId = getChromeBetaDownloadId();
    const fileName = typeof item.getFilename === 'function' ? item.getFilename() : 'download';
    const defaultPath = getUniqueDownloadPath(path.join(app.getPath('downloads'), fileName));
    item.__chromeBetaDownloadId = downloadId;
    item.__chromeBetaStartedAt = new Date().toISOString();

    if (defaultPath && typeof item.setSavePath === 'function') {
      item.setSavePath(defaultPath);
    }

    chromeBetaDownloadItems.set(downloadId, item);
    if (typeof item.pause === 'function') {
      item.pause();
    }

    const emitDownloadEvent = (payload) => {
      if (!appWindow || appWindow.isDestroyed()) {
        return;
      }

      appWindow.webContents.send('chrome-beta:download-event', payload);
    };

    emitDownloadEvent({
      type: 'prompt',
      ...serializeChromeBetaDownloadItem(item, {
        downloadId,
        filePath: defaultPath,
        state: 'pending'
      })
    });

    item.on('updated', (_downloadEvent, state) => {
      emitDownloadEvent({
        type: 'updated',
        ...serializeChromeBetaDownloadItem(item, {
          downloadId,
          filePath: defaultPath,
          state: state === 'interrupted' ? 'interrupted' : getChromeBetaDownloadState(item)
        })
      });
    });

    item.on('done', (_downloadEvent, state) => {
      emitDownloadEvent({
        type: 'done',
        ...serializeChromeBetaDownloadItem(item, {
          downloadId,
          filePath: defaultPath,
          state: getChromeBetaDownloadState(item, state)
        })
      });
    });
  });
}

function setupChromeBetaPopupRouting(appWindow) {
  if (!appWindow || appWindow.isDestroyed()) {
    return;
  }

  const forwardPopupToTab = (details = {}) => {
    if (!details.url) {
      return { action: 'deny' };
    }

    appWindow.webContents.send('chrome-beta:open-url-in-tab', {
      url: details.url,
      disposition: details.disposition || 'new-window'
    });

    return { action: 'deny' };
  };

  if (typeof appWindow.webContents.setWindowOpenHandler === 'function') {
    appWindow.webContents.setWindowOpenHandler((details) => forwardPopupToTab(details));
  }

  installChromeBetaDownloadHandler(appWindow.webContents.session, appWindow);

  appWindow.webContents.on('did-attach-webview', (_event, guestWebContents) => {
    if (!guestWebContents || guestWebContents.isDestroyed()) {
      return;
    }

    installChromeBetaDownloadHandler(guestWebContents.session, appWindow);

    if (typeof guestWebContents.setWindowOpenHandler === 'function') {
      guestWebContents.setWindowOpenHandler((details) => forwardPopupToTab(details));
    }

    guestWebContents.on('new-window', (event, url, _frameName, disposition) => {
      event.preventDefault();
      forwardPopupToTab({ url, disposition });
    });

    guestWebContents.on('context-menu', (_event, params = {}) => {
      if (!appWindow || appWindow.isDestroyed()) {
        return;
      }

      appWindow.webContents.send('chrome-beta:webview-context-menu', {
        x: Number.isFinite(params.x) ? params.x : 0,
        y: Number.isFinite(params.y) ? params.y : 0,
        pageURL: typeof params.pageURL === 'string' ? params.pageURL : '',
        frameURL: typeof params.frameURL === 'string' ? params.frameURL : '',
        linkURL: typeof params.linkURL === 'string' ? params.linkURL : '',
        linkText: typeof params.linkText === 'string' ? params.linkText : '',
        srcURL: typeof params.srcURL === 'string' ? params.srcURL : '',
        selectionText: typeof params.selectionText === 'string' ? params.selectionText : '',
        titleText: typeof params.titleText === 'string' ? params.titleText : '',
        mediaType: typeof params.mediaType === 'string' ? params.mediaType : 'none',
        isEditable: !!params.isEditable,
        inputFieldType: typeof params.inputFieldType === 'string' ? params.inputFieldType : '',
        misspelledWord: typeof params.misspelledWord === 'string' ? params.misspelledWord : '',
        dictionarySuggestions: Array.isArray(params.dictionarySuggestions)
          ? params.dictionarySuggestions.filter((item) => typeof item === 'string')
          : [],
        editFlags: {
          canUndo: !!params.editFlags?.canUndo,
          canRedo: !!params.editFlags?.canRedo,
          canCut: !!params.editFlags?.canCut,
          canCopy: !!params.editFlags?.canCopy,
          canPaste: !!params.editFlags?.canPaste,
          canDelete: !!params.editFlags?.canDelete,
          canSelectAll: !!params.editFlags?.canSelectAll
        }
      });
    });
  });
}

ipcMain.handle('chrome-beta:download-action', async (_event, payload = {}) => {
  const downloadId = typeof payload.downloadId === 'string' ? payload.downloadId : '';
  const action = typeof payload.action === 'string' ? payload.action : '';
  if (!action) {
    return { success: false, error: 'Missing download action payload.' };
  }

  try {
    switch (action) {
      case 'open-downloads-folder':
        await shell.openPath(app.getPath('downloads'));
        return { success: true };
    }

    if (!downloadId) {
      return { success: false, error: 'Download item not found.' };
    }

    const item = chromeBetaDownloadItems.get(downloadId);
    if (!item) {
      return { success: false, error: 'Download item not found.' };
    }

    const filePath = typeof item.getSavePath === 'function' ? item.getSavePath() : '';

    switch (action) {
      case 'accept-save':
        if (typeof item.resume === 'function') {
          item.resume();
        }
        return {
          success: true,
          download: serializeChromeBetaDownloadItem(item, {
            downloadId,
            state: 'in-progress'
          })
        };
      case 'open':
        if (!filePath) {
          throw new Error('Download has no saved file path.');
        }
        await shell.openPath(filePath);
        return { success: true };
      case 'show-in-folder':
        if (!filePath) {
          throw new Error('Download has no saved file path.');
        }
        shell.showItemInFolder(filePath);
        return { success: true };
      case 'pause':
        if (typeof item.pause === 'function') {
          item.pause();
        }
        return {
          success: true,
          download: serializeChromeBetaDownloadItem(item, {
            downloadId,
            state: getChromeBetaDownloadState(item)
          })
        };
      case 'resume':
        if (typeof item.resume === 'function') {
          item.resume();
        }
        return {
          success: true,
          download: serializeChromeBetaDownloadItem(item, {
            downloadId,
            state: getChromeBetaDownloadState(item)
          })
        };
      case 'cancel':
        if (typeof item.cancel === 'function') {
          item.cancel();
        }
        return {
          success: true,
          download: serializeChromeBetaDownloadItem(item, {
            downloadId,
            state: 'cancelled'
          })
        };
      default:
        return { success: false, error: `Unsupported download action: ${action}` };
    }
  } catch (error) {
    return { success: false, error: error?.message || 'Download action failed.' };
  }
});

function clearSetupData() {
  store.delete('setup');
  store.set('setup.completed', false);
  store.delete('setup.initialized');
  console.log('[Setup] Setup state cleared');
}

function toIsoDate(value) {
  if (!(value instanceof Date) || Number.isNaN(value.valueOf())) {
    return null;
  }

  return value.toISOString();
}

function isSupportedMusicFile(fileName) {
  return MUSIC_FILE_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

function isAlbumArtCandidate(fileName) {
  const extension = path.extname(fileName).toLowerCase();
  if (!MUSIC_ART_EXTENSIONS.has(extension)) {
    return false;
  }

  const baseName = path.basename(fileName, extension).toLowerCase();
  return MUSIC_ART_BASENAMES.has(baseName);
}

function normalizeMusicLabel(value, fallback) {
  if (typeof value !== 'string') {
    return fallback;
  }

  const cleaned = value.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned || fallback;
}

function inferMusicTrackMetadata(rootPath, directoryPath, fileName) {
  const extension = path.extname(fileName);
  const rawName = path.basename(fileName, extension);
  const relativeDirectory = path.relative(rootPath, directoryPath);
  const directoryParts = relativeDirectory
    .split(path.sep)
    .map(part => part.trim())
    .filter(Boolean);

  let artist = directoryParts[0] || 'Unknown artist';
  let album = directoryParts[1] || (directoryParts[0] || 'Singles');
  let title = rawName;
  let trackNumber = null;

  const numberedTrackMatch = title.match(/^(\d{1,2})[\s._-]+(.+)$/);
  if (numberedTrackMatch) {
    trackNumber = Number.parseInt(numberedTrackMatch[1], 10);
    title = numberedTrackMatch[2].trim();
  }

  const artistTitleMatch = title.match(/^(.+?)\s-\s(.+)$/);
  if (artistTitleMatch) {
    if (!directoryParts[0]) {
      artist = artistTitleMatch[1].trim();
    }
    title = artistTitleMatch[2].trim();
  }

  return {
    artist: normalizeMusicLabel(artist, 'Unknown artist'),
    album: normalizeMusicLabel(album, 'Singles'),
    title: normalizeMusicLabel(title, 'Unknown track'),
    trackNumber: Number.isFinite(trackNumber) ? trackNumber : null
  };
}

function compareMusicTracks(left, right) {
  const artistCompare = left.artist.localeCompare(right.artist, undefined, { sensitivity: 'base' });
  if (artistCompare !== 0) {
    return artistCompare;
  }

  const albumCompare = left.album.localeCompare(right.album, undefined, { sensitivity: 'base' });
  if (albumCompare !== 0) {
    return albumCompare;
  }

  const trackNumberCompare = (left.trackNumber ?? Number.MAX_SAFE_INTEGER) - (right.trackNumber ?? Number.MAX_SAFE_INTEGER);
  if (trackNumberCompare !== 0) {
    return trackNumberCompare;
  }

  return left.title.localeCompare(right.title, undefined, { sensitivity: 'base' });
}

async function fileExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch (_error) {
    return false;
  }
}

function getMusicTranscodeCacheDir() {
  return path.join(app.getPath('userData'), 'cache', 'music-transcodes');
}

function buildMusicTranscodeKey(filePath, stats) {
  const hash = crypto.createHash('sha1');
  hash.update(filePath);
  hash.update('\0');
  hash.update(String(stats.size));
  hash.update('\0');
  hash.update(String(stats.mtimeMs));
  return hash.digest('hex');
}

async function ensureTranscodedPlaybackSource(sourcePath) {
  const sourceStats = await fs.stat(sourcePath);
  const cacheDir = getMusicTranscodeCacheDir();
  await fs.mkdir(cacheDir, { recursive: true });

  const cacheKey = buildMusicTranscodeKey(sourcePath, sourceStats);
  const outputPath = path.join(cacheDir, `${cacheKey}${MUSIC_TRANSCODE_EXTENSION}`);
  const tempOutputPath = `${outputPath}.tmp`;

  if (await fileExists(outputPath)) {
    return {
      transcoded: true,
      path: outputPath,
      fileUrl: pathToFileURL(outputPath).href,
      cacheKey
    };
  }

  if (musicTranscodeJobs.has(cacheKey)) {
    return musicTranscodeJobs.get(cacheKey);
  }

  const transcodePromise = new Promise((resolve, reject) => {
    const ffmpegPath = ffmpegInstaller?.path;
    if (!ffmpegPath) {
      reject(new Error('FFmpeg binary is unavailable.'));
      return;
    }

    const ffmpegArgs = [
      '-y',
      '-v', 'error',
      '-i', sourcePath,
      '-vn',
      '-codec:a', 'libmp3lame',
      '-q:a', '3',
      tempOutputPath
    ];

    const ffmpegProcess = spawn(ffmpegPath, ffmpegArgs, {
      windowsHide: true
    });

    let stderr = '';

    ffmpegProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ffmpegProcess.on('error', (error) => {
      reject(error);
    });

    ffmpegProcess.on('close', async (code) => {
      if (code !== 0) {
        await fs.rm(tempOutputPath, { force: true }).catch(() => {});
        reject(new Error(stderr.trim() || `FFmpeg exited with code ${code}.`));
        return;
      }

      try {
        await fs.rename(tempOutputPath, outputPath);
        resolve({
          transcoded: true,
          path: outputPath,
          fileUrl: pathToFileURL(outputPath).href,
          cacheKey
        });
      } catch (error) {
        await fs.rm(tempOutputPath, { force: true }).catch(() => {});
        reject(error);
      }
    });
  }).finally(() => {
    musicTranscodeJobs.delete(cacheKey);
  });

  musicTranscodeJobs.set(cacheKey, transcodePromise);
  return transcodePromise;
}

async function scanMusicLibrary(folderPath) {
  const tracks = [];

  async function walkDirectory(currentPath) {
    let entries;
    try {
      entries = await fs.readdir(currentPath, { withFileTypes: true });
    } catch (error) {
      console.warn('[Music Library] Skipping unreadable directory:', currentPath, error.message);
      return;
    }

    const albumArtEntry = entries.find(entry => entry.isFile() && isAlbumArtCandidate(entry.name));
    const albumArtPath = albumArtEntry ? path.join(currentPath, albumArtEntry.name) : null;
    const albumArtUrl = albumArtPath ? pathToFileURL(albumArtPath).href : null;

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        await walkDirectory(fullPath);
        continue;
      }

      if (!entry.isFile() || !isSupportedMusicFile(entry.name)) {
        continue;
      }

      const fileStats = await fs.stat(fullPath).catch(() => null);
      const inferredMetadata = inferMusicTrackMetadata(folderPath, currentPath, entry.name);

      tracks.push({
        id: fullPath,
        path: fullPath,
        fileUrl: pathToFileURL(fullPath).href,
        relativePath: path.relative(folderPath, fullPath),
        extension: path.extname(entry.name).toLowerCase(),
        albumArtPath,
        albumArtUrl,
        addedAt: toIsoDate(fileStats?.birthtime),
        modifiedAt: toIsoDate(fileStats?.mtime),
        ...inferredMetadata
      });
    }
  }

  await walkDirectory(folderPath);

  const sortedTracks = tracks.sort(compareMusicTracks);
  const albumMap = new Map();
  const artistMap = new Map();

  sortedTracks.forEach(track => {
    const artistKey = track.artist.toLowerCase();
    const albumKey = `${track.artist.toLowerCase()}::${track.album.toLowerCase()}`;

    if (!artistMap.has(artistKey)) {
      artistMap.set(artistKey, {
        id: artistKey,
        name: track.artist,
        albumCount: 0,
        trackCount: 0,
        albumArtUrl: track.albumArtUrl || null
      });
    }

    const artistEntry = artistMap.get(artistKey);
    artistEntry.trackCount += 1;
    if (!artistEntry.albumArtUrl && track.albumArtUrl) {
      artistEntry.albumArtUrl = track.albumArtUrl;
    }

    if (!albumMap.has(albumKey)) {
      albumMap.set(albumKey, {
        id: albumKey,
        artist: track.artist,
        title: track.album,
        trackCount: 0,
        albumArtUrl: track.albumArtUrl || null,
        addedAt: track.addedAt,
        modifiedAt: track.modifiedAt,
        tracks: []
      });
      artistEntry.albumCount += 1;
    }

    const albumEntry = albumMap.get(albumKey);
    albumEntry.trackCount += 1;
    albumEntry.tracks.push(track);
    if (!albumEntry.albumArtUrl && track.albumArtUrl) {
      albumEntry.albumArtUrl = track.albumArtUrl;
    }
    if (!albumEntry.addedAt || (track.addedAt && track.addedAt < albumEntry.addedAt)) {
      albumEntry.addedAt = track.addedAt;
    }
    if (!albumEntry.modifiedAt || (track.modifiedAt && track.modifiedAt > albumEntry.modifiedAt)) {
      albumEntry.modifiedAt = track.modifiedAt;
    }
  });

  const albums = Array.from(albumMap.values())
    .sort((left, right) => {
      const leftDate = left.addedAt || '';
      const rightDate = right.addedAt || '';
      if (leftDate && rightDate && leftDate !== rightDate) {
        return rightDate.localeCompare(leftDate);
      }

      return left.title.localeCompare(right.title, undefined, { sensitivity: 'base' });
    });

  const artists = Array.from(artistMap.values())
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }));

  return {
    folderPath,
    folderName: path.basename(folderPath) || 'Music Library',
    trackCount: sortedTracks.length,
    albumCount: albums.length,
    artistCount: artists.length,
    tracks: sortedTracks,
    albums,
    artists,
    scannedAt: new Date().toISOString()
  };
}

function launchSetupFlow() {
  if (skipSetupSequenceEnabled) {
    resetInProgress = false;
    createMainWindow({ skipBoot: skipBootSequenceEnabled });
    return;
  }
  resetInProgress = true;

  const beginBoot = () => {
    createInstallWindow();
  };

  if (installWindow && !installWindow.isDestroyed()) {
    installWindow.once('closed', beginBoot);
    installWindow.close();
    return;
  }

  beginBoot();
}

function triggerSetupReset({ reason = 'manual' } = {}) {
  if (!resetModeEnabled) {
    console.warn(`[Setup] Reset requested (${reason}) but reset mode is disabled`);
    return;
  }

  console.log(`[Setup] Reset requested (${reason})`);
  clearSetupData();

  const proceed = () => {
    launchSetupFlow();
  };

  if (mainWindow && !mainWindow.isDestroyed()) {
    resetInProgress = true;
    mainWindow.once('closed', proceed);
    mainWindow.close();
    return;
  }

  if (installWindow && !installWindow.isDestroyed()) {
    installWindow.webContents.send('setup-reset');
    resetInProgress = true;
    installWindow.once('closed', proceed);
    installWindow.close();
    return;
  }

  proceed();
}

function createMainWindow(options = {}) {
  const { skipBoot = false } = options;
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 795,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#000000',
    show: false, // Don't show until ready
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
      nodeIntegrationInSubFrames: true,
      webviewTag: true // Enable webview tag support
    },
    frame: true, // Keep native frame
    title: 'Windows'
  });

  hideWindowMenuBar(mainWindow);
  setupChromeBetaPopupRouting(mainWindow);
  if (!devicePostureMonitor) {
    devicePostureMonitor = new DevicePostureMonitor(mainWindow);
  } else {
    devicePostureMonitor.attachWindow(mainWindow);
  }
  devicePostureMonitor.start().catch((error) => {
    console.warn('[DevicePosture] Failed to start monitor:', error);
  });
  mainWindow.on('app-command', (_event, command) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    if (command === 'browser-backward' || command === 'browser-forward') {
      mainWindow.webContents.send('chrome-beta:navigate-history', { command });
    }
  });
  mainWindow.on('swipe', (_event, direction) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    if (direction === 'right' || direction === 'left') {
      mainWindow.webContents.send('chrome-beta:navigate-history', {
        command: direction === 'right' ? 'browser-backward' : 'browser-forward'
      });
    }
  });
  mainWindow.on('enter-full-screen', () => {
    hideWindowMenuBar(mainWindow);
    sendFullscreenState(mainWindow);
  });
  mainWindow.on('leave-full-screen', () => {
    hideWindowMenuBar(mainWindow);
    sendFullscreenState(mainWindow);
  });

  // Load the index.html
  mainWindow.loadFile('index.html');
  mainWindow.webContents.on('did-finish-load', () => sendFullscreenState(mainWindow));

  if (skipBoot) {
    const sendSkipBoot = () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('shell:skip-boot');
      }
    };
    mainWindow.webContents.once('did-finish-load', sendSkipBoot);
  }

  // Show window when ready to avoid visual flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.once('show', () => enterStartupFullscreen(mainWindow));
    mainWindow.show();

    if (!usbMonitor) {
      usbMonitor = new USBMonitor(mainWindow);
      usbMonitor.start();
    } else {
      usbMonitor.mainWindow = mainWindow;
      if (!usbMonitor.isMonitoring) {
        usbMonitor.start();
      }
    }
  });

  // Open DevTools in development mode
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  // Emitted when the window is closed
  mainWindow.on('closed', () => {
    if (devicePostureMonitor) {
      devicePostureMonitor.detachWindow();
    }
    mainWindow = null;
    if (usbMonitor) {
      usbMonitor.mainWindow = null;
    }
    // Close all app windows
    appWindows.forEach(win => {
      if (!win.isDestroyed()) {
        win.close();
      }
    });
    appWindows.clear();
  });
}

function createInstallWindow() {
  if (installWindow && !installWindow.isDestroyed()) {
    installWindow.focus();
    return;
  }

  installWindow = new BrowserWindow({
    width: 1024,
    height: 720,
    resizable: false,
    minimizable: false,
    maximizable: false,
    backgroundColor: '#000000',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
      nodeIntegrationInSubFrames: true
    },
    title: 'Windows Setup'
  });

  hideWindowMenuBar(installWindow);

  installWindow.loadFile('install.html').catch(error => {
    console.error('[Setup] Failed to load install window:', error);
    if (resetInProgress) {
      resetInProgress = false;
    }
  });

  installWindow.once('ready-to-show', () => {
    installWindow.show();
    if (resetInProgress) {
      resetInProgress = false;
    }
  });

  installWindow.on('closed', () => {
    installWindow = null;
  });
}

// Ensure only one instance of the app can run
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // Another instance is already running, quit this one
  app.quit();
} else {
  // Handle second instance attempts
  app.on('second-instance', () => {
    // Someone tried to run a second instance, focus our window instead
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });

  // This method will be called when Electron has finished initialization
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);

    if (resetModeEnabled) {
      clearSetupData();
    }

    let setupComplete = store.get('setup.completed', false);
    const setupInitialized = store.get('setup.initialized', false);

    if (skipSetupSequenceEnabled && !setupComplete && !setupInitialized) {
      applyDefaultRegistryState({ profile: {} });
      store.set('setup.initialized', true);
    }

    if (setupComplete || skipSetupSequenceEnabled) {
      createMainWindow({ skipBoot: skipBootSequenceEnabled });
    } else {
      launchSetupFlow();
    }

    // Setup trash/recycle bin handlers
    setupRecycleBinHandlers();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        const completed = store.get('setup.completed', false);
        if (completed || skipSetupSequenceEnabled) {
          createMainWindow({ skipBoot: skipBootSequenceEnabled });
        } else {
          launchSetupFlow();
        }
      }
    });

    if (resetModeEnabled) {
      const shortcutRegistered = globalShortcut.register('CommandOrControl+Alt+R', () => {
        triggerSetupReset({ reason: 'global-shortcut' });
      });

      if (!shortcutRegistered) {
        console.warn('[Setup] Failed to register global reset shortcut');
      }
    }

    // Register globalShortcut fallbacks for Win+key combos
    // These work even without AHK, but only for combos (not Win-alone)
    const winShortcuts = {
      'Super+C': 'c',
      'Super+I': 'i',
      'Super+R': 'r',
      'Super+E': 'e',
      'Super+L': 'l',
      'Super+X': 'x',
      'Super+Left': 'ArrowLeft',
      'Super+Right': 'ArrowRight',
      'Super+Up': 'ArrowUp',
      'Super+Down': 'ArrowDown',
      // Windows remaps bare Win to F24 through AHK, so bridge the arrow combos
      // through a synthetic accelerator that globalShortcut can observe reliably.
      'Control+Alt+Shift+Left': 'ArrowLeft',
      'Control+Alt+Shift+Right': 'ArrowRight',
      'Control+Alt+Shift+Up': 'ArrowUp',
      'Control+Alt+Shift+Down': 'ArrowDown'
    };

    for (const [accelerator, key] of Object.entries(winShortcuts)) {
      const registered = globalShortcut.register(accelerator, () => {
        if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused()) {
          mainWindow.webContents.send('win-shortcut', key);
        }
      });
      if (!registered) {
        console.warn(`[Keyboard] Failed to register global shortcut: ${accelerator}`);
      }
    }

    // Auto-launch AHK key remapping script (remaps Win key to F24 when app is focused)
    launchAhkKeymap();
  });
}

// ===== AHK Key Remapping =====
let ahkProcess = null;

function launchAhkKeymap() {
  if (process.platform !== 'win32') return;

  const scriptPath = path.join(__dirname, 'resources', 'helpers', 'win8-keymap.ahk');
  if (!fsSync.existsSync(scriptPath)) {
    console.warn('[Keyboard] AHK script not found:', scriptPath);
    return;
  }

  // Search for AHK v2 in common locations
  const ahkPaths = [
    'C:\\Program Files\\AutoHotkey\\v2\\AutoHotkey64.exe',
    'C:\\Program Files\\AutoHotkey\\v2\\AutoHotkey32.exe',
    'C:\\Program Files\\AutoHotkey\\v2\\AutoHotkey.exe',
    'C:\\Program Files\\AutoHotkey\\AutoHotkey.exe'
  ];

  const ahkExe = ahkPaths.find(p => fsSync.existsSync(p));
  if (!ahkExe) {
    console.warn('[Keyboard] AutoHotkey not found. Win key remapping unavailable.');
    console.warn('[Keyboard] Install AHK v2 from https://www.autohotkey.com/ for full Win key support.');
    return;
  }

  try {
    ahkProcess = spawn(ahkExe, [scriptPath], {
      detached: false,
      stdio: 'ignore',
      windowsHide: true
    });

    ahkProcess.on('error', (err) => {
      console.error('[Keyboard] Failed to launch AHK:', err.message);
      ahkProcess = null;
    });

    ahkProcess.on('exit', (code) => {
      if (code !== null && code !== 0) {
        console.warn('[Keyboard] AHK process exited with code:', code);
      }
      ahkProcess = null;
    });

    console.log('[Keyboard] AHK key remapping active (Win → F24 when focused)');
  } catch (err) {
    console.error('[Keyboard] Failed to launch AHK:', err.message);
  }
}

function killAhkKeymap() {
  if (ahkProcess && !ahkProcess.killed) {
    ahkProcess.kill();
    ahkProcess = null;
    console.log('[Keyboard] AHK key remapping stopped');
  }
}

// Quit when all windows are closed (including on macOS)
app.on('window-all-closed', () => {
  if (resetInProgress) {
    return;
  }
  app.quit();
});

app.on('will-quit', () => {
  killAhkKeymap();
  globalShortcut.unregisterAll();
  if (devicePostureMonitor) {
    devicePostureMonitor.stop();
  }
});

// ===== Setup Flow IPC =====

ipcMain.handle('setup-complete', async (_event, payload) => {
  try {
    const setupRecord = {
      completed: true,
      data: payload || null,
      completedAt: new Date().toISOString()
    };

    store.set('setup', setupRecord);
    store.set('setup.completed', true);
    store.set('setup.initialized', true);

    const profile = payload && payload.selections ? payload.selections : {};
    applyDefaultRegistryState({ profile });

    if (installWindow && !installWindow.isDestroyed()) {
      installWindow.webContents.send('setup-finished');
    }

    return { success: true };
  } catch (error) {
    console.error('[Setup] Failed to finalize setup:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.on('setup-request-restart', () => {
  resetInProgress = true;
  if (installWindow && !installWindow.isDestroyed()) {
    installWindow.close();
  }

  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow({ skipBoot: skipBootSequenceEnabled });
  } else {
    mainWindow.focus();
  }
  resetInProgress = false;
});

ipcMain.on('setup-reset-request', () => {
  triggerSetupReset({ reason: 'renderer-ipc' });
});

ipcMain.on('shell:quit-app', () => {
  app.quit();
});

ipcMain.on('toggle-simple-fullscreen', (_event, shouldBeFullscreen) => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const nextState = typeof shouldBeFullscreen === 'boolean'
    ? shouldBeFullscreen
    : !mainWindow.isFullScreen();

  if (mainWindow.isFullScreen() !== nextState) {
    mainWindow.setFullScreen(nextState);
  } else {
    sendFullscreenState(mainWindow);
  }
});

ipcMain.handle('shell:capture-window-preview', async (_event, payload = {}) => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return null;
  }

  const x = Math.max(0, Math.round(Number(payload.x) || 0));
  const y = Math.max(0, Math.round(Number(payload.y) || 0));
  const width = Math.max(0, Math.round(Number(payload.width) || 0));
  const height = Math.max(0, Math.round(Number(payload.height) || 0));
  const maxWidth = Math.max(1, Math.round(Number(payload.maxWidth) || 520));

  if (width < 2 || height < 2) {
    return null;
  }

  try {
    let image = await mainWindow.webContents.capturePage({ x, y, width, height });
    if (!image || image.isEmpty()) {
      return null;
    }

    if (image.getSize().width > maxWidth) {
      image = image.resize({ width: maxWidth });
    }

    return image.toDataURL();
  } catch (error) {
    console.warn('[TaskView] Failed to capture window preview:', error);
    return null;
  }
});

ipcMain.handle('shell:get-host-user-profile', async () => {
  try {
    return await getHostUserProfile();
  } catch (error) {
    console.error('[ShellUserProfile] Failed to load host user profile:', error);
    return {
      username: 'User',
      displayName: 'User',
      imageDataUrl: null,
      hasHostImage: false,
      sourcePlatform: process.platform
    };
  }
});

ipcMain.handle('shell:get-host-wallpaper', async (_event, options = {}) => {
  try {
    return await getHostWallpaper({
      refresh: Boolean(options && options.refresh)
    });
  } catch (error) {
    console.error('[ShellHostWallpaper] Failed to load host wallpaper:', error);
    return {
      wallpaperPath: '',
      hasHostWallpaper: false,
      sourceKind: '',
      sourcePlatform: process.platform
    };
  }
});

ipcMain.handle('device-posture:get-state', async () => {
  if (!devicePostureMonitor) {
    devicePostureMonitor = new DevicePostureMonitor(mainWindow || null);
  }

  return devicePostureMonitor.getState();
});

ipcMain.handle('chrome-beta:fetch-search-suggestions', async (_event, payload = {}) => {
  const requestUrl = typeof payload?.url === 'string' ? payload.url : '';
  if (!requestUrl) {
    return null;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(requestUrl);
  } catch (_error) {
    return null;
  }

  const allowedHosts = new Set([
    'www.google.com',
    'suggestqueries.google.com',
    'api.bing.com',
    'duckduckgo.com'
  ]);

  if (parsedUrl.protocol !== 'https:' || !allowedHosts.has(parsedUrl.hostname)) {
    return null;
  }

  return new Promise((resolve) => {
    const request = https.get(parsedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 ChromeBetaWin8/1.0',
        'Accept': 'application/json, text/plain, */*'
      }
    }, (response) => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        raw += chunk;
      });
      response.on('end', () => resolve(raw || null));
    });

    request.setTimeout(1800, () => {
      request.destroy();
      resolve(null);
    });
    request.on('error', () => resolve(null));
  });
});

// ===== Notepad File Operations =====

async function readNotepadFile(filePath) {
  if (!filePath) {
    throw new Error('Missing file path for open operation');
  }

  const buffer = await fs.readFile(filePath);
  const decoded = decodeTextBuffer(buffer);

  if (!decoded.canOpen) {
    throw new Error('This file is not in a text format that the simulated Notepad can open.');
  }

  return {
    canceled: false,
    filePath,
    fileName: path.basename(filePath),
    content: decoded.content,
    encoding: decoded.encoding
  };
}

ipcMain.handle('notepad-open-file', async () => {
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'Text Files', extensions: ['txt', 'text', 'rtf', 'log', 'md', 'json', 'js', 'css', 'html', 'htm', 'xml', 'csv', 'ini', 'cfg'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });

    if (canceled || !filePaths || filePaths.length === 0) {
      return { canceled: true };
    }

    return await readNotepadFile(filePaths[0]);
  } catch (error) {
    console.error('Failed to open file:', error);
    return { canceled: true, error: error.message };
  }
});

ipcMain.handle('notepad-open-file-path', async (event, filePath) => {
  try {
    return await readNotepadFile(filePath);
  } catch (error) {
    console.error('Failed to open file by path:', error);
    return { canceled: true, error: error.message };
  }
});

ipcMain.handle('notepad-save-file', async (event, { filePath, content }) => {
  try {
    if (!filePath) {
      throw new Error('Missing file path for save operation');
    }

    await fs.writeFile(filePath, content, 'utf8');
    return { success: true, filePath };
  } catch (error) {
    console.error('Failed to save file:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('notepad-save-file-as', async (event, { defaultPath, content }) => {
  try {
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath,
      filters: [
        { name: 'Text Files', extensions: ['txt', 'text', 'rtf', 'log', 'md', 'json', 'js', 'css', 'html', 'htm', 'xml', 'csv', 'ini', 'cfg'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });

    if (canceled || !filePath) {
      return { canceled: true };
    }

    await fs.writeFile(filePath, content, 'utf8');
    return { success: true, filePath };
  } catch (error) {
    console.error('Failed to save file as:', error);
    return { success: false, error: error.message };
  }
});

// --- Reader IPC handlers ---

ipcMain.handle('reader-open-file', async () => {
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'Supported Documents', extensions: ['pdf', 'xps', 'oxps', 'tiff', 'tif'] },
        { name: 'PDF Files', extensions: ['pdf'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });

    if (canceled || !filePaths || filePaths.length === 0) {
      return { canceled: true };
    }

    return { canceled: false, filePath: filePaths[0] };
  } catch (error) {
    console.error('Failed to open file dialog for Reader:', error);
    return { canceled: true, error: error.message };
  }
});

ipcMain.handle('reader-read-file', async (event, filePath) => {
  try {
    const buffer = await fs.readFile(filePath);
    return { success: true, data: buffer };
  } catch (error) {
    console.error('Failed to read file for Reader:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('reader-file-stat', async (event, filePath) => {
  try {
    const stats = await fs.stat(filePath);
    return { success: true, size: stats.size };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Clean up USB monitoring on quit
app.on('before-quit', () => {
  if (usbMonitor) {
    usbMonitor.stop();
  }
  if (devicePostureMonitor) {
    devicePostureMonitor.stop();
  }
});

// ===== IPC Handlers =====

// Handle app launch requests from renderer
ipcMain.handle('launch-app', async (event, appData) => {
  console.log('Launching app:', appData.id);

  try {
    // Check if app is already running
    if (appWindows.has(appData.id)) {
      const existingWindow = appWindows.get(appData.id);
      if (!existingWindow.isDestroyed()) {
        existingWindow.focus();
        return { success: true, alreadyRunning: true };
      } else {
        appWindows.delete(appData.id);
      }
    }

    // Create new window for the app
    const appWindow = new BrowserWindow({
      width: appData.windowOptions?.width || 800,
      height: appData.windowOptions?.height || 600,
      minWidth: 400,
      minHeight: 300,
      resizable: appData.windowOptions?.resizable !== false,
      minimizable: appData.windowOptions?.minimizable !== false,
      maximizable: appData.windowOptions?.maximizable !== false,
      alwaysOnTop: appData.windowOptions?.alwaysOnTop || false,
      parent: appData.windowOptions?.modal ? mainWindow : null,
      modal: appData.windowOptions?.modal || false,
      title: appData.name,
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: false,
        nodeIntegration: true
      }
    });

    hideWindowMenuBar(appWindow);

    if (appData.id === 'chrome-beta') {
      setupChromeBetaPopupRouting(appWindow);
    }

    // Load the app content
    if (appData.path) {
      appWindow.loadFile(appData.path);
    } else {
      // Load a placeholder for apps without a path
      appWindow.loadURL('about:blank');
    }

    // Store the window reference
    appWindows.set(appData.id, appWindow);

    // Handle window events
    appWindow.on('closed', () => {
      appWindows.delete(appData.id);
      // Notify renderer that app closed
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('app-closed', appData.id);
      }
    });

    appWindow.on('minimize', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('app-minimized', appData.id);
      }
    });

    appWindow.on('restore', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('app-restored', appData.id);
      }
    });

    appWindow.on('focus', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('app-focused', appData.id);
      }
    });

    return { success: true, alreadyRunning: false };
  } catch (error) {
    console.error('Error launching app:', error);
    return { success: false, error: error.message };
  }
});

// Handle app close requests
ipcMain.handle('close-app', async (event, appId) => {
  const appWindow = appWindows.get(appId);
  if (appWindow && !appWindow.isDestroyed()) {
    appWindow.close();
    return { success: true };
  }
  return { success: false };
});

// Handle app minimize requests
ipcMain.handle('minimize-app', async (event, appId) => {
  const appWindow = appWindows.get(appId);
  if (appWindow && !appWindow.isDestroyed()) {
    appWindow.minimize();
    return { success: true };
  }
  return { success: false };
});

// Handle app restore requests
ipcMain.handle('restore-app', async (event, appId) => {
  const appWindow = appWindows.get(appId);
  if (appWindow && !appWindow.isDestroyed()) {
    appWindow.restore();
    appWindow.focus();
    return { success: true };
  }
  return { success: false };
});

// Handle app focus requests
ipcMain.handle('focus-app', async (event, appId) => {
  const appWindow = appWindows.get(appId);
  if (appWindow && !appWindow.isDestroyed()) {
    if (appWindow.isMinimized()) {
      appWindow.restore();
    }
    appWindow.focus();
    return { success: true };
  }
  return { success: false };
});

// Get list of running apps
ipcMain.handle('get-running-apps', async () => {
  const running = [];
  appWindows.forEach((window, appId) => {
    if (!window.isDestroyed()) {
      running.push({
        id: appId,
        isMinimized: window.isMinimized()
      });
    }
  });
  return running;
});

// ===== VOLUME CONTROL =====

// Get current volume and mute state
ipcMain.handle('get-volume-state', async () => {
  try {
    const state = await volumeControl.getVolumeState();
    return { success: true, ...state };
  } catch (error) {
    console.error('Error getting volume state:', error);
    return { success: false, volume: 50, muted: false };
  }
});

// Set volume
ipcMain.handle('set-volume', async (event, volume) => {
  try {
    const success = await volumeControl.setVolume(volume);
    return { success };
  } catch (error) {
    console.error('Error setting volume:', error);
    return { success: false };
  }
});

// Set mute state
ipcMain.handle('set-muted', async (event, muted) => {
  try {
    const success = await volumeControl.setMuted(muted);
    return { success };
  } catch (error) {
    console.error('Error setting mute state:', error);
    return { success: false };
  }
});

// Get volume icon class
ipcMain.handle('get-volume-icon', async (event, volume, muted) => {
  return volumeControl.getVolumeIcon(volume, muted);
});

// ===== BRIGHTNESS CONTROL =====

// Get current brightness state
ipcMain.handle('get-brightness-state', async () => {
  try {
    return await brightnessControl.getBrightnessState();
  } catch (error) {
    console.error('Error getting brightness state:', error);
    return {
      success: false,
      supported: false,
      brightness: brightnessControl.DEFAULT_BRIGHTNESS,
      error: error.message || 'Failed to query brightness state.'
    };
  }
});

// Set brightness
ipcMain.handle('set-brightness', async (_event, brightness) => {
  try {
    return await brightnessControl.setBrightness(brightness);
  } catch (error) {
    console.error('Error setting brightness:', error);
    return {
      success: false,
      supported: false,
      brightness: brightnessControl.clampBrightness(brightness),
      error: error.message || 'Failed to set brightness.'
    };
  }
});

// ===== NETWORK CONTROL =====

// Get current network status
ipcMain.handle('get-network-status', async () => {
  try {
    const status = await networkControl.getFullNetworkStatus();
    return { success: true, ...status };
  } catch (error) {
    console.error('Error getting network status:', error);
    return {
      success: false,
      connected: false,
      type: 'none',
      hasInternet: false,
      hasGateway: false
    };
  }
});

// Start monitoring network changes
// The renderer will call this and we'll send updates via 'network-status-changed' event
let networkMonitoringActive = false;

ipcMain.handle('start-network-monitoring', async () => {
  if (networkMonitoringActive) {
    return { success: true, alreadyActive: true };
  }

  networkMonitoringActive = true;

  networkControl.startMonitoring((status) => {
    // Send network status updates to renderer
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('network-status-changed', status);
    }
  }, 5000); // Check every 5 seconds

  return { success: true };
});

// Stop monitoring network changes
ipcMain.handle('stop-network-monitoring', async () => {
  networkControl.stopMonitoring();
  networkMonitoringActive = false;
  return { success: true };
});

// Scan for available Wi-Fi networks
ipcMain.handle('scan-wifi-networks', async () => {
  try {
    const networks = await networkControl.scanAvailableNetworks();
    return { success: true, networks };
  } catch (error) {
    console.error('Error scanning Wi-Fi networks:', error);
    return { success: false, networks: [] };
  }
});

ipcMain.handle('set-wifi-enabled', async (_event, enabled) => {
  try {
    const status = await networkControl.setWifiEnabled(enabled);
    return { success: true, ...status };
  } catch (error) {
    console.error('Error setting Wi-Fi enabled state:', error);
    return { success: false, error: error.message };
  }
});

// ===== BATTERY CONTROL =====

// ===== BLUETOOTH CONTROL =====

ipcMain.handle('bluetooth:get-state', async () => {
  try {
    console.log('[Main] bluetooth:get-state invoked');
    const state = await bluetoothControl.getState();
    console.log('[Main] bluetooth:get-state resolved:', {
      available: state.available,
      enabled: state.enabled,
      searching: state.searching
    });
    return { success: true, ...state };
  } catch (error) {
    console.error('Error getting Bluetooth state:', error);
    return {
      success: false,
      error: error.message,
      available: false,
      enabled: false,
      searching: false,
      connectedDevices: [],
      discoveredDevices: []
    };
  }
});

ipcMain.handle('bluetooth:set-enabled', async (_event, enabled) => {
  try {
    console.log('[Main] bluetooth:set-enabled invoked:', enabled);
    const state = await bluetoothControl.setEnabled(enabled);
    console.log('[Main] bluetooth:set-enabled resolved:', {
      requestedEnabled: enabled,
      available: state.available,
      enabled: state.enabled
    });
    return { success: true, ...state };
  } catch (error) {
    console.error('Error setting Bluetooth enabled state:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('bluetooth:connect-device', async (_event, deviceId) => {
  try {
    const state = await bluetoothControl.connectDevice(deviceId);
    return { success: true, ...state };
  } catch (error) {
    console.error('Error connecting Bluetooth device:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('bluetooth:disconnect-device', async (_event, deviceId) => {
  try {
    const state = await bluetoothControl.disconnectDevice(deviceId);
    return { success: true, ...state };
  } catch (error) {
    console.error('Error disconnecting Bluetooth device:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('bluetooth:remove-device', async (_event, deviceId) => {
  try {
    const state = await bluetoothControl.removeDevice(deviceId);
    return { success: true, ...state };
  } catch (error) {
    console.error('Error removing Bluetooth device:', error);
    return { success: false, error: error.message };
  }
});

// Get current battery status
ipcMain.handle('get-battery-status', async () => {
  try {
    const status = await batteryControl.getBatteryStatus();
    return { success: true, ...status };
  } catch (error) {
    console.error('Error getting battery status:', error);
    return {
      success: false,
      level: null,
      charging: false,
      batteryPresent: false
    };
  }
});

// Start monitoring battery status changes
let batteryMonitorCleanup = null;

ipcMain.handle('start-battery-monitoring', async () => {
  if (batteryMonitorCleanup) {
    return { success: true, alreadyActive: true };
  }

  batteryMonitorCleanup = batteryControl.startBatteryMonitoring((status) => {
    // Send battery status updates to renderer
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('battery-status-changed', status);
    }
  });

  return { success: true };
});

// Stop monitoring battery changes
ipcMain.handle('stop-battery-monitoring', async () => {
  if (batteryMonitorCleanup) {
    batteryMonitorCleanup.stop();
    batteryMonitorCleanup = null;
  }
  return { success: true };
});

// ===== USB DEVICE MONITORING =====

// Start USB device monitoring
ipcMain.handle('start-usb-monitoring', async () => {
  if (usbMonitor) {
    return { success: true, alreadyActive: true };
  }

  usbMonitor = new USBMonitor();
  usbMonitor.start();

  return { success: true };
});

// Stop USB device monitoring
ipcMain.handle('stop-usb-monitoring', async () => {
  if (usbMonitor) {
    usbMonitor.stop();
    usbMonitor = null;
  }
  return { success: true };
});

// Get currently connected USB devices
ipcMain.handle('get-usb-devices', async () => {
  if (!usbMonitor) {
    usbMonitor = new USBMonitor();
  }

  try {
    const devices = await usbMonitor.getDrives();
    return { success: true, devices };
  } catch (error) {
    console.error('Error getting USB devices:', error);
    return { success: false, devices: [] };
  }
});

// Get current drive list (for eject tray initialization)
ipcMain.on('get-drive-list', async (event) => {
  console.log('[MAIN] Received get-drive-list request');

  if (!usbMonitor) {
    console.error('[MAIN] USB Monitor not initialized');
    return;
  }

  try {
    // Get the current list of drives from the USB monitor
    const drivelist = require('drivelist');
    const drives = await drivelist.list();

    console.log(`[MAIN] Found ${drives.length} total drives`);

    let trayEligibleDriveCount = 0;

    // Send each mounted external/removable drive as a connection event
    drives.forEach(drive => {
      const hasMountpoints = usbMonitor.hasMountpoints(drive);
      const trayEligible = usbMonitor.isExternalRemovableDrive(drive);

      console.log(`[MAIN] Drive: ${drive.device}, busType: ${drive.busType}, isUSB: ${drive.isUSB}, isRemovable: ${drive.isRemovable}, isSystem: ${drive.isSystem}, hasMountpoints: ${hasMountpoints}, trayEligible: ${trayEligible}`);

      // Only send mounted drives that should appear in the tray.
      if (trayEligible && hasMountpoints) {
        trayEligibleDriveCount++;
        const devicePath = drive.device || drive.devicePath;
        const payload = usbMonitor.buildDrivePayload(drive, true);

        console.log(`[MAIN] Sending drive-connected for: ${payload.name} (${devicePath})`);
        event.sender.send('drive-connected', payload);
      }
    });

    console.log(`[MAIN] Sent ${trayEligibleDriveCount} tray-eligible drives to renderer`);
  } catch (error) {
    console.error('[MAIN] Error getting drive list:', error);
    console.error('[MAIN] Error stack:', error.stack);
  }
});

// Eject drive request
ipcMain.on('eject-drive', async (event, devicePath) => {
  console.log('[MAIN] Eject request for device:', devicePath);

  try {
    // Attempt to eject the drive using platform-specific commands
    let ejectCommand;
    let ejectArgs = [];

    if (process.platform === 'win32') {
      // Windows: Use PowerShell to safely eject the drive
      // Extract drive letter from device path (e.g., \\.\PHYSICALDRIVE1)
      // We need to use the drivelist module to find the drive letter
      const drivelist = require('drivelist');
      const drives = await drivelist.list();
      const targetDrive = drives.find(d => (d.device || d.devicePath) === devicePath);

      if (!targetDrive || !targetDrive.mountpoints || targetDrive.mountpoints.length === 0) {
        throw new Error('Drive not found or not mounted');
      }

      const driveLetter = targetDrive.mountpoints[0].path;
      if (!driveLetter) {
        throw new Error('Could not determine drive letter');
      }

      // Use PowerShell's (New-Object -comObject Shell.Application).NameSpace(17).ParseName method
      // to safely eject the drive
      ejectCommand = 'powershell.exe';
      ejectArgs = [
        '-Command',
        `$driveEject = New-Object -comObject Shell.Application; $driveEject.Namespace(17).ParseName('${driveLetter}').InvokeVerb('Eject')`
      ];
    } else if (process.platform === 'darwin') {
      // macOS: Use diskutil to eject the drive
      // Need to get the mount point or use the device path
      const drivelist = require('drivelist');
      const drives = await drivelist.list();
      const targetDrive = drives.find(d => (d.device || d.devicePath) === devicePath);

      if (!targetDrive) {
        throw new Error('Drive not found');
      }

      // Try to use mount point first, fall back to device path
      let ejectTarget = devicePath;
      if (targetDrive.mountpoints && targetDrive.mountpoints.length > 0) {
        ejectTarget = targetDrive.mountpoints[0].path;
      }

      console.log('[MAIN] Ejecting macOS drive:', ejectTarget);
      ejectCommand = 'diskutil';
      ejectArgs = ['eject', ejectTarget];
    } else if (process.platform === 'linux') {
      // Linux: Use udisksctl
      ejectCommand = 'udisksctl';
      ejectArgs = ['unmount', '-b', devicePath];
    } else {
      throw new Error('Unsupported platform');
    }

    const ejectProcess = spawn(ejectCommand, ejectArgs);
    let output = '';
    let errorOutput = '';

    ejectProcess.stdout.on('data', (data) => {
      output += data.toString();
    });

    ejectProcess.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    ejectProcess.on('close', (code) => {
      if (code === 0) {
        console.log('[MAIN] Successfully ejected drive:', devicePath);
        console.log('[MAIN] Output:', output);
        event.sender.send('eject-result', {
          success: true,
          devicePath: devicePath
        });
      } else {
        console.error('[MAIN] Failed to eject drive:', devicePath);
        console.error('[MAIN] Error:', errorOutput);
        event.sender.send('eject-result', {
          success: false,
          devicePath: devicePath,
          error: errorOutput || 'Failed to eject the device. It may be in use.'
        });
      }
    });

    ejectProcess.on('error', (error) => {
      console.error('[MAIN] Error executing eject command:', error);
      event.sender.send('eject-result', {
        success: false,
        devicePath: devicePath,
        error: error.message
      });
    });
  } catch (error) {
    console.error('[MAIN] Error ejecting drive:', error);
    event.sender.send('eject-result', {
      success: false,
      devicePath: devicePath,
      error: error.message
    });
  }
});

// ===== DESKTOP BACKGROUND FOLDER SELECTION =====

// Handle folder selection for custom wallpaper folders
ipcMain.handle('desktop-background-select-folder', async () => {
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select Wallpaper Folder'
    });

    if (canceled || !filePaths || filePaths.length === 0) {
      return { canceled: true };
    }

    const folderPath = filePaths[0];
    return {
      canceled: false,
      folderPath,
      folderName: path.basename(folderPath)
    };
  } catch (error) {
    console.error('Failed to select folder:', error);
    return { canceled: true, error: error.message };
  }
});

// Get host OS Pictures folder path
ipcMain.handle('desktop-background-get-pictures-folder', async () => {
  try {
    const picturesPath = app.getPath('pictures');
    return {
      success: true,
      folderPath: picturesPath,
      folderName: 'Pictures Library'
    };
  } catch (error) {
    console.error('Failed to get Pictures folder:', error);
    return { success: false, error: error.message };
  }
});

// Read images from a folder (including subfolders)
ipcMain.handle('desktop-background-read-folder', async (event, folderPath) => {
  try {
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.tiff', '.tif', '.ico', '.heic', '.heif'];
    const result = {
      images: [],
      subfolders: []
    };

    // Read directory contents
    const entries = await fs.readdir(folderPath, { withFileTypes: true });

    // Process files and subdirectories
    for (const entry of entries) {
      const fullPath = path.join(folderPath, entry.name);

      if (entry.isDirectory()) {
        // Add subfolder
        result.subfolders.push({
          name: entry.name,
          path: fullPath
        });
      } else if (entry.isFile()) {
        // Check if it's an image
        const ext = path.extname(entry.name).toLowerCase();
        if (imageExtensions.includes(ext)) {
          result.images.push({
            name: entry.name,
            path: fullPath,
            relativePath: entry.name
          });
        }
      }
    }

    return {
      success: true,
      folderPath,
      ...result
    };
  } catch (error) {
    console.error('Failed to read folder:', error);
    return { success: false, error: error.message, images: [], subfolders: [] };
  }
});

// ===== MUSIC LIBRARY ACCESS =====

ipcMain.handle('music-library-get-default-folder', async () => {
  try {
    const folderPath = app.getPath('music');
    return {
      success: true,
      folderPath,
      folderName: path.basename(folderPath) || 'Music Library'
    };
  } catch (error) {
    console.error('[Music Library] Failed to resolve Music folder:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('music-library-select-folder', async () => {
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select Music Library'
    });

    if (canceled || !filePaths || filePaths.length === 0) {
      return { canceled: true };
    }

    const folderPath = filePaths[0];
    return {
      canceled: false,
      folderPath,
      folderName: path.basename(folderPath) || 'Music Library'
    };
  } catch (error) {
    console.error('[Music Library] Failed to select folder:', error);
    return { canceled: true, error: error.message };
  }
});

ipcMain.handle('music-library-scan-folder', async (_event, requestedFolderPath) => {
  try {
    const folderPath = typeof requestedFolderPath === 'string' && requestedFolderPath.trim()
      ? requestedFolderPath
      : app.getPath('music');

    const library = await scanMusicLibrary(folderPath);
    return {
      success: true,
      folderPath,
      folderName: path.basename(folderPath) || 'Music Library',
      library
    };
  } catch (error) {
    console.error('[Music Library] Failed to scan folder:', error);
    return {
      success: false,
      error: error.message,
      library: {
        folderPath: requestedFolderPath || null,
        folderName: 'Music Library',
        trackCount: 0,
        albumCount: 0,
        artistCount: 0,
        tracks: [],
        albums: [],
        artists: [],
        scannedAt: new Date().toISOString()
      }
    };
  }
});

ipcMain.handle('music-library-resolve-playback-source', async (_event, track = {}) => {
  try {
    const sourcePath = typeof track.path === 'string' ? track.path : '';
    if (!sourcePath) {
      throw new Error('Track path is required.');
    }

    const playbackSource = await ensureTranscodedPlaybackSource(sourcePath);
    return {
      success: true,
      playbackSource
    };
  } catch (error) {
    console.error('[Music Library] Failed to resolve playback source:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// ===== MARKET APP MANAGEMENT =====

/**
 * Get the local install path for a market app.
 * Apps are installed to: <appData>/market-apps/<appId>/
 */
ipcMain.handle('market-get-app-path', async (_event, appId) => {
  const appDir = path.join(app.getPath('userData'), 'market-apps', appId);
  await fs.mkdir(appDir, { recursive: true });
  return appDir;
});

/**
 * Save a downloaded file for a market app.
 * Receives the file data as a byte array and writes it to the app directory.
 */
ipcMain.handle('market-save-file', async (_event, { appId, filePath: relPath, data }) => {
  try {
    const appDir = path.join(app.getPath('userData'), 'market-apps', appId);
    const fullPath = path.join(appDir, relPath);

    // Prevent path traversal
    const resolvedPath = path.resolve(fullPath);
    const resolvedBase = path.resolve(appDir);
    if (!resolvedPath.startsWith(resolvedBase)) {
      throw new Error('Invalid file path: attempted path traversal');
    }

    // Ensure parent directory exists
    await fs.mkdir(path.dirname(fullPath), { recursive: true });

    // Write file
    const buffer = Buffer.from(data);
    await fs.writeFile(fullPath, buffer);

    return { success: true, path: fullPath };
  } catch (error) {
    console.error('[Market] Failed to save file:', error);
    return { success: false, error: error.message };
  }
});

/**
 * Remove all files for an uninstalled market app.
 */
// ===== PHOTOS APP =====

ipcMain.handle('photos-select-folder', async () => {
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Choose a folder to add to your collection'
    });
    return { canceled: canceled || !filePaths || filePaths.length === 0, filePaths: filePaths || [] };
  } catch (error) {
    return { canceled: true, filePaths: [], error: error.message };
  }
});

ipcMain.handle('market-remove-app', async (_event, appId) => {
  try {
    const appDir = path.join(app.getPath('userData'), 'market-apps', appId);

    // Prevent path traversal
    const resolvedPath = path.resolve(appDir);
    const resolvedBase = path.resolve(path.join(app.getPath('userData'), 'market-apps'));
    if (!resolvedPath.startsWith(resolvedBase)) {
      throw new Error('Invalid app ID: attempted path traversal');
    }

    await fs.rm(appDir, { recursive: true, force: true });
    return { success: true };
  } catch (error) {
    console.error('[Market] Failed to remove app files:', error);
    return { success: false, error: error.message };
  }
});
