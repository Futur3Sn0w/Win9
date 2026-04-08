'use strict';

/* ============================================================
   MS Paint – Drawing engine + UI controller
   ============================================================ */

// ── Default colour palette (Windows 8.1 Paint, 2 × 14) ─────
const DEFAULT_PALETTE = [
    // Row 1
    '#000000','#7f7f7f','#880015','#ed1c24','#ff7f27','#fff200',
    '#22b14c','#00a2e8','#3f48cc','#a349a4','#b97a57','#ffaec9',
    '#ffc90e','#efe4b0',
    // Row 2
    '#ffffff','#c3c3c3','#b97a57','#ffaec9','#ff7f27','#ffc90e',
    '#22b14c','#99d9ea','#7092be','#c8bfe7','#a349a4','#ff80c0',
    '#ff80ff','#804000',
];

// ── State ────────────────────────────────────────────────────
const state = {
    tool:        'pencil',  // current drawing tool
    brush:       'round',   // current brush type
    shape:       null,      // current shape type (or null)
    lineWidth:   1,
    color1:      '#000000', // foreground
    color2:      '#ffffff', // background
    zoom:        1.0,
    showRulers:  true,
    showGrid:    false,
    showStatus:  true,
    transparentSelect: false,
    outline:     'solid',
    fill:        'none',
    // undo/redo
    undoStack:   [],
    redoStack:   [],
    maxUndo:     50,
    // drawing
    drawing:     false,
    startX:      0,
    startY:      0,
    lastX:       0,
    lastY:       0,
    // selection
    selection:   null,        // { x,y,w,h }
    selMoving:   false,
    selCanvas:   null,        // offscreen canvas holding selection pixels
    // text
    textInput:   null,        // active textarea element
    textX:       0,
    textY:       0,
    // canvas size
    canvasW:     640,
    canvasH:     480,
    // modified
    modified:    false,
    filename:    'Untitled',
};

// ── DOM refs ─────────────────────────────────────────────────
const canvas   = document.getElementById('paint-canvas');
const overlay  = document.getElementById('paint-overlay');
const ctx      = canvas.getContext('2d');
const octx     = overlay.getContext('2d');
const canvasBg = document.getElementById('canvas-bg');
const scroll   = document.getElementById('canvas-scroll');

// ── Initialise ───────────────────────────────────────────────
function init() {
    fillWhite();
    buildPalette();
    updateSwatches();
    updateZoomSlider();
    bindRibbon();
    bindCanvas();
    bindKeyboard();
    bindAppMenu();
    bindDialogs();
    drawRulers();
    syncToolUI();
    updateTitle();
}

function fillWhite() {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
}

// ── Palette ──────────────────────────────────────────────────
function buildPalette() {
    const palette = document.getElementById('color-palette');
    palette.innerHTML = '';
    DEFAULT_PALETTE.forEach(color => {
        const cell = document.createElement('div');
        cell.className = 'paint-color-cell';
        cell.style.background = color;
        cell.title = color;
        cell.addEventListener('click',  e => pickPaletteColor(color, e));
        cell.addEventListener('contextmenu', e => { e.preventDefault(); pickPaletteColor(color, e, true); });
        palette.appendChild(cell);
    });
}

function pickPaletteColor(color, e, isRight = false) {
    if (e.shiftKey || isRight) {
        state.color2 = color;
    } else {
        state.color1 = color;
    }
    updateSwatches();
}

function setColor1(c) { state.color1 = c; updateSwatches(); }
function setColor2(c) { state.color2 = c; updateSwatches(); }
function updateSwatches() {
    document.getElementById('color1-swatch').style.background = state.color1;
    document.getElementById('color2-swatch').style.background = state.color2;
}

// ── Undo/Redo ────────────────────────────────────────────────
function pushUndo() {
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    state.undoStack.push(data);
    if (state.undoStack.length > state.maxUndo) state.undoStack.shift();
    state.redoStack = [];
    state.modified = true;
    updateUndoButtons();
    updateTitle();
}

function undo() {
    if (!state.undoStack.length) return;
    state.redoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    ctx.putImageData(state.undoStack.pop(), 0, 0);
    updateUndoButtons();
}

function redo() {
    if (!state.redoStack.length) return;
    state.undoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    ctx.putImageData(state.redoStack.pop(), 0, 0);
    updateUndoButtons();
}

function updateUndoButtons() {
    document.querySelector('[data-action="undo"]').disabled = !state.undoStack.length;
    document.querySelector('[data-action="redo"]').disabled = !state.redoStack.length;
}

// ── Canvas coords ────────────────────────────────────────────
function canvasXY(e) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: Math.round((e.clientX - rect.left) / state.zoom),
        y: Math.round((e.clientY - rect.top)  / state.zoom),
    };
}

// ── Ribbon bindings ──────────────────────────────────────────
function bindRibbon() {
    // Tab switching
    document.querySelectorAll('.paint-ribbon-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.paint-ribbon-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.paint-ribbon-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            const content = document.querySelector(`.paint-ribbon-content[data-tab="${tab.dataset.tab}"]`);
            if (content) content.classList.add('active');
        });
    });

    // Tool buttons
    document.querySelectorAll('[data-tool]').forEach(btn => {
        btn.addEventListener('click', () => setTool(btn.dataset.tool));
    });

    // Action buttons
    document.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', e => handleAction(btn.dataset.action, e));
    });

    // Brush gallery
    document.querySelectorAll('[data-brush]').forEach(btn => {
        btn.addEventListener('click', () => {
            state.brush = btn.dataset.brush;
            document.querySelectorAll('[data-brush]').forEach(b => b.classList.remove('paint-gallery-item-active'));
            btn.classList.add('paint-gallery-item-active');
            setTool('brush');
        });
    });

    // Shape gallery
    document.querySelectorAll('[data-shape]').forEach(btn => {
        btn.addEventListener('click', () => {
            state.shape = btn.dataset.shape;
            document.querySelectorAll('[data-shape]').forEach(b => b.classList.remove('paint-gallery-item-active'));
            btn.classList.add('paint-gallery-item-active');
            setTool('shape');
        });
    });

    // Size gallery
    document.querySelectorAll('[data-size]').forEach(btn => {
        btn.addEventListener('click', () => {
            state.lineWidth = parseInt(btn.dataset.size);
            document.querySelectorAll('[data-size]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    // Color swatches
    document.getElementById('color1-swatch').addEventListener('click', () => openColorPicker(1));
    document.getElementById('color2-swatch').addEventListener('click', () => openColorPicker(2));
    document.getElementById('color1-swatch').addEventListener('contextmenu', e => { e.preventDefault(); swapColors(); });
    document.getElementById('color2-swatch').addEventListener('contextmenu', e => { e.preventDefault(); swapColors(); });

    // Split button dropdowns
    document.querySelectorAll('.paint-ribbon-split').forEach(split => {
        const dropdown = split.querySelector('.paint-dropdown');
        if (!dropdown) return;
        const arrow = split.querySelector('.paint-ribbon-split-bottom, .paint-ribbon-split-arrow-sm');
        if (arrow) {
            arrow.addEventListener('click', e => {
                e.stopPropagation();
                toggleDropdown(dropdown);
            });
        }
    });

    // Shape outline/fill dropdowns
    document.querySelectorAll('[data-outline]').forEach(item => {
        item.addEventListener('click', () => {
            state.outline = item.dataset.outline;
            closeAllDropdowns();
        });
    });
    document.querySelectorAll('[data-fill]').forEach(item => {
        item.addEventListener('click', () => {
            state.fill = item.dataset.fill;
            closeAllDropdowns();
        });
    });

    // View checkboxes
    document.getElementById('chk-rulers').addEventListener('change', e => toggleRulers(e.target.checked));
    document.getElementById('chk-gridlines').addEventListener('change', e => toggleGrid(e.target.checked));
    document.getElementById('chk-statusbar').addEventListener('change', e => toggleStatusBar(e.target.checked));

    // Zoom slider
    const zoomSlider = document.getElementById('zoom-slider');
    zoomSlider.addEventListener('input', () => setZoom(zoomSlider.value / 100));

    // QAT
    document.querySelector('[data-action="undo"]').addEventListener('click', undo);
    document.querySelector('[data-action="redo"]').addEventListener('click', redo);

    // Close dropdowns on outside click
    document.addEventListener('click', closeAllDropdowns);
    document.addEventListener('contextmenu', closeAllDropdowns);
}

function toggleDropdown(dd) {
    const wasOpen = dd.classList.contains('open');
    closeAllDropdowns();
    if (!wasOpen) dd.classList.add('open');
}

function closeAllDropdowns() {
    document.querySelectorAll('.paint-dropdown.open').forEach(d => d.classList.remove('open'));
}

// ── Actions ──────────────────────────────────────────────────
function handleAction(action, e) {
    if (e) e.stopPropagation();
    switch (action) {
        case 'undo':            undo(); break;
        case 'redo':            redo(); break;
        case 'cut':             cutSelection(); break;
        case 'copy':            copySelection(); break;
        case 'paste':           pasteClipboard(); break;
        case 'paste-from':      pasteFromFile(); break;
        case 'select-rect':     setTool('select-rect'); break;
        case 'select-free':     setTool('select-free'); break;
        case 'select-all':      selectAll(); break;
        case 'select-invert':   invertSelection(); break;
        case 'select-delete':   deleteSelection(); break;
        case 'toggle-transparent-select': toggleTransparentSelect(); break;
        case 'crop':            cropToSelection(); break;
        case 'resize':          openResizeDialog(); break;
        case 'rotate-right':    rotateCanvas(90); break;
        case 'rotate-left':     rotateCanvas(-90); break;
        case 'rotate-180':      rotateCanvas(180); break;
        case 'flip-h':          flipCanvas('h'); break;
        case 'flip-v':          flipCanvas('v'); break;
        case 'zoom-in':         case 'zoom-in-sb':  zoomBy(2); break;
        case 'zoom-out':        case 'zoom-out-sb': zoomBy(0.5); break;
        case 'zoom-100':        setZoom(1); break;
        case 'fullscreen':      toggleFullscreen(); break;
        case 'edit-colors':     openEditColors(1); break;
        case 'new':             newCanvas(); break;
        case 'open':            openFile(); break;
        case 'save':            saveFile(); break;
        case 'save-png':        downloadCanvas('png'); break;
        case 'save-jpeg':       downloadCanvas('jpeg'); break;
        case 'save-bmp':        downloadCanvas('bmp'); break;
        case 'save-gif':        downloadCanvas('gif'); break;
        case 'properties':      openPropertiesDialog(); break;
        case 'about':           showAbout(); break;
        case 'exit':            window.close(); break;
    }
}

// ── Tool management ──────────────────────────────────────────
function setTool(tool) {
    commitSelection();
    const prev = state.tool;
    state.tool = tool;
    syncToolUI();

    // Switch text toolbar visibility
    const textBar = document.getElementById('text-toolbar');
    textBar.style.display = tool === 'text' ? 'flex' : 'none';

    // Update cursor
    updateCursor();
}

function syncToolUI() {
    document.querySelectorAll('[data-tool]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tool === state.tool);
    });
}

function updateCursor() {
    const cursors = {
        pencil:     'crosshair',
        brush:      'crosshair',
        fill:       'cell',
        text:       'text',
        eraser:     'cell',
        colorpick:  'crosshair',
        zoom:       'zoom-in',
        'select-rect': 'crosshair',
        'select-free': 'crosshair',
        shape:      'crosshair',
    };
    canvas.style.cursor = cursors[state.tool] || 'crosshair';
}

// ── Canvas mouse events ──────────────────────────────────────
function bindCanvas() {
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseup',   onMouseUp);
    canvas.addEventListener('mouseleave', onMouseLeave);
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('dblclick',  onDblClick);
    canvas.addEventListener('wheel',     onWheel, { passive: false });
}

function onMouseDown(e) {
    const { x, y } = canvasXY(e);
    const isRight = e.button === 2;

    if (state.tool === 'zoom') {
        if (isRight) zoomBy(0.5, x, y);
        else         zoomBy(2,   x, y);
        return;
    }
    if (state.tool === 'colorpick') {
        pickColor(x, y, isRight);
        return;
    }
    if (state.tool === 'fill') {
        pushUndo();
        floodFill(x, y, isRight ? state.color2 : state.color1);
        return;
    }
    if (state.tool === 'text') {
        placeText(x, y);
        return;
    }
    if (state.tool === 'select-rect') {
        if (state.selection && pointInSelection(x, y)) {
            startMoveSelection(x, y);
        } else {
            commitSelection();
            startRectSelect(x, y, e);
        }
        return;
    }

    state.drawing = true;
    state.startX = x;
    state.startY = y;
    state.lastX  = x;
    state.lastY  = y;

    if (state.tool === 'eraser' || state.tool === 'pencil' || state.tool === 'brush') {
        pushUndo();
        drawPoint(x, y, isRight);
    }
    if (state.tool === 'shape') {
        pushUndo();
    }
}

function onMouseMove(e) {
    const { x, y } = canvasXY(e);
    updateStatusCoords(x, y);

    if (state.tool === 'select-rect' && state.selMoving) {
        moveSelection(x, y);
        return;
    }
    if (!state.drawing) return;
    const isRight = e.buttons === 2;

    switch (state.tool) {
        case 'pencil':   drawLine(state.lastX, state.lastY, x, y, isRight); break;
        case 'brush':    drawBrushLine(state.lastX, state.lastY, x, y, isRight); break;
        case 'eraser':   eraseAt(x, y); break;
        case 'select-rect': updateRectSelect(x, y); break;
        case 'shape':    drawShapePreview(state.startX, state.startY, x, y); break;
    }

    state.lastX = x;
    state.lastY = y;
}

function onMouseUp(e) {
    const { x, y } = canvasXY(e);
    if (state.selMoving) {
        state.selMoving = false;
        return;
    }
    if (!state.drawing) return;
    state.drawing = false;

    switch (state.tool) {
        case 'select-rect': finaliseRectSelect(x, y); break;
        case 'shape':       commitShape(state.startX, state.startY, x, y, e.button === 2); break;
    }
}

function onMouseLeave() {
    updateStatusCoords(null, null);
}

function onDblClick(e) {
    if (state.tool === 'zoom') {
        setZoom(1);
    }
}

function onWheel(e) {
    if (e.ctrlKey) {
        e.preventDefault();
        zoomBy(e.deltaY < 0 ? 1.25 : 0.8);
    }
}

// ── Drawing primitives ───────────────────────────────────────
function ctxColor(isRight) {
    return isRight ? state.color2 : state.color1;
}

function drawPoint(x, y, isRight) {
    ctx.beginPath();
    ctx.arc(x, y, state.lineWidth / 2, 0, Math.PI * 2);
    ctx.fillStyle = ctxColor(isRight);
    ctx.fill();
}

function drawLine(x0, y0, x1, y1, isRight) {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.strokeStyle = ctxColor(isRight);
    ctx.lineWidth   = state.lineWidth;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.stroke();
}

function drawBrushLine(x0, y0, x1, y1, isRight) {
    const color = ctxColor(isRight);
    const w     = state.lineWidth * 2;

    ctx.save();
    switch (state.brush) {
        case 'round':
            ctx.beginPath();
            ctx.moveTo(x0, y0);
            ctx.lineTo(x1, y1);
            ctx.strokeStyle = color;
            ctx.lineWidth   = w;
            ctx.lineCap     = 'round';
            ctx.lineJoin    = 'round';
            ctx.stroke();
            break;
        case 'cali1':
            ctx.fillStyle = color;
            for (let t = 0; t <= 1; t += 0.05) {
                const x = x0 + (x1 - x0) * t;
                const y = y0 + (y1 - y0) * t;
                ctx.fillRect(x - w, y, w * 2, w / 3);
            }
            break;
        case 'cali2':
            ctx.fillStyle = color;
            for (let t = 0; t <= 1; t += 0.05) {
                const x = x0 + (x1 - x0) * t;
                const y = y0 + (y1 - y0) * t;
                ctx.fillRect(x, y - w, w / 3, w * 2);
            }
            break;
        case 'airbrush':
            for (let i = 0; i < 20; i++) {
                const r   = Math.random() * w * 3;
                const ang = Math.random() * Math.PI * 2;
                const px  = x1 + r * Math.cos(ang);
                const py  = y1 + r * Math.sin(ang);
                ctx.beginPath();
                ctx.arc(px, py, 0.5, 0, Math.PI * 2);
                ctx.fillStyle = color;
                ctx.fill();
            }
            break;
        default:
            ctx.beginPath();
            ctx.moveTo(x0, y0);
            ctx.lineTo(x1, y1);
            ctx.strokeStyle = color;
            ctx.lineWidth   = w;
            ctx.lineCap     = 'round';
            ctx.stroke();
    }
    ctx.restore();
}

function eraseAt(x, y) {
    const size = state.lineWidth * 4;
    ctx.clearRect(x - size / 2, y - size / 2, size, size);
    ctx.fillStyle = state.color2;
    ctx.fillRect(x - size / 2, y - size / 2, size, size);
}

// ── Shape preview on overlay ─────────────────────────────────
function drawShapePreview(x0, y0, x1, y1) {
    octx.clearRect(0, 0, overlay.width, overlay.height);
    octx.strokeStyle = state.color1;
    octx.fillStyle   = state.fill !== 'none' ? state.color2 : 'transparent';
    octx.lineWidth   = state.lineWidth;
    octx.lineCap     = 'round';
    drawShapePath(octx, state.shape, x0, y0, x1, y1);
    if (state.outline !== 'none') {
        octx.stroke();
    }
    if (state.fill !== 'none') {
        octx.fill();
    }
}

function commitShape(x0, y0, x1, y1, isRight) {
    octx.clearRect(0, 0, overlay.width, overlay.height);
    ctx.strokeStyle = isRight ? state.color2 : state.color1;
    ctx.fillStyle   = isRight ? state.color1 : state.color2;
    ctx.lineWidth   = state.lineWidth;
    ctx.lineCap     = 'round';
    drawShapePath(ctx, state.shape, x0, y0, x1, y1);
    if (state.outline !== 'none') ctx.stroke();
    if (state.fill    !== 'none') ctx.fill();
}

function drawShapePath(c, shape, x0, y0, x1, y1) {
    const w  = x1 - x0;
    const h  = y1 - y0;
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;

    c.beginPath();
    switch (shape) {
        case 'line':
            c.moveTo(x0, y0);
            c.lineTo(x1, y1);
            break;
        case 'curve':
            c.moveTo(x0, y0);
            c.quadraticCurveTo(cx, y0 - Math.abs(h) * 0.5, x1, y1);
            break;
        case 'rect':
            c.rect(Math.min(x0,x1), Math.min(y0,y1), Math.abs(w), Math.abs(h));
            break;
        case 'rrect':
            { const r = Math.min(Math.abs(w), Math.abs(h)) * 0.15;
              const lx = Math.min(x0,x1), ty = Math.min(y0,y1);
              c.roundRect(lx, ty, Math.abs(w), Math.abs(h), r); }
            break;
        case 'oval':
            c.ellipse(cx, cy, Math.abs(w)/2, Math.abs(h)/2, 0, 0, Math.PI*2);
            break;
        case 'triangle':
            c.moveTo(cx, y0);
            c.lineTo(x1, y1);
            c.lineTo(x0, y1);
            c.closePath();
            break;
        case 'rtriangle':
            c.moveTo(x0, y0);
            c.lineTo(x1, y1);
            c.lineTo(x0, y1);
            c.closePath();
            break;
        case 'diamond':
            c.moveTo(cx, y0);
            c.lineTo(x1, cy);
            c.lineTo(cx, y1);
            c.lineTo(x0, cy);
            c.closePath();
            break;
        case 'pentagon':
            regularPolygon(c, cx, cy, Math.min(Math.abs(w), Math.abs(h))/2, 5, -Math.PI/2);
            break;
        case 'hexagon':
            regularPolygon(c, cx, cy, Math.min(Math.abs(w), Math.abs(h))/2, 6, 0);
            break;
        case 'polygon':
            regularPolygon(c, cx, cy, Math.min(Math.abs(w), Math.abs(h))/2, 8, -Math.PI/8);
            break;
        case 'arrow-r': arrowShape(c, x0, y0, x1, y1, 'r'); break;
        case 'arrow-l': arrowShape(c, x0, y0, x1, y1, 'l'); break;
        case 'arrow-u': arrowShape(c, x0, y0, x1, y1, 'u'); break;
        case 'arrow-d': arrowShape(c, x0, y0, x1, y1, 'd'); break;
        case 'star4':   starShape(c, cx, cy, Math.min(Math.abs(w),Math.abs(h))/2, 4); break;
        case 'star5':   starShape(c, cx, cy, Math.min(Math.abs(w),Math.abs(h))/2, 5); break;
        case 'star6':   starShape(c, cx, cy, Math.min(Math.abs(w),Math.abs(h))/2, 6); break;
        case 'callout-rect':
            c.rect(Math.min(x0,x1), Math.min(y0,y1), Math.abs(w), Math.abs(h));
            break;
        case 'callout-oval':
            c.ellipse(cx, cy, Math.abs(w)/2, Math.abs(h)/2, 0, 0, Math.PI*2);
            break;
        case 'callout-cloud': // simplified
            c.ellipse(cx, cy, Math.abs(w)/2, Math.abs(h)/2, 0, 0, Math.PI*2);
            break;
        default:
            c.rect(Math.min(x0,x1), Math.min(y0,y1), Math.abs(w), Math.abs(h));
    }
}

function regularPolygon(c, cx, cy, r, n, startAngle = 0) {
    c.moveTo(cx + r * Math.cos(startAngle), cy + r * Math.sin(startAngle));
    for (let i = 1; i <= n; i++) {
        const a = startAngle + (i * 2 * Math.PI / n);
        c.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
    }
    c.closePath();
}

function arrowShape(c, x0, y0, x1, y1, dir) {
    const w = x1 - x0, h = y1 - y0;
    const aw = Math.abs(dir === 'r' || dir === 'l' ? w : h);
    const ah = Math.abs(dir === 'r' || dir === 'l' ? h : w);
    const hw = ah * 0.35;          // half shaft width
    const headLen = aw * 0.4;      // arrowhead length
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    c.save();
    c.translate(mx, my);
    const rot = { r: 0, l: Math.PI, u: -Math.PI/2, d: Math.PI/2 }[dir];
    c.rotate(rot);
    const len = aw / 2;
    c.moveTo(-len, -hw);
    c.lineTo( len - headLen, -hw);
    c.lineTo( len - headLen, -ah / 2);
    c.lineTo( len,  0);
    c.lineTo( len - headLen,  ah / 2);
    c.lineTo( len - headLen,  hw);
    c.lineTo(-len,  hw);
    c.closePath();
    c.restore();
}

function starShape(c, cx, cy, outerR, points) {
    const innerR = outerR * 0.4;
    const step   = Math.PI / points;
    c.moveTo(cx, cy - outerR);
    for (let i = 0; i < points * 2; i++) {
        const r = i % 2 === 0 ? outerR : innerR;
        const a = i * step - Math.PI / 2;
        c.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
    }
    c.closePath();
}

// ── Flood fill (scanline BFS) ────────────────────────────────
function floodFill(startX, startY, fillColor) {
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data    = imgData.data;
    const w       = canvas.width, h = canvas.height;

    function idx(x, y) { return (y * w + x) * 4; }

    const si    = idx(startX, startY);
    const tr    = data[si], tg = data[si+1], tb = data[si+2], ta = data[si+3];
    const fc    = hexToRgb(fillColor);
    if (!fc) return;

    if (tr === fc.r && tg === fc.g && tb === fc.b && ta === 255) return;

    function sameColor(i) {
        return Math.abs(data[i]-tr)<16 && Math.abs(data[i+1]-tg)<16 &&
               Math.abs(data[i+2]-tb)<16 && Math.abs(data[i+3]-ta)<16;
    }

    const queue = [[startX, startY]];
    const vis   = new Uint8Array(w * h);
    vis[startY * w + startX] = 1;

    while (queue.length) {
        const [x, y] = queue.shift();
        const i = idx(x, y);
        data[i]   = fc.r;
        data[i+1] = fc.g;
        data[i+2] = fc.b;
        data[i+3] = 255;

        const neighbors = [[x+1,y],[x-1,y],[x,y+1],[x,y-1]];
        for (const [nx, ny] of neighbors) {
            if (nx >= 0 && nx < w && ny >= 0 && ny < h && !vis[ny*w+nx]) {
                vis[ny*w+nx] = 1;
                if (sameColor(idx(nx,ny))) queue.push([nx,ny]);
            }
        }
    }
    ctx.putImageData(imgData, 0, 0);
}

function hexToRgb(hex) {
    const m = hex.replace('#','').match(/.{2}/g);
    if (!m) return null;
    return { r: parseInt(m[0],16), g: parseInt(m[1],16), b: parseInt(m[2],16) };
}

// ── Color picker tool ────────────────────────────────────────
function pickColor(x, y, isRight) {
    const p = ctx.getImageData(x, y, 1, 1).data;
    const color = '#' + [p[0],p[1],p[2]].map(v => v.toString(16).padStart(2,'0')).join('');
    if (isRight) state.color2 = color;
    else         state.color1 = color;
    updateSwatches();
}

// ── Color picker dialog ──────────────────────────────────────
function openColorPicker(slot) {
    openEditColors(slot);
}

function swapColors() {
    [state.color1, state.color2] = [state.color2, state.color1];
    updateSwatches();
}

// ── Rectangle selection ──────────────────────────────────────
function startRectSelect(x, y, e) {
    state.drawing = true;
    state.startX  = x;
    state.startY  = y;
    state.selection = null;
}

function updateRectSelect(x, y) {
    if (!state.drawing) return;
    octx.clearRect(0, 0, overlay.width, overlay.height);
    const rx = Math.min(state.startX, x);
    const ry = Math.min(state.startY, y);
    const rw = Math.abs(x - state.startX);
    const rh = Math.abs(y - state.startY);

    // Selection rectangle
    octx.strokeStyle = '#000';
    octx.lineWidth   = 1;
    octx.setLineDash([4, 4]);
    octx.strokeRect(rx + 0.5, ry + 0.5, rw, rh);
    octx.setLineDash([]);
}

function finaliseRectSelect(x, y) {
    state.drawing = false;
    octx.clearRect(0, 0, overlay.width, overlay.height);
    const rx = Math.min(state.startX, x);
    const ry = Math.min(state.startY, y);
    const rw = Math.abs(x - state.startX);
    const rh = Math.abs(y - state.startY);
    if (rw > 2 && rh > 2) {
        state.selection = { x: rx, y: ry, w: rw, h: rh };
        drawSelectionRect();
    }
}

function drawSelectionRect() {
    if (!state.selection) return;
    const { x, y, w, h } = state.selection;
    octx.clearRect(0, 0, overlay.width, overlay.height);
    octx.strokeStyle = '#000';
    octx.lineWidth   = 1;
    octx.setLineDash([4, 4]);
    octx.strokeRect(x + 0.5, y + 0.5, w, h);
    octx.setLineDash([]);
}

function pointInSelection(x, y) {
    if (!state.selection) return false;
    const { x: sx, y: sy, w, h } = state.selection;
    return x >= sx && x <= sx+w && y >= sy && y <= sy+h;
}

function startMoveSelection(x, y) {
    if (!state.selection) return;
    state.selMoving = true;
    state.startX = x - state.selection.x;
    state.startY = y - state.selection.y;
    // Grab pixels
    state.selCanvas = document.createElement('canvas');
    state.selCanvas.width  = state.selection.w;
    state.selCanvas.height = state.selection.h;
    state.selCanvas.getContext('2d').drawImage(
        canvas,
        state.selection.x, state.selection.y,
        state.selection.w, state.selection.h,
        0, 0,
        state.selection.w, state.selection.h
    );
    // Clear original area
    ctx.fillStyle = state.color2;
    ctx.fillRect(state.selection.x, state.selection.y, state.selection.w, state.selection.h);
}

function moveSelection(x, y) {
    if (!state.selMoving || !state.selCanvas) return;
    const nx = x - state.startX;
    const ny = y - state.startY;
    state.selection.x = nx;
    state.selection.y = ny;
    octx.clearRect(0, 0, overlay.width, overlay.height);
    octx.drawImage(state.selCanvas, nx, ny);
    drawSelectionRect();
}

function commitSelection() {
    if (state.selCanvas && state.selection) {
        ctx.drawImage(state.selCanvas, state.selection.x, state.selection.y);
        state.selCanvas = null;
    }
    state.selection = null;
    octx.clearRect(0, 0, overlay.width, overlay.height);
}

function selectAll() {
    state.selection = { x: 0, y: 0, w: canvas.width, h: canvas.height };
    drawSelectionRect();
}

function invertSelection() {
    // Basic implementation: select the whole canvas and mark the inverse
    // For simplicity, we keep the current selection
}

function deleteSelection() {
    if (!state.selection) return;
    pushUndo();
    ctx.fillStyle = state.color2;
    ctx.fillRect(state.selection.x, state.selection.y, state.selection.w, state.selection.h);
    commitSelection();
}

function toggleTransparentSelect() {
    state.transparentSelect = !state.transparentSelect;
    const el = document.getElementById('dd-transparent-select');
    el.classList.toggle('checked', state.transparentSelect);
}

// ── Clipboard operations ─────────────────────────────────────
function cutSelection() {
    if (!state.selection) return;
    pushUndo();
    copySelection();
    deleteSelection();
}

function copySelection() {
    if (!state.selection) return;
    const { x, y, w, h } = state.selection;
    const tmp = document.createElement('canvas');
    tmp.width = w; tmp.height = h;
    tmp.getContext('2d').drawImage(canvas, x, y, w, h, 0, 0, w, h);
    tmp.toBlob(blob => {
        try {
            navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        } catch(e) {}
    });
}

async function pasteClipboard() {
    try {
        const items = await navigator.clipboard.read();
        for (const item of items) {
            if (item.types.includes('image/png')) {
                const blob = await item.getType('image/png');
                const url  = URL.createObjectURL(blob);
                const img  = new Image();
                img.onload = () => {
                    pushUndo();
                    ctx.drawImage(img, 0, 0);
                    URL.revokeObjectURL(url);
                };
                img.src = url;
                return;
            }
        }
    } catch(e) {}
}

function pasteFromFile() {
    const input = document.createElement('input');
    input.type  = 'file';
    input.accept = 'image/*';
    input.onchange = e => {
        const file = e.target.files[0];
        if (!file) return;
        const url  = URL.createObjectURL(file);
        const img  = new Image();
        img.onload = () => {
            pushUndo();
            ctx.drawImage(img, 0, 0);
            URL.revokeObjectURL(url);
        };
        img.src = url;
    };
    input.click();
}

// ── Crop ────────────────────────────────────────────────────
function cropToSelection() {
    if (!state.selection) return;
    const { x, y, w, h } = state.selection;
    const tmp = document.createElement('canvas');
    tmp.width = w; tmp.height = h;
    tmp.getContext('2d').drawImage(canvas, x, y, w, h, 0, 0, w, h);
    pushUndo();
    resizeCanvasTo(w, h);
    ctx.drawImage(tmp, 0, 0);
    commitSelection();
}

// ── Rotate / Flip ────────────────────────────────────────────
function rotateCanvas(degrees) {
    pushUndo();
    const tmp = document.createElement('canvas');
    const rad = degrees * Math.PI / 180;
    if (degrees === 90 || degrees === -90) {
        tmp.width  = canvas.height;
        tmp.height = canvas.width;
    } else {
        tmp.width  = canvas.width;
        tmp.height = canvas.height;
    }
    const tc = tmp.getContext('2d');
    tc.translate(tmp.width / 2, tmp.height / 2);
    tc.rotate(rad);
    tc.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);

    resizeCanvasTo(tmp.width, tmp.height);
    ctx.drawImage(tmp, 0, 0);
}

function flipCanvas(dir) {
    pushUndo();
    const tmp = document.createElement('canvas');
    tmp.width  = canvas.width;
    tmp.height = canvas.height;
    const tc   = tmp.getContext('2d');
    if (dir === 'h') {
        tc.translate(canvas.width, 0);
        tc.scale(-1, 1);
    } else {
        tc.translate(0, canvas.height);
        tc.scale(1, -1);
    }
    tc.drawImage(canvas, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(tmp, 0, 0);
}

// ── Resize canvas ────────────────────────────────────────────
function resizeCanvasTo(w, h) {
    const tmp = document.createElement('canvas');
    tmp.width  = canvas.width;
    tmp.height = canvas.height;
    tmp.getContext('2d').drawImage(canvas, 0, 0);

    canvas.width  = w;
    canvas.height = h;
    overlay.width = w;
    overlay.height = w;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(tmp, 0, 0);

    state.canvasW = w;
    state.canvasH = h;
    applyZoom();
    drawRulers();
    updateStatusImgSize();
}

// ── Zoom ─────────────────────────────────────────────────────
const ZOOM_LEVELS = [0.01,0.0625,0.125,0.25,0.5,0.75,1,1.25,1.5,2,3,4,6,8];

function zoomBy(factor, cx, cy) {
    const newZoom = Math.max(0.01, Math.min(8, state.zoom * factor));
    setZoom(newZoom);
}

function setZoom(z) {
    state.zoom = Math.max(0.01, Math.min(8, z));
    applyZoom();
    updateZoomSlider();
    document.getElementById('zoom-pct').textContent = Math.round(state.zoom * 100) + '%';
    drawRulers();
}

function applyZoom() {
    canvas.style.width   = (state.canvasW * state.zoom) + 'px';
    canvas.style.height  = (state.canvasH * state.zoom) + 'px';
    overlay.style.width  = canvas.style.width;
    overlay.style.height = canvas.style.height;
}

function updateZoomSlider() {
    const slider = document.getElementById('zoom-slider');
    slider.value = Math.round(state.zoom * 100);
    const pct    = ((state.zoom * 100 - 1) / (800 - 1)) * 100;
    slider.style.setProperty('--zoom-pct', pct + '%');
    document.getElementById('zoom-pct').textContent = Math.round(state.zoom * 100) + '%';
}

function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen();
    } else {
        document.exitFullscreen();
    }
}

// ── View toggles ─────────────────────────────────────────────
function toggleRulers(show) {
    state.showRulers = show;
    document.getElementById('ruler-h').classList.toggle('hidden', !show);
    document.getElementById('ruler-v').classList.toggle('hidden', !show);
    document.querySelector('.paint-ruler-corner').classList.toggle('hidden', !show);
}

function toggleGrid(show) {
    state.showGrid = show;
    canvasBg.classList.toggle('show-grid', show);
    const gridPx = Math.max(1, Math.round(8 / state.zoom));
    canvasBg.style.setProperty('--grid-size', (8 * state.zoom) + 'px');
}

function toggleStatusBar(show) {
    state.showStatus = show;
    document.getElementById('paint-statusbar').style.display = show ? 'flex' : 'none';
}

// ── Rulers ───────────────────────────────────────────────────
function drawRulers() {
    drawHRuler();
    drawVRuler();
}

function drawHRuler() {
    const rulerEl = document.getElementById('ruler-h');
    const c       = document.getElementById('ruler-h-canvas');
    const w       = rulerEl.clientWidth || 600;
    c.width       = w;
    const rc      = c.getContext('2d');
    rc.clearRect(0, 0, w, 16);
    rc.fillStyle  = '#efefef';
    rc.fillRect(0, 0, w, 16);

    const step  = state.zoom >= 4 ? 1 : state.zoom >= 2 ? 5 : state.zoom >= 1 ? 10 : 50;
    const pxStep = step * state.zoom;
    rc.fillStyle   = '#555';
    rc.font        = '8px Segoe UI';
    rc.textBaseline = 'top';

    for (let x = 0; x * pxStep <= w; x++) {
        const px = x * pxStep;
        const label = x * step;
        const isMain = label % (step * 5) === 0;
        const tickH  = isMain ? 8 : 4;
        rc.fillStyle = '#999';
        rc.fillRect(px, 16 - tickH, 1, tickH);
        if (isMain && label > 0) {
            rc.fillStyle = '#555';
            rc.fillText(label, px + 2, 0);
        }
    }
}

function drawVRuler() {
    const rulerEl = document.getElementById('ruler-v');
    const c       = document.getElementById('ruler-v-canvas');
    const h       = rulerEl.clientHeight || 400;
    c.height      = h;
    const rc      = c.getContext('2d');
    rc.clearRect(0, 0, 16, h);
    rc.fillStyle  = '#efefef';
    rc.fillRect(0, 0, 16, h);

    const step  = state.zoom >= 4 ? 1 : state.zoom >= 2 ? 5 : state.zoom >= 1 ? 10 : 50;
    const pxStep = step * state.zoom;
    rc.fillStyle   = '#555';
    rc.font        = '8px Segoe UI';
    rc.textBaseline = 'middle';

    for (let y = 0; y * pxStep <= h; y++) {
        const py = y * pxStep;
        const label = y * step;
        const isMain = label % (step * 5) === 0;
        const tickW  = isMain ? 8 : 4;
        rc.fillStyle = '#999';
        rc.fillRect(16 - tickW, py, tickW, 1);
        if (isMain && label > 0) {
            rc.save();
            rc.fillStyle = '#555';
            rc.translate(8, py);
            rc.rotate(-Math.PI / 2);
            rc.fillText(label, -12, 0);
            rc.restore();
        }
    }
}

// ── Status bar ───────────────────────────────────────────────
function updateStatusCoords(x, y) {
    const el = document.getElementById('sb-coords');
    el.textContent = (x !== null) ? `${x}, ${y}px` : '';
}

function updateStatusImgSize() {
    document.getElementById('sb-imgsize').textContent =
        `${state.canvasW} × ${state.canvasH}px`;
}

// ── Text tool ────────────────────────────────────────────────
function placeText(x, y) {
    if (state.textInput) commitText();
    state.textX = x;
    state.textY = y;

    const ta = document.createElement('textarea');
    ta.style.cssText = `
        position: absolute;
        left: ${(x * state.zoom + canvasBg.offsetLeft)}px;
        top:  ${(y * state.zoom + canvasBg.offsetTop)}px;
        min-width: 80px; min-height: 24px;
        background: transparent;
        border: 1px dashed #777;
        outline: none;
        resize: both;
        overflow: hidden;
        font-family: ${document.getElementById('text-font').value};
        font-size: ${document.getElementById('text-size').value}px;
        color: ${state.color1};
        z-index: 20;
        padding: 2px;
    `;
    document.querySelector('.paint-work-area').appendChild(ta);
    ta.focus();
    state.textInput = ta;

    ta.addEventListener('keydown', e => {
        if (e.key === 'Escape') { ta.remove(); state.textInput = null; }
    });
}

function commitText() {
    if (!state.textInput) return;
    const ta   = state.textInput;
    const font = document.getElementById('text-font').value;
    const size = parseInt(document.getElementById('text-size').value);
    const fmts = [];
    document.querySelectorAll('.paint-text-fmt-btn.active').forEach(b => fmts.push(b.dataset.fmt));

    ctx.save();
    let fontStr = '';
    if (fmts.includes('bold'))   fontStr += 'bold ';
    if (fmts.includes('italic')) fontStr += 'italic ';
    fontStr += `${size}px "${font}"`;
    ctx.font      = fontStr;
    ctx.fillStyle = state.color1;

    const lines = ta.value.split('\n');
    lines.forEach((line, i) => {
        ctx.fillText(line, state.textX, state.textY + size + i * (size * 1.2));
    });
    ctx.restore();

    ta.remove();
    state.textInput = null;
    state.modified  = true;
}

document.querySelectorAll('.paint-text-fmt-btn').forEach(btn => {
    btn.addEventListener('click', () => btn.classList.toggle('active'));
});

// ── Application menu ─────────────────────────────────────────
function bindAppMenu() {
    const btn  = document.getElementById('paint-appbtn');
    const menu = document.getElementById('paint-appmenu');

    btn.addEventListener('click', e => {
        e.stopPropagation();
        const open = menu.classList.toggle('open');
        btn.classList.toggle('open', open);
    });

    document.addEventListener('click', () => {
        menu.classList.remove('open');
        document.getElementById('paint-appbtn').classList.remove('open');
    });

    menu.addEventListener('click', e => e.stopPropagation());

    document.querySelectorAll('.paint-appmenu-item[data-action]').forEach(item => {
        item.addEventListener('click', () => {
            const action = item.dataset.action;
            menu.classList.remove('open');
            document.getElementById('paint-appbtn').classList.remove('open');
            handleAction(action);
        });
    });

    document.querySelectorAll('.paint-appmenu-sub-item[data-action]').forEach(item => {
        item.addEventListener('click', e => {
            e.stopPropagation();
            const action = item.dataset.action;
            menu.classList.remove('open');
            document.getElementById('paint-appbtn').classList.remove('open');
            handleAction(action);
        });
    });
}

// ── File operations ──────────────────────────────────────────
function newCanvas(w = 640, h = 480) {
    if (state.modified) {
        const sd = (window.parent && window.parent.systemDialog) ? window.parent.systemDialog : null;
        if (sd) {
            sd.show({
                title: state.filename + ' - Paint',
                body: 'Do you want to save changes to ' + state.filename + '?',
                status: 'question',
                buttons: 'savedontsavecancel'
            }).then(val => {
                if (val === 'cancel') return;
                if (val === 'save') saveFile();
                _doNewCanvas(w, h);
            });
            return;
        }
        if (!confirm('Save changes to ' + state.filename + '?')) return;
    }
    _doNewCanvas(w, h);
}
function _doNewCanvas(w, h) {
    pushUndo();
    resizeCanvasTo(w, h);
    fillWhite();
    state.modified = false;
    state.filename = 'Untitled';
    updateTitle();
}

function openFile() {
    const input = document.createElement('input');
    input.type  = 'file';
    input.accept = 'image/*';
    input.onchange = e => {
        const file = e.target.files[0];
        if (!file) return;
        state.filename = file.name.replace(/\.[^.]+$/, '');
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            resizeCanvasTo(img.width, img.height);
            ctx.drawImage(img, 0, 0);
            URL.revokeObjectURL(url);
            state.modified = false;
            updateTitle();
        };
        img.src = url;
    };
    input.click();
}

function saveFile() {
    downloadCanvas('png');
    state.modified = false;
    updateTitle();
}

function downloadCanvas(format) {
    const mimeMap = { png: 'image/png', jpeg: 'image/jpeg', bmp: 'image/bmp', gif: 'image/gif' };
    const mime    = mimeMap[format] || 'image/png';
    const ext     = format === 'jpeg' ? 'jpg' : format;
    const link    = document.createElement('a');
    link.href     = canvas.toDataURL(mime);
    link.download = (state.filename || 'Untitled') + '.' + ext;
    link.click();
}

function updateTitle() {
    const mark = state.modified ? '*' : '';
    document.title = `${mark}${state.filename} - Paint`;
}

// ── Dialogs ──────────────────────────────────────────────────
function bindDialogs() {
    // Resize dialog
    document.getElementById('dlg-resize-ok').addEventListener('click', applyResize);
    document.getElementById('dlg-resize-cancel').addEventListener('click', closeDlgResize);
    document.getElementById('dlg-resize-close').addEventListener('click',  closeDlgResize);
    document.getElementById('dlg-resize').addEventListener('click', e => {
        if (e.target === e.currentTarget) closeDlgResize();
    });

    const byRadios = document.querySelectorAll('[name="resize-by"]');
    byRadios.forEach(r => r.addEventListener('change', () => {
        const isPct = r.value === 'percentage';
        document.getElementById('resize-unit').textContent   = isPct ? '%' : 'px';
        document.getElementById('resize-unit-v').textContent = isPct ? '%' : 'px';
        document.getElementById('resize-h').value = isPct ? 100 : state.canvasW;
        document.getElementById('resize-v').value = isPct ? 100 : state.canvasH;
    }));

    // Maintain AR linkage
    let lastHVal = 100;
    document.getElementById('resize-h').addEventListener('input', function() {
        if (document.getElementById('resize-maintain-ar').checked) {
            const ratio = parseInt(this.value) / lastHVal;
            const vEl   = document.getElementById('resize-v');
            vEl.value   = Math.round(parseInt(vEl.value) * ratio);
        }
        lastHVal = parseInt(this.value) || lastHVal;
    });

    // Properties dialog
    document.getElementById('dlg-properties-ok').addEventListener('click', applyProperties);
    document.getElementById('dlg-properties-cancel').addEventListener('click', closeDlgProperties);
    document.getElementById('dlg-properties-close').addEventListener('click',  closeDlgProperties);
    document.getElementById('dlg-properties').addEventListener('click', e => {
        if (e.target === e.currentTarget) closeDlgProperties();
    });

    // Edit Colors dialog
    document.getElementById('dlg-ec-ok').addEventListener('click', () => {
        const hex = document.getElementById('ec-hex').value.replace(/^#/, '');
        const col = '#' + hex.padStart(6, '0');
        if (editColorsTarget === 2) setColor2(col); else setColor1(col);
        closeDlgEditColors();
    });
    document.getElementById('dlg-ec-cancel').addEventListener('click', closeDlgEditColors);
    document.getElementById('dlg-ec-close').addEventListener('click',  closeDlgEditColors);
    document.getElementById('dlg-edit-colors').addEventListener('click', e => {
        if (e.target === e.currentTarget) closeDlgEditColors();
    });
    bindEditColors();
}

function closeDlgResize()      { document.getElementById('dlg-resize').style.display = 'none'; }
function closeDlgProperties()  { document.getElementById('dlg-properties').style.display = 'none'; }
function closeDlgEditColors()  { document.getElementById('dlg-edit-colors').style.display = 'none'; }

// ── Edit Colors ──────────────────────────────────────────────
let editColorsTarget = 1; // 1=color1, 2=color2
let ecHue = 0, ecSat = 100, ecLum = 50; // working HSL

function openEditColors(target = 1) {
    editColorsTarget = target;
    const cur = target === 2 ? state.color2 : state.color1;
    document.getElementById('ec-preview-cur').style.background = cur;
    document.getElementById('ec-preview-new').style.background = cur;
    const { h, s, l } = hexToHsl(cur);
    ecHue = h; ecSat = s; ecLum = l;
    syncEcFromHsl();
    drawEcSpectrum();
    document.getElementById('dlg-edit-colors').style.display = 'flex';
}

function bindEditColors() {
    const spectrum = document.getElementById('ec-spectrum');
    const hueSlider = document.getElementById('ec-hue-slider');

    // Build palette in EC dialog
    const ecPal = document.getElementById('ec-palette');
    DEFAULT_PALETTE.forEach(c => {
        const sw = document.createElement('div');
        sw.className = 'paint-ec-swatch';
        sw.style.background = c;
        sw.title = c;
        sw.addEventListener('click', () => {
            const { h, s, l } = hexToHsl(c);
            ecHue = h; ecSat = s; ecLum = l;
            syncEcFromHsl();
            drawEcSpectrum();
        });
        ecPal.appendChild(sw);
    });

    // Spectrum click/drag
    let dragging = false;
    function pickFromSpectrum(e) {
        const rect = spectrum.getBoundingClientRect();
        const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const y = Math.max(0, Math.min(1, (e.clientY - rect.top)  / rect.height));
        ecSat = Math.round(x * 100);
        ecLum = Math.round((1 - y) * 100);
        syncEcFromHsl();
    }
    spectrum.addEventListener('mousedown', e => { dragging = true; pickFromSpectrum(e); });
    document.addEventListener('mousemove', e => { if (dragging) pickFromSpectrum(e); });
    document.addEventListener('mouseup',   () => { dragging = false; });

    // Hue slider
    hueSlider.addEventListener('input', () => {
        ecHue = parseInt(hueSlider.value);
        syncEcFromHsl();
        drawEcSpectrum();
    });

    // RGB / HSL numeric fields
    ['ec-red','ec-green','ec-blue'].forEach(id => {
        document.getElementById(id).addEventListener('change', syncEcFromRgb);
    });
    ['ec-hue','ec-sat','ec-lum'].forEach(id => {
        document.getElementById(id).addEventListener('change', syncEcFromHslFields);
    });
    document.getElementById('ec-hex').addEventListener('change', function() {
        const hex = this.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6).padStart(6, '0');
        this.value = hex;
        const { h, s, l } = hexToHsl('#' + hex);
        ecHue = h; ecSat = s; ecLum = l;
        syncEcFromHsl();
        drawEcSpectrum();
    });
}

function syncEcFromHsl() {
    const color = hslToHex(ecHue, ecSat, ecLum);
    const { r, g, b } = hexToRgb(color);
    document.getElementById('ec-hue-slider').value = ecHue;
    document.getElementById('ec-hue').value   = Math.round(ecHue);
    document.getElementById('ec-sat').value   = Math.round(ecSat);
    document.getElementById('ec-lum').value   = Math.round(ecLum);
    document.getElementById('ec-red').value   = r;
    document.getElementById('ec-green').value = g;
    document.getElementById('ec-blue').value  = b;
    document.getElementById('ec-hex').value   = color.slice(1);
    document.getElementById('ec-preview-new').style.background = color;
}

function syncEcFromRgb() {
    const r = parseInt(document.getElementById('ec-red').value)   || 0;
    const g = parseInt(document.getElementById('ec-green').value) || 0;
    const b = parseInt(document.getElementById('ec-blue').value)  || 0;
    const hex = rgbToHex(r, g, b);
    const { h, s, l } = hexToHsl(hex);
    ecHue = h; ecSat = s; ecLum = l;
    document.getElementById('ec-hue-slider').value = ecHue;
    document.getElementById('ec-hue').value = Math.round(ecHue);
    document.getElementById('ec-sat').value = Math.round(ecSat);
    document.getElementById('ec-lum').value = Math.round(ecLum);
    document.getElementById('ec-hex').value = hex.slice(1);
    document.getElementById('ec-preview-new').style.background = hex;
    drawEcSpectrum();
}

function syncEcFromHslFields() {
    ecHue = parseInt(document.getElementById('ec-hue').value) || 0;
    ecSat = parseInt(document.getElementById('ec-sat').value) || 0;
    ecLum = parseInt(document.getElementById('ec-lum').value) || 50;
    syncEcFromHsl();
    drawEcSpectrum();
}

function drawEcSpectrum() {
    const sc  = document.getElementById('ec-spectrum');
    const ctx2 = sc.getContext('2d');
    const W = sc.width, H = sc.height;

    // Base hue layer
    ctx2.fillStyle = `hsl(${ecHue}, 100%, 50%)`;
    ctx2.fillRect(0, 0, W, H);

    // White → transparent gradient (saturation axis, left=white)
    const gW = ctx2.createLinearGradient(0, 0, W, 0);
    gW.addColorStop(0, 'rgba(255,255,255,1)');
    gW.addColorStop(1, 'rgba(255,255,255,0)');
    ctx2.fillStyle = gW;
    ctx2.fillRect(0, 0, W, H);

    // Black → transparent gradient (lightness axis, bottom=black)
    const gB = ctx2.createLinearGradient(0, 0, 0, H);
    gB.addColorStop(0, 'rgba(0,0,0,0)');
    gB.addColorStop(1, 'rgba(0,0,0,1)');
    ctx2.fillStyle = gB;
    ctx2.fillRect(0, 0, W, H);

    // Crosshair at current sat/lum
    const cx = (ecSat / 100) * W;
    const cy = (1 - ecLum / 100) * H;
    ctx2.strokeStyle = '#fff';
    ctx2.lineWidth = 1.5;
    ctx2.beginPath();
    ctx2.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx2.stroke();
    ctx2.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx2.lineWidth = 1;
    ctx2.beginPath();
    ctx2.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx2.stroke();
}

// ── Color conversion helpers ──────────────────────────────────
function hexToRgb(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return { r, g, b };
}
function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}
function hexToHsl(hex) {
    let { r, g, b } = hexToRgb(hex);
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
            case g: h = ((b - r) / d + 2) / 6; break;
            case b: h = ((r - g) / d + 4) / 6; break;
        }
    }
    return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}
function hslToHex(h, s, l) {
    s /= 100; l /= 100;
    const a = s * Math.min(l, 1 - l);
    const f = n => {
        const k = (n + h / 30) % 12;
        const c = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
        return Math.round(255 * c).toString(16).padStart(2, '0');
    };
    return '#' + f(0) + f(8) + f(4);
}

function openResizeDialog() {
    document.getElementById('resize-h').value = 100;
    document.getElementById('resize-v').value = 100;
    document.querySelector('[name="resize-by"][value="percentage"]').checked = true;
    document.getElementById('resize-unit').textContent = '%';
    document.getElementById('dlg-resize').style.display = 'flex';
}

function applyResize() {
    const byPct = document.querySelector('[name="resize-by"]:checked').value === 'percentage';
    let   hw = parseInt(document.getElementById('resize-h').value);
    let   vv = parseInt(document.getElementById('resize-v').value);

    if (byPct) {
        hw = Math.round(state.canvasW * hw / 100);
        vv = Math.round(state.canvasH * vv / 100);
    }

    const sh = parseInt(document.getElementById('skew-h').value);
    const sv = parseInt(document.getElementById('skew-v').value);

    document.getElementById('dlg-resize').style.display = 'none';

    if (hw < 1 || vv < 1) return;
    pushUndo();

    if (sh !== 0 || sv !== 0) {
        applySkew(sh, sv);
    } else {
        const tmp = document.createElement('canvas');
        tmp.width = hw; tmp.height = vv;
        tmp.getContext('2d').drawImage(canvas, 0, 0, hw, vv);
        resizeCanvasTo(hw, vv);
        ctx.drawImage(tmp, 0, 0);
    }
}

function applySkew(sh, sv) {
    const tmp = document.createElement('canvas');
    tmp.width  = canvas.width;
    tmp.height = canvas.height;
    const tc   = tmp.getContext('2d');
    tc.transform(1, Math.tan(sv * Math.PI / 180), Math.tan(sh * Math.PI / 180), 1, 0, 0);
    tc.drawImage(canvas, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(tmp, 0, 0);
}

function openPropertiesDialog() {
    document.getElementById('prop-width').value  = state.canvasW;
    document.getElementById('prop-height').value = state.canvasH;
    document.getElementById('dlg-properties').style.display = 'flex';
}

function applyProperties() {
    const w = parseInt(document.getElementById('prop-width').value);
    const h = parseInt(document.getElementById('prop-height').value);
    document.getElementById('dlg-properties').style.display = 'none';
    if (w > 0 && h > 0) {
        pushUndo();
        resizeCanvasTo(w, h);
    }
}

function showAbout() {
    const sd = (window.parent && window.parent.systemDialog) ? window.parent.systemDialog : null;
    if (sd) {
        sd.show({
            title: 'About Paint',
            body: 'Paint\nVersion 6.3.9600.17031 (Windows 8.1)\n\n© 2013 Microsoft Corporation.\nAll rights reserved.',
            status: 'info',
            buttons: 'ok'
        });
    }
}

// ── Keyboard shortcuts ───────────────────────────────────────
function bindKeyboard() {
    document.addEventListener('keydown', e => {
        const ctrl = e.ctrlKey || e.metaKey;
        if (ctrl) {
            switch (e.key.toLowerCase()) {
                case 'z': e.preventDefault(); undo(); break;
                case 'y': e.preventDefault(); redo(); break;
                case 'n': e.preventDefault(); newCanvas(); break;
                case 'o': e.preventDefault(); openFile(); break;
                case 's': e.preventDefault(); saveFile(); break;
                case 'a': e.preventDefault(); selectAll(); break;
                case 'c': e.preventDefault(); copySelection(); break;
                case 'x': e.preventDefault(); cutSelection(); break;
                case 'v': e.preventDefault(); pasteClipboard(); break;
                case 'w': e.preventDefault(); openResizeDialog(); break;
                case 'e': e.preventDefault(); openPropertiesDialog(); break;
                case '+': case '=': e.preventDefault(); zoomBy(1.25); break;
                case '-': e.preventDefault(); zoomBy(0.8); break;
                case '/': e.preventDefault(); setZoom(1); break;
            }
        } else {
            switch (e.key) {
                case 'Delete':  deleteSelection(); break;
                case 'Escape':
                    commitSelection();
                    if (state.textInput) { state.textInput.remove(); state.textInput = null; }
                    break;
                case 'F11': e.preventDefault(); toggleFullscreen(); break;
            }
        }
    });
}

// ── Init ─────────────────────────────────────────────────────
window.addEventListener('load', init);
window.addEventListener('resize', drawRulers);
