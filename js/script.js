// Theme Toggle Logic
const themeToggleBtn = document.getElementById('theme-toggle');
const htmlElement = document.documentElement;

// Initialize Theme
const savedTheme = localStorage.getItem('theme') || 'dark';
htmlElement.setAttribute('data-theme', savedTheme);

if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', () => {
        const currentTheme = htmlElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        htmlElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
    });
}

// Notification System
function showNotification(message, duration = 3000) {
    const notif = document.getElementById('notification');
    if (!notif) return;

    notif.textContent = message;
    notif.classList.add('show');

    setTimeout(() => {
        notif.classList.remove('show');
    }, duration);
}

// Format Bytes
function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Format Time
function formatTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) return 'Calculating...';
    if (seconds < 60) return `${Math.ceil(seconds)}s left`;
    const minutes = Math.floor(seconds / 60);
    const secs = Math.ceil(seconds % 60);
    return `${minutes}m ${secs}s left`;
}

// Copy to Clipboard
function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        showNotification('Link copied to clipboard!');
    }).catch(err => {
        console.error('Failed to copy: ', err);
        showNotification('Failed to copy link.');
    });
}

// Configuration for Backend Endpoints
const CONFIG = {
    CORS_PROXY: (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.protocol === 'file:' || !window.location.hostname)
        ? 'http://localhost:8081/?url='
        : '/api/proxy?url=',
    STREAM_API: (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.protocol === 'file:' || !window.location.hostname)
        ? 'http://localhost:8081/api/stream'
        : '/api/stream',
    METADATA_API: (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.protocol === 'file:' || !window.location.hostname)
        ? 'http://localhost:8081/api/metadata'
        : '/api/metadata',
    UPLOAD_API: (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.protocol === 'file:' || !window.location.hostname)
        ? 'http://localhost:8081/api/upload'
        : '/api/upload',
};

// Client-Side AES Encryption/Decryption using Web Crypto API
async function generateEncryptionKey() {
    return await window.crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
    );
}

async function exportKeyToBase64(key) {
    const raw = await window.crypto.subtle.exportKey("raw", key);
    return btoa(String.fromCharCode(...new Uint8Array(raw))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function importKeyFromBase64(base64) {
    const str = atob(base64.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) {
        bytes[i] = str.charCodeAt(i);
    }
    return await window.crypto.subtle.importKey(
        "raw",
        bytes,
        { name: "AES-GCM" },
        true,
        ["encrypt", "decrypt"]
    );
}

async function encryptFile(file, key) {
    const iv = window.crypto.getRandomValues(new Uint8Array(12));

    // Encapsulate metadata inside the encrypted blob
    const metadata = JSON.stringify({
        name: file.name,
        type: file.type,
        size: file.size
    });

    const metaBuffer = new TextEncoder().encode(metadata);
    const metaLengthBuffer = new Uint8Array(4);
    new DataView(metaLengthBuffer.buffer).setUint32(0, metaBuffer.length, true);

    const fileBuffer = await file.arrayBuffer();

    const dataToEncrypt = new Uint8Array(4 + metaBuffer.length + fileBuffer.byteLength);
    dataToEncrypt.set(metaLengthBuffer, 0);
    dataToEncrypt.set(metaBuffer, 4);
    dataToEncrypt.set(new Uint8Array(fileBuffer), 4 + metaBuffer.length);

    const encryptedContent = await window.crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv },
        key,
        dataToEncrypt
    );

    const combined = new Uint8Array(iv.length + encryptedContent.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encryptedContent), iv.length);

    return new Blob([combined], { type: 'application/octet-stream' });
}

async function decryptFile(blob, key) {
    const buffer = await blob.arrayBuffer();
    const iv = new Uint8Array(buffer.slice(0, 12));
    const data = buffer.slice(12);

    const decryptedContent = await window.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: iv },
        key,
        data
    );

    const decryptedArray = new Uint8Array(decryptedContent);
    const metaLength = new DataView(decryptedArray.buffer).getUint32(0, true);

    const metaBuffer = decryptedArray.slice(4, 4 + metaLength);
    const metadataStr = new TextDecoder().decode(metaBuffer);
    const metadata = JSON.parse(metadataStr);

    const fileContent = decryptedArray.slice(4 + metaLength);

    return {
        blob: new Blob([fileContent], { type: metadata.type || 'application/octet-stream' }),
        metadata: metadata
    };
}
