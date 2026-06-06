document.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const paramId = urlParams.get('id');
    const paramMsg = urlParams.get('msg');
    const keyHash = window.location.hash.substring(1);

    const loadingState = document.getElementById('loading-state');
    const errorState = document.getElementById('error-state');
    const decryptingState = document.getElementById('decrypting-state');
    const fileReadyState = document.getElementById('file-ready-state');
    
    const dlFileName = document.getElementById('dl-file-name');
    const dlFileSize = document.getElementById('dl-file-size');
    const dlUploadDate = document.getElementById('dl-upload-date');
    const dlDownloadCount = document.getElementById('dl-download-count');
    
    const downloadBtn = document.getElementById('download-btn');
    const previewContainer = document.getElementById('preview-container');

    if (!paramId || !keyHash) {
        showError();
        return;
    }

    let fileData = null; // Decrypted blob
    let originalFileName = 'encrypted_file.dat';
    let originalMimeType = 'application/octet-stream';
    let directFilePath = '';
    
    let telegramFileId = null;
    let telegramMessageId = null;
    let fileSize = 0;

    // Helper to build Telegram link
    function getTelegramMessageLink(chatId, messageId) {
        if (chatId.startsWith('@')) {
            const username = chatId.substring(1);
            return `https://t.me/${username}/${messageId}`;
        } else {
            let cleanId = chatId;
            if (chatId.startsWith('-100')) {
                cleanId = chatId.substring(4);
            } else if (chatId.startsWith('-')) {
                cleanId = chatId.substring(1);
            }
            return `https://t.me/c/${cleanId}/${messageId}`;
        }
    }

    // Main fetch metadata sequence
    try {
        if (paramMsg) {
            // Legacy / direct link flow (msg is message_id, id is file_id)
            telegramFileId = paramId;
            telegramMessageId = paramMsg;
            
            if (CONFIG.TELEGRAM_BOT_TOKEN === 'YOUR_TELEGRAM_BOT_TOKEN' || telegramFileId.startsWith('mock_file_id')) {
                mockMetadata();
            } else {
                // Fetch using Telegram Bot API directly
                await fetchTelegramMetadataDirectly();
            }
        } else {
            // Supabase link flow (id is Supabase row ID)
            if (supabaseClient) {
                const { data, error } = await supabaseClient
                    .from('skyshare_files')
                    .select('*')
                    .eq('id', paramId)
                    .single();
                
                if (error || !data) {
                    console.error('Failed to fetch file info from Supabase:', error);
                    showError();
                    return;
                }
                
                telegramFileId = data.telegram_file_id;
                telegramMessageId = data.telegram_message_id;
                originalFileName = data.file_name;
                originalMimeType = data.mime_type;
                fileSize = data.file_size;

                dlFileName.textContent = originalFileName;
                dlFileSize.textContent = formatBytes(fileSize);
                dlUploadDate.textContent = new Date(data.created_at).toLocaleDateString();
                dlDownloadCount.textContent = '1';

                // Check size limit: Telegram Bot API has 20MB limit for getFile
                const MAX_BOT_DL_SIZE = 20 * 1024 * 1024;
                if (fileSize > MAX_BOT_DL_SIZE) {
                    showTelegramFallback();
                } else if (CONFIG.TELEGRAM_BOT_TOKEN === 'YOUR_TELEGRAM_BOT_TOKEN' || telegramFileId.startsWith('mock_file_id')) {
                    mockMetadata();
                } else {
                    await fetchTelegramMetadataDirectly();
                }
            } else {
                console.error('Supabase client not initialized and legacy msg parameter is missing.');
                showError();
                return;
            }
        }
    } catch (err) {
        console.error(err);
        showError();
    }

    async function fetchTelegramMetadataDirectly() {
        try {
            const getFileUrl = `${CONFIG.TELEGRAM_API_BASE}/bot${CONFIG.TELEGRAM_BOT_TOKEN}/getFile?file_id=${telegramFileId}`;
            const response = await fetch(getFileUrl);
            const data = await response.json();
            
            if (!data.ok) {
                console.warn('Bot API getFile failed or file too large. Falling back to Telegram Channel download.');
                showTelegramFallback();
                return;
            }
            
            const telegramFile = data.result;
            directFilePath = `${CONFIG.TELEGRAM_API_BASE}/file/bot${CONFIG.TELEGRAM_BOT_TOKEN}/${telegramFile.file_path}`;
            
            // If metadata wasn't loaded from Supabase, update placeholders
            if (!fileSize) {
                dlFileName.textContent = 'Encrypted File (Decrypting to view)';
                dlFileSize.textContent = formatBytes(telegramFile.file_size);
                dlUploadDate.textContent = 'Unknown';
                dlDownloadCount.textContent = '1';
            }

            startDecryption(directFilePath);
        } catch (e) {
            console.error('Failed to query getFile directly:', e);
            showTelegramFallback();
        }
    }

    function mockMetadata() {
        dlFileName.textContent = originalFileName !== 'encrypted_file.dat' ? originalFileName : "Encrypted File (Mock)";
        dlFileSize.textContent = fileSize ? formatBytes(fileSize) : "Unknown Size (Mock)";
        dlUploadDate.textContent = new Date().toLocaleDateString();
        dlDownloadCount.textContent = Math.floor(Math.random() * 100);
        
        directFilePath = 'mock';
        startDecryption(directFilePath);
    }

    function showTelegramFallback() {
        loadingState.classList.add('hidden');
        decryptingState.classList.add('hidden');
        fileReadyState.classList.remove('hidden');
        downloadBtn.classList.add('hidden'); // Hide direct download button
        
        const telegramDownloadContainer = document.getElementById('telegram-download-container');
        const telegramLinkBtn = document.getElementById('telegram-link-btn');
        
        if (telegramDownloadContainer && telegramLinkBtn) {
            const tLink = getTelegramMessageLink(CONFIG.TELEGRAM_CHAT_ID, telegramMessageId);
            telegramLinkBtn.href = tLink;
            telegramDownloadContainer.classList.remove('hidden');
        }
    }

    async function startDecryption(fileUrl) {
        loadingState.classList.add('hidden');
        decryptingState.classList.remove('hidden');

        try {
            let encryptedBlob;
            if (fileUrl === 'mock') {
                // Mock encrypted blob and wait a bit
                await new Promise(r => setTimeout(r, 1000));
                fileData = new Blob(["Mock Decrypted Content"], {type: 'text/plain'});
                originalFileName = 'mock_file.txt';
                originalMimeType = 'text/plain';
            } else {
                // Fetch the encrypted file from Telegram (via CORS proxy if configured)
                const fetchUrl = CONFIG.CORS_PROXY ? `${CONFIG.CORS_PROXY}${encodeURIComponent(fileUrl)}` : fileUrl;
                let response;
                try {
                    response = await fetch(fetchUrl);
                    if (!response.ok) throw new Error('Proxy returned non-OK status: ' + response.status);
                    encryptedBlob = await response.blob();
                } catch (fetchErr) {
                    console.warn('Direct file download failed via proxy. Showing Telegram channel fallback.', fetchErr);
                    showTelegramFallback();
                    return;
                }
                
                // Import the key from URL hash
                const cryptoKey = await importKeyFromBase64(keyHash);
                
                // Decrypt and extract metadata
                try {
                    const decryptedData = await decryptFile(encryptedBlob, cryptoKey);
                    fileData = decryptedData.blob;
                    originalFileName = decryptedData.metadata.name || 'secure_file_skyshare';
                    originalMimeType = decryptedData.metadata.type || 'application/octet-stream';
                } catch (decryptErr) {
                    console.error('Decryption failed. The key might be invalid.', decryptErr);
                    showNotification('Failed to decrypt. Link might be invalid.');
                    decryptingState.classList.add('hidden');
                    errorState.classList.remove('hidden');
                    return;
                }
            }
            
            // Update UI with decrypted info
            decryptingState.classList.add('hidden');
            fileReadyState.classList.remove('hidden');
            
            dlFileName.textContent = originalFileName;
            if (fileUrl !== 'mock') {
                dlFileSize.textContent = formatBytes(fileData.size);
            }
            
            const objUrl = URL.createObjectURL(fileData);
            setupPreview(objUrl, originalMimeType, originalFileName, true);

        } catch (e) {
            console.error('Unexpected error during decryption flow:', e);
            decryptingState.classList.add('hidden');
            errorState.classList.remove('hidden');
        }
    }

    function showError() {
        loadingState.classList.add('hidden');
        errorState.classList.remove('hidden');
        if (decryptingState) decryptingState.classList.add('hidden');
    }

    downloadBtn.addEventListener('click', () => {
        if (fileData) {
            const url = URL.createObjectURL(fileData);
            triggerDownload(url, originalFileName);
        }
    });

    function triggerDownload(url, filename) {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

    // Setup Local Decryption Drag-and-Drop / Browse fallback
    const decryptDropzone = document.getElementById('decrypt-dropzone');
    const decryptFileInput = document.getElementById('decrypt-file-input');

    if (decryptDropzone) {
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            decryptDropzone.addEventListener(eventName, preventDefaults, false);
        });

        ['dragenter', 'dragover'].forEach(eventName => {
            decryptDropzone.addEventListener(eventName, () => decryptDropzone.classList.add('dragover'), false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            decryptDropzone.addEventListener(eventName, () => decryptDropzone.classList.remove('dragover'), false);
        });

        decryptDropzone.addEventListener('drop', handleDecryptDrop, false);
    }

    if (decryptFileInput) {
        decryptFileInput.addEventListener('change', handleDecryptFileSelect, false);
    }

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    function handleDecryptDrop(e) {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files.length > 0) {
            processEncryptedFile(files[0]);
        }
    }

    function handleDecryptFileSelect(e) {
        const files = e.target.files;
        if (files.length > 0) {
            processEncryptedFile(files[0]);
        }
    }

    async function processEncryptedFile(file) {
        try {
            // Hide ready state / container, show decrypting state
            fileReadyState.classList.add('hidden');
            decryptingState.classList.remove('hidden');

            const cryptoKey = await importKeyFromBase64(keyHash);
            
            // Decrypt the file
            const decryptedData = await decryptFile(file, cryptoKey);
            fileData = decryptedData.blob;
            
            // If the metadata in the encrypted file matches what we expect or we override it
            const decryptedFileName = decryptedData.metadata.name || originalFileName;
            const decryptedMimeType = decryptedData.metadata.type || originalMimeType;

            // Hide decrypting state, show file ready state
            decryptingState.classList.add('hidden');
            fileReadyState.classList.remove('hidden');
            
            // Update the UI
            dlFileName.textContent = decryptedFileName;
            dlFileSize.textContent = formatBytes(fileData.size);
            
            // Hide the telegram-download-container, show the direct download-btn
            document.getElementById('telegram-download-container').classList.add('hidden');
            downloadBtn.classList.remove('hidden');

            // Trigger the download automatically
            const objUrl = URL.createObjectURL(fileData);
            triggerDownload(objUrl, decryptedFileName);
            
            // Setup preview
            setupPreview(objUrl, decryptedMimeType, decryptedFileName, true);

            showNotification('File decrypted successfully!');
        } catch (error) {
            console.error('Local decryption failed:', error);
            showNotification('Failed to decrypt. Please check if it is the correct encrypted file and link.');
            decryptingState.classList.add('hidden');
            fileReadyState.classList.remove('hidden');
        }
    }

    function setupPreview(url, mimeType, filename, isBlob = false) {
        if (mimeType.startsWith('image/')) {
            previewContainer.innerHTML = `<img src="${url}" alt="${filename}">`;
            previewContainer.classList.remove('hidden');
        } else if (mimeType.startsWith('video/')) {
            previewContainer.innerHTML = `<video controls src="${url}"></video>`;
            previewContainer.classList.remove('hidden');
        } else if (mimeType.startsWith('audio/')) {
            previewContainer.innerHTML = `<audio controls src="${url}"></audio>`;
            previewContainer.classList.remove('hidden');
        } else if (mimeType === 'application/pdf') {
            previewContainer.innerHTML = `<iframe src="${url}"></iframe>`;
            previewContainer.classList.remove('hidden');
        } else if (mimeType.startsWith('text/') || mimeType === 'application/json') {
            fetchTextContent(url, filename);
        }
    }

    async function fetchTextContent(url, filename) {
        try {
            const resp = await fetch(url);
            const text = await resp.text();
            
            const ext = filename.split('.').pop().toLowerCase();
            const languageMap = {
                'js': 'javascript', 'html': 'markup', 'css': 'css', 'json': 'json', 'py': 'python', 'c': 'c'
            };
            const lang = languageMap[ext] || 'clike';

            previewContainer.innerHTML = `<pre><code class="language-${lang}">${escapeHtml(text)}</code></pre>`;
            previewContainer.classList.remove('hidden');
            
            if (window.Prism) {
                Prism.highlightAllUnder(previewContainer);
            }
        } catch (e) {
            console.error('Preview fetch failed', e);
        }
    }

    function escapeHtml(unsafe) {
        return unsafe
             .replace(/&/g, "&amp;")
             .replace(/</g, "&lt;")
             .replace(/>/g, "&gt;")
             .replace(/"/g, "&quot;")
             .replace(/'/g, "&#039;");
    }
});
