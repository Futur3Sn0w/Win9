(() => {
    const DEFAULT_PROFILE_NAME = 'User';
    const DEFAULT_PROFILE_IMAGE = 'resources/images/user.png';
    const PROFILE_CHANGED_EVENT = 'shell-user-profile-changed';

    let electronIpc = null;
    try {
        ({ ipcRenderer: electronIpc } = require('electron'));
    } catch (error) {
        console.debug('[ShellUserProfile] ipcRenderer unavailable:', error.message || error);
    }

    const listeners = new Set();
    let loadPromise = null;
    let initialized = false;
    let currentProfile = createDefaultProfile();

    function normalizeString(value) {
        if (typeof value !== 'string') {
            return '';
        }

        return value.replace(/\s+/g, ' ').trim();
    }

    function toAbsoluteAssetUrl(assetPath) {
        const normalizedPath = normalizeString(assetPath);
        if (!normalizedPath) {
            return '';
        }

        if (/^(?:data:|file:|https?:|blob:)/i.test(normalizedPath)) {
            return normalizedPath;
        }

        try {
            return new URL(normalizedPath, window.location.href).href;
        } catch (error) {
            console.warn('[ShellUserProfile] Failed to resolve asset URL:', normalizedPath, error);
            return normalizedPath;
        }
    }

    function createDefaultProfile() {
        const displayName = DEFAULT_PROFILE_NAME;
        return {
            username: displayName,
            displayName,
            imageUrl: toAbsoluteAssetUrl(DEFAULT_PROFILE_IMAGE),
            hasHostImage: false,
            sourcePlatform: typeof process !== 'undefined' ? process.platform : 'unknown'
        };
    }

    function normalizeProfile(rawProfile) {
        const fallbackProfile = createDefaultProfile();
        const username = normalizeString(rawProfile && rawProfile.username) || fallbackProfile.username;
        const displayName = normalizeString(rawProfile && rawProfile.displayName) || username;
        const preferredImage = normalizeString(rawProfile && rawProfile.imageDataUrl) || fallbackProfile.imageUrl;

        return {
            username,
            displayName,
            imageUrl: toAbsoluteAssetUrl(preferredImage),
            hasHostImage: Boolean(rawProfile && rawProfile.hasHostImage && normalizeString(rawProfile.imageDataUrl)),
            sourcePlatform: normalizeString(rawProfile && rawProfile.sourcePlatform) || fallbackProfile.sourcePlatform
        };
    }

    function getProfileImageNodes(root) {
        return root.querySelectorAll('.user-picker-avatar img, .signing-in-avatar img, .user-tile-icon, .login-user-list-avatar img');
    }

    function getProfileNameNodes(root) {
        return root.querySelectorAll('.user-picker-name, .signing-in-name, .user-tile-name, .login-user-list-name');
    }

    function resolveRoot(root) {
        if (!root || typeof root.querySelectorAll !== 'function') {
            return null;
        }

        return root;
    }

    function applyProfileToDocument(target = document) {
        const root = resolveRoot(target);
        if (!root) {
            return getProfile();
        }

        const profile = currentProfile;
        const imageNodes = getProfileImageNodes(root);
        const nameNodes = getProfileNameNodes(root);

        imageNodes.forEach((node) => {
            node.src = profile.imageUrl;
            node.alt = profile.displayName;
        });

        nameNodes.forEach((node) => {
            node.textContent = profile.displayName;
        });

        if (root.body && root.body.dataset) {
            root.body.dataset.shellDisplayName = profile.displayName;
            root.body.dataset.shellUsername = profile.username;
        }

        return getProfile();
    }

    function getProfile() {
        return { ...currentProfile };
    }

    function notifyProfileChanged() {
        applyProfileToDocument(document);

        const snapshot = getProfile();
        listeners.forEach((listener) => {
            try {
                listener(snapshot);
            } catch (error) {
                console.error('[ShellUserProfile] Listener failed:', error);
            }
        });

        if (typeof window.dispatchEvent === 'function' && typeof window.CustomEvent === 'function') {
            window.dispatchEvent(new CustomEvent(PROFILE_CHANGED_EVENT, { detail: snapshot }));
        }
    }

    async function loadProfile(options = {}) {
        const forceRefresh = Boolean(options && options.forceRefresh);
        if (!forceRefresh && loadPromise) {
            return loadPromise;
        }

        const requestPromise = (async () => {
            if (!electronIpc || typeof electronIpc.invoke !== 'function') {
                currentProfile = createDefaultProfile();
                notifyProfileChanged();
                return getProfile();
            }

            try {
                const rawProfile = await electronIpc.invoke('shell:get-host-user-profile');
                currentProfile = normalizeProfile(rawProfile);
            } catch (error) {
                console.warn('[ShellUserProfile] Failed to load host profile:', error);
                currentProfile = createDefaultProfile();
            }

            notifyProfileChanged();
            return getProfile();
        })();

        loadPromise = requestPromise;
        requestPromise.finally(() => {
            if (loadPromise === requestPromise) {
                loadPromise = null;
            }
        });

        return requestPromise;
    }

    function subscribe(listener) {
        if (typeof listener !== 'function') {
            return () => {};
        }

        listeners.add(listener);
        return () => {
            listeners.delete(listener);
        };
    }

    const api = {
        getProfile,
        loadProfile,
        applyProfileToDocument,
        subscribe,
        PROFILE_CHANGED_EVENT,
        initialize
    };

    window.ShellUserProfile = api;

    function initialize() {
        if (initialized) {
            applyProfileToDocument(document);
            return loadProfile();
        }

        initialized = true;
        applyProfileToDocument(document);

        const loadOperation = loadProfile();

        if (typeof window.addEventListener === 'function') {
            window.addEventListener('load', () => {
                applyProfileToDocument(document);
            }, { once: true });
        }

        return loadOperation;
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            initialize();
        }, { once: true });
    } else {
        initialize();
    }
})();
