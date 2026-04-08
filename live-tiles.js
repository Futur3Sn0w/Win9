(function () {
    'use strict';

    const REFRESH_MS = 30 * 60 * 1000;
    const DEFAULT_MOVE_MS = 7000;
    const OPEN_DELAY_MS = 180;
    const STAGGER_MS = 55;
    const REVEAL_DELAY_MS = 220;
    const ENABLE_REVEAL_DELAY_MS = 700;
    const OPEN_REFRESH_DELAY_START_MENU_MS = 180;
    const OPEN_REFRESH_DELAY_START_SCREEN_MS = 560;
    const CLOSE_RESET_DELAY_START_MENU_MS = 160;
    const CLOSE_RESET_DELAY_START_SCREEN_MS = 520;
    const SLIDE_TRANSITION_DURATION_MS = 460;
    const DISABLE_FADE_DURATION_MS = 460;
    const WEATHER_TILE_SCHEMA_VERSION = 4;
    const MAIL_TILE_SCHEMA_VERSION = 2;
    const PHOTO_THUMB_MAX_EDGE = 360;
    const PHOTOS_KEY = 'photos-app-state-v2';
    const WEATHER_KEY = 'modern-weather-state-v1';
    const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff', '.tif', '.ico']);
    const DEFAULT_WEATHER_LOCATION = { name: 'Seattle', latitude: 47.6062, longitude: -122.3321 };
    const MAIL_LOGO_URL = 'apps/modern/mail/resources/logo.png';
    const CALENDAR_LOGO_URL = 'apps/modern/calendar/resources/logo.png';
    const STORE_LOGO_URL = 'apps/modern/msstore/resources/logo.png';
    const STORE_TILE_SCHEMA_VERSION = 2;
    const WEATHER_APP_BASE = 'apps/modern/weather/';
    const WEATHER_PANORAMA_URL = `${WEATHER_APP_BASE}resources/panorama-bg.jpg`;
    const MAIL_CATEGORY_ORDER = ['inbox', 'social', 'promotions', 'updates', 'forums'];
    const WINSTORE_BASE_URL = 'https://futur3sn0w.github.io/WinStore';
    const storeLogoUrl = (id) => `${WINSTORE_BASE_URL}/apps/${id}/resources/logo.svg`;
    const DEFAULT_STORE_SLIDES = [
        {
            variant: 'store-highlight',
            label: 'App of the week',
            name: 'YouTube',
            description: 'Browse, stream, and discover videos from across the web.',
            price: 'Free',
            color: 'grey',
            iconUrl: storeLogoUrl('youtube')
        },
        {
            variant: 'store-category',
            sizes: ['large'],
            title: 'Productivity picks',
            apps: [
                { name: 'Microsoft Word', price: 'Free', color: 'blue', iconUrl: storeLogoUrl('word') },
                { name: 'Microsoft Excel', price: 'Free', color: 'green', iconUrl: storeLogoUrl('excel') },
                { name: 'Microsoft OneNote', price: 'Free', color: 'purple', iconUrl: storeLogoUrl('onenote') }
            ]
        },
        {
            variant: 'store-highlight',
            label: 'New arrival',
            name: 'Discord',
            description: 'Chat, call, and hang out with friends and communities.',
            price: 'Free',
            color: 'purple',
            iconUrl: storeLogoUrl('discord')
        },
        {
            variant: 'store-category',
            sizes: ['large'],
            title: 'Music &amp; entertainment',
            apps: [
                { name: 'Spotify', price: 'Free', color: 'green', iconUrl: storeLogoUrl('spotify') },
                { name: 'YouTube Music', price: 'Free', color: 'grey', iconUrl: storeLogoUrl('youtube-music') },
                { name: 'Apple Music', price: 'Free', color: 'grey', iconUrl: storeLogoUrl('apple-music') }
            ]
        },
        {
            variant: 'store-highlight',
            label: 'Creative tools',
            name: 'Figma',
            description: 'Design, prototype, and collaborate all in one place.',
            price: 'Free',
            color: 'purple',
            iconUrl: storeLogoUrl('figma')
        }
    ];
    const DEFAULT_MAIL = {
        folders: [
            { id: 'inbox', label: 'Inbox' },
            { id: 'social', label: 'Social' },
            { id: 'promotions', label: 'Promotions' },
            { id: 'updates', label: 'Updates' },
            { id: 'forums', label: 'Forums' }
        ],
        messages: {
            inbox: [
                { from: 'Ava Martinez', preview: 'Boarding starts at 6:35 PM from Gate C17.', unread: true, dateLabel: 'Today, 7:12 AM' }
            ],
            social: [
                { from: 'Studio Team', preview: 'Shared a few screenshots from the app archaeology session.', unread: true, dateLabel: 'Saturday, 6:18 PM' }
            ],
            promotions: [
                { from: 'Windows Weekly', preview: 'A short collection of Metro-era app navigation patterns that still hold up.', unread: false, dateLabel: 'Sunday, 4:34 PM' }
            ],
            updates: [
                { from: 'Northwind Ops', preview: 'Please confirm the copied tile pack still matches the original package names.', unread: false, dateLabel: 'Monday, 8:10 AM' }
            ],
            forums: [
                { from: 'Contoso Design Review', preview: 'The navigation pass is approved. The remaining work is mostly polish.', unread: false, dateLabel: 'Yesterday, 9:48 PM' }
            ]
        }
    };
    const DEFAULT_EVENTS = [
        { calendarTitle: 'Work', date: '2026-04-04', start: '15:00', end: '16:00', title: 'Calendar fidelity review', location: 'Design lab', allDay: false },
        { calendarTitle: 'Travel', date: '2026-04-07', start: '11:00', end: '12:30', title: 'Hardware pickup', location: 'North lobby', allDay: false }
    ];
    const WEATHER_CODES = {
        0: { caption: 'Clear sky', day: '1', night: '1b' },
        1: { caption: 'Mainly clear', day: '1', night: '1b' },
        2: { caption: 'Partly cloudy', day: '34_33', night: '34_33' },
        3: { caption: 'Overcast', day: '26', night: '26' },
        45: { caption: 'Fog', day: '20', night: '20b' },
        48: { caption: 'Depositing rime fog', day: '20c', night: '20c' },
        51: { caption: 'Light drizzle', day: '9', night: '9b' },
        53: { caption: 'Moderate drizzle', day: '9', night: '9b' },
        55: { caption: 'Dense drizzle', day: '9c', night: '9c' },
        56: { caption: 'Freezing drizzle', day: '9c', night: '9c' },
        57: { caption: 'Heavy freezing drizzle', day: '9c', night: '9c' },
        61: { caption: 'Light rain', day: '9', night: '9b' },
        63: { caption: 'Rain', day: '11', night: '11' },
        65: { caption: 'Heavy rain', day: '12', night: '12' },
        66: { caption: 'Light freezing rain', day: '25', night: '25b' },
        67: { caption: 'Heavy freezing rain', day: '25', night: '25b' },
        71: { caption: 'Light snow', day: '19', night: '19b' },
        73: { caption: 'Snow', day: '19c', night: '19c' },
        75: { caption: 'Heavy snow', day: '43', night: '43' },
        77: { caption: 'Snow grains', day: '19', night: '19b' },
        80: { caption: 'Rain showers', day: '9', night: '9b' },
        81: { caption: 'Heavy showers', day: '11', night: '11' },
        82: { caption: 'Violent showers', day: '12', night: '12' },
        85: { caption: 'Snow showers', day: '19', night: '19b' },
        86: { caption: 'Heavy snow showers', day: '43', night: '43' },
        95: { caption: 'Thunderstorm', day: '17', night: '17' },
        96: { caption: 'Storm with hail', day: '17', night: '17' },
        99: { caption: 'Severe hail storm', day: '17', night: '17' }
    };

    const req = (name) => {
        try {
            if (typeof window !== 'undefined' && typeof window.require === 'function') return window.require(name);
            if (typeof require === 'function') return require(name);
        } catch (_error) {
            return null;
        }
        return null;
    };

    const electron = req('electron');
    const fs = req('fs');
    const fsPromises = req('fs/promises');
    const path = req('path');
    const crypto = req('crypto');
    const pathToFileURL = req('url')?.pathToFileURL || null;
    const ipc = electron?.ipcRenderer || null;
    const nativeImage = electron?.nativeImage || null;

    const state = {
        ready: false,
        open: false,
        surface: 'start-menu',
        renderTimer: null,
        refreshTimer: null,
        surfaceRefreshTimer: null,
        closeResetTimer: null,
        fullRenderQueued: false,
        pendingRenderApps: new Set(),
        deferredRenderApps: new Set(),
        assetPreloads: new Map(),
        enabled: new Map(),
        cache: new Map(),
        inFlight: new Map(),
        slideIndex: new Map(),
        lastLiveIndex: new Map(),
        revealTimers: new Map(),
        rotateTimers: new Map(),
        settleTimers: new Map(),
        toggleTimers: new Map(),
        providers: new Map()
    };

    const html = (value) => String(value == null ? '' : value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll('\'', '&#39;');

    const json = (raw, fallback) => {
        try {
            return raw ? JSON.parse(raw) : fallback;
        } catch (_error) {
            return fallback;
        }
    };

    const apps = () => window.AppsManager;
    const registry = () => window.TileLayoutRegistry;
    const tileBadges = () => window.TileBadges;
    const num = (value, fallback) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
    };

    function specsFor(app) {
        if (!app || app.type !== 'modern' || !app.tileSpecs || app.tileSpecs.mode !== 'live') return null;
        return {
            contentType: app.tileSpecs.contentType === 'media' ? 'media' : 'data',
            dataSource: app.tileSpecs.dataSource === 'aggregated' ? 'aggregated' : 'local',
            moveSpeed: num(app.tileSpecs.moveSpeed, DEFAULT_MOVE_MS),
            refreshMinutes: num(app.tileSpecs.refreshIntervalMinutes, 30)
        };
    }

    function getApp(appOrId) {
        return typeof appOrId === 'string' ? apps()?.getAppById?.(appOrId) : appOrId;
    }

    function isTileLiveCapable(appOrId) {
        return Boolean(specsFor(getApp(appOrId)));
    }

    function isLiveTileEnabled(appOrId) {
        const app = getApp(appOrId);
        if (!isTileLiveCapable(app)) return false;
        if (!state.enabled.has(app.id)) return true;
        return Boolean(state.enabled.get(app.id));
    }

    function getPayload(appOrId) {
        const app = getApp(appOrId);
        return app ? (state.cache.get(app.id) || null) : null;
    }

    function tileSizeFor(appOrId) {
        const app = getApp(appOrId);
        return ['small', 'medium', 'wide', 'large'].includes(app?.size) ? app.size : 'medium';
    }

    function eligibleSlidesFor(appOrId, payload = null) {
        const app = getApp(appOrId);
        const sourcePayload = payload || getPayload(app);
        const slides = Array.isArray(sourcePayload?.slides) ? sourcePayload.slides : [];
        const tileSize = tileSizeFor(app);
        return slides.filter((slide) => !Array.isArray(slide.sizes) || !slide.sizes.length || slide.sizes.includes(tileSize));
    }

    function slideCount(appOrId) {
        return eligibleSlidesFor(appOrId).length;
    }

    function totalSlideCount(appOrId) {
        return slideCount(appOrId) > 0 ? slideCount(appOrId) + 1 : 1;
    }

    function clampIndex(appId, index) {
        return Math.max(0, Math.min(num(index, 0), slideCount(appId)));
    }

    function currentIndex(appOrId) {
        const app = getApp(appOrId);
        return app ? (state.slideIndex.get(app.id) || 0) : 0;
    }

    function directionFor(appOrId) {
        const app = getApp(appOrId);
        const id = String(app?.id || '');
        let hash = 0;
        for (let index = 0; index < id.length; index += 1) {
            hash = ((hash * 31) + id.charCodeAt(index)) | 0;
        }
        return Math.abs(hash) % 2 === 0 ? -1 : 1;
    }

    function normalizePayload(appId, payload) {
        const app = getApp(appId);
        const specs = specsFor(app);
        if (!specs || !payload || !Array.isArray(payload.slides) || !payload.slides.length) return null;
        if (app?.id === 'weather') {
            const schemaVersion = Number(payload.schemaVersion || 0);
            if (schemaVersion < WEATHER_TILE_SCHEMA_VERSION) return null;
        }
        if (app?.id === 'mail') {
            const schemaVersion = Number(payload.schemaVersion || 0);
            if (schemaVersion < MAIL_TILE_SCHEMA_VERSION) return null;
        }
        if (app?.id === 'msstore') {
            const schemaVersion = Number(payload.schemaVersion || 0);
            if (schemaVersion < STORE_TILE_SCHEMA_VERSION) return null;
        }
        const slides = payload.slides.map((slide) => {
            if (!slide || typeof slide !== 'object') return null;
            return {
                kind: ['image', 'summary', 'list', 'text'].includes(slide.kind) ? slide.kind : 'text',
                variant: String(slide.variant || ''),
                eyebrow: String(slide.eyebrow || ''),
                title: String(slide.title || ''),
                value: String(slide.value || ''),
                body: String(slide.body || ''),
                meta: String(slide.meta || ''),
                footerLabel: String(slide.footerLabel || ''),
                brandLabel: String(slide.brandLabel || ''),
                theme: String(slide.theme || ''),
                sizes: Array.isArray(slide.sizes)
                    ? slide.sizes
                        .map((size) => String(size || '').toLowerCase())
                        .filter((size) => ['small', 'medium', 'wide', 'large'].includes(size))
                    : [],
                subtitle: String(slide.subtitle || ''),
                dayNumber: String(slide.dayNumber || ''),
                weekday: String(slide.weekday || ''),
                badge: String(slide.badge || ''),
                badgeLabel: String(slide.badgeLabel || ''),
                imageUrl: slide.imageUrl ? toAssetUrl(slide.imageUrl) : '',
                iconUrl: slide.iconUrl ? toAssetUrl(slide.iconUrl) : '',
                backgroundUrl: slide.backgroundUrl ? toAssetUrl(slide.backgroundUrl) : '',
                items: Array.isArray(slide.items) ? slide.items.slice(0, 4).map((item) => ({
                    label: String(item?.label || ''),
                    value: String(item?.value || '')
                })) : [],
                messages: Array.isArray(slide.messages) ? slide.messages.slice(0, 3).map((message) => ({
                    from: String(message?.from || ''),
                    preview: String(message?.preview || '')
                })) : [],
                apps: Array.isArray(slide.apps) ? slide.apps.slice(0, 4).map((a) => ({
                    name: String(a?.name || ''),
                    price: String(a?.price || ''),
                    color: String(a?.color || ''),
                    iconUrl: a?.iconUrl ? toAssetUrl(String(a.iconUrl)) : ''
                })) : [],
                label: String(slide.label || ''),
                name: String(slide.name || ''),
                description: String(slide.description || ''),
                price: String(slide.price || ''),
                color: String(slide.color || ''),
                icon: String(slide.icon || '')
            };
        }).filter(Boolean).slice(0, 6);
        if (!slides.length) return null;
        if (app?.id === 'weather' && slides.some((slide) => !slide.iconUrl)) return null;
        return {
            schemaVersion: Number(payload.schemaVersion || 0),
            contentType: payload.contentType === 'media' ? 'media' : specs.contentType,
            dataSource: payload.dataSource === 'aggregated' ? 'aggregated' : specs.dataSource,
            refreshedAt: payload.refreshedAt || new Date().toISOString(),
            slides
        };
    }

    function toAssetUrl(value) {
        if (!value || typeof value !== 'string') return '';
        if (/^(https?:|file:|data:)/i.test(value)) return value;
        if ((/^[A-Z]:[\\/]/i.test(value) || value.startsWith('\\\\')) && typeof pathToFileURL === 'function') {
            try {
                return pathToFileURL(value).href;
            } catch (_error) {
                return value;
            }
        }
        return value;
    }

    function getLiveTileCacheRoot() {
        if (!path || typeof process === 'undefined' || !process.cwd) return '';
        return path.join(process.cwd(), '.cache', 'live-tiles');
    }

    function getLiveTileCacheFilePath() {
        const root = getLiveTileCacheRoot();
        return root ? path.join(root, 'payloads.json') : '';
    }

    function getPhotoThumbsDir() {
        const root = getLiveTileCacheRoot();
        return root ? path.join(root, 'photos') : '';
    }

    function loadDiskCache() {
        const cacheFilePath = getLiveTileCacheFilePath();
        if (!cacheFilePath || !fs?.existsSync || !fs?.readFileSync) return {};
        try {
            if (!fs.existsSync(cacheFilePath)) return {};
            const raw = fs.readFileSync(cacheFilePath, 'utf8');
            const parsed = raw ? JSON.parse(raw) : {};
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (error) {
            console.warn('[LiveTiles] Failed to load disk cache:', error);
            return {};
        }
    }

    function saveDiskCache(cacheMap) {
        const cacheFilePath = getLiveTileCacheFilePath();
        if (!cacheFilePath || !fs?.mkdirSync || !fs?.writeFileSync || !path) return;
        try {
            fs.mkdirSync(path.dirname(cacheFilePath), { recursive: true });
            fs.writeFileSync(cacheFilePath, JSON.stringify(cacheMap, null, 2), 'utf8');
        } catch (error) {
            console.warn('[LiveTiles] Failed to save disk cache:', error);
        }
    }

    async function ensurePhotoThumbnail(photo) {
        if (!photo?.path || !fsPromises || !path || !nativeImage?.createFromPath) return photo?.path || '';
        const thumbsDir = getPhotoThumbsDir();
        if (!thumbsDir) return photo.path;

        const hash = typeof crypto?.createHash === 'function'
            ? crypto.createHash('sha1').update(`${photo.path}|${photo.mtimeMs}`).digest('hex')
            : `${path.basename(photo.path, path.extname(photo.path))}-${Math.round(photo.mtimeMs || Date.now())}`;
        const thumbPath = path.join(thumbsDir, `${hash}.png`);

        try {
            await fsPromises.access(thumbPath);
            return thumbPath;
        } catch (_error) {
            // Generate below.
        }

        try {
            await fsPromises.mkdir(thumbsDir, { recursive: true });
            const image = nativeImage.createFromPath(photo.path);
            if (!image || image.isEmpty()) return photo.path;

            const size = image.getSize();
            const maxEdge = Math.max(size.width || 0, size.height || 0);
            let output = image;
            if (maxEdge > PHOTO_THUMB_MAX_EDGE && maxEdge > 0) {
                const scale = PHOTO_THUMB_MAX_EDGE / maxEdge;
                output = image.resize({
                    width: Math.max(1, Math.round((size.width || PHOTO_THUMB_MAX_EDGE) * scale)),
                    height: Math.max(1, Math.round((size.height || PHOTO_THUMB_MAX_EDGE) * scale)),
                    quality: 'good'
                });
            }

            const pngBuffer = output.toPNG();
            if (!pngBuffer?.length) return photo.path;
            await fsPromises.writeFile(thumbPath, pngBuffer);
            return thumbPath;
        } catch (error) {
            console.warn('[LiveTiles] Failed to build photo thumbnail:', error);
            return photo.path;
        }
    }

    function renderLiveTileRegion(appOrId, options = {}) {
        const app = getApp(appOrId);
        const renderState = getRenderState(app);
        if (!renderState.active) return '';
        const baseVisualMarkup = String(options.baseVisualMarkup || '');
        const baseLabelMarkup = String(options.baseLabelMarkup || '');
        const direction = directionFor(app);
        const currentStackIndex = renderState.slideIndex || 0;
        const slideStyle = (stackIndex) => `style="transform: translateY(${(stackIndex - currentStackIndex) * 100 * direction}%);"`;
        const baseSlide = `
            <div class="tiles__tile-live-slide tiles__tile-live-slide--base" data-live-stack-index="0" ${slideStyle(0)}>
                ${baseVisualMarkup}
                ${baseLabelMarkup}
            </div>
        `;
        return `
            <div class="tiles__tile-live-region" data-live-content-type="${html(renderState.payload.contentType)}" data-live-data-source="${html(renderState.payload.dataSource)}" data-live-direction="${direction < 0 ? 'up' : 'down'}">
                ${baseSlide}
                ${renderState.payload.slides.map((slide, index) => renderSlide(app, slide, index + 1, slideStyle(index + 1))).join('')}
            </div>
        `;
    }

    function renderSlide(app, slide, stackIndex, positionStyle = '') {
        const includePersistentLabel = app?.id === 'photos';
        const persistentLabel = includePersistentLabel
            ? `<span class="tiles__tile-live-label-clone">${html(app.name || '')}</span>`
            : '';
        const badgeMarkup = slide.badge
            ? `<span class="tiles__tile-live-badge" aria-label="${html(slide.badgeLabel || slide.badge)}">${html(slide.badge)}</span>`
            : '';
        const hasCopy = Boolean(slide.eyebrow || slide.title || slide.body || slide.meta);
        if (app?.id === 'mail') {
            return renderMailSlide(slide, stackIndex, positionStyle, badgeMarkup);
        }
        if (app?.id === 'weather') {
            return renderWeatherSlide(slide, stackIndex, positionStyle, badgeMarkup);
        }
        if (app?.id === 'calendar') {
            return renderCalendarSlide(slide, stackIndex, positionStyle, badgeMarkup);
        }
        if (app?.id === 'msstore') {
            return renderStoreSlide(slide, stackIndex, positionStyle, badgeMarkup);
        }
        if (slide.kind === 'image') {
            return `
                <div class="tiles__tile-live-slide tiles__tile-live-slide--image${hasCopy ? '' : ' tiles__tile-live-slide--image-only'}" data-live-stack-index="${stackIndex}" ${positionStyle}>
                    <div class="tiles__tile-live-media" style="background-image: url(&quot;${html(slide.imageUrl)}&quot;);"></div>
                    ${hasCopy ? `
                    <div class="tiles__tile-live-copy">
                        ${slide.eyebrow ? `<div class="tiles__tile-live-eyebrow">${html(slide.eyebrow)}</div>` : ''}
                        ${slide.title ? `<div class="tiles__tile-live-title">${html(slide.title)}</div>` : ''}
                        ${slide.body ? `<div class="tiles__tile-live-body">${html(slide.body)}</div>` : ''}
                        ${slide.meta ? `<div class="tiles__tile-live-meta">${html(slide.meta)}</div>` : ''}
                    </div>` : ''}
                    ${badgeMarkup}
                    ${persistentLabel}
                </div>
            `;
        }
        if (slide.kind === 'summary') {
            return `
                <div class="tiles__tile-live-slide tiles__tile-live-slide--summary" data-live-stack-index="${stackIndex}" ${positionStyle}>
                    ${slide.eyebrow ? `<div class="tiles__tile-live-eyebrow">${html(slide.eyebrow)}</div>` : ''}
                    ${slide.value ? `<div class="tiles__tile-live-value">${html(slide.value)}</div>` : ''}
                    ${slide.title ? `<div class="tiles__tile-live-title">${html(slide.title)}</div>` : ''}
                    ${slide.body ? `<div class="tiles__tile-live-body">${html(slide.body)}</div>` : ''}
                    ${slide.meta ? `<div class="tiles__tile-live-meta">${html(slide.meta)}</div>` : ''}
                    ${badgeMarkup}
                    ${persistentLabel}
                </div>
            `;
        }
        if (slide.kind === 'list') {
            return `
                <div class="tiles__tile-live-slide tiles__tile-live-slide--list" data-live-stack-index="${stackIndex}" ${positionStyle}>
                    ${slide.eyebrow ? `<div class="tiles__tile-live-eyebrow">${html(slide.eyebrow)}</div>` : ''}
                    ${slide.title ? `<div class="tiles__tile-live-title">${html(slide.title)}</div>` : ''}
                    <div class="tiles__tile-live-list">
                        ${slide.items.map((item) => `<div class="tiles__tile-live-list-item"><span class="tiles__tile-live-list-label">${html(item.label)}</span><span class="tiles__tile-live-list-value">${html(item.value)}</span></div>`).join('')}
                    </div>
                    ${slide.meta ? `<div class="tiles__tile-live-meta">${html(slide.meta)}</div>` : ''}
                    ${badgeMarkup}
                    ${persistentLabel}
                </div>
            `;
        }
        return `
            <div class="tiles__tile-live-slide tiles__tile-live-slide--text" data-live-stack-index="${stackIndex}" ${positionStyle}>
                ${slide.eyebrow ? `<div class="tiles__tile-live-eyebrow">${html(slide.eyebrow)}</div>` : ''}
                ${slide.title ? `<div class="tiles__tile-live-title">${html(slide.title)}</div>` : ''}
                ${slide.body ? `<div class="tiles__tile-live-body">${html(slide.body)}</div>` : ''}
                ${slide.meta ? `<div class="tiles__tile-live-meta">${html(slide.meta)}</div>` : ''}
                ${badgeMarkup}
                ${persistentLabel}
            </div>
        `;
    }

    function renderAppBrand(appId, altText = '') {
        const logoUrl = appId === 'mail'
            ? MAIL_LOGO_URL
            : appId === 'calendar'
                ? CALENDAR_LOGO_URL
                : '';
        if (!logoUrl) return '';
        return `
            <span class="tiles__tile-live-brand">
                <img class="tiles__tile-live-brand-logo" src="${html(logoUrl)}" alt="${html(altText)}" draggable="false">
            </span>
        `;
    }

    function renderStoreBrand() {
        return `
            <span class="tiles__tile-live-brand tiles__tile-live-store-brand">
                <img class="tiles__tile-live-brand-logo" src="${html(STORE_LOGO_URL)}" alt="Store" draggable="false">
            </span>
        `;
    }

    const STORE_TILE_COLORS = { teal: '#00A0B1', blue: '#0A5BC4', magenta: '#A700AE', purple: '#643EBF', red: '#BF1E4B', orange: '#DC572E', green: '#00A600', sky: '#2E8DEF', grey: '#7D7D7D' };

    function storeBg(color) {
        return (color && color.startsWith('#') ? color : STORE_TILE_COLORS[color]) || STORE_TILE_COLORS.grey;
    }

    function renderStoreIconBlock(color, iconUrl, sizeClass = '') {
        const bg = storeBg(color);
        const inner = iconUrl
            ? `<img src="${html(iconUrl)}" alt="" draggable="false" class="tiles__tile-live-store-icon-img">`
            : '';
        return `<span class="tiles__tile-live-store-icon${sizeClass ? ` ${sizeClass}` : ''}" style="background:${html(bg)};">${inner}</span>`;
    }

    function renderStoreSlide(slide, stackIndex, positionStyle = '', badgeMarkup = '') {
        if (slide.variant === 'store-category' && Array.isArray(slide.apps) && slide.apps.length) {
            const appsMarkup = slide.apps.map((a) => `
                <div class="tiles__tile-live-store-row">
                    ${renderStoreIconBlock(a.color, a.iconUrl, 'tiles__tile-live-store-icon--sm')}
                    <div class="tiles__tile-live-store-row-copy">
                        <div class="tiles__tile-live-store-row-name">${html(a.name)}</div>
                        ${a.price ? `<div class="tiles__tile-live-store-row-price">${html(a.price)}</div>` : ''}
                    </div>
                </div>
            `).join('');
            return `
                <div class="tiles__tile-live-slide tiles__tile-live-slide--store tiles__tile-live-slide--store-category" data-live-stack-index="${stackIndex}" ${positionStyle}>
                    ${slide.title ? `<div class="tiles__tile-live-store-title">${html(slide.title)}</div>` : ''}
                    <div class="tiles__tile-live-store-rows">${appsMarkup}</div>
                    ${renderStoreBrand()}
                    ${badgeMarkup}
                </div>
            `;
        }
        // store-highlight (default)
        return `
            <div class="tiles__tile-live-slide tiles__tile-live-slide--store tiles__tile-live-slide--store-highlight" data-live-stack-index="${stackIndex}" ${positionStyle}>
                ${renderStoreIconBlock(slide.color, slide.iconUrl)}
                <div class="tiles__tile-live-store-copy">
                    ${slide.label ? `<div class="tiles__tile-live-store-label">${html(slide.label)}</div>` : ''}
                    ${slide.name ? `<div class="tiles__tile-live-store-name">${html(slide.name)}</div>` : ''}
                    ${slide.description ? `<div class="tiles__tile-live-store-desc">${html(slide.description)}</div>` : ''}
                    ${slide.price ? `<div class="tiles__tile-live-store-price">${html(slide.price)}</div>` : ''}
                </div>
                ${renderStoreBrand()}
                ${badgeMarkup}
            </div>
        `;
    }

    function renderMailSlide(slide, stackIndex, positionStyle = '', badgeMarkup = '') {
        if (slide.variant === 'mail-multi' && Array.isArray(slide.messages) && slide.messages.length) {
            const messagesMarkup = slide.messages.map((message) => `
                <div class="tiles__tile-live-mail-multi-item">
                    <div class="tiles__tile-live-mail-sender">${html(message.from)}</div>
                    ${message.preview ? `<div class="tiles__tile-live-mail-preview">${html(message.preview)}</div>` : ''}
                </div>
            `).join('');
            return `
                <div class="tiles__tile-live-slide tiles__tile-live-slide--mail tiles__tile-live-slide--mail-multi" data-live-stack-index="${stackIndex}" ${positionStyle}>
                    <div class="tiles__tile-live-mail-multi">
                        ${messagesMarkup}
                    </div>
                    ${renderAppBrand('mail', 'Mail')}
                    ${badgeMarkup}
                </div>
            `;
        }
        return `
            <div class="tiles__tile-live-slide tiles__tile-live-slide--mail" data-live-stack-index="${stackIndex}" ${positionStyle}>
                <div class="tiles__tile-live-mail-copy">
                    ${slide.title ? `<div class="tiles__tile-live-mail-sender">${html(slide.title)}</div>` : ''}
                    ${slide.meta ? `<div class="tiles__tile-live-mail-preview">${html(slide.meta)}</div>` : ''}
                </div>
                ${renderAppBrand('mail', 'Mail')}
                ${badgeMarkup}
            </div>
        `;
    }

    function renderWeatherSlide(slide, stackIndex, positionStyle = '', badgeMarkup = '') {
        const variantClass = slide.variant ? ` tiles__tile-live-slide--weather-${html(slide.variant)}` : '';
        const backdropImageMarkup = slide.backgroundUrl
            ? `<div class="tiles__tile-live-weather-backdrop-image" style="background-image: url(&quot;${html(slide.backgroundUrl)}&quot;);"></div>`
            : '';
        const detailsMarkup = Array.isArray(slide.items) && slide.items.length
            ? `
                <div class="tiles__tile-live-weather-details">
                    ${slide.items.map((item) => `
                        <div class="tiles__tile-live-weather-detail">
                            <span class="tiles__tile-live-weather-detail-label">${html(item.label)}</span>
                            <span class="tiles__tile-live-weather-detail-value">${html(item.value)}</span>
                        </div>
                    `).join('')}
                </div>
            `
            : '';
        return `
            <div class="tiles__tile-live-slide tiles__tile-live-slide--weather${variantClass}" data-live-stack-index="${stackIndex}" data-weather-theme="${html(slide.theme || '')}" ${positionStyle}>
                <div class="tiles__tile-live-weather-backdrop"></div>
                ${backdropImageMarkup}
                <div class="tiles__tile-live-weather-layout">
                    <div class="tiles__tile-live-weather-art">
                        ${slide.iconUrl ? `<img class="tiles__tile-live-weather-icon" src="${html(slide.iconUrl)}" alt="" draggable="false">` : ''}
                    </div>
                    <div class="tiles__tile-live-weather-copy">
                        ${slide.value ? `<div class="tiles__tile-live-weather-temp">${html(slide.value)}</div>` : ''}
                        ${slide.eyebrow ? `<div class="tiles__tile-live-weather-label">${html(slide.eyebrow)}</div>` : ''}
                        ${slide.title ? `<div class="tiles__tile-live-weather-title">${html(slide.title)}</div>` : ''}
                        ${slide.body ? `<div class="tiles__tile-live-weather-range">${html(slide.body)}</div>` : ''}
                        ${slide.meta ? `<div class="tiles__tile-live-weather-meta">${html(slide.meta)}</div>` : ''}
                    </div>
                </div>
                ${detailsMarkup}
                ${slide.footerLabel ? `<span class="tiles__tile-live-weather-footer">${html(slide.footerLabel)}</span>` : ''}
                ${slide.brandLabel ? `<span class="tiles__tile-live-weather-brand">${html(slide.brandLabel)}</span>` : ''}
                ${badgeMarkup}
            </div>
        `;
    }

    function renderCalendarSlide(slide, stackIndex, positionStyle = '', badgeMarkup = '') {
        if (slide.variant === 'calendar-date') {
            return `
                <div class="tiles__tile-live-slide tiles__tile-live-slide--calendar-dateonly" data-live-stack-index="${stackIndex}" ${positionStyle}>
                    ${renderAppBrand('calendar', 'Calendar')}
                    <div class="tiles__tile-live-calendar-date tiles__tile-live-calendar-date--solo">
                        ${slide.dayNumber ? `<div class="tiles__tile-live-calendar-day-number">${html(slide.dayNumber)}</div>` : ''}
                        ${slide.weekday ? `<div class="tiles__tile-live-calendar-day-name">${html(slide.weekday)}</div>` : ''}
                    </div>
                    ${badgeMarkup}
                </div>
            `;
        }
        const isSummary = slide.variant === 'calendar-summary' || slide.kind === 'summary';
        if (isSummary) {
            return `
                <div class="tiles__tile-live-slide tiles__tile-live-slide--calendar-summary" data-live-stack-index="${stackIndex}" ${positionStyle}>
                    <div class="tiles__tile-live-calendar-copy">
                        ${slide.title ? `<div class="tiles__tile-live-calendar-title">${html(slide.title)}</div>` : ''}
                        ${slide.body ? `<div class="tiles__tile-live-calendar-location">${html(slide.body)}</div>` : ''}
                        ${slide.meta ? `<div class="tiles__tile-live-calendar-time">${html(slide.meta)}</div>` : ''}
                    </div>
                    <div class="tiles__tile-live-calendar-date">
                        ${slide.dayNumber ? `<div class="tiles__tile-live-calendar-day-number">${html(slide.dayNumber)}</div>` : ''}
                        ${slide.weekday ? `<div class="tiles__tile-live-calendar-day-name">${html(slide.weekday)}</div>` : ''}
                    </div>
                    ${renderAppBrand('calendar', 'Calendar')}
                    ${badgeMarkup}
                </div>
            `;
        }
        return `
            <div class="tiles__tile-live-slide tiles__tile-live-slide--calendar-entry tiles__tile-live-slide--calendar-event" data-live-stack-index="${stackIndex}" ${positionStyle}>
                <div class="tiles__tile-live-calendar-copy">
                    ${slide.title ? `<div class="tiles__tile-live-calendar-entry-title">${html(slide.title)}</div>` : ''}
                    ${slide.body ? `<div class="tiles__tile-live-calendar-location">${html(slide.body)}</div>` : ''}
                    ${slide.meta ? `<div class="tiles__tile-live-calendar-time">${html(slide.meta)}</div>` : ''}
                </div>
                <div class="tiles__tile-live-calendar-date">
                    ${slide.dayNumber ? `<div class="tiles__tile-live-calendar-day-number">${html(slide.dayNumber)}</div>` : ''}
                    ${slide.weekday ? `<div class="tiles__tile-live-calendar-day-name">${html(slide.weekday)}</div>` : ''}
                </div>
                ${renderAppBrand('calendar', 'Calendar')}
                ${badgeMarkup}
            </div>
        `;
    }

    function getRenderState(appOrId) {
        const app = getApp(appOrId);
        const capable = isTileLiveCapable(app);
        const enabled = capable && isLiveTileEnabled(app);
        const sourcePayload = enabled ? getPayload(app) : null;
        const filteredSlides = eligibleSlidesFor(app, sourcePayload);
        const payload = sourcePayload && filteredSlides.length
            ? { ...sourcePayload, slides: filteredSlides }
            : null;
        const active = Boolean(payload?.slides?.length);
        return {
            capable,
            enabled,
            active,
            refreshing: Boolean(app?.id && state.inFlight.has(app.id)),
            slideIndex: active ? clampIndex(app.id, currentIndex(app)) : 0,
            payload
        };
    }

    function loadState() {
        state.enabled.clear();
        state.cache.clear();

        const liveEnabled = registry()?.loadLiveTileEnabledStates?.() || {};
        Object.keys(liveEnabled).forEach((appId) => {
            state.enabled.set(appId, Boolean(liveEnabled[appId]));
        });

        const liveCache = registry()?.loadLiveTileCache?.() || {};
        Object.keys(liveCache).forEach((appId) => {
            const payload = normalizePayload(appId, liveCache[appId]);
            if (payload) {
                state.cache.set(appId, payload);
                preloadPayloadAssets(payload);
            }
        });

        const diskCache = loadDiskCache();
        Object.keys(diskCache).forEach((appId) => {
            const payload = normalizePayload(appId, diskCache[appId]);
            if (!payload) return;
            const existing = state.cache.get(appId);
            const existingRefreshedAt = new Date(existing?.refreshedAt || 0).valueOf();
            const nextRefreshedAt = new Date(payload.refreshedAt || 0).valueOf();
            if (!existing || nextRefreshedAt >= existingRefreshedAt) {
                state.cache.set(appId, payload);
                preloadPayloadAssets(payload);
            }
        });
    }

    function saveEnabled() {
        const next = {};
        state.enabled.forEach((enabled, appId) => {
            next[appId] = Boolean(enabled);
        });
        registry()?.saveLiveTileEnabledStates?.(next);
    }

    function saveCache() {
        const next = {};
        state.cache.forEach((payload, appId) => {
            next[appId] = payload;
        });
        registry()?.saveLiveTileCache?.(next);
        saveDiskCache(next);
    }

    function preloadAsset(url) {
        if (!url || state.assetPreloads.has(url) || typeof Image === 'undefined') return;
        const image = new Image();
        image.decoding = 'async';
        image.src = url;
        state.assetPreloads.set(url, image);
    }

    function preloadPayloadAssets(payload) {
        if (!payload || !Array.isArray(payload.slides)) return;
        payload.slides.forEach((slide) => {
            preloadAsset(slide.imageUrl);
            preloadAsset(slide.iconUrl);
        });
    }

    function getOpenRefreshDelay(surface) {
        return surface === 'start-screen' ? OPEN_REFRESH_DELAY_START_SCREEN_MS : OPEN_REFRESH_DELAY_START_MENU_MS;
    }

    function getCloseResetDelay(surface) {
        return surface === 'start-screen' ? CLOSE_RESET_DELAY_START_SCREEN_MS : CLOSE_RESET_DELAY_START_MENU_MS;
    }

    function clearCloseResetTimer() {
        if (state.closeResetTimer) {
            window.clearTimeout(state.closeResetTimer);
            state.closeResetTimer = null;
        }
    }

    function setSlideTransition(slide, enabled) {
        if (!slide) return;
        slide.style.transition = enabled ? '' : 'none';
    }

    function clearSettleTimer(appId) {
        const timerId = state.settleTimers.get(appId);
        if (timerId) window.clearTimeout(timerId);
        state.settleTimers.delete(appId);
    }

    function clearToggleTimer(appId) {
        const timerId = state.toggleTimers.get(appId);
        if (timerId) window.clearTimeout(timerId);
        state.toggleTimers.delete(appId);
    }

    function positionSlidesForIndex(tile, index, animate = true) {
        const direction = tile.querySelector('.tiles__tile-live-region')?.getAttribute('data-live-direction') === 'down' ? 1 : -1;
        tile.querySelectorAll('.tiles__tile-live-slide[data-live-stack-index]').forEach((slide) => {
            const slideIndex = Number(slide.getAttribute('data-live-stack-index') || 0);
            setSlideTransition(slide, animate);
            slide.style.transform = `translateY(${(slideIndex - index) * 100 * direction}%)`;
        });
    }

    function setDisablingState(appId, disabling) {
        document.querySelectorAll(`.tiles__tile[data-app="${appId}"]`).forEach((tile) => {
            if (disabling) {
                tile.setAttribute('data-live-disabling', 'true');
            } else {
                tile.removeAttribute('data-live-disabling');
            }
        });
    }

    function animateResetToBase(tile, appId, previousIndex) {
        const direction = tile.querySelector('.tiles__tile-live-region')?.getAttribute('data-live-direction') === 'down' ? 1 : -1;
        const currentSlide = tile.querySelector(`.tiles__tile-live-slide[data-live-stack-index="${previousIndex}"]`);
        const baseSlide = tile.querySelector('.tiles__tile-live-slide[data-live-stack-index="0"]');
        if (!currentSlide || !baseSlide) {
            positionSlidesForIndex(tile, 0, false);
            return;
        }

        clearSettleTimer(appId);

        tile.querySelectorAll('.tiles__tile-live-slide[data-live-stack-index]').forEach((slide) => {
            const slideIndex = Number(slide.getAttribute('data-live-stack-index') || 0);
            setSlideTransition(slide, false);
            if (slideIndex === previousIndex) {
                slide.style.transform = 'translateY(0%)';
            } else if (slideIndex === 0) {
                slide.style.transform = `translateY(${-100 * direction}%)`;
            } else {
                slide.style.transform = `translateY(${100 * direction}%)`;
            }
        });

        void tile.offsetHeight;

        setSlideTransition(currentSlide, true);
        setSlideTransition(baseSlide, true);
        currentSlide.style.transform = `translateY(${100 * direction}%)`;
        baseSlide.style.transform = 'translateY(0%)';

        const timerId = window.setTimeout(() => {
            state.settleTimers.delete(appId);
            positionSlidesForIndex(tile, 0, false);
            window.requestAnimationFrame(() => {
                tile.querySelectorAll('.tiles__tile-live-slide[data-live-stack-index]').forEach((slide) => {
                    setSlideTransition(slide, true);
                });
            });
        }, SLIDE_TRANSITION_DURATION_MS + 20);

        state.settleTimers.set(appId, timerId);
    }

    function applySlideIndex(appId, previousIndex = null, options = {}) {
        const index = currentIndex(appId);
        document.querySelectorAll(`.tiles__tile[data-app="${appId}"]`).forEach((tile) => {
            tile.setAttribute('data-live-slide-index', String(index));

            if (options.animate !== false && previousIndex > 0 && index === 0) {
                animateResetToBase(tile, appId, previousIndex);
                return;
            }

            positionSlidesForIndex(tile, index, options.animate !== false);
        });
    }

    function setSlideIndex(appId, index, options = {}) {
        const previousIndex = currentIndex(appId);
        state.slideIndex.set(appId, clampIndex(appId, index));
        applySlideIndex(appId, previousIndex, options);
    }

    function syncAllSlides() {
        (apps()?.getAllApps?.() || []).forEach((app) => {
            if (isTileLiveCapable(app)) applySlideIndex(app.id, currentIndex(app.id), { animate: false });
        });
    }

    function syncAttributes(target, source, options = {}) {
        if (!target || !source) return;
        const preserved = new Set(Array.isArray(options.preserve) ? options.preserve : []);
        Array.from(target.attributes).forEach((attribute) => {
            if (preserved.has(attribute.name)) return;
            if (!source.hasAttribute(attribute.name)) {
                target.removeAttribute(attribute.name);
            }
        });
        Array.from(source.attributes).forEach((attribute) => {
            if (preserved.has(attribute.name)) return;
            target.setAttribute(attribute.name, attribute.value);
        });
    }

    function rerenderTileElements(appId) {
        const app = getApp(appId);
        if (!app || typeof apps()?.generateTileHTML !== 'function') return;
        const tiles = Array.from(document.querySelectorAll(`.tiles__tile[data-app="${appId}"]`));
        if (!tiles.length) return;

        const nextMarkup = apps().generateTileHTML(app).trim();
        if (!nextMarkup) return;

        const temp = document.createElement('div');
        temp.innerHTML = nextMarkup;
        const templateTile = temp.firstElementChild;
        if (!templateTile) return;

        tiles.forEach((tile) => {
            syncAttributes(tile, templateTile, { preserve: ['style'] });
            tile.className = templateTile.className;
            tile.innerHTML = templateTile.innerHTML;
        });
    }

    function clearSurfaceRefreshTimer() {
        if (state.surfaceRefreshTimer) {
            window.clearTimeout(state.surfaceRefreshTimer);
            state.surfaceRefreshTimer = null;
        }
    }

    function requestRender(appIds = null) {
        if (Array.isArray(appIds) && appIds.length) {
            appIds.forEach((appId) => {
                if (appId) state.pendingRenderApps.add(appId);
            });
        } else {
            state.fullRenderQueued = true;
        }

        if (state.renderTimer) return;
        state.renderTimer = window.setTimeout(() => {
            state.renderTimer = null;
            if (state.fullRenderQueued) {
                state.fullRenderQueued = false;
                state.pendingRenderApps.clear();
                if (typeof window.renderPinnedTiles === 'function') window.renderPinnedTiles();
                if (typeof window.renderStartMenuTiles === 'function') window.renderStartMenuTiles();
            } else if (state.pendingRenderApps.size) {
                const pending = Array.from(state.pendingRenderApps);
                state.pendingRenderApps.clear();
                pending.forEach((appId) => rerenderTileElements(appId));
            }
            window.requestAnimationFrame(syncAllSlides);
        }, 0);
    }

    function clearReveal(appId) {
        const timerId = state.revealTimers.get(appId);
        if (timerId) window.clearTimeout(timerId);
        state.revealTimers.delete(appId);
    }

    function stopRotation(appId) {
        const timerId = state.rotateTimers.get(appId);
        if (timerId) window.clearTimeout(timerId);
        state.rotateTimers.delete(appId);
    }

    function stopAllMotion() {
        state.revealTimers.forEach((timerId) => window.clearTimeout(timerId));
        state.rotateTimers.forEach((timerId) => window.clearTimeout(timerId));
        state.settleTimers.forEach((timerId) => window.clearTimeout(timerId));
        state.toggleTimers.forEach((timerId) => window.clearTimeout(timerId));
        state.revealTimers.clear();
        state.rotateTimers.clear();
        state.settleTimers.clear();
        state.toggleTimers.clear();
        clearSurfaceRefreshTimer();
        clearCloseResetTimer();
    }

    function randomBetween(min, max) {
        const start = Math.min(min, max);
        const end = Math.max(min, max);
        return Math.round(start + (Math.random() * (end - start)));
    }

    function getSlideDwellDuration(appId, slideIndex) {
        const app = getApp(appId);
        const specs = specsFor(app) || {};
        const contentType = specs.contentType || 'data';
        const dataSource = specs.dataSource || 'local';
        const baseSpeed = num(specs.moveSpeed, DEFAULT_MOVE_MS);
        const liveSlideScale = 1.15;

        if (slideIndex === 0) {
            return 2000;
        }

        if (app?.id === 'photos' || contentType === 'media') {
            return Math.round(randomBetween(Math.max(5000, baseSpeed - 2500), Math.max(7000, baseSpeed + 2500)) * liveSlideScale);
        }

        if (dataSource === 'aggregated') {
            return Math.round(randomBetween(Math.max(10000, baseSpeed - 2500), Math.max(12500, baseSpeed + 2500)) * liveSlideScale);
        }

        return Math.round(randomBetween(Math.max(9000, baseSpeed - 2000), Math.max(11500, baseSpeed + 2000)) * liveSlideScale);
    }

    function shouldPulseBackToBase(appId) {
        return slideCount(appId) > 0 && currentIndex(appId) !== 0 && Math.random() < 0.22;
    }

    function getNextSlideIndex(appId) {
        const totalLiveSlides = slideCount(appId);
        if (totalLiveSlides <= 0) {
            return 0;
        }

        const current = currentIndex(appId);

        if (current === 0) {
            state.lastLiveIndex.set(appId, 1);
            return 1;
        }

        if (shouldPulseBackToBase(appId)) {
            state.lastLiveIndex.set(appId, current);
            return 0;
        }

        const nextIndex = current >= totalLiveSlides ? 1 : current + 1;
        state.lastLiveIndex.set(appId, nextIndex);
        return nextIndex;
    }

    function queueNextRotation(appId) {
        stopRotation(appId);
        if (!state.open || !isLiveTileEnabled(appId) || slideCount(appId) <= 0) return;

        const timerId = window.setTimeout(() => {
            state.rotateTimers.delete(appId);

            if (!state.open || !isLiveTileEnabled(appId) || slideCount(appId) <= 0) {
                stopRotation(appId);
                return;
            }

            const nextIndex = getNextSlideIndex(appId);
            setSlideIndex(appId, nextIndex);
            queueNextRotation(appId);
        }, getSlideDwellDuration(appId, currentIndex(appId)));

        state.rotateTimers.set(appId, timerId);
    }

    function startRotation(appId) {
        if (currentIndex(appId) > 0) {
            state.lastLiveIndex.set(appId, currentIndex(appId));
        }
        queueNextRotation(appId);
    }

    function queueReveal(appId, delay) {
        if (!state.open || !isLiveTileEnabled(appId) || !slideCount(appId)) return;
        clearReveal(appId);
        const timerId = window.setTimeout(() => {
            state.revealTimers.delete(appId);
            if (!state.open || !slideCount(appId)) return;
            setSlideIndex(appId, 1);
            state.lastLiveIndex.set(appId, 1);
            startRotation(appId);
        }, delay);
        state.revealTimers.set(appId, timerId);
    }

    function visibleOrder() {
        const selector = state.surface === 'start-screen'
            ? '#pinned-tiles .tiles__tile[data-app]'
            : '#start-menu-tiles .tiles__tile[data-app]';
        const ids = Array.from(document.querySelectorAll(selector))
            .map((tile) => tile.getAttribute('data-app'))
            .filter(Boolean);
        return ids.length ? ids : (apps()?.getAllApps?.() || []).map((app) => app.id);
    }

    function revealVisibleTiles() {
        visibleOrder().forEach((appId, index) => {
            queueReveal(appId, OPEN_DELAY_MS + (index * STAGGER_MS));
        });
    }

    function prepareStartSurfaceOpen(surface) {
        state.surface = surface || state.surface || 'start-menu';
        state.open = false;
        stopAllMotion();
        (apps()?.getAllApps?.() || []).forEach((app) => {
            if (isTileLiveCapable(app)) {
                state.lastLiveIndex.delete(app.id);
                setSlideIndex(app.id, 0, { animate: false });
            }
        });
    }

    function initialize(options = {}) {
        if (state.ready && !options.force) return;
        stopAllMotion();
        if (state.refreshTimer) window.clearInterval(state.refreshTimer);
        loadState();
        registerProvider('photos', providePhotos);
        registerProvider('mail', provideMail);
        registerProvider('msstore', provideStore);
        registerProvider('calendar', provideCalendar);
        registerProvider('weather', provideWeather);
        (apps()?.getAllApps?.() || []).forEach((app) => {
            if (isTileLiveCapable(app)) state.slideIndex.set(app.id, 0);
        });
        state.refreshTimer = window.setInterval(() => refreshEligibleTiles({ reason: 'background' }), REFRESH_MS);
        state.ready = true;
    }

    function reload() {
        initialize({ force: true });
        requestRender();
    }

    function registerProvider(appId, provider) {
        if (appId && typeof provider === 'function') state.providers.set(appId, provider);
    }

    function getProvider(appId) {
        return state.providers.get(appId) || null;
    }

    function isFresh(app, payload) {
        const refreshedAt = new Date(payload?.refreshedAt || 0).valueOf();
        if (!Number.isFinite(refreshedAt) || refreshedAt <= 0) return false;
        return (Date.now() - refreshedAt) < ((specsFor(app)?.refreshMinutes || 30) * 60 * 1000);
    }

    async function refreshTile(appId, options = {}) {
        const app = getApp(appId);
        if (!app || !isTileLiveCapable(app) || !isLiveTileEnabled(app)) return null;
        const cached = getPayload(appId);
        const forceRefresh = options.force === true
            || (options.forceAggregated === true && specsFor(app)?.dataSource === 'aggregated');
        if (!forceRefresh && cached && isFresh(app, cached)) return cached;
        if (state.inFlight.has(appId)) return state.inFlight.get(appId);

        const provider = getProvider(appId);
        if (!provider) return cached;

        const promise = (async () => {
            let changed = false;
            try {
                const nextPayload = normalizePayload(appId, await provider({ app, cached, force: forceRefresh }));
                if (!nextPayload) return cached;
                changed = JSON.stringify(cached || null) !== JSON.stringify(nextPayload);
                state.cache.set(appId, nextPayload);
                saveCache();
                preloadPayloadAssets(nextPayload);
                setSlideIndex(appId, currentIndex(appId));
                if (state.open && slideCount(appId) > 0 && currentIndex(appId) === 0) {
                    queueReveal(appId, num(options.revealDelayMs, REVEAL_DELAY_MS));
                }
                return nextPayload;
            } catch (error) {
                console.warn(`[LiveTiles] Failed to refresh ${appId}:`, error);
                return cached;
            } finally {
                state.inFlight.delete(appId);
                if (changed) requestRender([appId]);
            }
        })();

        state.inFlight.set(appId, promise);
        return promise;
    }

    async function refreshEligibleTiles(options = {}) {
        const liveApps = (apps()?.getAllApps?.() || []).filter((app) => isTileLiveCapable(app) && isLiveTileEnabled(app));
        await Promise.allSettled(liveApps.map((app) => refreshTile(app.id, options)));
    }

    async function refreshVisibleTiles(options = {}) {
        const visibleIds = Array.from(new Set(visibleOrder()))
            .filter((appId) => {
                const app = getApp(appId);
                return app && isTileLiveCapable(app) && isLiveTileEnabled(app);
            });
        await Promise.allSettled(visibleIds.map((appId) => refreshTile(appId, options)));
    }

    function hydrateMissingCaches() {
        (apps()?.getAllApps?.() || []).forEach((app) => {
            if (!isTileLiveCapable(app) || !isLiveTileEnabled(app) || getPayload(app)) return;
            refreshTile(app.id, { reason: 'startup', force: true }).catch(() => null);
        });
    }

    function setLiveTileEnabled(appId, enabled) {
        const app = getApp(appId);
        if (!app || !isTileLiveCapable(app)) return false;
        clearToggleTimer(appId);
        setDisablingState(appId, false);

        if (!enabled) {
            clearReveal(appId);
            stopRotation(appId);
            clearSettleTimer(appId);

            if (state.open && getPayload(appId)) {
                setSlideIndex(appId, 0, { animate: true });
                setDisablingState(appId, true);

                const timerId = window.setTimeout(() => {
                    state.toggleTimers.delete(appId);
                    state.enabled.set(appId, false);
                    saveEnabled();
                    state.lastLiveIndex.delete(appId);
                    setDisablingState(appId, false);
                    setSlideIndex(appId, 0, { animate: false });
                    requestRender([appId]);
                }, DISABLE_FADE_DURATION_MS);

                state.toggleTimers.set(appId, timerId);
                return true;
            }

            state.enabled.set(appId, false);
            saveEnabled();
            state.lastLiveIndex.delete(appId);
            setSlideIndex(appId, 0, { animate: false });
            requestRender([appId]);
            return true;
        }

        state.enabled.set(appId, true);
        saveEnabled();
        state.lastLiveIndex.delete(appId);
        setSlideIndex(appId, 0, { animate: false });
        requestRender([appId]);

        if (state.open) {
            if (getPayload(appId)) {
                queueReveal(appId, ENABLE_REVEAL_DELAY_MS);
            } else {
                refreshTile(appId, { reason: 'enabled', force: true, revealDelayMs: ENABLE_REVEAL_DELAY_MS }).catch(() => null);
            }
        } else if (!getPayload(appId)) {
            refreshTile(appId, { reason: 'enabled', force: true }).catch(() => null);
        }

        return true;
    }

    function handleStartSurfaceOpened(surface) {
        state.open = true;
        state.surface = surface || state.surface || 'start-menu';
        revealVisibleTiles();
        state.surfaceRefreshTimer = window.setTimeout(() => {
            state.surfaceRefreshTimer = null;
            refreshVisibleTiles({ reason: `${state.surface}-open`, forceAggregated: true }).catch(() => null);
        }, getOpenRefreshDelay(state.surface));
    }

    function handleStartSurfaceClosed() {
        state.open = false;
        stopAllMotion();
        state.closeResetTimer = window.setTimeout(() => {
            state.closeResetTimer = null;
            (apps()?.getAllApps?.() || []).forEach((app) => {
                if (isTileLiveCapable(app)) {
                    state.lastLiveIndex.delete(app.id);
                    setSlideIndex(app.id, 0, { animate: false });
                }
            });
        }, getCloseResetDelay(state.surface));
        if (state.deferredRenderApps.size) {
            const pending = Array.from(state.deferredRenderApps);
            state.deferredRenderApps.clear();
            requestRender(pending);
        }
    }

    async function providePhotos(_context = {}) {
        if (!fsPromises || !path) return null;
        const savedState = json(window.localStorage?.getItem(PHOTOS_KEY), {}) || {};
        let sources = Array.isArray(savedState.sources) ? savedState.sources : [];
        if (!sources.length && ipc?.invoke) {
            try {
                const result = await ipc.invoke('desktop-background-get-pictures-folder');
                if (result?.success && result.folderPath) sources = [{ path: result.folderPath }];
            } catch (_error) {
                sources = [];
            }
        }
        const photos = [];
        const walk = async (dirPath, depth) => {
            if (!dirPath || depth < 0 || photos.length >= 8) return;
            try {
                const entries = await fsPromises.readdir(dirPath, { withFileTypes: true });
                for (const entry of entries) {
                    if (photos.length >= 8) return;
                    const fullPath = path.join(dirPath, entry.name);
                    if (entry.isDirectory() && !entry.name.startsWith('.')) {
                        await walk(fullPath, depth - 1);
                    } else if (entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
                        try {
                            const stats = await fsPromises.stat(fullPath);
                            photos.push({ name: entry.name, path: fullPath, folder: path.basename(dirPath), mtimeMs: stats.mtimeMs });
                        } catch (_error) {
                            continue;
                        }
                    }
                }
            } catch (_error) {
                return;
            }
        };
        for (const source of sources) await walk(source?.path, 2);
        const selectedPhotos = photos.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 4);
        const slides = (await Promise.all(selectedPhotos.map(async (photo) => ({
            kind: 'image',
            imageUrl: await ensurePhotoThumbnail(photo)
        })))).filter((slide) => slide.imageUrl);
        return slides.length ? { contentType: 'media', dataSource: 'local', refreshedAt: new Date().toISOString(), slides } : null;
    }

    async function provideMail(_context = {}) {
        let source = 'local';
        let data = DEFAULT_MAIL;
        if (ipc?.invoke) {
            try {
                const result = await ipc.invoke('google-mail:get-bootstrap-data');
                if (result?.success) {
                    data = result;
                    source = 'aggregated';
                }
            } catch (_error) {
                source = 'local';
            }
        }
        const allMessages = Object.values(data.messages || {}).flat();
        const unread = allMessages.filter((message) => message?.unread).length;
        tileBadges()?.setCount?.('mail', 'unread', unread, { label: unread === 1 ? '1 unread email' : `${unread} unread emails` });
        // One latest message per canonical category (capped at 5 to stay within the 6-slide normalizer limit)
        const categoryMessages = [];
        for (const folderId of MAIL_CATEGORY_ORDER) {
            const msgs = Array.isArray(data.messages?.[folderId]) ? data.messages[folderId] : [];
            if (msgs.length) categoryMessages.push(msgs[0]);
        }
        const slides = [];
        // Multi slide goes first so it's never cut off by the normalizer's 6-slide limit
        if (categoryMessages.length >= 2) {
            slides.push({
                kind: 'text',
                variant: 'mail-multi',
                sizes: ['large'],
                messages: categoryMessages.slice(0, 3).map((message) => ({ from: message.from || 'Mail', preview: message.preview || '' }))
            });
        } else if (categoryMessages.length === 1) {
            slides.push({
                kind: 'text',
                variant: 'mail-message',
                sizes: ['large'],
                title: categoryMessages[0].from || 'Mail',
                meta: categoryMessages[0].preview || ''
            });
        }
        categoryMessages.forEach((message) => slides.push({
            kind: 'text',
            variant: 'mail-message',
            sizes: ['small', 'medium', 'wide'],
            title: message.from || 'Mail',
            meta: message.preview || ''
        }));
        if (!slides.length) {
            slides.push({
                kind: 'text',
                variant: 'mail-message',
                title: 'Mail',
                meta: source === 'aggregated' ? 'Synced with Google Mail' : 'Local inbox snapshot'
            });
        }
        return { schemaVersion: MAIL_TILE_SCHEMA_VERSION, contentType: 'data', dataSource: source, refreshedAt: new Date().toISOString(), slides };
    }

    function provideStore() {
        const slides = DEFAULT_STORE_SLIDES.map((slide) => ({
            kind: 'text',
            variant: slide.variant,
            sizes: Array.isArray(slide.sizes) ? slide.sizes : [],
            title: slide.title || '',
            label: slide.label || '',
            name: slide.name || '',
            description: slide.description || '',
            price: slide.price || '',
            color: slide.color || '',
            iconUrl: slide.iconUrl || '',
            apps: Array.isArray(slide.apps) ? slide.apps.map((a) => ({
                name: a.name || '',
                price: a.price || '',
                color: a.color || '',
                iconUrl: a.iconUrl || ''
            })) : []
        }));
        return { schemaVersion: STORE_TILE_SCHEMA_VERSION, contentType: 'data', dataSource: 'local', refreshedAt: new Date().toISOString(), slides };
    }

    async function provideCalendar(context = {}) {
        let source = 'local';
        let events = DEFAULT_EVENTS;
        if (ipc?.invoke) {
            try {
                const result = await ipc.invoke('google-calendar:get-bootstrap-data', { allowStale: true, forceRefresh: Boolean(context.force) });
                if (result?.success && Array.isArray(result.events) && result.events.length) {
                    events = result.events;
                    source = 'aggregated';
                }
            } catch (_error) {
                source = 'local';
            }
        }
        const upcoming = events
            .map((event) => ({ ...event, sortKey: `${event.date || ''}T${event.start || '00:00'}` }))
            .sort((left, right) => left.sortKey.localeCompare(right.sortKey))
            .slice(0, 3);
        if (!upcoming.length) return null;
        const first = upcoming[0];
        const slides = [{
            kind: 'summary',
            variant: 'calendar-summary',
            title: first.title,
            body: first.location || (first.calendarTitle || 'Calendar'),
            meta: formatCalendarRelativeLabel(first),
            dayNumber: formatDayNumber(first.date),
            weekday: formatWeekdayLong(first.date)
        }, {
            kind: 'summary',
            variant: 'calendar-date',
            dayNumber: formatTodayDayNumber(),
            weekday: formatTodayWeekday()
        }];
        upcoming.forEach((event) => slides.push({
            kind: 'text',
            variant: 'calendar-entry',
            title: event.title,
            body: event.location || '',
            meta: formatCalendarTimeRange(event) || (event.allDay ? 'All day' : formatRelativeDay(event.date)),
            dayNumber: formatDayNumber(event.date),
            weekday: formatWeekdayLong(event.date)
        }));
        return { contentType: 'data', dataSource: source, refreshedAt: new Date().toISOString(), slides };
    }

    async function provideWeather(_context = {}) {
        const savedState = json(window.localStorage?.getItem(WEATHER_KEY), { currentLocation: null, useFahrenheit: true }) || {};
        const location = savedState.currentLocation || DEFAULT_WEATHER_LOCATION;
        const useFahrenheit = savedState.useFahrenheit !== false;
        const params = new URLSearchParams({
            latitude: location.latitude,
            longitude: location.longitude,
            current: 'temperature_2m,apparent_temperature,weather_code,is_day',
            daily: 'weather_code,temperature_2m_max,temperature_2m_min',
            temperature_unit: useFahrenheit ? 'fahrenheit' : 'celsius',
            timezone: 'auto',
            forecast_days: 4
        });
        const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
        if (!response.ok) throw new Error(`Weather request failed with ${response.status}`);
        const weather = await response.json();
        const unit = useFahrenheit ? 'F' : 'C';
        const current = weather.current || {};
        const daily = weather.daily || {};
        const currentCode = Number(current.weather_code);
        const currentTheme = weatherThemeName(currentCode, Boolean(current.is_day));
        const slides = [{
            kind: 'summary',
            variant: 'current',
            sizes: ['small', 'medium', 'wide'],
            eyebrow: location.name || 'Weather',
            value: formatTemperatureValue(current.temperature_2m),
            title: weatherCaption(currentCode),
            body: formatTemperaturePair(daily.temperature_2m_max?.[0], daily.temperature_2m_min?.[0], unit),
            footerLabel: location.name || 'Weather',
            iconUrl: weatherSkycodePath(currentCode, Boolean(current.is_day), '48x48')
        }, {
            kind: 'summary',
            variant: 'current',
            sizes: ['large'],
            eyebrow: location.name || 'Weather',
            value: formatTemperatureValue(current.temperature_2m),
            title: weatherCaption(currentCode),
            body: formatTemperaturePair(daily.temperature_2m_max?.[0], daily.temperature_2m_min?.[0], unit),
            footerLabel: location.name || 'Weather',
            brandLabel: 'Weather',
            iconUrl: weatherSkycodePath(currentCode, Boolean(current.is_day), '48x48'),
            theme: currentTheme,
            backgroundUrl: weatherBackdropPath(currentTheme),
            items: [
                {
                    label: 'Today',
                    value: formatWeatherForecastLine(daily.temperature_2m_max?.[0], daily.temperature_2m_min?.[0], Number(daily.weather_code?.[0]), unit)
                },
                {
                    label: 'Tomorrow',
                    value: formatWeatherForecastLine(daily.temperature_2m_max?.[1], daily.temperature_2m_min?.[1], Number(daily.weather_code?.[1]), unit)
                }
            ].filter((item) => item.value)
        }];
        (daily.time || []).slice(0, 3).forEach((date, index) => slides.push({
            kind: 'summary',
            variant: 'forecast',
            sizes: ['medium', 'wide'],
            eyebrow: formatWeekday(date),
            value: formatTemperatureValue(daily.temperature_2m_max?.[index]),
            title: weatherCaption(Number(daily.weather_code?.[index])),
            body: formatTemperaturePair(daily.temperature_2m_max?.[index], daily.temperature_2m_min?.[index], unit),
            footerLabel: location.name || 'Weather',
            iconUrl: weatherSkycodePath(Number(daily.weather_code?.[index]), true, '30x30')
        }));
        return { schemaVersion: WEATHER_TILE_SCHEMA_VERSION, contentType: 'data', dataSource: 'aggregated', refreshedAt: new Date().toISOString(), slides };
    }

    function formatWeekday(dateString) {
        const date = new Date(`${dateString}T00:00:00`);
        return Number.isNaN(date.valueOf()) ? 'Forecast' : date.toLocaleDateString('en-US', { weekday: 'short' });
    }

    function formatWeekdayShort(dateString) {
        const date = new Date(`${dateString}T00:00:00`);
        return Number.isNaN(date.valueOf()) ? '' : date.toLocaleDateString('en-US', { weekday: 'short' });
    }

    function formatWeekdayLong(dateString) {
        const date = new Date(`${dateString}T00:00:00`);
        return Number.isNaN(date.valueOf()) ? '' : date.toLocaleDateString('en-US', { weekday: 'long' });
    }

    function formatDayNumber(dateString) {
        const date = new Date(`${dateString}T00:00:00`);
        return Number.isNaN(date.valueOf()) ? '' : String(date.getDate());
    }

    function formatTodayDayNumber() {
        return String(new Date().getDate());
    }

    function formatTodayWeekday() {
        return new Date().toLocaleDateString('en-US', { weekday: 'long' });
    }

    function formatDateShort(dateString) {
        const date = new Date(`${dateString}T00:00:00`);
        return Number.isNaN(date.valueOf()) ? '' : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    function formatDateLong(dateString) {
        const date = new Date(`${dateString}T00:00:00`);
        return Number.isNaN(date.valueOf()) ? '' : date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    }

    function formatRelativeDay(dateString) {
        const date = new Date(`${dateString}T00:00:00`);
        if (Number.isNaN(date.valueOf())) return '';
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const diffDays = Math.round((date.getTime() - today.getTime()) / 86400000);
        if (diffDays === 0) return 'Today';
        if (diffDays === 1) return 'Tomorrow';
        if (diffDays === -1) return 'Yesterday';
        return date.toLocaleDateString('en-US', { weekday: 'short' });
    }

    function formatClockTime(timeString) {
        if (!timeString || typeof timeString !== 'string') return '';
        const [hourRaw, minuteRaw = '00'] = timeString.split(':');
        const hours = Number(hourRaw);
        const minutes = Number(minuteRaw);
        if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return timeString;
        const normalizedHour = ((hours % 24) + 24) % 24;
        const suffix = normalizedHour >= 12 ? 'PM' : 'AM';
        const hour12 = normalizedHour % 12 || 12;
        return `${hour12}:${String(minutes).padStart(2, '0')} ${suffix}`;
    }

    function formatCalendarTimeRange(event) {
        if (!event) return '';
        if (event.allDay) return 'All day';
        const start = formatClockTime(event.start);
        const end = formatClockTime(event.end);
        if (start && end) return `${start} - ${end}`;
        return start || end || '';
    }

    function formatCalendarRelativeLabel(event) {
        if (!event) return '';
        const relativeDay = formatRelativeDay(event.date);
        if (event.allDay) return relativeDay ? `${relativeDay}, All day` : 'All day';
        const start = formatClockTime(event.start);
        return [relativeDay, start].filter(Boolean).join(', ');
    }

    function weatherCaption(code) {
        return WEATHER_CODES[code]?.caption || 'Weather';
    }

    function weatherThemeName(code, isDay) {
        if (!isDay) return 'night';
        if ([95, 96, 99].includes(code)) return 'storm';
        if ([61, 63, 65, 66, 67, 80, 81, 82, 51, 53, 55, 56, 57].includes(code)) return 'rain';
        if ([71, 73, 75, 77, 85, 86].includes(code)) return 'snow';
        if ([3, 45, 48].includes(code)) return 'cloudy';
        return 'day';
    }

    function weatherBackdropPath(theme) {
        return ['rain', 'storm', 'snow'].includes(theme) ? WEATHER_PANORAMA_URL : '';
    }

    function weatherSkycodePath(code, isDay, size = '48x48') {
        const entry = WEATHER_CODES[code] || WEATHER_CODES[0];
        const skycode = isDay ? entry.day : entry.night;
        return `${WEATHER_APP_BASE}resources/skycodes/${size}/${skycode}.png`;
    }

    function formatTemperatureValue(value) {
        return `${Number.isFinite(value) ? Math.round(value) : '--'}°`;
    }

    function formatTemperaturePair(high, low, _unit) {
        const highValue = Number.isFinite(high) ? Math.round(high) : null;
        const lowValue = Number.isFinite(low) ? Math.round(low) : null;
        if (highValue == null && lowValue == null) return '';
        return `${highValue == null ? '--' : highValue}°/${lowValue == null ? '--' : lowValue}°`;
    }

    function formatWeatherForecastLine(high, low, code, unit) {
        const pair = formatTemperaturePair(high, low, unit);
        const caption = weatherCaption(code);
        if (!pair && !caption) return '';
        if (!pair) return Number.isFinite(code) && caption !== 'Weather' ? caption : '';
        if (!caption || caption === 'Weather') return pair;
        return `${pair} ${caption}`;
    }

    window.LiveTiles = {
        initialize,
        reload,
        registerProvider,
        isTileLiveCapable,
        isLiveTileEnabled,
        setLiveTileEnabled,
        getRenderState,
        renderLiveTileRegion,
        refreshTile,
        refreshEligibleTiles,
        refreshVisibleTiles,
        prepareStartSurfaceOpen,
        handleStartSurfaceOpened,
        handleStartSurfaceClosed,
        isSurfaceOpen: () => state.open,
        deferTileRender: (appIds = []) => {
            appIds.forEach((appId) => {
                if (appId) state.deferredRenderApps.add(appId);
            });
        },
        requestTileRender: requestRender,
        syncAllSlidesToDom: syncAllSlides
    };
})();
