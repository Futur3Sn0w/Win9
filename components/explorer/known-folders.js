(function (root, factory) {
    const api = factory(root);

    if (root && typeof root === 'object') {
        root.KnownFolders = api;
    }

    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }
})(typeof window !== 'undefined' ? window : globalThis, function () {
    let pathModule = null;
    let osModule = null;

    try {
        if (typeof require === 'function') {
            pathModule = require('path');
            osModule = require('os');
        }
    } catch (error) {
        pathModule = null;
        osModule = null;
    }

    const DEFINITIONS = [
        { id: 'desktop', name: 'Desktop', icon: 'desktop', relativePath: ['Desktop'], sidebarLocation: 'desktop', thisPcLocation: 'desktop-folder' },
        { id: 'documents', name: 'Documents', icon: 'folder_documents', relativePath: ['Documents'], sidebarLocation: 'documents', thisPcLocation: 'documents' },
        { id: 'downloads', name: 'Downloads', icon: 'folder_downloads', relativePath: ['Downloads'], sidebarLocation: 'downloads', thisPcLocation: 'downloads-folder' },
        { id: 'music', name: 'Music', icon: 'folder_music', relativePath: ['Music'], sidebarLocation: 'music', thisPcLocation: 'music' },
        { id: 'pictures', name: 'Pictures', icon: 'folder_pictures', relativePath: ['Pictures'], sidebarLocation: 'pictures', thisPcLocation: 'pictures' },
        { id: 'videos', name: 'Videos', icon: 'folder_videos', relativePath: ['Videos'], sidebarLocation: 'videos', thisPcLocation: 'videos' }
    ];

    function cloneDefinition(definition) {
        return {
            ...definition,
            relativePath: Array.isArray(definition?.relativePath)
                ? definition.relativePath.slice()
                : []
        };
    }

    function getDefinitions() {
        return DEFINITIONS.map(cloneDefinition);
    }

    function getById(folderId) {
        if (typeof folderId !== 'string' || !folderId) {
            return null;
        }

        const definition = DEFINITIONS.find(entry => entry.id === folderId);
        return definition ? cloneDefinition(definition) : null;
    }

    function resolvePath(folderId) {
        const definition = getById(folderId);
        if (!definition || !pathModule || !osModule) {
            return null;
        }

        return pathModule.join(osModule.homedir(), ...definition.relativePath);
    }

    function isKnownFolderId(folderId) {
        return Boolean(getById(folderId));
    }

    return {
        getDefinitions,
        getById,
        resolvePath,
        isKnownFolderId
    };
});
