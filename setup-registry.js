const { getRegistry, RegistryType, encodeStuckRects2, hexToARGB } = require('./registry/registry.js');
const {
  getDefaultDesktopBackgroundSettings,
  saveDesktopBackgroundSettings,
  toFullWallpaperPath
} = require('./registry/wallpaper-registry.js');
const {
  getDefaultThemeSettings,
  saveThemeSettings
} = require('./registry/theme-registry.js');
const {
  getDefaultLockScreenWallpaperState,
  saveLockScreenWallpaperState,
  resolveLockScreenWallpaperPath
} = require('./registry/lock-screen-registry.js');
const {
  saveCurrentStartScreenBackground,
  clearPreviousStartScreenBackground
} = require('./registry/start-background-registry.js');

/**
 * Apply baseline registry values that simulate a pristine Windows install.
 * Values derived from stock Windows 8 defaults unless overridden by setup data.
 *
 * @param {Object} [options]
 * @param {Object} [options.profile] - Selected options captured during setup.
 */
function applyDefaultRegistryState(options = {}) {
  const registry = getRegistry();
  const profile = options.profile || {};

  seedDesktopWallpaper(registry, profile);
  seedThemeDefaults();
  seedLockScreenDefaults(profile);
  seedStartBackgroundDefaults(profile);
  seedTaskbarDefaults(registry);
  seedRegisteredOwner(registry, profile);
}

function seedDesktopWallpaper(registry, profile) {
  const { loadDesktopBackgroundSettings } = require('./registry/wallpaper-registry.js');

  // Check if wallpaper settings already exist
  const WALLPAPER_SETTINGS_PATH = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Wallpapers';
  const existingSettings = registry.getValue(WALLPAPER_SETTINGS_PATH, 'SimulatorDesktopBackgroundSettings', null);

  if (existingSettings !== null && existingSettings !== undefined) {
    // Settings exist - preserve them
    return;
  }

  // No settings exist - seed defaults for first run
  const wallpaperDefaults = getDefaultDesktopBackgroundSettings();
  const normalized = saveDesktopBackgroundSettings(wallpaperDefaults);
  const wallpaperPath = toFullWallpaperPath(normalized.currentWallpaper, normalized.currentWallpaperType)
    .replace(/\//g, '\\');

  registry.setValue(
    'HKCU\\Control Panel\\Desktop',
    'Wallpaper',
    wallpaperPath,
    RegistryType.REG_SZ
  );

  const positionStyle = normalized.picturePosition || 'fill';
  const styleValue = positionStyle === 'fill' ? '10' :
    positionStyle === 'fit' ? '6' :
      positionStyle === 'stretch' ? '2' :
        positionStyle === 'tile' ? '0' : '0';
  const tileValue = positionStyle === 'tile' ? '1' : '0';

  registry.setValue('HKCU\\Control Panel\\Desktop', 'WallpaperStyle', styleValue, RegistryType.REG_SZ);
  registry.setValue('HKCU\\Control Panel\\Desktop', 'TileWallpaper', tileValue, RegistryType.REG_SZ);
  registry.setValue('HKCU\\Control Panel\\Colors', 'Background', '0 0 0', RegistryType.REG_SZ);
}

function seedThemeDefaults() {
  const registry = getRegistry();
  const THEMES_PATH = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes';
  const VALUE_CURRENT_THEME = 'CurrentTheme';

  // Check if theme settings already exist in the registry
  // Only seed defaults if the CurrentTheme key doesn't exist (first run)
  const existingTheme = registry.getValue(THEMES_PATH, VALUE_CURRENT_THEME, null);

  if (existingTheme === null || existingTheme === undefined) {
    // No theme saved yet - apply defaults for first run
    const defaults = getDefaultThemeSettings();
    saveThemeSettings(defaults);
  }
}

function seedLockScreenDefaults(profile) {
  const defaults = getDefaultLockScreenWallpaperState();
  const saved = saveLockScreenWallpaperState(defaults);
  const resolvedPath = resolveLockScreenWallpaperPath(saved.currentWallpaper, saved.currentWallpaperType);

  if (resolvedPath) {
    const registry = getRegistry();
    registry.setValue(
      'HKCU\\Control Panel\\Desktop',
      'LockScreenImage',
      resolvedPath.replace(/\//g, '\\'),
      RegistryType.REG_SZ
    );
  }

  if (profile.language) {
    const registry = getRegistry();
    registry.setValue(
      'HKCU\\Control Panel\\International',
      'Locale',
      profile.locale || profile.language,
      RegistryType.REG_SZ
    );
    registry.setValue(
      'HKCU\\Control Panel\\International',
      'LocaleName',
      profile.language,
      RegistryType.REG_SZ
    );
  }
}

function seedStartBackgroundDefaults(profile) {
  const registry = getRegistry();

  // Check if start background settings already exist
  const START_BG_PATH = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartScreen';
  const existingBg = registry.getValue(START_BG_PATH, 'CurrentBackground', null);

  if (existingBg !== null && existingBg !== undefined) {
    // Settings exist - preserve them
    return;
  }

  // No settings exist - seed defaults for first run
  const defaultBackground = {
    pattern: 1,
    variant: 1
  };

  saveCurrentStartScreenBackground(defaultBackground);
  clearPreviousStartScreenBackground();

  const accentColor = hexToARGB('#00A4EF');

  registry.setValue(
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Accent',
    'AccentColor',
    accentColor,
    RegistryType.REG_DWORD
  );

  if (profile.keyboard) {
    registry.setValue(
      'HKCU\\Keyboard Layout\\Preload',
      '1',
      profile.keyboard,
      RegistryType.REG_SZ
    );
  }
}

function seedTaskbarDefaults(registry) {
  const stuckRects = encodeStuckRects2({
    autoHide: false,
    alwaysOnTop: true,
    locked: true,
    height: 48,
    position: 3
  });

  registry.setValue(
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StuckRects2',
    'Settings',
    Array.from(stuckRects),
    RegistryType.REG_BINARY
  );

  registry.setValue(
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced',
    'ShowNotificationCenterIcon',
    1,
    RegistryType.REG_DWORD
  );

  registry.setValue(
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced',
    'UseModernWindowStyling',
    1,
    RegistryType.REG_DWORD
  );

  registry.setValue(
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced',
    'ThresholdFeaturesEnabled',
    1,
    RegistryType.REG_DWORD
  );

  registry.setValue(
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced',
    'OpenMetroAppsOnDesktop',
    0,
    RegistryType.REG_DWORD
  );
}

function seedRegisteredOwner(registry, profile) {
  const defaultOwner = profile.owner || 'Simulator User';

  registry.setValue(
    'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion',
    'RegisteredOwner',
    defaultOwner,
    RegistryType.REG_SZ
  );

  registry.setValue(
    'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion',
    'RegisteredOrganization',
    profile.organization || 'Windows Simulator',
    RegistryType.REG_SZ
  );
}

module.exports = {
  applyDefaultRegistryState
};

