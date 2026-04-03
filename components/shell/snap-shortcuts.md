# Window Snap Shortcuts

This file documents the intended `Win + Arrow` behavior for the shell shortcut handler in [`snap-shortcuts.js`](./snap-shortcuts.js).

## General Notes

- All shortcuts operate on the currently focused window.
- If a window is minimized, it is restored before the new snap state is applied.
- If a window is maximized, it is restored before snapping, except for `Win + Up`.
- There is no combo-chaining delay. Each keypress applies immediately.
- Repeated keypresses should only move through valid states.
- Some apps may ignore snapping, including fullscreen or legacy-style windows.
- Snap Assist may appear after left/right half snaps, but it is outside the core shortcut state machine.

## `Win + Left Arrow`

- Default behavior: snap the focused window to the left half of the current monitor.
- If the window is already snapped on the left side, move it to the left half of the adjacent monitor if one exists.
- From maximized: restore, then snap left.
- From minimized: restore, then snap left.

## `Win + Right Arrow`

- Default behavior: snap the focused window to the right half of the current monitor.
- If the window is already snapped on the right side, move it to the right half of the adjacent monitor if one exists.
- From maximized: restore, then snap right.
- From minimized: restore, then snap right.

## `Win + Up Arrow`

- Restored window: maximize.
- Left or right half snap: move to the matching top quadrant.
- Bottom-left or bottom-right quadrant: move to the matching top quadrant.
- Top-left or top-right quadrant: maximize.
- Already maximized: no-op.

## `Win + Down Arrow`

- Maximized window: restore.
- Restored window: minimize.
- Left or right half snap: move to the matching bottom quadrant.
- Bottom-left or bottom-right quadrant: minimize.

## Quadrant Rules

- Quadrant snapping requires a prior left or right half snap.
- `Win + Left`, then `Win + Up` produces top-left.
- `Win + Left`, then `Win + Down` produces bottom-left.
- `Win + Right`, then `Win + Up` produces top-right.
- `Win + Right`, then `Win + Down` produces bottom-right.

## Multi-Monitor Rules

- Repeating `Win + Left` or `Win + Right` moves the window across monitors in that direction while preserving its side.
- If no monitor exists in that direction, the shortcut is a no-op.
- The current simulator build only exposes one active display, so repeated same-direction monitor traversal currently resolves to a no-op.

## State Summary

### `Win + Up`

- Restored -> Maximized
- Left/Right -> Top quadrant
- Bottom quadrant -> Top quadrant
- Top quadrant -> Maximized
- Maximized -> No-op

### `Win + Down`

- Maximized -> Restored
- Restored -> Minimized
- Left/Right -> Bottom quadrant
- Bottom quadrant -> Minimized

## Optional Related Shortcuts

- `Win + Shift + Left/Right`: move the window to the adjacent monitor without changing size or snap state.
- `Win + Home`: minimize all windows except the active one.
