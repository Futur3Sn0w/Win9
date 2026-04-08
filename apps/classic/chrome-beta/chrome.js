const APP_ID = 'chrome-beta';
const BASE_TITLE = 'Google Chrome Beta';
const PERSISTENCE_KEY = `${APP_ID}:state`;
const HOME_URL = 'https://www.google.com/';
const SEARCH_ENGINES = {
    google: {
        label: 'Google',
        queryUrl: 'https://www.google.com/search?q=',
        suggestUrl: 'https://suggestqueries.google.com/complete/search?client=firefox&q=',
        suggestFormat: 'osjson'
    },
    bing: {
        label: 'Bing',
        queryUrl: 'https://www.bing.com/search?q=',
        suggestUrl: 'https://api.bing.com/osjson.aspx?query=',
        suggestFormat: 'osjson'
    },
    duckduckgo: {
        label: 'DuckDuckGo',
        queryUrl: 'https://duckduckgo.com/?q=',
        suggestUrl: 'https://duckduckgo.com/ac/?type=list&q=',
        suggestFormat: 'duckduckgo'
    }
};
const CHROMIUM_STATUS_BUBBLE = {
    showDelayMs: 80,
    hideDelayMs: 250,
    showFadeDurationMs: 120,
    hideFadeDurationMs: 200,
    expandHoverDelayMs: 1600,
    mousePaddingPx: 20
};

let electronIpc = null;
let electronClipboard = null;
let electronNativeImage = null;
try {
    ({ ipcRenderer: electronIpc, clipboard: electronClipboard, nativeImage: electronNativeImage } = require('electron'));
} catch (_error) {
    electronIpc = null;
    electronClipboard = null;
    electronNativeImage = null;
}

let nodeHttps = null;
try {
    nodeHttps = require('https');
} catch (_error) {
    nodeHttps = null;
}

const DEFAULT_BOOKMARKS = [
    { type: 'url', label: 'Google', address: 'https://www.google.com/', faviconUrl: 'https://www.google.com/favicon.ico' },
    {
        type: 'folder',
        label: 'Projects',
        children: [
            { type: 'url', label: 'GitHub', address: 'https://github.com/', faviconUrl: 'https://github.com/favicon.ico' },
            { type: 'url', label: 'Chromium', address: 'https://www.chromium.org/', faviconUrl: 'https://www.chromium.org/favicon.ico' },
            { type: 'url', label: 'Settings', address: 'chrome://settings/' }
        ]
    },
    { type: 'url', label: 'YouTube', address: 'https://www.youtube.com/', faviconUrl: 'https://www.youtube.com/favicon.ico' },
    { type: 'url', label: 'Wikipedia', address: 'https://en.wikipedia.org/', faviconUrl: 'https://en.wikipedia.org/static/favicon/wikipedia.ico' },
    { type: 'url', label: 'Downloads', address: 'chrome://downloads/' },
    { type: 'url', label: 'About', address: 'chrome://about/' }
];

const MOST_VISITED_TILES = [
    { title: 'Google', address: 'https://www.google.com/', description: 'www.google.com', badge: 'G', accentClass: 'is-google', faviconUrl: 'https://www.google.com/favicon.ico' },
    { title: 'YouTube', address: 'https://www.youtube.com/', description: 'www.youtube.com', badge: 'YT', accentClass: 'is-youtube', faviconUrl: 'https://www.youtube.com/favicon.ico' },
    { title: 'Wikipedia', address: 'https://en.wikipedia.org/', description: 'en.wikipedia.org', badge: 'W', accentClass: 'is-wikipedia', faviconUrl: 'https://en.wikipedia.org/static/favicon/wikipedia.ico' },
    { title: 'GitHub', address: 'https://github.com/', description: 'github.com', badge: 'GH', accentClass: 'is-github', faviconUrl: 'https://github.com/favicon.ico' },
    { title: 'Chromium', address: 'https://www.chromium.org/', description: 'www.chromium.org', badge: 'CR', accentClass: 'is-chromium', faviconUrl: 'https://www.chromium.org/favicon.ico' },
    { title: 'Gmail', address: 'https://mail.google.com/', description: 'mail.google.com', badge: 'GM', accentClass: 'is-gmail' },
    { title: 'Downloads', address: 'chrome://downloads/', description: 'chrome://downloads', badge: 'DL', accentClass: 'is-downloads' },
    { title: 'Settings', address: 'chrome://settings/', description: 'chrome://settings', badge: 'ST', accentClass: 'is-settings' }
];

const SAMPLE_DOWNLOADS = [
    {
        id: 'chrome-installer',
        name: 'ChromeSetup.exe',
        address: 'https://dl.google.com/chrome/install/ChromeSetup.exe',
        domain: 'dl.google.com',
        size: '1.4 MB',
        status: 'Completed',
        kind: 'exe',
        period: 'Today',
        stamp: '4:21 PM'
    },
    {
        id: 'tabstrip-reference',
        name: 'tabstrip-reference.png',
        address: 'https://developer.chrome.com/',
        domain: 'developer.chrome.com',
        size: '842 KB',
        status: 'Completed',
        kind: 'image',
        period: 'Yesterday',
        stamp: '11:08 PM'
    },
    {
        id: 'chromium-notes',
        name: 'chromium-ui-notes.pdf',
        address: 'https://www.chromium.org/',
        domain: 'www.chromium.org',
        size: '2.9 MB',
        status: 'Completed',
        kind: 'pdf',
        period: 'Earlier this week',
        stamp: 'Monday'
    }
];

function createSampleHistoryItems() {
    return [];
}

function isLegacySeededHistoryItems(items) {
    if (!Array.isArray(items) || items.length !== 8) {
        return false;
    }

    const legacyAddresses = [
        'https://www.chromium.org/',
        'chrome://downloads/',
        'https://www.youtube.com/',
        'https://en.wikipedia.org/',
        'chrome://settings/',
        'https://github.com/',
        'https://www.google.com/',
        'chrome://flags/'
    ];

    return items.every((item, index) =>
        item &&
        item.address === legacyAddresses[index] &&
        !Object.prototype.hasOwnProperty.call(item, 'visitedAt')
    );
}

const SAMPLE_EXTENSIONS = [
    {
        id: 'google-docs',
        title: 'Google Docs',
        version: '1.12',
        description: 'Create and edit documents directly in Chrome.',
        enabled: true,
        iconType: 'docs',
        siteLabel: 'View in Chrome Web Store',
        siteAddress: 'https://chromewebstore.google.com/'
    },
    {
        id: 'google-drive',
        title: 'Google Drive',
        version: '2.5',
        description: 'Quickly save and open files from Drive.',
        enabled: true,
        iconType: 'drive',
        siteLabel: 'Visit website',
        siteAddress: 'https://drive.google.com/'
    },
    {
        id: 'chrome-ui-tools',
        title: 'Chrome UI Inspector',
        version: '0.43',
        description: 'Internal unpacked helper used to compare toolbar and tab metrics.',
        enabled: false,
        iconType: 'tools',
        unpacked: true,
        siteLabel: 'Source folder',
        siteAddress: 'https://www.chromium.org/'
    }
];

const SAMPLE_FLAGS = [
    {
        internalName: 'enable-icon-ntp',
        name: 'Use icon-based New Tab Page',
        description: 'Shows the experimental icon-tile New Tab Page layout.',
        supportedPlatforms: ['Windows', 'Mac', 'Linux', 'Chrome OS'],
        enabled: false,
        supported: true
    },
    {
        internalName: 'enable-zero-suggest',
        name: 'Omnibox zero suggest on focus',
        description: 'Shows focus-only omnibox suggestions on non-New Tab pages, inspired by Chrome 49 ZeroSuggest experiments.',
        supportedPlatforms: ['Windows', 'Mac', 'Linux', 'Chrome OS'],
        enabled: false,
        supported: true
    },
    {
        internalName: 'enable-remote-omnibox-suggestions',
        name: 'Remote search suggestions in omnibox',
        description: 'Fetches live search suggestions from the active search engine while typing in the omnibox.',
        supportedPlatforms: ['Windows', 'Mac', 'Linux', 'Chrome OS'],
        enabled: false,
        supported: true
    }
];

function createDefaultFlags() {
    return SAMPLE_FLAGS.map((flag) => ({ ...flag }));
}

const CHROMIUM_TOP_CHROME = {
    tabOverlap: 26,
    standardTabWidth: 218,
    minimumTabWidth: 64,
    compactTabWidth: 156,
    miniTabWidth: 96
};

const CHROMIUM_MOTION = {
    tabBoundsDurationMs: 200,
    tabHoverDurationMs: 400,
    easeOut: 'cubic-bezier(0, 0, 0.2, 1)'
};

const BOOKMARK_BAR_METRICS = {
    attachedHeight: 28,
    overlapWithToolbar: 3,
    leftMargin: 1,
    rightMargin: 1,
    bottomMargin: 2,
    buttonPadding: 0,
    buttonInsetX: 6,
    buttonInsetY: 4,
    maxButtonWidth: 150,
    menuShowDelayMs: 400
};

const TAB_DRAG_THRESHOLD_PX = 8;
const TAB_TEAROUT_MARGIN_X_PX = 40;
const TAB_TEAROUT_MARGIN_Y_PX = 24;
const PRESET_ZOOM_FACTORS = [0.25, 0.333, 0.5, 0.666, 0.75, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0, 4.0, 5.0];

class ChromeClassicApp {
    constructor() {
        this.instanceRoot = this.resolveInstanceRoot();
        this.chromeShell = this.instanceRoot?.querySelector('.chrome-shell') || null;
        this.chromeFrame = this.instanceRoot?.querySelector('.chrome-frame') || null;
        this.tabsRoot = null;
        this.pageHost = this.instanceRoot?.querySelector('#pageHost') || null;
        this.contentArea = this.instanceRoot?.querySelector('.chrome-content-area') || null;
        this.addressForm = this.instanceRoot?.querySelector('#addressForm') || null;
        this.addressInput = this.instanceRoot?.querySelector('#addressInput') || null;
        this.addressDisplay = this.instanceRoot?.querySelector('#addressDisplay') || null;
        this.securityBadge = this.instanceRoot?.querySelector('#securityBadge') || null;
        this.zoomIndicator = this.instanceRoot?.querySelector('#zoomIndicator') || null;
        this.backButton = this.instanceRoot?.querySelector('#backButton') || null;
        this.forwardButton = this.instanceRoot?.querySelector('#forwardButton') || null;
        this.refreshButton = this.instanceRoot?.querySelector('#refreshButton') || null;
        this.homeButton = this.instanceRoot?.querySelector('#homeButton') || null;
        this.menuButton = this.instanceRoot?.querySelector('#menuButton') || null;
        this.favoriteButton = this.instanceRoot?.querySelector('#favoriteButton') || null;
        this.newTabButton = null;
        this.toolbarActions = this.instanceRoot?.querySelector('#toolbarActions') || null;
        this.bookmarkBar = this.instanceRoot?.querySelector('#bookmarkBar') || null;
        this.appMenu = this.instanceRoot?.querySelector('#appMenu') || null;
        this.statusPill = this.instanceRoot?.querySelector('#statusPill') || null;

        // Parent-hosted layers (created in mount* methods)
        this.hostedWebviewContainer = null;
        this.hostedTopChrome = null;
        this.hostedTopChromeSpacer = null;
        this.hostedOverlayLayer = null;
        this.hostedDragLayer = null;
        this.hostedMenu = null;
        this.hostedMenuSubmenu = null;
        this.hostedMenuBackdrop = null;
        this.hostedWebviewContextMenuBackdrop = null;
        this.hostedBookmarkPopup = null;
        this.hostedBookmarkBubble = null;
        this.hostedBookmarkContextMenu = null;
        this.hostedTabContextMenu = null;
        this.hostedBookmarkEditor = null;
        this.hostedDownloadPrompt = null;
        this.hostedZoomBubble = null;
        this.hostedOmniboxPopup = null;
        this.hostedPageInfoBubble = null;
        this.hostedStatusBubble = null;
        this.hostedWebviewContextMenu = null;
        this.hostedOverscrollLayer = null;
        this.hostedOverscrollTargetPane = null;
        this.hostedOverscrollCurrentPane = null;
        this.hostedOverscrollIndicator = null;
        this.hostedDownloadShelf = null;

        this.tabs = [];
        this.activeTabId = null;
        this.hostWindow = null;
        this.directLoadedHost = null;
        this.hostContent = null;
        this.hostTitlebar = null;
        this.hostTitlebarAppRegion = null;
        this.pointerDocument = null;
        this.usesHostedTabStrip = false;
        this.windowId = null;
        this.statusHideTimer = null;
        this.statusIsTemporary = false;
        this.hoverStatusShowTimer = null;
        this.hoverStatusHideTimer = null;
        this.hoverStatusExpandTimer = null;
        this.hoverStatusVisible = false;
        this.lastWebviewMousePoint = null;
        this.bookmarks = this.cloneBookmarks(DEFAULT_BOOKMARKS);
        this.downloadItems = SAMPLE_DOWNLOADS.map((download) => this.normalizeStoredDownloadItem(download));
        this.localUiState = {
            downloadsFilter: '',
            historyFilter: '',
            historyItems: createSampleHistoryItems(),
            bookmarkManagerFilter: '',
            bookmarkManagerFolderId: 'bookmark-bar-root',
            ntpQuery: '',
            hiddenNtpTileAddresses: [],
            ntpFakeboxState: 'idle',
            extensionsDeveloperMode: false,
            flagsNeedsRestart: false,
            flagsExperiments: createDefaultFlags(),
            appliedFlagsExperiments: createDefaultFlags(),
            settings: {
                startupMode: 'new-tab',
                startupPages: ['https://www.google.com/'],
                showHomeButton: true,
                homePageMode: 'new-tab',
                homePageUrl: HOME_URL,
                showBookmarksBar: true,
                defaultSearchEngine: 'google',
                isDefaultBrowser: false
            }
        };
        this.persistedSession = null;
        this.tabAnimationCleanupTimer = null;
        this.pendingTabDrag = null;
        this.tabDragState = null;
        this.incomingExternalTabDrag = null;
        this.suppressNextTabClick = false;
        this.pendingBookmarkDrag = null;
        this.bookmarkDragState = null;
        this.suppressNextBookmarkClick = false;
        this.bookmarkDropHoverTimer = null;
        this.bookmarkLayout = { hiddenIds: [] };
        this.bookmarkPopupState = null;
        this.bookmarkHoverTimer = null;
        this.bookmarkBubbleState = null;
        this.bookmarkContextMenuState = null;
        this.tabContextMenuState = null;
        this.recentlyClosedTabs = [];
        this.bookmarkClipboard = null;
        this.bookmarkEditorState = null;
        this.pendingDownloadPrompts = [];
        this.activeDownloadPrompt = null;
        this.webviewContextMenuState = null;
        this.addressIsFocused = false;
        this.menuZoomPercent = 100;
        this.zoomBubbleTimer = null;
        this.omniboxSuggestions = [];
        this.omniboxSelectedIndex = -1;
        this.omniboxUserText = '';
        this.omniboxTemporaryTextActive = false;
        this.omniboxRemoteSuggestions = [];
        this.omniboxRemoteSuggestionsQuery = '';
        this.omniboxRemoteSuggestTimer = null;
        this.omniboxRemoteSuggestRequestId = 0;
        this.swipeNavigationState = null;
        this.swipeNavigationFinishTimer = null;
        this.recentDownloadEventKeys = [];
        this.launchOptionsApplied = false;
        this.pendingLaunchOptions = null;
        this.suppressSessionPersistence = false;

        this.init();
    }

    resolveInstanceRoot() {
        const currentScript = document.currentScript;
        if (currentScript?.closest) {
            const directLoadedRoot = currentScript.closest('.direct-loaded-content');
            if (directLoadedRoot) {
                directLoadedRoot.setAttribute('data-chrome-beta-bound', 'true');
                return directLoadedRoot;
            }
        }

        const unboundRoots = Array.from(document.querySelectorAll('.direct-loaded-content[data-app-id="chrome-beta"]:not([data-chrome-beta-bound])'));
        const fallbackRoot = unboundRoots[unboundRoots.length - 1] || null;
        if (fallbackRoot) {
            fallbackRoot.setAttribute('data-chrome-beta-bound', 'true');
            return fallbackRoot;
        }

        return document;
    }

    init() {
        this.captureWindowIdentity();
        this.loadPersistentState();
        this.mountHostedTabStrip();
        this.mountHostedTopChrome();
        this.mountHostedWebviews();
        this.mountHostedOverlay();
        this.mountHostedDownloadShelf();
        this.applySurfacePreferences();
        this.renderBookmarks();
        this.bindEvents();
        this.applyLaunchOptions(this.pendingLaunchOptions);
        this.bootstrapTabs();
        window.requestAnimationFrame(() => {
            this.syncWebviewOffset();
            this.refreshAddressDisplay();
            this.renderTabs();
        });
        this.notifyReady();
    }

    loadPersistentState() {
        try {
            const raw = window.localStorage.getItem(PERSISTENCE_KEY);
            if (!raw) {
                return;
            }

            const state = JSON.parse(raw);
            if (state?.settings) {
                this.localUiState.settings = {
                    ...this.localUiState.settings,
                    ...state.settings
                };
            }

            if (Array.isArray(state?.historyItems)) {
                this.localUiState.historyItems = isLegacySeededHistoryItems(state.historyItems)
                    ? []
                    : state.historyItems.map((item) => ({ ...item }));
            }

            if (Array.isArray(state?.bookmarks)) {
                this.bookmarks = this.cloneBookmarks(state.bookmarks, 'bookmark-persisted');
            }

            if (Array.isArray(state?.downloadItems)) {
                this.downloadItems = state.downloadItems.map((item) => this.normalizeStoredDownloadItem(item));
            }

            if (Array.isArray(state?.flagsExperiments)) {
                this.localUiState.flagsExperiments = this.mergePersistedFlags(state.flagsExperiments, SAMPLE_FLAGS);
            }

            if (Array.isArray(state?.appliedFlagsExperiments)) {
                this.localUiState.appliedFlagsExperiments = this.mergePersistedFlags(
                    state.appliedFlagsExperiments,
                    SAMPLE_FLAGS
                );
            } else {
                this.localUiState.appliedFlagsExperiments = this.localUiState.flagsExperiments.map((flag) => ({ ...flag }));
            }

            if (typeof state?.flagsNeedsRestart === 'boolean') {
                this.localUiState.flagsNeedsRestart = state.flagsNeedsRestart;
            } else {
                this.localUiState.flagsNeedsRestart = this.havePendingFlagChanges();
            }

            if (!this.suppressSessionPersistence && state?.session && Array.isArray(state.session.tabs)) {
                this.persistedSession = {
                    tabs: state.session.tabs.filter((address) => typeof address === 'string' && address.trim()),
                    activeIndex: Number.isInteger(state.session.activeIndex) ? state.session.activeIndex : 0
                };
            }
        } catch (error) {
            console.warn('Failed to load Chrome Beta persisted state', error);
        }
    }

    savePersistentState() {
        try {
            let preservedSession = null;
            if (this.suppressSessionPersistence) {
                try {
                    const existingRaw = window.localStorage.getItem(PERSISTENCE_KEY);
                    if (existingRaw) {
                        const existingState = JSON.parse(existingRaw);
                        if (existingState?.session && Array.isArray(existingState.session.tabs)) {
                            preservedSession = existingState.session;
                        }
                    }
                } catch (error) {
                    console.warn('Failed to preserve Chrome Beta session state', error);
                }
            }

            const state = {
                settings: this.localUiState.settings,
                historyItems: this.localUiState.historyItems,
                bookmarks: this.serializeBookmarks(),
                downloadItems: this.downloadItems.map((item) => this.serializeDownloadItem(item)),
                flagsExperiments: this.localUiState.flagsExperiments,
                appliedFlagsExperiments: this.localUiState.appliedFlagsExperiments,
                flagsNeedsRestart: this.localUiState.flagsNeedsRestart,
                session: this.suppressSessionPersistence ? preservedSession : {
                    tabs: this.tabs.map((tab) => tab.address),
                    activeIndex: Math.max(0, this.tabs.findIndex((tab) => tab.id === this.activeTabId))
                }
            };
            window.localStorage.setItem(PERSISTENCE_KEY, JSON.stringify(state));
        } catch (error) {
            console.warn('Failed to save Chrome Beta persisted state', error);
        }
    }

    mergePersistedFlags(persistedFlags, defaults) {
        const persistedMap = new Map(
            (persistedFlags || [])
                .filter((flag) => flag && typeof flag.internalName === 'string')
                .map((flag) => [flag.internalName, flag])
        );

        return defaults.map((flag) => ({
            ...flag,
            ...(persistedMap.get(flag.internalName) || {})
        }));
    }

    havePendingFlagChanges() {
        return this.localUiState.flagsExperiments.some((flag) => {
            const applied = this.localUiState.appliedFlagsExperiments.find(
                (candidate) => candidate.internalName === flag.internalName
            );
            return !!applied && applied.enabled !== flag.enabled;
        });
    }

    isFlagEnabled(internalName, options = {}) {
        const source = options.pending
            ? this.localUiState.flagsExperiments
            : this.localUiState.appliedFlagsExperiments;
        return !!source.find((flag) => flag.internalName === internalName && flag.enabled);
    }

    serializeTabState(tab) {
        if (!tab?.address) {
            return null;
        }

        return {
            address: tab.address,
            title: tab.title || '',
            faviconUrl: tab.faviconUrl || null,
            zoomPercent: this.getTabZoomPercent(tab),
            loading: !!tab.loading,
            networkState: tab.networkState || 'none',
            historyEntries: Array.isArray(tab.historyEntries) && tab.historyEntries.length
                ? [...tab.historyEntries]
                : [tab.address],
            historyIndex: Number.isInteger(tab.historyIndex) ? tab.historyIndex : 0
        };
    }

    createRestoredTabState(serializedTab) {
        if (!serializedTab?.address) {
            return null;
        }

        const normalized = this.normalizeAddress(serializedTab.address);
        const isLocal = this.isLocalAddress(normalized);
        const historyEntries = Array.isArray(serializedTab.historyEntries) && serializedTab.historyEntries.length
            ? serializedTab.historyEntries.map((entry) => this.normalizeAddress(entry))
            : [normalized];
        const clampedHistoryIndex = Math.max(
            0,
            Math.min(
                Number.isInteger(serializedTab.historyIndex) ? serializedTab.historyIndex : historyEntries.length - 1,
                historyEntries.length - 1
            )
        );

        const tab = {
            id: `chrome-tab-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            title: serializedTab.title || (isLocal ? this.getLocalPageTitle(normalized) : normalized),
            address: normalized,
            isLocal,
            webview: null,
            webviewReady: false,
            zoomPercent: Math.max(25, Math.min(500, Math.round(Number(serializedTab.zoomPercent) || 100))),
            loading: false,
            networkState: 'none',
            faviconUrl: serializedTab.faviconUrl || null,
            historyEntries,
            historyIndex: clampedHistoryIndex,
            pendingHistoryCommit: null,
            suppressHistoryCommit: false,
            nativeCanGoBack: false,
            nativeCanGoForward: false,
            canGoBack: false,
            canGoForward: false,
            historyPreviewCache: {}
        };

        tab.address = historyEntries[clampedHistoryIndex] || normalized;
        tab.isLocal = this.isLocalAddress(tab.address);
        if (!tab.title) {
            tab.title = tab.isLocal ? this.getLocalPageTitle(tab.address) : tab.address;
        }

        return tab;
    }

    insertRestoredTab(serializedTab, options = {}) {
        const restoredTab = this.createRestoredTabState(serializedTab);
        if (!restoredTab) {
            return null;
        }

        const previousLayout = this.snapshotTabStripLayout();
        const insertIndex = Number.isInteger(options.index)
            ? Math.max(0, Math.min(options.index, this.tabs.length))
            : this.tabs.length;
        this.tabs.splice(insertIndex, 0, restoredTab);

        if (options.activate !== false) {
            this.activeTabId = restoredTab.id;
        }

        this.renderTabs({
            previousLayout,
            enteringTabId: restoredTab.id
        });

        if (options.activate !== false) {
            this.activateTab(restoredTab.id, { skipRender: true });
        }

        this.savePersistentState();
        return restoredTab;
    }

    applyWindowState(windowState) {
        if (this.launchOptionsApplied || !windowState || !Array.isArray(windowState.tabs) || !windowState.tabs.length) {
            return false;
        }

        const restoredTabs = windowState.tabs
            .map((serializedTab) => this.createRestoredTabState(serializedTab))
            .filter(Boolean);

        if (!restoredTabs.length) {
            return false;
        }

        this.tabs.forEach((tab) => {
            if (tab.webview) {
                tab.webview.remove();
                tab.webview = null;
                tab.webviewReady = false;
            }
        });

        this.closeBookmarkPopup();
        this.closeBookmarkBubble({ applyEdits: false });
        this.closeBookmarkContextMenu();
        this.closeBookmarkEditor();
        this.closeZoomBubble();
        this.closePageInfoBubble();
        this.closeOmniboxPopup({ restoreUserText: true });

        this.tabs = restoredTabs;
        const activeIndex = Math.max(
            0,
            Math.min(Number.isInteger(windowState.activeIndex) ? windowState.activeIndex : 0, restoredTabs.length - 1)
        );
        this.activeTabId = restoredTabs[activeIndex].id;
        this.localUiState.ntpFakeboxState = 'idle';
        this.launchOptionsApplied = true;

        this.renderTabs();
        this.activateTab(this.activeTabId, { skipRender: true });
        this.savePersistentState();
        return true;
    }

    applyLaunchOptions(launchOptions) {
        if (!launchOptions || this.launchOptionsApplied) {
            return;
        }

        if (launchOptions.chromeBetaWindowState) {
            this.applyWindowState(launchOptions.chromeBetaWindowState);
        }
    }

    captureWindowIdentity() {
        this.hostIframe = window.frameElement || null;
        const directLoadedHost = this.instanceRoot?.classList?.contains('direct-loaded-content')
            ? this.instanceRoot
            : (this.chromeShell?.closest('.direct-loaded-content') || null);
        this.directLoadedHost = directLoadedHost;
        if (this.directLoadedHost) {
            this.directLoadedHost.__chromeClassicAppInstance = this;
        }
        this.hostWindow = this.hostIframe?.closest('.classic-app-container')
            || this.directLoadedHost?.closest('.classic-app-container')
            || null;
        if (this.hostWindow) {
            this.hostWindow.__chromeClassicAppInstance = this;
        }
        this.pendingLaunchOptions = this.directLoadedHost?.__hostLaunchOptions || null;
        this.suppressSessionPersistence = !!this.pendingLaunchOptions?.chromeBetaWindowState;
        this.hostContent = this.hostWindow?.querySelector('.classic-window-content') || null;
        this.hostTitlebar = this.hostWindow?.querySelector('.classic-window-titlebar') || null;
        this.hostTitlebarAppRegion = this.hostWindow?.querySelector('.classic-window-titlebar-app-region') || null;
        this.windowId = this.hostWindow?.getAttribute('data-window-id') || this.hostWindow?.id || null;
        const topWindow = window.top || window.parent || window;
        if (this.windowId && typeof topWindow.consumeClassicWindowLaunchOptions === 'function') {
            const consumedLaunchOptions = topWindow.consumeClassicWindowLaunchOptions(this.windowId);
            if (consumedLaunchOptions) {
                this.pendingLaunchOptions = consumedLaunchOptions;
                this.suppressSessionPersistence = !!this.pendingLaunchOptions?.chromeBetaWindowState;
            }
        }
    }

    mountHostedTabStrip() {
        if (!this.hostTitlebarAppRegion || !this.chromeShell) {
            return;
        }

        const parentDocument = this.hostTitlebarAppRegion.ownerDocument;
        const hostedStrip = parentDocument.createElement('div');
        hostedStrip.className = 'chrome-hosted-tabstrip';

        this.tabsRoot = parentDocument.createElement('div');
        this.tabsRoot.className = 'chrome-tabs';
        this.tabsRoot.id = 'chromeTabs';
        this.tabsRoot.setAttribute('role', 'tablist');
        this.tabsRoot.setAttribute('aria-label', 'Tabs');

        this.newTabButton = parentDocument.createElement('button');
        this.newTabButton.className = 'chrome-new-tab-button';
        this.newTabButton.id = 'newTabButton';
        this.newTabButton.type = 'button';
        this.newTabButton.setAttribute('aria-label', 'New tab');
        this.newTabButton.innerHTML = '<span class="chrome-new-tab-glyph" aria-hidden="true">+</span>';

        hostedStrip.appendChild(this.tabsRoot);
        hostedStrip.appendChild(this.newTabButton);
        this.hostTitlebarAppRegion.appendChild(hostedStrip);
        this.pointerDocument = parentDocument;

        this.chromeShell.classList.add('has-hosted-tabstrip');
        this.usesHostedTabStrip = true;
    }

    /**
     * Create a webview container in the parent document (outside the iframe)
     * so webviews work without nesting issues.
     */
    mountHostedWebviews() {
        if (!this.hostContent) {
            return;
        }

        const parentDoc = this.hostContent.ownerDocument;
        const container = parentDoc.createElement('div');
        container.className = 'chrome-hosted-webview-layer';
        container.style.cssText = 'position:absolute; left:0; right:0; bottom:0; top:0; z-index:1; display:none; pointer-events:auto;';
        this.hostContent.style.position = 'relative';
        this.hostContent.appendChild(container);
        this.hostedWebviewContainer = container;

        // Sync the top offset so webviews sit below the Chrome toolbar.
        // The toolbar lives inside the iframe, so we measure its height.
        this.syncWebviewOffset();
    }

    mountHostedTopChrome() {
        if (!this.hostContent || !this.chromeFrame || !this.chromeShell || !this.contentArea) {
            return;
        }

        const parentDoc = this.hostContent.ownerDocument;
        const topChrome = parentDoc.createElement('div');
        topChrome.className = 'chrome-hosted-top-chrome';
        topChrome.appendChild(this.chromeFrame);
        this.hostContent.appendChild(topChrome);
        this.hostedTopChrome = topChrome;

        const spacer = document.createElement('div');
        spacer.className = 'chrome-hosted-top-spacer';
        this.chromeShell.insertBefore(spacer, this.contentArea);
        this.hostedTopChromeSpacer = spacer;
        this.chromeShell.classList.add('has-hosted-top-chrome');
        this.syncHostedTopChromeHeight();
    }

    /**
     * Create an overlay layer in the parent document above the webview
     * layer for menus and popups. Because webview elements are GPU-
     * composited, only elements in the same document can reliably
     * paint on top of them via z-index.
     */
    mountHostedOverlay() {
        if (!this.hostContent) {
            return;
        }

        const parentDoc = this.hostContent.ownerDocument;

        const dragLayer = parentDoc.createElement('div');
        dragLayer.className = 'chrome-hosted-drag-layer';
        dragLayer.style.cssText = 'position:absolute; inset:0; z-index:7; pointer-events:none;';
        this.hostContent.appendChild(dragLayer);
        this.hostedDragLayer = dragLayer;

        // Overlay layer — sits above the webview layer and hosted top chrome.
        const layer = parentDoc.createElement('div');
        layer.className = 'chrome-hosted-overlay-layer';
        layer.style.cssText = 'position:absolute; inset:0; z-index:8; pointer-events:none;';
        this.hostContent.appendChild(layer);
        this.hostedOverlayLayer = layer;

        // Invisible backdrop captures clicks-outside-the-menu
        const backdrop = parentDoc.createElement('div');
        backdrop.style.cssText = 'position:absolute; inset:0; display:none; pointer-events:auto;';
        backdrop.addEventListener('click', () => this.setMenuOpen(false));
        layer.appendChild(backdrop);
        this.hostedMenuBackdrop = backdrop;

        // The menu itself
        const menu = parentDoc.createElement('div');
        menu.className = 'chrome-hosted-menu';
        menu.hidden = true;
        layer.appendChild(menu);
        this.hostedMenu = menu;

        const submenu = parentDoc.createElement('div');
        submenu.className = 'chrome-hosted-menu chrome-hosted-submenu';
        submenu.hidden = true;
        layer.appendChild(submenu);
        this.hostedMenuSubmenu = submenu;

        menu.addEventListener('click', (event) => this.handleHostedMenuClick(event));
        submenu.addEventListener('click', (event) => this.handleHostedMenuClick(event));
        menu.addEventListener('mouseover', (event) => this.handleHostedMenuPointerOver(event));
        submenu.addEventListener('mouseover', (event) => this.handleHostedMenuPointerOver(event));

        const bookmarkPopup = parentDoc.createElement('div');
        bookmarkPopup.className = 'chrome-hosted-bookmark-popup';
        bookmarkPopup.hidden = true;
        layer.appendChild(bookmarkPopup);
        this.hostedBookmarkPopup = bookmarkPopup;

        const bookmarkBubble = parentDoc.createElement('div');
        bookmarkBubble.className = 'chrome-hosted-bookmark-bubble';
        bookmarkBubble.hidden = true;
        layer.appendChild(bookmarkBubble);
        this.hostedBookmarkBubble = bookmarkBubble;

        const bookmarkContextMenu = parentDoc.createElement('div');
        bookmarkContextMenu.className = 'chrome-hosted-bookmark-context-menu';
        bookmarkContextMenu.hidden = true;
        layer.appendChild(bookmarkContextMenu);
        this.hostedBookmarkContextMenu = bookmarkContextMenu;

        const tabContextMenu = parentDoc.createElement('div');
        tabContextMenu.className = 'chrome-hosted-tab-context-menu';
        tabContextMenu.hidden = true;
        tabContextMenu.addEventListener('click', (event) => this.handleTabContextMenuClick(event));
        layer.appendChild(tabContextMenu);
        this.hostedTabContextMenu = tabContextMenu;

        const bookmarkEditor = parentDoc.createElement('div');
        bookmarkEditor.className = 'chrome-hosted-bookmark-editor';
        bookmarkEditor.hidden = true;
        layer.appendChild(bookmarkEditor);
        this.hostedBookmarkEditor = bookmarkEditor;

        const downloadPrompt = parentDoc.createElement('div');
        downloadPrompt.className = 'chrome-hosted-download-prompt';
        downloadPrompt.hidden = true;
        layer.appendChild(downloadPrompt);
        this.hostedDownloadPrompt = downloadPrompt;

        const zoomBubble = parentDoc.createElement('div');
        zoomBubble.className = 'chrome-hosted-zoom-bubble';
        zoomBubble.hidden = true;
        layer.appendChild(zoomBubble);
        this.hostedZoomBubble = zoomBubble;

        const pageInfoBubble = parentDoc.createElement('div');
        pageInfoBubble.className = 'chrome-hosted-page-info-bubble';
        pageInfoBubble.hidden = true;
        layer.appendChild(pageInfoBubble);
        this.hostedPageInfoBubble = pageInfoBubble;

        const statusBubble = parentDoc.createElement('div');
        statusBubble.className = 'chrome-hosted-status-bubble';
        statusBubble.hidden = true;
        layer.appendChild(statusBubble);
        this.hostedStatusBubble = statusBubble;

        const omniboxPopup = parentDoc.createElement('div');
        omniboxPopup.className = 'chrome-hosted-omnibox-popup';
        omniboxPopup.hidden = true;
        omniboxPopup.addEventListener('pointerdown', (event) => {
            event.preventDefault();
        });
        omniboxPopup.addEventListener('mouseover', (event) => this.handleOmniboxPopupPointerOver(event));
        omniboxPopup.addEventListener('click', (event) => this.handleOmniboxPopupClick(event));
        layer.appendChild(omniboxPopup);
        this.hostedOmniboxPopup = omniboxPopup;

        const webviewContextMenu = parentDoc.createElement('div');
        const webviewContextMenuBackdrop = parentDoc.createElement('div');
        webviewContextMenuBackdrop.className = 'chrome-hosted-webview-context-menu-backdrop';
        webviewContextMenuBackdrop.hidden = true;
        webviewContextMenuBackdrop.addEventListener('pointerdown', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.closeWebviewContextMenu();
        });
        webviewContextMenuBackdrop.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.closeWebviewContextMenu();
        });
        layer.appendChild(webviewContextMenuBackdrop);
        this.hostedWebviewContextMenuBackdrop = webviewContextMenuBackdrop;

        webviewContextMenu.className = 'chrome-hosted-webview-context-menu';
        webviewContextMenu.hidden = true;
        webviewContextMenu.addEventListener('click', (event) => this.handleWebviewContextMenuClick(event));
        layer.appendChild(webviewContextMenu);
        this.hostedWebviewContextMenu = webviewContextMenu;

        const overscrollLayer = parentDoc.createElement('div');
        overscrollLayer.className = 'chrome-hosted-overscroll-layer';
        overscrollLayer.hidden = true;
        this.hostContent.appendChild(overscrollLayer);
        this.hostedOverscrollLayer = overscrollLayer;

        const overscrollTarget = parentDoc.createElement('div');
        overscrollTarget.className = 'chrome-hosted-overscroll-pane chrome-hosted-overscroll-target';
        overscrollLayer.appendChild(overscrollTarget);
        this.hostedOverscrollTargetPane = overscrollTarget;

        const overscrollCurrent = parentDoc.createElement('div');
        overscrollCurrent.className = 'chrome-hosted-overscroll-pane chrome-hosted-overscroll-current';
        overscrollLayer.appendChild(overscrollCurrent);
        this.hostedOverscrollCurrentPane = overscrollCurrent;

        const overscrollIndicator = parentDoc.createElement('div');
        overscrollIndicator.className = 'chrome-hosted-overscroll-indicator';
        overscrollLayer.appendChild(overscrollIndicator);
        this.hostedOverscrollIndicator = overscrollIndicator;
    }

    mountHostedDownloadShelf() {
        if (!this.hostContent) {
            return;
        }

        const parentDoc = this.hostContent.ownerDocument;
        const shelf = parentDoc.createElement('div');
        shelf.className = 'chrome-hosted-download-shelf';
        shelf.hidden = true;
        shelf.addEventListener('click', (event) => this.handleDownloadShelfClick(event));
        this.hostContent.appendChild(shelf);
        this.hostedDownloadShelf = shelf;
        this.renderDownloadShelf();
    }

    /**
     * Measure where the content area starts inside the iframe and
     * offset the parent-hosted webview layer to match.
     */
    syncWebviewOffset() {
        if (!this.hostedWebviewContainer || !this.contentArea) {
            return;
        }

        this.syncHostedTopChromeHeight();
        const offsetTop = this.contentArea.getBoundingClientRect().top;
        const shelfHeight = this.hostedDownloadShelf && !this.hostedDownloadShelf.hidden
            ? Math.ceil(this.hostedDownloadShelf.getBoundingClientRect().height)
            : 0;
        this.hostedWebviewContainer.style.top = offsetTop + 'px';
        this.hostedWebviewContainer.style.bottom = shelfHeight + 'px';
        if (this.hostedOverscrollLayer) {
            this.hostedOverscrollLayer.style.top = offsetTop + 'px';
            this.hostedOverscrollLayer.style.bottom = shelfHeight + 'px';
        }
    }

    syncHostedTopChromeHeight() {
        if (!this.hostedTopChrome || !this.hostedTopChromeSpacer) {
            return;
        }

        const height = Math.ceil(this.hostedTopChrome.getBoundingClientRect().height);
        this.hostedTopChromeSpacer.style.height = height + 'px';
    }

    /**
     * Show or hide the app menu in the parent-hosted overlay layer.
     */
    setMenuOpen(open) {
        if (!this.hostedOverlayLayer || !this.hostedMenu) {
            // Fallback for when parent hosting is unavailable
            this.appMenu.hidden = !open;
            return;
        }

        if (open) {
            this.closeBookmarkBubble({ applyEdits: true });
            this.closeBookmarkPopup();
            this.closeBookmarkContextMenu();
            this.closeTabContextMenu();
            this.closeBookmarkEditor();
            this.closeWebviewContextMenu();
            this.closeZoomBubble();
            this.closePageInfoBubble();
            this.closeOmniboxPopup({ restoreUserText: true });
            this.renderHostedAppMenu();
            // Position the menu relative to the menu button
            const btnRect = this.menuButton.getBoundingClientRect();
            const hostRect = this.hostContent.getBoundingClientRect();
            this.hostedMenu.style.top = (btnRect.bottom - hostRect.top) + 'px';
            this.hostedMenu.style.right = (hostRect.right - btnRect.right) + 'px';
            this.hostedMenu.hidden = false;
            this.closeHostedMenuSubmenu();
            if (this.hostedMenuBackdrop) {
                this.hostedMenuBackdrop.style.display = '';
            }
        } else {
            this.hostedMenu.hidden = true;
            this.closeHostedMenuSubmenu();
            if (this.hostedMenuBackdrop) {
                this.hostedMenuBackdrop.style.display = 'none';
            }
        }
    }

    renderHostedAppMenu() {
        if (!this.hostedMenu) {
            return;
        }

        this.hostedMenu.innerHTML = this.renderHostedMenuGroups(this.getHostedAppMenuGroups());
    }

    renderHostedMenuGroups(groups) {
        return groups.map((group) => `
            <div class="chrome-hosted-menu-group">
                ${group.map((item) => this.renderHostedMenuEntry(item)).join('')}
            </div>
        `).join('<div class="chrome-hosted-menu-separator"></div>');
    }

    renderHostedMenuEntry(item) {
        if (item.kind === 'control-row') {
            return `
                <div class="chrome-hosted-menu-control-row" data-menu-row-kind="${this.escapeHtml(item.rowKind || '')}">
                    <span class="chrome-hosted-menu-control-label">${this.escapeHtml(item.label)}</span>
                    <div class="chrome-hosted-menu-control-buttons">
                        ${item.buttons.map((button) => this.renderHostedMenuControlButton(button)).join('')}
                    </div>
                </div>
            `;
        }

        const classes = ['chrome-hosted-menu-item'];
        if (item.type === 'checkbox') {
            classes.push('is-checkbox');
            if (item.checked) {
                classes.push('is-checked');
            }
        }
        if (item.submenu) {
            classes.push('has-submenu');
        }

        return `
            <button
                class="${classes.join(' ')}"
                type="button"
                ${item.action ? `data-menu-action="${this.escapeHtml(item.action)}"` : ''}
                ${item.submenu ? `data-menu-submenu="${this.escapeHtml(item.submenu)}"` : ''}
                ${item.disabled ? 'disabled' : ''}
            >
                <span class="chrome-hosted-menu-check" aria-hidden="true"></span>
                <span class="chrome-hosted-menu-label">${this.escapeHtml(item.label)}</span>
                ${item.shortcut ? `<span class="chrome-hosted-menu-shortcut">${this.escapeHtml(item.shortcut)}</span>` : ''}
                ${item.submenu ? '<span class="chrome-hosted-menu-arrow" aria-hidden="true"></span>' : ''}
            </button>
        `;
    }

    renderHostedMenuControlButton(button) {
        const classes = ['chrome-hosted-menu-control-button'];
        if (button.kind === 'zoom-display') {
            classes.push('is-zoom-display');
        }
        if (button.kind === 'fullscreen') {
            classes.push('is-fullscreen');
        }

        return `
            <button
                class="${classes.join(' ')}"
                type="button"
                data-menu-action="${this.escapeHtml(button.action)}"
                ${button.disabled ? 'disabled' : ''}
                title="${this.escapeHtml(button.title || button.label || '')}"
            >
                ${button.kind === 'fullscreen'
                    ? '<span class="chrome-hosted-menu-fullscreen-glyph" aria-hidden="true"></span>'
                    : `<span class="chrome-hosted-menu-control-button-label">${this.escapeHtml(button.label || '')}</span>`}
            </button>
        `;
    }

    getHostedAppMenuGroups() {
        const bookmarksChecked = !!this.localUiState.settings.showBookmarksBar;
        const otherTabs = this.tabs.filter((tab) => tab.id !== this.activeTabId);

        return [
            [
                { action: 'new-tab', label: 'New tab', shortcut: 'Ctrl+T' },
                { action: 'new-window', label: 'New window', shortcut: 'Ctrl+N' },
                { action: 'new-incognito-window', label: 'New incognito window', shortcut: 'Ctrl+Shift+N' }
            ],
            [
                { submenu: 'bookmarks', label: 'Bookmarks' },
                { submenu: 'recent-tabs', label: 'Recent tabs', disabled: otherTabs.length === 0 && !this.localUiState.historyItems.length }
            ],
            [
                {
                    kind: 'control-row',
                    rowKind: 'edit',
                    label: 'Edit',
                    buttons: [
                        { action: 'cut', label: 'Cut' },
                        { action: 'copy', label: 'Copy' },
                        { action: 'paste', label: 'Paste' }
                    ]
                }
            ],
            [
                { action: 'save-page', label: 'Save page as...', shortcut: 'Ctrl+S' },
                { action: 'find', label: 'Find...', shortcut: 'Ctrl+F' },
                { action: 'print', label: 'Print...', shortcut: 'Ctrl+P' }
            ],
            [
                {
                    kind: 'control-row',
                    rowKind: 'zoom',
                    label: 'Zoom',
                    buttons: [
                        { action: 'zoom-minus', label: '-' },
                        { action: 'zoom-reset', label: `${this.menuZoomPercent}%`, kind: 'zoom-display' },
                        { action: 'zoom-plus', label: '+' },
                        { action: 'fullscreen', label: '', kind: 'fullscreen', title: 'Full screen' }
                    ]
                }
            ],
            [
                { action: 'history', label: 'History', shortcut: 'Ctrl+H' },
                { action: 'downloads', label: 'Downloads', shortcut: 'Ctrl+J' }
            ],
            [
                { action: 'settings', label: 'Settings' },
                { action: 'about-beta', label: 'About Google Chrome Beta' },
                { submenu: 'help', label: 'Help' }
            ],
            [
                { submenu: 'more-tools', label: 'More tools' }
            ],
            [
                { action: 'exit', label: 'Exit' }
            ]
        ];
    }

    getHostedSubmenuGroups(submenuId) {
        switch (submenuId) {
            case 'bookmarks':
                return [
                    [
                        {
                            action: 'show-bookmarks-bar',
                            label: 'Show bookmarks bar',
                            type: 'checkbox',
                            checked: !!this.localUiState.settings.showBookmarksBar
                        },
                        { action: 'bookmark-manager', label: 'Bookmark manager' },
                        { action: 'import-bookmarks-settings', label: 'Import bookmarks and settings...' }
                    ],
                    [
                        { action: 'bookmark-page', label: 'Bookmark this page' },
                        { action: 'bookmark-all-tabs', label: 'Bookmark all tabs...' }
                    ]
                ];
            case 'recent-tabs': {
                const openTabs = this.tabs
                    .filter((tab) => tab.id !== this.activeTabId)
                    .slice(0, 8)
                    .map((tab) => ({
                        action: `activate-tab:${tab.id}`,
                        label: tab.title || tab.address || 'Untitled tab'
                    }));
                const recentHistory = this.localUiState.historyItems
                    .filter((item) => item.address !== this.getActiveTab()?.address)
                    .slice(0, 5)
                    .map((item) => ({
                        action: `open-address:${item.address}`,
                        label: item.title || item.address
                    }));

                const groups = [];
                if (openTabs.length) {
                    groups.push(openTabs);
                }
                if (recentHistory.length) {
                    groups.push(recentHistory);
                }
                if (!groups.length) {
                    groups.push([{ label: 'No recent tabs', disabled: true }]);
                }
                return groups;
            }
            case 'help':
                return [
                    [
                        { action: 'help-center', label: 'Chrome Help' },
                        { action: 'report-issue', label: 'Report an issue...' }
                    ]
                ];
            case 'more-tools':
                return [
                    [
                        { action: 'extensions', label: 'Extensions' },
                        { action: 'task-manager', label: 'Task manager' },
                        { action: 'clear-browsing-data', label: 'Clear browsing data...' }
                    ],
                    [
                        { action: 'view-source', label: 'View source' },
                        { action: 'developer-tools', label: 'Developer tools' }
                    ]
                ];
            default:
                return [];
        }
    }

    openHostedMenuSubmenu(anchorElement, submenuId) {
        if (!this.hostedMenuSubmenu || !this.hostContent) {
            return;
        }

        const groups = this.getHostedSubmenuGroups(submenuId);
        if (!groups.length) {
            this.closeHostedMenuSubmenu();
            return;
        }

        this.hostedMenu.querySelectorAll('[data-menu-submenu]').forEach((button) => {
            button.classList.toggle('is-submenu-open', button === anchorElement);
        });

        this.hostedMenuSubmenu.innerHTML = this.renderHostedMenuGroups(groups);
        this.hostedMenuSubmenu.hidden = false;

        const anchorRect = this.getHostAlignedClientRect(anchorElement);
        const hostRect = this.hostContent.getBoundingClientRect();
        this.hostedMenuSubmenu.style.left = `${Math.max(0, anchorRect.right - hostRect.left - 4)}px`;
        this.hostedMenuSubmenu.style.top = `${Math.max(0, anchorRect.top - hostRect.top - 4)}px`;

        window.requestAnimationFrame(() => {
            if (!this.hostedMenuSubmenu || this.hostedMenuSubmenu.hidden) {
                return;
            }

            const submenuRect = this.hostedMenuSubmenu.getBoundingClientRect();
            let left = anchorRect.right - hostRect.left - 4;
            let top = anchorRect.top - hostRect.top - 4;

            if (left + submenuRect.width > hostRect.width - 6) {
                left = Math.max(6, anchorRect.left - hostRect.left - submenuRect.width + 4);
            }
            if (top + submenuRect.height > hostRect.height - 6) {
                top = Math.max(6, hostRect.height - submenuRect.height - 6);
            }

            this.hostedMenuSubmenu.style.left = `${Math.max(6, left)}px`;
            this.hostedMenuSubmenu.style.top = `${Math.max(6, top)}px`;
        });
    }

    closeHostedMenuSubmenu() {
        if (this.hostedMenuSubmenu) {
            this.hostedMenuSubmenu.hidden = true;
            this.hostedMenuSubmenu.innerHTML = '';
        }

        this.hostedMenu?.querySelectorAll('[data-menu-submenu].is-submenu-open').forEach((button) => {
            button.classList.remove('is-submenu-open');
        });
    }

    handleHostedMenuPointerOver(event) {
        const submenuTrigger = event.target.closest('[data-menu-submenu]');
        if (submenuTrigger && this.hostedMenu?.contains(submenuTrigger)) {
            this.openHostedMenuSubmenu(submenuTrigger, submenuTrigger.dataset.menuSubmenu);
            return;
        }

        if (!event.target.closest('.chrome-hosted-submenu') && this.hostedMenuSubmenu && !this.hostedMenuSubmenu.hidden) {
            this.closeHostedMenuSubmenu();
        }
    }

    handleHostedMenuClick(event) {
        const submenuTrigger = event.target.closest('[data-menu-submenu]');
        if (submenuTrigger && !submenuTrigger.hasAttribute('disabled')) {
            event.preventDefault();
            event.stopPropagation();
            this.openHostedMenuSubmenu(submenuTrigger, submenuTrigger.dataset.menuSubmenu);
            return;
        }

        const actionTarget = event.target.closest('[data-menu-action]');
        if (!actionTarget || actionTarget.hasAttribute('disabled')) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        const keepOpen = this.handleMenuAction(actionTarget.dataset.menuAction) === true;
        if (keepOpen) {
            this.renderHostedAppMenu();
            return;
        }

        this.setMenuOpen(false);
    }

    bootstrapTabs() {
        if (this.tabs.length) {
            return;
        }

        const startupMode = this.localUiState.settings.startupMode;
        const startupPages = this.localUiState.settings.startupPages || [];
        const sessionTabs = this.persistedSession?.tabs || [];
        let initialTabs = ['chrome://newtab/'];

        if (startupMode === 'last-session' && sessionTabs.length) {
            initialTabs = sessionTabs;
        } else if (startupMode === 'specific-pages' && startupPages.length) {
            initialTabs = startupPages;
        }

        initialTabs.forEach((address) => this.createTab(address, { activate: false }));

        const activeIndex = startupMode === 'last-session' && this.persistedSession?.activeIndex != null
            ? Math.min(Math.max(this.persistedSession.activeIndex, 0), this.tabs.length - 1)
            : 0;

        this.activateTab(this.tabs[activeIndex]?.id || this.tabs[0]?.id);
    }

    bindEvents() {
        this.newTabButton.addEventListener('click', () => {
            this.createTab('chrome://newtab/');
        });

        if (this.tabsRoot) {
            this.tabsRoot.addEventListener('pointerdown', (event) => this.handleTabPointerDown(event));
            this.tabsRoot.parentElement?.addEventListener('contextmenu', (event) => {
                const target = this.getElementTarget(event.target);
                if (target?.closest?.('[data-tab-id]')) {
                    return;
                }

                event.preventDefault();
                event.stopPropagation();
                this.showTabContextMenu(null, event.clientX, event.clientY, { strip: true });
            });
        }

        this.newTabButton?.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.showTabContextMenu(null, event.clientX, event.clientY, { strip: true });
        });

        this.hostTitlebarAppRegion?.addEventListener('contextmenu', (event) => {
            const target = this.getElementTarget(event.target);
            if (!target || target.closest?.('.classic-window-controls') || target.closest?.('.chrome-toolbar')) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            this.showTabContextMenu(null, event.clientX, event.clientY, { strip: true });
        });

        this.bookmarkBar.addEventListener('pointerdown', (event) => this.handleBookmarkPointerDown(event));

        if (this.pointerDocument) {
            this.pointerDocument.addEventListener('pointermove', (event) => this.handleGlobalPointerMove(event));
            this.pointerDocument.addEventListener('pointerup', (event) => this.handleGlobalPointerUp(event));
            this.pointerDocument.addEventListener('pointercancel', (event) => this.handleGlobalPointerUp(event));
        }

        this.addressForm.addEventListener('submit', (event) => {
            event.preventDefault();
            if (this.hostedOmniboxPopup && !this.hostedOmniboxPopup.hidden && this.omniboxSelectedIndex >= 0) {
                this.commitOmniboxSelection();
            } else {
                this.closeOmniboxPopup();
                this.navigateCurrentTab(this.addressInput.value);
            }
            this.addressInput.blur();
        });

        this.addressInput.addEventListener('focus', () => {
            this.addressIsFocused = true;
            this.omniboxUserText = this.addressInput.value;
            this.omniboxTemporaryTextActive = false;
            this.syncNewTabOmniboxFocusState(true);
            this.refreshAddressDisplay();
            this.updateSecurityBadge(this.addressInput.value, { editing: true });
            this.updateZoomUi();
            this.addressInput.select();
            if (this.shouldOpenZeroSuggestOnFocus()) {
                this.updateOmniboxPopup({ fromFocus: true });
            }
        });

        this.addressInput.addEventListener('blur', () => {
            this.addressIsFocused = false;
            this.clearRemoteOmniboxSuggestions();
            this.closeOmniboxPopup({ restoreUserText: true });
            this.syncNewTabOmniboxFocusState(false);
            this.refreshAddressDisplay();
            this.updateSecurityBadge(this.getActiveTab()?.address || this.addressInput.value);
            this.updateZoomUi();
        });

        this.addressInput.addEventListener('input', () => {
            this.omniboxUserText = this.addressInput.value;
            this.omniboxTemporaryTextActive = false;
            this.handleNewTabOmniboxInput();
            this.refreshAddressDisplay();
            if (this.addressIsFocused) {
                this.updateSecurityBadge(this.addressInput.value, { editing: true });
                this.updateOmniboxPopup();
            }
        });

        this.addressInput.addEventListener('keydown', (event) => this.handleAddressInputKeyDown(event));

        this.zoomIndicator?.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.toggleZoomBubble();
        });

        this.backButton.addEventListener('click', () => this.goBack());
        this.forwardButton.addEventListener('click', () => this.goForward());
        this.refreshButton.addEventListener('click', () => this.refreshActiveTab());
        this.homeButton.addEventListener('click', () => this.navigateCurrentTab(this.getHomePageUrl()));

        this.favoriteButton.addEventListener('click', () => {
            const activeTab = this.getActiveTab();
            if (!activeTab) {
                return;
            }

            let bookmark = this.findBookmarkByAddress(activeTab.address);
            const newlyBookmarked = !bookmark;

            if (!bookmark) {
                const label = this.getBookmarkLabelForAddress(activeTab.address, activeTab.title);
                bookmark = this.createBookmarkNode({
                    type: 'url',
                    label,
                    address: activeTab.address,
                    faviconUrl: this.getTabFaviconUrl(activeTab)
                });
                this.bookmarks.push(bookmark);
                this.renderBookmarks();
                this.savePersistentState();
            }

            this.refreshBookmarkStar();
            this.showBookmarkBubble(bookmark, { newlyBookmarked });
        });

        this.securityBadge?.addEventListener('pointerdown', (event) => {
            this.handleLocationBadgePointerDown(event);
        });
        this.securityBadge?.addEventListener('click', (event) => {
            this.handleSecurityBadgeClick(event);
        });

        this.menuButton.addEventListener('click', (event) => {
            event.stopPropagation();
            const isCurrentlyOpen = this.hostedMenu
                ? !this.hostedMenu.hidden
                : !this.appMenu.hidden;
            this.setMenuOpen(!isCurrentlyOpen);
        });

        this.bookmarkBar.addEventListener('click', (event) => {
            const button = event.target.closest('[data-bookmark-id], [data-bookmark-overflow]');
            if (!button) {
                return;
            }

            if (this.suppressNextBookmarkClick) {
                this.suppressNextBookmarkClick = false;
                event.preventDefault();
                event.stopPropagation();
                return;
            }

            event.stopPropagation();
            this.handleBookmarkBarActivation(button);
        });

        this.bookmarkBar.addEventListener('auxclick', (event) => {
            if (event.button !== 1) {
                return;
            }

            const button = event.target.closest('[data-bookmark-id]');
            if (!button || button.hasAttribute('data-bookmark-overflow')) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            this.handleBookmarkBarAuxClick(button);
        });

        this.bookmarkBar.addEventListener('mouseover', (event) => {
            const button = event.target.closest('[data-bookmark-id], [data-bookmark-overflow]');
            if (!button) {
                return;
            }

            this.handleBookmarkBarHover(button);
        });

        this.bookmarkBar.addEventListener('mouseout', (event) => {
            const relatedTarget = event.relatedTarget;
            if (relatedTarget && this.bookmarkBar.contains(relatedTarget)) {
                return;
            }

            this.cancelBookmarkHoverTimer();
            if (!this.hostedBookmarkPopup || !relatedTarget || !this.hostedBookmarkPopup.contains(relatedTarget)) {
                this.hideHoverStatus();
            }
        });

        this.bookmarkBar.addEventListener('contextmenu', (event) => {
            this.handleBookmarkContextMenu(event);
        });

        this.hostedBookmarkPopup?.addEventListener('click', (event) => {
            const item = event.target.closest('[data-popup-bookmark-id]');
            if (!item) {
                return;
            }

            if (this.suppressNextBookmarkClick) {
                this.suppressNextBookmarkClick = false;
                event.preventDefault();
                event.stopPropagation();
                return;
            }

            event.stopPropagation();
            this.handleBookmarkPopupActivation(item);
        });

        this.hostedBookmarkPopup?.addEventListener('auxclick', (event) => {
            if (event.button !== 1) {
                return;
            }

            const item = event.target.closest('[data-popup-bookmark-id]');
            if (!item) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            this.handleBookmarkPopupAuxClick(item);
        });

        this.hostedBookmarkPopup?.addEventListener('mouseover', (event) => {
            const item = event.target.closest('[data-popup-bookmark-id]');
            if (!item) {
                return;
            }

            this.handleBookmarkPopupHover(item);
        });

        this.hostedBookmarkPopup?.addEventListener('mouseout', (event) => {
            const relatedTarget = event.relatedTarget;
            if (relatedTarget && this.hostedBookmarkPopup.contains(relatedTarget)) {
                return;
            }

            this.cancelBookmarkHoverTimer();
            if (!relatedTarget || !this.bookmarkBar.contains(relatedTarget)) {
                this.hideHoverStatus();
            }
        });

        this.hostedBookmarkPopup?.addEventListener('pointerdown', (event) => {
            this.handleBookmarkPopupPointerDown(event);
        });

        this.hostedBookmarkPopup?.addEventListener('contextmenu', (event) => {
            this.handleBookmarkContextMenu(event);
        });

        this.hostedBookmarkContextMenu?.addEventListener('click', (event) => {
            const item = event.target.closest('[data-bookmark-context-action]');
            if (!item || item.hasAttribute('disabled')) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            this.handleBookmarkContextAction(item.dataset.bookmarkContextAction);
        });

        this.hostedBookmarkEditor?.addEventListener('click', (event) => {
            const actionTarget = event.target.closest('[data-bookmark-editor-action]');
            if (!actionTarget) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();

            switch (actionTarget.dataset.bookmarkEditorAction) {
                case 'cancel':
                    this.closeBookmarkEditor();
                    break;
                case 'save':
                    this.applyBookmarkEditor();
                    break;
                default:
                    break;
            }
        });

        this.hostedBookmarkEditor?.addEventListener('submit', (event) => {
            const form = event.target;
            if (!this.isElementNode(form) || !form.closest('.chrome-bookmark-editor-dialog')) {
                return;
            }

            event.preventDefault();
            this.applyBookmarkEditor();
        });

        this.hostedDownloadPrompt?.addEventListener('click', (event) => {
            const actionTarget = event.target.closest('[data-download-prompt-action]');
            if (!actionTarget) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            this.handleDownloadPromptAction(actionTarget.dataset.downloadPromptAction);
        });

        this.hostedBookmarkBubble?.addEventListener('click', (event) => {
            const actionTarget = event.target.closest('[data-bookmark-bubble-action]');
            if (!actionTarget) {
                return;
            }

            event.stopPropagation();

            switch (actionTarget.dataset.bookmarkBubbleAction) {
                case 'remove':
                    this.removeBookmarkFromBubble();
                    break;
                case 'edit':
                    this.showStatus('Full bookmark editor is not implemented yet.', true);
                    break;
                case 'done':
                    this.closeBookmarkBubble({ applyEdits: true });
                    break;
                default:
                    break;
            }
        });

        this.hostedBookmarkBubble?.addEventListener('change', (event) => {
            const target = event.target;
            if (!this.isSelectElement(target) || target.dataset.bookmarkBubbleField !== 'folder') {
                return;
            }

            if (target.value === 'choose-another-folder') {
                target.value = this.bookmarkBubbleState?.folderId || 'bookmark-bar-root';
                this.showStatus('Full bookmark folder chooser is not implemented yet.', true);
                return;
            }

            if (this.bookmarkBubbleState) {
                this.bookmarkBubbleState.folderId = target.value;
            }
        });

        this.pageHost.addEventListener('click', (event) => {
            const bookmarkContextAction = event.target.closest('[data-bookmark-context-action]');
            if (bookmarkContextAction && !bookmarkContextAction.hasAttribute('disabled')) {
                event.preventDefault();
                event.stopPropagation();
                this.handleBookmarkContextAction(bookmarkContextAction.dataset.bookmarkContextAction);
                return;
            }

            const downloadActionTarget = event.target.closest('[data-download-action]');
            if (downloadActionTarget && !downloadActionTarget.hasAttribute('disabled')) {
                this.handleDownloadShelfClick(event);
                return;
            }

            const folderTarget = event.target.closest('[data-bookmark-manager-folder-id]');
            if (folderTarget) {
                event.preventDefault();
                event.stopPropagation();
                this.localUiState.bookmarkManagerFolderId = folderTarget.dataset.bookmarkManagerFolderId || 'bookmark-bar-root';
                this.localUiState.bookmarkManagerFilter = '';
                this.renderCurrentLocalPage();
                return;
            }

            const actionTarget = event.target.closest('[data-address], [data-action]');
            if (!actionTarget) {
                return;
            }

            const ntpCloseButton = event.target.closest('.chrome-ntp-tile-close');
            if (ntpCloseButton && actionTarget.dataset.address) {
                event.preventDefault();
                event.stopPropagation();
                this.blacklistNtpTile(actionTarget.dataset.address);
                return;
            }

            if (actionTarget.dataset.address) {
                this.navigateCurrentTab(actionTarget.dataset.address);
                return;
            }

            switch (actionTarget.dataset.action) {
                case 'new-tab':
                    this.createTab('chrome://newtab/');
                    break;
                case 'focus-omnibox':
                    this.handleNtpFakeboxActivation();
                    this.addressInput.focus();
                    this.addressInput.select();
                    break;
                case 'show-settings':
                    this.navigateCurrentTab('chrome://settings/');
                    break;
                case 'show-history':
                    this.navigateCurrentTab('chrome://history/');
                    break;
                case 'show-extensions':
                    this.navigateCurrentTab('chrome://extensions/');
                    break;
                case 'show-flags':
                    this.navigateCurrentTab('chrome://flags/');
                    break;
                case 'show-about':
                    this.navigateCurrentTab('chrome://about/');
                    break;
                case 'show-version':
                    this.navigateCurrentTab('chrome://version/');
                    break;
                case 'show-help':
                    this.navigateCurrentTab('chrome://about/');
                    break;
                case 'show-downloads':
                    this.navigateCurrentTab('chrome://downloads/');
                    break;
                case 'show-bookmarks':
                    this.navigateCurrentTab('chrome://bookmarks/');
                    break;
                case 'bookmark-manager-folders-menu':
                    this.showBookmarkManagerFoldersMenu(actionTarget);
                    break;
                case 'bookmark-manager-organize-menu':
                    this.showBookmarkManagerOrganizeMenu(actionTarget);
                    break;
                case 'clear-downloads':
                    this.downloadItems = [];
                    this.localUiState.downloadsFilter = '';
                    this.renderDownloadShelf();
                    this.renderCurrentLocalPage();
                    this.savePersistentState();
                    this.showStatus('Download history cleared.', true);
                    break;
                case 'open-downloads-folder':
                    this.performDownloadAction('open-downloads-folder').then((result) => {
                        if (!result?.success) {
                            this.showStatus(result?.error || 'Unable to open downloads folder.', true);
                        }
                    });
                    break;
                case 'set-default-browser':
                    this.localUiState.settings.isDefaultBrowser = true;
                    this.renderCurrentLocalPage();
                    this.savePersistentState();
                    this.showStatus('Chrome Beta is now marked as your default browser in this simulation.', true);
                    break;
                case 'manage-search-engines':
                    this.navigateCurrentTab('chrome://settings/searchEngines/');
                    break;
                case 'startup-pages':
                    this.localUiState.settings.startupPages = this.captureStartupPagesFromCurrentTabs();
                    this.localUiState.settings.startupMode = 'specific-pages';
                    this.renderCurrentLocalPage();
                    this.savePersistentState();
                    this.showStatus(`${this.localUiState.settings.startupPages.length} startup page${this.localUiState.settings.startupPages.length === 1 ? '' : 's'} saved.`, true);
                    break;
                case 'use-current-page-home': {
                    const activeTab = this.getActiveTab();
                    const nextAddress = activeTab?.address && activeTab.address !== 'chrome://settings/'
                        ? activeTab.address
                        : HOME_URL;
                    this.localUiState.settings.homePageMode = 'custom';
                    this.localUiState.settings.homePageUrl = nextAddress;
                    this.renderCurrentLocalPage();
                    this.savePersistentState();
                    this.showStatus('Current page saved as your Home page.', true);
                    break;
                }
                case 'remove-startup-page': {
                    const address = actionTarget.dataset.startupPageAddress;
                    this.localUiState.settings.startupPages =
                        (this.localUiState.settings.startupPages || []).filter((pageAddress) => pageAddress !== address);
                    if (this.localUiState.settings.startupPages.length === 0) {
                        this.localUiState.settings.startupMode = 'new-tab';
                    }
                    this.renderCurrentLocalPage();
                    this.savePersistentState();
                    break;
                }
                case 'clear-history':
                    this.localUiState.historyItems = [];
                    this.localUiState.historyFilter = '';
                    this.renderCurrentLocalPage();
                    this.savePersistentState();
                    this.showStatus('Browsing history cleared.', true);
                    break;
                case 'toggle-extensions-dev':
                    this.localUiState.extensionsDeveloperMode = !this.localUiState.extensionsDeveloperMode;
                    this.renderCurrentLocalPage();
                    break;
                case 'load-unpacked-extension':
                case 'pack-extension':
                case 'update-extensions-now':
                    this.showStatus('Extension management actions are not implemented yet.', true);
                    break;
                case 'flags-reset-all':
                    this.localUiState.flagsExperiments = createDefaultFlags();
                    this.localUiState.flagsNeedsRestart = this.havePendingFlagChanges();
                    this.renderCurrentLocalPage();
                    this.savePersistentState();
                    break;
                case 'flags-restart':
                    this.localUiState.appliedFlagsExperiments = this.localUiState.flagsExperiments.map((flag) => ({ ...flag }));
                    this.localUiState.flagsNeedsRestart = false;
                    this.savePersistentState();
                    this.relaunchWindow();
                    break;
                case 'toggle-flag': {
                    const flagName = actionTarget.dataset.flagName;
                    const experiment = this.localUiState.flagsExperiments.find((flag) => flag.internalName === flagName);
                    if (experiment && experiment.supported) {
                        experiment.enabled = !experiment.enabled;
                        this.localUiState.flagsNeedsRestart = this.havePendingFlagChanges();
                        this.renderCurrentLocalPage();
                        this.savePersistentState();
                    }
                    break;
                }
                default:
                    break;
            }
        });

        this.pageHost.addEventListener('submit', (event) => {
            const form = event.target.closest('[data-local-form]');
            if (!form) {
                return;
            }

            event.preventDefault();

            switch (form.dataset.localForm) {
                case 'ntp-search': {
                    const input = form.querySelector('input[name="q"]');
                    const query = input?.value.trim() || '';
                    this.localUiState.ntpQuery = query;
                    if (query) {
                        this.navigateCurrentTab(query);
                    }
                    break;
                }
                case 'bookmark-manager-search':
                    break;
                default:
                    break;
            }
        });

        this.pageHost.addEventListener('input', (event) => {
            const target = event.target;
            if (!this.isInputElement(target)) {
                return;
            }

            if (target.matches('[data-downloads-filter]')) {
                this.localUiState.downloadsFilter = target.value;
                this.applyDownloadsFilter();
            } else if (target.matches('[data-history-filter]')) {
                this.localUiState.historyFilter = target.value;
                this.applyHistoryFilter();
            } else if (target.matches('[data-bookmark-manager-filter]')) {
                this.localUiState.bookmarkManagerFilter = target.value;
                this.renderCurrentLocalPage();
            } else if (target.matches('[data-ntp-query]')) {
                this.localUiState.ntpQuery = target.value;
            }
        });

        this.pageHost.addEventListener('dragenter', (event) => {
            const target = this.isElementNode(event.target)
                ? event.target.closest('.chrome-ntp-fakebox input')
                : null;
            if (!target) {
                return;
            }

            event.preventDefault();
            this.handleNtpFakeboxDragFocus(true);
        });

        this.pageHost.addEventListener('dragover', (event) => {
            const target = this.isElementNode(event.target)
                ? event.target.closest('.chrome-ntp-fakebox input')
                : null;
            if (!target) {
                return;
            }

            event.preventDefault();
        });

        this.pageHost.addEventListener('dragleave', (event) => {
            const target = this.isElementNode(event.target)
                ? event.target.closest('.chrome-ntp-fakebox input')
                : null;
            if (!target) {
                return;
            }

            this.handleNtpFakeboxDragFocus(false);
        });

        this.pageHost.addEventListener('drop', (event) => {
            const target = this.isElementNode(event.target)
                ? event.target.closest('.chrome-ntp-fakebox input')
                : null;
            if (!target) {
                return;
            }

            event.preventDefault();
            const text = event.dataTransfer?.getData('text/plain')?.trim();
            this.handleNtpFakeboxDragFocus(false);
            this.handleNtpFakeboxActivation();
            this.addressInput.focus();
            if (text) {
                this.addressInput.value = text;
                this.addressInput.dispatchEvent(new Event('input', { bubbles: true }));
            }
        });

        this.pageHost.addEventListener('change', (event) => {
            const target = event.target;
            if (!(this.isInputElement(target) || this.isSelectElement(target))) {
                return;
            }

            if (this.isInputElement(target) && target.matches('[data-extension-dev-toggle]')) {
                this.localUiState.extensionsDeveloperMode = target.checked;
                this.renderCurrentLocalPage();
                return;
            }

            const key = target.dataset.settingKey;
            if (!key) {
                return;
            }

            switch (key) {
                case 'startupMode':
                    if (this.isInputElement(target) && target.checked) {
                        this.localUiState.settings.startupMode = target.value;
                        if (target.value === 'specific-pages' && !(this.localUiState.settings.startupPages || []).length) {
                            this.localUiState.settings.startupPages = ['chrome://newtab/'];
                        }
                        this.renderCurrentLocalPage();
                        this.savePersistentState();
                        this.showStatus(`Startup mode set to ${target.dataset.settingLabel || target.value}.`, true);
                    }
                    break;
                case 'showHomeButton':
                    if (this.isInputElement(target)) {
                        this.localUiState.settings.showHomeButton = target.checked;
                        this.applySurfacePreferences();
                        this.renderCurrentLocalPage();
                        this.savePersistentState();
                    }
                    break;
                case 'homePageMode':
                    if (this.isInputElement(target) && target.checked) {
                        this.localUiState.settings.homePageMode = target.value;
                        this.renderCurrentLocalPage();
                        this.savePersistentState();
                    }
                    break;
                case 'homePageUrl':
                    if (this.isInputElement(target)) {
                        const nextValue = target.value.trim();
                        this.localUiState.settings.homePageUrl = nextValue || HOME_URL;
                        this.savePersistentState();
                        this.showStatus(`Home page set to ${this.localUiState.settings.homePageUrl}.`, true);
                    }
                    break;
                case 'showBookmarksBar':
                    if (this.isInputElement(target)) {
                        this.localUiState.settings.showBookmarksBar = target.checked;
                        this.applySurfacePreferences();
                        this.savePersistentState();
                    }
                    break;
                case 'defaultSearchEngine':
                    this.localUiState.settings.defaultSearchEngine = target.value;
                    this.savePersistentState();
                    this.showStatus(`Default search engine set to ${this.getSearchEngineLabel()}.`, true);
                    break;
                default:
                    break;
            }
        });

        this.pageHost.addEventListener('contextmenu', (event) => {
            this.handlePageHostContextMenu(event);
        });

        document.addEventListener('click', (event) => {
            if (!event.target.closest('.chrome-menu-button')) {
                this.setMenuOpen(false);
            }
        });

        document.addEventListener('pointerdown', (event) => {
            if (!this.isElementNode(event.target)) {
                return;
            }

            if (!event.target.closest('.chrome-bookmark-manager-context-menu')) {
                this.closeBookmarkContextMenu();
            }
        });

        document.addEventListener('keydown', (event) => {
            if (!event.ctrlKey) {
                return;
            }

            const key = event.key.toLowerCase();

            if (key === 't') {
                event.preventDefault();
                this.createTab('chrome://newtab/');
            } else if (key === 'w') {
                event.preventDefault();
                this.closeTab(this.activeTabId);
            } else if (key === 'l') {
                event.preventDefault();
                this.addressInput.focus();
                this.addressInput.select();
            } else if (key === 'r') {
                event.preventDefault();
                this.refreshActiveTab();
            }
        });

        this.pageHost.addEventListener('wheel', (event) => this.handleSwipeNavigationWheel(event), { passive: false });

        if (electronIpc && typeof electronIpc.on === 'function') {
            electronIpc.on('chrome-beta:open-url-in-tab', (_event, payload = {}) => {
                if (!payload.url) {
                    return;
                }

                const activate = payload.disposition !== 'background-tab';
                this.createTab(payload.url, { activate });
            });

            electronIpc.on('chrome-beta:navigate-history', (_event, payload = {}) => {
                if (payload?.command === 'browser-backward') {
                    this.goBack();
                } else if (payload?.command === 'browser-forward') {
                    this.goForward();
                }
            });

            electronIpc.on('chrome-beta:webview-context-menu', (_event, payload = {}) => {
                if (!this.hostWindow?.classList?.contains('active')) {
                    return;
                }

                this.showWebviewContextMenu(payload);
            });

            electronIpc.on('chrome-beta:download-event', (_event, payload = {}) => {
                this.processDownloadEventPayload(payload);
            });

        }

        window.addEventListener('message', (event) => {
            const data = event.data;
            if (!data || data.action !== 'chromeBetaOpenUrlInTab') {
                return;
            }

            if (data.windowId && this.windowId && data.windowId !== this.windowId) {
                return;
            }

            if (data.appId && data.appId !== APP_ID) {
                return;
            }

            if (!data.url) {
                return;
            }

            const activate = data.disposition !== 'background-tab';
            this.createTab(data.url, { activate });
        });

        window.addEventListener('chrome-beta-download-event', (event) => {
            const data = event.detail || null;
            if (!data?.downloadEvent) {
                return;
            }

            this.processDownloadEventPayload(data.downloadEvent);
        });
        document.addEventListener('host-command', (event) => {
            const data = event.detail;
            if (!data) {
                return;
            }

            if (data.action === 'setLaunchOptions') {
                if (data.windowId && this.windowId && data.windowId !== this.windowId) {
                    return;
                }

                if (data.appId && data.appId !== APP_ID) {
                    return;
                }

                this.applyLaunchOptions(data.launchOptions || null);
                return;
            }

            if (data.action === 'chromeBetaNavigateHistory') {
                if (data.windowId && this.windowId && data.windowId !== this.windowId) {
                    return;
                }

                if (data.appId && data.appId !== APP_ID) {
                    return;
                }

                if (data.command === 'browser-backward') {
                    this.goBack();
                } else if (data.command === 'browser-forward') {
                    this.goForward();
                }
                return;
            }

            if (data.action === 'chromeBetaShowWebviewContextMenu') {
                if (data.windowId && this.windowId && data.windowId !== this.windowId) {
                    return;
                }

                if (data.appId && data.appId !== APP_ID) {
                    return;
                }

                this.showWebviewContextMenu(data.contextMenuParams || null);
                return;
            }

            if (data.action === 'chromeBetaDownloadEvent') {
                if (data.windowId && this.windowId && data.windowId !== this.windowId) {
                    return;
                }

                if (data.appId && data.appId !== APP_ID) {
                    return;
                }

                this.processDownloadEventPayload(data.downloadEvent || null);
                return;
            }

            if (data.action !== 'chromeBetaOpenUrlInTab') {
                return;
            }

            if (data.windowId && this.windowId && data.windowId !== this.windowId) {
                return;
            }

            if (data.appId && data.appId !== APP_ID) {
                return;
            }

            if (!data.url) {
                return;
            }

            const activate = data.disposition !== 'background-tab';
            this.createTab(data.url, { activate });
        });

        const globalDocument = this.pointerDocument || document;
        globalDocument.addEventListener('pointerdown', (event) => {
            if (!this.isElementNode(event.target)) {
                return;
            }

            if (event.target.closest('.chrome-hosted-menu') || event.target.closest('#menuButton')) {
                return;
            }

            if (!event.target.closest('.chrome-hosted-bookmark-bubble') &&
                !event.target.closest('#favoriteButton') &&
                !event.target.closest('.chrome-hosted-bookmark-context-menu')) {
                this.closeBookmarkBubble({ applyEdits: true });
            }

            if (!event.target.closest('.chrome-hosted-bookmark-popup') &&
                !event.target.closest('[data-bookmark-id]') &&
                !event.target.closest('[data-bookmark-overflow]') &&
                !event.target.closest('.chrome-hosted-bookmark-context-menu')) {
                this.closeBookmarkPopup();
            }

            if (!event.target.closest('.chrome-hosted-bookmark-context-menu')) {
                this.closeBookmarkContextMenu();
            }

            if (!event.target.closest('.chrome-hosted-tab-context-menu')) {
                this.closeTabContextMenu();
            }

            if (!event.target.closest('.chrome-hosted-webview-context-menu')) {
                this.closeWebviewContextMenu();
            }

            if (!event.target.closest('.chrome-hosted-zoom-bubble') &&
                !event.target.closest('#zoomIndicator')) {
                this.closeZoomBubble();
            }

            if (!event.target.closest('.chrome-hosted-page-info-bubble') &&
                !event.target.closest('#securityBadge')) {
                this.closePageInfoBubble();
            }

            if (!event.target.closest('.chrome-hosted-omnibox-popup') &&
                !event.target.closest('#addressForm')) {
                this.closeOmniboxPopup({ restoreUserText: true });
            }

            if (!event.target.closest('.chrome-hosted-bookmark-editor')) {
                // Modal editor stays open until explicit action.
            }
        });

        window.addEventListener('resize', () => {
            this.syncWebviewOffset();
            this.renderTabs();
            this.layoutBookmarks();
            this.closeBookmarkPopup();
            this.closeBookmarkBubble({ applyEdits: true });
            this.closeBookmarkContextMenu();
            this.closeBookmarkEditor();
            this.closeWebviewContextMenu();
            this.closeOmniboxPopup({ restoreUserText: true });
            this.closePageInfoBubble();
        });
    }

    handleSwipeNavigationWheel(event) {
        const handled = this.processSwipeNavigationSignal({
            deltaX: event.deltaX,
            deltaY: event.deltaY,
            deltaMode: event.deltaMode,
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
            altKey: event.altKey,
            isEditable: false,
            targetCanScrollHorizontally: this.canTargetScrollHorizontally(event.target, event.deltaX),
            timestamp: Date.now()
        });

        if (handled && event.cancelable) {
            event.preventDefault();
        }
    }

    processSwipeNavigationSignal(signal = {}) {
        if (signal.defaultPrevented || signal.ctrlKey || signal.metaKey || signal.altKey) {
            return false;
        }

        if (this.addressIsFocused || this.pendingTabDrag || this.tabDragState || this.pendingBookmarkDrag || this.bookmarkDragState) {
            return false;
        }

        if (signal.isEditable || signal.targetCanScrollHorizontally) {
            this.finishSwipeNavigationGesture(false);
            return false;
        }

        const activeTab = this.getActiveTab();
        if (!activeTab) {
            return false;
        }

        const commitThresholdRatio = 0.33;
        const absSignalX = Math.abs(signal.deltaX || 0);
        if (signal.deltaMode !== 0 || absSignalX < 4) {
            this.resetSwipeNavigationStateIfIdle();
            return false;
        }

        const now = typeof signal.timestamp === 'number' ? signal.timestamp : Date.now();
        if (!this.swipeNavigationState ||
            now - this.swipeNavigationState.lastEventTime > 520) {
            this.swipeNavigationState = {
                accumulatedX: 0,
                accumulatedY: 0,
                lastEventTime: now,
                mode: null,
                visualDeltaX: 0,
                currentPreview: null,
                targetPreview: null
            };
        }

        const state = this.swipeNavigationState;
        state.accumulatedX += signal.deltaX;
        state.accumulatedY += signal.deltaY || 0;
        state.lastEventTime = now;

        const absX = Math.abs(state.accumulatedX);
        const absY = Math.abs(state.accumulatedY);
        const startThreshold = 50;
        const directionRatio = 2.5;

        if (!state.mode) {
            if (absX <= startThreshold || absX <= absY * directionRatio) {
                this.scheduleSwipeNavigationFinish();
                return true;
            }

            const mode = state.accumulatedX > 0 ? 'forward' : 'back';
            if ((mode === 'back' && !activeTab.canGoBack) || (mode === 'forward' && !activeTab.canGoForward)) {
                this.swipeNavigationState = null;
                return false;
            }

            state.mode = mode;
            state.currentPreview = this.getHistoryPreviewForIndex(activeTab, activeTab.historyIndex);
            state.targetPreview = this.getHistoryPreviewForIndex(
                activeTab,
                mode === 'back' ? activeTab.historyIndex - 1 : activeTab.historyIndex + 1
            );
            this.showSwipeNavigationPreview(activeTab, state);
        }

        const isSignValid =
            (state.mode === 'back' && state.accumulatedX < 0) ||
            (state.mode === 'forward' && state.accumulatedX > 0);
        if (!isSignValid) {
            this.finishSwipeNavigationGesture(false);
            return true;
        }

        state.visualDeltaX = Math.sign(state.accumulatedX) * Math.max(0, absX - startThreshold);
        this.updateSwipeNavigationPreview(state.visualDeltaX, state.mode, commitThresholdRatio);
        this.scheduleSwipeNavigationFinish();
        return true;
    }

    resetSwipeNavigationStateIfIdle() {
        if (!this.swipeNavigationState) {
            return;
        }

        if (Date.now() - this.swipeNavigationState.lastEventTime > 520) {
            this.finishSwipeNavigationGesture(false);
        }
    }

    scheduleSwipeNavigationFinish() {
        window.clearTimeout(this.swipeNavigationFinishTimer);
        this.swipeNavigationFinishTimer = window.setTimeout(() => {
            this.finishSwipeNavigationGesture();
        }, 420);
    }

    finishSwipeNavigationGesture(forceCommit = null) {
        window.clearTimeout(this.swipeNavigationFinishTimer);
        this.swipeNavigationFinishTimer = null;

        const state = this.swipeNavigationState;
        if (!state?.mode) {
            this.hideSwipeNavigationPreview();
            this.swipeNavigationState = null;
            return;
        }

        const width = this.getSwipeNavigationViewportWidth();
        const commitThresholdRatio = 0.33;
        const shouldCommit = forceCommit === null
            ? Math.abs(state.visualDeltaX || 0) / Math.max(1, width) >= commitThresholdRatio
            : !!forceCommit;

        if (!shouldCommit) {
            this.cancelSwipeNavigationPreview();
            this.swipeNavigationState = null;
            return;
        }

        const mode = state.mode;
        this.commitSwipeNavigationPreview(mode);
        this.swipeNavigationState = null;
    }

    getSwipeNavigationViewportWidth() {
        const boundsSource = this.hostedWebviewContainer?.style.display !== 'none'
            ? this.hostedWebviewContainer
            : this.pageHost;
        return Math.max(1, Math.round(boundsSource?.getBoundingClientRect?.().width || this.hostContent?.getBoundingClientRect?.().width || 1));
    }

    showSwipeNavigationPreview(tab, state) {
        if (!this.hostedOverscrollLayer || !this.hostedOverscrollTargetPane || !this.hostedOverscrollCurrentPane || !this.hostedOverscrollIndicator) {
            return;
        }

        const currentAddress = Array.isArray(tab.historyEntries) ? tab.historyEntries[tab.historyIndex] : tab.address;
        const targetIndex = state.mode === 'back' ? tab.historyIndex - 1 : tab.historyIndex + 1;
        const targetAddress = Array.isArray(tab.historyEntries) ? tab.historyEntries[targetIndex] : '';

        this.hostedOverscrollLayer.hidden = false;
        this.hostedOverscrollLayer.classList.add('is-visible');
        this.hostedOverscrollLayer.classList.toggle('is-back', state.mode === 'back');
        this.hostedOverscrollLayer.classList.toggle('is-forward', state.mode === 'forward');
        this.hostedOverscrollTargetPane.innerHTML = this.getOverscrollPaneMarkup(
            state.targetPreview,
            targetAddress,
            targetAddress
        );
        this.hostedOverscrollCurrentPane.innerHTML = this.getOverscrollPaneMarkup(
            state.currentPreview,
            currentAddress,
            tab.title || currentAddress
        );
        this.hostedOverscrollIndicator.innerHTML = '<span class="chrome-hosted-overscroll-indicator-inner" aria-hidden="true"></span>';
        this.updateSwipeNavigationPreview(0, state.mode, 0.33);
    }

    updateSwipeNavigationPreview(deltaX, mode, commitThresholdRatio = 0.25) {
        if (!this.hostedOverscrollLayer || this.hostedOverscrollLayer.hidden || !this.hostedOverscrollCurrentPane || !this.hostedOverscrollIndicator) {
            return;
        }

        const width = this.getSwipeNavigationViewportWidth();
        const clampedDelta = Math.max(-width, Math.min(width, deltaX));
        const progress = Math.max(0, Math.min(1, Math.abs(clampedDelta) / Math.max(1, width * commitThresholdRatio)));
        this.hostedOverscrollCurrentPane.style.transform = `translateX(${-clampedDelta}px)`;
        this.hostedOverscrollLayer.style.setProperty('--chrome-overscroll-progress', String(progress));

        const indicatorTravel = 140 * (1 - progress);
        const indicatorShift = mode === 'back' ? -indicatorTravel : indicatorTravel;
        this.hostedOverscrollIndicator.style.transform = `translateX(${indicatorShift}px)`;
        this.hostedOverscrollIndicator.style.opacity = `${0.25 + (progress * 0.75)}`;
    }

    cancelSwipeNavigationPreview() {
        if (!this.hostedOverscrollLayer || !this.hostedOverscrollCurrentPane || !this.hostedOverscrollIndicator) {
            return;
        }

        this.hostedOverscrollLayer.classList.add('is-animating');
        this.hostedOverscrollCurrentPane.style.transform = 'translateX(0px)';
        this.hostedOverscrollIndicator.style.transform = '';
        this.hostedOverscrollIndicator.style.opacity = '';
        window.setTimeout(() => this.hideSwipeNavigationPreview(), 180);
    }

    commitSwipeNavigationPreview(mode) {
        if (!this.hostedOverscrollLayer || !this.hostedOverscrollCurrentPane || !this.hostedOverscrollIndicator) {
            if (mode === 'back') {
                this.goBack();
            } else {
                this.goForward();
            }
            return;
        }

        const width = this.getSwipeNavigationViewportWidth();
        const finalDelta = mode === 'back' ? -width : width;
        this.hostedOverscrollLayer.classList.add('is-animating', 'is-committing');
        this.hostedOverscrollCurrentPane.style.transform = `translateX(${finalDelta}px)`;
        this.hostedOverscrollIndicator.style.opacity = '0';

        if (mode === 'back') {
            this.goBack();
        } else {
            this.goForward();
        }

        window.setTimeout(() => this.hideSwipeNavigationPreview(), 240);
    }

    hideSwipeNavigationPreview() {
        window.clearTimeout(this.swipeNavigationFinishTimer);
        this.swipeNavigationFinishTimer = null;

        if (!this.hostedOverscrollLayer) {
            return;
        }

        this.hostedOverscrollLayer.hidden = true;
        this.hostedOverscrollLayer.classList.remove('is-visible', 'is-back', 'is-forward', 'is-animating', 'is-committing');
        this.hostedOverscrollLayer.style.removeProperty('--chrome-overscroll-progress');
        if (this.hostedOverscrollTargetPane) {
            this.hostedOverscrollTargetPane.innerHTML = '';
        }
        if (this.hostedOverscrollCurrentPane) {
            this.hostedOverscrollCurrentPane.innerHTML = '';
            this.hostedOverscrollCurrentPane.style.transform = '';
        }
        if (this.hostedOverscrollIndicator) {
            this.hostedOverscrollIndicator.innerHTML = '';
            this.hostedOverscrollIndicator.style.transform = '';
            this.hostedOverscrollIndicator.style.opacity = '';
        }
    }

    canTargetScrollHorizontally(target, deltaX) {
        if (!this.isElementNode(target)) {
            return false;
        }

        if (target.closest('webview')) {
            return false;
        }

        let current = target;
        while (current && current !== document.body) {
            if (current === this.pageHost) {
                break;
            }

            if (this.isElementNode(current) && typeof current.scrollWidth === 'number' && current.scrollWidth > current.clientWidth + 1) {
                const style = window.getComputedStyle(current);
                if (style.overflowX !== 'hidden' && style.overflowX !== 'clip') {
                    if (deltaX > 0 && current.scrollLeft > 0) {
                        return true;
                    }

                    if (deltaX < 0 && current.scrollLeft + current.clientWidth < current.scrollWidth - 1) {
                        return true;
                    }
                }
            }

            current = current.parentElement;
        }

        return false;
    }

    notifyReady() {
        window.parent?.postMessage({
            action: 'classicAppReady',
            appId: APP_ID
        }, '*');
    }

    handleMenuAction(action) {
        if (!action) {
            return false;
        }

        if (action.startsWith('activate-tab:')) {
            this.activateTab(action.slice('activate-tab:'.length));
            return false;
        }

        if (action.startsWith('open-address:')) {
            this.navigateCurrentTab(action.slice('open-address:'.length));
            return false;
        }

        switch (action) {
            case 'new-tab':
                this.createTab('chrome://newtab/');
                break;
            case 'new-window':
                this.openNewWindowWithTabs([{
                    address: 'chrome://newtab/',
                    title: this.getLocalPageTitle('chrome://newtab/'),
                    faviconUrl: null,
                    zoomPercent: 100,
                    loading: false,
                    networkState: 'none',
                    historyEntries: ['chrome://newtab/'],
                    historyIndex: 0
                }]);
                break;
            case 'new-incognito-window':
                this.showStatus('Incognito windows are not implemented yet.', true);
                break;
            case 'duplicate-tab': {
                const activeTab = this.getActiveTab();
                if (activeTab) {
                    const duplicatedTab = this.createTab(activeTab.address);
                    duplicatedTab.zoomPercent = this.getTabZoomPercent(activeTab);
                }
                break;
            }
            case 'show-bookmarks-bar':
                this.localUiState.settings.showBookmarksBar = !this.localUiState.settings.showBookmarksBar;
                this.applySurfacePreferences();
                this.savePersistentState();
                break;
            case 'import-bookmarks-settings':
                this.showStatus('Import bookmarks and settings is not implemented in this build.', true);
                break;
            case 'bookmark-page':
                this.bookmarkCurrentPage();
                break;
            case 'bookmark-all-tabs':
                this.bookmarkAllOpenTabs();
                break;
            case 'cut':
                this.runMenuEditCommand('cut');
                break;
            case 'copy':
                this.runMenuEditCommand('copy');
                break;
            case 'paste':
                this.runMenuEditCommand('paste');
                break;
            case 'save-page':
                this.showStatus('Save page is not implemented in this build.', true);
                break;
            case 'find':
                this.showStatus('Find in page is not implemented in this build.', true);
                break;
            case 'print':
                this.showStatus('Print is not implemented in this build.', true);
                break;
            case 'zoom-minus':
                this.stepActiveTabZoom(-1);
                return true;
            case 'zoom-plus':
                this.stepActiveTabZoom(1);
                return true;
            case 'zoom-reset':
                this.resetActiveTabZoom();
                return true;
            case 'fullscreen':
                this.toggleBrowserFullscreen();
                return true;
            case 'history':
                this.navigateCurrentTab('chrome://history/');
                break;
            case 'downloads':
                this.navigateCurrentTab('chrome://downloads/');
                break;
            case 'bookmark-manager':
                this.navigateCurrentTab('chrome://bookmarks/');
                break;
            case 'extensions':
                this.navigateCurrentTab('chrome://extensions/');
                break;
            case 'settings':
                this.navigateCurrentTab('chrome://settings/');
                break;
            case 'about-beta':
                this.navigateCurrentTab('chrome://about/');
                break;
            case 'help-center':
                this.navigateCurrentTab('chrome://about/');
                break;
            case 'report-issue':
                this.showStatus('Issue reporting is not implemented in this build.', true);
                break;
            case 'task-manager':
                this.showStatus('Task Manager is not implemented in this build.', true);
                break;
            case 'clear-browsing-data':
                this.showStatus('Clear browsing data is not implemented in this build.', true);
                break;
            case 'view-source':
                this.showStatus('View source is not implemented in this build.', true);
                break;
            case 'developer-tools':
                this.showStatus('Developer tools are not implemented in this build.', true);
                break;
            case 'exit':
                this.closeWindow();
                break;
            case 'welcome':
                this.navigateCurrentTab('chrome://welcome/');
                break;
            default:
                break;
        }

        return false;
    }

    duplicateTab(tabId = this.activeTabId) {
        const tab = this.tabs.find((candidate) => candidate.id === tabId);
        if (!tab) {
            return null;
        }

        return this.insertRestoredTab(this.serializeTabState(tab), {
            activate: true,
            index: this.tabs.indexOf(tab) + 1
        });
    }

    restoreRecentlyClosedTab() {
        const serializedTab = this.recentlyClosedTabs.shift();
        if (!serializedTab) {
            return null;
        }

        return this.insertRestoredTab(serializedTab, { activate: true });
    }

    openNewWindowWithTabs(serializedTabs, options = {}) {
        const topWindow = window.top || window.parent || window;
        if (typeof topWindow.launchApp !== 'function') {
            this.showStatus('Opening a new Chrome window is not available here.', true);
            return false;
        }

        const tabs = Array.isArray(serializedTabs)
            ? serializedTabs.filter((tab) => tab && typeof tab.address === 'string' && tab.address.length)
            : [];
        if (!tabs.length) {
            return false;
        }

        const requestedActiveIndex = Number.isInteger(options.activeIndex) ? options.activeIndex : 0;
        const activeIndex = Math.max(0, Math.min(requestedActiveIndex, tabs.length - 1));
        const launchResult = topWindow.launchApp(APP_ID, null, {
            chromeBetaWindowState: {
                tabs,
                activeIndex
            },
            initialBounds: options.initialBounds || undefined
        });

        return !!launchResult;
    }

    closeOtherTabs(tabId) {
        const keepTab = this.tabs.find((candidate) => candidate.id === tabId);
        if (!keepTab) {
            return;
        }

        const tabsToClose = this.tabs
            .filter((candidate) => candidate.id !== tabId)
            .map((candidate) => candidate.id);

        tabsToClose.forEach((id) => this.closeTab(id, { animate: false }));
        this.activateTab(keepTab.id);
    }

    closeTabsToRight(tabId) {
        const index = this.tabs.findIndex((candidate) => candidate.id === tabId);
        if (index === -1 || index >= this.tabs.length - 1) {
            return;
        }

        const tabsToClose = this.tabs
            .slice(index + 1)
            .map((candidate) => candidate.id);

        tabsToClose.forEach((id) => this.closeTab(id, { animate: false }));
        this.activateTab(this.tabs[Math.min(index, this.tabs.length - 1)]?.id || this.activeTabId);
    }

    isHostWindowMaximized() {
        return !!this.hostWindow?.classList?.contains('maximized');
    }

    getFrameContextMenuGroups() {
        const isMaximized = this.isHostWindowMaximized();
        return [
            [
                { action: 'new-tab', label: 'New tab' },
                { action: 'restore-tab', label: 'Reopen closed tab', disabled: this.recentlyClosedTabs.length === 0 }
            ],
            [
                { action: 'task-manager', label: 'Task Manager' }
            ],
            [
                { action: 'restore-window', label: 'Restore', disabled: !isMaximized },
                { action: 'move-window', label: 'Move', disabled: true },
                { action: 'size-window', label: 'Size', disabled: true },
                { action: 'minimize-window', label: 'Minimize' },
                { action: 'maximize-window', label: 'Maximize', disabled: isMaximized },
                { action: 'close-window', label: 'Close' }
            ]
        ];
    }

    getTabContextMenuGroups(tabId, options = {}) {
        if (options.strip) {
            return this.getFrameContextMenuGroups();
        }

        if (!tabId) {
            return [];
        }

        const tab = this.tabs.find((candidate) => candidate.id === tabId);
        if (!tab) {
            return [];
        }

        const tabIndex = this.tabs.findIndex((candidate) => candidate.id === tabId);
        const canCloseOtherTabs = this.tabs.length > 1;
        const canCloseTabsToRight = tabIndex !== -1 && tabIndex < this.tabs.length - 1;

        return [
            [
                { action: 'new-tab', label: 'New tab' }
            ],
            [
                { action: 'reload-tab', label: 'Reload' },
                { action: 'duplicate-tab', label: 'Duplicate' },
                { action: 'pin-tab', label: 'Pin tab', disabled: true },
                { action: 'mute-tab', label: 'Mute tab', disabled: true }
            ],
            [
                { action: 'close-tab', label: 'Close tab' },
                { action: 'close-other-tabs', label: 'Close other tabs', disabled: !canCloseOtherTabs },
                { action: 'close-tabs-right', label: 'Close tabs to the right', disabled: !canCloseTabsToRight }
            ],
            [
                { action: 'restore-tab', label: 'Reopen closed tab', disabled: this.recentlyClosedTabs.length === 0 },
                { action: 'bookmark-all-tabs', label: 'Bookmark all tabs...' }
            ]
        ];
    }

    showTabContextMenu(tabId, clientX, clientY, options = {}) {
        if (!this.hostedTabContextMenu || !this.hostContent) {
            return;
        }

        if (!tabId && !options.strip) {
            return;
        }

        const groups = this.getTabContextMenuGroups(tabId, options);
        if (!groups.length) {
            return;
        }

        this.setMenuOpen(false);
        this.closeBookmarkPopup();
        this.closeBookmarkBubble({ applyEdits: true });
        this.closeBookmarkContextMenu();
        this.closeWebviewContextMenu();
        this.closePageInfoBubble();
        this.closeOmniboxPopup({ restoreUserText: true });

        this.tabContextMenuState = { tabId: tabId || null, strip: !!options.strip };
        const menu = this.hostedTabContextMenu;
        menu.innerHTML = groups.map((group, groupIndex) => `
            <div class="chrome-hosted-tab-context-group">
                ${group.map((item) => `
                    <button
                        class="chrome-hosted-tab-context-item"
                        type="button"
                        data-tab-context-action="${this.escapeHtml(item.action)}"
                        ${item.disabled ? 'disabled' : ''}
                    >
                        <span class="chrome-hosted-tab-context-label">${this.escapeHtml(item.label)}</span>
                    </button>
                `).join('')}
            </div>
            ${groupIndex < groups.length - 1 ? '<div class="chrome-hosted-tab-context-separator"></div>' : ''}
        `).join('');

        const hostRect = this.hostContent.getBoundingClientRect();
        menu.hidden = false;
        menu.style.left = `${Math.max(1, clientX - hostRect.left)}px`;
        menu.style.top = `${Math.max(1, clientY - hostRect.top)}px`;

        window.requestAnimationFrame(() => {
            if (menu.hidden) {
                return;
            }

            const rect = menu.getBoundingClientRect();
            const maxLeft = Math.max(6, hostRect.width - rect.width - 6);
            const maxTop = Math.max(6, hostRect.height - rect.height - 6);
            menu.style.left = `${Math.max(1, Math.min(clientX - hostRect.left, maxLeft))}px`;
            menu.style.top = `${Math.max(1, Math.min(clientY - hostRect.top, maxTop))}px`;
        });
    }

    closeTabContextMenu() {
        if (!this.hostedTabContextMenu) {
            return;
        }

        this.hostedTabContextMenu.hidden = true;
        this.hostedTabContextMenu.innerHTML = '';
        this.tabContextMenuState = null;
    }

    handleTabContextMenuClick(event) {
        const actionTarget = event.target.closest('[data-tab-context-action]');
        if (!actionTarget || actionTarget.hasAttribute('disabled')) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        const tabId = this.tabContextMenuState?.tabId || this.activeTabId;
        switch (actionTarget.dataset.tabContextAction) {
            case 'new-tab':
                this.createTab('chrome://newtab/');
                break;
            case 'reload-tab':
                if (tabId && tabId !== this.activeTabId) {
                    this.activateTab(tabId);
                }
                this.refreshActiveTab();
                break;
            case 'duplicate-tab':
                this.duplicateTab(tabId);
                break;
            case 'pin-tab':
            case 'mute-tab':
                this.showStatus('This tab command is not implemented in this build.', true);
                break;
            case 'close-tab':
                this.closeTab(tabId);
                break;
            case 'close-other-tabs':
                this.closeOtherTabs(tabId);
                break;
            case 'close-tabs-right':
                this.closeTabsToRight(tabId);
                break;
            case 'restore-tab':
                this.restoreRecentlyClosedTab();
                break;
            case 'task-manager': {
                const topWindow = this.getTopWindow();
                if (typeof topWindow.launchApp === 'function') {
                    topWindow.launchApp('task-manager');
                } else {
                    this.showStatus('Task Manager is not available in this shell.', true);
                }
                break;
            }
            case 'restore-window': {
                const topWindow = this.getTopWindow();
                if (this.windowId && typeof topWindow.restoreClassicWindow === 'function') {
                    topWindow.restoreClassicWindow(this.windowId);
                }
                break;
            }
            case 'move-window':
            case 'size-window':
                this.showStatus('Window move/size commands are not implemented in this shell menu yet.', true);
                break;
            case 'minimize-window': {
                const topWindow = this.getTopWindow();
                if (this.windowId && typeof topWindow.minimizeClassicWindow === 'function') {
                    topWindow.minimizeClassicWindow(this.windowId);
                }
                break;
            }
            case 'maximize-window': {
                const topWindow = this.getTopWindow();
                if (this.windowId && typeof topWindow.toggleMaximizeClassicWindow === 'function') {
                    topWindow.toggleMaximizeClassicWindow(this.windowId);
                }
                break;
            }
            case 'close-window':
                this.closeWindow();
                break;
            case 'bookmark-all-tabs':
                this.bookmarkAllOpenTabs();
                break;
            default:
                break;
        }

        this.closeTabContextMenu();
    }

    bookmarkCurrentPage() {
        const activeTab = this.getActiveTab();
        if (!activeTab) {
            return;
        }

        let bookmark = this.findBookmarkByAddress(activeTab.address);
        const newlyBookmarked = !bookmark;

        if (!bookmark) {
            bookmark = this.createBookmarkNode({
                type: 'url',
                label: this.getBookmarkLabelForAddress(activeTab.address, activeTab.title),
                address: activeTab.address,
                faviconUrl: this.getTabFaviconUrl(activeTab)
            });
            this.bookmarks.push(bookmark);
            this.renderBookmarks();
            this.savePersistentState();
        }

        this.refreshBookmarkStar();
        this.showBookmarkBubble(bookmark, { newlyBookmarked });
    }

    bookmarkAllOpenTabs() {
        const tabsToBookmark = this.tabs.filter((tab) => !!tab.address);
        if (!tabsToBookmark.length) {
            return;
        }

        const folder = this.createBookmarkNode({
            type: 'folder',
            label: 'Open Tabs',
            children: tabsToBookmark.map((tab) => ({
                type: 'url',
                label: this.getBookmarkLabelForAddress(tab.address, tab.title),
                address: tab.address,
                faviconUrl: this.getTabFaviconUrl(tab)
            }))
        });
        this.bookmarks.push(folder);
        this.renderBookmarks();
        this.savePersistentState();
        this.showStatus('Open tabs bookmarked.', true);
    }

    runMenuEditCommand(command) {
        const target = [
            this.pointerDocument?.activeElement,
            document.activeElement
        ].find((candidate) => this.isElementNode(candidate));

        const ownerDocument = target?.ownerDocument || this.pointerDocument || document;
        if (target && typeof target.focus === 'function') {
            target.focus();
        }

        if (typeof ownerDocument.execCommand === 'function' && ownerDocument.execCommand(command)) {
            return;
        }

        this.showStatus(`${command.charAt(0).toUpperCase()}${command.slice(1)} is not available here.`, true);
    }

    getTabZoomPercent(tab = this.getActiveTab()) {
        const rawPercent = Number(tab?.zoomPercent);
        if (!Number.isFinite(rawPercent)) {
            return 100;
        }
        return Math.max(25, Math.min(500, Math.round(rawPercent)));
    }

    getTabZoomFactor(tab = this.getActiveTab()) {
        return this.getTabZoomPercent(tab) / 100;
    }

    getNextZoomPercent(currentPercent, direction) {
        const currentFactor = currentPercent / 100;
        const factors = PRESET_ZOOM_FACTORS.slice();
        let currentIndex = factors.findIndex((factor) => Math.abs(factor - currentFactor) < 0.005);

        if (currentIndex === -1) {
            factors.push(currentFactor);
            factors.sort((left, right) => left - right);
            currentIndex = factors.findIndex((factor) => Math.abs(factor - currentFactor) < 0.005);
        }

        const nextIndex = Math.max(0, Math.min(factors.length - 1, currentIndex + direction));
        return Math.round(factors[nextIndex] * 100);
    }

    stepActiveTabZoom(direction) {
        const activeTab = this.getActiveTab();
        if (!activeTab) {
            return;
        }

        const nextPercent = this.getNextZoomPercent(this.getTabZoomPercent(activeTab), direction);
        this.setTabZoomPercent(activeTab, nextPercent, { showBubble: true });
    }

    resetActiveTabZoom() {
        const activeTab = this.getActiveTab();
        if (!activeTab) {
            return;
        }

        this.setTabZoomPercent(activeTab, 100, { showBubble: true });
    }

    setTabZoomPercent(tab, percent, options = {}) {
        if (!tab) {
            return;
        }

        tab.zoomPercent = Math.max(25, Math.min(500, Math.round(percent)));
        this.applyTabZoom(tab);
        this.updateZoomUi({
            showBubble: !!options.showBubble,
            bubblePinned: !!options.bubblePinned
        });
        this.savePersistentState();
    }

    applyTabZoom(tab) {
        if (!tab) {
            return;
        }

        const factor = this.getTabZoomFactor(tab);
        if (tab.id === this.activeTabId && this.pageHost) {
            this.pageHost.style.zoom = factor === 1 ? '' : String(factor);
        }

        if (tab.webview && tab.webviewReady && typeof tab.webview.setZoomFactor === 'function') {
            try {
                tab.webview.setZoomFactor(factor);
            } catch {
                // Electron will reject this if the webview is mid-transition.
            }
        }
    }

    updateZoomUi(options = {}) {
        const activeTab = this.getActiveTab();
        this.menuZoomPercent = this.getTabZoomPercent(activeTab);
        this.updateZoomIndicator(activeTab);

        if (!this.hostedMenu?.hidden) {
            this.renderHostedAppMenu();
        }

        if (options.showBubble) {
            this.showZoomBubble({
                autoClose: !options.bubblePinned
            });
        } else if (activeTab && this.getTabZoomPercent(activeTab) === 100) {
            this.closeZoomBubble();
        }
    }

    updateZoomIndicator(tab) {
        if (!this.zoomIndicator) {
            return;
        }

        const percent = this.getTabZoomPercent(tab);
        const isVisible = !!tab && !this.addressIsFocused && percent !== 100;
        const iconName = percent > 100 ? 'zoom_plus.png' : 'zoom_minus.png';

        this.zoomIndicator.hidden = !isVisible;
        this.zoomIndicator.title = `Zoom: ${percent}%`;
        this.zoomIndicator.setAttribute('aria-label', `Zoom: ${percent}%`);
        this.zoomIndicator.style.setProperty('--chrome-zoom-indicator-image', isVisible
            ? `url("${this.getAssetUrl(`assets/chrome43/${iconName}`)}")`
            : '');
        if (!isVisible) {
            this.closeZoomBubble();
        }
    }

    showZoomBubble(options = {}) {
        if (!this.hostedZoomBubble || !this.zoomIndicator || this.zoomIndicator.hidden || !this.hostContent) {
            return;
        }

        const activeTab = this.getActiveTab();
        if (!activeTab) {
            return;
        }

        const percent = this.getTabZoomPercent(activeTab);
        this.hostedZoomBubble.innerHTML = `
            <div class="chrome-hosted-zoom-bubble-label">Zoom: ${percent}%</div>
            <button class="chrome-bookmark-bubble-button chrome-hosted-zoom-bubble-button" type="button" data-zoom-bubble-action="reset">Reset to default</button>
        `;
        this.hostedZoomBubble.hidden = false;

        const anchorRect = this.getHostAlignedClientRect(this.zoomIndicator);
        const hostRect = this.hostContent.getBoundingClientRect();
        this.hostedZoomBubble.style.left = `${Math.max(6, anchorRect.right - hostRect.left - 146)}px`;
        this.hostedZoomBubble.style.top = `${Math.max(6, anchorRect.bottom - hostRect.top + 4)}px`;

        this.hostedZoomBubble.onclick = (event) => {
            const actionTarget = event.target.closest('[data-zoom-bubble-action]');
            if (!actionTarget) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            this.resetActiveTabZoom();
            this.closeZoomBubble();
        };

        window.clearTimeout(this.zoomBubbleTimer);
        if (options.autoClose) {
            this.zoomBubbleTimer = window.setTimeout(() => {
                this.closeZoomBubble();
            }, 1500);
        }
    }

    closeZoomBubble() {
        window.clearTimeout(this.zoomBubbleTimer);
        this.zoomBubbleTimer = null;
        if (this.hostedZoomBubble) {
            this.hostedZoomBubble.hidden = true;
            this.hostedZoomBubble.innerHTML = '';
        }
    }

    buildPageInfoState(address) {
        const securityState = this.getAddressSecurityState(address);
        const isChromePage = this.isLocalAddress(address) || address.startsWith('about:');

        if (isChromePage) {
            return {
                title: this.getLocalPageTitle(address) || 'Chrome page',
                subtitle: 'Chrome internal page',
                badgeClass: 'is-page',
                badgeImage: this.getLocalPageFaviconUrl(address) || this.getAssetUrl('assets/chrome43/chrome_beta_logo_16.png'),
                primaryText: 'This is an internal Chrome page.',
                secondaryText: 'Chrome internal pages are shown locally and are not transmitted over the network.'
            };
        }

        let hostLabel = address;
        try {
            const url = new URL(address);
            hostLabel = url.host || address;
        } catch {
            // Keep the raw address.
        }

        if (securityState.level === 'secure') {
            return {
                title: hostLabel,
                subtitle: 'Identity verified',
                badgeClass: 'is-secure',
                badgeImage: '',
                primaryText: 'Your connection to this site is secure.',
                secondaryText: 'Chrome verified this site identity and encrypted the information you send or receive.'
            };
        }

        if (securityState.level === 'warning') {
            return {
                title: hostLabel,
                subtitle: 'Connection partially secure',
                badgeClass: 'is-warning',
                badgeImage: '',
                primaryText: 'Parts of this page are not secure.',
                secondaryText: 'Some resources on this page may be using an outdated or mixed connection.'
            };
        }

        if (securityState.level === 'error') {
            return {
                title: hostLabel,
                subtitle: 'Connection error',
                badgeClass: 'is-error',
                badgeImage: '',
                primaryText: 'Chrome cannot verify the identity of this site.',
                secondaryText: 'The site presented an invalid or unsafe certificate.'
            };
        }

        return {
            title: hostLabel,
            subtitle: 'Connection not secure',
            badgeClass: 'is-neutral',
            badgeImage: '',
            primaryText: 'Your connection to this site is not secure.',
            secondaryText: 'Information you send or receive could be viewed by others.'
        };
    }

    showPageInfoBubble() {
        if (!this.hostedPageInfoBubble || !this.securityBadge || this.securityBadge.hidden || !this.hostContent) {
            return;
        }

        const activeTab = this.getActiveTab();
        if (!activeTab?.address) {
            return;
        }

        this.closeBookmarkBubble({ applyEdits: true });
        this.closeBookmarkPopup();
        this.closeBookmarkContextMenu();
        this.closeBookmarkEditor();
        this.closeZoomBubble();
        this.closeOmniboxPopup({ restoreUserText: true });
        this.setMenuOpen(false);

        const info = this.buildPageInfoState(activeTab.address);
        this.hostedPageInfoBubble.innerHTML = `
            <div class="chrome-page-info-header">
                <span class="chrome-page-info-badge ${this.escapeHtml(info.badgeClass)}" ${info.badgeImage ? `style="--chrome-page-info-badge-image:url('${this.escapeHtml(info.badgeImage)}')"` : ''} aria-hidden="true"></span>
                <div class="chrome-page-info-heading">
                    <div class="chrome-page-info-title">${this.escapeHtml(info.title)}</div>
                    <div class="chrome-page-info-subtitle">${this.escapeHtml(info.subtitle)}</div>
                </div>
            </div>
            <div class="chrome-page-info-copy">
                <div class="chrome-page-info-copy-primary">${this.escapeHtml(info.primaryText)}</div>
                <div class="chrome-page-info-copy-secondary">${this.escapeHtml(info.secondaryText)}</div>
            </div>
            <div class="chrome-page-info-actions">
                <button class="chrome-bookmark-bubble-button" type="button" data-page-info-action="close">Done</button>
            </div>
        `;
        this.hostedPageInfoBubble.hidden = false;

        const anchorRect = this.getHostAlignedClientRect(this.securityBadge);
        const hostRect = this.hostContent.getBoundingClientRect();
        this.hostedPageInfoBubble.style.left = `${Math.max(8, anchorRect.left - hostRect.left)}px`;
        this.hostedPageInfoBubble.style.top = `${Math.max(8, anchorRect.bottom - hostRect.top + 6)}px`;

        window.requestAnimationFrame(() => {
            if (!this.hostedPageInfoBubble || this.hostedPageInfoBubble.hidden) {
                return;
            }

            const bubbleRect = this.hostedPageInfoBubble.getBoundingClientRect();
            const maxLeft = Math.max(8, hostRect.width - bubbleRect.width - 8);
            const nextLeft = Math.max(8, Math.min(anchorRect.left - hostRect.left - 8, maxLeft));
            this.hostedPageInfoBubble.style.left = `${nextLeft}px`;
        });

        this.hostedPageInfoBubble.onclick = (event) => {
            const actionTarget = event.target.closest('[data-page-info-action]');
            if (!actionTarget) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            this.closePageInfoBubble();
        };
    }

    closePageInfoBubble() {
        if (!this.hostedPageInfoBubble) {
            return;
        }

        this.hostedPageInfoBubble.hidden = true;
        this.hostedPageInfoBubble.innerHTML = '';
        this.hostedPageInfoBubble.onclick = null;
    }

    togglePageInfoBubble() {
        if (!this.hostedPageInfoBubble) {
            return;
        }

        if (!this.hostedPageInfoBubble.hidden) {
            this.closePageInfoBubble();
            return;
        }

        this.showPageInfoBubble();
    }

    toggleZoomBubble() {
        if (!this.hostedZoomBubble) {
            return;
        }

        if (!this.hostedZoomBubble.hidden) {
            this.closeZoomBubble();
            return;
        }

        this.showZoomBubble({ autoClose: false });
    }

    handleAddressInputKeyDown(event) {
        if (!this.addressIsFocused) {
            return;
        }

        if (event.key === 'ArrowDown') {
            event.preventDefault();
            if (this.hostedOmniboxPopup?.hidden) {
                this.updateOmniboxPopup({ forceOpen: true });
            } else {
                this.moveOmniboxSelection(1);
            }
            return;
        }

        if (event.key === 'ArrowUp') {
            event.preventDefault();
            if (this.hostedOmniboxPopup?.hidden) {
                this.updateOmniboxPopup({ forceOpen: true });
            } else {
                this.moveOmniboxSelection(-1);
            }
            return;
        }

        if (event.key === 'Escape' && this.hostedOmniboxPopup && !this.hostedOmniboxPopup.hidden) {
            event.preventDefault();
            this.closeOmniboxPopup({ restoreUserText: true });
        }
    }

    updateOmniboxPopup(options = {}) {
        if (!this.addressIsFocused || !this.hostedOmniboxPopup || !this.hostContent || !this.hostedTopChrome) {
            this.clearRemoteOmniboxSuggestions({ preserveRenderedPopup: true });
            this.closeOmniboxPopup();
            return;
        }

        const query = this.omniboxUserText ?? this.addressInput.value;
        if (!options.preserveRemoteSuggestions) {
            this.scheduleRemoteOmniboxSuggestions(query, options);
        }
        const suggestions = this.getOmniboxSuggestions(query, options);
        const shouldForceOpen = !!options.forceOpen;
        if (!suggestions.length && !shouldForceOpen) {
            this.closeOmniboxPopup();
            return;
        }

        this.omniboxSuggestions = suggestions;
        if (!suggestions.length) {
            this.closeOmniboxPopup();
            return;
        }

        if (this.omniboxSelectedIndex < 0 || this.omniboxSelectedIndex >= suggestions.length) {
            this.omniboxSelectedIndex = 0;
        }

        this.renderOmniboxPopup();
    }

    renderOmniboxPopup() {
        if (!this.hostedOmniboxPopup || !this.hostContent || !this.hostedTopChrome) {
            return;
        }

        if (!this.omniboxSuggestions.length) {
            this.closeOmniboxPopup();
            return;
        }

        const toolbar = this.hostedTopChrome.querySelector('.chrome-toolbar') || this.hostedTopChrome;
        const hostRect = this.hostContent.getBoundingClientRect();
        const toolbarRect = toolbar.getBoundingClientRect();
        const addressRect = this.getHostAlignedClientRect(this.addressForm);
        const leftMargin = Math.max(0, Math.round(addressRect.left - toolbarRect.left + 2));
        const rightMargin = Math.max(0, Math.round(toolbarRect.right - addressRect.right + 2));

        this.hostedOmniboxPopup.style.left = `${Math.round(toolbarRect.left - hostRect.left)}px`;
        this.hostedOmniboxPopup.style.top = `${Math.round(toolbarRect.bottom - hostRect.top - 1)}px`;
        this.hostedOmniboxPopup.style.width = `${Math.round(toolbarRect.width)}px`;
        this.hostedOmniboxPopup.style.setProperty('--chrome-omnibox-popup-left-margin', `${leftMargin}px`);
        this.hostedOmniboxPopup.style.setProperty('--chrome-omnibox-popup-right-margin', `${rightMargin}px`);
        this.hostedOmniboxPopup.innerHTML = `
            <div class="chrome-hosted-omnibox-popup-results" role="listbox" aria-label="Suggestions">
                ${this.omniboxSuggestions.map((suggestion, index) => this.renderOmniboxSuggestion(suggestion, index)).join('')}
            </div>
        `;
        this.hostedOmniboxPopup.hidden = false;
    }

    renderOmniboxSuggestion(suggestion, index) {
        const classes = ['chrome-hosted-omnibox-row', `is-${suggestion.icon}`];
        if (index === this.omniboxSelectedIndex) {
            classes.push('is-selected');
        }
        if (suggestion.descriptionKind === 'url') {
            classes.push('has-url-description');
        }

        return `
            <button class="${classes.join(' ')}" type="button" role="option" aria-selected="${index === this.omniboxSelectedIndex}" data-omnibox-index="${index}">
                <span class="chrome-hosted-omnibox-row-icon" aria-hidden="true"></span>
                <span class="chrome-hosted-omnibox-row-content">
                    <span class="chrome-hosted-omnibox-row-primary">${this.escapeHtml(suggestion.primary)}</span>
                    ${suggestion.secondary ? `<span class="chrome-hosted-omnibox-row-separator" aria-hidden="true"> - </span><span class="chrome-hosted-omnibox-row-secondary ${suggestion.descriptionKind === 'url' ? 'is-url' : ''}">${this.escapeHtml(suggestion.secondary)}</span>` : ''}
                </span>
            </button>
        `;
    }

    moveOmniboxSelection(delta) {
        if (!this.omniboxSuggestions.length) {
            this.updateOmniboxPopup({ forceOpen: true });
            return;
        }

        const nextIndex = Math.max(0, Math.min(this.omniboxSuggestions.length - 1, this.omniboxSelectedIndex + delta));
        this.setOmniboxSelectedIndex(nextIndex, { applyTemporaryText: true });
    }

    setOmniboxSelectedIndex(index, options = {}) {
        if (!this.omniboxSuggestions.length) {
            return;
        }

        this.omniboxSelectedIndex = Math.max(0, Math.min(this.omniboxSuggestions.length - 1, index));
        if (this.hostedOmniboxPopup && !this.hostedOmniboxPopup.hidden) {
            this.hostedOmniboxPopup.querySelectorAll('[data-omnibox-index]').forEach((item) => {
                const isSelected = Number(item.dataset.omniboxIndex) === this.omniboxSelectedIndex;
                item.classList.toggle('is-selected', isSelected);
                item.setAttribute('aria-selected', isSelected ? 'true' : 'false');
                if (isSelected) {
                    item.scrollIntoView({ block: 'nearest' });
                }
            });
        }

        if (options.applyTemporaryText) {
            const suggestion = this.omniboxSuggestions[this.omniboxSelectedIndex];
            if (suggestion) {
                this.addressInput.value = suggestion.fillIntoEdit;
                this.omniboxTemporaryTextActive = true;
                this.refreshAddressDisplay();
                this.updateSecurityBadge(this.addressInput.value, { editing: true });
            }
        }
    }

    handleOmniboxPopupPointerOver(event) {
        const row = this.isElementNode(event.target)
            ? event.target.closest('[data-omnibox-index]')
            : null;
        if (!row) {
            return;
        }

        this.setOmniboxSelectedIndex(Number(row.dataset.omniboxIndex), { applyTemporaryText: false });
    }

    handleOmniboxPopupClick(event) {
        const row = this.isElementNode(event.target)
            ? event.target.closest('[data-omnibox-index]')
            : null;
        if (!row) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        this.omniboxSelectedIndex = Number(row.dataset.omniboxIndex);
        this.commitOmniboxSelection();
        this.addressInput.blur();
    }

    commitOmniboxSelection() {
        const suggestion = this.omniboxSuggestions[this.omniboxSelectedIndex];
        if (!suggestion) {
            return;
        }

        this.closeOmniboxPopup();
        this.omniboxTemporaryTextActive = false;
        this.navigateCurrentTab(suggestion.address);
    }

    closeOmniboxPopup(options = {}) {
        if (options.restoreUserText && this.omniboxTemporaryTextActive && this.addressIsFocused) {
            this.addressInput.value = this.omniboxUserText;
            this.refreshAddressDisplay();
            this.updateSecurityBadge(this.addressInput.value, { editing: true });
        }

        this.clearRemoteOmniboxSuggestions({ preserveRenderedPopup: true });
        this.omniboxTemporaryTextActive = false;
        this.omniboxSuggestions = [];
        this.omniboxSelectedIndex = -1;
        if (this.hostedOmniboxPopup) {
            this.hostedOmniboxPopup.hidden = true;
            this.hostedOmniboxPopup.innerHTML = '';
        }
    }

    async toggleBrowserFullscreen(forceState) {
        const topWindow = window.top || window.parent || window;
        try {
            if (typeof topWindow.toggleShellFullscreen === 'function') {
                await topWindow.toggleShellFullscreen(forceState);
                return;
            }

            const targetDoc = this.hostContent?.ownerDocument || document;
            const targetState = typeof forceState === 'boolean'
                ? forceState
                : !targetDoc.fullscreenElement;

            if (targetState) {
                await (targetDoc.documentElement || document.documentElement).requestFullscreen();
            } else if (targetDoc.fullscreenElement) {
                await targetDoc.exitFullscreen();
            }
        } catch (error) {
            console.error('Failed to toggle Chrome Beta fullscreen:', error);
        }
    }

    // ─── Address helpers ───

    isLocalAddress(address) {
        return address.startsWith('chrome://');
    }

    normalizeAddress(value) {
        const trimmed = value.trim();

        if (trimmed.startsWith('chrome://')) {
            return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
        }

        if (/^(about:|view-source:|data:|blob:|file:)/i.test(trimmed)) {
            return trimmed;
        }

        if (/^https?:\/\//i.test(trimmed)) {
            return trimmed;
        }

        if (trimmed.includes('.') && !trimmed.includes(' ')) {
            return `https://${trimmed.replace(/^\/+/, '')}`;
        }

        return `${this.getSearchUrl()}${encodeURIComponent(trimmed)}`;
    }

    isNewTabAddress(address) {
        return address === 'chrome://newtab/';
    }

    captureStartupPagesFromCurrentTabs() {
        const pages = this.tabs
            .map((tab) => tab.address)
            .filter((address) => address && address !== 'chrome://settings/');

        if (pages.length) {
            return [...new Set(pages)];
        }

        const activeAddress = this.getActiveTab()?.address;
        return [activeAddress && activeAddress !== 'chrome://settings/' ? activeAddress : 'chrome://newtab/'];
    }

    handleNtpFakeboxActivation() {
        const activeTab = this.getActiveTab();
        if (!activeTab || !this.isNewTabAddress(activeTab.address)) {
            return;
        }

        if (this.localUiState.ntpFakeboxState !== 'idle') {
            this.localUiState.ntpFakeboxState = 'idle';
            this.renderCurrentLocalPage();
        }
    }

    handleNtpFakeboxDragFocus(focus) {
        const activeTab = this.getActiveTab();
        if (!activeTab || !this.isNewTabAddress(activeTab.address) || this.addressIsFocused) {
            return;
        }

        const nextState = focus ? 'drag-focused' : 'idle';
        if (this.localUiState.ntpFakeboxState === nextState) {
            return;
        }

        this.localUiState.ntpFakeboxState = nextState;
        this.renderCurrentLocalPage();
    }

    syncNewTabOmniboxFocusState(isFocused) {
        const activeTab = this.getActiveTab();
        if (!activeTab || !this.isNewTabAddress(activeTab.address)) {
            return;
        }

        if (isFocused) {
            if (this.localUiState.ntpFakeboxState !== 'focused') {
                this.localUiState.ntpFakeboxState = 'focused';
                this.renderCurrentLocalPage();
            }

            this.addressInput.value = '';
            return;
        }

        if (!this.addressInput.value.trim()) {
            this.addressInput.value = activeTab.address;
        }

        if (this.localUiState.ntpFakeboxState !== 'idle') {
            this.localUiState.ntpFakeboxState = 'idle';
            this.renderCurrentLocalPage();
        }
    }

    handleNewTabOmniboxInput() {
        const activeTab = this.getActiveTab();
        if (!activeTab || !this.isNewTabAddress(activeTab.address)) {
            return;
        }

        if (this.addressIsFocused &&
            this.addressInput.value.length > 0 &&
            this.localUiState.ntpFakeboxState !== 'idle') {
            this.localUiState.ntpFakeboxState = 'idle';
            this.renderCurrentLocalPage();
        }
    }

    looksLikeAddressInput(value) {
        const trimmed = value.trim();
        return trimmed.startsWith('chrome://') ||
            /^https?:\/\//i.test(trimmed) ||
            (trimmed.includes('.') && !trimmed.includes(' '));
    }

    evaluateOmniboxCalculatorExpression(value) {
        const expression = value.trim().replace(/[×x]/g, '*').replace(/[÷]/g, '/');
        if (!expression || !/^[0-9+\-*/%.()\s]+$/.test(expression) || !/[0-9]/.test(expression)) {
            return null;
        }

        try {
            const result = Function(`"use strict"; return (${expression});`)();
            if (!Number.isFinite(result)) {
                return null;
            }

            const rounded = Math.abs(result) < 1e12
                ? Number(result.toFixed(8))
                : result;
            return String(rounded);
        } catch {
            return null;
        }
    }

    getOmniboxKnownPages() {
        return [
            'chrome://newtab/',
            'chrome://history/',
            'chrome://downloads/',
            'chrome://bookmarks/',
            'chrome://settings/',
            'chrome://settings/searchEngines/',
            'chrome://extensions/',
            'chrome://flags/',
            'chrome://about/',
            'chrome://version/'
        ];
    }

    shouldOpenZeroSuggestOnFocus() {
        if (!this.isFlagEnabled('enable-zero-suggest')) {
            return false;
        }

        const activeTab = this.getActiveTab();
        const address = this.normalizeAddress(activeTab?.address || '');
        if (!address || address === 'chrome://newtab/') {
            return false;
        }

        return address.startsWith('https://') || address.startsWith('http://');
    }

    getZeroSuggestSuggestions() {
        const suggestions = [];
        const seenAddresses = new Set();
        const addSuggestion = (suggestion) => {
            if (!suggestion?.address || seenAddresses.has(suggestion.address)) {
                return;
            }

            seenAddresses.add(suggestion.address);
            suggestions.push(suggestion);
        };

        const activeTab = this.getActiveTab();
        if (activeTab?.address && !this.isLocalAddress(activeTab.address) && activeTab.address !== 'chrome://newtab/') {
            addSuggestion({
                kind: 'current-page',
                icon: 'page',
                primary: activeTab.title || this.getHistoryTitleFromAddress(activeTab.address),
                secondary: this.getHistoryDomainFromAddress(activeTab.address),
                descriptionKind: 'url',
                address: activeTab.address,
                fillIntoEdit: activeTab.address
            });
        }

        this.localUiState.historyItems
            .slice()
            .sort((left, right) => (right.visitedAt || 0) - (left.visitedAt || 0))
            .forEach((item) => {
                addSuggestion({
                    kind: 'history',
                    icon: 'page',
                    primary: item.title || this.getHistoryTitleFromAddress(item.address),
                    secondary: item.domain || this.getHistoryDomainFromAddress(item.address),
                    descriptionKind: 'url',
                    address: item.address,
                    fillIntoEdit: item.address
                });
            });

        this.collectBookmarkManagerSearchResults()
            .filter((bookmark) => bookmark.type === 'url')
            .forEach((bookmark) => {
                addSuggestion({
                    kind: 'bookmark',
                    icon: 'bookmark',
                    primary: bookmark.label || this.getHistoryTitleFromAddress(bookmark.address),
                    secondary: this.getHistoryDomainFromAddress(bookmark.address),
                    descriptionKind: 'url',
                    address: bookmark.address,
                    fillIntoEdit: bookmark.address
                });
            });

        return suggestions.slice(0, 8);
    }

    getOmniboxSuggestions(query, options = {}) {
        const trimmed = (query || '').trim();
        const lowered = trimmed.toLowerCase();

        if (!trimmed && options.fromFocus) {
            return this.shouldOpenZeroSuggestOnFocus()
                ? this.getZeroSuggestSuggestions()
                : [];
        }

        const suggestions = [];
        const seenAddresses = new Set();
        const searchLabel = `${this.getSearchEngineLabel()} Search`;
        const addSuggestion = (suggestion) => {
            if (!suggestion || !suggestion.address || seenAddresses.has(suggestion.address)) {
                return;
            }

            seenAddresses.add(suggestion.address);
            suggestions.push(suggestion);
        };

        if (trimmed) {
            const normalized = this.normalizeAddress(trimmed);
            const calculatorResult = this.looksLikeAddressInput(trimmed)
                ? null
                : this.evaluateOmniboxCalculatorExpression(trimmed);
            if (calculatorResult !== null) {
                addSuggestion({
                    kind: 'calculator',
                    icon: 'calculator',
                    primary: calculatorResult,
                    secondary: trimmed,
                    address: normalized,
                    fillIntoEdit: trimmed
                });
            }

            if (this.looksLikeAddressInput(trimmed)) {
                addSuggestion({
                    kind: 'typed-url',
                    icon: 'page',
                    primary: trimmed,
                    secondary: this.getHistoryDomainFromAddress(normalized),
                    descriptionKind: 'url',
                    address: normalized,
                    fillIntoEdit: normalized
                });
            } else {
                addSuggestion({
                    kind: 'search',
                    icon: 'search',
                    primary: trimmed,
                    secondary: searchLabel,
                    address: normalized,
                    fillIntoEdit: trimmed
                });
            }

            if (this.omniboxRemoteSuggestionsQuery === trimmed) {
                this.omniboxRemoteSuggestions.forEach((suggestion) => addSuggestion(suggestion));
            }
        }

        this.getOmniboxKnownPages()
            .filter((address) => !trimmed || address.toLowerCase().includes(lowered) || this.getLocalPageTitle(address).toLowerCase().includes(lowered))
            .forEach((address) => {
                addSuggestion({
                    kind: 'local',
                    icon: 'page',
                    primary: this.getLocalPageTitle(address),
                    secondary: address,
                    descriptionKind: 'url',
                    address,
                    fillIntoEdit: address
                });
            });

        this.collectBookmarkManagerSearchResults()
            .filter((bookmark) => bookmark.type === 'url')
            .filter((bookmark) => !trimmed || `${bookmark.label} ${bookmark.address || ''}`.toLowerCase().includes(lowered))
            .forEach((bookmark) => {
                addSuggestion({
                    kind: 'bookmark',
                    icon: 'bookmark',
                    primary: bookmark.label || this.getHistoryTitleFromAddress(bookmark.address),
                    secondary: this.getHistoryDomainFromAddress(bookmark.address),
                    descriptionKind: 'url',
                    address: bookmark.address,
                    fillIntoEdit: bookmark.address
                });
            });

        this.localUiState.historyItems
            .filter((item) => !trimmed || `${item.title} ${item.address} ${item.domain || ''}`.toLowerCase().includes(lowered))
            .forEach((item) => {
                addSuggestion({
                    kind: 'history',
                    icon: 'page',
                    primary: item.title || this.getHistoryTitleFromAddress(item.address),
                    secondary: item.domain || this.getHistoryDomainFromAddress(item.address),
                    descriptionKind: 'url',
                    address: item.address,
                    fillIntoEdit: item.address
                });
            });

        return suggestions.slice(0, 8);
    }

    // ─── Tab management ───

    createTab(address, options = {}) {
        const previousLayout = this.snapshotTabStripLayout();
        const normalized = this.normalizeAddress(address);
        const isLocal = this.isLocalAddress(normalized);

        const tab = {
            id: `chrome-tab-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            title: isLocal ? this.getLocalPageTitle(normalized) : normalized,
            address: normalized,
            isLocal: isLocal,
            webview: null,
            webviewReady: false,
            zoomPercent: 100,
            loading: false,
            networkState: 'none',
            faviconUrl: null,
            historyEntries: [normalized],
            historyIndex: 0,
            pendingHistoryCommit: null,
            suppressHistoryCommit: false,
            nativeCanGoBack: false,
            nativeCanGoForward: false,
            canGoBack: false,
            canGoForward: false,
            historyPreviewCache: {}
        };

        this.tabs.push(tab);

        if (options.activate !== false) {
            this.activeTabId = tab.id;
        }

        this.renderTabs({
            previousLayout,
            enteringTabId: tab.id
        });

        if (options.activate !== false) {
            this.activateTab(tab.id, { skipRender: true });
        }

        this.savePersistentState();

        return tab;
    }

    pushRecentlyClosedTab(serializedTab) {
        if (!serializedTab?.address) {
            return;
        }

        this.recentlyClosedTabs.unshift(serializedTab);
        if (this.recentlyClosedTabs.length > 20) {
            this.recentlyClosedTabs.length = 20;
        }
    }

    closeTab(tabId, options = {}) {
        if (!tabId) {
            return;
        }

        const shouldAnimate = options.animate !== false;
        const previousLayout = shouldAnimate ? this.snapshotTabStripLayout() : null;
        const index = this.tabs.findIndex((tab) => tab.id === tabId);
        if (index === -1) {
            return;
        }

        const tab = this.tabs[index];
        const closingTabLayout = previousLayout?.tabs?.[tabId] || null;
        const serializedTab = options.recordRecentlyClosed === false
            ? null
            : this.serializeTabState(tab);

        // Destroy webview if it exists
        if (tab.webview) {
            tab.webview.remove();
            tab.webview = null;
            tab.webviewReady = false;
        }

        if (serializedTab) {
            this.pushRecentlyClosedTab(serializedTab);
        }

        this.tabs.splice(index, 1);

        if (this.tabs.length === 0) {
            this.closeWindow();
            return;
        }

        const nextTab = this.tabs[Math.max(0, index - 1)] || this.tabs[0];
        this.activeTabId = nextTab.id;
        this.renderTabs({
            previousLayout,
            closingTabLayout: closingTabLayout ? {
                ...closingTabLayout
            } : null
        });
        this.activateTab(nextTab.id, { skipRender: true });
        this.savePersistentState();
    }

    closeWindow() {
        const topWindow = window.top || window.parent || window;

        if (typeof topWindow.closeClassicApp === 'function' && this.windowId) {
            topWindow.closeClassicApp(this.windowId);
            return;
        }

        if (window.parent && window.parent !== window) {
            window.parent.postMessage({ action: 'closeClassicApp', appId: APP_ID, windowId: this.windowId }, '*');
            return;
        }

        window.close();
    }

    relaunchWindow() {
        const topWindow = window.top || window.parent || window;

        if (typeof topWindow.relaunchClassicApp === 'function' &&
            this.windowId) {
            topWindow.relaunchClassicApp(this.windowId, APP_ID, 1200);
            return;
        }

        this.showStatus('Chrome Beta relaunch is not available in this host.', true);
    }

    activateTab(tabId, options = {}) {
        const nextTab = this.tabs.find((tab) => tab.id === tabId);
        if (!nextTab) {
            return;
        }

        this.closeBookmarkBubble({ applyEdits: true });
        this.closeOmniboxPopup();
        this.closeWebviewContextMenu();
        this.activeTabId = tabId;

        if (!this.isNewTabAddress(nextTab.address) && this.localUiState.ntpFakeboxState !== 'idle') {
            this.localUiState.ntpFakeboxState = 'idle';
        }

        // Hide all webviews
        this.tabs.forEach((tab) => {
            if (tab.webview) {
                tab.webview.style.display = 'none';
            }
        });

        if (nextTab.isLocal) {
            // Show local page (rendered in iframe), hide parent webview layer
            this.pageHost.style.display = '';
            this.renderLocalPage(nextTab.address);
            this.applyTabZoom(nextTab);

            if (this.hostedWebviewContainer) {
                this.hostedWebviewContainer.style.display = 'none';
            }
        } else {
            // Show parent-hosted webview, hide local page
            this.pageHost.style.display = 'none';

            if (this.hostedWebviewContainer) {
                this.syncWebviewOffset();
                this.hostedWebviewContainer.style.display = '';
            }

            if (!nextTab.webview) {
                this.createWebviewForTab(nextTab);
                nextTab.webview.src = nextTab.address;
            }
            nextTab.webview.style.display = '';
            this.applyTabZoom(nextTab);

        }

        this.applySurfacePreferences();
        this.refreshBookmarkStar();
        this.addressInput.value = nextTab.address;
        this.refreshAddressDisplay();
        this.updateSecurityBadge(nextTab.address, { editing: this.addressIsFocused });
        this.updateZoomUi();
        this.updateNavButtons(nextTab);
        this.updateWindowTitle(nextTab.title);
        if (!options.skipRender) {
            this.renderTabs();
        }

        this.savePersistentState();
    }

    navigateCurrentTab(addressInput, options = {}) {
        const activeTab = this.getActiveTab();
        if (!activeTab) {
            return;
        }

        this.closeBookmarkBubble({ applyEdits: true });
        this.closeOmniboxPopup();
        this.closePageInfoBubble();
        this.closeWebviewContextMenu();
        const normalized = this.normalizeAddress(addressInput);
        const isLocal = this.isLocalAddress(normalized);

        if (!this.isNewTabAddress(normalized) && this.localUiState.ntpFakeboxState !== 'idle') {
            this.localUiState.ntpFakeboxState = 'idle';
        }

        activeTab.address = normalized;
        activeTab.isLocal = isLocal;
        activeTab.faviconUrl = null;
        activeTab.loading = false;
        activeTab.networkState = 'none';

        if (isLocal) {
            activeTab.pendingHistoryCommit = null;
            activeTab.suppressHistoryCommit = false;
            if (!options.fromHistory) {
                this.pushTabHistoryEntry(activeTab, normalized, { replace: !!options.replace });
                this.recordHistoryVisit(normalized, this.getLocalPageTitle(normalized));
            }
            activeTab.title = this.getLocalPageTitle(normalized);

            // Hide parent webview layer, show local page
            if (activeTab.webview) {
                activeTab.webview.style.display = 'none';
            }
            if (this.hostedWebviewContainer) {
                this.hostedWebviewContainer.style.display = 'none';
            }
            this.pageHost.style.display = '';
            this.renderLocalPage(normalized);
            this.applyTabZoom(activeTab);
        } else {
            activeTab.pendingHistoryCommit = options.fromHistory
                ? null
                : {
                    address: normalized,
                    replace: !!options.replace
                };
            activeTab.suppressHistoryCommit = !!options.fromHistory;
            activeTab.title = normalized;

            // Hide local page, show parent-hosted webview
            this.pageHost.style.display = 'none';

            if (this.hostedWebviewContainer) {
                this.syncWebviewOffset();
                this.hostedWebviewContainer.style.display = '';
            }

            if (!activeTab.webview) {
                this.createWebviewForTab(activeTab);
            }
            activeTab.webview.style.display = '';
            const currentUrl = activeTab.webviewReady && typeof activeTab.webview.getURL === 'function'
                ? activeTab.webview.getURL()
                : activeTab.address;
            if (!options.fromHistory || currentUrl !== normalized) {
                activeTab.webview.src = normalized;
            }
            this.applyTabZoom(activeTab);
        }

        this.refreshTabNavigationState(activeTab);
        this.applySurfacePreferences();
        this.refreshBookmarkStar();
        this.addressInput.value = normalized;
        this.refreshAddressDisplay();
        this.updateSecurityBadge(normalized, { editing: this.addressIsFocused });
        this.updateZoomUi();
        this.updateNavButtons(activeTab);
        this.updateWindowTitle(activeTab.title);
        this.renderTabs();
        this.savePersistentState();
    }

    goBack() {
        const activeTab = this.getActiveTab();
        if (!activeTab) {
            return;
        }

        if (Array.isArray(activeTab.historyEntries) && activeTab.historyIndex > 0) {
            activeTab.historyIndex -= 1;
            this.navigateCurrentTab(activeTab.historyEntries[activeTab.historyIndex], { fromHistory: true });
        }
    }

    goForward() {
        const activeTab = this.getActiveTab();
        if (!activeTab) {
            return;
        }

        if (Array.isArray(activeTab.historyEntries) && activeTab.historyIndex < activeTab.historyEntries.length - 1) {
            activeTab.historyIndex += 1;
            this.navigateCurrentTab(activeTab.historyEntries[activeTab.historyIndex], { fromHistory: true });
        }
    }

    refreshActiveTab() {
        const activeTab = this.getActiveTab();
        if (!activeTab) {
            return;
        }

        if (activeTab.isLocal) {
            this.renderLocalPage(activeTab.address);
        } else if (activeTab.webview) {
            activeTab.webview.reload();
        }
    }

    getActiveTab() {
        return this.tabs.find((tab) => tab.id === this.activeTabId) || null;
    }

    pushTabHistoryEntry(tab, address, options = {}) {
        if (!tab) {
            return;
        }

        if (!Array.isArray(tab.historyEntries) || !tab.historyEntries.length) {
            tab.historyEntries = [address];
            tab.historyIndex = 0;
            return;
        }

        const currentAddress = tab.historyEntries[tab.historyIndex];
        if (options.replace) {
            tab.historyEntries[tab.historyIndex] = address;
            return;
        }

        if (currentAddress === address) {
            return;
        }

        tab.historyEntries = tab.historyEntries.slice(0, tab.historyIndex + 1);
        tab.historyEntries.push(address);
        tab.historyIndex = tab.historyEntries.length - 1;
    }

    refreshTabNavigationState(tab) {
        if (!tab) {
            return;
        }

        const hasSyntheticBack = Array.isArray(tab.historyEntries) && tab.historyIndex > 0;
        const hasSyntheticForward = Array.isArray(tab.historyEntries) && tab.historyIndex < tab.historyEntries.length - 1;

        tab.canGoBack = hasSyntheticBack;
        tab.canGoForward = hasSyntheticForward;
    }

    commitTabWebviewNavigation(tab, rawUrl) {
        if (!tab || !rawUrl) {
            return;
        }

        const normalized = this.normalizeAddress(rawUrl);
        const pendingCommit = tab.pendingHistoryCommit;
        const shouldSuppress = !!tab.suppressHistoryCommit;
        const currentAddress = Array.isArray(tab.historyEntries) ? tab.historyEntries[tab.historyIndex] : null;
        const shouldRecordNavigation = !!pendingCommit || currentAddress !== normalized;

        tab.pendingHistoryCommit = null;
        tab.suppressHistoryCommit = false;
        tab.address = normalized;
        tab.isLocal = false;

        if (!shouldSuppress && shouldRecordNavigation) {
            this.pushTabHistoryEntry(tab, normalized, { replace: !!pendingCommit?.replace });
            this.recordHistoryVisit(normalized, tab.title || normalized);
        }

        this.refreshTabNavigationState(tab);
        this.savePersistentState();
    }

    getTabHistoryPreviewCache(tab) {
        if (!tab) {
            return null;
        }

        if (!tab.historyPreviewCache || typeof tab.historyPreviewCache !== 'object') {
            tab.historyPreviewCache = {};
        }

        return tab.historyPreviewCache;
    }

    storeLocalHistoryPreview(tab, address = tab?.address) {
        if (!tab || !address || typeof tab.localPreviewMarkup !== 'string') {
            return;
        }

        const cache = this.getTabHistoryPreviewCache(tab);
        if (!cache) {
            return;
        }

        cache[address] = {
            type: 'local',
            address,
            title: tab.title || address,
            markup: tab.localPreviewMarkup,
            width: tab.localPreviewWidth || this.pageHost?.clientWidth || 980,
            capturedAt: Date.now()
        };
    }

    async captureWebviewHistoryPreview(tab, address = tab?.address) {
        if (!tab || !address || !tab.webviewReady || !tab.webview || typeof tab.webview.capturePage !== 'function') {
            return null;
        }

        try {
            const image = await tab.webview.capturePage();
            const dataUrl = image?.toDataURL?.() || '';
            if (!dataUrl) {
                return null;
            }

            const cache = this.getTabHistoryPreviewCache(tab);
            if (!cache) {
                return null;
            }

            const preview = {
                type: 'image',
                address,
                title: tab.title || address,
                dataUrl,
                capturedAt: Date.now()
            };
            cache[address] = preview;
            return preview;
        } catch (_error) {
            return null;
        }
    }

    captureHistoryPreviewForCurrentEntry(tab) {
        if (!tab) {
            return;
        }

        if (tab.isLocal) {
            this.storeLocalHistoryPreview(tab, tab.address);
            return;
        }

        void this.captureWebviewHistoryPreview(tab, tab.address);
    }

    getHistoryPreviewForIndex(tab, index) {
        if (!tab || !Array.isArray(tab.historyEntries)) {
            return null;
        }

        const address = tab.historyEntries[index];
        if (!address) {
            return null;
        }

        return this.getTabHistoryPreviewCache(tab)?.[address] || null;
    }

    getOverscrollPaneMarkup(preview, fallbackAddress, fallbackTitle) {
        if (preview?.type === 'image' && preview.dataUrl) {
            return `<img class="chrome-hosted-overscroll-screenshot" src="${this.escapeHtml(preview.dataUrl)}" alt="">`;
        }

        const title = preview?.title || fallbackTitle || this.getHistoryTitleFromAddress(fallbackAddress || '') || 'Page';
        const address = preview?.address || fallbackAddress || '';
        return `
            <div class="chrome-hosted-overscroll-fallback">
                <div class="chrome-hosted-overscroll-fallback-title">${this.escapeHtml(title)}</div>
                <div class="chrome-hosted-overscroll-fallback-address">${this.escapeHtml(address)}</div>
            </div>
        `;
    }

    recordHistoryVisit(address, title) {
        const normalized = this.normalizeAddress(address || '');
        if (!normalized || normalized === 'chrome://newtab/') {
            return;
        }

        const now = new Date();
        const timestamp = now.getTime();
        const nextEntry = {
            title: title || this.getHistoryTitleFromAddress(normalized),
            address: normalized,
            domain: this.getHistoryDomainFromAddress(normalized),
            time: this.formatHistoryTimestamp(now),
            period: this.getHistoryPeriodLabel(now),
            visitedAt: timestamp
        };

        const latestEntry = this.localUiState.historyItems[0];
        if (
            latestEntry &&
            latestEntry.address === nextEntry.address &&
            Math.abs((latestEntry.visitedAt || 0) - timestamp) < 5000
        ) {
            this.localUiState.historyItems[0] = {
                ...latestEntry,
                ...nextEntry
            };
        } else {
            this.localUiState.historyItems = [nextEntry, ...this.localUiState.historyItems].slice(0, 200);
        }
    }

    updateRecentHistoryTitle(address, title) {
        const normalized = this.normalizeAddress(address || '');
        if (!normalized || !title) {
            return;
        }

        const entry = this.localUiState.historyItems.find((item) => item.address === normalized);
        if (entry) {
            entry.title = title;
            this.savePersistentState();
        }
    }

    getHistoryTitleFromAddress(address) {
        if (this.isLocalAddress(address)) {
            return this.getLocalPageTitle(address);
        }

        try {
            const url = new URL(address);
            return url.hostname || address;
        } catch {
            return address;
        }
    }

    getHistoryDomainFromAddress(address) {
        if (this.isLocalAddress(address)) {
            return address.replace(/\/$/, '');
        }

        try {
            const url = new URL(address);
            return url.hostname || address;
        } catch {
            return address;
        }
    }

    formatHistoryTimestamp(date) {
        return date.toLocaleTimeString([], {
            hour: 'numeric',
            minute: '2-digit'
        });
    }

    getHistoryPeriodLabel(date) {
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const yesterdayStart = new Date(todayStart);
        yesterdayStart.setDate(yesterdayStart.getDate() - 1);
        const weekStart = new Date(todayStart);
        weekStart.setDate(weekStart.getDate() - 7);

        if (date >= todayStart) {
            return 'Today';
        }

        if (date >= yesterdayStart) {
            return 'Yesterday';
        }

        if (date >= weekStart) {
            return 'Earlier this week';
        }

        return date.toLocaleDateString([], {
            month: 'short',
            day: 'numeric'
        });
    }

    getHistoryGroups() {
        const periodOrder = ['Today', 'Yesterday', 'Earlier this week'];
        const groups = new Map();

        this.localUiState.historyItems
            .slice()
            .sort((left, right) => (right.visitedAt || 0) - (left.visitedAt || 0))
            .forEach((item) => {
                const period = item.period || 'Earlier this week';
                if (!groups.has(period)) {
                    groups.set(period, []);
                }
                groups.get(period).push(item);
            });

        return Array.from(groups.entries())
            .sort((left, right) => {
                const leftIndex = periodOrder.indexOf(left[0]);
                const rightIndex = periodOrder.indexOf(right[0]);
                return (leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex) -
                    (rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex);
            })
            .map(([label, items]) => ({ label, items }));
    }

    // ─── Webview management (parent-hosted) ───

    createWebviewForTab(tab) {
        if (!this.hostedWebviewContainer) {
            return null;
        }

        const parentDoc = this.hostedWebviewContainer.ownerDocument;
        const webview = parentDoc.createElement('webview');
        webview.className = 'chrome-hosted-webview';
        webview.setAttribute('partition', 'persist:chrome-beta-browser');
        webview.setAttribute('preload', this.getAssetUrl('webview-bridge.js'));
        webview.style.cssText = 'width:100%; height:100%; border:none; display:none;';

        this.hostedWebviewContainer.appendChild(webview);
        tab.webview = webview;
        tab.webviewReady = false;

        webview.addEventListener('ipc-message', (event) => {
            if (tab.id !== this.activeTabId) {
                return;
            }

            if (event.channel === 'chrome-beta-context-menu') {
                const payload = Array.isArray(event.args) ? event.args[0] : null;
                this.showWebviewContextMenu(payload);
                return;
            }

            if (event.channel === 'chrome-beta-swipe-gesture') {
                const payload = Array.isArray(event.args) ? event.args[0] : null;
                if (payload) {
                    this.processSwipeNavigationSignal(payload);
                }
            }
        });
        webview.addEventListener('mousemove', (event) => {
            if (tab.id !== this.activeTabId) {
                return;
            }

            this.lastWebviewMousePoint = { clientX: event.clientX, clientY: event.clientY };
            this.updateStatusBubbleMouseAvoidance(event.clientX, event.clientY, false);
        });
        webview.addEventListener('mouseleave', () => {
            if (tab.id !== this.activeTabId) {
                return;
            }

            this.lastWebviewMousePoint = null;
            this.updateStatusBubbleMouseAvoidance(0, 0, true);
        });

        webview.addEventListener('dom-ready', () => {
            tab.webviewReady = true;
            this.applyTabZoom(tab);
            this.updateNavButtonsAsync(tab);
        });

        // Navigation events
        webview.addEventListener('did-navigate', (event) => {
            this.commitTabWebviewNavigation(tab, event.url);
            if (tab.loading && tab.networkState === 'waiting') {
                tab.networkState = 'loading';
            }
            this.updateNavButtonsAsync(tab);

            if (tab.id === this.activeTabId) {
                this.addressInput.value = event.url;
                this.refreshAddressDisplay();
                this.updateSecurityBadge(event.url, { editing: this.addressIsFocused });
            }
        });

        webview.addEventListener('did-navigate-in-page', (event) => {
            if (!event.isMainFrame) {
                return;
            }

            this.commitTabWebviewNavigation(tab, event.url);
            if (tab.loading && tab.networkState === 'waiting') {
                tab.networkState = 'loading';
            }
            this.updateNavButtonsAsync(tab);

            if (tab.id === this.activeTabId) {
                this.addressInput.value = event.url;
                this.refreshAddressDisplay();
                this.updateSecurityBadge(event.url, { editing: this.addressIsFocused });
            }
        });

        webview.addEventListener('load-commit', (event) => {
            if (!event.isMainFrame) {
                return;
            }

            if (tab.loading && tab.networkState !== 'loading') {
                tab.networkState = 'loading';
                this.renderTabs();
            }
        });

        // Title updates
        webview.addEventListener('page-title-updated', (event) => {
            tab.title = event.title;
            this.updateRecentHistoryTitle(tab.address, event.title);
            this.renderTabs();

            if (tab.id === this.activeTabId) {
                this.updateWindowTitle(event.title);
            }
        });

        // Loading states
        webview.addEventListener('did-start-loading', () => {
            tab.loading = true;
            tab.networkState = 'waiting';
            tab.faviconUrl = null;
            this.renderTabs();
        });

        webview.addEventListener('did-stop-loading', () => {
            tab.loading = false;
            tab.networkState = 'none';
            this.updateNavButtonsAsync(tab);
            this.renderTabs();
            this.captureHistoryPreviewForCurrentEntry(tab);
        });

        webview.addEventListener('page-favicon-updated', (event) => {
            const faviconUrl = Array.isArray(event.favicons) ? event.favicons[0] : null;
            if (!faviconUrl) {
                return;
            }

            tab.faviconUrl = faviconUrl;
            if (tab.address) {
                this.updateBookmarkFaviconsForAddress(tab.address, faviconUrl);
            }
            this.renderTabs();
        });

        // Handle link hover status
        webview.addEventListener('update-target-url', (event) => {
            if (tab.id !== this.activeTabId) {
                return;
            }

            if (event.url) {
                this.showHoverStatus(event.url);
            } else {
                this.hideHoverStatus();
            }
        });

        // Handle new window requests (Ctrl+click, target=_blank, etc.)
        webview.addEventListener('new-window', (event) => {
            if (typeof event.preventDefault === 'function') {
                event.preventDefault();
            }

            if (!event.url) {
                return;
            }

            const activate = event.disposition !== 'background-tab';
            const newTab = this.createTab(event.url, { activate });

            if (!activate && newTab) {
                this.renderTabs();
            }
        });

        // Handle page errors gracefully
        webview.addEventListener('did-fail-load', (event) => {
            if (event.errorCode === -3) {
                return;
            }

            tab.loading = false;
            tab.networkState = 'none';
            this.renderTabs();
        });

        webview.addEventListener('did-finish-load', () => {
            tab.webviewReady = true;
            this.applyTabZoom(tab);
            if (tab.id === this.activeTabId) {
                this.updateSecurityBadge(tab.address, { editing: this.addressIsFocused });
                this.updateZoomUi();
            }
        });

        return webview;
    }

    updateNavButtons(tab) {
        if (!tab) {
            this.backButton.disabled = true;
            this.forwardButton.disabled = true;
            return;
        }

        this.backButton.disabled = !tab.canGoBack;
        this.forwardButton.disabled = !tab.canGoForward;
    }

    updateNavButtonsAsync(tab) {
        if (!tab || !tab.webview) {
            this.updateNavButtons(tab);
            return;
        }

        try {
            tab.nativeCanGoBack = tab.webview.canGoBack();
            tab.nativeCanGoForward = tab.webview.canGoForward();
        } catch (e) {
            tab.nativeCanGoBack = false;
            tab.nativeCanGoForward = false;
        }

        this.refreshTabNavigationState(tab);

        if (tab.id === this.activeTabId) {
            this.updateNavButtons(tab);
        }
    }

    getAddressSecurityState(address, options = {}) {
        if (options.editing) {
            return { level: 'none', icon: 'none' };
        }

        if (!address) {
            return { level: 'none', icon: 'none' };
        }

        if (address === 'chrome://newtab/') {
            return { level: 'none', icon: 'page' };
        }

        if (this.isLocalAddress(address) || address.startsWith('about:')) {
            return { level: 'none', icon: 'page' };
        }

        try {
            const url = new URL(address);
            const host = url.hostname.toLowerCase();

            if (url.protocol === 'https:') {
                if (/^(expired|wrong\.host|self-signed|untrusted-root|revoked|pinning-test|superfish)\.badssl\.com$/.test(host)) {
                    return { level: 'error', icon: 'error' };
                }

                if (/^(mixed-script|mixed|sha1-|rc4-|3des|cbc|null|dh480|dh512|dh1024)\S*\.badssl\.com$/.test(host)) {
                    return { level: 'warning', icon: 'warning' };
                }

                return { level: 'secure', icon: 'secure' };
            }

            if (url.protocol === 'http:' || url.protocol === 'ftp:') {
                return { level: 'none', icon: 'neutral' };
            }
        } catch {
            return { level: 'none', icon: 'none' };
        }

        return { level: 'none', icon: 'neutral' };
    }

    updateSecurityBadge(address, options = {}) {
        const state = this.getAddressSecurityState(address, options);
        const customPageIconUrl = state.icon === 'page' ? this.getLocalPageFaviconUrl(address) : null;
        this.securityBadge.classList.toggle('is-neutral', state.icon === 'neutral');
        this.securityBadge.classList.toggle('is-secure', state.icon === 'secure');
        this.securityBadge.classList.toggle('is-warning', state.icon === 'warning');
        this.securityBadge.classList.toggle('is-error', state.icon === 'error');
        this.securityBadge.classList.toggle('is-page', state.icon === 'page');
        this.securityBadge.classList.toggle('has-custom-page-icon', Boolean(customPageIconUrl));
        this.securityBadge.style.setProperty('--chrome-security-badge-image', customPageIconUrl ? `url("${customPageIconUrl}")` : '');
        this.securityBadge.hidden = state.icon === 'none';
    }

    syncAddressShellVisualState() {
        if (!this.addressForm) {
            return;
        }

        const activeTab = this.getActiveTab();
        const isNtpFakeboxHandoff = !!activeTab &&
            this.isNewTabAddress(activeTab.address) &&
            this.addressIsFocused &&
            this.localUiState.ntpFakeboxState === 'focused';

        this.addressForm.classList.toggle('is-ntp-fakebox-handoff', isNtpFakeboxHandoff);
    }

    refreshAddressDisplay() {
        if (!this.addressDisplay || !this.addressInput) {
            return;
        }

        this.syncAddressShellVisualState();

        const address = this.addressInput.value || '';
        const state = this.getAddressSecurityState(address, { editing: this.addressIsFocused });
        const parts = this.getAddressDisplayParts(address, state);

        this.addressDisplay.innerHTML = parts.map((part) => `
            <span class="chrome-address-display-part ${part.className}">${this.escapeHtml(part.text)}</span>
        `).join('');

        this.addressDisplay.hidden = this.addressIsFocused || !address;
    }

    getAddressDisplayParts(address, securityState) {
        if (!address) {
            return [];
        }

        if (address === 'chrome://newtab/' && !this.addressIsFocused) {
            return [];
        }

        if (this.addressIsFocused) {
            return [{ text: address, className: 'is-plain' }];
        }

        try {
            const url = new URL(address);
            if (!['http:', 'https:', 'ftp:', 'chrome:'].includes(url.protocol)) {
                return [{ text: address, className: 'is-plain' }];
            }

            const schemeText = `${url.protocol}//`;
            const hostText = url.host;
            const schemeIndex = address.indexOf(schemeText);
            const hostIndex = schemeIndex === -1 ? -1 : schemeIndex + schemeText.length;

            if (schemeIndex === -1 || hostIndex === -1) {
                return [{ text: address, className: 'is-plain' }];
            }

            const beforeScheme = address.slice(0, schemeIndex);
            const hostEnd = hostIndex + hostText.length;
            const afterHost = address.slice(hostEnd);
            const schemeClass = securityState.level === 'secure'
                ? 'is-security is-secure'
                : securityState.level === 'warning'
                    ? 'is-security is-warning'
                    : securityState.level === 'error'
                        ? 'is-security is-error'
                        : 'is-deemphasized';

            const parts = [];

            if (beforeScheme) {
                parts.push({ text: beforeScheme, className: 'is-deemphasized' });
            }

            parts.push({ text: schemeText, className: schemeClass });
            parts.push({ text: hostText, className: 'is-host' });

            if (afterHost) {
                parts.push({ text: afterHost, className: 'is-deemphasized' });
            }

            return parts;
        } catch {
            return [{ text: address, className: 'is-plain' }];
        }
    }

    // ─── Tab rendering ───

    getTabStripAvailableWidth() {
        const measureRoot = this.hostTitlebarAppRegion || this.tabsRoot?.parentElement;

        if (!measureRoot) {
            return 0;
        }

        const rootWidth = Math.floor(measureRoot.getBoundingClientRect().width);
        const newTabRect = this.newTabButton?.getBoundingClientRect();
        const newTabWidth = Math.ceil((newTabRect?.width || 26) + 8);
        return Math.max(rootWidth - newTabWidth, 0);
    }

    getTabRenderWidth() {
        const tabCount = Math.max(this.tabs.length, 1);
        const availableWidth = this.getTabStripAvailableWidth();

        if (!availableWidth) {
            return CHROMIUM_TOP_CHROME.standardTabWidth;
        }

        const width = Math.floor(
            (availableWidth + (CHROMIUM_TOP_CHROME.tabOverlap * Math.max(tabCount - 1, 0))) / tabCount
        );

        return Math.max(
            CHROMIUM_TOP_CHROME.minimumTabWidth,
            Math.min(CHROMIUM_TOP_CHROME.standardTabWidth, width)
        );
    }

    snapshotTabStripLayout() {
        if (!this.tabsRoot) {
            return null;
        }

        const rootRect = this.tabsRoot.getBoundingClientRect();
        const tabs = {};

        this.tabsRoot.querySelectorAll('[data-tab-id]').forEach((button) => {
            const rect = button.getBoundingClientRect();
            tabs[button.dataset.tabId] = {
                left: rect.left - rootRect.left,
                top: rect.top - rootRect.top,
                width: rect.width,
                height: rect.height,
                html: button.outerHTML
            };
        });

        const newTabRect = this.newTabButton?.getBoundingClientRect();

        return {
            tabs,
            newTabButton: newTabRect ? {
                left: newTabRect.left - rootRect.left,
                top: newTabRect.top - rootRect.top,
                width: newTabRect.width,
                height: newTabRect.height
            } : null
        };
    }

    clearTabAnimationCleanupTimer() {
        if (this.tabAnimationCleanupTimer) {
            window.clearTimeout(this.tabAnimationCleanupTimer);
            this.tabAnimationCleanupTimer = null;
        }
    }

    applyBoundsAnimation(element, startBounds, endBounds) {
        if (!element || !startBounds || !endBounds) {
            return;
        }

        const deltaX = startBounds.left - endBounds.left;
        const startWidth = startBounds.width;
        const endWidth = endBounds.width;

        element.style.transition = 'none';
        element.style.transform = `translateX(${deltaX}px)`;
        element.style.width = `${startWidth}px`;
        element.style.minWidth = `${startWidth}px`;
        element.style.maxWidth = `${startWidth}px`;
        element.style.flexBasis = `${startWidth}px`;

        void element.offsetWidth;

        window.requestAnimationFrame(() => {
            element.style.transition = [
                `transform ${CHROMIUM_MOTION.tabBoundsDurationMs}ms ${CHROMIUM_MOTION.easeOut}`,
                `width ${CHROMIUM_MOTION.tabBoundsDurationMs}ms ${CHROMIUM_MOTION.easeOut}`,
                `min-width ${CHROMIUM_MOTION.tabBoundsDurationMs}ms ${CHROMIUM_MOTION.easeOut}`,
                `max-width ${CHROMIUM_MOTION.tabBoundsDurationMs}ms ${CHROMIUM_MOTION.easeOut}`,
                `flex-basis ${CHROMIUM_MOTION.tabBoundsDurationMs}ms ${CHROMIUM_MOTION.easeOut}`
            ].join(', ');
            element.style.transform = 'translateX(0)';
            element.style.width = `${endWidth}px`;
            element.style.minWidth = `${endWidth}px`;
            element.style.maxWidth = `${endWidth}px`;
            element.style.flexBasis = `${endWidth}px`;
        });
    }

    animateClosingTabGhost(layout) {
        if (!layout || !layout.html || !this.tabsRoot) {
            return;
        }

        const overlayHost = this.tabsRoot.parentElement;
        const overlayOffsets = this.getTabDragOverlayOffset();
        if (!this.isHtmlElement(overlayHost)) {
            return;
        }

        const ghostHost = this.tabsRoot.ownerDocument.createElement('div');
        ghostHost.innerHTML = layout.html.trim();
        const ghost = ghostHost.firstElementChild;

        if (!this.isHtmlElement(ghost)) {
            return;
        }

        ghost.classList.add('is-closing-ghost');
        ghost.classList.remove('is-active', 'is-drag-visual-active', 'is-hover-glow');
        ghost.removeAttribute('aria-selected');
        ghost.removeAttribute('data-tab-id');
        ghost.style.left = `${layout.left + overlayOffsets.left}px`;
        ghost.style.top = `${layout.top + overlayOffsets.top}px`;
        ghost.style.width = `${layout.width}px`;
        ghost.style.minWidth = `${layout.width}px`;
        ghost.style.maxWidth = `${layout.width}px`;
        ghost.style.flexBasis = `${layout.width}px`;
        ghost.style.height = `${layout.height}px`;

        overlayHost.appendChild(ghost);
        void ghost.offsetWidth;

        window.requestAnimationFrame(() => {
            ghost.style.transition = [
                `width ${CHROMIUM_MOTION.tabBoundsDurationMs}ms ${CHROMIUM_MOTION.easeOut}`,
                `min-width ${CHROMIUM_MOTION.tabBoundsDurationMs}ms ${CHROMIUM_MOTION.easeOut}`,
                `max-width ${CHROMIUM_MOTION.tabBoundsDurationMs}ms ${CHROMIUM_MOTION.easeOut}`,
                `flex-basis ${CHROMIUM_MOTION.tabBoundsDurationMs}ms ${CHROMIUM_MOTION.easeOut}`
            ].join(', ');
            ghost.style.width = '0px';
            ghost.style.minWidth = '0px';
            ghost.style.maxWidth = '0px';
            ghost.style.flexBasis = '0px';
        });

        window.setTimeout(() => ghost.remove(), CHROMIUM_MOTION.tabBoundsDurationMs + 40);
    }

    animateTabStripLayout(previousLayout, options = {}) {
        if (!this.tabsRoot || !previousLayout) {
            return;
        }

        this.clearTabAnimationCleanupTimer();

        const currentLayout = this.snapshotTabStripLayout();
        if (!currentLayout) {
            return;
        }

        const enteringTabId = options.enteringTabId || null;
        const closingTabLayout = options.closingTabLayout || null;
        const draggedTabId = options.draggedTabId || null;

        this.tabsRoot.querySelectorAll('[data-tab-id]').forEach((button) => {
            const tabId = button.dataset.tabId;
            const previousBounds = previousLayout.tabs[tabId];
            const currentBounds = currentLayout.tabs[tabId];

            if (!currentBounds) {
                return;
            }

            if (tabId === draggedTabId) {
                return;
            }

            if (previousBounds) {
                this.applyBoundsAnimation(button, previousBounds, currentBounds);
                return;
            }

            if (tabId === enteringTabId) {
                this.applyBoundsAnimation(button, {
                    left: currentBounds.left,
                    top: currentBounds.top,
                    width: 0,
                    height: currentBounds.height
                }, currentBounds);
            }
        });

        if (previousLayout.newTabButton && currentLayout.newTabButton) {
            this.newTabButton.style.transition = 'none';
            this.newTabButton.style.transform = `translateX(${previousLayout.newTabButton.left - currentLayout.newTabButton.left}px)`;
            void this.newTabButton.offsetWidth;
            window.requestAnimationFrame(() => {
                this.newTabButton.style.transition =
                    `transform ${CHROMIUM_MOTION.tabBoundsDurationMs}ms ${CHROMIUM_MOTION.easeOut}`;
                this.newTabButton.style.transform = 'translateX(0)';
            });
        }

        if (closingTabLayout) {
            this.animateClosingTabGhost(closingTabLayout);
        }

        this.tabAnimationCleanupTimer = window.setTimeout(() => {
            this.tabsRoot.querySelectorAll('[data-tab-id]').forEach((button) => {
                if (button.dataset.tabId === draggedTabId && this.tabDragState) {
                    return;
                }
                button.style.transition = '';
                button.style.transform = '';
                button.style.width = '';
                button.style.minWidth = '';
                button.style.maxWidth = '';
                button.style.flexBasis = '';
            });

            if (this.newTabButton) {
                this.newTabButton.style.transition = '';
                this.newTabButton.style.transform = '';
            }
        }, CHROMIUM_MOTION.tabBoundsDurationMs + 60);
    }

    setTabHoverLocation(button, event) {
        const rect = button.getBoundingClientRect();
        const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
        const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
        button.style.setProperty('--chrome-tab-hover-x', `${x}px`);
        button.style.setProperty('--chrome-tab-hover-y', `${y}px`);
    }

    handleTabPointerDown(event) {
        if (event.button !== 0 || !this.tabsRoot) {
            return;
        }

        const target = this.getElementTarget(event.target);
        if (!target) {
            return;
        }

        if (target.closest('[data-close-tab]')) {
            return;
        }

        const tabButton = target.closest('[data-tab-id]');
        if (!this.isHtmlElement(tabButton)) {
            return;
        }

        const tabId = tabButton.dataset.tabId;
        if (!tabId) {
            return;
        }

        event.preventDefault();
        if (typeof tabButton.setPointerCapture === 'function') {
            tabButton.setPointerCapture(event.pointerId);
        }

        this.pendingTabDrag = {
            pointerId: event.pointerId,
            tabId,
            startClientX: event.clientX,
            startClientY: event.clientY
        };
    }

    handleBookmarkPointerDown(event) {
        if (event.button !== 0 || !this.bookmarkBar) {
            return;
        }

        const target = this.getElementTarget(event.target);
        if (!target || target.closest('[data-bookmark-overflow]')) {
            return;
        }

        const button = target.closest('[data-bookmark-id]');
        if (!this.isHtmlElement(button)) {
            return;
        }

        const bookmarkId = button.dataset.bookmarkId;
        if (!bookmarkId) {
            return;
        }

        this.beginPendingBookmarkDrag({
            dragKind: 'bookmark',
            sourceKind: 'bar',
            bookmarkId,
            sourceElement: button
        }, event);
    }

    handleBookmarkPopupPointerDown(event) {
        if (event.button !== 0 || !this.hostedBookmarkPopup) {
            return;
        }

        const target = this.getElementTarget(event.target);
        const item = target?.closest('[data-popup-bookmark-id]');
        if (!this.isHtmlElement(item)) {
            return;
        }

        const bookmarkId = item.dataset.popupBookmarkId;
        if (!bookmarkId) {
            return;
        }

        this.beginPendingBookmarkDrag({
            dragKind: 'bookmark',
            sourceKind: 'popup',
            bookmarkId,
            sourceElement: item
        }, event);
    }

    handleLocationBadgePointerDown(event) {
        if (event.button !== 0 || !this.securityBadge || this.securityBadge.hidden || this.addressIsFocused) {
            return;
        }

        const activeTab = this.getActiveTab();
        if (!activeTab?.address) {
            return;
        }

        this.beginPendingBookmarkDrag({
            dragKind: 'location',
            sourceKind: 'security',
            sourceElement: this.securityBadge,
            address: activeTab.address,
            label: this.getBookmarkLabelForAddress(activeTab.address, activeTab.title),
            faviconUrl: this.getTabFaviconUrl(activeTab) || this.getLocalPageFaviconUrl(activeTab.address)
        }, event);
    }

    handleSecurityBadgeClick(event) {
        if (!this.securityBadge || this.securityBadge.hidden || this.addressIsFocused) {
            return;
        }

        if (this.suppressNextBookmarkClick) {
            this.suppressNextBookmarkClick = false;
            event.preventDefault();
            event.stopPropagation();
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        this.togglePageInfoBubble();
    }

    beginPendingBookmarkDrag(payload, event) {
        if (!payload?.sourceElement || !this.isHtmlElement(payload.sourceElement)) {
            return;
        }

        if (typeof payload.sourceElement.setPointerCapture === 'function') {
            payload.sourceElement.setPointerCapture(event.pointerId);
        }

        this.pendingBookmarkDrag = {
            ...payload,
            pointerId: event.pointerId,
            startClientX: event.clientX,
            startClientY: event.clientY
        };
    }

    handleGlobalPointerMove(event) {
        if (this.tabDragState) {
            if (event.pointerId !== this.tabDragState.pointerId) {
                return;
            }

            event.preventDefault();
            this.continueTabDrag(event);
            return;
        }

        if (this.bookmarkDragState) {
            if (event.pointerId !== this.bookmarkDragState.pointerId) {
                return;
            }

            event.preventDefault();
            this.continueBookmarkDrag(event);
            return;
        }

        if (!this.pendingTabDrag || event.pointerId !== this.pendingTabDrag.pointerId) {
            if (!this.pendingBookmarkDrag || event.pointerId !== this.pendingBookmarkDrag.pointerId) {
                return;
            }

            const bookmarkDeltaX = event.clientX - this.pendingBookmarkDrag.startClientX;
            const bookmarkDeltaY = event.clientY - this.pendingBookmarkDrag.startClientY;
            if (Math.hypot(bookmarkDeltaX, bookmarkDeltaY) < TAB_DRAG_THRESHOLD_PX) {
                return;
            }

            this.startBookmarkDrag(this.pendingBookmarkDrag, event);
            return;
        }

        const deltaX = event.clientX - this.pendingTabDrag.startClientX;
        const deltaY = event.clientY - this.pendingTabDrag.startClientY;
        if (Math.hypot(deltaX, deltaY) < TAB_DRAG_THRESHOLD_PX) {
            return;
        }

        this.startTabDrag(this.pendingTabDrag.tabId, event);
    }

    handleGlobalPointerUp(event) {
        if (this.tabDragState && event.pointerId === this.tabDragState.pointerId) {
            this.finishTabDrag();
            return;
        }

        if (this.bookmarkDragState && event.pointerId === this.bookmarkDragState.pointerId) {
            this.finishBookmarkDrag();
            return;
        }

        if (this.pendingTabDrag && event.pointerId === this.pendingTabDrag.pointerId) {
            const pendingButton = this.tabsRoot?.querySelector(`[data-tab-id="${this.pendingTabDrag.tabId}"]`);
            if (this.isHtmlElement(pendingButton) && typeof pendingButton.releasePointerCapture === 'function' &&
                pendingButton.hasPointerCapture?.(event.pointerId)) {
                pendingButton.releasePointerCapture(event.pointerId);
            }
            this.pendingTabDrag = null;
            return;
        }

        if (this.pendingBookmarkDrag && event.pointerId === this.pendingBookmarkDrag.pointerId) {
            const pendingSourceElement = this.pendingBookmarkDrag.sourceElement;
            if (this.isHtmlElement(pendingSourceElement) &&
                typeof pendingSourceElement.releasePointerCapture === 'function' &&
                pendingSourceElement.hasPointerCapture?.(event.pointerId)) {
                pendingSourceElement.releasePointerCapture(event.pointerId);
            }
            this.pendingBookmarkDrag = null;
        }
    }

    startTabDrag(tabId, event) {
        const layout = this.snapshotTabStripLayout();
        const bounds = layout?.tabs?.[tabId];
        const rootRect = this.tabsRoot?.getBoundingClientRect();
        const hostWindowRect = this.hostWindow?.getBoundingClientRect();
        if (!bounds || !rootRect) {
            this.pendingTabDrag = null;
            return;
        }

        this.pendingTabDrag = null;
        this.clearTabAnimationCleanupTimer();
        this.suppressNextTabClick = true;
        const sourceButton = this.tabsRoot.querySelector(`[data-tab-id="${tabId}"]`);
        const dragGhost = this.createDraggedTabGhost(sourceButton, bounds);
        this.tabDragState = {
            pointerId: event.pointerId,
            tabId,
            startClientX: event.clientX,
            startClientY: event.clientY,
            currentClientX: event.clientX,
            currentClientY: event.clientY,
            startLeft: bounds.left,
            currentLeft: bounds.left,
            width: bounds.width,
            height: bounds.height,
            ghost: dragGhost,
            tearoutPreview: null,
            overlayOffsetLeft: this.getTabDragOverlayOffset().left,
            overlayOffsetTop: this.getTabDragOverlayOffset().top,
            tabPointerOffsetX: rootRect ? event.clientX - (rootRect.left + bounds.left) : 0,
            tabPointerOffsetY: rootRect ? event.clientY - (rootRect.top + bounds.top) : 0,
            sourceWindowBounds: hostWindowRect ? {
                left: hostWindowRect.left,
                top: hostWindowRect.top,
                width: hostWindowRect.width,
                height: hostWindowRect.height
            } : null,
            windowPointerOffsetX: hostWindowRect ? event.clientX - hostWindowRect.left : 0,
            windowPointerOffsetY: hostWindowRect ? event.clientY - hostWindowRect.top : 0,
            isTearoutMode: false,
            currentExternalDropTargetApp: null,
            currentExternalDropTargetWindowId: null
        };

        const sourceTab = this.tabs.find((candidate) => candidate.id === tabId);
        if (sourceTab) {
            void this.captureTabTearoutPreview(sourceTab);
        }

        this.syncDraggedTabPlaceholder();
        this.applyDraggedTabVisual();
    }

    continueTabDrag(event) {
        if (!this.tabDragState || !this.tabsRoot) {
            return;
        }

        this.tabDragState.currentClientX = event.clientX;
        this.tabDragState.currentClientY = event.clientY;

        if (this.shouldTearOutDraggedTab()) {
            this.enterTabTearoutMode();
            const targetApp = this.findExternalTabDropTarget();
            if (targetApp) {
                if (this.tabDragState.currentExternalDropTargetApp &&
                    this.tabDragState.currentExternalDropTargetApp !== targetApp) {
                    this.clearCurrentExternalDropTarget();
                }
                if (this.tabDragState.currentExternalDropTargetApp !== targetApp) {
                    const topWindow = window.top || window.parent || window;
                    if (targetApp.windowId && typeof topWindow.focusClassicWindow === 'function') {
                        topWindow.focusClassicWindow(targetApp.windowId);
                    }
                }
                this.clearDetachedPreviewOnly();
                const tab = this.tabs.find((candidate) => candidate.id === this.tabDragState.tabId);
                const serializedTab = this.serializeTabState(tab);
                if (serializedTab) {
                    targetApp.showIncomingExternalTabDrag(serializedTab, {
                        clientX: this.tabDragState.currentClientX,
                        pointerOffsetX: this.tabDragState.tabPointerOffsetX
                    });
                    this.tabDragState.currentExternalDropTargetApp = targetApp;
                    this.tabDragState.currentExternalDropTargetWindowId = targetApp.windowId || null;
                }
            } else {
                this.clearCurrentExternalDropTarget();
                this.positionDetachedTabPreview();
            }
            return;
        }

        this.clearCurrentExternalDropTarget();
        this.exitTabTearoutMode();

        const rootRect = this.tabsRoot.getBoundingClientRect();
        const minLeft = -16;
        const maxLeft = Math.max(rootRect.width - this.tabDragState.width + 16, minLeft);
        const nextLeft = this.tabDragState.startLeft + (event.clientX - this.tabDragState.startClientX);
        this.tabDragState.currentLeft = Math.max(minLeft, Math.min(maxLeft, nextLeft));

        this.applyDraggedTabVisual();
        this.maybeReorderDraggedTab();
    }

    applyDraggedTabVisual() {
        if (!this.tabDragState || !this.tabsRoot) {
            return;
        }

        const ghost = this.tabDragState.ghost;
        if (!this.isHtmlElement(ghost)) {
            return;
        }

        ghost.style.left = `${this.tabDragState.currentLeft + this.tabDragState.overlayOffsetLeft}px`;
    }

    maybeReorderDraggedTab() {
        if (!this.tabDragState || !this.tabsRoot) {
            return;
        }

        const currentIndex = this.tabs.findIndex((tab) => tab.id === this.tabDragState.tabId);
        if (currentIndex === -1) {
            return;
        }

        const previousLayout = this.snapshotTabStripLayout();
        if (!previousLayout) {
            return;
        }

        const draggedCenter = this.tabDragState.currentLeft + (this.tabDragState.width / 2);
        let nextIndex = 0;

        this.tabs.forEach((tab) => {
            if (tab.id === this.tabDragState.tabId) {
                return;
            }

            const bounds = previousLayout.tabs[tab.id];
            if (!bounds) {
                return;
            }

            const threshold = bounds.left + ((bounds.width - CHROMIUM_TOP_CHROME.tabOverlap) / 2);
            if (draggedCenter > threshold) {
                nextIndex += 1;
            }
        });

        if (nextIndex === currentIndex) {
            return;
        }

        const [draggedTab] = this.tabs.splice(currentIndex, 1);
        this.tabs.splice(nextIndex, 0, draggedTab);

        this.renderTabs({
            previousLayout,
            draggedTabId: this.tabDragState.tabId
        });

        this.syncDraggedTabPlaceholder();
        this.applyDraggedTabVisual();
    }

    finishTabDrag() {
        if (!this.tabDragState || !this.tabsRoot) {
            this.pendingTabDrag = null;
            return;
        }

        if (this.tabDragState.isTearoutMode && this.shouldTearOutDraggedTab()) {
            const targetApp = this.tabDragState.currentExternalDropTargetApp || this.findExternalTabDropTarget();
            if (targetApp) {
                this.moveDraggedTabToAnotherWindow(targetApp);
            } else {
                this.detachDraggedTabToNewWindow();
            }
            return;
        }

        const button = this.tabsRoot.querySelector(`[data-tab-id="${this.tabDragState.tabId}"]`);
        const ghost = this.tabDragState.ghost;
        if (this.isHtmlElement(button) && this.isHtmlElement(ghost)) {
            const rootRect = this.tabsRoot.getBoundingClientRect();
            const buttonRect = button.getBoundingClientRect();
            const finalLeft = (buttonRect.left - rootRect.left) + this.tabDragState.overlayOffsetLeft;

            ghost.style.transition = `left ${CHROMIUM_MOTION.tabBoundsDurationMs}ms ${CHROMIUM_MOTION.easeOut}`;
            ghost.style.left = `${finalLeft}px`;

            if (typeof button.releasePointerCapture === 'function' && button.hasPointerCapture?.(this.tabDragState.pointerId)) {
                button.releasePointerCapture(this.tabDragState.pointerId);
            }

            window.setTimeout(() => {
                ghost.remove();
                button.classList.remove('is-drag-placeholder');
            }, CHROMIUM_MOTION.tabBoundsDurationMs + 20);
        }

        this.pendingTabDrag = null;
        this.tabDragState = null;
        window.setTimeout(() => {
            this.suppressNextTabClick = false;
        }, 0);
    }

    shouldTearOutDraggedTab() {
        if (!this.tabDragState || !this.tabsRoot) {
            return false;
        }

        const rootRect = this.tabsRoot.getBoundingClientRect();
        const { currentClientX, currentClientY, startClientY } = this.tabDragState;

        if (!Number.isFinite(currentClientX) || !Number.isFinite(currentClientY)) {
            return false;
        }

        const outsideHorizontally = currentClientX < rootRect.left - TAB_TEAROUT_MARGIN_X_PX ||
            currentClientX > rootRect.right + TAB_TEAROUT_MARGIN_X_PX;
        const outsideVertically = currentClientY < rootRect.top - TAB_TEAROUT_MARGIN_Y_PX ||
            currentClientY > rootRect.bottom + TAB_TEAROUT_MARGIN_Y_PX;

        return outsideHorizontally || (outsideVertically && Math.abs(currentClientY - startClientY) > TAB_DRAG_THRESHOLD_PX);
    }

    enterTabTearoutMode() {
        if (!this.tabDragState || this.tabDragState.isTearoutMode) {
            return;
        }

        this.tabDragState.isTearoutMode = true;
        const ghost = this.tabDragState.ghost;
        if (this.isHtmlElement(ghost)) {
            ghost.hidden = true;
        }

        const button = this.tabsRoot?.querySelector(`[data-tab-id="${this.tabDragState.tabId}"]`);
        if (this.isHtmlElement(button)) {
            button.classList.add('is-drag-detached-placeholder');
        }

        this.ensureDetachedTabPreview();
    }

    exitTabTearoutMode() {
        if (!this.tabDragState || !this.tabDragState.isTearoutMode) {
            return;
        }

        this.tabDragState.isTearoutMode = false;
        this.clearDetachedPreviewOnly();

        const ghost = this.tabDragState.ghost;
        if (this.isHtmlElement(ghost)) {
            ghost.hidden = false;
        }

        const button = this.tabsRoot?.querySelector(`[data-tab-id="${this.tabDragState.tabId}"]`);
        if (this.isHtmlElement(button)) {
            button.classList.remove('is-drag-detached-placeholder');
        }
    }

    clearDetachedPreviewOnly() {
        if (!this.tabDragState) {
            return;
        }

        const preview = this.tabDragState.tearoutPreview;
        if (this.isHtmlElement(preview)) {
            preview.remove();
        }
        this.tabDragState.tearoutPreview = null;
    }

    ensureDetachedTabPreview() {
        if (!this.tabDragState || this.tabDragState.tearoutPreview) {
            return;
        }

        const previewDocument = window.top?.document || document;
        const sourceTab = this.tabs.find((tab) => tab.id === this.tabDragState.tabId);
        const sourceButton = this.tabsRoot?.querySelector(`[data-tab-id="${this.tabDragState.tabId}"]`);
        if (!sourceTab || !this.isHtmlElement(sourceButton)) {
            return;
        }

        const wrapper = previewDocument.createElement('div');
        wrapper.className = 'chrome-tab-tearout-preview';

        const tabGhost = sourceButton.cloneNode(true);
        if (this.isHtmlElement(tabGhost)) {
            tabGhost.classList.add('is-dragging', 'is-drag-tearout-preview');
            tabGhost.classList.remove('is-hover-glow', 'is-drag-placeholder', 'is-drag-detached-placeholder');
            if (!tabGhost.classList.contains('is-active')) {
                tabGhost.classList.add('is-drag-visual-active');
            }
            tabGhost.hidden = false;
            tabGhost.style.position = 'absolute';
            tabGhost.style.top = '0';
            tabGhost.style.left = '0';
            tabGhost.style.width = `${this.tabDragState.width}px`;
            tabGhost.style.minWidth = `${this.tabDragState.width}px`;
            tabGhost.style.maxWidth = `${this.tabDragState.width}px`;
            tabGhost.style.flexBasis = `${this.tabDragState.width}px`;
            tabGhost.style.height = `${this.tabDragState.height}px`;
            wrapper.appendChild(tabGhost);
        }

        const previewWidth = Math.max(240, Math.min(360, Math.round((this.tabDragState.sourceWindowBounds?.width || 980) * 0.36)));
        const previewHeight = Math.max(150, Math.min(240, Math.round((this.tabDragState.sourceWindowBounds?.height || 700) * 0.24)));
        const screenshotUrl = typeof sourceTab.tearoutPreviewDataUrl === 'string'
            ? sourceTab.tearoutPreviewDataUrl
            : '';
        const localPreviewMarkup = !screenshotUrl && typeof sourceTab.localPreviewMarkup === 'string'
            ? sourceTab.localPreviewMarkup
            : '';
        const localPreviewWidth = Math.max(
            previewWidth,
            Number.isFinite(sourceTab.localPreviewWidth) ? sourceTab.localPreviewWidth : (this.pageHost?.clientWidth || 980)
        );
        const localPreviewScale = Math.min(1, previewWidth / localPreviewWidth);
        const previewMarkup = `
            <div class="chrome-tab-tearout-card" style="width:${previewWidth}px; height:${previewHeight}px;">
                <div class="chrome-tab-tearout-card-page${screenshotUrl ? ' has-screenshot' : ''}${localPreviewMarkup ? ' has-dom-preview' : ''}">
                    ${screenshotUrl
                        ? `<img class="chrome-tab-tearout-card-screenshot" src="${this.escapeHtml(screenshotUrl)}" alt="">`
                        : localPreviewMarkup
                            ? `<div class="chrome-tab-tearout-card-local-preview-shell"><div class="chrome-tab-tearout-card-local-preview chrome-page-host" style="width:${localPreviewWidth}px; transform:scale(${localPreviewScale});">${localPreviewMarkup}</div></div>`
                            : `<div class="chrome-tab-tearout-card-url">${this.escapeHtml(sourceTab.address)}</div>`}
                </div>
            </div>
        `;
        wrapper.insertAdjacentHTML('beforeend', previewMarkup);
        previewDocument.body.appendChild(wrapper);
        this.tabDragState.tearoutPreview = wrapper;
    }

    async captureTabTearoutPreview(tab) {
        if (!tab || !tab.webview || !tab.webviewReady || typeof tab.webview.capturePage !== 'function') {
            return;
        }

        try {
            const image = await tab.webview.capturePage();
            const dataUrl = typeof image?.toDataURL === 'function' ? image.toDataURL() : '';
            if (!dataUrl) {
                return;
            }

            tab.tearoutPreviewDataUrl = dataUrl;
            if (this.tabDragState?.tabId === tab.id && this.tabDragState.tearoutPreview) {
                const previewPage = this.tabDragState.tearoutPreview.querySelector('.chrome-tab-tearout-card-page');
                if (!this.isHtmlElement(previewPage) || previewPage.querySelector('.chrome-tab-tearout-card-screenshot')) {
                    return;
                }

                previewPage.classList.add('has-screenshot');
                previewPage.innerHTML = `<img class="chrome-tab-tearout-card-screenshot" src="${this.escapeHtml(dataUrl)}" alt="">`;
            }
        } catch {
            // Capture can fail for tabs that are mid-navigation or not currently capturable.
        }
    }

    positionDetachedTabPreview() {
        if (!this.tabDragState?.isTearoutMode) {
            return;
        }

        const preview = this.tabDragState.tearoutPreview;
        if (!this.isHtmlElement(preview)) {
            return;
        }

        const left = Math.round(this.tabDragState.currentClientX - this.tabDragState.tabPointerOffsetX);
        const top = Math.round(this.tabDragState.currentClientY - this.tabDragState.tabPointerOffsetY);
        preview.style.left = `${left}px`;
        preview.style.top = `${top}px`;
    }

    getDetachedWindowInitialBounds() {
        if (!this.tabDragState) {
            return null;
        }

        const sourceBounds = this.tabDragState.sourceWindowBounds;
        const width = Math.max(320, Math.round(sourceBounds?.width || 980));
        const height = Math.max(260, Math.round(sourceBounds?.height || 700));
        return {
            left: Math.round(this.tabDragState.currentClientX - this.tabDragState.windowPointerOffsetX),
            top: Math.round(this.tabDragState.currentClientY - this.tabDragState.windowPointerOffsetY),
            width,
            height
        };
    }

    cleanupTabDragState() {
        if (!this.tabDragState) {
            this.pendingTabDrag = null;
            return;
        }

        const pointerId = this.tabDragState.pointerId;
        const button = this.tabsRoot?.querySelector(`[data-tab-id="${this.tabDragState.tabId}"]`);
        if (this.isHtmlElement(button)) {
            if (typeof button.releasePointerCapture === 'function' && button.hasPointerCapture?.(pointerId)) {
                button.releasePointerCapture(pointerId);
            }
            button.classList.remove('is-drag-placeholder', 'is-drag-detached-placeholder');
        }

        const ghost = this.tabDragState.ghost;
        if (this.isHtmlElement(ghost)) {
            ghost.remove();
        }

        this.clearDetachedPreviewOnly();
        this.clearCurrentExternalDropTarget();

        this.pendingTabDrag = null;
        this.tabDragState = null;
        window.setTimeout(() => {
            this.suppressNextTabClick = false;
        }, 0);
    }

    clearCurrentExternalDropTarget() {
        if (!this.tabDragState) {
            return;
        }

        const targetApp = this.tabDragState.currentExternalDropTargetApp ||
            (() => {
                if (!this.tabDragState?.currentExternalDropTargetWindowId) {
                    return null;
                }

                const topDocument = window.top?.document;
                const targetContainer = topDocument?.querySelector?.(`.classic-app-container[data-window-id="${this.tabDragState.currentExternalDropTargetWindowId}"]`);
                return targetContainer?.__chromeClassicAppInstance ||
                    targetContainer?.querySelector?.('.direct-loaded-content[data-app-id="chrome-beta"]')?.__chromeClassicAppInstance ||
                    null;
            })();
        targetApp?.clearIncomingExternalTabDrag();
        this.tabDragState.currentExternalDropTargetApp = null;
        this.tabDragState.currentExternalDropTargetWindowId = null;
    }

    findExternalTabDropTarget() {
        if (!this.tabDragState) {
            return null;
        }

        const topDocument = window.top?.document;
        if (!topDocument || typeof topDocument.elementFromPoint !== 'function') {
            return null;
        }

        const candidates = Array.from(
            topDocument.querySelectorAll('.classic-app-container[data-app-id="chrome-beta"]')
        )
            .filter((container) => container !== this.hostWindow)
            .map((container, index) => {
                const targetApp = container.__chromeClassicAppInstance ||
                    container.querySelector('.direct-loaded-content[data-app-id="chrome-beta"]')?.__chromeClassicAppInstance ||
                    null;
                if (!targetApp || targetApp === this || !targetApp.tabsRoot) {
                    return null;
                }

                const stripRect = targetApp.tabsRoot.parentElement?.getBoundingClientRect?.() ||
                    targetApp.tabsRoot.getBoundingClientRect();
                const withinHorizontalBand =
                    this.tabDragState.currentClientX >= stripRect.left - TAB_TEAROUT_MARGIN_X_PX &&
                    this.tabDragState.currentClientX <= stripRect.right + TAB_TEAROUT_MARGIN_X_PX;
                const withinVerticalBand =
                    this.tabDragState.currentClientY >= stripRect.top - TAB_TEAROUT_MARGIN_Y_PX &&
                    this.tabDragState.currentClientY <= stripRect.bottom + TAB_TEAROUT_MARGIN_Y_PX;
                if (!withinHorizontalBand || !withinVerticalBand) {
                    return null;
                }

                const zIndex = Number.parseInt(window.getComputedStyle(container).zIndex, 10);
                return {
                    container,
                    targetApp,
                    zIndex: Number.isFinite(zIndex) ? zIndex : 0,
                    domOrder: index
                };
            })
            .filter(Boolean)
            .sort((left, right) => {
                if (left.zIndex !== right.zIndex) {
                    return left.zIndex - right.zIndex;
                }
                return left.domOrder - right.domOrder;
            });

        return candidates.length ? candidates[candidates.length - 1].targetApp : null;
    }

    getDropInsertionIndexForClientX(clientX, excludeTabId = null) {
        if (!this.tabsRoot) {
            return this.tabs.length;
        }

        const layout = this.snapshotTabStripLayout();
        if (!layout) {
            return this.tabs.length;
        }

        const rootRect = this.tabsRoot.getBoundingClientRect();

        let nextIndex = 0;
        this.tabs.forEach((tab) => {
            if (excludeTabId && tab.id === excludeTabId) {
                return;
            }
            const bounds = layout.tabs[tab.id];
            if (!bounds) {
                return;
            }

            const threshold = rootRect.left + bounds.left + ((bounds.width - CHROMIUM_TOP_CHROME.tabOverlap) / 2);
            if (clientX > threshold) {
                nextIndex += 1;
            }
        });

        return nextIndex;
    }

    showIncomingExternalTabDrag(serializedTab, options = {}) {
        if (!serializedTab) {
            return;
        }

        this.hostWindow?.classList.add('is-external-tab-drop-target');
        const previousLayout = this.snapshotTabStripLayout();
        let tempTab = this.incomingExternalTabDrag?.tab || null;
        if (!tempTab) {
            tempTab = this.createRestoredTabState(serializedTab);
            if (!tempTab) {
                return;
            }
            tempTab.isExternalPreview = true;
        }

        this.tabs = this.tabs.filter((tab) => tab.id !== tempTab.id);
        const insertIndex = Math.max(0, Math.min(
            this.getDropInsertionIndexForClientX(options.clientX, tempTab.id),
            this.tabs.length
        ));
        this.tabs.splice(insertIndex, 0, tempTab);

        this.incomingExternalTabDrag = {
            tab: tempTab,
            pointerOffsetX: Number.isFinite(options.pointerOffsetX) ? options.pointerOffsetX : Math.round((this.getTabRenderWidth() || CHROMIUM_TOP_CHROME.standardTabWidth) / 2),
            clientX: options.clientX,
            ghost: this.incomingExternalTabDrag?.ghost || null
        };

        this.renderTabs({ previousLayout, draggedTabId: tempTab.id });
        this.syncIncomingExternalTabDragGhost();
    }

    syncIncomingExternalTabDragGhost() {
        if (!this.incomingExternalTabDrag || !this.tabsRoot) {
            return;
        }

        const button = this.tabsRoot.querySelector(`[data-tab-id="${this.incomingExternalTabDrag.tab.id}"]`);
        const layout = this.snapshotTabStripLayout();
        const bounds = layout?.tabs?.[this.incomingExternalTabDrag.tab.id];
        if (!this.isHtmlElement(button) || !bounds) {
            return;
        }

        button.classList.add('is-drag-placeholder');
        let ghost = this.incomingExternalTabDrag.ghost;
        if (!this.isHtmlElement(ghost)) {
            ghost = this.createDraggedTabGhost(button, bounds);
            this.incomingExternalTabDrag.ghost = ghost;
        }

        if (!this.isHtmlElement(ghost)) {
            return;
        }

        const rootRect = this.tabsRoot.getBoundingClientRect();
        const minLeft = -16;
        const maxLeft = Math.max(rootRect.width - bounds.width + 16, minLeft);
        const currentLeft = Math.max(
            minLeft,
            Math.min(
                maxLeft,
                (this.incomingExternalTabDrag.clientX - rootRect.left) - this.incomingExternalTabDrag.pointerOffsetX
            )
        );
        ghost.style.left = `${currentLeft + this.getTabDragOverlayOffset().left}px`;
    }

    clearIncomingExternalTabDrag() {
        if (!this.incomingExternalTabDrag) {
            this.hostWindow?.classList.remove('is-external-tab-drop-target');
            return;
        }

        const previousLayout = this.snapshotTabStripLayout();
        const tempTabId = this.incomingExternalTabDrag.tab?.id;
        const ghost = this.incomingExternalTabDrag.ghost;
        if (this.isHtmlElement(ghost)) {
            ghost.remove();
        }

        this.tabs = this.tabs.filter((tab) => tab.id !== tempTabId);
        this.incomingExternalTabDrag = null;
        this.hostWindow?.classList.remove('is-external-tab-drop-target');
        this.renderTabs({ previousLayout });
    }

    commitIncomingExternalTabDrag() {
        if (!this.incomingExternalTabDrag) {
            return false;
        }

        const tempTab = this.incomingExternalTabDrag.tab;
        const ghost = this.incomingExternalTabDrag.ghost;
        if (this.isHtmlElement(ghost)) {
            ghost.remove();
        }

        delete tempTab.isExternalPreview;
        this.incomingExternalTabDrag = null;
        this.hostWindow?.classList.remove('is-external-tab-drop-target');
        const previousLayout = this.snapshotTabStripLayout();
        this.activeTabId = tempTab.id;
        this.renderTabs({ previousLayout });
        this.activateTab(tempTab.id, { skipRender: true });
        this.savePersistentState();
        return true;
    }

    receiveExternalTabDrop(serializedTab, options = {}) {
        if (!serializedTab) {
            return false;
        }

        const restoredTab = this.createRestoredTabState(serializedTab);
        const previousLayout = this.snapshotTabStripLayout();
        const insertIndex = Math.max(
            0,
            Math.min(this.getDropInsertionIndexForClientX(options.clientX), this.tabs.length)
        );

        this.tabs.splice(insertIndex, 0, restoredTab);
        this.activeTabId = restoredTab.id;
        this.renderTabs({ previousLayout });
        this.activateTab(restoredTab.id, { skipRender: true });
        this.savePersistentState();
        return true;
    }

    moveDraggedTabToAnotherWindow(targetApp) {
        if (!this.tabDragState) {
            return false;
        }

        const tab = this.tabs.find((candidate) => candidate.id === this.tabDragState.tabId);
        const serializedTab = this.serializeTabState(tab);
        if (!serializedTab) {
            return false;
        }

        const tabId = this.tabDragState.tabId;
        const clientX = this.tabDragState.currentClientX;
        this.cleanupTabDragState();

        if (!(targetApp.commitIncomingExternalTabDrag?.() || targetApp.receiveExternalTabDrop(serializedTab, { clientX }))) {
            return false;
        }

        this.closeTab(tabId, { animate: false, recordRecentlyClosed: false });
        return true;
    }

    detachDraggedTabToNewWindow() {
        if (!this.tabDragState) {
            return;
        }

        const tab = this.tabs.find((candidate) => candidate.id === this.tabDragState.tabId);
        const initialBounds = this.getDetachedWindowInitialBounds();
        this.cleanupTabDragState();

        if (!tab) {
            return;
        }

        this.tearOutTab(tab.id, { initialBounds });
    }

    tearOutTab(tabId, options = {}) {
        const tab = this.tabs.find((candidate) => candidate.id === tabId);
        const serializedTab = this.serializeTabState(tab);
        if (!serializedTab) {
            return false;
        }

        if (!this.openNewWindowWithTabs([serializedTab], {
            activeIndex: 0,
            initialBounds: options.initialBounds
        })) {
            this.showStatus('Tab tearout is not available in this host.', true);
            return false;
        }

        this.closeTab(tabId, { recordRecentlyClosed: false });
        return true;
    }

    createDraggedTabGhost(sourceButton, bounds) {
        const overlayHost = this.tabsRoot?.parentElement;
        if (!this.isHtmlElement(sourceButton) || !this.tabsRoot || !this.isHtmlElement(overlayHost)) {
            return null;
        }

        const ghost = sourceButton.cloneNode(true);
        if (!this.isHtmlElement(ghost)) {
            return null;
        }

        const offsets = this.getTabDragOverlayOffset();
        ghost.classList.add('is-dragging');
        ghost.classList.remove('is-hover-glow', 'is-drag-placeholder');
        if (!sourceButton.classList.contains('is-active')) {
            ghost.classList.add('is-drag-visual-active');
        }
        ghost.style.position = 'absolute';
        ghost.style.top = `${offsets.top + bounds.top}px`;
        ghost.style.left = `${offsets.left + bounds.left}px`;
        ghost.style.width = `${bounds.width}px`;
        ghost.style.minWidth = `${bounds.width}px`;
        ghost.style.maxWidth = `${bounds.width}px`;
        ghost.style.flexBasis = `${bounds.width}px`;
        ghost.style.height = `${bounds.height}px`;
        ghost.style.pointerEvents = 'none';
        ghost.style.transition = 'none';
        ghost.removeAttribute('aria-selected');
        overlayHost.appendChild(ghost);
        return ghost;
    }

    getTabDragOverlayOffset() {
        const overlayHost = this.tabsRoot?.parentElement;
        if (!this.tabsRoot || !this.isHtmlElement(overlayHost)) {
            return { left: 0, top: 0 };
        }

        const rootRect = this.tabsRoot.getBoundingClientRect();
        const overlayRect = overlayHost.getBoundingClientRect();
        return {
            left: rootRect.left - overlayRect.left,
            top: rootRect.top - overlayRect.top
        };
    }

    syncDraggedTabPlaceholder() {
        if (!this.tabDragState || !this.tabsRoot) {
            return;
        }

        this.tabsRoot.querySelectorAll('.is-drag-placeholder, .is-drag-detached-placeholder').forEach((button) => {
            button.classList.remove('is-drag-placeholder', 'is-drag-detached-placeholder');
        });

        const button = this.tabsRoot.querySelector(`[data-tab-id="${this.tabDragState.tabId}"]`);
        if (this.isHtmlElement(button)) {
            button.classList.add(this.tabDragState.isTearoutMode ? 'is-drag-detached-placeholder' : 'is-drag-placeholder');
            button.style.transform = '';
        }
    }

    snapshotBookmarkLayout() {
        const inner = this.bookmarkBar?.querySelector('.chrome-bookmarks-inner');
        if (!inner) {
            return null;
        }

        const rootRect = inner.getBoundingClientRect();
        const buttons = {};

        inner.querySelectorAll('[data-bookmark-id]:not([hidden])').forEach((button) => {
            const rect = button.getBoundingClientRect();
            buttons[button.dataset.bookmarkId] = {
                left: rect.left - rootRect.left,
                top: rect.top - rootRect.top,
                width: rect.width,
                height: rect.height
            };
        });

        return { buttons };
    }

    animateBookmarkLayout(previousLayout, draggedBookmarkId = null) {
        const inner = this.bookmarkBar?.querySelector('.chrome-bookmarks-inner');
        const currentLayout = this.snapshotBookmarkLayout();
        if (!previousLayout || !currentLayout || !inner) {
            return;
        }

        inner.querySelectorAll('[data-bookmark-id]:not([hidden])').forEach((button) => {
            const bookmarkId = button.dataset.bookmarkId;
            if (bookmarkId === draggedBookmarkId) {
                return;
            }

            const previousBounds = previousLayout.buttons[bookmarkId];
            const currentBounds = currentLayout.buttons[bookmarkId];
            if (!previousBounds || !currentBounds) {
                return;
            }

            this.applyBoundsAnimation(button, previousBounds, currentBounds);
        });
    }

    startBookmarkDrag(pendingDrag, event) {
        if (!pendingDrag?.sourceElement || !this.isHtmlElement(pendingDrag.sourceElement)) {
            this.pendingBookmarkDrag = null;
            return;
        }

        const sourceRect = pendingDrag.sourceElement.getBoundingClientRect();
        const hostRect = this.hostContent?.getBoundingClientRect();
        if (!hostRect) {
            this.pendingBookmarkDrag = null;
            return;
        }

        this.pendingBookmarkDrag = null;
        if (pendingDrag.sourceKind === 'bar') {
            this.closeBookmarkPopup();
        }
        this.suppressNextBookmarkClick = true;

        const state = {
            pointerId: event.pointerId,
            dragKind: pendingDrag.dragKind,
            sourceKind: pendingDrag.sourceKind,
            bookmarkId: pendingDrag.bookmarkId || null,
            sourceElement: pendingDrag.sourceElement,
            address: pendingDrag.address || null,
            label: pendingDrag.label || null,
            faviconUrl: pendingDrag.faviconUrl || null,
            startClientX: event.clientX,
            startClientY: event.clientY,
            sourceOffsetX: event.clientX - sourceRect.left,
            sourceOffsetY: event.clientY - sourceRect.top,
            width: sourceRect.width,
            height: sourceRect.height,
            dropTarget: null,
            rootIndex: null,
            mode: 'ghost',
            ghost: this.createBookmarkDragGhost({
                ...pendingDrag,
                dragKind: pendingDrag.dragKind,
                bookmarkId: pendingDrag.bookmarkId || null,
                address: pendingDrag.address || null,
                label: pendingDrag.label || null,
                faviconUrl: pendingDrag.faviconUrl || null
            }, sourceRect, hostRect)
        };
        pendingDrag.sourceElement.classList.add('is-drag-placeholder');

        this.bookmarkDragState = state;
        this.updateBookmarkDropTarget(event);
        this.applyDraggedBookmarkVisual();
    }

    continueBookmarkDrag(event) {
        if (!this.bookmarkDragState) {
            return;
        }

        this.bookmarkDragState.currentClientX = event.clientX;
        this.bookmarkDragState.currentClientY = event.clientY;

        this.updateBookmarkDropTarget(event);
        this.applyDraggedBookmarkVisual();
    }

    applyDraggedBookmarkVisual() {
        if (!this.bookmarkDragState) {
            return;
        }

        const ghost = this.bookmarkDragState.ghost;
        if (!this.isHtmlElement(ghost) || !this.hostContent) {
            return;
        }

        const hostRect = this.hostContent.getBoundingClientRect();
        const left = (this.bookmarkDragState.currentClientX ?? this.bookmarkDragState.startClientX) - hostRect.left - this.bookmarkDragState.sourceOffsetX;
        const top = (this.bookmarkDragState.currentClientY ?? this.bookmarkDragState.startClientY) - hostRect.top - this.bookmarkDragState.sourceOffsetY;
        ghost.style.left = `${left}px`;
        ghost.style.top = `${top}px`;
    }

    maybeReorderDraggedBookmark() {
        if (!this.bookmarkDragState) {
            return;
        }

        const currentIndex = this.bookmarks.findIndex((bookmark) => bookmark.id === this.bookmarkDragState.bookmarkId);
        if (currentIndex === -1) {
            return;
        }

        const previousLayout = this.snapshotBookmarkLayout();
        if (!previousLayout) {
            return;
        }

        const draggedCenter = this.bookmarkDragState.currentLeft + (this.bookmarkDragState.width / 2);
        let nextIndex = 0;

        this.bookmarks.forEach((bookmark) => {
            if (bookmark.id === this.bookmarkDragState.bookmarkId) {
                return;
            }

            const bounds = previousLayout.buttons[bookmark.id];
            if (!bounds) {
                return;
            }

            if (draggedCenter > bounds.left + (bounds.width / 2)) {
                nextIndex += 1;
            }
        });

        if (nextIndex === currentIndex) {
            return;
        }

        const [draggedBookmark] = this.bookmarks.splice(currentIndex, 1);
        this.bookmarks.splice(nextIndex, 0, draggedBookmark);
        this.renderBookmarks();
        this.applyDraggedBookmarkVisual();
    }

    finishBookmarkDrag() {
        if (!this.bookmarkDragState) {
            this.pendingBookmarkDrag = null;
            return;
        }

        const dragState = this.bookmarkDragState;
        const sourceElement = dragState.sourceElement;
        let shouldRenderBookmarks = false;

        this.clearBookmarkDropTargetVisuals();
        this.cancelBookmarkDropHoverTimer();

        if (dragState.dragKind === 'bookmark') {
            if (dragState.dropTarget?.type === 'folder' && dragState.bookmarkId) {
                shouldRenderBookmarks = this.moveBookmarkNode(dragState.bookmarkId, dragState.dropTarget.folderId);
            } else if (dragState.mode === 'ghost' && dragState.rootIndex !== null && dragState.bookmarkId) {
                shouldRenderBookmarks = this.moveBookmarkNode(dragState.bookmarkId, 'bookmark-bar-root', dragState.rootIndex);
            }
        } else if (dragState.dragKind === 'location' && dragState.dropTarget) {
            const bookmark = this.createBookmarkNode({
                type: 'url',
                label: dragState.label || dragState.address,
                address: dragState.address,
                faviconUrl: dragState.faviconUrl
            });

            this.insertBookmarkNode(
                bookmark,
                dragState.dropTarget.type === 'folder' ? dragState.dropTarget.folderId : 'bookmark-bar-root',
                dragState.dropTarget.type === 'root' ? dragState.rootIndex : null
            );
            shouldRenderBookmarks = true;
        }

        if (shouldRenderBookmarks) {
            this.renderBookmarks();
            this.savePersistentState();
        }

        if (dragState.mode === 'ghost' && this.isHtmlElement(dragState.ghost)) {
            dragState.ghost.remove();
        }

        if (this.isHtmlElement(sourceElement)) {
            sourceElement.classList.remove('is-drag-placeholder');
            if (typeof sourceElement.releasePointerCapture === 'function' && sourceElement.hasPointerCapture?.(dragState.pointerId)) {
                sourceElement.releasePointerCapture(dragState.pointerId);
            }
        }

        this.pendingBookmarkDrag = null;
        this.bookmarkDragState = null;
        window.setTimeout(() => {
            this.suppressNextBookmarkClick = false;
        }, 0);
    }

    createBookmarkDragGhost(dragState, sourceRect, hostRect) {
        const dragLayer = this.hostedDragLayer || this.hostContent;
        if (!dragLayer || !this.hostContent) {
            return null;
        }

        const ghost = this.hostContent.ownerDocument.createElement('div');
        ghost.className = 'chrome-bookmark chrome-bookmark--url chrome-bookmark-drag-ghost is-dragging';
        ghost.style.position = 'absolute';
        ghost.style.left = `${sourceRect.left - hostRect.left}px`;
        ghost.style.top = `${sourceRect.top - hostRect.top}px`;
        ghost.style.width = `${sourceRect.width}px`;
        ghost.style.height = `${sourceRect.height}px`;
        ghost.style.pointerEvents = 'none';

        let label = dragState.label || '';
        let iconStyle = '';
        if (dragState.dragKind === 'bookmark' && dragState.bookmarkId) {
            const bookmark = this.findBookmarkById(dragState.bookmarkId);
            if (bookmark) {
                label = bookmark.label;
                iconStyle = this.getBookmarkIconStyle(bookmark);
                if (bookmark.type === 'folder') {
                    ghost.classList.add('chrome-bookmark--folder');
                } else if (bookmark.type === 'apps') {
                    ghost.classList.add('chrome-bookmark--apps');
                }
            }
        } else if (dragState.dragKind === 'location' && dragState.faviconUrl) {
            iconStyle = `style="background-image:url('${this.escapeHtml(dragState.faviconUrl)}'); background-size: 16px 16px;"`;
        }

        ghost.innerHTML = `
            <span class="chrome-bookmark-icon" aria-hidden="true" ${iconStyle}></span>
            <span class="chrome-bookmark-label">${this.escapeHtml(label)}</span>
        `;
        dragLayer.appendChild(ghost);
        return ghost;
    }

    updateBookmarkDropTarget(event) {
        if (!this.bookmarkDragState) {
            return;
        }

        this.clearBookmarkDropTargetVisuals();

        const pointerTarget = this.pointerDocument?.elementFromPoint(event.clientX, event.clientY);
        const target = this.getElementTarget(pointerTarget);
        const folderElement = target?.closest?.('[data-bookmark-id][data-bookmark-type="folder"], [data-popup-bookmark-id][data-popup-bookmark-type="folder"]');
        const folderId = this.getBookmarkFolderIdFromDropElement(folderElement);

        if (folderId && this.canDropBookmarkIntoFolder(this.bookmarkDragState, folderId)) {
            this.bookmarkDragState.dropTarget = {
                type: 'folder',
                folderId,
                element: folderElement
            };
            this.bookmarkDragState.rootIndex = null;
            folderElement.classList.add('is-drop-target');
            this.queueBookmarkDropFolderHover(folderElement, folderId);
            return;
        }

        this.cancelBookmarkDropHoverTimer();

        if (this.isPointWithinBookmarkBar(event.clientX, event.clientY)) {
            const inner = this.bookmarkBar?.querySelector('.chrome-bookmarks-inner');
            this.bookmarkDragState.rootIndex = this.getBookmarkRootInsertIndex(event.clientX, this.bookmarkDragState.bookmarkId);
            this.bookmarkDragState.dropTarget = {
                type: 'root'
            };
            inner?.classList.add('is-drop-target');
            return;
        }

        this.bookmarkDragState.rootIndex = null;
        this.bookmarkDragState.dropTarget = null;
    }

    clearBookmarkDropTargetVisuals() {
        this.bookmarkBar?.querySelector('.chrome-bookmarks-inner')?.classList.remove('is-drop-target');
        this.bookmarkBar?.querySelectorAll('.is-drop-target').forEach((element) => {
            element.classList.remove('is-drop-target');
        });
        this.hostedBookmarkPopup?.querySelectorAll('.is-drop-target').forEach((element) => {
            element.classList.remove('is-drop-target');
        });
    }

    isPointWithinBookmarkBar(clientX, clientY) {
        if (!this.bookmarkBar || this.bookmarkBar.hidden) {
            return false;
        }

        const rect = this.bookmarkBar.getBoundingClientRect();
        return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
    }

    getBookmarkRootInsertIndex(clientX, draggedBookmarkId = null) {
        const inner = this.bookmarkBar?.querySelector('.chrome-bookmarks-inner');
        if (!inner) {
            return 0;
        }

        const buttons = Array.from(inner.querySelectorAll('[data-bookmark-id]:not([hidden])'))
            .filter((button) => button.dataset.bookmarkId !== draggedBookmarkId);
        let nextIndex = 0;

        buttons.forEach((button) => {
            const rect = button.getBoundingClientRect();
            if (clientX > rect.left + (rect.width / 2)) {
                nextIndex += 1;
            }
        });

        return nextIndex;
    }

    getBookmarkFolderIdFromDropElement(element) {
        if (!this.isHtmlElement(element)) {
            return null;
        }

        return element.dataset.bookmarkId || element.dataset.popupBookmarkId || null;
    }

    canDropBookmarkIntoFolder(dragState, folderId) {
        if (!folderId || dragState.dragKind === 'location') {
            return true;
        }

        if (!dragState.bookmarkId || dragState.bookmarkId === folderId) {
            return false;
        }

        return !this.isBookmarkDescendantFolder(folderId, dragState.bookmarkId);
    }

    queueBookmarkDropFolderHover(folderElement, folderId) {
        if (!this.isHtmlElement(folderElement)) {
            return;
        }

        if (this.bookmarkPopupState?.anchorBookmarkId === folderId) {
            return;
        }

        this.cancelBookmarkDropHoverTimer();
        this.bookmarkDropHoverTimer = window.setTimeout(() => {
            const bookmark = this.findBookmarkById(folderId);
            if (!bookmark?.children?.length) {
                return;
            }

            if (folderElement.hasAttribute('data-popup-bookmark-id')) {
                this.showBookmarkPopup(bookmark.children, folderElement, {
                    anchorBookmarkId: bookmark.id,
                    sourceKind: 'popup-folder'
                });
                return;
            }

            this.showBookmarkPopup(bookmark.children, folderElement, {
                anchorBookmarkId: bookmark.id,
                sourceKind: 'bar-folder'
            });
        }, BOOKMARK_BAR_METRICS.menuShowDelayMs);
    }

    cancelBookmarkDropHoverTimer() {
        if (this.bookmarkDropHoverTimer) {
            clearTimeout(this.bookmarkDropHoverTimer);
            this.bookmarkDropHoverTimer = null;
        }
    }

    renderTabs(options = {}) {
        if (!this.tabsRoot) {
            return;
        }

        const activeTabId = this.activeTabId;
        const tabWidth = this.getTabRenderWidth();

        this.tabsRoot.style.setProperty('--chrome-tab-render-width', `${tabWidth}px`);

        this.tabsRoot.innerHTML = this.tabs.map((tab) => {
            const classes = ['chrome-tab'];
            const faviconClass = ['chrome-tab-favicon'];
            const title = this.escapeHtml(tab.title);
            const hideTabIcon = this.isNewTabAddress(tab.address) && !tab.loading;
            const faviconUrl = this.getTabFaviconUrl(tab);
            const faviconImage = faviconUrl ?
                `<img class="chrome-tab-favicon-image" src="${this.escapeHtml(faviconUrl)}" alt="">` :
                '';

            if (tab.id === activeTabId) {
                classes.push('is-active');
            }

            if (tab.loading) {
                classes.push('is-loading');
            }

            if (tab.networkState === 'waiting') {
                classes.push('is-waiting');
            }

            if (hideTabIcon) {
                classes.push('has-no-icon');
            }

            if (tabWidth <= CHROMIUM_TOP_CHROME.compactTabWidth) {
                classes.push('is-compact');
            }

            if (tabWidth <= CHROMIUM_TOP_CHROME.miniTabWidth) {
                classes.push('is-mini');
            }

            if (faviconUrl) {
                faviconClass.push('has-image');
            }

            return `
                <button class="${classes.join(' ')}" type="button" role="tab" aria-selected="${tab.id === activeTabId}" data-tab-id="${tab.id}" title="${title}">
                    <span class="chrome-tab-shape" aria-hidden="true">
                        <span class="chrome-tab-cap chrome-tab-cap--left"></span>
                        <span class="chrome-tab-fill"></span>
                        <span class="chrome-tab-cap chrome-tab-cap--right"></span>
                    </span>
                    <span class="chrome-tab-content">
                        <span class="${faviconClass.join(' ')}" aria-hidden="true">
                            ${faviconImage}
                            <span class="chrome-tab-throbber"></span>
                        </span>
                        <span class="chrome-tab-title">${title}</span>
                        <span class="chrome-tab-close" role="presentation" data-close-tab="${tab.id}">&#xd7;</span>
                    </span>
                </button>
            `;
        }).join('');

        this.tabsRoot.querySelectorAll('[data-tab-id]').forEach((button) => {
            button.addEventListener('click', (event) => {
                if (this.suppressNextTabClick) {
                    this.suppressNextTabClick = false;
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                }

                const closeTarget = event.target.closest('[data-close-tab]');
                if (closeTarget) {
                    this.closeTab(closeTarget.dataset.closeTab);
                    return;
                }

                this.activateTab(button.dataset.tabId);
            });

            button.addEventListener('auxclick', (event) => {
                if (event.button !== 1) {
                    return;
                }

                event.preventDefault();
                this.closeTab(button.dataset.tabId);
            });

            button.addEventListener('contextmenu', (event) => {
                event.preventDefault();
                event.stopPropagation();
                this.showTabContextMenu(button.dataset.tabId, event.clientX, event.clientY);
            });

            button.addEventListener('mouseenter', (event) => {
                button.classList.add('is-hover-glow');
                this.setTabHoverLocation(button, event);
            });

            button.addEventListener('mousemove', (event) => {
                this.setTabHoverLocation(button, event);
            });

            button.addEventListener('mouseleave', () => {
                button.classList.remove('is-hover-glow');
            });
        });

        if (this.tabDragState) {
            this.syncDraggedTabPlaceholder();
            if (options.draggedTabId && this.tabDragState.tabId === options.draggedTabId && !this.tabDragState.isTearoutMode) {
                this.applyDraggedTabVisual();
            }
        }

        if (options.previousLayout) {
            this.animateTabStripLayout(options.previousLayout, options);
        }
    }

    renderBookmarks() {
        this.closeBookmarkPopup();

        const bookmarkButtons = this.bookmarks.map((bookmark) => {
            const isFolder = bookmark.type === 'folder';
            const classes = ['chrome-bookmark'];
            const iconStyle = this.getBookmarkIconStyle(bookmark);

            if (isFolder) {
                classes.push('chrome-bookmark--folder');
            } else if (bookmark.type === 'apps') {
                classes.push('chrome-bookmark--apps');
            } else {
                classes.push('chrome-bookmark--url');
            }

            return `
                <button
                    class="${classes.join(' ')}"
                    type="button"
                    data-bookmark-id="${bookmark.id}"
                    data-bookmark-type="${bookmark.type}"
                    ${bookmark.address ? `data-address="${this.escapeHtml(bookmark.address)}"` : ''}
                    ${isFolder ? `aria-haspopup="menu"` : ''}
                >
                    <span class="chrome-bookmark-icon" aria-hidden="true" ${iconStyle}></span>
                    <span class="chrome-bookmark-label">${this.escapeHtml(bookmark.label)}</span>
                </button>
            `;
        }).join('');

        this.bookmarkBar.innerHTML = `
            <div class="chrome-bookmarks-inner">
                ${bookmarkButtons}
                <button class="chrome-bookmark chrome-bookmark--overflow" type="button" data-bookmark-overflow aria-label="More bookmarks" hidden>
                    <span class="chrome-bookmark-icon" aria-hidden="true"></span>
                </button>
            </div>
        `;

        this.layoutBookmarks();
        this.refreshBookmarkStar();
        window.requestAnimationFrame(() => this.layoutBookmarks());
    }

    layoutBookmarks() {
        if (!this.bookmarkBar || this.bookmarkBar.hidden) {
            return;
        }

        const inner = this.bookmarkBar.querySelector('.chrome-bookmarks-inner');
        const buttons = Array.from(this.bookmarkBar.querySelectorAll('[data-bookmark-id]'));
        const overflowButton = this.bookmarkBar.querySelector('[data-bookmark-overflow]');

        if (!inner || !buttons.length || !overflowButton) {
            return;
        }

        buttons.forEach((button) => {
            button.hidden = false;
        });
        overflowButton.hidden = false;

        const barWidth = Math.floor(this.bookmarkBar.getBoundingClientRect().width);
        if (barWidth <= 0) {
            return;
        }

        const baseWidth = Math.max(0, barWidth - BOOKMARK_BAR_METRICS.leftMargin - BOOKMARK_BAR_METRICS.rightMargin);
        const overflowWidth = overflowButton.offsetWidth || 24;
        const initialLayout = this.measureBookmarkVisibility(buttons, baseWidth);
        const finalLayout = initialLayout.hiddenIds.length
            ? this.measureBookmarkVisibility(buttons, Math.max(0, baseWidth - overflowWidth))
            : initialLayout;

        buttons.forEach((button) => {
            button.hidden = finalLayout.hiddenIds.includes(button.dataset.bookmarkId);
        });

        overflowButton.hidden = finalLayout.hiddenIds.length === 0;
        this.bookmarkLayout = finalLayout;

        inner.classList.toggle('has-overflow', !overflowButton.hidden);

        if (this.bookmarkPopupState?.sourceKind === 'overflow') {
            const overflowBookmarks = this.getOverflowBookmarks();
            if (overflowBookmarks.length) {
                this.showBookmarkPopup(overflowBookmarks, overflowButton, {
                    sourceKind: 'overflow'
                });
            } else {
                this.closeBookmarkPopup();
            }
        }
    }

    measureBookmarkVisibility(buttons, availableWidth) {
        let x = BOOKMARK_BAR_METRICS.leftMargin;
        const hiddenIds = [];

        buttons.forEach((button) => {
            const nextX = x + button.offsetWidth + BOOKMARK_BAR_METRICS.buttonPadding;
            const visible = nextX < availableWidth;

            if (visible) {
                x = nextX;
            } else {
                hiddenIds.push(button.dataset.bookmarkId);
            }
        });

        return { hiddenIds };
    }

    getOverflowBookmarks() {
        return this.bookmarkLayout.hiddenIds
            .map((bookmarkId) => this.findBookmarkById(bookmarkId))
            .filter(Boolean);
    }

    handleBookmarkBarActivation(button) {
        if (button.hasAttribute('data-bookmark-overflow')) {
            if (this.bookmarkPopupState?.sourceKind === 'overflow') {
                this.closeBookmarkPopup();
                return;
            }

            this.showBookmarkPopup(this.getOverflowBookmarks(), button, {
                sourceKind: 'overflow'
            });
            return;
        }

        const bookmark = this.findBookmarkById(button.dataset.bookmarkId);
        if (!bookmark) {
            return;
        }

        if (bookmark.type === 'folder') {
            if (this.bookmarkPopupState?.anchorBookmarkId === bookmark.id && this.bookmarkPopupState?.sourceKind === 'bar-folder') {
                this.closeBookmarkPopup();
                return;
            }

            this.showBookmarkPopup(bookmark.children || [], button, {
                anchorBookmarkId: bookmark.id,
                sourceKind: 'bar-folder'
            });
            return;
        }

        if (bookmark.address) {
            this.closeBookmarkPopup();
            this.navigateCurrentTab(bookmark.address);
        }
    }

    handleBookmarkBarAuxClick(button) {
        const bookmark = this.findBookmarkById(button.dataset.bookmarkId);
        if (!bookmark || bookmark.type === 'folder' || !bookmark.address) {
            return;
        }

        this.createTab(bookmark.address, { activate: false });
    }

    handleBookmarkBarHover(button) {
        if (button.hasAttribute('data-bookmark-overflow')) {
            const hiddenBookmarks = this.getOverflowBookmarks();
            if (hiddenBookmarks.length) {
                this.showHoverStatus(`${hiddenBookmarks.length} hidden bookmarks`);
            }

            if (this.bookmarkPopupState && this.bookmarkPopupState.sourceKind !== 'overflow') {
                this.queueBookmarkHover(button, null, 'overflow');
            }
            return;
        }

        const bookmark = this.findBookmarkById(button.dataset.bookmarkId);
        if (!bookmark) {
            return;
        }

        if (bookmark.type === 'folder') {
            this.hideHoverStatus();
            if (this.bookmarkPopupState && this.bookmarkPopupState.anchorBookmarkId !== bookmark.id) {
                this.queueBookmarkHover(button, bookmark, 'bar-folder');
            }
            return;
        }

        if (bookmark.address) {
            this.showHoverStatus(bookmark.address);
        }
    }

    handleBookmarkPopupActivation(item) {
        const bookmark = this.findBookmarkById(item.dataset.popupBookmarkId);
        if (!bookmark) {
            return;
        }

        if (bookmark.type === 'folder') {
            this.showBookmarkPopup(bookmark.children || [], item, {
                anchorBookmarkId: bookmark.id,
                sourceKind: 'popup-folder'
            });
            return;
        }

        if (bookmark.address) {
            this.closeBookmarkPopup();
            this.navigateCurrentTab(bookmark.address);
        }
    }

    handleBookmarkPopupAuxClick(item) {
        const bookmark = this.findBookmarkById(item.dataset.popupBookmarkId);
        if (!bookmark || bookmark.type === 'folder' || !bookmark.address) {
            return;
        }

        this.closeBookmarkPopup();
        this.createTab(bookmark.address, { activate: false });
    }

    handleBookmarkPopupHover(item) {
        const bookmark = this.findBookmarkById(item.dataset.popupBookmarkId);
        if (!bookmark) {
            return;
        }

        if (bookmark.type === 'folder') {
            if (this.bookmarkPopupState?.anchorBookmarkId !== bookmark.id) {
                this.queueBookmarkHover(item, bookmark, 'popup-folder');
            }
            this.hideHoverStatus();
            return;
        }

        if (bookmark.address) {
            this.cancelBookmarkHoverTimer();
            this.showHoverStatus(bookmark.address);
        }
    }

    handleBookmarkContextMenu(event) {
        if (!this.hostContent) {
            return;
        }

        const target = this.getElementTarget(event.target);
        const popupItem = target?.closest?.('[data-popup-bookmark-id]');
        const barItem = target?.closest?.('[data-bookmark-id]');
        const overflowButton = target?.closest?.('[data-bookmark-overflow]');
        const isBookmarkBarBackground = !!target?.closest?.('#bookmarkBar');
        const isPopupBackground = !!target?.closest?.('.chrome-hosted-bookmark-popup');

        let context = null;

        if (popupItem) {
            const bookmarkId = popupItem.dataset.popupBookmarkId;
            const bookmark = this.findBookmarkById(bookmarkId);
            if (!bookmark) {
                return;
            }

            context = this.buildBookmarkContextState({
                anchorElement: popupItem,
                bookmark,
                sourceKind: 'popup-item',
                parentFolderId: this.getBookmarkPopupParentFolderId()
            });
        } else if (barItem) {
            const bookmarkId = barItem.dataset.bookmarkId;
            const bookmark = this.findBookmarkById(bookmarkId);
            if (!bookmark) {
                return;
            }

            context = this.buildBookmarkContextState({
                anchorElement: barItem,
                bookmark,
                sourceKind: 'bar-item',
                parentFolderId: 'bookmark-bar-root'
            });
        } else if (overflowButton) {
            context = this.buildBookmarkContextState({
                anchorElement: overflowButton,
                bookmark: null,
                sourceKind: 'overflow-root',
                parentFolderId: 'bookmark-bar-root'
            });
        } else if (isBookmarkBarBackground) {
            context = this.buildBookmarkContextState({
                anchorElement: this.bookmarkBar,
                bookmark: null,
                sourceKind: 'bar-root',
                parentFolderId: 'bookmark-bar-root'
            });
        } else if (isPopupBackground) {
            context = this.buildBookmarkContextState({
                anchorElement: this.hostedBookmarkPopup,
                bookmark: null,
                sourceKind: 'popup-root',
                parentFolderId: this.getBookmarkPopupParentFolderId()
            });
        }

        if (!context) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        this.showBookmarkContextMenu(context, event.clientX, event.clientY);
    }

    isBookmarkManagerPageActive() {
        return this.getActiveTab()?.address === 'chrome://bookmarks/';
    }

    handleBookmarkManagerContextMenu(event) {
        if (!this.isBookmarkManagerPageActive() || !this.hostContent) {
            return false;
        }

        const target = this.getElementTarget(event.target);
        const bookmarkManagerPage = target?.closest?.('.chrome-bookmark-manager-page');
        if (!bookmarkManagerPage) {
            return;
        }

        const listItem = target?.closest?.('.chrome-bookmark-manager-list-item');
        const treeItem = target?.closest?.('.chrome-bookmark-manager-tree-item');
        let context = null;

        if (listItem) {
            const bookmark = this.findBookmarkById(listItem.dataset.bookmarkManagerBookmarkId || '');
            if (!bookmark) {
                return;
            }

            context = this.buildBookmarkManagerItemContextState(bookmark, this.getBookmarkParentFolderId(bookmark.id) || 'bookmark-bar-root');
        } else if (treeItem) {
            const folderId = treeItem.dataset.bookmarkManagerFolderId || 'bookmark-bar-root';
            context = this.buildBookmarkManagerFoldersMenuState(treeItem, folderId);
        } else if (target?.closest?.('.chrome-bookmark-manager-pane--tree')) {
            context = this.buildBookmarkManagerFoldersMenuState(target, this.getValidBookmarkManagerFolderId());
        } else if (target?.closest?.('.chrome-bookmark-manager-pane--list')) {
            context = this.buildBookmarkManagerOrganizeMenuState(target, this.getValidBookmarkManagerFolderId());
        }

        if (!context) {
            return false;
        }

        event.preventDefault();
        event.stopPropagation();
        this.showBookmarkContextMenu(context, event.clientX, event.clientY);
        return true;
    }

    handlePageHostContextMenu(event) {
        if (this.handleBookmarkManagerContextMenu(event)) {
            return;
        }

        const target = this.getElementTarget(event.target);
        const image = target?.closest?.('img');
        if (!this.isHtmlElement(image)) {
            return;
        }

        const resolvedSrc = image.currentSrc || image.src || '';
        const rawSrc = image.getAttribute('src') || '';
        const src = resolvedSrc || rawSrc;
        if (!src) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        this.showLocalPageImageContextMenu({
            src,
            copyAddress: rawSrc || resolvedSrc,
            alt: image.getAttribute('alt') || '',
            clientX: event.clientX,
            clientY: event.clientY
        });
    }

    showLocalPageImageContextMenu({ src, copyAddress, alt, clientX, clientY }) {
        this.showWebviewContextMenu({
            mediaType: 'image',
            srcURL: src,
            copyURL: copyAddress || src,
            pageURL: this.getActiveTab()?.address || '',
            selectionText: '',
            isEditable: false,
            x: clientX,
            y: clientY,
            localPage: true,
            imageAltText: alt || ''
        });
    }

    showBookmarkManagerFoldersMenu(anchorElement) {
        const context = this.buildBookmarkManagerFoldersMenuState(anchorElement, this.getValidBookmarkManagerFolderId());
        if (!context) {
            return;
        }

        const rect = anchorElement.getBoundingClientRect();
        this.showBookmarkContextMenu(context, rect.left, rect.bottom);
    }

    showBookmarkManagerOrganizeMenu(anchorElement) {
        const context = this.buildBookmarkManagerOrganizeMenuState(anchorElement, this.getValidBookmarkManagerFolderId());
        if (!context) {
            return;
        }

        const rect = anchorElement.getBoundingClientRect();
        this.showBookmarkContextMenu(context, rect.left, rect.bottom);
    }

    buildBookmarkManagerFoldersMenuState(anchorElement, folderId) {
        const normalizedFolderId = folderId || 'bookmark-bar-root';
        const selectedFolder = normalizedFolderId === 'bookmark-bar-root'
            ? null
            : this.findBookmarkById(normalizedFolderId);

        return {
            anchorElement,
            sourceKind: 'bookmark-manager-folders-menu',
            parentFolderId: normalizedFolderId,
            selection: selectedFolder ? [selectedFolder] : [],
            menuGroups: [
                [
                    { action: 'add-folder', label: 'New folder' }
                ],
                [
                    { action: 'rename', label: 'Rename folder', disabled: !selectedFolder },
                    { action: 'cut', label: 'Cut', disabled: !selectedFolder },
                    { action: 'copy', label: 'Copy', disabled: !selectedFolder },
                    { action: 'paste', label: 'Paste', disabled: !this.bookmarkClipboard }
                ],
                [
                    { action: 'delete', label: 'Delete', disabled: !selectedFolder },
                    { action: 'undo-delete', label: 'Undo delete', disabled: true }
                ]
            ]
        };
    }

    buildBookmarkManagerOrganizeMenuState(anchorElement, folderId) {
        const normalizedFolderId = folderId || 'bookmark-bar-root';
        const currentFolder = normalizedFolderId === 'bookmark-bar-root'
            ? null
            : this.findBookmarkById(normalizedFolderId);
        const container = this.getBookmarkContainer(normalizedFolderId) || [];

        return {
            anchorElement,
            sourceKind: 'bookmark-manager-organize-menu',
            parentFolderId: normalizedFolderId,
            selection: currentFolder ? [currentFolder] : [],
            menuGroups: [
                [
                    { action: 'add-page', label: 'Add new bookmark...' },
                    { action: 'add-folder', label: 'New folder' }
                ],
                [
                    { action: 'rename', label: 'Rename folder', disabled: !currentFolder },
                    { action: 'paste', label: 'Paste', disabled: !this.bookmarkClipboard }
                ],
                [
                    { action: 'delete', label: 'Delete', disabled: !currentFolder },
                    { action: 'undo-delete', label: 'Undo delete', disabled: true }
                ],
                [
                    { action: 'sort-folder', label: 'Sort by name', disabled: container.length < 2 }
                ],
                [
                    { action: 'import-bookmarks', label: 'Import bookmarks and settings...' },
                    { action: 'export-bookmarks', label: 'Export bookmarks to HTML file...' }
                ]
            ]
        };
    }

    buildBookmarkManagerItemContextState(bookmark, parentFolderId) {
        const selection = bookmark ? [bookmark] : [];
        const hasUrls = this.getBookmarkOpenableUrls(selection).length > 0;
        const isSingleFolder = selection.length === 1 && selection[0].type === 'folder';

        return {
            anchorElement: null,
            sourceKind: 'bookmark-manager-item',
            parentFolderId: parentFolderId || 'bookmark-bar-root',
            selection,
            menuGroups: [
                [
                    {
                        action: 'open-all',
                        label: bookmark?.type === 'url' ? 'Open in New Tab' : 'Open All Bookmarks',
                        disabled: !hasUrls
                    },
                    {
                        action: 'open-all-new-window',
                        label: bookmark?.type === 'url' ? 'Open in New Window' : 'Open All Bookmarks in New Window',
                        disabled: !hasUrls
                    },
                    {
                        action: 'open-all-incognito',
                        label: bookmark?.type === 'url' ? 'Open in Incognito Window' : 'Open All Bookmarks in Incognito Window',
                        disabled: !hasUrls
                    }
                ],
                [
                    {
                        action: isSingleFolder ? 'rename' : 'edit',
                        label: isSingleFolder ? 'Rename...' : 'Edit...'
                    },
                    {
                        action: 'show-in-folder',
                        label: 'Show in folder'
                    }
                ],
                [
                    { action: 'cut', label: 'Cut' },
                    { action: 'copy', label: 'Copy' },
                    { action: 'paste', label: 'Paste', disabled: !this.bookmarkClipboard }
                ],
                [
                    { action: 'delete', label: 'Delete' },
                    { action: 'undo-delete', label: 'Undo delete', disabled: true }
                ],
                [
                    { action: 'add-page', label: 'Add new bookmark...' },
                    { action: 'add-folder', label: 'New folder' }
                ]
            ]
        };
    }

    buildBookmarkContextState({ anchorElement, bookmark, sourceKind, parentFolderId }) {
        const selection = bookmark ? [bookmark] : [];
        const hasUrls = this.getBookmarkOpenableUrls(selection.length ? selection : this.getBookmarkContainer(parentFolderId) || []).length > 0;
        const isSingleUrl = selection.length === 1 && selection[0].type === 'url';
        const isSingleFolder = selection.length === 1 && selection[0].type === 'folder';
        const menuGroups = [
            [
                {
                    action: 'open-all',
                    label: isSingleUrl ? 'Open in New Tab' : 'Open All Bookmarks',
                    disabled: !hasUrls
                },
                {
                    action: 'open-all-new-window',
                    label: isSingleUrl ? 'Open in New Window' : 'Open All Bookmarks in New Window',
                    disabled: !hasUrls
                },
                {
                    action: 'open-all-incognito',
                    label: isSingleUrl ? 'Open in Incognito Window' : 'Open All Bookmarks in Incognito Window',
                    disabled: !hasUrls
                }
            ],
            [
                {
                    action: isSingleFolder ? 'rename' : 'edit',
                    label: isSingleFolder ? 'Rename...' : 'Edit...',
                    disabled: selection.length === 0
                }
            ],
            [
                {
                    action: 'cut',
                    label: 'Cut',
                    disabled: selection.length === 0
                },
                {
                    action: 'copy',
                    label: 'Copy',
                    disabled: selection.length === 0
                },
                {
                    action: 'paste',
                    label: 'Paste',
                    disabled: !this.bookmarkClipboard
                }
            ],
            [
                {
                    action: 'delete',
                    label: 'Delete',
                    disabled: selection.length === 0
                }
            ],
            [
                {
                    action: 'add-page',
                    label: 'Add Page...'
                },
                {
                    action: 'add-folder',
                    label: 'Add Folder...'
                }
            ],
            [
                {
                    action: 'bookmark-manager',
                    label: 'Bookmark Manager'
                },
                {
                    action: 'show-bookmarks-bar',
                    label: 'Show Bookmarks Bar',
                    type: 'checkbox',
                    checked: !!this.localUiState.settings.showBookmarksBar
                }
            ]
        ];

        return {
            anchorElement,
            sourceKind,
            parentFolderId: parentFolderId || 'bookmark-bar-root',
            selection,
            menuGroups
        };
    }

    showBookmarkContextMenu(context, clientX, clientY) {
        if (!this.hostedBookmarkContextMenu || !this.hostContent) {
            return;
        }

        this.closeBookmarkBubble({ applyEdits: true });
        this.cancelBookmarkHoverTimer();
        this.closeTabContextMenu();

        this.bookmarkContextMenuState = context;
        const menuMarkup = context.menuGroups.map((group, groupIndex) => `
            <div class="chrome-hosted-bookmark-context-group">
                ${group.map((item) => `
                    <button
                        class="chrome-hosted-bookmark-context-item ${item.type === 'checkbox' ? 'is-checkbox' : ''} ${item.checked ? 'is-checked' : ''}"
                        type="button"
                        data-bookmark-context-action="${this.escapeHtml(item.action)}"
                        ${item.disabled ? 'disabled' : ''}
                    >
                        <span class="chrome-hosted-bookmark-context-check" aria-hidden="true"></span>
                        <span class="chrome-hosted-bookmark-context-label">${this.escapeHtml(item.label)}</span>
                    </button>
                `).join('')}
            </div>
            ${groupIndex < context.menuGroups.length - 1 ? '<div class="chrome-hosted-bookmark-context-separator"></div>' : ''}
        `).join('');

        if (this.isBookmarkManagerContextSource(context.sourceKind)) {
            this.showBookmarkManagerContextMenu(menuMarkup, clientX, clientY);
            return;
        }

        this.hostedBookmarkContextMenu.innerHTML = menuMarkup;

        const menu = this.hostedBookmarkContextMenu;
        const hostPoint = this.translateClientPointToHost(clientX, clientY, context.anchorElement || null);
        const hostRect = this.hostContent.getBoundingClientRect();
        menu.hidden = false;
        menu.style.left = `${Math.max(0, hostPoint.clientX - hostRect.left)}px`;
        menu.style.top = `${Math.max(0, hostPoint.clientY - hostRect.top)}px`;

        window.requestAnimationFrame(() => {
            if (menu.hidden) {
                return;
            }

            const rect = menu.getBoundingClientRect();
            const maxLeft = Math.max(6, hostRect.width - rect.width - 6);
            const maxTop = Math.max(6, hostRect.height - rect.height - 6);
            menu.style.left = `${Math.max(1, Math.min(hostPoint.clientX - hostRect.left, maxLeft))}px`;
            menu.style.top = `${Math.max(1, Math.min(hostPoint.clientY - hostRect.top, maxTop))}px`;
        });
    }

    isBookmarkManagerContextSource(sourceKind) {
        return typeof sourceKind === 'string' && sourceKind.startsWith('bookmark-manager');
    }

    getBookmarkManagerContextMenuElement() {
        return this.pageHost.querySelector('[data-bookmark-manager-context-menu]');
    }

    showBookmarkManagerContextMenu(menuMarkup, clientX, clientY) {
        const menu = this.getBookmarkManagerContextMenuElement();
        const page = this.pageHost.querySelector('.chrome-bookmark-manager-page');
        if (!this.isHtmlElement(menu) || !this.isHtmlElement(page)) {
            return;
        }

        menu.innerHTML = menuMarkup;
        menu.hidden = false;

        const pageRect = page.getBoundingClientRect();
        menu.style.left = `${Math.max(0, clientX - pageRect.left)}px`;
        menu.style.top = `${Math.max(0, clientY - pageRect.top)}px`;

        window.requestAnimationFrame(() => {
            if (menu.hidden) {
                return;
            }

            const rect = menu.getBoundingClientRect();
            const maxLeft = Math.max(6, pageRect.width - rect.width - 6);
            const maxTop = Math.max(6, pageRect.height - rect.height - 6);
            menu.style.left = `${Math.max(1, Math.min(clientX - pageRect.left, maxLeft))}px`;
            menu.style.top = `${Math.max(1, Math.min(clientY - pageRect.top, maxTop))}px`;
        });
    }

    closeBookmarkContextMenu() {
        const pageMenu = this.getBookmarkManagerContextMenuElement();
        if (this.isHtmlElement(pageMenu)) {
            pageMenu.hidden = true;
            pageMenu.innerHTML = '';
        }

        if (this.hostedBookmarkContextMenu) {
            this.hostedBookmarkContextMenu.hidden = true;
            this.hostedBookmarkContextMenu.innerHTML = '';
        }

        this.bookmarkContextMenuState = null;
    }

    showWebviewContextMenu(params) {
        const menu = this.hostedWebviewContextMenu;
        const activeTab = this.getActiveTab();
        const webview = activeTab?.webview || null;
        const isLocalPageContext = !!params?.localPage;
        if (!this.isHtmlElement(menu) || !this.isHtmlElement(this.hostContent) || !params) {
            return;
        }

        if (!isLocalPageContext && !this.isHtmlElement(webview)) {
            return;
        }

        const menuGroups = this.getWebviewContextMenuGroups(params, activeTab);
        if (!menuGroups.length) {
            this.closeWebviewContextMenu();
            return;
        }

        this.closeBookmarkContextMenu();
        this.closeTabContextMenu();
        this.closeBookmarkPopup();
        this.closeBookmarkBubble({ applyEdits: true });
        this.closePageInfoBubble();
        this.closeOmniboxPopup({ restoreUserText: true });
        this.setMenuOpen(false);

        this.webviewContextMenuState = {
            params,
            tabId: activeTab.id,
            localPage: isLocalPageContext
        };

        if (this.hostedWebviewContextMenuBackdrop) {
            this.hostedWebviewContextMenuBackdrop.hidden = false;
        }

        menu.innerHTML = menuGroups.map((group, groupIndex) => `
            <div class="chrome-hosted-webview-context-group">
                ${group.map((item) => `
                    <button
                        class="chrome-hosted-webview-context-item"
                        type="button"
                        data-webview-context-action="${this.escapeHtml(item.action)}"
                        ${item.value ? `data-webview-context-value="${this.escapeHtml(item.value)}"` : ''}
                        ${item.disabled ? 'disabled' : ''}
                    >
                        <span class="chrome-hosted-webview-context-label">${this.escapeHtml(item.label)}</span>
                        ${item.shortcut ? `<span class="chrome-hosted-webview-context-shortcut">${this.escapeHtml(item.shortcut)}</span>` : ''}
                    </button>
                `).join('')}
            </div>
            ${groupIndex < menuGroups.length - 1 ? '<div class="chrome-hosted-webview-context-separator"></div>' : ''}
        `).join('');

        const hostRect = this.hostContent.getBoundingClientRect();
        const menuX = isLocalPageContext
            ? Number(params.x) || hostRect.left
            : this.getHostAlignedClientRect(webview).left + (Number(params.x) || 0);
        const menuY = isLocalPageContext
            ? Number(params.y) || hostRect.top
            : this.getHostAlignedClientRect(webview).top + (Number(params.y) || 0);

        menu.hidden = false;
        menu.style.left = `${Math.max(1, menuX - hostRect.left)}px`;
        menu.style.top = `${Math.max(1, menuY - hostRect.top)}px`;

        window.requestAnimationFrame(() => {
            if (menu.hidden) {
                return;
            }

            const rect = menu.getBoundingClientRect();
            const maxLeft = Math.max(6, hostRect.width - rect.width - 6);
            const maxTop = Math.max(6, hostRect.height - rect.height - 6);
            menu.style.left = `${Math.max(1, Math.min(menuX - hostRect.left, maxLeft))}px`;
            menu.style.top = `${Math.max(1, Math.min(menuY - hostRect.top, maxTop))}px`;
        });
    }

    closeWebviewContextMenu() {
        if (this.hostedWebviewContextMenuBackdrop) {
            this.hostedWebviewContextMenuBackdrop.hidden = true;
        }

        if (this.hostedWebviewContextMenu) {
            this.hostedWebviewContextMenu.hidden = true;
            this.hostedWebviewContextMenu.innerHTML = '';
        }

        this.webviewContextMenuState = null;
    }

    getWebviewContextMenuGroups(params, activeTab) {
        const groups = [];
        const hasLink = typeof params.linkURL === 'string' && !!params.linkURL;
        const hasImage = params.mediaType === 'image' && typeof params.srcURL === 'string' && !!params.srcURL;
        const hasSelection = typeof params.selectionText === 'string' && params.selectionText.trim().length > 0;
        const isEditable = !!params.isEditable;
        const pageUrl = typeof params.pageURL === 'string' && params.pageURL ? params.pageURL : (activeTab?.address || '');

        if (hasLink) {
            groups.push([
                { action: 'open-link-new-tab', label: 'Open link in new tab' },
                { action: 'open-link-new-window', label: 'Open link in new window' },
                { action: 'open-link-incognito', label: 'Open link in incognito window', disabled: true }
            ]);
            groups.push([
                { action: 'save-link-as', label: 'Save link as...', disabled: true },
                { action: 'copy-link-address', label: params.linkURL.startsWith('mailto:') ? 'Copy email address' : 'Copy link address', shortcut: 'Ctrl+C' }
            ]);

            if (typeof params.linkText === 'string' && params.linkText.trim() && params.mediaType !== 'image') {
                groups[groups.length - 1].push({ action: 'copy-link-text', label: 'Copy link text' });
            }
        }

        if (hasImage) {
            groups.push([
                { action: 'open-image-new-tab', label: 'Open image in new tab' },
                { action: 'save-image-as', label: 'Save image as...', disabled: true },
                { action: 'copy-image', label: 'Copy image' },
                { action: 'copy-image-address', label: 'Copy image address' }
            ]);
        }

        if (isEditable) {
            const editFlags = params.editFlags || {};
            groups.push([
                { action: 'undo', label: 'Undo', shortcut: 'Ctrl+Z', disabled: !editFlags.canUndo },
                { action: 'redo', label: 'Redo', shortcut: 'Ctrl+Shift+Z', disabled: !editFlags.canRedo }
            ]);
            groups.push([
                { action: 'cut', label: 'Cut', shortcut: 'Ctrl+X', disabled: !editFlags.canCut },
                { action: 'copy', label: 'Copy', shortcut: 'Ctrl+C', disabled: !editFlags.canCopy },
                { action: 'paste', label: 'Paste', shortcut: 'Ctrl+V', disabled: !editFlags.canPaste },
                { action: 'paste-match-style', label: 'Paste and match style', shortcut: 'Ctrl+Shift+V', disabled: !editFlags.canPaste },
                { action: 'select-all', label: 'Select all', shortcut: 'Ctrl+A', disabled: !editFlags.canSelectAll }
            ]);
        } else if (hasSelection) {
            groups.push([
                { action: 'copy-selection', label: 'Copy', shortcut: 'Ctrl+C' },
                {
                    action: 'search-selection',
                    label: `Search ${this.getSearchEngineLabel()} for "${params.selectionText.trim().slice(0, 40)}${params.selectionText.trim().length > 40 ? '…' : ''}"`
                }
            ]);
        }

        if (!hasLink && !hasImage && !isEditable) {
            groups.unshift([
                { action: 'page-back', label: 'Back', shortcut: 'Alt+Left', disabled: !activeTab?.canGoBack },
                { action: 'page-forward', label: 'Forward', shortcut: 'Alt+Right', disabled: !activeTab?.canGoForward },
                { action: 'page-reload', label: 'Reload', shortcut: 'Ctrl+R' }
            ]);
            groups.splice(1, 0, [
                { action: 'save-page-as', label: 'Save page as...', shortcut: 'Ctrl+S', disabled: true },
                { action: 'print-page', label: 'Print...', shortcut: 'Ctrl+P' }
            ]);
        }

        if (pageUrl) {
            groups.push([
                { action: 'view-page-source', label: 'View page source', shortcut: 'Ctrl+U', disabled: this.isLocalAddress(pageUrl) },
                { action: 'inspect-element', label: 'Inspect element', shortcut: 'Ctrl+Shift+I' }
            ]);
        }

        return groups.filter((group) => Array.isArray(group) && group.length);
    }

    handleWebviewContextMenuClick(event) {
        const actionTarget = event.target.closest('[data-webview-context-action]');
        if (!actionTarget || actionTarget.hasAttribute('disabled')) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        this.executeWebviewContextMenuAction(
            actionTarget.dataset.webviewContextAction,
            actionTarget.dataset.webviewContextValue || ''
        );
        this.closeWebviewContextMenu();
    }

    executeWebviewContextMenuAction(action, value = '') {
        const context = this.webviewContextMenuState;
        const tab = context?.tabId ? this.tabs.find((candidate) => candidate.id === context.tabId) : this.getActiveTab();
        const webview = tab?.webview || null;
        const params = context?.params || {};
        const targetUrl = this.normalizeAddress(params.linkURL || params.srcURL || tab?.address || '');

        switch (action) {
            case 'open-link-new-tab':
                if (params.linkURL) {
                    this.createTab(params.linkURL, { activate: true });
                }
                break;
            case 'open-link-new-window':
                if (params.linkURL) {
                    this.openUrlInNewChromeWindow(params.linkURL);
                }
                break;
            case 'copy-link-address':
                this.writeTextToClipboard(params.linkURL || '');
                break;
            case 'copy-link-text':
                this.writeTextToClipboard(params.linkText || '');
                break;
            case 'open-image-new-tab':
                if (params.srcURL) {
                    this.createTab(params.srcURL);
                }
                break;
            case 'copy-image':
                if (params.srcURL) {
                    if (context?.localPage) {
                        this.copyLocalPageImageToClipboard(params.srcURL);
                    } else if (webview && typeof webview.copyImageAt === 'function') {
                        try {
                            webview.copyImageAt(Number(params.x) || 0, Number(params.y) || 0);
                        } catch (_error) {
                            this.showStatus('Copy image is not available here.', true);
                        }
                    } else {
                        this.showStatus('Copy image is not available here.', true);
                    }
                }
                break;
            case 'copy-image-address':
                this.writeTextToClipboard(params.copyURL || params.srcURL || '');
                break;
            case 'copy-selection':
                this.writeTextToClipboard(params.selectionText || '');
                break;
            case 'search-selection':
                if (params.selectionText) {
                    this.createTab(`${this.getSearchUrl()}${encodeURIComponent(params.selectionText)}`);
                }
                break;
            case 'page-back':
                this.goBack();
                break;
            case 'page-forward':
                this.goForward();
                break;
            case 'page-reload':
                this.refreshActiveTab();
                break;
            case 'print-page':
                if (webview && typeof webview.print === 'function') {
                    webview.print();
                }
                break;
            case 'view-page-source':
                if (targetUrl && !this.isLocalAddress(targetUrl)) {
                    this.createTab(`view-source:${targetUrl}`);
                }
                break;
            case 'inspect-element':
                if (webview && typeof webview.inspectElement === 'function') {
                    webview.inspectElement(Number(params.x) || 0, Number(params.y) || 0);
                }
                break;
            case 'undo':
                this.invokeWebviewEditCommand(webview, 'undo');
                break;
            case 'redo':
                this.invokeWebviewEditCommand(webview, 'redo');
                break;
            case 'cut':
                this.invokeWebviewEditCommand(webview, 'cut');
                break;
            case 'copy':
                this.invokeWebviewEditCommand(webview, 'copy');
                break;
            case 'paste':
                this.invokeWebviewEditCommand(webview, 'paste');
                break;
            case 'paste-match-style':
                if (!this.invokeWebviewEditCommand(webview, 'pasteAndMatchStyle')) {
                    this.invokeWebviewEditCommand(webview, 'paste');
                }
                break;
            case 'select-all':
                this.invokeWebviewEditCommand(webview, 'selectAll');
                break;
            default:
                break;
        }
    }

    invokeWebviewEditCommand(webview, commandName) {
        if (!webview || typeof webview[commandName] !== 'function') {
            return false;
        }

        try {
            webview[commandName]();
            return true;
        } catch (_error) {
            return false;
        }
    }

    writeTextToClipboard(text) {
        const value = typeof text === 'string' ? text : '';
        if (!value) {
            return;
        }

        if (electronClipboard && typeof electronClipboard.writeText === 'function') {
            electronClipboard.writeText(value);
            return;
        }

        if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(value).catch(() => {});
        }
    }

    copyLocalPageImageToClipboard(src) {
        const imageSource = typeof src === 'string' ? src : '';
        if (!imageSource) {
            return;
        }

        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = image.naturalWidth || image.width;
                canvas.height = image.naturalHeight || image.height;
                const context = canvas.getContext('2d');
                if (!context) {
                    throw new Error('No canvas context');
                }

                context.drawImage(image, 0, 0);
                const dataUrl = canvas.toDataURL('image/png');

                if (electronClipboard && electronNativeImage && typeof electronClipboard.writeImage === 'function' && typeof electronNativeImage.createFromDataURL === 'function') {
                    electronClipboard.writeImage(electronNativeImage.createFromDataURL(dataUrl));
                    return;
                }

                this.showStatus('Copy image is not available here.', true);
            } catch (_error) {
                this.showStatus('Copy image is not available here.', true);
            }
        };
        image.onerror = () => {
            this.showStatus('Copy image is not available here.', true);
        };
        image.src = imageSource;
    }

    openUrlInNewChromeWindow(url) {
        const normalized = this.normalizeAddress(url);
        if (!normalized) {
            return false;
        }

        return this.openNewWindowWithTabs([{
            address: normalized,
            title: this.isLocalAddress(normalized) ? this.getLocalPageTitle(normalized) : normalized,
            faviconUrl: this.getFaviconFromAddress(normalized),
            zoomPercent: 100,
            loading: false,
            networkState: 'none',
            historyEntries: [normalized],
            historyIndex: 0
        }]);
    }

    showBookmarkEditor(options = {}) {
        if (!this.hostedBookmarkEditor) {
            return;
        }

        const activeTab = this.getActiveTab();
        const bookmark = options.bookmarkId ? this.findBookmarkById(options.bookmarkId) : null;
        const mode = options.mode || 'edit-bookmark';
        const isFolder = mode === 'rename-folder' || mode === 'add-folder' || bookmark?.type === 'folder';
        const parentFolderId = options.parentFolderId || this.getBookmarkParentFolderId(options.bookmarkId) || 'bookmark-bar-root';
        const folderChoices = this.getBookmarkFolderChoices(options.bookmarkId || null);
        const title = mode === 'add-bookmark'
            ? 'Add Bookmark'
            : mode === 'add-folder'
                ? 'New folder'
                : isFolder
                    ? 'Edit folder name'
                    : 'Edit Bookmark';
        const nameValue = bookmark?.label ||
            (mode === 'add-folder' ? 'New folder' : this.getBookmarkLabelForAddress(activeTab?.address || '', activeTab?.title));
        const urlValue = bookmark?.address || activeTab?.address || '';

        this.closeBookmarkBubble({ applyEdits: true });
        this.closeBookmarkPopup();
        this.closeBookmarkContextMenu();
        this.closeTabContextMenu();
        this.closeBookmarkEditor();
        this.setMenuOpen(false);

        this.bookmarkEditorState = {
            mode,
            bookmarkId: options.bookmarkId || null,
            parentFolderId,
            originalAddress: bookmark?.address || null
        };

        this.hostedBookmarkEditor.innerHTML = `
            <div class="chrome-bookmark-editor-scrim" data-bookmark-editor-action="cancel"></div>
            <form class="chrome-bookmark-editor-dialog">
                <div class="chrome-bookmark-editor-title">${this.escapeHtml(title)}</div>
                <div class="chrome-bookmark-editor-row">
                    <label class="chrome-bookmark-editor-label" for="bookmarkEditorName">Name:</label>
                    <input class="chrome-bookmark-editor-input" id="bookmarkEditorName" data-bookmark-editor-field="name" type="text" value="${this.escapeHtml(nameValue)}" spellcheck="false">
                </div>
                ${isFolder ? '' : `
                    <div class="chrome-bookmark-editor-row">
                        <label class="chrome-bookmark-editor-label" for="bookmarkEditorUrl">URL:</label>
                        <input class="chrome-bookmark-editor-input" id="bookmarkEditorUrl" data-bookmark-editor-field="url" type="text" value="${this.escapeHtml(urlValue)}" spellcheck="false">
                    </div>
                `}
                ${(mode === 'add-bookmark' || mode === 'add-folder' || mode === 'edit-bookmark') ? `
                    <div class="chrome-bookmark-editor-row">
                        <label class="chrome-bookmark-editor-label" for="bookmarkEditorFolder">Folder:</label>
                        <select class="chrome-bookmark-editor-select" id="bookmarkEditorFolder" data-bookmark-editor-field="folder">
                            <option value="bookmark-bar-root" ${parentFolderId === 'bookmark-bar-root' ? 'selected' : ''}>Bookmarks bar</option>
                            ${folderChoices.map((folder) => `
                                <option value="${this.escapeHtml(folder.id)}" ${parentFolderId === folder.id ? 'selected' : ''}>${this.escapeHtml(folder.label)}</option>
                            `).join('')}
                        </select>
                    </div>
                ` : ''}
                <div class="chrome-bookmark-editor-actions">
                    <button class="chrome-bookmark-bubble-button" type="button" data-bookmark-editor-action="cancel">Cancel</button>
                    <button class="chrome-bookmark-bubble-button chrome-bookmark-bubble-button--default" type="submit" data-bookmark-editor-action="save">Save</button>
                </div>
            </form>
        `;

        this.hostedBookmarkEditor.hidden = false;
        this.hostWindow?.classList.add('is-bookmark-editor-open');

        window.requestAnimationFrame(() => {
            const input = this.hostedBookmarkEditor?.querySelector('[data-bookmark-editor-field="name"]');
            if (this.isInputElement(input)) {
                input.focus();
                input.select();
            }
        });
    }

    closeBookmarkEditor() {
        if (this.hostedBookmarkEditor) {
            this.hostedBookmarkEditor.hidden = true;
            this.hostedBookmarkEditor.innerHTML = '';
        }

        this.hostWindow?.classList.remove('is-bookmark-editor-open');
        this.bookmarkEditorState = null;
    }

    applyBookmarkEditor() {
        if (!this.hostedBookmarkEditor || !this.bookmarkEditorState) {
            return;
        }

        const nameInput = this.hostedBookmarkEditor.querySelector('[data-bookmark-editor-field="name"]');
        const urlInput = this.hostedBookmarkEditor.querySelector('[data-bookmark-editor-field="url"]');
        const folderSelect = this.hostedBookmarkEditor.querySelector('[data-bookmark-editor-field="folder"]');
        const name = this.isInputElement(nameInput) ? nameInput.value.trim() : '';
        const rawUrl = this.isInputElement(urlInput) ? urlInput.value.trim() : '';
        const selectedFolderId = this.isSelectElement(folderSelect) ? folderSelect.value : this.bookmarkEditorState.parentFolderId;

        if (!name) {
            return;
        }

        const mode = this.bookmarkEditorState.mode;
        if (mode === 'rename-folder') {
            const bookmark = this.findBookmarkById(this.bookmarkEditorState.bookmarkId);
            if (!bookmark) {
                return;
            }

            bookmark.label = name;
        } else if (mode === 'edit-bookmark') {
            const bookmark = this.findBookmarkById(this.bookmarkEditorState.bookmarkId);
            if (!bookmark) {
                return;
            }

            const normalizedUrl = this.normalizeAddress(rawUrl);
            bookmark.label = name;
            bookmark.address = normalizedUrl;
            if (normalizedUrl !== this.bookmarkEditorState.originalAddress) {
                bookmark.faviconUrl = this.getLocalPageFaviconUrl(normalizedUrl) || null;
            }
            this.moveBookmarkNode(bookmark.id, selectedFolderId || 'bookmark-bar-root');
        } else if (mode === 'add-bookmark') {
            const normalizedUrl = this.normalizeAddress(rawUrl);
            const activeTab = this.getActiveTab();
            const bookmark = this.createBookmarkNode({
                type: 'url',
                label: name,
                address: normalizedUrl,
                faviconUrl: activeTab?.address === normalizedUrl ? this.getTabFaviconUrl(activeTab) : this.getLocalPageFaviconUrl(normalizedUrl)
            });
            this.insertBookmarkNode(bookmark, selectedFolderId || 'bookmark-bar-root');
        } else if (mode === 'add-folder') {
            const folder = this.createBookmarkNode({
                type: 'folder',
                label: name,
                children: []
            });
            this.insertBookmarkNode(folder, selectedFolderId || 'bookmark-bar-root');
        }

        this.renderBookmarks();
        this.savePersistentState();
        this.closeBookmarkEditor();
    }

    handleBookmarkContextAction(action) {
        const context = this.bookmarkContextMenuState;
        if (!context) {
            return;
        }

        const selection = context.selection || [];
        switch (action) {
            case 'open-all':
                this.openBookmarkSelection(selection, { activateFirst: false });
                break;
            case 'open-all-new-window':
                this.showStatus('Separate Chrome windows are not implemented yet.', true);
                break;
            case 'open-all-incognito':
                this.showStatus('Incognito windows are not implemented yet.', true);
                break;
            case 'edit':
                if (selection[0]) {
                    this.showBookmarkEditor({
                        mode: selection[0].type === 'folder' ? 'rename-folder' : 'edit-bookmark',
                        bookmarkId: selection[0].id,
                        parentFolderId: this.getBookmarkParentFolderId(selection[0].id) || 'bookmark-bar-root'
                    });
                }
                break;
            case 'rename':
                this.showBookmarkEditor({
                    mode: 'rename-folder',
                    bookmarkId: selection[0]?.id,
                    parentFolderId: this.getBookmarkParentFolderId(selection[0]?.id) || 'bookmark-bar-root'
                });
                break;
            case 'cut':
                this.copyBookmarkSelection(selection, true);
                break;
            case 'copy':
                this.copyBookmarkSelection(selection, false);
                break;
            case 'paste':
                this.pasteBookmarkSelection(context);
                break;
            case 'delete':
                this.deleteBookmarkSelection(selection);
                break;
            case 'add-page':
                this.showBookmarkEditor({
                    mode: 'add-bookmark',
                    parentFolderId: context.parentFolderId || 'bookmark-bar-root'
                });
                break;
            case 'add-folder':
                this.showBookmarkEditor({
                    mode: 'add-folder',
                    parentFolderId: context.parentFolderId || 'bookmark-bar-root'
                });
                break;
            case 'bookmark-manager':
                this.navigateCurrentTab('chrome://bookmarks/');
                break;
            case 'show-in-folder': {
                const bookmark = selection[0];
                if (bookmark) {
                    this.localUiState.bookmarkManagerFolderId = this.getBookmarkParentFolderId(bookmark.id) || 'bookmark-bar-root';
                    this.localUiState.bookmarkManagerFilter = '';
                    if (this.isBookmarkManagerPageActive()) {
                        this.renderCurrentLocalPage();
                    } else {
                        this.navigateCurrentTab('chrome://bookmarks/');
                    }
                }
                break;
            }
            case 'sort-folder':
                if (this.sortBookmarkContainer(context.parentFolderId || 'bookmark-bar-root')) {
                    this.renderBookmarks();
                    this.renderCurrentLocalPage();
                    this.savePersistentState();
                }
                break;
            case 'undo-delete':
                this.showStatus('Undo delete is not implemented in this build.', true);
                break;
            case 'import-bookmarks':
            case 'export-bookmarks':
                this.showStatus('Bookmark import/export is not implemented in this build.', true);
                break;
            case 'show-bookmarks-bar':
                this.localUiState.settings.showBookmarksBar = !this.localUiState.settings.showBookmarksBar;
                this.applySurfacePreferences();
                this.savePersistentState();
                break;
            default:
                break;
        }

        if (action !== 'edit') {
            this.closeBookmarkContextMenu();
        }
    }

    queueBookmarkHover(anchorElement, bookmark, sourceKind) {
        this.cancelBookmarkHoverTimer();
        this.bookmarkHoverTimer = window.setTimeout(() => {
            if (sourceKind === 'overflow') {
                this.showBookmarkPopup(this.getOverflowBookmarks(), anchorElement, {
                    sourceKind: 'overflow'
                });
                return;
            }

            if (!bookmark) {
                return;
            }

            this.showBookmarkPopup(bookmark.children || [], anchorElement, {
                anchorBookmarkId: bookmark.id,
                sourceKind
            });
        }, BOOKMARK_BAR_METRICS.menuShowDelayMs);
    }

    cancelBookmarkHoverTimer() {
        if (this.bookmarkHoverTimer) {
            clearTimeout(this.bookmarkHoverTimer);
            this.bookmarkHoverTimer = null;
        }
    }

    showBookmarkPopup(items, anchorElement, options = {}) {
        if (!this.hostedBookmarkPopup || !this.hostContent || !anchorElement || !items.length) {
            return;
        }

        this.cancelBookmarkHoverTimer();
        this.setMenuOpen(false);
        this.clearOpenBookmarkTriggers();

        this.bookmarkPopupState = {
            anchorElement,
            anchorBookmarkId: options.anchorBookmarkId || null,
            sourceKind: options.sourceKind || 'bar-folder'
        };

        anchorElement.classList.add('is-menu-open');

        this.hostedBookmarkPopup.innerHTML = items.map((bookmark) => {
            const isFolder = bookmark.type === 'folder';
            const classes = ['chrome-hosted-bookmark-menu-item'];
            const iconStyle = this.getBookmarkIconStyle(bookmark);

            if (isFolder) {
                classes.push('is-folder');
            }

            if (bookmark.type === 'apps') {
                classes.push('is-apps');
            }

            return `
                <button
                    class="${classes.join(' ')}"
                    type="button"
                    data-popup-bookmark-id="${bookmark.id}"
                    data-popup-bookmark-type="${bookmark.type}"
                    ${bookmark.address ? `data-address="${this.escapeHtml(bookmark.address)}"` : ''}
                >
                    <span class="chrome-hosted-bookmark-menu-icon" aria-hidden="true" ${iconStyle}></span>
                    <span class="chrome-hosted-bookmark-menu-label">${this.escapeHtml(bookmark.label)}</span>
                    ${isFolder ? '<span class="chrome-hosted-bookmark-menu-arrow" aria-hidden="true"></span>' : ''}
                </button>
            `;
        }).join('');

        const hostRect = this.hostContent.getBoundingClientRect();
        const anchorRect = anchorElement.getBoundingClientRect();
        const popup = this.hostedBookmarkPopup;

        popup.hidden = false;
        popup.style.left = `${anchorRect.left - hostRect.left}px`;
        popup.style.top = `${anchorRect.bottom - hostRect.top - 1}px`;
        popup.style.right = 'auto';

        window.requestAnimationFrame(() => {
            const popupRect = popup.getBoundingClientRect();
            let left = anchorRect.left - hostRect.left;
            let top = anchorRect.bottom - hostRect.top - 1;

            if (options.sourceKind === 'popup-folder') {
                left = anchorRect.right - hostRect.left - 4;
                top = anchorRect.top - hostRect.top - 3;
            }

            const maxLeft = Math.max(6, hostRect.width - popupRect.width - 6);
            const maxTop = Math.max(6, hostRect.height - popupRect.height - 6);

            popup.style.left = `${Math.max(1, Math.min(left, maxLeft))}px`;
            popup.style.top = `${Math.max(1, Math.min(top, maxTop))}px`;
        });
    }

    getBookmarkPopupParentFolderId() {
        if (!this.bookmarkPopupState?.anchorBookmarkId) {
            return 'bookmark-bar-root';
        }

        return this.bookmarkPopupState.anchorBookmarkId;
    }

    closeBookmarkPopup() {
        this.cancelBookmarkHoverTimer();
        this.clearOpenBookmarkTriggers();
        this.bookmarkPopupState = null;
        this.closeBookmarkContextMenu();

        if (this.hostedBookmarkPopup) {
            this.hostedBookmarkPopup.hidden = true;
            this.hostedBookmarkPopup.innerHTML = '';
        }
    }

    showBookmarkBubble(bookmark, options = {}) {
        const anchorElement = options.anchorElement || this.favoriteButton;
        if (!bookmark || !anchorElement || !this.hostedBookmarkBubble || !this.hostContent) {
            return;
        }

        this.closeBookmarkPopup();
        this.closeBookmarkContextMenu();
        this.setMenuOpen(false);

        const folderChoices = this.getBookmarkFolderChoices(bookmark.id);
        const parentFolderId = this.getBookmarkParentFolderId(bookmark.id);
        const bubble = this.hostedBookmarkBubble;
        const hostRect = this.hostContent.getBoundingClientRect();
        const anchorRect = anchorElement.getBoundingClientRect();
        const title = options.newlyBookmarked ? 'Bookmark added' : 'Edit bookmark';

        this.bookmarkBubbleState = {
            bookmarkId: bookmark.id,
            newlyBookmarked: !!options.newlyBookmarked,
            folderId: parentFolderId
        };

        bubble.innerHTML = `
            <div class="chrome-bookmark-bubble-title">${title}</div>
            <div class="chrome-bookmark-bubble-row">
                <label class="chrome-bookmark-bubble-label" for="bookmarkBubbleTitle">Name:</label>
                <input class="chrome-bookmark-bubble-input" id="bookmarkBubbleTitle" type="text" value="${this.escapeHtml(bookmark.label)}" spellcheck="false">
            </div>
            <div class="chrome-bookmark-bubble-row">
                <label class="chrome-bookmark-bubble-label" for="bookmarkBubbleFolder">Folder:</label>
                <select class="chrome-bookmark-bubble-select" id="bookmarkBubbleFolder" data-bookmark-bubble-field="folder">
                    <option value="bookmark-bar-root" ${parentFolderId === 'bookmark-bar-root' ? 'selected' : ''}>Bookmarks bar</option>
                    ${folderChoices.map((folder) => `
                        <option value="${this.escapeHtml(folder.id)}" ${parentFolderId === folder.id ? 'selected' : ''}>${this.escapeHtml(folder.label)}</option>
                    `).join('')}
                    <option value="bookmark-bubble-separator" disabled>──────────</option>
                    <option value="choose-another-folder">Choose another folder...</option>
                </select>
            </div>
            <div class="chrome-bookmark-bubble-actions">
                <button class="chrome-bookmark-bubble-button" type="button" data-bookmark-bubble-action="remove">Remove</button>
                <button class="chrome-bookmark-bubble-button" type="button" data-bookmark-bubble-action="edit">Edit...</button>
                <button class="chrome-bookmark-bubble-button chrome-bookmark-bubble-button--default" type="button" data-bookmark-bubble-action="done">Done</button>
            </div>
        `;

        bubble.hidden = false;
        bubble.style.left = `${Math.max(8, anchorRect.right - hostRect.left - 282)}px`;
        bubble.style.top = `${anchorRect.bottom - hostRect.top + 6}px`;

        window.requestAnimationFrame(() => {
            if (bubble.hidden) {
                return;
            }

            const bubbleRect = bubble.getBoundingClientRect();
            const maxLeft = Math.max(8, hostRect.width - bubbleRect.width - 8);
            const nextLeft = Math.max(8, Math.min(anchorRect.right - hostRect.left - bubbleRect.width + 12, maxLeft));
            bubble.style.left = `${nextLeft}px`;
            bubble.style.top = `${anchorRect.bottom - hostRect.top + 6}px`;

            const titleInput = bubble.querySelector('#bookmarkBubbleTitle');
            if (this.isInputElement(titleInput)) {
                titleInput.focus();
                titleInput.select();
            }
        });
    }

    closeBookmarkBubble(options = {}) {
        if (!this.hostedBookmarkBubble || this.hostedBookmarkBubble.hidden) {
            this.bookmarkBubbleState = null;
            return;
        }

        if (options.applyEdits !== false) {
            this.applyBookmarkBubbleEdits();
        }

        this.hostedBookmarkBubble.hidden = true;
        this.hostedBookmarkBubble.innerHTML = '';
        this.bookmarkBubbleState = null;
    }

    applyBookmarkBubbleEdits() {
        if (!this.bookmarkBubbleState || !this.hostedBookmarkBubble) {
            return;
        }

        const bookmark = this.findBookmarkById(this.bookmarkBubbleState.bookmarkId);
        if (!bookmark) {
            return;
        }

        const titleInput = this.hostedBookmarkBubble.querySelector('#bookmarkBubbleTitle');
        if (this.isInputElement(titleInput)) {
            const nextLabel = titleInput.value.trim();
            if (nextLabel) {
                bookmark.label = nextLabel;
            }
        }

        this.moveBookmarkToFolder(bookmark.id, this.bookmarkBubbleState.folderId || 'bookmark-bar-root');
        this.renderBookmarks();
        this.refreshBookmarkStar();
        this.savePersistentState();
    }

    removeBookmarkFromBubble() {
        if (!this.bookmarkBubbleState) {
            return;
        }

        this.detachBookmarkNode(this.bookmarkBubbleState.bookmarkId);
        this.renderBookmarks();
        this.refreshBookmarkStar();
        this.savePersistentState();
        this.closeBookmarkBubble({ applyEdits: false });
    }

    clearOpenBookmarkTriggers() {
        this.bookmarkBar?.querySelectorAll('.is-menu-open').forEach((button) => {
            button.classList.remove('is-menu-open');
        });
    }

    // ─── Local chrome:// pages ───

    renderLocalPage(address) {
        this.pageHost.innerHTML = this.renderLocalPageMarkup(address);
        this.pageHost.scrollTop = 0;
        this.hydrateLocalPage(address);
        const activeTab = this.getActiveTab();
        if (activeTab && activeTab.address === address) {
            activeTab.localPreviewMarkup = this.pageHost.innerHTML;
            activeTab.localPreviewWidth = this.pageHost.clientWidth || 980;
            this.storeLocalHistoryPreview(activeTab, address);
            this.applyTabZoom(activeTab);
            this.updateZoomUi();
        }
    }

    renderCurrentLocalPage() {
        const activeTab = this.getActiveTab();
        if (!activeTab || !activeTab.isLocal) {
            return;
        }

        this.renderLocalPage(activeTab.address);
    }

    hydrateLocalPage(address) {
        if (address === 'chrome://downloads/') {
            this.applyDownloadsFilter();
        } else if (address === 'chrome://history/') {
            this.applyHistoryFilter();
        }
    }

    getLocalPageTitle(address) {
        const titles = {
            'chrome://newtab/': 'New Tab',
            'chrome://welcome/': 'About Google Chrome Beta',
            'chrome://about/': 'About Chrome',
            'chrome://version/': 'About Version',
            'chrome://downloads/': 'Downloads',
            'chrome://bookmarks/': 'Bookmarks',
            'chrome://settings/': 'Settings',
            'chrome://settings/searchEngines/': 'Search engines',
            'chrome://history/': 'History',
            'chrome://extensions/': 'Extensions',
            'chrome://flags/': 'Experiments'
        };
        return titles[address] || BASE_TITLE;
    }

    getAssetUrl(relativePath) {
        return new URL(relativePath, window.location.href).toString();
    }

    getDefaultFaviconPath() {
        return 'assets/chrome43/default_favicon.png';
    }

    getDefaultFaviconUrl() {
        return this.getAssetUrl(this.getDefaultFaviconPath());
    }

    getLocalPageFaviconPath(address) {
        const faviconMap = {
            'chrome://downloads/': 'assets/chrome43/favicon_downloads.png',
            'chrome://bookmarks/': 'assets/chrome43/favicon_bookmarks.png',
            'chrome://settings/': 'assets/chrome43/favicon_settings.png',
            'chrome://settings/searchEngines/': 'assets/chrome43/favicon_settings.png',
            'chrome://history/': 'assets/chrome43/favicon_history.png',
            'chrome://extensions/': 'assets/chrome43/favicon_extensions.png',
            'chrome://flags/': 'assets/chrome43/favicon_flags.png',
            'chrome://about/': 'assets/chrome43/chrome_beta_logo_16.png',
            'chrome://version/': 'assets/chrome43/chrome_beta_logo_16.png',
            'chrome://welcome/': 'assets/chrome43/chrome_beta_logo_16.png'
        };

        return faviconMap[address] || null;
    }

    getLocalPageFaviconUrl(address) {
        const path = this.getLocalPageFaviconPath(address);
        return path ? this.getAssetUrl(path) : null;
    }

    getTabFaviconUrl(tab) {
        if (!tab) {
            return null;
        }

        if (tab.faviconUrl) {
            return tab.faviconUrl;
        }

        if (tab.isLocal) {
            return this.getLocalPageFaviconUrl(tab.address);
        }

        return this.getDefaultFaviconUrl();
    }

    getFaviconFromAddress(address, bookmarks = this.bookmarks) {
        const normalized = this.normalizeAddress(address || '');
        if (!normalized) {
            return null;
        }

        const openTab = this.tabs.find((tab) => tab.address === normalized);
        if (openTab?.faviconUrl) {
            return openTab.faviconUrl;
        }

        if (this.isLocalAddress(normalized)) {
            return this.getLocalPageFaviconUrl(normalized);
        }

        for (const bookmark of bookmarks) {
            if (bookmark.type === 'url' && bookmark.address === normalized && bookmark.faviconUrl) {
                return bookmark.faviconUrl;
            }

            if (bookmark.type === 'folder' && Array.isArray(bookmark.children)) {
                const nestedFavicon = this.getFaviconFromAddress(normalized, bookmark.children);
                if (nestedFavicon) {
                    return nestedFavicon;
                }
            }
        }

        return null;
    }

    getBookmarkIconStyle(bookmark) {
        if (!bookmark || bookmark.type !== 'url' || !bookmark.address) {
            return '';
        }

        const iconUrl = bookmark.faviconUrl || this.getLocalPageFaviconUrl(bookmark.address) || this.getDefaultFaviconUrl();
        if (!iconUrl) {
            return '';
        }

        return `style="background-image:url('${this.escapeHtml(iconUrl)}')"`;
    }

    renderLocalPageMarkup(address) {
        switch (address) {
            case 'chrome://downloads/':
                return this.renderDownloadsPage();
            case 'chrome://bookmarks/':
                return this.renderBookmarkManagerPage();
            case 'chrome://history/':
                return this.renderHistoryPage();
            case 'chrome://extensions/':
                return this.renderExtensionsPage();
            case 'chrome://flags/':
                return this.renderFlagsPage();
            case 'chrome://about/':
                return this.renderAboutPage();
            case 'chrome://version/':
                return this.renderVersionPage();
            case 'chrome://settings/searchEngines/':
                return this.renderSearchEnginesPage();
            case 'chrome://settings/':
                return this.renderSettingsPage();
            case 'chrome://welcome/':
                return this.renderVersionPage();
            case 'chrome://newtab/':
            default:
                return this.renderNewTabPage();
        }
    }

    renderAboutPage() {
        return `
            <section class="chrome-page chrome-page--about">
                <div class="chrome-settings-shell">
                    <aside class="chrome-settings-sidebar" aria-label="Chrome pages">
                        <h1>Chrome</h1>
                        <ul class="chrome-settings-sidebar-list">
                            <li><button type="button" data-action="show-history">History</button></li>
                            <li><button type="button" data-action="show-extensions">Extensions</button></li>
                            <li><button type="button" data-action="show-settings">Settings</button></li>
                            <li class="selected"><button type="button">Help</button></li>
                        </ul>
                    </aside>

                    <div class="chrome-webui chrome-webui--about">
                        <header class="chrome-settings-page-header">
                            <h1>About Chrome</h1>
                        </header>

                        <div class="chrome-about-page">
                            <div class="chrome-about-hero">
                                <img src="${this.escapeHtml(this.getAssetUrl('assets/chrome43/chrome_beta_logo_32.png'))}" alt="Chrome logo">
                                <div class="chrome-about-hero-copy">
                                    <h2>Google Chrome Beta</h2>
                                    <div>Google Chrome Beta is made possible by the Chromium open source project and other open source software.</div>
                                </div>
                            </div>

                            <div class="chrome-about-actions">
                                <button class="chrome-settings-action" type="button" disabled>Get help with Chrome</button>
                                <button class="chrome-settings-action" type="button" disabled>Report an issue</button>
                            </div>

                            <div class="chrome-about-version">
                                <div class="chrome-about-version-row">
                                    <span class="chrome-about-version-label">Version</span>
                                    <button type="button" class="chrome-inline-link" data-address="chrome://version/">43.0.2357.62 beta-mock</button>
                                </div>
                                <div class="chrome-about-version-row">
                                    <span class="chrome-about-version-label">Updates</span>
                                    <span class="chrome-about-version-copy">Google Chrome Beta is up to date.</span>
                                </div>
                            </div>

                            <div class="chrome-about-footer">
                                <div>Google Chrome Beta</div>
                                <div>Copyright 2026 The Chromium Authors. All rights reserved.</div>
                                <div class="chrome-about-footer-links">
                                    <button type="button" class="chrome-inline-link" data-address="chrome://history/">History</button>
                                    <button type="button" class="chrome-inline-link" data-address="chrome://bookmarks/">Bookmarks</button>
                                    <button type="button" class="chrome-inline-link" data-address="chrome://downloads/">Downloads</button>
                                    <button type="button" class="chrome-inline-link" data-address="chrome://flags/">Experiments</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>
        `;
    }

    renderVersionPage() {
        const versionRows = [
            ['Google Chrome Beta', '43.0.2357.62 beta-mock (Official Build) dev 64-bit'],
            ['Revision', 'a91d2f4d3f-ui-recreation'],
            ['OS', 'Windows 9 Pro'],
            ['Blink', '537.36 (@188492)'],
            ['JavaScript', 'V8 4.3.61.36'],
            ['Flash', '18.0.0.160'],
            ['User Agent', 'Mozilla/5.0 (Windows NT 6.3; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/43.0.2357.62 Safari/537.36'],
            ['Command Line', '--simulate-windows9-shell --chrome-beta-classic'],
            ['Executable Path', 'C:\\Program Files\\Google\\Chrome Beta\\Application\\chrome.exe'],
            ['Profile Path', 'C:\\Users\\futur\\AppData\\Local\\Google\\Chrome Beta\\User Data\\Default']
        ];

        return `
            <section class="chrome-page chrome-page--version">
                <div class="chrome-version-outer">
                    <div class="chrome-version-logo">
                        <img src="${this.escapeHtml(this.getAssetUrl('assets/chrome43/chrome_beta_logo_256.png'))}" alt="Chrome logo">
                        <div class="chrome-version-company">The Chromium Authors</div>
                        <div class="chrome-version-copyright">Copyright 2026 The Chromium Authors. All rights reserved.</div>
                    </div>

                    <table class="chrome-version-table" cellpadding="0" cellspacing="0">
                        ${versionRows.map(([label, value]) => `
                            <tr>
                                <td class="chrome-version-label">${this.escapeHtml(label)}</td>
                                <td class="chrome-version-value">${this.escapeHtml(value)}</td>
                            </tr>
                        `).join('')}
                    </table>
                </div>
            </section>
        `;
    }

    renderHistoryPage() {
        const query = this.localUiState.historyFilter.trim();
        return `
            <section class="chrome-page chrome-page--history">
                <div class="chrome-settings-shell">
                    <aside class="chrome-settings-sidebar" aria-label="Chrome pages">
                        <h1>Chrome</h1>
                        <ul class="chrome-settings-sidebar-list">
                            <li class="selected"><button type="button">History</button></li>
                            <li><button type="button" data-action="show-extensions">Extensions</button></li>
                            <li><button type="button" data-action="show-settings">Settings</button></li>
                            <li><button type="button" data-action="show-help">Help</button></li>
                        </ul>
                    </aside>

                    <div class="chrome-webui chrome-webui--history">
                        <div class="chrome-history-page">
                            <header class="chrome-history-header">
                                <h1>History</h1>
                                <div class="chrome-history-search">
                                    <input type="search" value="${this.escapeHtml(query)}" placeholder="Search history" data-history-filter>
                                    <input type="submit" value="Search" disabled>
                                </div>
                            </header>

                            <div class="chrome-history-topbar">
                                <div class="chrome-history-editing-controls">
                                    <button type="button" data-action="clear-history">Clear browsing data...</button>
                                    <button type="button" disabled>Remove selected items</button>
                                </div>
                            </div>

                            <div class="chrome-history-results">
                                ${this.renderHistoryGroups()}
                            </div>
                        </div>
                    </div>
                </div>
            </section>
        `;
    }

    renderHistoryGroups() {
        const historyGroups = this.getHistoryGroups();
        return `
            ${historyGroups.map((group) => `
            <section class="chrome-history-group" data-history-group>
                <h3>${this.escapeHtml(group.label)}</h3>
                <div class="chrome-history-entries">
                    ${group.items.map((item) => {
                        const searchText = `${item.title} ${item.domain} ${item.time}`.toLowerCase();
                        const faviconUrl = this.getLocalPageFaviconUrl(item.address) ||
                            this.getFaviconFromAddress(item.address) ||
                            this.getDefaultFaviconUrl();
                        const iconMarkup = faviconUrl
                            ? `<img class="chrome-history-entry-favicon" src="${this.escapeHtml(faviconUrl)}" alt="">`
                            : `<span class="chrome-history-entry-favicon chrome-history-entry-favicon--fallback" aria-hidden="true"></span>`;
                        return `
                            <label class="chrome-history-entry" data-history-search="${this.escapeHtml(searchText)}">
                                <input type="checkbox">
                                <span class="chrome-history-gap" aria-hidden="true"></span>
                                ${iconMarkup}
                                <span class="chrome-history-entry-main">
                                    <button type="button" class="chrome-history-entry-title" data-address="${item.address}">${this.escapeHtml(item.title)}</button>
                                    <span class="chrome-history-entry-domain">${this.escapeHtml(item.domain)}</span>
                                </span>
                                <span class="chrome-history-entry-time">${this.escapeHtml(item.time)}</span>
                            </label>
                        `;
                    }).join('')}
                </div>
            </section>
            `).join('')}
            <div class="chrome-history-empty" hidden data-history-empty>
                <h2>No matching history entries</h2>
                <p>Try a different search term.</p>
            </div>
        `;
    }

    renderBookmarkManagerPage() {
        const filter = this.localUiState.bookmarkManagerFilter.trim();
        const selectedFolderId = this.getValidBookmarkManagerFolderId();
        const listMarkup = filter
            ? this.renderBookmarkManagerSearchResults(filter)
            : this.renderBookmarkManagerFolderItems(selectedFolderId);

        return `
            <section class="chrome-page chrome-page--bookmarks">
                <div class="chrome-bookmark-manager-page">
                    <header class="chrome-bookmark-manager-header">
                        <h1>Bookmarks</h1>
                        <form class="chrome-bookmark-manager-search" data-local-form="bookmark-manager-search" role="search">
                            <input type="search" value="${this.escapeHtml(filter)}" placeholder="Search bookmarks" data-bookmark-manager-filter>
                        </form>
                    </header>

                    <div class="chrome-bookmark-manager-main">
                        <section class="chrome-bookmark-manager-pane chrome-bookmark-manager-pane--tree">
                            <div class="chrome-bookmark-manager-pane-header">
                                <button type="button" class="chrome-bookmark-manager-header-button" data-action="bookmark-manager-folders-menu">Folders</button>
                            </div>
                            <div class="chrome-bookmark-manager-tree" role="tree">
                                ${this.renderBookmarkManagerTree(filter, selectedFolderId)}
                            </div>
                        </section>

                        <div class="chrome-bookmark-manager-splitter" aria-hidden="true"></div>

                        <section class="chrome-bookmark-manager-pane chrome-bookmark-manager-pane--list">
                            <div class="chrome-bookmark-manager-pane-header chrome-bookmark-manager-pane-header--list">
                                <button type="button" class="chrome-bookmark-manager-header-button" data-action="bookmark-manager-organize-menu">Organize</button>
                            </div>
                            <div class="chrome-bookmark-manager-list" role="list">
                                ${listMarkup}
                            </div>
                        </section>
                    </div>

                    <div
                        class="chrome-bookmark-manager-context-menu chrome-hosted-bookmark-context-menu"
                        data-bookmark-manager-context-menu
                        hidden
                    ></div>
                </div>
            </section>
        `;
    }

    getValidBookmarkManagerFolderId() {
        const folderId = this.localUiState.bookmarkManagerFolderId || 'bookmark-bar-root';
        if (folderId === 'bookmark-bar-root') {
            return folderId;
        }

        const folder = this.findBookmarkById(folderId);
        return folder?.type === 'folder' ? folderId : 'bookmark-bar-root';
    }

    renderBookmarkManagerTree(filter, selectedFolderId) {
        const isSearching = !!filter.trim();
        const searchIconUrl = this.escapeHtml(this.getAssetUrl('assets/chrome43/bookmark_manager_search.png'));

        return `
            <button
                type="button"
                class="chrome-bookmark-manager-tree-item ${!isSearching && selectedFolderId === 'bookmark-bar-root' ? 'is-selected' : ''}"
                data-bookmark-manager-folder-id="bookmark-bar-root"
                style="--bookmark-tree-depth:0"
                role="treeitem"
            >
                <span class="chrome-bookmark-manager-tree-icon chrome-bookmark-manager-tree-icon--root" aria-hidden="true"></span>
                <span class="chrome-bookmark-manager-tree-label">Bookmarks bar</span>
            </button>
            ${isSearching ? `
                <button
                    type="button"
                    class="chrome-bookmark-manager-tree-item is-selected"
                    data-bookmark-manager-search-root
                    style="--bookmark-tree-depth:0"
                    role="treeitem"
                >
                    <span class="chrome-bookmark-manager-tree-icon chrome-bookmark-manager-tree-icon--search" aria-hidden="true" style="background-image:url('${searchIconUrl}')"></span>
                    <span class="chrome-bookmark-manager-tree-label">Search</span>
                </button>
            ` : ''}
            ${this.renderBookmarkManagerTreeNodes(this.bookmarks, selectedFolderId, 1)}
        `;
    }

    renderBookmarkManagerTreeNodes(bookmarks, selectedFolderId, depth) {
        return bookmarks
            .filter((bookmark) => bookmark.type === 'folder')
            .map((bookmark) => `
                <button
                    type="button"
                    class="chrome-bookmark-manager-tree-item ${bookmark.id === selectedFolderId ? 'is-selected' : ''}"
                    data-bookmark-manager-folder-id="${bookmark.id}"
                    style="--bookmark-tree-depth:${depth}"
                    role="treeitem"
                >
                    <span class="chrome-bookmark-manager-tree-icon chrome-bookmark-manager-tree-icon--folder" aria-hidden="true"></span>
                    <span class="chrome-bookmark-manager-tree-label">${this.escapeHtml(bookmark.label)}</span>
                </button>
                ${this.renderBookmarkManagerTreeNodes(bookmark.children || [], selectedFolderId, depth + 1)}
            `).join('');
    }

    getBookmarkManagerFolderItems(folderId) {
        if (folderId === 'bookmark-bar-root') {
            return this.bookmarks;
        }

        const folder = this.findBookmarkById(folderId);
        return folder?.type === 'folder' ? (folder.children || []) : this.bookmarks;
    }

    renderBookmarkManagerFolderItems(folderId) {
        const items = this.getBookmarkManagerFolderItems(folderId);
        if (!items.length) {
            return `
                <div class="chrome-bookmark-manager-empty">
                    <h2>This folder is empty</h2>
                    <p>Bookmarks and folders you add will appear here.</p>
                </div>
            `;
        }

        return items.map((bookmark) => this.renderBookmarkManagerListItem(bookmark)).join('');
    }

    collectBookmarkManagerSearchResults(bookmarks = this.bookmarks, results = []) {
        bookmarks.forEach((bookmark) => {
            results.push(bookmark);
            if (bookmark.type === 'folder' && Array.isArray(bookmark.children)) {
                this.collectBookmarkManagerSearchResults(bookmark.children, results);
            }
        });
        return results;
    }

    renderBookmarkManagerSearchResults(filter) {
        const needle = filter.trim().toLowerCase();
        const results = this.collectBookmarkManagerSearchResults()
            .filter((bookmark) => `${bookmark.label} ${bookmark.address || ''}`.toLowerCase().includes(needle));

        if (!results.length) {
            return `
                <div class="chrome-bookmark-manager-empty">
                    <h2>No results</h2>
                    <p>Try a different bookmark name or address.</p>
                </div>
            `;
        }

        return results.map((bookmark) => this.renderBookmarkManagerListItem(bookmark, { searching: true })).join('');
    }

    renderBookmarkManagerListItem(bookmark, options = {}) {
        const isFolder = bookmark.type === 'folder';
        const iconStyle = isFolder ? '' : this.getBookmarkIconStyle(bookmark);
        const meta = isFolder
            ? `${(bookmark.children || []).length} item${(bookmark.children || []).length === 1 ? '' : 's'}`
            : (bookmark.address || '');

        return `
            <button
                type="button"
                class="chrome-bookmark-manager-list-item ${isFolder ? 'is-folder' : 'is-url'}"
                data-bookmark-manager-bookmark-id="${bookmark.id}"
                ${isFolder
                    ? `data-bookmark-manager-folder-id="${bookmark.id}"`
                    : `data-address="${this.escapeHtml(bookmark.address || '')}"`}
                role="listitem"
            >
                <span class="chrome-bookmark-manager-list-icon ${isFolder ? 'is-folder' : ''}" aria-hidden="true" ${iconStyle}></span>
                <span class="chrome-bookmark-manager-list-copy">
                    <span class="chrome-bookmark-manager-list-title">${this.escapeHtml(bookmark.label)}</span>
                    <span class="chrome-bookmark-manager-list-meta">${this.escapeHtml(meta)}</span>
                </span>
                ${isFolder && !options.searching ? '<span class="chrome-bookmark-manager-list-arrow" aria-hidden="true"></span>' : ''}
            </button>
        `;
    }

    renderExtensionsPage() {
        const devMode = this.localUiState.extensionsDeveloperMode;
        return `
            <section class="chrome-page chrome-page--extensions">
                <div class="chrome-settings-shell">
                    <aside class="chrome-settings-sidebar" aria-label="Chrome pages">
                        <h1>Chrome</h1>
                        <ul class="chrome-settings-sidebar-list">
                            <li><button type="button" data-action="show-history">History</button></li>
                            <li class="selected"><button type="button">Extensions</button></li>
                            <li><button type="button" data-action="show-settings">Settings</button></li>
                            <li><button type="button" data-action="show-help">Help</button></li>
                        </ul>
                    </aside>

                    <div class="chrome-webui chrome-webui--extensions">
                        <div class="chrome-extensions-page">
                            <header class="chrome-extensions-header">
                                <h1>Extensions</h1>
                                <div class="chrome-extensions-header-controls">
                                    <label class="chrome-extensions-dev-toggle">
                                        <input type="checkbox" ${devMode ? 'checked' : ''} data-extension-dev-toggle>
                                        <span>Developer mode</span>
                                    </label>
                                </div>
                            </header>

                            <div class="chrome-extensions-dev-controls ${devMode ? 'is-visible' : ''}">
                                <div class="chrome-extensions-dev-buttons">
                                    <button type="button" data-action="load-unpacked-extension">Load unpacked extension...</button>
                                    <button type="button" data-action="pack-extension">Pack extension...</button>
                                    <div class="chrome-extensions-dev-spacer"></div>
                                    <button type="button" data-action="update-extensions-now">Update extensions now</button>
                                </div>
                                <div class="chrome-extensions-promo">
                                    <img src="${this.escapeHtml(this.getAssetUrl('assets/chrome43/apps_developer_tools_promo_48.png'))}" alt="" aria-hidden="true">
                                    <span>Inspect and debug your Chrome Apps with the Chrome Apps Developer Tooling extension.</span>
                                </div>
                            </div>

                            <div class="chrome-extensions-list">
                                ${SAMPLE_EXTENSIONS.map((extension) => this.renderExtensionCard(extension)).join('')}
                            </div>
                        </div>
                    </div>
                </div>
            </section>
        `;
    }

    renderExtensionCard(extension) {
        return `
            <article class="chrome-extension-card ${extension.enabled ? '' : 'is-inactive'}">
                <div class="chrome-extension-icon chrome-extension-icon--${this.escapeHtml(extension.iconType)}" aria-hidden="true"></div>
                <div class="chrome-extension-details">
                    <div class="chrome-extension-heading">
                        <span class="chrome-extension-title">${this.escapeHtml(extension.title)}</span>
                        <span class="chrome-extension-version">${this.escapeHtml(extension.version)}</span>
                    </div>
                    <p class="chrome-extension-description">${this.escapeHtml(extension.description)}</p>
                    <div class="chrome-extension-links">
                        <button type="button" class="chrome-inline-link" data-address="${extension.siteAddress}">${this.escapeHtml(extension.siteLabel)}</button>
                        <button type="button" class="chrome-inline-link" disabled>Options</button>
                        ${extension.unpacked ? '<button type="button" class="chrome-inline-link" disabled>Reload</button>' : ''}
                    </div>
                    <div class="chrome-extension-controls">
                        <label class="chrome-extension-enabled">
                            <input type="checkbox" ${extension.enabled ? 'checked' : ''} disabled>
                            <span>${extension.enabled ? 'Enabled' : 'Enable'}</span>
                        </label>
                    </div>
                </div>
            </article>
        `;
    }

    renderFlagsPage() {
        const supportedFlags = this.localUiState.flagsExperiments.filter((flag) => flag.supported);
        const unsupportedFlags = this.localUiState.flagsExperiments.filter((flag) => !flag.supported);
        return `
            <section class="chrome-page chrome-page--flags">
                <div class="chrome-flags-page">
                    <header class="chrome-flags-header">
                        <div class="chrome-flags-title-spacer">
                            <h1>Experiments</h1>
                        </div>
                    </header>

                    <div class="chrome-flags-blurb">
                        <span class="chrome-flags-warning">WARNING</span>
                        <span>These experimental features may change, break, or disappear at any time. Proceed with caution.</span>
                    </div>

                    <section class="chrome-flags-section">
                        <div class="chrome-flags-section-header">
                            <span class="chrome-flags-section-title">Available experiments</span>
                            <button type="button" data-action="flags-reset-all">Reset all to default</button>
                        </div>
                        <div class="chrome-flags-list">
                            ${supportedFlags.map((flag) => this.renderFlagRow(flag)).join('')}
                        </div>
                    </section>

                    <section class="chrome-flags-section">
                        <div class="chrome-flags-section-header">
                            <span class="chrome-flags-section-title">Unavailable experiments</span>
                        </div>
                        <div class="chrome-flags-list">
                            ${unsupportedFlags.map((flag) => this.renderFlagRow(flag)).join('')}
                        </div>
                    </section>

                    <div class="chrome-flags-restart ${this.localUiState.flagsNeedsRestart ? 'is-visible' : ''}">
                        <div>Your changes will take effect the next time Google Chrome Beta is relaunched.</div>
                        <button type="button" data-action="flags-restart">Relaunch now</button>
                    </div>
                </div>
            </section>
        `;
    }

    renderFlagRow(flag) {
        return `
            <article class="chrome-flag-row ${flag.enabled ? 'is-enabled' : 'is-disabled'} ${flag.supported ? '' : 'is-unsupported'}">
                <div class="chrome-flag-name">${this.escapeHtml(flag.name)}</div>
                <div class="chrome-flag-platforms">${this.escapeHtml(flag.supportedPlatforms.join(', '))}</div>
                <div class="chrome-flag-description">${this.escapeHtml(flag.description)} <span class="chrome-flag-permalink">#${this.escapeHtml(flag.internalName)}</span></div>
                <div class="chrome-flag-actions">
                    ${flag.supported
                        ? `<button type="button" class="chrome-inline-link" data-action="toggle-flag" data-flag-name="${this.escapeHtml(flag.internalName)}">${flag.enabled ? 'Disable' : 'Enable'}</button>`
                        : '<span>Not supported on this platform.</span>'}
                </div>
            </article>
        `;
    }

    serializeDownloadItem(download) {
        if (!download || typeof download !== 'object') {
            return null;
        }

        return {
            id: download.id || '',
            downloadId: download.downloadId || '',
            name: download.name || 'Download',
            address: download.address || '',
            domain: download.domain || '',
            size: download.size || '',
            status: download.status || '',
            kind: download.kind || 'file',
            period: download.period || '',
            stamp: download.stamp || '',
            state: download.state || 'completed',
            startedAt: download.startedAt || '',
            updatedAt: download.updatedAt || '',
            filePath: download.filePath || '',
            receivedBytes: Number(download.receivedBytes) || 0,
            totalBytes: Number(download.totalBytes) || 0,
            percentComplete: Number.isFinite(Number(download.percentComplete)) ? Number(download.percentComplete) : -1,
            mimeType: download.mimeType || '',
            shelfVisible: !!download.shelfVisible,
            dismissedFromShelf: !!download.dismissedFromShelf
        };
    }

    normalizeStoredDownloadItem(item = {}) {
        const startedAt = item.startedAt || item.updatedAt || new Date().toISOString();
        const normalized = {
            id: item.id || item.downloadId || `download-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            downloadId: item.downloadId || item.id || '',
            name: item.name || 'Download',
            address: item.address || '',
            domain: item.domain || this.getHistoryDomainFromAddress(item.address || '') || '',
            kind: item.kind || 'file',
            state: item.state || (String(item.status || '').toLowerCase() === 'completed' ? 'completed' : 'in-progress'),
            startedAt,
            updatedAt: item.updatedAt || startedAt,
            filePath: item.filePath || '',
            receivedBytes: Math.max(0, Number(item.receivedBytes) || 0),
            totalBytes: Math.max(0, Number(item.totalBytes) || 0),
            percentComplete: Number.isFinite(Number(item.percentComplete)) ? Number(item.percentComplete) : -1,
            mimeType: item.mimeType || '',
            shelfVisible: typeof item.shelfVisible === 'boolean' ? item.shelfVisible : false,
            dismissedFromShelf: !!item.dismissedFromShelf
        };

        normalized.period = item.period || this.formatDownloadPeriod(startedAt);
        normalized.stamp = item.stamp || this.formatDownloadStamp(startedAt);
        normalized.size = item.size || this.getDownloadSizeText(normalized);
        normalized.status = item.status || this.getDownloadStatusText(normalized);
        return normalized;
    }

    isTerminalDownloadState(state) {
        return state === 'completed' || state === 'cancelled' || state === 'interrupted';
    }

    formatByteCount(bytes) {
        const numericValue = Number(bytes);
        if (!Number.isFinite(numericValue) || numericValue <= 0) {
            return '0 B';
        }

        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let value = numericValue;
        let unitIndex = 0;
        while (value >= 1024 && unitIndex < units.length - 1) {
            value /= 1024;
            unitIndex += 1;
        }

        const digits = value >= 100 || unitIndex === 0 ? 0 : value >= 10 ? 1 : 1;
        return `${value.toFixed(digits).replace(/\.0$/, '')} ${units[unitIndex]}`;
    }

    formatDownloadPeriod(value) {
        const date = new Date(value);
        if (Number.isNaN(date.valueOf())) {
            return 'Today';
        }

        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        const diffDays = Math.round((startOfToday - startOfDate) / 86400000);

        if (diffDays <= 0) {
            return 'Today';
        }

        if (diffDays === 1) {
            return 'Yesterday';
        }

        if (diffDays < 7) {
            return 'Earlier this week';
        }

        return date.toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric'
        });
    }

    formatDownloadStamp(value) {
        const date = new Date(value);
        if (Number.isNaN(date.valueOf())) {
            return '';
        }

        return date.toLocaleTimeString(undefined, {
            hour: 'numeric',
            minute: '2-digit'
        });
    }

    getDownloadStatusText(download) {
        switch (download.state) {
            case 'completed':
                return 'Completed';
            case 'paused':
                return 'Paused';
            case 'cancelled':
                return 'Cancelled';
            case 'interrupted':
                return 'Interrupted';
            default:
                return download.totalBytes > 0
                    ? `${Math.max(0, Math.round(download.percentComplete >= 0 ? download.percentComplete : (download.receivedBytes / download.totalBytes) * 100))}%`
                    : 'Downloading...';
        }
    }

    getDownloadSizeText(download) {
        if (!download) {
            return '';
        }

        if (download.totalBytes > 0 && !this.isTerminalDownloadState(download.state)) {
            return `${this.formatByteCount(download.receivedBytes)} of ${this.formatByteCount(download.totalBytes)}`;
        }

        if (download.totalBytes > 0) {
            return this.formatByteCount(download.totalBytes);
        }

        if (download.receivedBytes > 0) {
            return this.formatByteCount(download.receivedBytes);
        }

        return download.size || '';
    }

    findDownloadItemById(downloadId) {
        return this.downloadItems.find((item) => item.downloadId === downloadId || item.id === downloadId) || null;
    }

    isDownloadsPageActive() {
        return this.getActiveTab()?.address === 'chrome://downloads/';
    }

    refreshDownloadViews() {
        this.renderDownloadShelf();
        if (this.isDownloadsPageActive()) {
            this.renderCurrentLocalPage();
        }
        this.savePersistentState();
    }

    buildDownloadEventKey(payload) {
        if (!payload || !payload.downloadId) {
            return '';
        }

        return [
            payload.downloadId,
            payload.type || '',
            payload.state || '',
            Number(payload.receivedBytes) || 0,
            Number(payload.totalBytes) || 0
        ].join(':');
    }

    processDownloadEventPayload(payload) {
        const eventKey = this.buildDownloadEventKey(payload);
        if (!eventKey) {
            return;
        }

        if (this.recentDownloadEventKeys.includes(eventKey)) {
            return;
        }

        this.recentDownloadEventKeys.push(eventKey);
        if (this.recentDownloadEventKeys.length > 24) {
            this.recentDownloadEventKeys = this.recentDownloadEventKeys.slice(-24);
        }

        this.handleDownloadEvent(payload);
    }

    enqueueDownloadPrompt(download) {
        if (!download?.downloadId) {
            return;
        }

        const existingIndex = this.pendingDownloadPrompts.findIndex((item) => item.downloadId === download.downloadId);
        if (existingIndex !== -1) {
            this.pendingDownloadPrompts.splice(existingIndex, 1, download);
        } else if (!this.activeDownloadPrompt || this.activeDownloadPrompt.downloadId !== download.downloadId) {
            this.pendingDownloadPrompts.push(download);
        }

        if (!this.activeDownloadPrompt) {
            this.showNextDownloadPrompt();
        }
    }

    showNextDownloadPrompt() {
        if (this.activeDownloadPrompt || !this.pendingDownloadPrompts.length) {
            return;
        }

        const nextPrompt = this.pendingDownloadPrompts.shift();
        if (!nextPrompt) {
            return;
        }

        this.showDownloadPrompt(nextPrompt);
    }

    showDownloadPrompt(download) {
        if (!this.hostedDownloadPrompt || !download) {
            return;
        }

        this.closeBookmarkBubble({ applyEdits: true });
        this.closeBookmarkPopup();
        this.closeBookmarkContextMenu();
        this.closeTabContextMenu();
        this.closeBookmarkEditor();
        this.closeWebviewContextMenu();
        this.setMenuOpen(false);

        this.activeDownloadPrompt = download;
        const defaultFolder = 'Downloads';

        this.hostedDownloadPrompt.innerHTML = `
            <div class="chrome-download-prompt-scrim" data-download-prompt-action="cancel"></div>
            <div class="chrome-download-prompt-dialog" role="dialog" aria-modal="true" aria-labelledby="chromeDownloadPromptTitle">
                <div class="chrome-download-prompt-title" id="chromeDownloadPromptTitle">File Download</div>
                <div class="chrome-download-prompt-body">
                    <p>Do you want to save this file?</p>
                    <div class="chrome-download-prompt-file">${this.escapeHtml(download.name)}</div>
                    <div class="chrome-download-prompt-meta">From: ${this.escapeHtml(download.domain || this.getHistoryDomainFromAddress(download.address) || download.address || 'Unknown source')}</div>
                    <div class="chrome-download-prompt-meta">Save to: ${this.escapeHtml(defaultFolder)}</div>
                </div>
                <div class="chrome-download-prompt-actions">
                    <button class="chrome-bookmark-bubble-button" type="button" data-download-prompt-action="cancel">Cancel</button>
                    <button class="chrome-bookmark-bubble-button chrome-bookmark-bubble-button--default" type="button" data-download-prompt-action="save">Save</button>
                </div>
            </div>
        `;

        this.hostedDownloadPrompt.hidden = false;
        this.hostWindow?.classList.add('is-download-prompt-open');
    }

    closeDownloadPrompt() {
        if (this.hostedDownloadPrompt) {
            this.hostedDownloadPrompt.hidden = true;
            this.hostedDownloadPrompt.innerHTML = '';
        }

        this.hostWindow?.classList.remove('is-download-prompt-open');
        this.activeDownloadPrompt = null;
    }

    async handleDownloadPromptAction(action) {
        const prompt = this.activeDownloadPrompt;
        if (!prompt?.downloadId) {
            this.closeDownloadPrompt();
            this.showNextDownloadPrompt();
            return;
        }

        if (action === 'cancel') {
            const result = await this.performDownloadAction('cancel', prompt.downloadId);
            if (result?.download) {
                this.processDownloadEventPayload({
                    type: 'done',
                    ...result.download
                });
            }
            this.closeDownloadPrompt();
            this.showNextDownloadPrompt();
            return;
        }

        if (action === 'save') {
            const result = await this.performDownloadAction('accept-save', prompt.downloadId);
            if (result?.success && result.download) {
                this.processDownloadEventPayload({
                    type: 'accepted',
                    ...result.download
                });
            } else if (!result?.success) {
                this.showStatus(result?.error || 'Unable to save download.', true);
            }

            this.closeDownloadPrompt();
            this.showNextDownloadPrompt();
        }
    }

    handleDownloadEvent(payload) {
        if (!payload || typeof payload !== 'object' || !payload.downloadId) {
            return;
        }

        const existing = this.findDownloadItemById(payload.downloadId);
        const nextRecord = this.normalizeStoredDownloadItem({
            ...(existing || {}),
            id: existing?.id || payload.downloadId,
            downloadId: payload.downloadId,
            name: payload.name || existing?.name || 'Download',
            address: payload.address || existing?.address || '',
            domain: payload.domain || existing?.domain || this.getHistoryDomainFromAddress(payload.address || '') || '',
            kind: payload.kind || existing?.kind || 'file',
            state: payload.state || existing?.state || 'in-progress',
            startedAt: payload.startedAt || existing?.startedAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            filePath: payload.filePath || existing?.filePath || '',
            receivedBytes: Number(payload.receivedBytes) || 0,
            totalBytes: Number(payload.totalBytes) || 0,
            percentComplete: Number.isFinite(Number(payload.percentComplete)) ? Number(payload.percentComplete) : (existing?.percentComplete ?? -1),
            mimeType: payload.mimeType || existing?.mimeType || '',
            shelfVisible: payload.type === 'prompt' || payload.state === 'pending'
                ? false
                : (typeof existing?.shelfVisible === 'boolean' ? existing.shelfVisible : true),
            dismissedFromShelf: payload.type === 'prompt' || payload.state === 'pending'
                ? false
                : false
        });

        if (!existing) {
            this.downloadItems.unshift(nextRecord);
        } else {
            const index = this.downloadItems.findIndex((item) => item.id === existing.id);
            if (index !== -1) {
                this.downloadItems.splice(index, 1, nextRecord);
            }
        }

        if (payload.type === 'prompt' || payload.state === 'pending') {
            this.savePersistentState();
            this.enqueueDownloadPrompt(nextRecord);
            return;
        }

        if (existing?.state === 'pending' && payload.type === 'updated' && payload.state === 'paused') {
            this.savePersistentState();
            return;
        }

        if (payload.type === 'created') {
            this.showStatus(`Downloading ${nextRecord.name}`, true);
        } else if (payload.type === 'accepted') {
            nextRecord.shelfVisible = true;
            nextRecord.dismissedFromShelf = false;
            this.showStatus(`Downloading ${nextRecord.name}`, true);
        } else if (payload.type === 'done') {
            if (nextRecord.state === 'completed') {
                this.showStatus(`Downloaded ${nextRecord.name}`, true);
            } else if (nextRecord.state === 'cancelled') {
                nextRecord.shelfVisible = false;
                nextRecord.dismissedFromShelf = true;
                this.showStatus(`Cancelled ${nextRecord.name}`, true);
            } else if (nextRecord.state === 'interrupted') {
                this.showStatus(`Download interrupted: ${nextRecord.name}`, true);
            }
        }

        this.refreshDownloadViews();
    }

    getVisibleShelfDownloads() {
        return this.downloadItems
            .filter((item) => item.shelfVisible && !item.dismissedFromShelf)
            .slice(0, 15);
    }

    getDownloadShelfKindLabel(kind) {
        const normalizedKind = String(kind || 'file').toLowerCase();
        const labels = {
            file: 'DOC',
            exe: 'EXE',
            image: 'IMG',
            pdf: 'PDF',
            archive: 'ZIP',
            audio: 'AUD',
            video: 'VID'
        };

        return labels[normalizedKind] || normalizedKind.slice(0, 3).toUpperCase();
    }

    renderDownloadShelfItem(download) {
        const percent = download.totalBytes > 0
            ? Math.max(0, Math.min(100, Math.round(download.percentComplete >= 0 ? download.percentComplete : (download.receivedBytes / download.totalBytes) * 100)))
            : -1;
        const itemClasses = [
            'chrome-download-shelf-item',
            `is-${this.escapeHtml(download.state || 'completed')}`
        ].join(' ');
        const canOpenDownloadedFile = download.state === 'completed' && !!download.filePath;
        const primaryAction = canOpenDownloadedFile ? 'open-download' : 'show-downloads';

        return `
            <div class="${itemClasses}" data-download-id="${this.escapeHtml(download.downloadId || download.id)}">
                <div class="chrome-download-shelf-button-row">
                    <button type="button" class="chrome-download-shelf-main" data-download-action="${primaryAction}" data-download-id="${this.escapeHtml(download.downloadId || download.id)}">
                        <span class="chrome-download-shelf-icon chrome-download-shelf-icon--${this.escapeHtml(download.kind || 'file')}" aria-hidden="true">${this.escapeHtml(this.getDownloadShelfKindLabel(download.kind))}</span>
                        <span class="chrome-download-shelf-copy">
                            <span class="chrome-download-shelf-name">${this.escapeHtml(download.name)}</span>
                            <span class="chrome-download-shelf-status">${this.escapeHtml(download.status)}</span>
                        </span>
                    </button>
                    <button type="button" class="chrome-download-shelf-menu" data-download-action="show-downloads" data-download-id="${this.escapeHtml(download.downloadId || download.id)}" aria-label="Download options"></button>
                </div>
                <div class="chrome-download-shelf-progress ${percent >= 0 && !this.isTerminalDownloadState(download.state) ? '' : 'is-hidden'}" aria-hidden="true">
                    <span class="chrome-download-shelf-progress-value" style="width:${Math.max(0, percent)}%"></span>
                </div>
            </div>
        `;
    }

    renderDownloadShelf() {
        if (!this.hostedDownloadShelf) {
            return;
        }

        const downloads = this.getVisibleShelfDownloads();
        if (!downloads.length) {
            this.hostedDownloadShelf.hidden = true;
            this.hostedDownloadShelf.innerHTML = '';
            window.requestAnimationFrame(() => this.syncWebviewOffset());
            return;
        }

        this.hostedDownloadShelf.innerHTML = `
            <div class="chrome-download-shelf-inner">
                <div class="chrome-download-shelf-items">
                    ${downloads.map((download) => this.renderDownloadShelfItem(download)).join('')}
                </div>
                <div class="chrome-download-shelf-controls">
                    <span class="chrome-download-shelf-summary" aria-hidden="true">
                        <span class="chrome-download-shelf-summary-icon"></span>
                        <button type="button" class="chrome-download-shelf-link chrome-download-shelf-show-all" data-download-action="show-downloads">Show all downloads</button>
                    </span>
                    <button type="button" class="chrome-download-shelf-close" aria-label="Close download shelf" data-download-action="close-download-shelf"></button>
                </div>
            </div>
        `;
        this.hostedDownloadShelf.hidden = false;
        window.requestAnimationFrame(() => this.syncWebviewOffset());
    }

    async performDownloadAction(action, downloadId = '') {
        const topWindow = window.top || window.parent || window;
        if (typeof topWindow.performChromeBetaDownloadAction === 'function') {
            return topWindow.performChromeBetaDownloadAction({ action, downloadId });
        }

        if (electronIpc && typeof electronIpc.invoke === 'function') {
            return electronIpc.invoke('chrome-beta:download-action', { action, downloadId });
        }

        return { success: false, error: 'Download actions are unavailable.' };
    }

    async handleDownloadShelfClick(event) {
        const target = event.target.closest('[data-download-action]');
        if (!target) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        const action = target.getAttribute('data-download-action') || '';
        const downloadId = target.getAttribute('data-download-id') || '';
        const download = this.findDownloadItemById(downloadId);

        switch (action) {
            case 'show-downloads':
                this.navigateCurrentTab('chrome://downloads/');
                return;
            case 'close-download-shelf':
                this.getVisibleShelfDownloads().forEach((item) => {
                    item.dismissedFromShelf = true;
                });
                this.renderDownloadShelf();
                this.savePersistentState();
                return;
            case 'dismiss-download':
                if (download) {
                    download.dismissedFromShelf = true;
                    download.shelfVisible = false;
                    this.refreshDownloadViews();
                }
                return;
            case 'open-download':
                if (!download) {
                    return;
                }
                if (download.state === 'completed') {
                    const result = await this.performDownloadAction('open', downloadId);
                    if (!result?.success) {
                        this.showStatus(result?.error || 'Unable to open download.', true);
                    }
                } else {
                    this.navigateCurrentTab('chrome://downloads/');
                }
                return;
            case 'show-in-folder':
                if (!download) {
                    return;
                }
                {
                    const result = await this.performDownloadAction('show-in-folder', downloadId);
                    if (!result?.success) {
                        this.showStatus(result?.error || 'Unable to show download in folder.', true);
                    }
                }
                return;
            case 'pause-download':
                {
                    const result = await this.performDownloadAction('pause', downloadId);
                    if (!result?.success) {
                        this.showStatus(result?.error || 'Unable to pause download.', true);
                    }
                }
                return;
            case 'resume-download':
                {
                    const result = await this.performDownloadAction('resume', downloadId);
                    if (!result?.success) {
                        this.showStatus(result?.error || 'Unable to resume download.', true);
                    }
                }
                return;
            case 'cancel-download':
                {
                    const result = await this.performDownloadAction('cancel', downloadId);
                    if (!result?.success) {
                        this.showStatus(result?.error || 'Unable to cancel download.', true);
                    }
                }
                return;
            default:
                break;
        }
    }

    renderDownloadsPage() {
        const hasDownloads = this.downloadItems.length > 0;
        return `
            <section class="chrome-page chrome-page--downloads">
                <div class="chrome-webui chrome-webui--downloads">
                    <header class="chrome-webui-header">
                        <h1>Downloads</h1>
                        <div class="chrome-webui-search">
                            <input type="search" placeholder="Search downloads" value="${this.escapeHtml(this.localUiState.downloadsFilter)}" data-downloads-filter>
                        </div>
                    </header>

                    <div class="chrome-downloads-summary">
                        <span class="chrome-downloads-summary-text">${hasDownloads ? `${this.downloadItems.length} recent downloads` : 'No downloads'}</span>
                        <span class="chrome-downloads-summary-actions">
                            <button class="chrome-inline-link" type="button" data-action="open-downloads-folder">Open downloads folder</button>
                            <button class="chrome-inline-link" type="button" data-action="clear-downloads" ${hasDownloads ? '' : 'disabled'}>Clear all</button>
                        </span>
                    </div>

                    <div class="chrome-downloads-pane">
                        ${hasDownloads ? this.renderDownloadItems() : `
                            <div class="chrome-downloads-empty">
                                <h2>No recent downloads</h2>
                                <p>Downloaded files will appear here once this browser starts saving them.</p>
                            </div>
                        `}
                    </div>
                </div>
            </section>
        `;
    }

    renderNewTabPage() {
        const hiddenTiles = new Set(this.localUiState.hiddenNtpTileAddresses);
        const isIconNtp = this.isFlagEnabled('enable-icon-ntp');
        const tilesMarkup = MOST_VISITED_TILES.filter((tile) => !hiddenTiles.has(tile.address)).map((tile) => {
            const faviconUrl = tile.faviconUrl || this.getLocalPageFaviconUrl(tile.address) ||
                this.getAssetUrl(isIconNtp ? 'assets/chrome49/ntp_default_favicon.png' : 'assets/chrome43/ntp_default_favicon.png');

            if (isIconNtp) {
                return `
                    <button class="chrome-ntp-tile chrome-ntp-tile--icon ${tile.accentClass}" type="button" data-address="${tile.address}" title="${this.escapeHtml(tile.title)}">
                        <span class="chrome-ntp-tile-icon" aria-hidden="true">
                            <img class="chrome-ntp-tile-icon-image" src="${this.escapeHtml(faviconUrl)}" alt="">
                        </span>
                        <span class="chrome-ntp-tile-title">${this.escapeHtml(tile.title)}</span>
                        <span class="chrome-ntp-tile-close" aria-hidden="true"></span>
                    </button>
                `;
            }

            return `
                <button class="chrome-ntp-tile ${tile.accentClass}" type="button" data-address="${tile.address}" title="${this.escapeHtml(tile.title)}">
                    <span class="chrome-ntp-tile-favicon" aria-hidden="true">
                        <img class="chrome-ntp-tile-favicon-image" src="${this.escapeHtml(faviconUrl)}" alt="">
                    </span>
                    <span class="chrome-ntp-tile-title">${this.escapeHtml(tile.title)}</span>
                    <span class="chrome-ntp-tile-thumb" aria-hidden="true">
                        <span class="chrome-ntp-tile-preview">
                            <span class="chrome-ntp-tile-preview-top"></span>
                            <span class="chrome-ntp-tile-preview-body">
                                <span class="chrome-ntp-tile-preview-badge">${this.escapeHtml(tile.badge)}</span>
                                <span class="chrome-ntp-tile-preview-lines">
                                    <span></span>
                                    <span></span>
                                    <span></span>
                                </span>
                            </span>
                        </span>
                    </span>
                    <span class="chrome-ntp-tile-close" aria-hidden="true"></span>
                </button>
            `;
        }).join('');

        const fakeboxState = this.localUiState.ntpFakeboxState;
        const fakeboxClasses = [
            'chrome-ntp-fakebox',
            fakeboxState === 'focused' ? 'is-focused' : '',
            fakeboxState === 'drag-focused' ? 'is-drag-focused' : ''
        ].filter(Boolean).join(' ');
        const shellClasses = [
            'chrome-ntp-shell',
            isIconNtp ? 'is-icon-ntp' : 'is-thumb-ntp'
        ].join(' ');

        return `
            <section class="chrome-page chrome-page--ntp">
                <div class="${shellClasses}">
                    <div class="chrome-ntp-logo" aria-label="Google"></div>

                    <div class="${fakeboxClasses}" data-action="focus-omnibox">
                        <div class="chrome-ntp-fakebox-text">Search ${this.escapeHtml(this.getSearchEngineLabel())} or type URL</div>
                        <input type="url" tabindex="-1" aria-hidden="true" autocomplete="off">
                        <div class="chrome-ntp-fakebox-cursor" aria-hidden="true"></div>
                    </div>

                    <div class="chrome-ntp-shortcuts">
                        ${tilesMarkup}
                    </div>
                </div>
            </section>
        `;
    }

    blacklistNtpTile(address) {
        if (!address || this.localUiState.hiddenNtpTileAddresses.includes(address)) {
            return;
        }

        const tile = this.pageHost.querySelector(`.chrome-ntp-tile[data-address="${CSS.escape(address)}"]`);
        if (this.isHtmlElement(tile)) {
            tile.classList.add('is-blacklisting');
        }

        window.setTimeout(() => {
            if (!this.localUiState.hiddenNtpTileAddresses.includes(address)) {
                this.localUiState.hiddenNtpTileAddresses = [
                    ...this.localUiState.hiddenNtpTileAddresses,
                    address
                ];
            }
            this.renderCurrentLocalPage();
            this.showStatus('Thumbnail removed from the new tab page.', true);
        }, 200);
    }

    // ─── Window title ───

    renderSettingsPage() {
        const settings = this.localUiState.settings;
        const startupPages = settings.startupPages || [];
        const homePageUrl = this.escapeHtml(settings.homePageUrl || HOME_URL);
        return `
            <section class="chrome-page chrome-page--settings">
                <div class="chrome-settings-shell">
                    <aside class="chrome-settings-sidebar" aria-label="Chrome pages">
                        <h1>Chrome</h1>
                        <ul class="chrome-settings-sidebar-list">
                            <li><button type="button" data-action="show-history">History</button></li>
                            <li><button type="button" data-action="show-extensions">Extensions</button></li>
                            <li class="selected"><button type="button">Settings</button></li>
                            <li><button type="button" data-action="show-help">Help</button></li>
                        </ul>
                    </aside>

                    <div class="chrome-webui chrome-webui--settings">
                        <header class="chrome-settings-page-header">
                            <h1>Settings</h1>
                        </header>

                        <div class="chrome-settings-page-body">
                            <section class="chrome-settings-section" id="settings-startup">
                                <h3>On startup</h3>
                                <div class="chrome-settings-radio-group">
                                    <label class="chrome-settings-choice">
                                        <input type="radio" name="startupMode" value="new-tab" data-setting-key="startupMode" data-setting-label="New Tab Page" ${this.localUiState.settings.startupMode === 'new-tab' ? 'checked' : ''}>
                                        <span>Open the New Tab page</span>
                                    </label>
                                    <label class="chrome-settings-choice">
                                        <input type="radio" name="startupMode" value="last-session" data-setting-key="startupMode" data-setting-label="Continue where you left off" ${this.localUiState.settings.startupMode === 'last-session' ? 'checked' : ''}>
                                        <span>Continue where you left off</span>
                                    </label>
                                    <div class="chrome-settings-choice chrome-settings-choice--linked">
                                        <label>
                                            <input type="radio" name="startupMode" value="specific-pages" data-setting-key="startupMode" data-setting-label="Specific pages" ${this.localUiState.settings.startupMode === 'specific-pages' ? 'checked' : ''}>
                                            <span>Open a specific page or set of pages</span>
                                        </label>
                                        <button class="chrome-settings-link" type="button" data-action="startup-pages">Set pages</button>
                                    </div>
                                </div>
                                <div class="chrome-settings-subrow ${settings.startupMode === 'specific-pages' ? '' : 'is-hidden'}">
                                    <div class="chrome-settings-startup-pages">
                                        ${startupPages.map((address) => `
                                            <div class="chrome-settings-startup-page">
                                                <button class="chrome-settings-link chrome-settings-startup-link" type="button" data-address="${address}">${this.escapeHtml(address)}</button>
                                                <button class="chrome-settings-remove-page" type="button" data-action="remove-startup-page" data-startup-page-address="${address}" aria-label="Remove ${this.escapeHtml(address)}">x</button>
                                            </div>
                                        `).join('')}
                                    </div>
                                    <div class="chrome-settings-startup-note">Set pages captures the currently open tabs in this Chrome Beta window.</div>
                                </div>
                            </section>

                            <section class="chrome-settings-section" id="settings-appearance">
                                <h3>Appearance</h3>
                                <div class="chrome-settings-row chrome-settings-row--buttons">
                                    <button class="chrome-settings-action" type="button" disabled>Get themes</button>
                                    <button class="chrome-settings-action" type="button" disabled>Reset to default theme</button>
                                </div>
                                <label class="chrome-settings-toggle">
                                    <input type="checkbox" data-setting-key="showHomeButton" ${settings.showHomeButton ? 'checked' : ''}>
                                    <span>Show Home button</span>
                                </label>
                                <div class="chrome-settings-subrow ${settings.showHomeButton ? '' : 'is-hidden'}">
                                    <div class="chrome-settings-radio-group chrome-settings-radio-group--nested">
                                        <label class="chrome-settings-choice">
                                            <input type="radio" name="homePageMode" value="new-tab" data-setting-key="homePageMode" ${settings.homePageMode !== 'custom' ? 'checked' : ''}>
                                            <span>Use the New Tab page</span>
                                        </label>
                                        <div class="chrome-settings-choice chrome-settings-choice--stacked">
                                            <label>
                                                <input type="radio" name="homePageMode" value="custom" data-setting-key="homePageMode" ${settings.homePageMode === 'custom' ? 'checked' : ''}>
                                                <span>Open this page:</span>
                                            </label>
                                            <div class="chrome-settings-homepage-row ${settings.homePageMode === 'custom' ? '' : 'is-disabled'}">
                                                <input class="chrome-settings-homepage-input" type="text" value="${homePageUrl}" data-setting-key="homePageUrl" spellcheck="false">
                                                <button class="chrome-settings-link" type="button" data-action="use-current-page-home">Use current page</button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <label class="chrome-settings-toggle">
                                    <input type="checkbox" data-setting-key="showBookmarksBar" ${settings.showBookmarksBar ? 'checked' : ''}>
                                    <span>Always show the bookmarks bar</span>
                                </label>
                            </section>

                            <section class="chrome-settings-section" id="settings-search">
                                <h3>Search</h3>
                                <div class="chrome-settings-label">Default search engine used in the omnibox</div>
                                <div class="chrome-settings-row chrome-settings-row--search">
                                    <select id="defaultSearchEngine" data-setting-key="defaultSearchEngine">
                                        ${this.renderSearchEngineOptions(settings.defaultSearchEngine)}
                                    </select>
                                    <button class="chrome-settings-action" type="button" data-action="manage-search-engines">Manage search engines...</button>
                                </div>
                            </section>

                            <section class="chrome-settings-section" id="settings-default">
                                <h3>Default browser</h3>
                                <div class="chrome-settings-default-browser">
                                    <img class="chrome-settings-default-browser-icon" src="${this.escapeHtml(this.getAssetUrl('assets/chrome43/yellow_gear.png'))}" alt="" aria-hidden="true">
                                    <div class="chrome-settings-default-browser-copy">
                                        <button class="chrome-settings-primary" type="button" data-action="set-default-browser" ${settings.isDefaultBrowser ? 'disabled' : ''}>${settings.isDefaultBrowser ? 'Google Chrome Beta is your default browser' : 'Make Google Chrome Beta my default browser'}</button>
                                        <div class="chrome-settings-state">${settings.isDefaultBrowser ? 'Google Chrome Beta is currently your default browser.' : 'Google Chrome Beta is not currently your default browser.'}</div>
                                    </div>
                                </div>
                            </section>
                        </div>
                    </div>
                </div>
            </section>
        `;
    }

    renderSearchEnginesPage() {
        const settings = this.localUiState.settings;
        return `
            <section class="chrome-page chrome-page--settings">
                <div class="chrome-settings-shell">
                    <aside class="chrome-settings-sidebar" aria-label="Chrome pages">
                        <h1>Chrome</h1>
                        <ul class="chrome-settings-sidebar-list">
                            <li><button type="button" data-action="show-history">History</button></li>
                            <li><button type="button" data-action="show-extensions">Extensions</button></li>
                            <li class="selected"><button type="button">Settings</button></li>
                            <li><button type="button" data-action="show-help">Help</button></li>
                        </ul>
                    </aside>

                    <div class="chrome-webui chrome-webui--settings">
                        <header class="chrome-settings-page-header">
                            <h1>Search engines</h1>
                        </header>

                        <div class="chrome-settings-page-body">
                            <section class="chrome-settings-section">
                                <div class="chrome-settings-breadcrumb">
                                    <button class="chrome-settings-link" type="button" data-address="chrome://settings/">Settings</button>
                                    <span>&rsaquo;</span>
                                    <span>Manage search engines</span>
                                </div>
                                <div class="chrome-settings-label">Choose which search engine Chrome Beta uses in the omnibox.</div>
                                <div class="chrome-search-engine-list" role="list">
                                    ${Object.entries(SEARCH_ENGINES).map(([value, engine]) => `
                                        <label class="chrome-search-engine-item" role="listitem">
                                            <input type="radio" name="managedSearchEngine" value="${this.escapeHtml(value)}" data-setting-key="defaultSearchEngine" ${settings.defaultSearchEngine === value ? 'checked' : ''}>
                                            <span class="chrome-search-engine-copy">
                                                <span class="chrome-search-engine-name">${this.escapeHtml(engine.label)}</span>
                                                <span class="chrome-search-engine-url">${this.escapeHtml(engine.queryUrl)}%s</span>
                                            </span>
                                        </label>
                                    `).join('')}
                                </div>
                            </section>
                        </div>
                    </div>
                </div>
            </section>
        `;
    }

    renderDownloadItems() {
        return this.downloadItems.map((download) => {
            const searchText = [
                download.name,
                download.domain,
                download.kind,
                download.status
            ].join(' ').toLowerCase();

            return `
                <article class="chrome-download-row" data-download-search="${this.escapeHtml(searchText)}">
                    <div class="chrome-download-date">
                        <span class="chrome-download-period">${this.escapeHtml(download.period)}</span>
                        <span class="chrome-download-stamp">${this.escapeHtml(download.stamp)}</span>
                    </div>
                    <div class="chrome-download-card">
                        <div class="chrome-download-icon chrome-download-icon--${this.escapeHtml(download.kind)}" aria-hidden="true">${this.escapeHtml(download.kind.toUpperCase())}</div>
                        <div class="chrome-download-content">
                            <button class="chrome-download-name" type="button" ${download.state === 'completed' && download.filePath ? `data-download-action="open-download" data-download-id="${this.escapeHtml(download.downloadId || download.id)}"` : `data-address="${download.address}"`}>${this.escapeHtml(download.name)}</button>
                            <button class="chrome-download-source" type="button" ${download.filePath ? `data-download-action="show-in-folder" data-download-id="${this.escapeHtml(download.downloadId || download.id)}"` : `data-address="${download.address}"`}>${this.escapeHtml(download.filePath ? 'Show in folder' : download.domain)}</button>
                            <div class="chrome-download-meta">
                                <span>${this.escapeHtml(download.size)}</span>
                                <span class="chrome-download-status">${this.escapeHtml(download.status)}</span>
                            </div>
                        </div>
                    </div>
                </article>
            `;
        }).join('');
    }

    renderSearchEngineOptions(activeValue) {
        return Object.entries(SEARCH_ENGINES).map(([value, engine]) => `
            <option value="${value}" ${value === activeValue ? 'selected' : ''}>${this.escapeHtml(engine.label)}</option>
        `).join('');
    }

    applyDownloadsFilter() {
        const list = this.pageHost.querySelectorAll('.chrome-download-row');
        const emptyState = this.pageHost.querySelector('.chrome-downloads-empty');
        const filter = this.localUiState.downloadsFilter.trim().toLowerCase();
        let visibleCount = 0;

        list.forEach((row) => {
            const haystack = row.getAttribute('data-download-search') || '';
            const matches = !filter || haystack.includes(filter);
            row.hidden = !matches;
            if (matches) {
                visibleCount += 1;
            }
        });

        if (emptyState) {
            emptyState.hidden = visibleCount !== 0;
        }

        const summaryText = this.pageHost.querySelector('.chrome-downloads-summary-text');
        if (summaryText) {
            if (this.downloadItems.length === 0) {
                summaryText.textContent = 'No downloads';
            } else if (filter) {
                summaryText.textContent = `${visibleCount} matching downloads`;
            } else {
                summaryText.textContent = `${this.downloadItems.length} recent downloads`;
            }
        }
    }

    applyHistoryFilter() {
        const groups = this.pageHost.querySelectorAll('[data-history-group]');
        const rows = this.pageHost.querySelectorAll('.chrome-history-entry');
        const emptyState = this.pageHost.querySelector('[data-history-empty]');
        const filter = this.localUiState.historyFilter.trim().toLowerCase();
        let visibleCount = 0;

        rows.forEach((row) => {
            const haystack = row.getAttribute('data-history-search') || '';
            const matches = !filter || haystack.includes(filter);
            row.hidden = !matches;
            if (matches) {
                visibleCount += 1;
            }
        });

        groups.forEach((group) => {
            const hasVisibleRows = Array.from(group.querySelectorAll('.chrome-history-entry')).some((row) => !row.hidden);
            group.hidden = !hasVisibleRows;
        });

        if (emptyState) {
            emptyState.hidden = visibleCount !== 0;
        }
    }

    updateWindowTitle(pageTitle) {
        const nextTitle = pageTitle === 'New Tab'
            ? BASE_TITLE
            : `${pageTitle} - ${BASE_TITLE}`;

        document.title = nextTitle;
        const topWindow = window.top || window.parent || window;
        if (this.windowId && typeof topWindow.updateClassicWindowTitle === 'function') {
            topWindow.updateClassicWindowTitle(this.windowId, nextTitle);
            return;
        }

        window.parent?.postMessage({
            action: 'updateWindowTitle',
            appId: APP_ID,
            windowId: this.windowId,
            title: nextTitle
        }, '*');
    }

    // ─── Status pill ───

    getStatusBubbleElement() {
        return this.hostedStatusBubble || this.statusPill;
    }

    updateStatusBubbleLayout(expanded = false) {
        const bubble = this.getStatusBubbleElement();
        if (!this.isHtmlElement(bubble)) {
            return;
        }

        const boundsSource = this.hostContent || this.pageHost || this.instanceRoot;
        const hostWidth = boundsSource?.clientWidth || window.innerWidth || 0;
        if (!hostWidth) {
            return;
        }

        const standardWidth = Math.max(180, Math.floor(hostWidth / 3));
        bubble.style.maxWidth = `${standardWidth}px`;
        bubble.classList.toggle('is-expanded', false);
    }

    resetStatusBubblePosition() {
        const bubble = this.getStatusBubbleElement();
        if (!this.isHtmlElement(bubble)) {
            return;
        }

        bubble.style.left = '-1px';
        bubble.style.right = 'auto';
        bubble.style.bottom = '-1px';
        bubble.style.transform = 'translateY(0px)';
    }

    updateStatusBubbleMouseAvoidance(clientX, clientY, leftContent = false) {
        const bubble = this.getStatusBubbleElement();
        if (!this.isHtmlElement(bubble) || bubble.hidden || !this.hoverStatusVisible) {
            return;
        }

        if (leftContent) {
            this.resetStatusBubblePosition();
            return;
        }

        const hostRect = this.hostContent?.getBoundingClientRect();
        const bubbleRect = bubble.getBoundingClientRect();
        if (!hostRect || !bubbleRect.width || !bubbleRect.height) {
            return;
        }

        const padding = CHROMIUM_STATUS_BUBBLE.mousePaddingPx;
        const baseLeft = hostRect.left - 1;
        const baseTop = hostRect.bottom - bubbleRect.height - 1;
        let relativeX = clientX - baseLeft;
        let relativeY = clientY - baseTop;

        if (relativeY > -padding && relativeX < bubbleRect.width + padding) {
            let offset = padding + relativeY;
            offset = Math.floor((offset * offset) / padding);

            if (relativeX > bubbleRect.width) {
                offset = Math.floor(offset * (
                    (padding - (relativeX - bubbleRect.width)) / padding
                ));
            }

            const maxOffset = Math.max(0, bubbleRect.height - 2);
            offset = Math.max(0, Math.min(offset, maxOffset));

            if (offset >= maxOffset) {
                bubble.style.left = 'auto';
                bubble.style.right = '-1px';
                bubble.style.bottom = '-1px';
                bubble.style.transform = 'translateY(0px)';
                return;
            }

            bubble.style.left = '-1px';
            bubble.style.right = 'auto';
            bubble.style.bottom = '-1px';
            bubble.style.transform = `translateY(${offset}px)`;
            return;
        }

        this.resetStatusBubblePosition();
    }

    showStatus(message, temporary = false) {
        const bubble = this.getStatusBubbleElement();
        if (!bubble) {
            return;
        }

        this.cancelHoverStatusTimers();
        this.updateStatusBubbleLayout(false);
        this.resetStatusBubblePosition();
        if (bubble.classList) {
            bubble.classList.add('is-visible');
            bubble.classList.remove('is-expanded');
        }
        bubble.textContent = message;
        bubble.hidden = false;
        this.statusIsTemporary = temporary;

        if (this.statusHideTimer) {
            clearTimeout(this.statusHideTimer);
            this.statusHideTimer = null;
        }

        if (temporary) {
            this.statusHideTimer = window.setTimeout(() => this.hideStatus(true), 1400);
        }
    }

    hideStatus(temporaryOnly = false) {
        if (temporaryOnly && !this.statusIsTemporary) {
            return;
        }

        const bubble = this.getStatusBubbleElement();
        if (!bubble) {
            return;
        }

        this.cancelHoverStatusTimers();
        if (this.statusHideTimer) {
            clearTimeout(this.statusHideTimer);
            this.statusHideTimer = null;
        }

        this.statusIsTemporary = false;
        if (bubble.classList) {
            bubble.classList.remove('is-visible');
            bubble.classList.remove('is-expanded');
        }
        this.resetStatusBubblePosition();
        bubble.hidden = true;
    }

    cancelHoverStatusTimers() {
        if (this.hoverStatusShowTimer) {
            clearTimeout(this.hoverStatusShowTimer);
            this.hoverStatusShowTimer = null;
        }

        if (this.hoverStatusHideTimer) {
            clearTimeout(this.hoverStatusHideTimer);
            this.hoverStatusHideTimer = null;
        }

        if (this.hoverStatusExpandTimer) {
            clearTimeout(this.hoverStatusExpandTimer);
            this.hoverStatusExpandTimer = null;
        }
    }

    scheduleHoverStatusExpand(message) {
        void message;
    }

    showHoverStatus(message) {
        const bubble = this.getStatusBubbleElement();
        if (!bubble) {
            return;
        }

        if (this.statusHideTimer) {
            clearTimeout(this.statusHideTimer);
            this.statusHideTimer = null;
        }

        if (this.hoverStatusHideTimer) {
            clearTimeout(this.hoverStatusHideTimer);
            this.hoverStatusHideTimer = null;
        }

        if (this.hoverStatusExpandTimer) {
            clearTimeout(this.hoverStatusExpandTimer);
            this.hoverStatusExpandTimer = null;
        }

        this.updateStatusBubbleLayout(false);
        this.resetStatusBubblePosition();
        bubble.textContent = message;
        this.statusIsTemporary = false;

        if (this.hoverStatusVisible) {
            bubble.hidden = false;
            bubble.classList.add('is-visible');
            if (this.lastWebviewMousePoint) {
                this.updateStatusBubbleMouseAvoidance(this.lastWebviewMousePoint.clientX, this.lastWebviewMousePoint.clientY, false);
            }
            this.scheduleHoverStatusExpand(message);
            return;
        }

        if (this.hoverStatusShowTimer) {
            clearTimeout(this.hoverStatusShowTimer);
        }

        this.hoverStatusShowTimer = window.setTimeout(() => {
            this.hoverStatusShowTimer = null;
            this.hoverStatusVisible = true;
            bubble.hidden = false;
            bubble.classList.add('is-visible');
            if (this.lastWebviewMousePoint) {
                this.updateStatusBubbleMouseAvoidance(this.lastWebviewMousePoint.clientX, this.lastWebviewMousePoint.clientY, false);
            }
            this.scheduleHoverStatusExpand(message);
        }, CHROMIUM_STATUS_BUBBLE.showDelayMs);
    }

    hideHoverStatus() {
        const bubble = this.getStatusBubbleElement();
        if (!bubble) {
            return;
        }

        if (this.hoverStatusShowTimer) {
            clearTimeout(this.hoverStatusShowTimer);
            this.hoverStatusShowTimer = null;
        }

        if (this.hoverStatusExpandTimer) {
            clearTimeout(this.hoverStatusExpandTimer);
            this.hoverStatusExpandTimer = null;
        }

        if (!this.hoverStatusVisible) {
            bubble.classList.remove('is-visible');
            bubble.classList.remove('is-expanded');
            this.resetStatusBubblePosition();
            bubble.hidden = true;
            return;
        }

        if (this.hoverStatusHideTimer) {
            clearTimeout(this.hoverStatusHideTimer);
        }

        this.hoverStatusHideTimer = window.setTimeout(() => {
            this.hoverStatusHideTimer = null;
            this.hoverStatusVisible = false;
            bubble.classList.remove('is-visible');
            bubble.classList.remove('is-expanded');
            this.resetStatusBubblePosition();
            window.setTimeout(() => {
                if (!this.hoverStatusVisible && !this.statusIsTemporary && bubble === this.getStatusBubbleElement()) {
                    bubble.hidden = true;
                }
            }, CHROMIUM_STATUS_BUBBLE.hideFadeDurationMs);
        }, CHROMIUM_STATUS_BUBBLE.hideDelayMs);
    }

    // ─── Utilities ───

    applySurfacePreferences() {
        const { showHomeButton, showBookmarksBar } = this.localUiState.settings;
        const activeTab = this.getActiveTab();
        const isNewTab = activeTab ? this.isNewTabAddress(activeTab.address) : false;
        const shouldShowBookmarkBar = showBookmarksBar || isNewTab;
        const isDetachedBookmarkBar = !showBookmarksBar && isNewTab;

        this.homeButton.hidden = !showHomeButton;
        this.homeButton.style.display = showHomeButton ? '' : 'none';
        this.bookmarkBar.hidden = !shouldShowBookmarkBar;
        this.bookmarkBar.classList.toggle('is-attached', shouldShowBookmarkBar && !isDetachedBookmarkBar);
        this.bookmarkBar.classList.toggle('is-detached', isDetachedBookmarkBar);
        this.syncWebviewOffset();
        this.layoutBookmarks();
    }

    getSearchUrl() {
        const engine = SEARCH_ENGINES[this.localUiState.settings.defaultSearchEngine] || SEARCH_ENGINES.google;
        return engine.queryUrl;
    }

    getSearchEngineConfig() {
        return SEARCH_ENGINES[this.localUiState.settings.defaultSearchEngine] || SEARCH_ENGINES.google;
    }

    getHomePageUrl() {
        if (this.localUiState.settings.homePageMode === 'custom') {
            return this.normalizeAddress(this.localUiState.settings.homePageUrl || HOME_URL);
        }

        return 'chrome://newtab/';
    }

    getSearchEngineLabel() {
        return this.getSearchEngineConfig().label;
    }

    clearRemoteOmniboxSuggestions(options = {}) {
        if (this.omniboxRemoteSuggestTimer) {
            clearTimeout(this.omniboxRemoteSuggestTimer);
            this.omniboxRemoteSuggestTimer = null;
        }

        this.omniboxRemoteSuggestRequestId += 1;
        this.omniboxRemoteSuggestions = [];
        this.omniboxRemoteSuggestionsQuery = '';

        if (!options.preserveRenderedPopup && this.addressIsFocused) {
            this.renderOmniboxPopup();
        }
    }

    shouldFetchRemoteOmniboxSuggestions(query, options = {}) {
        const trimmed = (query || '').trim();
        if (!this.isFlagEnabled('enable-remote-omnibox-suggestions')) {
            return false;
        }

        const topWindow = window.top || window.parent || window;
        const hasRemoteFetchBridge =
            (typeof topWindow.fetchChromeBetaSearchSuggestions === 'function') ||
            (electronIpc && typeof electronIpc.invoke === 'function') ||
            !!nodeHttps;

        if (options.fromFocus || !trimmed || this.looksLikeAddressInput(trimmed) || !hasRemoteFetchBridge) {
            return false;
        }

        const engine = this.getSearchEngineConfig();
        return !!engine?.suggestUrl;
    }

    scheduleRemoteOmniboxSuggestions(query, options = {}) {
        if (!this.shouldFetchRemoteOmniboxSuggestions(query, options)) {
            this.clearRemoteOmniboxSuggestions({ preserveRenderedPopup: true });
            return;
        }

        const trimmed = query.trim();
        if (this.omniboxRemoteSuggestTimer) {
            clearTimeout(this.omniboxRemoteSuggestTimer);
            this.omniboxRemoteSuggestTimer = null;
        }

        const requestId = ++this.omniboxRemoteSuggestRequestId;
        this.omniboxRemoteSuggestTimer = window.setTimeout(() => {
            this.omniboxRemoteSuggestTimer = null;
            void this.fetchRemoteOmniboxSuggestions(trimmed, requestId);
        }, 140);
    }

    fetchRemoteOmniboxSuggestions(query, requestId) {
        const engine = this.getSearchEngineConfig();
        if (!engine?.suggestUrl || !query) {
            return Promise.resolve();
        }

        const requestUrl = `${engine.suggestUrl}${encodeURIComponent(query)}`;
        const topWindow = window.top || window.parent || window;
        return new Promise((resolve) => {
            const finalize = (raw) => {
                const suggestions = this.parseRemoteSearchSuggestions(raw, engine, query);
                if (requestId !== this.omniboxRemoteSuggestRequestId) {
                    resolve();
                    return;
                }

                this.omniboxRemoteSuggestions = suggestions;
                this.omniboxRemoteSuggestionsQuery = query;
                if (this.addressIsFocused && (this.omniboxUserText ?? this.addressInput?.value ?? '').trim() === query) {
                    this.updateOmniboxPopup({ preserveRemoteSuggestions: true });
                }
                resolve();
            };

            if (typeof topWindow.fetchChromeBetaSearchSuggestions === 'function') {
                topWindow.fetchChromeBetaSearchSuggestions(requestUrl)
                    .then((raw) => {
                        if (typeof raw === 'string' && raw.length) {
                            finalize(raw);
                            return;
                        }

                        if (!nodeHttps) {
                            resolve();
                            return;
                        }

                        const request = nodeHttps.get(requestUrl, {
                            headers: {
                                'User-Agent': 'Mozilla/5.0 ChromeBetaWin9/1.0',
                                'Accept': 'application/json, text/plain, */*'
                            }
                        }, (response) => {
                            let fallbackRaw = '';
                            response.setEncoding('utf8');
                            response.on('data', (chunk) => {
                                fallbackRaw += chunk;
                            });
                            response.on('end', () => finalize(fallbackRaw));
                        });

                        request.setTimeout(1800, () => {
                            request.destroy();
                            resolve();
                        });
                        request.on('error', () => resolve());
                    })
                    .catch(() => resolve());
                return;
            }

            if (electronIpc && typeof electronIpc.invoke === 'function') {
                electronIpc.invoke('chrome-beta:fetch-search-suggestions', { url: requestUrl })
                    .then((raw) => {
                        if (typeof raw === 'string' && raw.length) {
                            finalize(raw);
                            return;
                        }

                        if (!nodeHttps) {
                            resolve();
                            return;
                        }

                        const request = nodeHttps.get(requestUrl, {
                            headers: {
                                'User-Agent': 'Mozilla/5.0 ChromeBetaWin9/1.0',
                                'Accept': 'application/json, text/plain, */*'
                            }
                        }, (response) => {
                            let fallbackRaw = '';
                            response.setEncoding('utf8');
                            response.on('data', (chunk) => {
                                fallbackRaw += chunk;
                            });
                            response.on('end', () => finalize(fallbackRaw));
                        });

                        request.setTimeout(1800, () => {
                            request.destroy();
                            resolve();
                        });
                        request.on('error', () => resolve());
                    })
                    .catch(() => resolve());
                return;
            }

            if (!nodeHttps) {
                resolve();
                return;
            }

            const request = nodeHttps.get(requestUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 ChromeBetaWin9/1.0',
                    'Accept': 'application/json, text/plain, */*'
                }
            }, (response) => {
                let raw = '';
                response.setEncoding('utf8');
                response.on('data', (chunk) => {
                    raw += chunk;
                });
                response.on('end', () => finalize(raw));
            });

            request.setTimeout(1800, () => {
                request.destroy();
                resolve();
            });
            request.on('error', () => resolve());
        });
    }

    parseRemoteSearchSuggestions(raw, engine, query) {
        if (!raw) {
            return [];
        }

        try {
            const data = JSON.parse(raw);
            let values = [];
            if (engine.suggestFormat === 'duckduckgo' && Array.isArray(data)) {
                if (data.length && typeof data[0] === 'object') {
                    values = data.map((item) => item?.phrase).filter((value) => typeof value === 'string');
                } else if (Array.isArray(data[1])) {
                    values = data[1].filter((value) => typeof value === 'string');
                }
            } else if (engine.suggestFormat === 'osjson' && Array.isArray(data) && Array.isArray(data[1])) {
                values = data[1].filter((value) => typeof value === 'string');
            }

            const baseQuery = query.trim().toLowerCase();
            return values
                .map((value) => value.trim())
                .filter((value) => value && value.toLowerCase() !== baseQuery)
                .slice(0, 5)
                .map((value) => ({
                    kind: 'remote-search',
                    icon: 'search',
                    primary: value,
                    secondary: `${this.getSearchEngineLabel()} Search`,
                    address: `${this.getSearchUrl()}${encodeURIComponent(value)}`,
                    fillIntoEdit: value
                }));
        } catch {
            return [];
        }
    }

    refreshBookmarkStar() {
        if (!this.favoriteButton) {
            return;
        }

        const activeTab = this.getActiveTab();
        const isBookmarked = !!activeTab?.address && this.hasBookmarkAddress(activeTab.address);
        this.favoriteButton.classList.toggle('is-bookmarked', isBookmarked);
        this.favoriteButton.title = isBookmarked ? 'Edit bookmark' : 'Bookmark this page';
        this.favoriteButton.setAttribute('aria-label', this.favoriteButton.title);
    }

    getBookmarkLabelForAddress(address, title) {
        if (address.startsWith('chrome://')) {
            return this.getLocalPageTitle(address);
        }

        if (title && title !== address) {
            return title;
        }

        try {
            return new URL(address).hostname.replace(/^www\./, '');
        } catch {
            return address;
        }
    }

    getBookmarkOpenableUrls(bookmarks) {
        const urls = [];
        (bookmarks || []).forEach((bookmark) => {
            if (!bookmark) {
                return;
            }

            if (bookmark.type === 'url' && bookmark.address) {
                urls.push(bookmark.address);
                return;
            }

            if (bookmark.children?.length) {
                urls.push(...this.getBookmarkOpenableUrls(bookmark.children));
            }
        });
        return urls;
    }

    openBookmarkSelection(selection, options = {}) {
        const urls = this.getBookmarkOpenableUrls(selection);
        if (!urls.length) {
            return;
        }

        urls.forEach((address, index) => {
            this.createTab(address, { activate: !!options.activateFirst && index === 0 });
        });
    }

    copyBookmarkSelection(selection, cut = false) {
        if (!selection?.length) {
            return;
        }

        this.bookmarkClipboard = {
            mode: cut ? 'cut' : 'copy',
            items: this.serializeBookmarks(selection),
            sourceIds: selection.map((bookmark) => bookmark.id)
        };
        this.showStatus(cut ? 'Bookmark cut.' : 'Bookmark copied.', true);
    }

    pasteBookmarkSelection(context) {
        if (!this.bookmarkClipboard?.items?.length) {
            return;
        }

        const parentFolderId = context.parentFolderId || 'bookmark-bar-root';
        const selection = context.selection || [];
        const parentContainer = this.getBookmarkContainer(parentFolderId);
        if (!parentContainer) {
            return;
        }

        let insertIndex = parentContainer.length;
        if (selection[0]) {
            const selectedIndex = parentContainer.findIndex((bookmark) => bookmark.id === selection[0].id);
            if (selectedIndex !== -1) {
                insertIndex = selectedIndex + 1;
            }
        }

        if (this.bookmarkClipboard.mode === 'cut') {
            const movedItems = this.bookmarkClipboard.sourceIds
                .map((bookmarkId) => this.detachBookmarkNode(bookmarkId))
                .filter(Boolean);
            movedItems.forEach((bookmark, index) => {
                this.insertBookmarkNode(bookmark, parentFolderId, insertIndex + index);
            });
        } else {
            const clonedItems = this.cloneBookmarks(this.bookmarkClipboard.items, 'bookmark-paste');
            clonedItems.forEach((bookmark, index) => {
                this.insertBookmarkNode(bookmark, parentFolderId, insertIndex + index);
            });
        }

        this.renderBookmarks();
        this.savePersistentState();
        this.showStatus('Bookmark pasted.', true);
    }

    deleteBookmarkSelection(selection) {
        if (!selection?.length) {
            return;
        }

        selection.forEach((bookmark) => this.detachBookmarkNode(bookmark.id));
        this.renderBookmarks();
        this.savePersistentState();
        this.showStatus(selection.length === 1 ? 'Bookmark deleted.' : 'Bookmarks deleted.', true);
    }

    addBookmarkFromCurrentPage(context) {
        const activeTab = this.getActiveTab();
        if (!activeTab?.address) {
            return;
        }

        const bookmark = this.createBookmarkNode({
            type: 'url',
            label: this.getBookmarkLabelForAddress(activeTab.address, activeTab.title),
            address: activeTab.address,
            faviconUrl: this.getTabFaviconUrl(activeTab)
        });
        const parentFolderId = context.parentFolderId || 'bookmark-bar-root';
        this.insertBookmarkNode(bookmark, parentFolderId);
        this.renderBookmarks();
        this.savePersistentState();
        this.showBookmarkBubble(bookmark, {
            anchorElement: context.anchorElement,
            newlyBookmarked: true
        });
    }

    addBookmarkFolder(context) {
        const parentFolderId = context.parentFolderId || 'bookmark-bar-root';
        const folder = this.createBookmarkNode({
            type: 'folder',
            label: 'New folder',
            children: []
        });
        this.insertBookmarkNode(folder, parentFolderId);
        this.renderBookmarks();
        this.savePersistentState();
        this.renameBookmarkFolder(folder);
    }

    renameBookmarkFolder(bookmark) {
        if (!bookmark || bookmark.type !== 'folder') {
            return;
        }

        const nextLabel = window.prompt('Rename folder', bookmark.label);
        if (!nextLabel) {
            return;
        }

        bookmark.label = nextLabel.trim() || bookmark.label;
        this.renderBookmarks();
        this.savePersistentState();
    }

    serializeBookmarks(bookmarks = this.bookmarks) {
        return bookmarks.map((bookmark) => {
            const payload = {
                type: bookmark.type,
                label: bookmark.label
            };

            if (bookmark.address) {
                payload.address = bookmark.address;
            }

            if (bookmark.faviconUrl) {
                payload.faviconUrl = bookmark.faviconUrl;
            }

            if (bookmark.children?.length) {
                payload.children = this.serializeBookmarks(bookmark.children);
            }

            return payload;
        });
    }

    cloneBookmarks(bookmarks, idPrefix = 'bookmark') {
        return bookmarks.map((bookmark, index) => this.createBookmarkNode(bookmark, `${idPrefix}-${index}`));
    }

    createBookmarkNode(bookmark, id = `bookmark-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`) {
        const node = {
            ...bookmark,
            id,
            type: bookmark.type || (bookmark.children ? 'folder' : 'url')
        };

        if (Array.isArray(bookmark.children)) {
            node.children = bookmark.children.map((child, index) =>
                this.createBookmarkNode(child, `${id}-${index}`)
            );
        }

        return node;
    }

    findBookmarkById(bookmarkId, bookmarks = this.bookmarks) {
        for (const bookmark of bookmarks) {
            if (bookmark.id === bookmarkId) {
                return bookmark;
            }

            if (bookmark.children?.length) {
                const nested = this.findBookmarkById(bookmarkId, bookmark.children);
                if (nested) {
                    return nested;
                }
            }
        }

        return null;
    }

    findBookmarkByAddress(address, bookmarks = this.bookmarks) {
        for (const bookmark of bookmarks) {
            if (bookmark.address === address) {
                return bookmark;
            }

            if (bookmark.children?.length) {
                const nested = this.findBookmarkByAddress(address, bookmark.children);
                if (nested) {
                    return nested;
                }
            }
        }

        return null;
    }

    hasBookmarkAddress(address, bookmarks = this.bookmarks) {
        return bookmarks.some((bookmark) => {
            if (bookmark.address === address) {
                return true;
            }

            return bookmark.children?.length
                ? this.hasBookmarkAddress(address, bookmark.children)
                : false;
        });
    }

    updateBookmarkFaviconsForAddress(address, faviconUrl, bookmarks = this.bookmarks) {
        if (!address || !faviconUrl) {
            return false;
        }

        let changed = false;
        for (const bookmark of bookmarks) {
            if (bookmark.address === address && bookmark.faviconUrl !== faviconUrl) {
                bookmark.faviconUrl = faviconUrl;
                changed = true;
            }

            if (bookmark.children?.length) {
                changed = this.updateBookmarkFaviconsForAddress(address, faviconUrl, bookmark.children) || changed;
            }
        }

        if (changed && bookmarks === this.bookmarks) {
            this.renderBookmarks();
            this.savePersistentState();
        }

        return changed;
    }

    getBookmarkParentFolderId(bookmarkId, bookmarks = this.bookmarks, parentFolderId = 'bookmark-bar-root') {
        for (const bookmark of bookmarks) {
            if (bookmark.id === bookmarkId) {
                return parentFolderId;
            }

            if (bookmark.children?.length) {
                const nested = this.getBookmarkParentFolderId(bookmarkId, bookmark.children, bookmark.id);
                if (nested) {
                    return nested;
                }
            }
        }

        return null;
    }

    getBookmarkFolderChoices(bookmarkId, bookmarks = this.bookmarks, path = []) {
        const folders = [];

        for (const bookmark of bookmarks) {
            if (bookmark.type !== 'folder') {
                continue;
            }

            if (bookmark.id !== bookmarkId) {
                const label = [...path, bookmark.label].join(' > ');
                folders.push({ id: bookmark.id, label });
            }

            if (bookmark.children?.length) {
                folders.push(...this.getBookmarkFolderChoices(bookmarkId, bookmark.children, [...path, bookmark.label]));
            }
        }

        return folders;
    }

    detachBookmarkNode(bookmarkId, bookmarks = this.bookmarks) {
        for (let index = 0; index < bookmarks.length; index += 1) {
            const bookmark = bookmarks[index];
            if (bookmark.id === bookmarkId) {
                return bookmarks.splice(index, 1)[0];
            }

            if (bookmark.children?.length) {
                const nested = this.detachBookmarkNode(bookmarkId, bookmark.children);
                if (nested) {
                    return nested;
                }
            }
        }

        return null;
    }

    moveBookmarkToFolder(bookmarkId, folderId) {
        this.moveBookmarkNode(bookmarkId, folderId || 'bookmark-bar-root');
    }

    getBookmarkContainer(folderId) {
        if (!folderId || folderId === 'bookmark-bar-root') {
            return this.bookmarks;
        }

        const folder = this.findBookmarkById(folderId);
        if (folder?.type !== 'folder') {
            return null;
        }

        folder.children = folder.children || [];
        return folder.children;
    }

    insertBookmarkNode(bookmark, folderId = 'bookmark-bar-root', index = null) {
        const container = this.getBookmarkContainer(folderId);
        if (!container || !bookmark) {
            return false;
        }

        const targetIndex = index === null
            ? container.length
            : Math.max(0, Math.min(index, container.length));
        container.splice(targetIndex, 0, bookmark);
        return true;
    }

    moveBookmarkNode(bookmarkId, folderId = 'bookmark-bar-root', index = null) {
        const targetFolderId = folderId || 'bookmark-bar-root';
        const currentParentId = this.getBookmarkParentFolderId(bookmarkId);
        if (!currentParentId) {
            return false;
        }

        const bookmark = this.detachBookmarkNode(bookmarkId);
        if (!bookmark) {
            return false;
        }

        if (!this.insertBookmarkNode(bookmark, targetFolderId, index)) {
            this.bookmarks.push(bookmark);
        }

        return true;
    }

    sortBookmarkContainer(folderId = 'bookmark-bar-root') {
        const container = this.getBookmarkContainer(folderId);
        if (!container || container.length < 2) {
            return false;
        }

        container.sort((left, right) => {
            if (left.type !== right.type) {
                return left.type === 'folder' ? -1 : 1;
            }

            return left.label.localeCompare(right.label, undefined, {
                sensitivity: 'base'
            });
        });
        return true;
    }

    isBookmarkDescendantFolder(folderId, ancestorBookmarkId) {
        const ancestor = this.findBookmarkById(ancestorBookmarkId);
        if (!ancestor?.children?.length) {
            return false;
        }

        return ancestor.children.some((child) => {
            if (child.id === folderId) {
                return true;
            }

            return child.type === 'folder'
                ? this.isBookmarkDescendantFolder(folderId, child.id)
                : false;
        });
    }

    isElementNode(value) {
        return !!value && typeof value === 'object' && value.nodeType === 1;
    }

    isHtmlElement(value) {
        return this.isElementNode(value) && typeof value.getBoundingClientRect === 'function';
    }

    getHostAlignedClientRect(element) {
        if (!this.isHtmlElement(element)) {
            return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
        }

        const rect = element.getBoundingClientRect();
        if (!this.hostIframe || element.ownerDocument === this.hostContent?.ownerDocument) {
            return rect;
        }

        const iframeRect = this.hostIframe.getBoundingClientRect();
        return {
            left: iframeRect.left + rect.left,
            top: iframeRect.top + rect.top,
            right: iframeRect.left + rect.right,
            bottom: iframeRect.top + rect.bottom,
            width: rect.width,
            height: rect.height
        };
    }

    translateClientPointToHost(clientX, clientY, anchorElement = null) {
        if (!this.hostIframe || !anchorElement || anchorElement.ownerDocument === this.hostContent?.ownerDocument) {
            return { clientX, clientY };
        }

        const iframeRect = this.hostIframe.getBoundingClientRect();
        return {
            clientX: iframeRect.left + clientX,
            clientY: iframeRect.top + clientY
        };
    }

    isInputElement(value) {
        return this.isElementNode(value) && value.tagName === 'INPUT';
    }

    isSelectElement(value) {
        return this.isElementNode(value) && value.tagName === 'SELECT';
    }

    getElementTarget(value) {
        return this.isElementNode(value) ? value : null;
    }

    escapeHtml(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
}

window.confirmClose = async () => true;

window.addEventListener('DOMContentLoaded', () => {
    window.chromeClassicApp = new ChromeClassicApp();
});
