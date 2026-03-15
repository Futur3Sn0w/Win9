// Internet Explorer Browser Logic
// Wrap in IIFE to prevent redeclaration errors when app is reopened
(function() {
    'use strict';

    // If browser already exists, clean it up
    if (window.browser) {
        window.browser = null;
    }

    class IEBrowser {
    constructor() {
        this.tabs = [];
        this.currentTabIndex = 0;
        this.isTabBarExpanded = false;
        this.favorites = this.loadFavorites();
        this.webview = document.getElementById('browser-view');
        this.addressBar = document.getElementById('addressBar');
        this.tabBarSection = document.getElementById('tabBarSection');
        this.frequentBarSection = document.getElementById('frequentBarSection');
        this.frequentTiles = document.getElementById('frequentTiles');
        this.tabsContainer = document.getElementById('tabsContainer');
        this.tabsExpanded = document.getElementById('tabsExpanded');
        this.loadingIndicator = document.getElementById('loadingIndicator');
        this.contextMenu = document.getElementById('contextMenu');
        this.tabContextMenu = document.getElementById('tabContextMenu');
        this.appBar = document.getElementById('appBar');
        this.goBtn = document.getElementById('goBtn');
        this.siteFavicon = document.getElementById('siteFavicon');
        this.addressBarSection = document.querySelector('.ie-address-bar-section');

        this.init();
    }

    init() {
        console.log('[IE-Browser] Initializing browser...');

        // Create first tab
        this.createTab('about:blank', 'New Tab');

        // Set up event listeners (these need to be set up BEFORE webview is ready)
        this.setupWebviewListeners();
        this.setupNavigationListeners();
        this.setupTabListeners();
        this.setupContextMenu();

        // Initial render
        this.renderTabs();
        this.switchToTab(0);

        console.log('[IE-Browser] Initialization complete!');
    }

    // Tab Management
    createTab(url = 'about:blank', title = 'New Tab') {
        const tab = {
            id: Date.now() + Math.random(),
            url: url,
            title: title,
            canGoBack: false,
            canGoForward: false
        };

        this.tabs.push(tab);
        this.renderTabs();

        return tab;
    }

    closeTab(tabId) {
        const index = this.tabs.findIndex(t => t.id === tabId);
        if (index === -1) return;

        // Don't close if it's the last tab
        if (this.tabs.length === 1) {
            this.createTab('about:blank', 'New Tab');
        }

        // Remove tab
        this.tabs.splice(index, 1);

        // Adjust current tab index
        if (this.currentTabIndex >= this.tabs.length) {
            this.currentTabIndex = this.tabs.length - 1;
        } else if (this.currentTabIndex > index) {
            this.currentTabIndex--;
        }

        this.renderTabs();
        this.switchToTab(this.currentTabIndex);
    }

    switchToTab(index) {
        if (index < 0 || index >= this.tabs.length) return;

        this.currentTabIndex = index;
        const tab = this.tabs[index];

        // Update webview
        if (this.webview.src !== tab.url && tab.url !== 'about:blank') {
            this.webview.src = tab.url;
        }

        // Update address bar
        this.addressBar.value = tab.url === 'about:blank' ? '' : tab.url;

        // Update navigation buttons
        this.updateNavigationButtons(tab.canGoBack, tab.canGoForward);

        // Update UI
        this.renderTabs();
    }

    getCurrentTab() {
        return this.tabs[this.currentTabIndex];
    }

    updateCurrentTab(updates) {
        const tab = this.getCurrentTab();
        Object.assign(tab, updates);
        this.renderTabs();
    }

    // Rendering
    renderTabs() {
        // Render slimline tabs
        this.renderSlimlineTabs();

        // Render expanded tabs
        this.renderExpandedTabs();
    }

    renderSlimlineTabs() {
        this.tabsContainer.innerHTML = '';

        this.tabs.forEach((tab, index) => {
            const tabEl = document.createElement('div');
            tabEl.className = 'ie-tab' + (index === this.currentTabIndex ? ' active' : '');

            const favicon = tab.url !== 'about:blank' ? this.getFaviconUrl(tab.url) : '';
            const faviconHtml = favicon ? `<div class="ie-tab-favicon"><img src="${favicon}" alt="" onerror="this.style.display='none'"></div>` : '';

            tabEl.innerHTML = `
                ${faviconHtml}
                <span class="ie-tab-title">${this.escapeHtml(tab.title)}</span>
                <button class="ie-tab-close" data-tab-id="${tab.id}">
                    <span class="icon-close"></span>
                </button>
            `;

            // Click to switch tab
            tabEl.addEventListener('click', (e) => {
                if (!e.target.closest('.ie-tab-close')) {
                    this.switchToTab(index);
                }
            });

            // Close button
            const closeBtn = tabEl.querySelector('.ie-tab-close');
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.closeTab(tab.id);
            });

            this.tabsContainer.appendChild(tabEl);
        });

        // Add new tab and menu buttons
        const actionsEl = document.createElement('div');
        actionsEl.className = 'ie-tab-actions';
        actionsEl.innerHTML = `
            <button class="ie-tab-action-btn" id="newTabBtn" title="New tab">
                <span class="icon-add"></span>
            </button>
            <button class="ie-tab-action-btn" id="tabMenuBtn" title="More">
                <span class="icon-menu"></span>
            </button>
        `;

        actionsEl.querySelector('#newTabBtn').addEventListener('click', () => {
            const newTab = this.createTab('about:blank', 'New Tab');
            this.switchToTab(this.tabs.length - 1);
        });

        actionsEl.querySelector('#tabMenuBtn').addEventListener('click', (e) => {
            e.stopPropagation();
            this.showTabContextMenu(e.currentTarget);
        });

        this.tabsContainer.appendChild(actionsEl);
    }

    renderExpandedTabs() {
        this.tabsExpanded.innerHTML = '';

        this.tabs.forEach((tab, index) => {
            const previewEl = document.createElement('div');
            previewEl.className = 'ie-tab-preview' + (index === this.currentTabIndex ? ' active' : '');

            const favicon = tab.url !== 'about:blank' ? this.getFaviconUrl(tab.url) : '';
            const faviconHtml = favicon ? `<div class="ie-tab-preview-favicon"><img src="${favicon}" alt="" onerror="this.style.display='none'"></div>` : '';

            previewEl.innerHTML = `
                <div class="ie-tab-preview-thumbnail">Preview</div>
                <div class="ie-tab-preview-title">
                    ${faviconHtml}
                    <span>${this.escapeHtml(tab.title)}</span>
                </div>
                <div class="ie-tab-preview-url">${this.escapeHtml(tab.url)}</div>
                <button class="ie-tab-preview-close" data-tab-id="${tab.id}">
                    <span class="icon-close"></span>
                </button>
            `;

            // Click to switch tab
            previewEl.addEventListener('click', (e) => {
                if (!e.target.closest('.ie-tab-preview-close')) {
                    this.switchToTab(index);
                    this.toggleTabBarExpanded(); // Collapse after selection
                }
            });

            // Close button
            const closeBtn = previewEl.querySelector('.ie-tab-preview-close');
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.closeTab(tab.id);
            });

            this.tabsExpanded.appendChild(previewEl);
        });
    }

    // Navigation
    navigateToUrl(url) {
        console.log(`[IE-Browser] navigateToUrl called with: "${url}"`);

        // Handle search vs URL
        let finalUrl = url.trim();

        if (!finalUrl) {
            finalUrl = 'about:blank';
        } else if (!finalUrl.includes('://') && !finalUrl.startsWith('about:')) {
            // Check if it looks like a domain
            if (finalUrl.includes('.') && !finalUrl.includes(' ')) {
                finalUrl = 'https://' + finalUrl;
            } else {
                // Treat as search
                finalUrl = `https://www.bing.com/search?q=${encodeURIComponent(finalUrl)}`;
            }
        }

        console.log(`[IE-Browser] Final URL to load: "${finalUrl}"`);
        console.log(`[IE-Browser] Setting webview.src...`);
        this.webview.src = finalUrl;
        this.updateCurrentTab({ url: finalUrl });
    }

    goBack() {
        if (this.webview.canGoBack()) {
            this.webview.goBack();
        }
    }

    goForward() {
        if (this.webview.canGoForward()) {
            this.webview.goForward();
        }
    }

    refresh() {
        this.webview.reload();
    }

    updateNavigationButtons(canGoBack, canGoForward) {
        document.getElementById('backBtn').disabled = !canGoBack;
        document.getElementById('forwardBtn').disabled = !canGoForward;
    }

    // Tab Bar Expansion
    toggleTabBarExpanded() {
        this.isTabBarExpanded = !this.isTabBarExpanded;

        if (this.isTabBarExpanded) {
            this.tabBarSection.classList.add('expanded');
            document.getElementById('expandTabsBtn').classList.add('active');
        } else {
            this.tabBarSection.classList.remove('expanded');
            document.getElementById('expandTabsBtn').classList.remove('active');
        }
    }

    // Event Listeners Setup
    setupWebviewListeners() {
        // Debug logging helper
        const logDebug = (msg) => {
            const time = new Date().toLocaleTimeString();
            console.log(`[IE-Browser ${time}] ${msg}`);
        };

        // Check if webview is properly initialized
        if (!this.webview) {
            console.error('[IE-Browser] ERROR: Webview element not found!');
            return;
        }

        logDebug('Setting up webview event listeners...');

        // Check webview initialization after a brief delay
        setTimeout(() => {
            if (typeof this.webview.getWebContentsId === 'function') {
                logDebug('Webview properly initialized with getWebContentsId');
            } else {
                logDebug('WARNING: Webview missing getWebContentsId - may not be ready');
            }
        }, 100);

        // Loading events
        this.webview.addEventListener('did-start-loading', () => {
            logDebug('Event: did-start-loading');
            this.loadingIndicator.classList.add('active');
        });

        this.webview.addEventListener('did-finish-load', () => {
            logDebug('Event: did-finish-load - SUCCESS!');
            this.loadingIndicator.classList.remove('active');

            // Update current tab info
            const url = this.webview.getURL();
            const title = this.webview.getTitle() || 'New Tab';

            logDebug(`Loaded: ${title} (${url})`);

            this.updateCurrentTab({
                url: url,
                title: title,
                canGoBack: this.webview.canGoBack(),
                canGoForward: this.webview.canGoForward()
            });

            // Update address bar
            this.addressBar.value = url === 'about:blank' ? '' : url;

            // Update navigation buttons
            this.updateNavigationButtons(this.webview.canGoBack(), this.webview.canGoForward());

            // Update favicon
            this.updateFavicon(url);

            // Update favorite button state
            this.updateFavoriteButton();
        });

        this.webview.addEventListener('did-fail-load', (event) => {
            logDebug(`Event: did-fail-load - Code: ${event.errorCode}, Desc: ${event.errorDescription}`);
            this.loadingIndicator.classList.remove('active');

            if (event.errorCode !== -3) { // -3 is aborted, which is normal
                console.error('Failed to load:', event.errorCode, event.errorDescription);
                alert(`Failed to load page:\nError ${event.errorCode}: ${event.errorDescription}`);
            }
        });

        // Log console messages from the webview
        this.webview.addEventListener('console-message', (e) => {
            console.log(`[Webview Console] ${e.level}: ${e.message}`);
        });

        // Check webview DOM readiness
        this.webview.addEventListener('dom-ready', () => {
            logDebug('Event: dom-ready');
        });

        // Additional debug events
        this.webview.addEventListener('load-commit', (event) => {
            logDebug(`Event: load-commit - URL: ${event.url}`);
        });

        // Title updates
        this.webview.addEventListener('page-title-updated', (event) => {
            logDebug(`Event: page-title-updated - "${event.title}"`);
            this.updateCurrentTab({ title: event.title });
        });

        // Navigation
        this.webview.addEventListener('did-navigate', (event) => {
            logDebug(`Event: did-navigate - URL: ${event.url}`);
            this.updateCurrentTab({
                url: event.url,
                canGoBack: this.webview.canGoBack(),
                canGoForward: this.webview.canGoForward()
            });
            this.addressBar.value = event.url === 'about:blank' ? '' : event.url;
            this.updateNavigationButtons(this.webview.canGoBack(), this.webview.canGoForward());
        });

        this.webview.addEventListener('did-navigate-in-page', (event) => {
            logDebug(`Event: did-navigate-in-page - URL: ${event.url}`);
            this.updateCurrentTab({
                url: event.url,
                canGoBack: this.webview.canGoBack(),
                canGoForward: this.webview.canGoForward()
            });
            this.addressBar.value = event.url === 'about:blank' ? '' : event.url;
            this.updateNavigationButtons(this.webview.canGoBack(), this.webview.canGoForward());
        });

        // New window handling
        this.webview.addEventListener('new-window', (event) => {
            event.preventDefault();
            logDebug(`Event: new-window - URL: ${event.url}`);
            const newTab = this.createTab(event.url, 'Loading...');
            this.switchToTab(this.tabs.length - 1);
        });
    }

    setupNavigationListeners() {
        // Back button
        document.getElementById('backBtn').addEventListener('click', () => {
            this.goBack();
        });

        // Forward button
        document.getElementById('forwardBtn').addEventListener('click', () => {
            this.goForward();
        });

        // Refresh button
        document.getElementById('refreshBtn').addEventListener('click', () => {
            this.refresh();
        });

        // Address bar - Enter key navigation
        this.addressBar.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.navigateToUrl(this.addressBar.value);
            }
        });

        // Address bar focus/blur - show/hide Go button and toggle bars
        this.addressBar.addEventListener('focus', () => {
            this.addressBar.select();
            this.goBtn.classList.add('visible');
            this.addressBarSection.classList.add('addressbar-focused');

            // Hide tab bar and show frequent bar
            this.tabBarSection.classList.add('hidden');
            this.frequentBarSection.classList.add('visible');
            this.renderFrequentBar();
        });

        this.addressBar.addEventListener('blur', () => {
            // Small delay to allow clicking the Go button or tiles
            setTimeout(() => {
                this.goBtn.classList.remove('visible');
                this.addressBarSection.classList.remove('addressbar-focused');

                // Show tab bar and hide frequent bar
                this.tabBarSection.classList.remove('hidden');
                this.frequentBarSection.classList.remove('visible');
            }, 200);
        });

        // Go button
        this.goBtn.addEventListener('click', () => {
            this.navigateToUrl(this.addressBar.value);
        });

        // Favorite button
        document.getElementById('favoriteBtn').addEventListener('click', () => {
            this.toggleFavorite();
        });

        // Menu button
        document.getElementById('menuBtn').addEventListener('click', (e) => {
            e.stopPropagation();
            this.showContextMenu(e.currentTarget);
        });
    }

    setupTabListeners() {
        // Expand tabs button
        document.getElementById('expandTabsBtn').addEventListener('click', () => {
            this.toggleTabBarExpanded();
        });

        // New tab button in expanded view
        document.getElementById('newTabExpandedBtn')?.addEventListener('click', () => {
            const newTab = this.createTab('about:blank', 'New Tab');
            this.switchToTab(this.tabs.length - 1);
        });

        // Menu button in expanded view
        document.getElementById('menuExpandedBtn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showTabContextMenu(e.currentTarget);
        });
    }

    setupContextMenu() {
        // Main context menu item click
        this.contextMenu.addEventListener('click', (e) => {
            e.stopPropagation();
            const item = e.target.closest('.modern-dropdown-item');
            if (!item) return;

            const action = item.dataset.action;
            this.handleContextMenuAction(action);
            this.hideContextMenu();
        });

        // Tab context menu item click
        this.tabContextMenu.addEventListener('click', (e) => {
            e.stopPropagation();
            const item = e.target.closest('.modern-dropdown-item');
            if (!item) return;

            const action = item.dataset.action;
            this.handleContextMenuAction(action);
            this.hideTabContextMenu();
        });

        // Hide menus on outside click
        document.addEventListener('click', (e) => {
            // Check if click is on menu button
            if (e.target.closest('[id$="MenuBtn"]')) {
                return; // Let the button handler toggle the menu
            }

            // Check if click is inside any menu
            if (this.contextMenu.contains(e.target) || this.tabContextMenu.contains(e.target)) {
                return;
            }

            // Otherwise, hide menus
            this.hideContextMenu();
            this.hideTabContextMenu();
        });

        // Prevent default context menu
        document.addEventListener('contextmenu', (e) => {
            // Allow webview to handle its own context menu
            if (e.target === this.webview) return;
            e.preventDefault();
        });
    }

    showContextMenu(buttonElement) {
        const menu = this.contextMenu;

        // If menu is already showing, hide it (toggle behavior)
        if (menu.classList.contains('active')) {
            this.hideContextMenu();
            return;
        }

        // Get button position
        const buttonRect = buttonElement.getBoundingClientRect();

        // Get menu dimensions (needs to be visible briefly to measure)
        menu.style.visibility = 'hidden';
        menu.classList.add('active');
        const menuRect = menu.getBoundingClientRect();
        menu.style.visibility = '';
        menu.classList.remove('active');

        // Position menu to slide up from button
        const padding = 10; // Padding from screen edges
        let left = buttonRect.left + (buttonRect.width / 2) - (menuRect.width / 2);
        let bottom = window.innerHeight - buttonRect.top + 5; // 5px gap above button

        // Ensure menu stays on screen horizontally
        if (left < padding) {
            left = padding;
        } else if (left + menuRect.width > window.innerWidth - padding) {
            left = window.innerWidth - menuRect.width - padding;
        }

        // Position menu
        menu.style.left = left + 'px';
        menu.style.bottom = bottom + 'px';
        menu.style.top = 'auto';
        menu.style.right = 'auto';

        // Add slide-up animation transform
        menu.style.transform = 'translateY(10px)';
        menu.classList.add('active');

        // Trigger animation
        requestAnimationFrame(() => {
            menu.style.transform = 'translateY(0)';
        });
    }

    hideContextMenu() {
        const menu = this.contextMenu;
        menu.style.transform = 'translateY(10px)';

        // Wait for animation then hide
        setTimeout(() => {
            menu.classList.remove('active');
        }, 150);
    }

    showTabContextMenu(buttonElement) {
        const menu = this.tabContextMenu;

        // If menu is already showing, hide it (toggle behavior)
        if (menu.classList.contains('active')) {
            this.hideTabContextMenu();
            return;
        }

        // Get button position
        const buttonRect = buttonElement.getBoundingClientRect();

        // Get menu dimensions (needs to be visible briefly to measure)
        menu.style.visibility = 'hidden';
        menu.classList.add('active');
        const menuRect = menu.getBoundingClientRect();
        menu.style.visibility = '';
        menu.classList.remove('active');

        // Position menu to slide up from button
        const padding = 10; // Padding from screen edges
        let left = buttonRect.left + (buttonRect.width / 2) - (menuRect.width / 2);
        let bottom = window.innerHeight - buttonRect.top + 5; // 5px gap above button

        // Ensure menu stays on screen horizontally
        if (left < padding) {
            left = padding;
        } else if (left + menuRect.width > window.innerWidth - padding) {
            left = window.innerWidth - menuRect.width - padding;
        }

        // Position menu
        menu.style.left = left + 'px';
        menu.style.bottom = bottom + 'px';
        menu.style.top = 'auto';
        menu.style.right = 'auto';

        // Add slide-up animation transform
        menu.style.transform = 'translateY(10px)';
        menu.classList.add('active');

        // Trigger animation
        requestAnimationFrame(() => {
            menu.style.transform = 'translateY(0)';
        });
    }

    hideTabContextMenu() {
        const menu = this.tabContextMenu;
        menu.style.transform = 'translateY(10px)';

        // Wait for animation then hide
        setTimeout(() => {
            menu.classList.remove('active');
        }, 150);
    }

    handleContextMenuAction(action) {
        switch (action) {
            case 'new-tab':
                const newTab = this.createTab('about:blank', 'New Tab');
                this.switchToTab(this.tabs.length - 1);
                break;
            case 'new-window':
                console.log('New InPrivate window - not implemented');
                break;
            case 'favorites':
                console.log('Favorites - not implemented');
                break;
            case 'history':
                console.log('History - not implemented');
                break;
            case 'downloads':
                console.log('Downloads - not implemented');
                break;
            case 'settings':
                console.log('Settings - not implemented');
                break;
        }
    }

    // Favorites Management
    loadFavorites() {
        const registry = window.IERegistry;

        if (registry && typeof registry.loadFavorites === 'function') {
            try {
                return registry.loadFavorites();
            } catch (error) {
                console.error('Failed to load favorites from registry:', error);
            }
        }

        return [];
    }

    saveFavorites() {
        const registry = window.IERegistry;

        if (registry && typeof registry.saveFavorites === 'function') {
            try {
                registry.saveFavorites(this.favorites);
            } catch (error) {
                console.error('Failed to save favorites to registry:', error);
            }
        } else {
            console.warn('IERegistry API unavailable; favorites not persisted');
        }
    }

    toggleFavorite() {
        const tab = this.getCurrentTab();
        if (!tab || tab.url === 'about:blank') return;

        const existingIndex = this.favorites.findIndex(f => f.url === tab.url);
        const btn = document.getElementById('favoriteBtn');
        const icon = btn.querySelector('.icon-star');

        if (existingIndex >= 0) {
            // Remove from favorites
            this.favorites.splice(existingIndex, 1);
            icon.classList.remove('active');
        } else {
            // Add to favorites
            const favicon = this.getFaviconUrl(tab.url);
            this.favorites.push({
                url: tab.url,
                title: tab.title,
                favicon: favicon,
                color: '#0078d7' // Will be updated with extracted color
            });
            icon.classList.add('active');

            // Extract color from favicon
            this.extractFaviconColor(favicon, tab.url);
        }

        this.saveFavorites();
        this.renderFrequentBar();
    }

    updateFavoriteButton() {
        const tab = this.getCurrentTab();
        const btn = document.getElementById('favoriteBtn');
        const icon = btn.querySelector('.icon-star');

        if (tab && this.favorites.some(f => f.url === tab.url)) {
            icon.classList.add('active');
        } else {
            icon.classList.remove('active');
        }
    }

    // Favicon Handling
    getFaviconUrl(url) {
        try {
            const urlObj = new URL(url);
            return `${urlObj.protocol}//${urlObj.hostname}/favicon.ico`;
        } catch {
            return '';
        }
    }

    updateFavicon(url) {
        const faviconImg = this.siteFavicon.querySelector('img');

        if (!url || url === 'about:blank') {
            faviconImg.style.display = 'none';
            return;
        }

        const faviconUrl = this.getFaviconUrl(url);
        faviconImg.src = faviconUrl;
        faviconImg.style.display = 'block';

        // Hide on error
        faviconImg.onerror = () => {
            faviconImg.style.display = 'none';
        };
    }

    extractFaviconColor(faviconUrl, pageUrl) {
        // Create a temporary image to extract dominant color
        const img = new Image();
        img.crossOrigin = 'Anonymous';
        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);

                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const color = this.getDominantColor(imageData);

                // Update favorite with extracted color
                const fav = this.favorites.find(f => f.url === pageUrl);
                if (fav) {
                    fav.color = color;
                    this.saveFavorites();
                    this.renderFrequentBar();
                }
            } catch (e) {
                console.log('Could not extract favicon color:', e);
            }
        };
        img.src = faviconUrl;
    }

    getDominantColor(imageData) {
        const data = imageData.data;
        const colorCounts = {};
        let maxCount = 0;
        let dominantColor = '#0078d7';

        // Sample every few pixels for performance
        for (let i = 0; i < data.length; i += 16) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const a = data[i + 3];

            // Skip transparent pixels
            if (a < 128) continue;

            const hex = `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
            colorCounts[hex] = (colorCounts[hex] || 0) + 1;

            if (colorCounts[hex] > maxCount) {
                maxCount = colorCounts[hex];
                dominantColor = hex;
            }
        }

        return dominantColor;
    }

    // Frequent Bar Rendering
    renderFrequentBar() {
        this.frequentTiles.innerHTML = '';

        this.favorites.forEach(fav => {
            const tile = document.createElement('div');
            tile.className = 'ie-frequent-tile';
            tile.style.background = `linear-gradient(135deg, ${fav.color} 0%, ${this.darkenColor(fav.color, 30)} 100%)`;

            tile.innerHTML = `
                <div class="ie-frequent-tile-overlay"></div>
                ${fav.favicon ? `<div class="ie-frequent-tile-favicon"><img src="${fav.favicon}" alt=""></div>` : ''}
                <div class="ie-frequent-tile-title">${this.escapeHtml(fav.title)}</div>
            `;

            // Click animation and navigation
            tile.addEventListener('click', (e) => {
                this.animateTileClick(tile, e);
                setTimeout(() => {
                    this.navigateToUrl(fav.url);
                    this.addressBar.blur();
                }, 100);
            });

            this.frequentTiles.appendChild(tile);
        });
    }

    animateTileClick(tile, event) {
        // Get click position relative to tile
        const rect = tile.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;

        // Create ripple effect
        const ripple = document.createElement('div');
        ripple.style.position = 'absolute';
        ripple.style.left = x + 'px';
        ripple.style.top = y + 'px';
        ripple.style.width = '0';
        ripple.style.height = '0';
        ripple.style.borderRadius = '50%';
        ripple.style.background = 'rgba(255, 255, 255, 0.5)';
        ripple.style.transform = 'translate(-50%, -50%)';
        ripple.style.pointerEvents = 'none';
        ripple.style.transition = 'width 0.3s ease, height 0.3s ease, opacity 0.3s ease';
        ripple.style.opacity = '1';

        tile.appendChild(ripple);

        // Trigger animation
        requestAnimationFrame(() => {
            ripple.style.width = '200px';
            ripple.style.height = '200px';
            ripple.style.opacity = '0';
        });

        setTimeout(() => ripple.remove(), 300);
    }

    darkenColor(hex, percent) {
        // Convert hex to RGB
        const num = parseInt(hex.replace('#', ''), 16);
        const r = Math.max(0, (num >> 16) - Math.round(255 * (percent / 100)));
        const g = Math.max(0, ((num >> 8) & 0x00FF) - Math.round(255 * (percent / 100)));
        const b = Math.max(0, (num & 0x0000FF) - Math.round(255 * (percent / 100)));

        return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
    }

    // Utilities
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    }

    // Initialize browser - wait for webview to be available
    let initAttempts = 0;
    const MAX_ATTEMPTS = 50; // 5 seconds total (50 * 100ms)

    // Function to initialize the browser
    const initializeBrowser = () => {
        console.log('[IE-Browser] Initializing, checking for webview...');

        const webview = document.getElementById('browser-view');
        if (!webview) {
            console.error('[IE-Browser] Webview element not found!');
            return;
        }

        console.log('[IE-Browser] Webview element found:', webview);
        console.log('[IE-Browser] Webview tagName:', webview.tagName);
        console.log('[IE-Browser] Webview attributes:', Array.from(webview.attributes).map(a => `${a.name}="${a.value}"`).join(', '));

        // Poll for webview readiness
        const checkWebviewReady = () => {
            initAttempts++;

            console.log(`[IE-Browser] Check attempt ${initAttempts}/${MAX_ATTEMPTS}`);
            console.log('[IE-Browser] typeof webview.getWebContentsId:', typeof webview.getWebContentsId);
            console.log('[IE-Browser] webview methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(webview)).slice(0, 10).join(', '));

            if (typeof webview.getWebContentsId === 'function') {
                console.log('[IE-Browser] Webview is ready! Initializing browser...');
                window.browser = new IEBrowser();
            } else if (initAttempts >= MAX_ATTEMPTS) {
                console.error('[IE-Browser] Webview failed to initialize after', MAX_ATTEMPTS, 'attempts');
                console.error('[IE-Browser] This usually means webview tag is not supported in this context');
                alert('Internet Explorer failed to initialize.\n\nThe webview component did not become ready.\nThis may be an Electron configuration issue.');
            } else {
                setTimeout(checkWebviewReady, 100);
            }
        };

        checkWebviewReady();
    };

    // Check if DOM is already loaded (for dynamically injected scripts)
    if (document.readyState === 'loading') {
        // DOM is still loading, wait for DOMContentLoaded
        document.addEventListener('DOMContentLoaded', initializeBrowser);
    } else {
        // DOM is already loaded, initialize immediately
        console.log('[IE-Browser] DOM already loaded, initializing immediately');
        initializeBrowser();
    }

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Don't process shortcuts until browser is initialized
        if (!window.browser) return;

        // Ctrl+T: New tab
        if (e.ctrlKey && e.key === 't') {
            e.preventDefault();
            const newTab = window.browser.createTab('about:blank', 'New Tab');
            window.browser.switchToTab(window.browser.tabs.length - 1);
        }

        // Ctrl+W: Close tab
        if (e.ctrlKey && e.key === 'w') {
            e.preventDefault();
            window.browser.closeTab(window.browser.getCurrentTab().id);
        }

        // Ctrl+Tab: Next tab
        if (e.ctrlKey && e.key === 'Tab' && !e.shiftKey) {
            e.preventDefault();
            const nextIndex = (window.browser.currentTabIndex + 1) % window.browser.tabs.length;
            window.browser.switchToTab(nextIndex);
        }

        // Ctrl+Shift+Tab: Previous tab
        if (e.ctrlKey && e.shiftKey && e.key === 'Tab') {
            e.preventDefault();
            const prevIndex = window.browser.currentTabIndex === 0 ? window.browser.tabs.length - 1 : window.browser.currentTabIndex - 1;
            window.browser.switchToTab(prevIndex);
        }

        // Ctrl+L or F6: Focus address bar
        if ((e.ctrlKey && e.key === 'l') || e.key === 'F6') {
            e.preventDefault();
            window.browser.addressBar.focus();
        }

        // F5 or Ctrl+R: Refresh
        if (e.key === 'F5' || (e.ctrlKey && e.key === 'r')) {
            e.preventDefault();
            window.browser.refresh();
        }

        // Alt+Left: Back
        if (e.altKey && e.key === 'ArrowLeft') {
            e.preventDefault();
            window.browser.goBack();
        }

        // Alt+Right: Forward
        if (e.altKey && e.key === 'ArrowRight') {
            e.preventDefault();
            window.browser.goForward();
        }
    });

})(); // End IIFE
