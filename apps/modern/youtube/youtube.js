(function () {
    const webview = document.getElementById('youtube-view');
    const loading = document.getElementById('youtube-loading');
    const status = document.getElementById('youtube-loading-status');
    const appBar = document.getElementById('youtube-app-bar');

    if (!webview || !loading || !status || !appBar) {
        return;
    }

    const routeButtons = Array.from(appBar.querySelectorAll('[data-route]'));
    const backButton = appBar.querySelector('[data-action="back"]');
    const forwardButton = appBar.querySelector('[data-action="forward"]');
    const refreshButton = appBar.querySelector('[data-action="refresh"]');

    const routeMatchers = [
        { route: 'home', test: url => /^https:\/\/www\.youtube\.com\/?(?:[#?].*)?$/.test(url) },
        { route: 'shorts', test: url => url.includes('youtube.com/shorts') },
        { route: 'subscriptions', test: url => url.includes('/feed/subscriptions') },
        { route: 'library', test: url => url.includes('/feed/library') || url.includes('/feed/you') }
    ];
    const routeClickProfiles = {
        home: {
            exactHrefs: ['/'],
            hrefPrefixes: ['/?'],
            labels: ['Home']
        },
        shorts: {
            exactHrefs: [],
            hrefPrefixes: ['/shorts'],
            labels: ['Shorts']
        },
        subscriptions: {
            exactHrefs: [],
            hrefPrefixes: ['/feed/subscriptions'],
            labels: ['Subscriptions']
        },
        library: {
            exactHrefs: [],
            hrefPrefixes: ['/feed/library', '/feed/you'],
            labels: ['Library', 'You']
        }
    };

    function setStatus(message) {
        status.textContent = message;
    }

    function hideLoading() {
        loading.classList.add('hidden');
    }

    function showLoading(message) {
        if (message) {
            setStatus(message);
        }
        loading.classList.remove('hidden');
    }

    function loadUrl(url, loadingMessage = 'Loading page...') {
        showLoading(loadingMessage);

        if (typeof webview.loadURL === 'function') {
            webview.loadURL(url);
            return;
        }

        webview.setAttribute('src', url);
    }

    function getRouteButtonLabel(button) {
        return button?.querySelector('.modern-webview-bar-btn-label')?.textContent?.trim()
            || button?.dataset.route
            || 'page';
    }

    async function tryClickRouteInGuest(route) {
        if (typeof webview.executeJavaScript !== 'function') {
            return false;
        }

        const profile = routeClickProfiles[route];
        if (!profile) {
            return false;
        }

        const script = `
            (() => {
                const profile = ${JSON.stringify(profile)};
                const normalize = value => String(value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
                const isVisible = element => {
                    if (!element) return false;
                    const style = window.getComputedStyle(element);
                    if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') {
                        return false;
                    }

                    const rect = element.getBoundingClientRect();
                    return rect.width > 0 && rect.height > 0;
                };
                const clickElement = element => {
                    if (!element) return false;
                    const target = element.closest('a, button, [role="tab"], [tabindex]') || element;
                    if (!isVisible(target)) return false;
                    target.click();
                    return true;
                };
                const anchors = Array.from(document.querySelectorAll('a[href], [role="link"][href]'));
                for (const href of profile.exactHrefs || []) {
                    const match = anchors.find(anchor => (anchor.getAttribute('href') || '') === href);
                    if (clickElement(match)) {
                        return true;
                    }
                }

                for (const prefix of profile.hrefPrefixes) {
                    const match = anchors.find(anchor => {
                        const href = anchor.getAttribute('href') || '';
                        return href.startsWith(prefix);
                    });
                    if (clickElement(match)) {
                        return true;
                    }
                }

                const candidates = Array.from(document.querySelectorAll('a, button, tp-yt-paper-item, ytd-guide-entry-renderer, ytd-mini-guide-entry-renderer'));
                for (const label of profile.labels) {
                    const normalizedLabel = normalize(label);
                    const match = candidates.find(candidate => {
                        const aria = normalize(candidate.getAttribute('aria-label'));
                        const title = normalize(candidate.getAttribute('title'));
                        const text = normalize(candidate.textContent);
                        return aria === normalizedLabel || title === normalizedLabel || text === normalizedLabel;
                    });
                    if (clickElement(match)) {
                        return true;
                    }
                }

                return false;
            })();
        `;

        try {
            return Boolean(await webview.executeJavaScript(script, true));
        } catch (error) {
            console.warn('[YouTube] Failed to click in-page route:', route, error);
            return false;
        }
    }

    async function activateRoute(button) {
        const route = button?.dataset.route;
        const url = button?.dataset.url;
        if (!route || !url) {
            return;
        }

        if (button.classList.contains('active')) {
            return;
        }

        const label = getRouteButtonLabel(button);
        const clickedInGuest = await tryClickRouteInGuest(route);
        if (!clickedInGuest) {
            loadUrl(url, `Opening ${label}...`);
            return;
        }

        setActiveRoute(route);
        setTimeout(() => {
            if (typeof webview.isLoading === 'function' && !webview.isLoading()) {
                hideLoading();
            }
        }, 700);
    }

    function updateHistoryButtons() {
        const canGoBack = typeof webview.canGoBack === 'function' && webview.canGoBack();
        const canGoForward = typeof webview.canGoForward === 'function' && webview.canGoForward();

        if (backButton) {
            backButton.disabled = !canGoBack;
        }

        if (forwardButton) {
            forwardButton.disabled = !canGoForward;
        }
    }

    function setActiveRoute(route) {
        routeButtons.forEach(button => {
            button.classList.toggle('active', button.dataset.route === route);
        });
    }

    function setActiveRouteFromUrl(url) {
        let activeRoute = 'home';

        for (const matcher of routeMatchers) {
            if (matcher.test(url)) {
                activeRoute = matcher.route;
                break;
            }
        }

        setActiveRoute(activeRoute);
    }

    routeButtons.forEach(button => {
        button.addEventListener('click', async () => {
            await activateRoute(button);
        });
    });

    if (backButton) {
        backButton.addEventListener('click', () => {
            if (typeof webview.canGoBack === 'function' && webview.canGoBack()) {
                webview.goBack();
            }
        });
    }

    if (forwardButton) {
        forwardButton.addEventListener('click', () => {
            if (typeof webview.canGoForward === 'function' && webview.canGoForward()) {
                webview.goForward();
            }
        });
    }

    if (refreshButton) {
        refreshButton.addEventListener('click', () => {
            webview.reload();
        });
    }

    webview.addEventListener('did-start-loading', () => {
        setStatus('Loading YouTube...');
    });

    webview.addEventListener('did-finish-load', () => {
        hideLoading();
        const currentUrl = typeof webview.getURL === 'function' ? webview.getURL() : webview.getAttribute('src') || '';
        setActiveRouteFromUrl(currentUrl);
        updateHistoryButtons();
    });

    webview.addEventListener('did-navigate', event => {
        setActiveRouteFromUrl(event.url || '');
        updateHistoryButtons();
    });

    webview.addEventListener('did-navigate-in-page', event => {
        setActiveRouteFromUrl(event.url || '');
        updateHistoryButtons();
    });

    webview.addEventListener('page-title-updated', event => {
        if (event.title) {
            setStatus(event.title);
        }
    });

    webview.addEventListener('new-window', event => {
        setStatus(`Opening popup: ${event.url}`);
    });

    webview.addEventListener('did-fail-load', event => {
        if (event.errorCode === -3) {
            return;
        }

        loading.classList.remove('hidden');
        setStatus(`Error ${event.errorCode}: ${event.errorDescription}`);
    });

    webview.addEventListener('dom-ready', () => {
        hideLoading();
        updateHistoryButtons();
    });
})();
