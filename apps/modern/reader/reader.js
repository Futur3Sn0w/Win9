/**
 * Microsoft Reader – Windows 8.1 Modern App
 * PDF and document reader for the Win8 Electron simulator.
 *
 * Uses Mozilla pdf.js (loaded via CDN) for PDF rendering.
 * Handles .pdf, .xps, .tiff, .tif file associations.
 * XPS/TIFF display a friendly "not supported" message; PDF is fully rendered.
 */

window.Reader = (() => {
    // --- Electron IPC helper ---
    let ipcRenderer = null;

    try {
        ipcRenderer = require('electron').ipcRenderer;
    } catch (_) {
        try {
            ipcRenderer = window.require('electron').ipcRenderer;
        } catch (__) { /* not in Electron */ }
    }

    // --- State ---
    let pdfDoc = null;
    let currentFilePath = null;
    let currentFileName = null;
    let totalPages = 0;
    let renderedPages = new Map();
    let viewMode = 'continuous'; // continuous | onepage | twopage
    let currentPage = 1;
    let barsVisible = false;
    let findMatches = [];
    let findIndex = -1;
    let mruList = [];

    const MRU_KEY = 'reader-mru';
    const MRU_MAX = 20;
    const PAGE_SCALE = 1.5;

    // --- DOM refs ---
    const $ = (id) => document.getElementById(id);

    function dom() {
        return {
            mru: $('reader-mru'),
            mruList: $('reader-mru-list'),
            mruEmpty: $('reader-mru-empty'),
            browseBtn: $('reader-browse-btn'),
            viewer: $('reader-viewer'),
            topbar: $('reader-topbar'),
            backBtn: $('reader-back-btn'),
            filename: $('reader-filename'),
            pageIndicator: $('reader-page-indicator'),
            canvas: $('reader-canvas'),
            pages: $('reader-pages'),
            loading: $('reader-loading'),
            error: $('reader-error'),
            errorText: $('reader-error-text'),
            errorBack: $('reader-error-back'),
            commandbar: $('reader-commandbar'),
            cmdFind: $('reader-cmd-find'),
            cmdContinuous: $('reader-cmd-continuous'),
            cmdOnepage: $('reader-cmd-onepage'),
            cmdTwopage: $('reader-cmd-twopage'),
            cmdInfo: $('reader-cmd-info'),
            findbar: $('reader-findbar'),
            findInput: $('reader-find-input'),
            findCount: $('reader-find-count'),
            findPrev: $('reader-find-prev'),
            findNext: $('reader-find-next'),
            findClose: $('reader-find-close'),
            infoPanel: $('reader-info-panel'),
            infoBody: $('reader-info-body'),
            infoClose: $('reader-info-close'),
        };
    }

    // ================================================
    // MRU persistence
    // ================================================
    function loadMru() {
        try {
            const raw = localStorage.getItem(MRU_KEY);
            mruList = raw ? JSON.parse(raw) : [];
        } catch (_) {
            mruList = [];
        }
    }

    function saveMru() {
        try {
            localStorage.setItem(MRU_KEY, JSON.stringify(mruList));
        } catch (_) { /* quota exceeded, ignore */ }
    }

    function addToMru(filePath, fileName) {
        mruList = mruList.filter(e => e.path !== filePath);
        mruList.unshift({
            path: filePath,
            name: fileName,
            date: new Date().toLocaleDateString(),
            type: getFileTypeLabel(filePath)
        });
        if (mruList.length > MRU_MAX) {
            mruList.length = MRU_MAX;
        }
        saveMru();
    }

    function getFileTypeLabel(filePath) {
        const ext = (filePath || '').split('.').pop().toLowerCase();
        const labels = {
            pdf: 'PDF Document',
            xps: 'XPS Document',
            oxps: 'OpenXPS Document',
            tiff: 'TIFF Image',
            tif: 'TIFF Image',
        };
        return labels[ext] || 'Document';
    }

    function renderMru() {
        const d = dom();
        d.mruList.innerHTML = '';

        if (mruList.length === 0) {
            d.mruEmpty.hidden = false;
            return;
        }

        d.mruEmpty.hidden = true;

        mruList.forEach(entry => {
            const item = document.createElement('div');
            item.className = 'reader-mru-item';
            item.innerHTML = `
                <div class="reader-mru-thumb">
                    <span class="reader-mru-thumb-placeholder">&#xE130;</span>
                </div>
                <div class="reader-mru-meta">
                    <div class="reader-mru-name">${escapeHtml(entry.name)}</div>
                    <div class="reader-mru-date">${escapeHtml(entry.date)}</div>
                    <div class="reader-mru-type">${escapeHtml(entry.type)}</div>
                </div>
            `;
            item.addEventListener('click', () => openDocument(entry.path));
            d.mruList.appendChild(item);
        });
    }

    // ================================================
    // File opening
    // ================================================
    async function browseForFile() {
        if (!ipcRenderer) {
            console.warn('[Reader] ipcRenderer not available – cannot open file dialog.');
            return;
        }

        try {
            const result = await ipcRenderer.invoke('reader-open-file');
            if (result && !result.canceled && result.filePath) {
                openDocument(result.filePath);
            }
        } catch (err) {
            console.warn('[Reader] Could not open file dialog:', err);
        }
    }

    async function openDocument(filePath) {
        if (!filePath) return;

        const ext = filePath.split('.').pop().toLowerCase();
        const fileName = filePath.split(/[\\/]/).pop();

        currentFilePath = filePath;
        currentFileName = fileName;

        showViewer();
        showLoading();
        hideError();

        // Only PDF is renderable; others get a friendly message
        if (ext === 'xps' || ext === 'oxps') {
            showError('XPS documents are not supported in this version of Reader.');
            return;
        }
        if (ext === 'tiff' || ext === 'tif') {
            showError('TIFF files are not supported in this version of Reader.');
            return;
        }

        if (ext !== 'pdf') {
            showError('This file format is not supported.');
            return;
        }

        try {
            await loadPdf(filePath);
            addToMru(filePath, fileName);
        } catch (err) {
            console.error('[Reader] Failed to open PDF:', err);
            showError('Unable to open this PDF file.\n' + (err.message || ''));
        }
    }

    // ================================================
    // PDF loading & rendering
    // ================================================
    function waitForPdfJs(timeoutMs = 10000) {
        if (typeof pdfjsLib !== 'undefined') {
            return Promise.resolve();
        }

        return new Promise((resolve, reject) => {
            const interval = 50;
            let elapsed = 0;

            const check = setInterval(() => {
                if (typeof pdfjsLib !== 'undefined') {
                    clearInterval(check);
                    resolve();
                    return;
                }

                elapsed += interval;
                if (elapsed >= timeoutMs) {
                    clearInterval(check);
                    reject(new Error('PDF.js library failed to load.'));
                }
            }, interval);
        });
    }

    async function loadPdf(filePath) {
        await waitForPdfJs();

        // Configure worker
        pdfjsLib.GlobalWorkerOptions.workerSrc =
            'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

        // Read file via IPC (main process reads the binary data)
        let data;
        if (ipcRenderer) {
            const result = await ipcRenderer.invoke('reader-read-file', filePath);
            if (!result.success) {
                throw new Error(result.error || 'Failed to read file.');
            }
            // IPC returns a Buffer-like object; convert to Uint8Array
            data = new Uint8Array(result.data);
        } else {
            // Fallback: try fetch with file:// protocol
            const resp = await fetch('file:///' + filePath.replace(/\\/g, '/'));
            const ab = await resp.arrayBuffer();
            data = new Uint8Array(ab);
        }

        const loadingTask = pdfjsLib.getDocument({ data });
        pdfDoc = await loadingTask.promise;
        totalPages = pdfDoc.numPages;
        renderedPages.clear();
        currentPage = 1;

        hideLoading();
        updateFilename();
        await renderAllPages();
        updatePageIndicator();
    }

    async function renderAllPages() {
        const d = dom();
        d.pages.innerHTML = '';
        applyViewModeClass();

        for (let i = 1; i <= totalPages; i++) {
            const page = await pdfDoc.getPage(i);
            const viewport = page.getViewport({ scale: PAGE_SCALE });

            const pageDiv = document.createElement('div');
            pageDiv.className = 'reader-page';
            pageDiv.style.width = viewport.width + 'px';
            pageDiv.style.height = viewport.height + 'px';
            pageDiv.dataset.pageNum = i;

            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const ctx = canvas.getContext('2d');

            pageDiv.appendChild(canvas);
            d.pages.appendChild(pageDiv);

            await page.render({ canvasContext: ctx, viewport }).promise;

            // Build text layer for search
            try {
                const textContent = await page.getTextContent();
                const textLayer = document.createElement('div');
                textLayer.className = 'text-layer';
                textLayer.style.width = viewport.width + 'px';
                textLayer.style.height = viewport.height + 'px';

                textContent.items.forEach(item => {
                    const span = document.createElement('span');
                    const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
                    span.textContent = item.str;
                    span.style.left = tx[4] + 'px';
                    span.style.top = (viewport.height - tx[5]) + 'px';
                    span.style.fontSize = Math.abs(tx[0]) + 'px';
                    span.style.fontFamily = item.fontName || 'sans-serif';
                    textLayer.appendChild(span);
                });

                pageDiv.appendChild(textLayer);
            } catch (_) { /* text extraction may fail on some pages */ }

            renderedPages.set(i, pageDiv);
        }
    }

    // ================================================
    // View modes
    // ================================================
    function applyViewModeClass() {
        const d = dom();
        d.pages.classList.remove('two-page', 'one-page');
        if (viewMode === 'twopage') {
            d.pages.classList.add('two-page');
        } else if (viewMode === 'onepage') {
            d.pages.classList.add('one-page');
        }
    }

    function setViewMode(mode) {
        viewMode = mode;
        applyViewModeClass();

        const d = dom();
        d.cmdContinuous.classList.toggle('reader-cmd-active', mode === 'continuous');
        d.cmdOnepage.classList.toggle('reader-cmd-active', mode === 'onepage');
        d.cmdTwopage.classList.toggle('reader-cmd-active', mode === 'twopage');

        // Clear any two-page scaling
        renderedPages.forEach(div => {
            div.style.transform = '';
            div.style.margin = '';
        });

        if (mode === 'onepage') {
            renderedPages.forEach((div, num) => {
                div.style.display = num === currentPage ? '' : 'none';
            });
        } else if (mode === 'twopage') {
            renderedPages.forEach(div => {
                div.style.display = '';
            });
            applyTwoPageScaling();
        } else {
            renderedPages.forEach(div => {
                div.style.display = '';
            });
        }
    }

    function applyTwoPageScaling() {
        const canvasEl = dom().canvas;
        const availableWidth = canvasEl.clientWidth - 48; // padding
        const gap = 8;

        // Find the widest page to calculate a uniform scale
        let maxPageWidth = 0;
        renderedPages.forEach(div => {
            const w = parseFloat(div.style.width) || div.offsetWidth;
            if (w > maxPageWidth) maxPageWidth = w;
        });

        if (maxPageWidth === 0) return;

        const targetWidth = (availableWidth - gap) / 2;
        const scale = Math.min(1, targetWidth / maxPageWidth);

        renderedPages.forEach(div => {
            const origW = parseFloat(div.style.width) || div.offsetWidth;
            const origH = parseFloat(div.style.height) || div.offsetHeight;
            div.style.transform = `scale(${scale})`;
            div.style.transformOrigin = 'top left';
            // Set negative margins to collapse the space the browser reserves for the unscaled size
            div.style.marginRight = -(origW * (1 - scale)) + 'px';
            div.style.marginBottom = -(origH * (1 - scale)) + 'px';
        });
    }

    function goToPage(num) {
        if (num < 1) num = 1;
        if (num > totalPages) num = totalPages;
        currentPage = num;
        updatePageIndicator();

        if (viewMode === 'onepage') {
            renderedPages.forEach((div, n) => {
                div.style.display = n === currentPage ? '' : 'none';
            });
        } else {
            const pageDiv = renderedPages.get(num);
            if (pageDiv) {
                pageDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }
    }

    // ================================================
    // Search / Find
    // ================================================
    function performSearch(query) {
        clearHighlights();
        findMatches = [];
        findIndex = -1;

        if (!query) {
            dom().findCount.textContent = '';
            return;
        }

        const lower = query.toLowerCase();

        renderedPages.forEach((pageDiv, pageNum) => {
            const textLayer = pageDiv.querySelector('.text-layer');
            if (!textLayer) return;

            const spans = textLayer.querySelectorAll('span');
            spans.forEach(span => {
                if (span.textContent.toLowerCase().includes(lower)) {
                    span.classList.add('highlight');
                    findMatches.push({ pageNum, span });
                }
            });
        });

        dom().findCount.textContent = findMatches.length > 0
            ? `${findMatches.length} match${findMatches.length !== 1 ? 'es' : ''}`
            : 'No matches';

        if (findMatches.length > 0) {
            navigateFind(0);
        }
    }

    function navigateFind(index) {
        if (findMatches.length === 0) return;

        // Remove previous active
        if (findIndex >= 0 && findIndex < findMatches.length) {
            findMatches[findIndex].span.classList.remove('highlight-active');
        }

        findIndex = ((index % findMatches.length) + findMatches.length) % findMatches.length;
        const match = findMatches[findIndex];
        match.span.classList.add('highlight-active');
        goToPage(match.pageNum);
        match.span.scrollIntoView({ behavior: 'smooth', block: 'center' });

        dom().findCount.textContent = `${findIndex + 1} of ${findMatches.length}`;
    }

    function clearHighlights() {
        findMatches.forEach(m => {
            m.span.classList.remove('highlight', 'highlight-active');
        });
        findMatches = [];
        findIndex = -1;
    }

    // ================================================
    // Document info
    // ================================================
    async function showDocumentInfo() {
        const d = dom();
        d.infoBody.innerHTML = '';

        const rows = [];
        rows.push({ label: 'File name', value: currentFileName || '-' });
        rows.push({ label: 'File path', value: currentFilePath || '-' });
        rows.push({ label: 'Pages', value: totalPages || '-' });

        if (pdfDoc) {
            try {
                const meta = await pdfDoc.getMetadata();
                const info = meta.info || {};
                if (info.Title) rows.push({ label: 'Title', value: info.Title });
                if (info.Author) rows.push({ label: 'Author', value: info.Author });
                if (info.Subject) rows.push({ label: 'Subject', value: info.Subject });
                if (info.Creator) rows.push({ label: 'Creator', value: info.Creator });
                if (info.Producer) rows.push({ label: 'Producer', value: info.Producer });
                if (info.CreationDate) rows.push({ label: 'Created', value: formatPdfDate(info.CreationDate) });
                if (info.ModDate) rows.push({ label: 'Modified', value: formatPdfDate(info.ModDate) });
                rows.push({ label: 'PDF version', value: info.PDFFormatVersion || '-' });
            } catch (_) { /* metadata extraction failed */ }
        }

        // File size via IPC
        if (ipcRenderer && currentFilePath) {
            try {
                const statResult = await ipcRenderer.invoke('reader-file-stat', currentFilePath);
                if (statResult.success) {
                    rows.push({ label: 'File size', value: formatFileSize(statResult.size) });
                }
            } catch (_) { /* can't stat */ }
        }

        rows.forEach(r => {
            const row = document.createElement('div');
            row.className = 'reader-info-row';
            row.innerHTML = `<div class="reader-info-label">${escapeHtml(r.label)}</div><div class="reader-info-value">${escapeHtml(String(r.value))}</div>`;
            d.infoBody.appendChild(row);
        });

        d.infoPanel.hidden = false;
    }

    function formatPdfDate(raw) {
        if (!raw) return '-';
        // PDF dates: D:YYYYMMDDHHmmSS
        const match = raw.match(/D:(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?/);
        if (!match) return raw;
        const [, y, m, d, h, min, s] = match;
        return `${y}-${m}-${d}` + (h ? ` ${h}:${min || '00'}:${s || '00'}` : '');
    }

    function formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    // ================================================
    // UI helpers
    // ================================================
    function showViewer() {
        const d = dom();
        d.mru.style.display = 'none';
        d.viewer.hidden = false;
    }

    function showMru() {
        const d = dom();
        d.viewer.hidden = true;
        d.mru.style.display = '';
        pdfDoc = null;
        totalPages = 0;
        renderedPages.clear();
        currentFilePath = null;
        currentFileName = null;
        hideBars();
        hideFind();
        d.infoPanel.hidden = true;
        d.pages.innerHTML = '';
        renderMru();
    }

    function showLoading() { dom().loading.hidden = false; }
    function hideLoading() { dom().loading.hidden = true; }

    function showError(msg) {
        const d = dom();
        hideLoading();
        d.errorText.textContent = msg;
        d.error.hidden = false;
    }

    function hideError() { dom().error.hidden = true; }

    function updateFilename() {
        dom().filename.textContent = currentFileName || '';
    }

    function updatePageIndicator() {
        dom().pageIndicator.textContent = totalPages > 0
            ? `Page ${currentPage} of ${totalPages}`
            : '';
    }

    function toggleBars() {
        barsVisible = !barsVisible;
        dom().topbar.classList.toggle('visible', barsVisible);
        dom().commandbar.classList.toggle('visible', barsVisible);
    }

    function hideBars() {
        barsVisible = false;
        dom().topbar.classList.remove('visible');
        dom().commandbar.classList.remove('visible');
    }

    function showFind() {
        dom().findbar.hidden = false;
        dom().findInput.focus();
        hideBars();
    }

    function hideFind() {
        dom().findbar.hidden = true;
        dom().findInput.value = '';
        dom().findCount.textContent = '';
        clearHighlights();
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ================================================
    // Scroll-based page tracking
    // ================================================
    function setupScrollTracking() {
        const canvasEl = dom().canvas;
        canvasEl.addEventListener('scroll', () => {
            if (viewMode === 'onepage' || totalPages === 0) return;

            const canvasRect = canvasEl.getBoundingClientRect();
            const mid = canvasRect.top + canvasRect.height / 2;
            let closest = 1;
            let closestDist = Infinity;

            renderedPages.forEach((div, num) => {
                const rect = div.getBoundingClientRect();
                const pageMid = rect.top + rect.height / 2;
                const dist = Math.abs(pageMid - mid);
                if (dist < closestDist) {
                    closestDist = dist;
                    closest = num;
                }
            });

            if (closest !== currentPage) {
                currentPage = closest;
                updatePageIndicator();
            }
        });
    }

    // ================================================
    // Event wiring
    // ================================================
    function setupEvents() {
        const d = dom();

        // Browse button
        d.browseBtn.addEventListener('click', browseForFile);

        // Back buttons
        d.backBtn.addEventListener('click', showMru);
        d.errorBack.addEventListener('click', showMru);

        // Canvas click toggles bars
        d.canvas.addEventListener('click', (e) => {
            // Don't toggle if clicking a page or text
            if (e.target.closest('.reader-page')) {
                toggleBars();
            } else {
                toggleBars();
            }
        });

        // View mode buttons
        d.cmdContinuous.addEventListener('click', () => setViewMode('continuous'));
        d.cmdOnepage.addEventListener('click', () => setViewMode('onepage'));
        d.cmdTwopage.addEventListener('click', () => setViewMode('twopage'));

        // Find
        d.cmdFind.addEventListener('click', showFind);
        d.findClose.addEventListener('click', hideFind);
        d.findInput.addEventListener('input', (e) => performSearch(e.target.value));
        d.findInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                if (e.shiftKey) {
                    navigateFind(findIndex - 1);
                } else {
                    navigateFind(findIndex + 1);
                }
            }
            if (e.key === 'Escape') hideFind();
        });
        d.findPrev.addEventListener('click', () => navigateFind(findIndex - 1));
        d.findNext.addEventListener('click', () => navigateFind(findIndex + 1));

        // Info
        d.cmdInfo.addEventListener('click', () => {
            if (d.infoPanel.hidden) {
                showDocumentInfo();
            } else {
                d.infoPanel.hidden = true;
            }
        });
        d.infoClose.addEventListener('click', () => { d.infoPanel.hidden = true; });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'f') {
                e.preventDefault();
                showFind();
            }
            if (e.key === 'Escape') {
                if (!d.findbar.hidden) hideFind();
                else if (!d.infoPanel.hidden) d.infoPanel.hidden = true;
                else if (barsVisible) hideBars();
            }
            // Page navigation in one-page mode
            if (viewMode === 'onepage') {
                if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                    goToPage(currentPage + 1);
                } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                    goToPage(currentPage - 1);
                }
            }
        });

        // Scroll tracking
        setupScrollTracking();

        // --- File opening from the shell ---
        // postMessage (iframe mode)
        window.addEventListener('message', (event) => {
            if (event.data?.action === 'openFile' && event.data.filePath) {
                openDocument(event.data.filePath);
            }
            if (event.data?.action === 'openFileData' && event.data.fileData?.filePath) {
                openDocument(event.data.fileData.filePath);
            }
        });

        // CustomEvent (loadDirect mode)
        document.addEventListener('openFile', (event) => {
            if (event.detail?.filePath) {
                openDocument(event.detail.filePath);
            }
        });
        document.addEventListener('openFileData', (event) => {
            if (event.detail?.fileData?.filePath) {
                openDocument(event.detail.fileData.filePath);
            }
        });

        // Check for launch options
        if (window.launchOptions?.openFilePath) {
            openDocument(window.launchOptions.openFilePath);
        } else if (window.launchOptions?.openFileData?.filePath) {
            openDocument(window.launchOptions.openFileData.filePath);
        }
    }

    // ================================================
    // Init
    // ================================================
    function init() {
        loadMru();
        renderMru();
        setupEvents();
    }

    // Run on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    return { openDocument, browseForFile };
})();
