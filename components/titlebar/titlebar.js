// Custom Titlebar Handler for macOS
(function() {
    'use strict';

    // Detect platform and add class to body
    const platform = process.platform;
    document.body.classList.add(`platform-${platform}`);

    // Only initialize on macOS
    if (platform !== 'darwin') {
        return;
    }

    const { ipcRenderer } = require('electron');
    let isFullscreen = false;

    // Get titlebar elements
    const fullscreenBtn = document.getElementById('fullscreen-btn');

    // Handle fullscreen toggle
    if (fullscreenBtn) {
        fullscreenBtn.addEventListener('click', async () => {
            isFullscreen = !isFullscreen;

            // Use IPC to communicate with main process
            ipcRenderer.send('toggle-simple-fullscreen', isFullscreen);

            // Update UI
            if (isFullscreen) {
                document.body.classList.add('fullscreen');
            } else {
                document.body.classList.remove('fullscreen');
            }
        });
    }

    // Listen for fullscreen state changes from main process
    ipcRenderer.on('fullscreen-state-changed', (event, state) => {
        isFullscreen = state;
        if (isFullscreen) {
            document.body.classList.add('fullscreen');
        } else {
            document.body.classList.remove('fullscreen');
        }
    });

    // Handle Escape key to exit fullscreen
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isFullscreen) {
            isFullscreen = false;
            ipcRenderer.send('toggle-simple-fullscreen', false);
            document.body.classList.remove('fullscreen');
        }
    });

    console.log('[Titlebar] Custom titlebar initialized for macOS');
})();
