'use strict';

// Font list (common system fonts matching what real charmap shows)
const FONTS = [
    'Arial', 'Arial Black', 'Calibri', 'Calibri Light', 'Cambria',
    'Comic Sans MS', 'Consolas', 'Constantia', 'Corbel', 'Courier New',
    'Franklin Gothic Medium', 'Garamond', 'Georgia', 'Impact',
    'Lucida Console', 'Lucida Sans Unicode', 'MS Gothic', 'MS Mincho',
    'Palatino Linotype', 'Segoe Print', 'Segoe Script', 'Segoe UI',
    'Segoe UI Light', 'Segoe UI Semibold', 'Segoe UI Symbol',
    'Symbol', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana',
    'Webdings', 'Wingdings', 'Wingdings 2', 'Wingdings 3',
];

// Unicode character name lookup (partial - covers common blocks)
const UNICODE_NAMES = {
    0x0020: 'Space', 0x0021: 'Exclamation Mark', 0x0022: 'Quotation Mark',
    0x0023: 'Number Sign', 0x0024: 'Dollar Sign', 0x0025: 'Percent Sign',
    0x0026: 'Ampersand', 0x0027: 'Apostrophe', 0x0028: 'Left Parenthesis',
    0x0029: 'Right Parenthesis', 0x002A: 'Asterisk', 0x002B: 'Plus Sign',
    0x002C: 'Comma', 0x002D: 'Hyphen-Minus', 0x002E: 'Full Stop',
    0x002F: 'Solidus', 0x0030: 'Digit Zero', 0x0031: 'Digit One',
    0x0032: 'Digit Two', 0x0033: 'Digit Three', 0x0034: 'Digit Four',
    0x0035: 'Digit Five', 0x0036: 'Digit Six', 0x0037: 'Digit Seven',
    0x0038: 'Digit Eight', 0x0039: 'Digit Nine', 0x003A: 'Colon',
    0x003B: 'Semicolon', 0x003C: 'Less-Than Sign', 0x003D: 'Equals Sign',
    0x003E: 'Greater-Than Sign', 0x003F: 'Question Mark',
    0x0040: 'Commercial At',
    0x0041: 'Latin Capital Letter A', 0x0042: 'Latin Capital Letter B',
    0x0043: 'Latin Capital Letter C', 0x0044: 'Latin Capital Letter D',
    0x0045: 'Latin Capital Letter E', 0x0046: 'Latin Capital Letter F',
    0x0047: 'Latin Capital Letter G', 0x0048: 'Latin Capital Letter H',
    0x0049: 'Latin Capital Letter I', 0x004A: 'Latin Capital Letter J',
    0x004B: 'Latin Capital Letter K', 0x004C: 'Latin Capital Letter L',
    0x004D: 'Latin Capital Letter M', 0x004E: 'Latin Capital Letter N',
    0x004F: 'Latin Capital Letter O', 0x0050: 'Latin Capital Letter P',
    0x0051: 'Latin Capital Letter Q', 0x0052: 'Latin Capital Letter R',
    0x0053: 'Latin Capital Letter S', 0x0054: 'Latin Capital Letter T',
    0x0055: 'Latin Capital Letter U', 0x0056: 'Latin Capital Letter V',
    0x0057: 'Latin Capital Letter W', 0x0058: 'Latin Capital Letter X',
    0x0059: 'Latin Capital Letter Y', 0x005A: 'Latin Capital Letter Z',
    0x005B: 'Left Square Bracket', 0x005C: 'Reverse Solidus',
    0x005D: 'Right Square Bracket', 0x005E: 'Circumflex Accent',
    0x005F: 'Low Line', 0x0060: 'Grave Accent',
    0x0061: 'Latin Small Letter A', 0x0062: 'Latin Small Letter B',
    0x0063: 'Latin Small Letter C', 0x0064: 'Latin Small Letter D',
    0x0065: 'Latin Small Letter E', 0x0066: 'Latin Small Letter F',
    0x0067: 'Latin Small Letter G', 0x0068: 'Latin Small Letter H',
    0x0069: 'Latin Small Letter I', 0x006A: 'Latin Small Letter J',
    0x006B: 'Latin Small Letter K', 0x006C: 'Latin Small Letter L',
    0x006D: 'Latin Small Letter M', 0x006E: 'Latin Small Letter N',
    0x006F: 'Latin Small Letter O', 0x0070: 'Latin Small Letter P',
    0x0071: 'Latin Small Letter Q', 0x0072: 'Latin Small Letter R',
    0x0073: 'Latin Small Letter S', 0x0074: 'Latin Small Letter T',
    0x0075: 'Latin Small Letter U', 0x0076: 'Latin Small Letter V',
    0x0077: 'Latin Small Letter W', 0x0078: 'Latin Small Letter X',
    0x0079: 'Latin Small Letter Y', 0x007A: 'Latin Small Letter Z',
    0x007B: 'Left Curly Bracket', 0x007C: 'Vertical Line',
    0x007D: 'Right Curly Bracket', 0x007E: 'Tilde',
    0x00A0: 'No-Break Space', 0x00A9: 'Copyright Sign',
    0x00AE: 'Registered Sign', 0x00B0: 'Degree Sign',
    0x00B7: 'Middle Dot', 0x00D7: 'Multiplication Sign',
    0x00F7: 'Division Sign', 0x20AC: 'Euro Sign',
    0x2018: 'Left Single Quotation Mark', 0x2019: 'Right Single Quotation Mark',
    0x201C: 'Left Double Quotation Mark', 0x201D: 'Right Double Quotation Mark',
    0x2022: 'Bullet', 0x2026: 'Horizontal Ellipsis',
    0x2013: 'En Dash', 0x2014: 'Em Dash',
    0x2122: 'Trade Mark Sign',
};

const COLS = 20;
const ROWS = 16;
const PAGE_SIZE = COLS * ROWS;

// State
let currentFont = 'Arial';
let scrollOffset = 0;
let selectedCell = -1;
let hoveredCell = -1;
let copyText = '';
let searchResults = null;
let advancedVisible = false;
let isDraggingThumb = false;
let thumbDragStartY = 0;
let thumbDragStartOffset = 0;
let previewSuppressed = false;
let scrollInterval = null;

// DOM refs
const rootStyle = document.documentElement.style;
const gridWrapper = document.querySelector('.charmap-grid-wrapper');
const grid = document.getElementById('charmap-grid');
const zoomEl = document.getElementById('charmap-zoom');
const fontSelect = document.getElementById('charmap-font');
const copyInput = document.getElementById('charmap-copy-text');
const selectBtn = document.getElementById('charmap-select-btn');
const copyBtn = document.getElementById('charmap-copy-btn');
const advancedToggle = document.getElementById('charmap-advanced-toggle');
const advancedPanel = document.getElementById('charmap-advanced-panel');
const unicodeInput = document.getElementById('charmap-unicode-input');
const searchInput = document.getElementById('charmap-search');
const searchBtn = document.getElementById('charmap-search-btn');
const statusText = document.getElementById('charmap-status-text');
const scrollUpBtn = document.getElementById('scroll-up');
const scrollDownBtn = document.getElementById('scroll-down');
const scrollThumb = document.getElementById('scroll-thumb');
const scrollTrack = document.getElementById('scroll-track');

// Max codepoint we display (BMP minus surrogates)
const MAX_CP = 0xFFFF;
const MAX_ROWS = Math.ceil((MAX_CP - 0x0020 + 1) / COLS);

function populateFonts() {
    FONTS.forEach(font => {
        const option = document.createElement('option');
        option.value = font;
        option.textContent = font;
        option.style.fontFamily = font;
        fontSelect.appendChild(option);
    });

    fontSelect.value = currentFont;
}

function buildGrid() {
    grid.innerHTML = '';
    const codepoints = currentCodepoints();

    codepoints.forEach((cp, index) => {
        const cell = document.createElement('div');
        cell.className = 'charmap-cell';
        cell.dataset.cp = String(cp);
        cell.dataset.idx = String(index);

        if (cp > 0) {
            cell.style.fontFamily = `"${currentFont}", serif`;
            cell.textContent = String.fromCodePoint(cp);
        }

        if (index === selectedCell) {
            cell.classList.add('selected');
        }

        cell.addEventListener('mouseenter', () => onCellHover(cp, index));
        cell.addEventListener('mouseleave', onCellLeave);
        cell.addEventListener('mousedown', () => onCellClick(cell, cp, index));
        cell.addEventListener('dblclick', () => onCellDblClick(cp));

        grid.appendChild(cell);
    });

    updateScrollThumb();
    syncPreview();
}

function currentCodepoints() {
    if (searchResults !== null) {
        const slice = searchResults.slice(scrollOffset, scrollOffset + PAGE_SIZE);
        while (slice.length < PAGE_SIZE) {
            slice.push(0);
        }
        return slice;
    }

    const base = 0x0020 + scrollOffset;
    const result = [];

    for (let index = 0; index < PAGE_SIZE; index += 1) {
        const cp = base + index;
        result.push(cp > MAX_CP || isSurrogate(cp) ? 0 : cp);
    }

    return result;
}

function isSurrogate(cp) {
    return cp >= 0xD800 && cp <= 0xDFFF;
}

function cellAt(index) {
    if (index < 0) {
        return null;
    }

    return grid.querySelector(`.charmap-cell[data-idx="${index}"]`);
}

function codepointFromCell(cell) {
    if (!cell) {
        return 0;
    }

    return parseInt(cell.dataset.cp, 10) || 0;
}

function clearActivePreviewCell() {
    const activeCell = grid.querySelector('.charmap-cell.active-zoom');
    if (activeCell) {
        activeCell.classList.remove('active-zoom');
    }
}

function positionZoom(cell) {
    const wrapperRect = gridWrapper.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();
    const left = cellRect.left - wrapperRect.left + (cellRect.width / 2);
    const top = cellRect.top - wrapperRect.top + (cellRect.height / 2);

    zoomEl.style.left = `${left}px`;
    zoomEl.style.top = `${top}px`;
}

function hidePreview() {
    zoomEl.style.display = 'none';
    clearActivePreviewCell();
}

function syncPreview() {
    const previewIndex = hoveredCell !== -1 ? hoveredCell : selectedCell;
    const previewCell = cellAt(previewIndex);
    const cp = codepointFromCell(previewCell);

    if (previewSuppressed || !previewCell || cp === 0) {
        hidePreview();
        return;
    }

    clearActivePreviewCell();
    previewCell.classList.add('active-zoom');
    zoomEl.style.fontFamily = `"${currentFont}", serif`;
    zoomEl.textContent = String.fromCodePoint(cp);
    positionZoom(previewCell);
    zoomEl.style.display = 'flex';
}

function updateGridMetrics() {
    if (!gridWrapper) {
        return;
    }

    const computedStyle = getComputedStyle(document.documentElement);
    const container = gridWrapper.parentElement;
    const containerStyle = container ? getComputedStyle(container) : null;
    const scrollbarWidth = parseFloat(computedStyle.getPropertyValue('--charmap-scrollbar-width')) || 17;
    const horizontalPadding = containerStyle
        ? (parseFloat(containerStyle.paddingLeft) || 0) + (parseFloat(containerStyle.paddingRight) || 0)
        : 0;
    const containerWidth = container
        ? Math.max(0, container.clientWidth - horizontalPadding)
        : gridWrapper.clientWidth;
    const availableWidth = Math.max(0, containerWidth - scrollbarWidth);
    const availableHeight = Math.max(0, gridWrapper.clientHeight);
    const nextCellSize = Math.max(13, Math.floor(Math.min(availableWidth / COLS, availableHeight / ROWS)));

    rootStyle.setProperty('--charmap-cell-size', `${nextCellSize}px`);
    syncPreview();
}

function onCellHover(cp, index) {
    if (cp === 0) {
        return;
    }

    hoveredCell = index;
    updateStatus(cp);
    syncPreview();
}

function onCellLeave() {
    hoveredCell = -1;

    if (selectedCell === -1) {
        hidePreview();
        statusText.innerHTML = '&nbsp;';
        return;
    }

    const selected = cellAt(selectedCell);
    const cp = codepointFromCell(selected);

    if (cp !== 0) {
        updateStatus(cp);
    }

    syncPreview();
}

function onCellClick(cell, cp, index) {
    if (cp === 0) {
        return;
    }

    const previous = grid.querySelector('.charmap-cell.selected');
    if (previous) {
        previous.classList.remove('selected');
    }

    cell.classList.add('selected');
    selectedCell = index;
    hoveredCell = index;
    previewSuppressed = false;

    updateStatus(cp);
    syncUnicodeInput(cp);
    syncPreview();
}

function onCellDblClick(cp) {
    if (cp !== 0) {
        appendToClipboard(cp);
    }
}

function appendToClipboard(cp) {
    copyText += String.fromCodePoint(cp);
    copyInput.value = copyText;
}

function updateStatus(cp) {
    const hex = cp.toString(16).toUpperCase().padStart(4, '0');
    const name = UNICODE_NAMES[cp] || '';
    const nameSuffix = name ? `: ${name}` : '';
    const decimal = cp.toString().padStart(4, '0');

    statusText.textContent = `U+${hex}${nameSuffix}    Keystroke: Alt+${decimal}`;
}

function syncUnicodeInput(cp) {
    unicodeInput.value = cp.toString(16).toUpperCase().padStart(4, '0');
}

function resetSelectionState() {
    selectedCell = -1;
    hoveredCell = -1;
    hidePreview();
    statusText.innerHTML = '&nbsp;';
}

function scrollBy(delta) {
    const maxOffset = searchResults !== null
        ? Math.max(0, searchResults.length - PAGE_SIZE)
        : (MAX_ROWS - ROWS) * COLS;

    scrollOffset = Math.max(0, Math.min(maxOffset, scrollOffset + delta));
    resetSelectionState();
    buildGrid();
}

function scrollToCP(cp) {
    const safeCodepoint = Math.max(0x0020, Math.min(MAX_CP, cp));
    const row = Math.floor((safeCodepoint - 0x0020) / COLS);

    scrollOffset = row * COLS;
    resetSelectionState();
    buildGrid();
}

function updateScrollThumb() {
    const totalRows = searchResults !== null
        ? Math.ceil(searchResults.length / COLS)
        : MAX_ROWS;

    const trackHeight = scrollTrack.clientHeight;
    const thumbHeight = Math.max(16, Math.round((ROWS / totalRows) * trackHeight));
    const maxScroll = totalRows - ROWS;
    const currentRow = scrollOffset / COLS;
    const thumbTop = maxScroll > 0
        ? Math.round((currentRow / maxScroll) * (trackHeight - thumbHeight))
        : 0;

    scrollThumb.style.height = `${thumbHeight}px`;
    scrollThumb.style.top = `${thumbTop}px`;
}

fontSelect.addEventListener('change', () => {
    currentFont = fontSelect.value;
    buildGrid();
});

selectBtn.addEventListener('click', () => {
    if (selectedCell === -1) {
        return;
    }

    const cp = codepointFromCell(cellAt(selectedCell));
    if (cp !== 0) {
        appendToClipboard(cp);
    }
});

copyBtn.addEventListener('click', () => {
    if (!copyText || !navigator.clipboard) {
        return;
    }

    navigator.clipboard.writeText(copyText).catch(() => {});
});

advancedToggle.addEventListener('change', () => {
    advancedVisible = advancedToggle.checked;
    advancedPanel.classList.toggle('visible', advancedVisible);
    requestAnimationFrame(updateGridMetrics);
});

unicodeInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
        jumpToUnicode();
    }
});

unicodeInput.addEventListener('input', () => {
    unicodeInput.value = unicodeInput.value.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
});

function jumpToUnicode() {
    const value = unicodeInput.value.trim();
    if (!value) {
        return;
    }

    const cp = parseInt(value, 16);
    if (!Number.isNaN(cp) && cp >= 0x0020 && cp <= MAX_CP) {
        searchResults = null;
        scrollToCP(cp);
    }
}

searchBtn.addEventListener('click', doSearch);
searchInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
        doSearch();
    }
});

function doSearch() {
    const query = searchInput.value.trim().toLowerCase();

    if (!query) {
        searchResults = null;
        scrollOffset = 0;
        resetSelectionState();
        buildGrid();
        statusText.innerHTML = '&nbsp;';
        return;
    }

    const results = [];

    for (let cp = 0x0020; cp <= MAX_CP; cp += 1) {
        if (isSurrogate(cp)) {
            continue;
        }

        const name = (UNICODE_NAMES[cp] || '').toLowerCase();
        const character = String.fromCodePoint(cp);

        if (name.includes(query) || character === query) {
            results.push(cp);
        }
    }

    searchResults = results;
    scrollOffset = 0;
    resetSelectionState();
    buildGrid();

    if (results.length === 0) {
        statusText.textContent = 'No characters found.';
    }
}

function selectCellByIndex(index) {
    const cell = cellAt(index);
    if (cell) {
        cell.dispatchEvent(new MouseEvent('mousedown'));
    }
}

grid.addEventListener('keydown', event => {
    if (selectedCell === -1 && (
        event.key === 'ArrowRight' ||
        event.key === 'ArrowLeft' ||
        event.key === 'ArrowDown' ||
        event.key === 'ArrowUp'
    )) {
        selectCellByIndex(0);
        return;
    }

    const cells = grid.querySelectorAll('.charmap-cell');

    switch (event.key) {
        case 'ArrowRight':
            event.preventDefault();
            if (selectedCell < PAGE_SIZE - 1 && cells[selectedCell + 1]) {
                selectCellByIndex(selectedCell + 1);
            } else {
                scrollBy(COLS);
                setTimeout(() => selectCellByIndex(0), 0);
            }
            break;

        case 'ArrowLeft':
            event.preventDefault();
            if (selectedCell > 0) {
                selectCellByIndex(selectedCell - 1);
            } else if (scrollOffset > 0) {
                scrollBy(-COLS);
                setTimeout(() => selectCellByIndex(PAGE_SIZE - 1), 0);
            }
            break;

        case 'ArrowDown':
            event.preventDefault();
            if (selectedCell + COLS < PAGE_SIZE && cells[selectedCell + COLS]) {
                selectCellByIndex(selectedCell + COLS);
            } else {
                scrollBy(COLS);
            }
            break;

        case 'ArrowUp':
            event.preventDefault();
            if (selectedCell - COLS >= 0) {
                selectCellByIndex(selectedCell - COLS);
            } else if (scrollOffset > 0) {
                scrollBy(-COLS);
            }
            break;

        case 'Enter':
            event.preventDefault();
            if (selectedCell !== -1) {
                const cp = codepointFromCell(cellAt(selectedCell));
                if (cp !== 0) {
                    appendToClipboard(cp);
                }
            }
            break;

        case ' ':
        case 'Spacebar':
            if (selectedCell === -1) {
                break;
            }
            event.preventDefault();
            previewSuppressed = !previewSuppressed;
            syncPreview();
            break;

        case 'PageDown':
            event.preventDefault();
            scrollBy(PAGE_SIZE);
            break;

        case 'PageUp':
            event.preventDefault();
            scrollBy(-PAGE_SIZE);
            break;
    }
});

grid.addEventListener('wheel', event => {
    event.preventDefault();
    scrollBy(event.deltaY > 0 ? COLS : -COLS);
}, { passive: false });

function startScroll(delta) {
    scrollBy(delta);
    scrollInterval = setInterval(() => scrollBy(delta), 100);
}

function stopScroll() {
    if (scrollInterval) {
        clearInterval(scrollInterval);
        scrollInterval = null;
    }
}

scrollUpBtn.addEventListener('mousedown', () => startScroll(-COLS));
scrollDownBtn.addEventListener('mousedown', () => startScroll(COLS));
document.addEventListener('mouseup', stopScroll);

scrollThumb.addEventListener('mousedown', event => {
    isDraggingThumb = true;
    thumbDragStartY = event.clientY;
    thumbDragStartOffset = scrollOffset;
    event.preventDefault();
});

document.addEventListener('mousemove', event => {
    if (!isDraggingThumb) {
        return;
    }

    const trackHeight = scrollTrack.clientHeight;
    const thumbHeight = parseInt(scrollThumb.style.height, 10) || 16;
    const totalRows = searchResults !== null
        ? Math.ceil(searchResults.length / COLS)
        : MAX_ROWS;
    const maxScroll = totalRows - ROWS;
    const deltaY = event.clientY - thumbDragStartY;
    const ratio = deltaY / (trackHeight - thumbHeight);
    const nextRow = Math.round((thumbDragStartOffset / COLS) + (ratio * maxScroll));
    const clampedRow = Math.max(0, Math.min(maxScroll, nextRow));

    scrollOffset = clampedRow * COLS;
    resetSelectionState();
    buildGrid();
});

document.addEventListener('mouseup', () => {
    isDraggingThumb = false;
});

scrollTrack.addEventListener('mousedown', event => {
    if (event.target === scrollThumb) {
        return;
    }

    const rect = scrollTrack.getBoundingClientRect();
    const clickY = event.clientY - rect.top;
    const trackHeight = scrollTrack.clientHeight;
    const totalRows = searchResults !== null
        ? Math.ceil(searchResults.length / COLS)
        : MAX_ROWS;
    const maxScroll = totalRows - ROWS;
    const targetRow = Math.round((clickY / trackHeight) * maxScroll);

    scrollOffset = Math.max(0, Math.min(maxScroll, targetRow)) * COLS;
    resetSelectionState();
    buildGrid();
});

function init() {
    populateFonts();
    updateGridMetrics();
    buildGrid();
}

window.addEventListener('resize', updateGridMetrics);

init();
