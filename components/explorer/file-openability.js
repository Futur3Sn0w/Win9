const path = require('path');

const PHOTO_VIEWER_EXTENSIONS = new Set([
    '.jpg',
    '.jpeg',
    '.png',
    '.gif',
    '.bmp',
    '.webp',
    '.svg'
]);

const UTF8_FATAL_DECODER = new TextDecoder('utf-8', { fatal: true });

function getFileExtension(filePath) {
    if (!filePath) {
        return '';
    }

    return path.extname(filePath).toLowerCase();
}

function bufferStartsWith(buffer, signature) {
    if (!buffer || buffer.length < signature.length) {
        return false;
    }

    for (let index = 0; index < signature.length; index += 1) {
        if (buffer[index] !== signature[index]) {
            return false;
        }
    }

    return true;
}

function looksLikeUtf16LeWithoutBom(buffer) {
    if (!buffer || buffer.length < 4) {
        return false;
    }

    let zeroHighBytes = 0;
    let zeroLowBytes = 0;
    let pairs = 0;
    const sampleLength = Math.min(buffer.length - (buffer.length % 2), 256);

    for (let index = 0; index < sampleLength; index += 2) {
        pairs += 1;
        if (buffer[index] === 0x00) {
            zeroLowBytes += 1;
        }
        if (buffer[index + 1] === 0x00) {
            zeroHighBytes += 1;
        }
    }

    return pairs > 0 && zeroHighBytes / pairs > 0.35 && zeroLowBytes / pairs < 0.1;
}

function looksLikeUtf16BeWithoutBom(buffer) {
    if (!buffer || buffer.length < 4) {
        return false;
    }

    let zeroHighBytes = 0;
    let zeroLowBytes = 0;
    let pairs = 0;
    const sampleLength = Math.min(buffer.length - (buffer.length % 2), 256);

    for (let index = 0; index < sampleLength; index += 2) {
        pairs += 1;
        if (buffer[index] === 0x00) {
            zeroHighBytes += 1;
        }
        if (buffer[index + 1] === 0x00) {
            zeroLowBytes += 1;
        }
    }

    return pairs > 0 && zeroHighBytes / pairs > 0.35 && zeroLowBytes / pairs < 0.1;
}

function canDecodeUtf8(buffer) {
    try {
        UTF8_FATAL_DECODER.decode(buffer);
        return true;
    } catch (error) {
        return false;
    }
}

function looksBinaryBuffer(buffer) {
    if (!buffer || buffer.length === 0) {
        return false;
    }

    let suspiciousBytes = 0;

    for (const byte of buffer) {
        if (byte === 0x00) {
            suspiciousBytes += 1;
            continue;
        }

        const isControl = byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d && byte !== 0x0c;
        if (isControl) {
            suspiciousBytes += 1;
        }
    }

    return suspiciousBytes / buffer.length > 0.2;
}

function detectTextEncoding(buffer) {
    if (!buffer || buffer.length === 0) {
        return 'utf-8';
    }

    if (bufferStartsWith(buffer, [0xef, 0xbb, 0xbf])) {
        return 'utf-8';
    }

    if (bufferStartsWith(buffer, [0xff, 0xfe])) {
        return 'utf-16le';
    }

    if (bufferStartsWith(buffer, [0xfe, 0xff])) {
        return 'utf-16be';
    }

    if (looksLikeUtf16LeWithoutBom(buffer)) {
        return 'utf-16le';
    }

    if (looksLikeUtf16BeWithoutBom(buffer)) {
        return 'utf-16be';
    }

    if (canDecodeUtf8(buffer)) {
        return 'utf-8';
    }

    if (looksBinaryBuffer(buffer)) {
        return null;
    }

    return 'windows-1252';
}

function decodeTextBuffer(buffer) {
    const encoding = detectTextEncoding(buffer);
    if (!encoding) {
        return {
            canOpen: false,
            reason: 'binary-file',
            encoding: null,
            content: null
        };
    }

    let content = null;

    try {
        if (encoding === 'utf-16be') {
            const normalized = Buffer.from(buffer);
            for (let index = 0; index + 1 < normalized.length; index += 2) {
                const current = normalized[index];
                normalized[index] = normalized[index + 1];
                normalized[index + 1] = current;
            }
            content = new TextDecoder('utf-16le').decode(normalized);
        } else {
            content = new TextDecoder(encoding).decode(buffer);
        }
    } catch (error) {
        return {
            canOpen: false,
            reason: 'decode-failed',
            encoding,
            content: null
        };
    }

    return {
        canOpen: true,
        reason: null,
        encoding,
        content
    };
}

async function readFileProbe(filePath, fsPromises, byteCount = 4096) {
    const handle = await fsPromises.open(filePath, 'r');

    try {
        const stats = await handle.stat();
        const length = Math.min(stats.size, byteCount);
        const buffer = Buffer.alloc(length);

        if (length === 0) {
            return {
                size: stats.size,
                buffer: Buffer.alloc(0)
            };
        }

        const { bytesRead } = await handle.read(buffer, 0, length, 0);
        return {
            size: stats.size,
            buffer: buffer.subarray(0, bytesRead)
        };
    } finally {
        await handle.close();
    }
}

async function canNotepadOpenFile(filePath, fsPromises) {
    if (!filePath || !fsPromises) {
        return { canOpen: false, reason: 'missing-file-system' };
    }

    try {
        const { buffer } = await readFileProbe(filePath, fsPromises);
        return decodeTextBuffer(buffer);
    } catch (error) {
        return {
            canOpen: false,
            reason: error?.code || 'probe-failed'
        };
    }
}

async function canPhotoViewerOpenFile(filePath) {
    return {
        canOpen: PHOTO_VIEWER_EXTENSIONS.has(getFileExtension(filePath)),
        reason: PHOTO_VIEWER_EXTENSIONS.has(getFileExtension(filePath)) ? null : 'unsupported-image-format'
    };
}

async function canAppOpenFile(appId, filePath, fsPromises) {
    switch (appId) {
        case 'notepad':
            return canNotepadOpenFile(filePath, fsPromises);
        case 'photo-viewer':
            return canPhotoViewerOpenFile(filePath);
        default:
            return {
                canOpen: true,
                reason: null
            };
    }
}

module.exports = {
    canAppOpenFile,
    canNotepadOpenFile,
    canPhotoViewerOpenFile,
    decodeTextBuffer,
    detectTextEncoding,
    getFileExtension
};
