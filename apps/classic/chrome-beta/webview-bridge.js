const { ipcRenderer } = require('electron');

function isTextInput(element) {
  if (!element || typeof element !== 'object' || typeof element.tagName !== 'string') {
    return false;
  }

  if (element.tagName === 'TEXTAREA') {
    return true;
  }

  if (element.tagName !== 'INPUT') {
    return false;
  }

  const type = String(element.type || 'text').toLowerCase();
  return !['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'].includes(type);
}

function isEditableTarget(target) {
  if (!target || typeof target !== 'object') {
    return false;
  }

  return !!target.isContentEditable || isTextInput(target);
}

function getSelectionText(target) {
  if (isTextInput(target) && typeof target.selectionStart === 'number' && typeof target.selectionEnd === 'number') {
    return String(target.value || '').slice(target.selectionStart, target.selectionEnd).trim();
  }

  const selection = window.getSelection();
  return selection ? String(selection.toString() || '').trim() : '';
}

function getClosestElement(target, selector) {
  return target && typeof target.closest === 'function' ? target.closest(selector) : null;
}

function queryCommandState(command) {
  try {
    return !!document.queryCommandEnabled(command);
  } catch (_error) {
    return false;
  }
}

function canTargetScrollHorizontally(target, deltaX) {
  let current = target && target.nodeType === Node.ELEMENT_NODE ? target : target?.parentElement;

  while (current && current !== document.body && current !== document.documentElement) {
    if (typeof current.scrollWidth === 'number' && current.scrollWidth > current.clientWidth + 1) {
      const style = window.getComputedStyle(current);
      if (style.overflowX !== 'hidden' && style.overflowX !== 'clip') {
        if (deltaX > 0 && current.scrollLeft > 0) {
          return true;
        }

        if (deltaX < 0 && current.scrollLeft + current.clientWidth < current.scrollWidth - 1) {
          return true;
        }
      }
    }

    current = current.parentElement;
  }

  const scrollingElement = document.scrollingElement || document.documentElement || document.body;
  if (!scrollingElement || typeof scrollingElement.scrollWidth !== 'number') {
    return false;
  }

  if (scrollingElement.scrollWidth <= scrollingElement.clientWidth + 1) {
    return false;
  }

  if (deltaX > 0 && scrollingElement.scrollLeft > 0) {
    return true;
  }

  if (deltaX < 0 &&
      scrollingElement.scrollLeft + scrollingElement.clientWidth < scrollingElement.scrollWidth - 1) {
    return true;
  }

  return false;
}

window.addEventListener('contextmenu', (event) => {
  const target = event.target;
  const link = getClosestElement(target, 'a[href]');
  const image = target && target.tagName === 'IMG' ? target : getClosestElement(target, 'img');
  const selectionText = getSelectionText(target);

  const payload = {
    x: event.clientX,
    y: event.clientY,
    pageURL: window.location.href,
    frameURL: window.location.href,
    linkURL: link?.href || '',
    linkText: (link?.innerText || link?.textContent || '').trim(),
    srcURL: image?.src || '',
    selectionText,
    titleText: target?.title || '',
    mediaType: image?.src ? 'image' : 'none',
    isEditable: isEditableTarget(target),
    inputFieldType: isTextInput(target) ? String(target.type || 'text').toLowerCase() : '',
    misspelledWord: '',
    dictionarySuggestions: [],
    editFlags: {
      canUndo: queryCommandState('undo'),
      canRedo: queryCommandState('redo'),
      canCut: queryCommandState('cut'),
      canCopy: queryCommandState('copy') || !!selectionText,
      canPaste: queryCommandState('paste'),
      canDelete: queryCommandState('delete'),
      canSelectAll: queryCommandState('selectAll')
    }
  };

  ipcRenderer.sendToHost('chrome-beta-context-menu', payload);
  event.preventDefault();
}, true);

window.addEventListener('wheel', (event) => {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) {
    return;
  }

  const absX = Math.abs(event.deltaX);
  const absY = Math.abs(event.deltaY);
  if (event.deltaMode !== 0 || absX < 8 || absX <= absY * 1.05) {
    return;
  }

  const targetCanScrollHorizontally = canTargetScrollHorizontally(event.target, event.deltaX);
  const isEditable = isEditableTarget(event.target);

  if (!targetCanScrollHorizontally && !isEditable && event.cancelable) {
    event.preventDefault();
  }

  ipcRenderer.sendToHost('chrome-beta-swipe-gesture', {
    deltaX: event.deltaX,
    deltaY: event.deltaY,
    deltaMode: event.deltaMode,
    ctrlKey: !!event.ctrlKey,
    metaKey: !!event.metaKey,
    altKey: !!event.altKey,
    isEditable,
    targetCanScrollHorizontally,
    clientX: event.clientX,
    clientY: event.clientY,
    timestamp: Date.now()
  });
}, { capture: true, passive: false });
