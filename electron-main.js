const { app, BrowserWindow, ipcMain, dialog, globalShortcut } = require('electron');
const Store = require('electron-store');
const volumeControl = require('./components/volume/volume-control');
const networkControl = require('./components/network/network-control');
const batteryControl = require('./components/battery/battery-control');
const USBMonitor = require('./components/device_connectivity/usb-monitor');
const { setupTrashHandlers } = require('./components/explorer/trash-manager');
const fs = require('fs/promises');
const path = require('path');
const { applyDefaultRegistryState } = require('./setup-registry');

// Initialize electron-store
// This will be used as the new storage backend, replacing localStorage
const store = new Store({
  name: 'config', // Creates config.json in app userData folder
  // We'll add schema validation in Phase 2
  // For now, allow any data structure during migration
});

// Keep a global reference of the window object
let mainWindow;
let installWindow;
// Store for child windows (apps)
let appWindows = new Map();
// USB Monitor instance
let usbMonitor = null;
let resetInProgress = false;

const RESET_FLAG = '--reset-setup';
const SKIP_SETUP_FLAG = '--skip-setup';
const SKIP_BOOT_FLAG = '--skip-boot';

const resetModeEnabled = process.argv.includes(RESET_FLAG);
const skipBootSequenceEnabled = process.argv.includes(SKIP_BOOT_FLAG);
const skipSetupSequenceEnabled = skipBootSequenceEnabled || process.argv.includes(SKIP_SETUP_FLAG);

function clearSetupData() {
  store.delete('setup');
  store.set('setup.completed', false);
  store.delete('setup.initialized');
  console.log('[Setup] Setup state cleared');
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
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
      nodeIntegrationInSubFrames: true,
      webviewTag: true // Enable webview tag support
    },
    frame: true, // Keep native frame
    title: 'Windows'
  });

  const syncMainWindowMenuBar = (isFullscreen) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    if (isFullscreen) {
      mainWindow.setAutoHideMenuBar(true);
      mainWindow.setMenuBarVisibility(false);
      return;
    }

    mainWindow.setAutoHideMenuBar(false);
    mainWindow.setMenuBarVisibility(true);
  };

  syncMainWindowMenuBar(mainWindow.isFullScreen());
  mainWindow.on('enter-full-screen', () => syncMainWindowMenuBar(true));
  mainWindow.on('leave-full-screen', () => syncMainWindowMenuBar(false));

  // Load the index.html
  mainWindow.loadFile('index.html');

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
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
      nodeIntegrationInSubFrames: true
    },
    title: 'Windows Setup'
  });

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
    setupTrashHandlers();

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
  });
}

// Quit when all windows are closed (including on macOS)
app.on('window-all-closed', () => {
  if (resetInProgress) {
    return;
  }
  app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
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

// ===== Notepad File Operations =====

ipcMain.handle('notepad-open-file', async () => {
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'Text Files', extensions: ['txt', 'text', 'md', 'log', 'json', 'js', 'css', 'html'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });

    if (canceled || !filePaths || filePaths.length === 0) {
      return { canceled: true };
    }

    const filePath = filePaths[0];
    const content = await fs.readFile(filePath, 'utf8');

    return {
      canceled: false,
      filePath,
      content
    };
  } catch (error) {
    console.error('Failed to open file:', error);
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
        { name: 'Text Files', extensions: ['txt', 'text', 'md', 'log'] },
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

// Clean up USB monitoring on quit
app.on('before-quit', () => {
  if (usbMonitor) {
    usbMonitor.stop();
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
      webPreferences: {
        contextIsolation: false,
        nodeIntegration: true
      }
    });

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

// ===== BATTERY CONTROL =====

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
    const devices = await usbMonitor.getDevices();
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

    let usbDriveCount = 0;

    // Send each mounted USB drive as a connection event
    drives.forEach(drive => {
      const hasMountpoints = drive.mountpoints && drive.mountpoints.length > 0;

      console.log(`[MAIN] Drive: ${drive.device}, isUSB: ${drive.isUSB}, isSystem: ${drive.isSystem}, hasMountpoints: ${hasMountpoints}`);

      // Only send non-system USB drives that are mounted
      if (drive.isUSB && !drive.isSystem && hasMountpoints) {
        usbDriveCount++;
        const devicePath = drive.device || drive.devicePath;

        // Format the drive data similar to usb-monitor.js
        const driveName = usbMonitor.getDriveName(drive);
        const driveType = 'USB Drive';
        const formattedSize = usbMonitor.formatSize(drive.size);
        const driveIcon = usbMonitor.getDriveIcon(drive);

        console.log(`[MAIN] Sending drive-connected for: ${driveName} (${devicePath})`);

        event.sender.send('drive-connected', {
          name: driveName,
          description: `${driveType} • ${formattedSize}`,
          icon: driveIcon,
          device: devicePath,
          devicePath: devicePath,
          mountpoints: drive.mountpoints,
          isUSB: drive.isUSB,
          isRemovable: drive.isRemovable,
          isSystem: drive.isSystem,
          suppressNotification: true // Suppress notifications for manually requested drive list
        });
      }
    });

    console.log(`[MAIN] Sent ${usbDriveCount} USB drives to renderer`);
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
    const { spawn } = require('child_process');
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
