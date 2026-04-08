# System Dialog Component

A Windows-style system dialog component that provides authentic Windows system dialogs to replace JavaScript's native `alert()`, `confirm()`, and `prompt()` functions.

## Features

- **Windows-authentic styling** - Matches Windows 9 desktop dialog appearance
- **Status presets** - Predefined configurations for common dialog types (error, warning, info, question, success, notice)
- **Automatic icons** - Status-appropriate icons displayed based on dialog type
- **Flexible button configurations** - Multiple button layouts (OK, OK/Cancel, Yes/No, Yes/No/Cancel, etc.)
- **Return values** - Get user's choice via Promise or callback
- **Keyboard support** - Enter key triggers default button, Escape closes dialog
- **Modal overlays** - Optional modal behavior with semi-transparent backdrop
- **System sounds** - Plays Windows system sounds for different dialog types (if systemSounds is available)

## Installation

Include the CSS and JavaScript files in your HTML:

```html
<link rel="stylesheet" href="components/system_dialog/system-dialog.css">
<script src="components/system_dialog/system-dialog.js"></script>
```

The component creates a global `systemDialog` instance automatically.

## Basic Usage

### Simple Alert

```javascript
// Simple info dialog
await systemDialog.alert('This is a simple alert message');

// Alert with custom title
await systemDialog.alert('Operation completed successfully', 'Success');
```

### Confirmation Dialog

```javascript
// Returns 'ok' or 'cancel'
const result = await systemDialog.confirm('Are you sure you want to continue?');

if (result === 'ok') {
    console.log('User confirmed');
} else {
    console.log('User cancelled');
}
```

### Question Dialog (Yes/No)

```javascript
// Returns 'yes' or 'no'
const answer = await systemDialog.question('Do you want to save your changes?');

if (answer === 'yes') {
    saveFile();
}
```

### Status-specific Dialogs

```javascript
// Error dialog
await systemDialog.error('File not found!');

// Warning dialog
await systemDialog.warning('This action cannot be undone.');

// Info dialog
await systemDialog.info('The file was saved successfully.');
```

## Advanced Usage

### Custom Dialog Configuration

```javascript
const result = await systemDialog.show({
    title: 'Custom Dialog',
    body: 'This is a custom dialog with specific options.',
    status: 'warning',  // Optional: error, warning, info, question, success, notice
    buttons: 'yesnocancel',  // Button preset or custom array
    modal: true  // Optional: default is true
});

// result will be 'yes', 'no', or 'cancel'
```

### Custom Button Configurations

```javascript
const result = await systemDialog.show({
    title: 'Choose an Option',
    body: 'Select one of the following options:',
    buttons: [
        { label: 'Option A', value: 'a', default: true },
        { label: 'Option B', value: 'b' },
        { label: 'Cancel', value: 'cancel' }
    ]
});

// result will be 'a', 'b', or 'cancel'
```

### Using Callbacks Instead of Promises

```javascript
systemDialog.show({
    title: 'Callback Example',
    body: 'This uses a callback instead of a promise',
    buttons: 'okcancel',
    onClose: (result) => {
        console.log('User clicked:', result);
    }
});
```

## API Reference

### Main Method: `systemDialog.show(options)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `title` | string | `''` | Dialog title (auto-set if status is provided) |
| `body` | string | `''` | Dialog body text |
| `status` | string | `null` | Status preset: 'error', 'warning', 'info', 'question', 'success', 'notice' |
| `buttons` | string or Array | `'ok'` | Button configuration (see below) |
| `onClose` | function | `null` | Callback function called with button value |
| `modal` | boolean | `true` | Whether to show modal overlay |

**Returns:** Promise that resolves with the clicked button's value

### Convenience Methods

| Method | Description | Returns |
|--------|-------------|---------|
| `systemDialog.alert(body, title)` | Simple alert dialog | Promise → 'ok' |
| `systemDialog.confirm(body, title)` | Confirmation dialog | Promise → 'ok' or 'cancel' |
| `systemDialog.error(body, title)` | Error dialog | Promise → 'ok' |
| `systemDialog.warning(body, title)` | Warning dialog | Promise → 'ok' |
| `systemDialog.info(body, title)` | Info dialog | Promise → 'ok' |
| `systemDialog.question(body, title)` | Question dialog | Promise → 'yes' or 'no' |

### Button Presets

| Preset | Buttons | Return Values |
|--------|---------|---------------|
| `'ok'` | OK | 'ok' |
| `'okcancel'` | OK, Cancel | 'ok', 'cancel' |
| `'yesno'` | Yes, No | 'yes', 'no' |
| `'yesnocancel'` | Yes, No, Cancel | 'yes', 'no', 'cancel' |
| `'retrycancel'` | Retry, Cancel | 'retry', 'cancel' |
| `'abortretryignore'` | Abort, Retry, Ignore | 'abort', 'retry', 'ignore' |

### Status Icons

Each status type automatically displays an appropriate icon:

- **error** - Red circle with X
- **warning** - Yellow triangle with exclamation mark
- **info** - Blue circle with i
- **question** - Blue circle with question mark
- **success** - Blue circle with i (same as info)
- **notice** - Blue circle with i (same as info)

## Integration Examples

### Replacing native confirm()

**Before:**
```javascript
if (confirm('Do you want to save changes?')) {
    saveFile();
}
```

**After:**
```javascript
const result = await systemDialog.confirm('Do you want to save changes?');
if (result === 'ok') {
    saveFile();
}

// Or using question() for Yes/No:
const answer = await systemDialog.question('Do you want to save changes?');
if (answer === 'yes') {
    saveFile();
}
```

### Replacing native alert()

**Before:**
```javascript
alert('File not found!');
```

**After:**
```javascript
await systemDialog.error('File not found!');
```

### File Save Prompt Example

```javascript
async function newFile() {
    if (this.isModified) {
        const result = await systemDialog.show({
            title: 'Notepad',
            body: 'Do you want to save changes to ' + (this.currentFile || 'Untitled') + '?',
            buttons: 'yesnocancel'
        });

        if (result === 'yes') {
            saveFile();
        } else if (result === 'cancel') {
            return; // Don't create new file
        }
        // result === 'no' continues without saving
    }

    createNewFile();
}
```

## Keyboard Controls

- **Enter** - Activates the default button (button with `default: true`)
- **Escape** - Closes the dialog (returns 'cancel' if available, otherwise last button value)
- **Tab** - Cycles through buttons

## Styling

The dialogs use Windows 9 classic desktop styling with:
- Classic window border with blue accent
- Segoe UI font
- Standard Windows button styling
- Smooth fade-in animations
- Modal overlay with semi-transparent background

All styles are contained in `system-dialog.css` and follow the classic Windows visual language.

## Browser Support

Works in all modern browsers that support:
- Promises
- ES6 classes
- CSS flexbox
- SVG

## Notes

- Dialogs are always centered on screen
- Multiple dialogs can be shown simultaneously (each gets a higher z-index)
- The component integrates with the Windows system sounds component if available
- All text is automatically escaped to prevent XSS attacks
