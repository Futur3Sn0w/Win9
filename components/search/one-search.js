(function (root, factory) {
    const api = factory(root);

    if (root && typeof root === 'object') {
        root.OneSearch = api;
    }

    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
    let pathToFileURL = null;

    try {
        if (typeof require === 'function') {
            ({ pathToFileURL } = require('url'));
        }
    } catch (error) {
        pathToFileURL = null;
    }

    const APP_TILE_COLORS = {
        teal: '#00A0B1',
        blue: '#0A5BC4',
        magenta: '#A700AE',
        purple: '#643EBF',
        red: '#BF1E4B',
        orange: '#DC572E',
        green: '#00A600',
        sky: '#2E8DEF',
        grey: '#7D7D7D'
    };

    let settingsCatalog = [];
    let settingsCatalogPromise = null;
    let settingsCatalogLoaded = false;
    let filesCatalog = [];
    let filesCatalogPromise = null;
    let filesCatalogLoaded = false;

    function getAppTileColor(colorKey) {
        if (!colorKey) {
            return APP_TILE_COLORS.blue;
        }

        if (typeof colorKey === 'string' && colorKey.startsWith('#')) {
            return colorKey;
        }

        return APP_TILE_COLORS[colorKey] || APP_TILE_COLORS.blue;
    }

    function normalizeSources(sources) {
        const requested = Array.isArray(sources) && sources.length
            ? sources
            : ['apps'];
        const normalized = [];

        requested.forEach(source => {
            const value = String(source || '').trim().toLowerCase();
            if (!value) {
                return;
            }

            if (value === 'all' || value === 'everything') {
                ['apps', 'settings', 'files', 'web'].forEach(item => {
                    if (!normalized.includes(item)) {
                        normalized.push(item);
                    }
                });
                return;
            }

            if (['apps', 'settings', 'files', 'web'].includes(value) && !normalized.includes(value)) {
                normalized.push(value);
            }
        });

        return normalized.length ? normalized : ['apps'];
    }

    function normalizeSearchTokens(value) {
        return String(value || '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .trim()
            .split(/\s+/)
            .filter(Boolean);
    }

    function calculateSearchScore(query, fields, sourceBias = 0) {
        const normalizedFields = (Array.isArray(fields) ? fields : [fields])
            .map(field => String(field || '').toLowerCase().trim())
            .filter(Boolean);

        if (!normalizedFields.length) {
            return 0;
        }

        const normalizedQuery = String(query || '').toLowerCase().trim();
        if (!normalizedQuery) {
            return sourceBias;
        }

        const tokens = normalizeSearchTokens(normalizedQuery);
        if (!tokens.length) {
            return sourceBias;
        }

        let score = sourceBias;

        for (const token of tokens) {
            let tokenScore = 0;

            normalizedFields.forEach((field, index) => {
                const fieldBias = Math.max(0, 12 - index * 2);

                if (field === token) {
                    tokenScore = Math.max(tokenScore, 180 + fieldBias);
                    return;
                }

                if (field.startsWith(token)) {
                    tokenScore = Math.max(tokenScore, 120 + fieldBias);
                    return;
                }

                if (field.includes(` ${token}`)) {
                    tokenScore = Math.max(tokenScore, 90 + fieldBias);
                    return;
                }

                if (field.includes(token)) {
                    tokenScore = Math.max(tokenScore, 60 + fieldBias);
                }
            });

            if (tokenScore === 0) {
                return 0;
            }

            score += tokenScore;
        }

        return score;
    }

    function buildResult(baseResult) {
        const kind = baseResult.kind || baseResult.type || 'result';
        return {
            ...baseResult,
            kind,
            type: kind
        };
    }

    function toAssetUrl(assetPath) {
        if (!assetPath || typeof assetPath !== 'string') {
            return assetPath;
        }

        if (
            assetPath.startsWith('http://') ||
            assetPath.startsWith('https://') ||
            assetPath.startsWith('file://') ||
            assetPath.startsWith('data:')
        ) {
            return assetPath;
        }

        if (/^[A-Z]:[\\/]/i.test(assetPath) || assetPath.startsWith('\\\\')) {
            if (pathToFileURL) {
                try {
                    return pathToFileURL(assetPath).href;
                } catch (error) {
                    console.warn('[OneSearch] Failed to convert filesystem icon path:', assetPath, error);
                }
            }

            return assetPath;
        }

        if (root?.location?.href) {
            try {
                return new URL(assetPath, root.location.href).href;
            } catch (error) {
                console.warn('[OneSearch] Failed to resolve icon path:', assetPath, error);
            }
        }

        return assetPath;
    }

    function getAppIcon(app, size = 32) {
        if (!app || !root.AppsManager) {
            return {
                className: '',
                style: '',
                html: '<span class="sui-all-apps"></span>'
            };
        }

        const iconImage = typeof root.AppsManager.getIconImage === 'function'
            ? root.AppsManager.getIconImage(app, size)
            : null;
        const logoImage = !iconImage && typeof root.AppsManager.getAppListLogo === 'function'
            ? root.AppsManager.getAppListLogo(app)
            : null;
        const usePlate = app.type === 'modern';
        const style = usePlate && app.color
            ? `background:${getAppTileColor(app.color)}`
            : '';

        if (iconImage) {
            return {
                className: usePlate ? 'search-panel-result-icon--plate' : '',
                style,
                html: `<img src="${toAssetUrl(iconImage)}" alt="">`
            };
        }

        if (logoImage) {
            return {
                className: usePlate ? 'search-panel-result-icon--plate' : '',
                style,
                html: `<img src="${toAssetUrl(logoImage)}" alt="">`
            };
        }

        if (app.icon) {
            return {
                className: usePlate ? 'search-panel-result-icon--plate' : '',
                style,
                html: `<span class="${app.icon}"></span>`
            };
        }

        return {
            className: '',
            style: '',
            html: '<span class="sui-all-apps"></span>'
        };
    }

    function getFileIcon(entry, size = 32) {
        const iconBuilder = root.ExplorerIconBuilder;
        const iconSource = iconBuilder && typeof iconBuilder.getIconSourceCandidates === 'function'
            ? (iconBuilder.getIconSourceCandidates(entry, size)[0] || '')
            : '';

        if (iconSource) {
            return {
                className: '',
                style: '',
                html: `<img src="${toAssetUrl(iconSource)}" alt="">`
            };
        }

        return {
            className: '',
            style: '',
            html: entry?.type === 'folder'
                ? '<span class="sui-folder"></span>'
                : '<span class="sui-document"></span>'
        };
    }

    function getSearchableApps() {
        if (!root.AppsManager || typeof root.AppsManager.getAllApps !== 'function') {
            return [];
        }

        return root.AppsManager.getAllApps().filter(app =>
            app &&
            app.showInSearch !== false
        );
    }

    function getAppSubtitle(app) {
        if (!app) {
            return 'App';
        }

        if (app.id === 'recycle-bin') {
            return 'System location';
        }

        if (app.launchTargetAppId === 'explorer' && app.id !== 'explorer') {
            return 'Folder location';
        }

        return app.type === 'modern' ? 'App' : 'Desktop app';
    }

    function createAppResults(query) {
        const normalizedQuery = String(query || '').trim();
        const apps = getSearchableApps();

        if (!normalizedQuery) {
            const preferredOrder = ['iexplore', 'explorer', 'settings', 'control-panel', 'run', 'recycle-bin'];
            const byId = new Map(apps.map(app => [app.id, app]));

            return preferredOrder
                .map(id => byId.get(id))
                .filter(Boolean)
                .map((app, index) => buildResult({
                    id: `app:${app.id}`,
                    source: 'apps',
                    group: 'Apps',
                    kind: 'app',
                    title: app.name,
                    subtitle: getAppSubtitle(app),
                    score: 320 - (index * 8),
                    icon: getAppIcon(app),
                    action: {
                        type: 'launch-app',
                        appId: app.id
                    }
                }));
        }

        return apps
            .map(app => {
                const score = calculateSearchScore(normalizedQuery, [
                    app.name,
                    app.id,
                    ...(Array.isArray(app.runCommands) ? app.runCommands : [])
                ], 36);

                if (!score) {
                    return null;
                }

                return buildResult({
                    id: `app:${app.id}`,
                    source: 'apps',
                    group: 'Apps',
                    kind: 'app',
                    title: app.name,
                    subtitle: getAppSubtitle(app),
                    score,
                    icon: getAppIcon(app),
                    action: {
                        type: 'launch-app',
                        appId: app.id
                    }
                });
            })
            .filter(Boolean);
    }

    function ensureSettingsCatalog() {
        if (settingsCatalogLoaded) {
            return Promise.resolve(settingsCatalog);
        }

        if (settingsCatalogPromise) {
            return settingsCatalogPromise;
        }

        settingsCatalogPromise = Promise.all([
            fetch('apps/modern/settings/settings-data.json').then(response => response.json()),
            fetch('apps/classic/control/data/applets.json').then(response => response.json())
        ])
            .then(([settingsData, appletsData]) => {
                const catalog = [];

                Object.entries(settingsData || {}).forEach(([categoryId, categoryData]) => {
                    if (!categoryData?.name) {
                        return;
                    }

                    catalog.push(buildResult({
                        id: `settings:${categoryId}`,
                        source: 'settings',
                        group: 'Settings',
                        kind: 'setting',
                        title: categoryData.name,
                        subtitle: 'PC settings',
                        icon: {
                            className: 'search-panel-result-icon--plate',
                            style: `background:${getAppTileColor('purple')}`,
                            html: '<span class="sui-settings"></span>'
                        },
                        searchFields: [categoryData.name, categoryId.replace(/-/g, ' '), 'pc settings', 'settings'],
                        action: {
                            type: 'open-settings',
                            categoryId
                        }
                    }));

                    Object.entries(categoryData.items || {}).forEach(([itemId, itemData]) => {
                        const sectionTitles = Array.isArray(itemData?.sections)
                            ? itemData.sections.map(section => section.title)
                            : [];

                        catalog.push(buildResult({
                            id: `settings:${categoryId}:${itemId}`,
                            source: 'settings',
                            group: 'Settings',
                            kind: 'setting',
                            title: itemData?.name || itemId,
                            subtitle: `PC settings - ${categoryData.name}`,
                            icon: {
                                className: 'search-panel-result-icon--plate',
                                style: `background:${getAppTileColor('purple')}`,
                                html: '<span class="sui-settings"></span>'
                            },
                            searchFields: [
                                itemData?.name || itemId,
                                categoryData.name,
                                ...sectionTitles,
                                categoryId.replace(/-/g, ' '),
                                itemId.replace(/-/g, ' '),
                                'pc settings',
                                'settings'
                            ],
                            action: {
                                type: 'open-settings',
                                categoryId,
                                itemId
                            }
                        }));
                    });
                });

                const applets = Array.isArray(appletsData?.applets) ? appletsData.applets : [];
                applets.forEach(applet => {
                    catalog.push(buildResult({
                        id: `applet:${applet.id}`,
                        source: 'settings',
                        group: 'Settings',
                        kind: 'applet',
                        title: applet.name,
                        subtitle: 'Control Panel',
                        icon: {
                            className: '',
                            style: '',
                            html: applet.icon ? `<span class="${applet.icon}"></span>` : '<span class="sui-settings"></span>'
                        },
                        searchFields: [applet.name, applet.description, applet.id, 'control panel'],
                        action: {
                            type: 'open-control-panel-applet',
                            appletId: applet.id
                        }
                    }));
                });

                settingsCatalog = catalog;
                settingsCatalogLoaded = true;
                return settingsCatalog;
            })
            .catch(error => {
                console.error('[OneSearch] Failed to load settings catalog:', error);
                settingsCatalog = [];
                settingsCatalogLoaded = false;
                return settingsCatalog;
            })
            .finally(() => {
                settingsCatalogPromise = null;
            });

        return settingsCatalogPromise;
    }

    function createSettingsResults(query) {
        const normalizedQuery = String(query || '').trim();

        if (!normalizedQuery) {
            const defaultIds = new Set([
                'settings:search-and-apps',
                'settings:display',
                'applet:indexing-options',
                'applet:folder-options'
            ]);

            return settingsCatalog
                .filter(entry => defaultIds.has(entry.id))
                .slice(0, 4)
                .map((entry, index) => ({
                    ...entry,
                    score: 280 - (index * 6)
                }));
        }

        return settingsCatalog
            .map(entry => {
                const score = calculateSearchScore(normalizedQuery, entry.searchFields, 28);
                if (!score) {
                    return null;
                }

                return {
                    ...entry,
                    score
                };
            })
            .filter(Boolean);
    }

    function ensureFilesCatalog(options = {}) {
        const { refresh = false } = options;

        if (filesCatalogPromise && !refresh) {
            return filesCatalogPromise;
        }

        if (filesCatalogLoaded && !refresh) {
            return Promise.resolve(filesCatalog);
        }

        if (refresh) {
            filesCatalogPromise = null;
        }

        const explorerEngine = root.ExplorerEngine;
        if (!explorerEngine) {
            filesCatalog = [];
            return Promise.resolve(filesCatalog);
        }

        const loader = typeof explorerEngine.readKnownFolderEntries === 'function'
            ? explorerEngine.readKnownFolderEntries()
            : (typeof explorerEngine.readDesktopEntries === 'function'
                ? explorerEngine.readDesktopEntries()
                : Promise.resolve([]));

        filesCatalogPromise = Promise.resolve(loader)
            .then(entries => {
                filesCatalog = Array.isArray(entries) ? entries : [];
                filesCatalogLoaded = true;
                return filesCatalog;
            })
            .catch(error => {
                console.error('[OneSearch] Failed to load files catalog:', error);
                filesCatalog = [];
                filesCatalogLoaded = false;
                return filesCatalog;
            })
            .finally(() => {
                filesCatalogPromise = null;
            });

        return filesCatalogPromise;
    }

    function getFileSubtitle(entry) {
        const locationName = entry?.locationName || 'Desktop';
        return entry?.type === 'folder'
            ? `${locationName} folder`
            : `${locationName} file`;
    }

    function createFileResults(query) {
        const normalizedQuery = String(query || '').trim();

        if (!normalizedQuery) {
            return filesCatalog
                .slice()
                .sort((left, right) => Number(right.modifiedTime || 0) - Number(left.modifiedTime || 0))
                .slice(0, 4)
                .map((entry, index) => buildResult({
                    id: `file:${entry.path}`,
                    source: 'files',
                    group: 'Files',
                    kind: entry.type === 'folder' ? 'folder' : 'file',
                    title: entry.name,
                    subtitle: getFileSubtitle(entry),
                    score: 214 - (index * 6),
                    icon: getFileIcon(entry),
                    action: {
                        type: 'open-entry-path',
                        path: entry.path,
                        itemType: entry.type
                    }
                }));
        }

        return filesCatalog
            .map(entry => {
                const score = calculateSearchScore(normalizedQuery, [
                    entry.name,
                    entry.typeLabel,
                    entry.extension,
                    entry.locationName
                ], 18);

                if (!score) {
                    return null;
                }

                return buildResult({
                    id: `file:${entry.path}`,
                    source: 'files',
                    group: 'Files',
                    kind: entry.type === 'folder' ? 'folder' : 'file',
                    title: entry.name,
                    subtitle: getFileSubtitle(entry),
                    score,
                    icon: getFileIcon(entry),
                    action: {
                        type: 'open-entry-path',
                        path: entry.path,
                        itemType: entry.type
                    }
                });
            })
            .filter(Boolean);
    }

    function finalizeResults(results, limit) {
        const visibleResults = [];
        const seen = new Set();

        results
            .sort((left, right) => {
                if (right.score !== left.score) {
                    return right.score - left.score;
                }

                return String(left.title || '').localeCompare(String(right.title || ''), undefined, {
                    sensitivity: 'base'
                });
            })
            .forEach(result => {
                if (!result || seen.has(result.id)) {
                    return;
                }

                if (Number.isFinite(limit) && visibleResults.length >= limit) {
                    return;
                }

                seen.add(result.id);
                visibleResults.push(result);
            });

        return visibleResults;
    }

    function search(options = {}) {
        const {
            query = '',
            sources = ['apps'],
            limit = null
        } = options;
        const normalizedSources = normalizeSources(sources);
        let combined = [];

        if (normalizedSources.includes('apps')) {
            combined = combined.concat(createAppResults(query));
        }

        if (normalizedSources.includes('settings')) {
            combined = combined.concat(createSettingsResults(query));
        }

        if (normalizedSources.includes('files')) {
            combined = combined.concat(createFileResults(query));
        }

        return finalizeResults(combined, Number.isFinite(limit) ? Number(limit) : null);
    }

    function ensureSources(options = {}) {
        const {
            sources = ['apps'],
            refreshFiles = false
        } = options;
        const normalizedSources = normalizeSources(sources);
        const tasks = [];

        if (normalizedSources.includes('settings')) {
            tasks.push(ensureSettingsCatalog());
        }

        if (normalizedSources.includes('files')) {
            tasks.push(ensureFilesCatalog({ refresh: refreshFiles }));
        }

        return Promise.allSettled(tasks);
    }

    function execute(result) {
        const action = result?.action || {};

        switch (action.type) {
            case 'launch-app':
                if (typeof root.launchApp === 'function') {
                    root.launchApp(action.appId, null, { fromTaskbar: true });
                }
                break;

            case 'open-settings':
                if (typeof root.openSettingsCategory === 'function') {
                    root.openSettingsCategory(action.categoryId, action.itemId || null);
                }
                break;

            case 'open-control-panel-applet':
                if (typeof root.openControlPanelApplet === 'function') {
                    root.openControlPanelApplet(action.appletId);
                }
                break;

            case 'open-entry-path':
                if (root.ExplorerEngine && typeof root.ExplorerEngine.openEntryPath === 'function') {
                    root.ExplorerEngine.openEntryPath(action.path, action.itemType);
                }
                break;

            case 'open-search-app':
                if (typeof root.launchSearchResultsApp === 'function') {
                    root.launchSearchResultsApp(action.query || '', action.source || 'all');
                }
                break;

            default:
                console.warn('[OneSearch] Unsupported action:', action, result);
                break;
        }
    }

    return {
        search,
        ensureSources,
        execute
    };
});
