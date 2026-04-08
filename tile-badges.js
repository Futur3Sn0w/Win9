(function () {
    'use strict';

    const state = {
        ready: false,
        sourcesByApp: new Map(),
        notificationOwners: new Map(),
        notificationCounts: new Map()
    };

    const html = (value) => String(value == null ? '' : value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll('\'', '&#39;');

    const registry = () => window.TileLayoutRegistry;

    function normalizeEntry(value, options = {}) {
        const rawValue = typeof value === 'number' ? value : String(value == null ? '' : value).trim();
        if (typeof rawValue === 'number') {
            if (!Number.isFinite(rawValue) || rawValue <= 0) return null;
            return {
                value: Math.max(0, Math.round(rawValue)),
                label: String(options.label || ''),
                isNumeric: true
            };
        }

        if (!rawValue) return null;

        const numericValue = Number(rawValue);
        if (Number.isFinite(numericValue) && numericValue > 0 && String(Math.round(numericValue)) === rawValue) {
            return {
                value: Math.round(numericValue),
                label: String(options.label || ''),
                isNumeric: true
            };
        }

        return {
            value: rawValue,
            label: String(options.label || ''),
            isNumeric: false
        };
    }

    function loadState() {
        state.sourcesByApp.clear();
        const saved = registry()?.loadTileBadgeState?.() || {};
        Object.keys(saved).forEach((appId) => {
            const sourceEntries = saved[appId];
            if (!sourceEntries || typeof sourceEntries !== 'object') return;
            const sourceMap = new Map();
            Object.keys(sourceEntries).forEach((sourceKey) => {
                const entry = sourceEntries[sourceKey];
                const normalized = normalizeEntry(entry?.value, { label: entry?.label || '' });
                if (normalized) sourceMap.set(sourceKey, normalized);
            });
            if (sourceMap.size) state.sourcesByApp.set(appId, sourceMap);
        });
    }

    function saveState() {
        const next = {};
        state.sourcesByApp.forEach((sourceMap, appId) => {
            if (!(sourceMap instanceof Map) || !sourceMap.size) return;
            next[appId] = {};
            sourceMap.forEach((entry, sourceKey) => {
                next[appId][sourceKey] = {
                    value: entry.value,
                    label: entry.label || ''
                };
            });
        });
        registry()?.saveTileBadgeState?.(next);
    }

    function renderBadgeValue(entry) {
        if (!entry) return '';
        if (entry.isNumeric) {
            return entry.value > 99 ? '99+' : String(entry.value);
        }
        return String(entry.value);
    }

    function getBadge(appOrId) {
        const appId = typeof appOrId === 'string' ? appOrId : appOrId?.id;
        if (!appId) return null;

        const candidates = [];
        const sourceMap = state.sourcesByApp.get(appId);
        if (sourceMap instanceof Map) {
            sourceMap.forEach((entry) => {
                if (entry) candidates.push(entry);
            });
        }

        const notificationCount = state.notificationCounts.get(appId) || 0;
        if (notificationCount > 0) {
            candidates.push({
                value: notificationCount,
                label: notificationCount === 1 ? '1 notification' : `${notificationCount} notifications`,
                isNumeric: true
            });
        }

        if (!candidates.length) return null;

        const numericCandidates = candidates.filter((entry) => entry.isNumeric);
        if (numericCandidates.length) {
            return numericCandidates.reduce((best, entry) => (entry.value > best.value ? entry : best), numericCandidates[0]);
        }

        return candidates[0];
    }

    function requestTileRender(appId) {
        if (!appId) return;
        if (window.LiveTiles && typeof window.LiveTiles.isSurfaceOpen === 'function' && window.LiveTiles.isSurfaceOpen()) {
            if (typeof window.LiveTiles.deferTileRender === 'function') {
                window.LiveTiles.deferTileRender([appId]);
                return;
            }
        }
        if (window.LiveTiles && typeof window.LiveTiles.requestTileRender === 'function') {
            window.LiveTiles.requestTileRender([appId]);
            return;
        }
        if (typeof window.renderPinnedTiles === 'function') window.renderPinnedTiles();
        if (typeof window.renderStartMenuTiles === 'function') window.renderStartMenuTiles();
    }

    function setSource(appId, sourceKey, value, options = {}) {
        if (!appId || !sourceKey) return false;
        const normalized = normalizeEntry(value, options);
        const sourceMap = state.sourcesByApp.get(appId) || new Map();

        if (!normalized) {
            sourceMap.delete(sourceKey);
        } else {
            sourceMap.set(sourceKey, normalized);
        }

        if (sourceMap.size) {
            state.sourcesByApp.set(appId, sourceMap);
        } else {
            state.sourcesByApp.delete(appId);
        }

        saveState();
        requestTileRender(appId);
        return true;
    }

    function clearSource(appId, sourceKey) {
        return setSource(appId, sourceKey, 0);
    }

    function setCount(appId, sourceKey, count, options = {}) {
        return setSource(appId, sourceKey, Number(count) || 0, options);
    }

    function clearApp(appId) {
        if (!appId) return false;
        state.sourcesByApp.delete(appId);
        saveState();
        requestTileRender(appId);
        return true;
    }

    function renderBadgeMarkup(appOrId) {
        const badge = getBadge(appOrId);
        if (!badge) return '';
        const renderedValue = renderBadgeValue(badge);
        if (!renderedValue) return '';
        const label = badge.label || renderedValue;
        return `<span class="tiles__tile-badge" aria-label="${html(label)}">${html(renderedValue)}</span>`;
    }

    function handleNotificationShown(event) {
        const detail = event?.detail || {};
        if (!detail.id || !detail.appId) return;
        state.notificationOwners.set(detail.id, detail.appId);
        state.notificationCounts.set(detail.appId, (state.notificationCounts.get(detail.appId) || 0) + 1);
        requestTileRender(detail.appId);
    }

    function handleNotificationHidden(event) {
        const detail = event?.detail || {};
        const appId = state.notificationOwners.get(detail.id);
        if (!appId) return;
        state.notificationOwners.delete(detail.id);
        const nextCount = Math.max(0, (state.notificationCounts.get(appId) || 0) - 1);
        if (nextCount > 0) {
            state.notificationCounts.set(appId, nextCount);
        } else {
            state.notificationCounts.delete(appId);
        }
        requestTileRender(appId);
    }

    function initialize() {
        if (state.ready) return;
        loadState();
        document.addEventListener('win9:notification-shown', handleNotificationShown);
        document.addEventListener('win9:notification-hidden', handleNotificationHidden);
        state.ready = true;
    }

    window.TileBadges = {
        initialize,
        getBadge,
        renderBadgeMarkup,
        setSource,
        setCount,
        clearSource,
        clearApp
    };

    initialize();
})();
