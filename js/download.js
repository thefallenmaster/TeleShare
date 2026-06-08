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

    // Pre-populate details from URL parameters if available (useful for files > 20MB where getFile fails)
    const paramName = urlParams.get('name');
    const paramSize = urlParams.get('size');
    if (paramName) {
        originalFileName = decodeURIComponent(paramName);
        dlFileName.textContent = originalFileName;
    }
    if (paramSize) {
        fileSize = parseInt(paramSize, 10);
        dlFileSize.textContent = formatBytes(fileSize);
    }
    dlUploadDate.textContent = new Date().toLocaleDateString();
    dlDownloadCount.textContent = '1';

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
            
            await fetchTelegramMetadataDirectly();
        } else {
            // Supabase link flow (id is Supabase row ID)
            try {
                const response = await fetch(`${CONFIG.METADATA_API}?id=${paramId}`);
                const data = await response.json();
                
                if (!response.ok || !data || data.error) {
                    console.error('Failed to fetch file info from Backend:', data?.error || response.statusText);
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
                dlDownloadCount.textContent = data.downloads_count || '0';

                await fetchTelegramMetadataDirectly();
            } catch (err) {
                console.error('Backend metadata fetch failed.', err);
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
            const getFileUrl = `https://api.telegram.org/botBOT_TOKEN_PLACEHOLDER/getFile?file_id=${telegramFileId}`;
            const fetchUrl = `${CONFIG.CORS_PROXY}${encodeURIComponent(getFileUrl)}`;
            
            const response = await fetch(fetchUrl);
            const responseText = await response.text();
            
            let data;
            try {
                data = JSON.parse(responseText);
            } catch (jsonErr) {
                console.error('Failed to parse JSON response from proxy:', responseText);
                showNotification('Proxy server returned an invalid response.');
                loadingState.classList.add('hidden');
                fileReadyState.classList.remove('hidden');
                return;
            }
            
            if (!data.ok) {
                console.error('Bot API getFile failed:', data.description);
                
                // Fallback to our proxy MTProto streaming endpoint for large files
                if (data.description && data.description.includes('too big')) {
                    console.log('File >20MB. Falling back to proxy MTProto stream.');
                    directFilePath = `${CONFIG.STREAM_API}?msg_id=${telegramMessageId}`;
                } else {
                    showNotification('Failed to fetch file info: ' + data.description);
                }
                
                if (!fileSize) {
                    dlFileName.textContent = 'Encrypted File';
                    dlFileSize.textContent = 'Unknown';
                    dlUploadDate.textContent = 'Unknown';
                    dlDownloadCount.textContent = '1';
                }
                loadingState.classList.add('hidden');
                fileReadyState.classList.remove('hidden');
                return;
            }
            
            const telegramFile = data.result;
            directFilePath = `https://api.telegram.org/file/botBOT_TOKEN_PLACEHOLDER/${telegramFile.file_path}`;
            
            // If metadata wasn't loaded from Backend, update placeholders
            if (!fileSize) {
                dlFileName.textContent = 'Secure Encrypted File';
                dlFileSize.textContent = formatBytes(telegramFile.file_size);
                dlUploadDate.textContent = new Date().toLocaleDateString();
                dlDownloadCount.textContent = '1';
            }

            loadingState.classList.add('hidden');
            fileReadyState.classList.remove('hidden');
        } catch (e) {
            console.error('Failed to query getFile directly:', e);
            showNotification('Error loading file metadata.');
            loadingState.classList.add('hidden');
            fileReadyState.classList.remove('hidden');
        }
    }

    function mockMetadata() {
        dlFileName.textContent = originalFileName !== 'encrypted_file.dat' ? originalFileName : "Encrypted File (Mock)";
        dlFileSize.textContent = fileSize ? formatBytes(fileSize) : "Unknown Size (Mock)";
        dlUploadDate.textContent = new Date().toLocaleDateString();
        dlDownloadCount.textContent = Math.floor(Math.random() * 100);
        
        directFilePath = 'mock';
        loadingState.classList.add('hidden');
        fileReadyState.classList.remove('hidden');
    }

    // ── Progress panel helpers ──────────────────────────────────────────────
    const dlProgressFill   = document.getElementById('dl-progress-fill');
    const dlProgressGlow   = document.getElementById('dl-progress-glow');
    const dlPercentBadge   = document.getElementById('dl-percent-badge');
    const dlPhaseLabel     = document.getElementById('dl-phase-label');
    const dlPhaseSub       = document.getElementById('dl-phase-sub');
    const dlBytesStat      = document.getElementById('dl-bytes-stat');
    const dlSpeedStat      = document.getElementById('dl-speed-stat');
    const dlEtaStat        = document.getElementById('dl-eta-stat');
    const iconDownload     = document.getElementById('icon-download');
    const iconDecrypt      = document.getElementById('icon-decrypt');
    const stepDownload     = document.getElementById('step-download');
    const stepDecrypt      = document.getElementById('step-decrypt');
    const stepDone         = document.getElementById('step-done');

    function setProgress(pct, animated = true) {
        const p = Math.min(100, Math.max(0, pct));
        dlProgressFill.style.width = p + '%';
        dlProgressGlow.style.left  = p + '%';
        dlPercentBadge.textContent = Math.round(p) + '%';
    }

    function activateStep(step) {
        [stepDownload, stepDecrypt, stepDone].forEach(s => {
            s.querySelector('.dl-step-dot').classList.remove('active', 'done');
        });
        const steps = [stepDownload, stepDecrypt, stepDone];
        const idx   = steps.indexOf(step);
        steps.forEach((s, i) => {
            const dot = s.querySelector('.dl-step-dot');
            if (i < idx)  dot.classList.add('done');
            if (i === idx) dot.classList.add('active');
        });
    }

    // ── Main download + decrypt flow ────────────────────────────────────────
    async function startDecryption(fileUrl) {
        const originalBtnContent = downloadBtn.innerHTML;
        downloadBtn.disabled = true;

        // Show progress panel
        fileReadyState.classList.add('hidden');
        decryptingState.classList.remove('hidden');
        setProgress(0);
        activateStep(stepDownload);
        dlPhaseLabel.textContent = 'Downloading...';
        dlPhaseSub.textContent   = 'Fetching encrypted file from Telegram';
        iconDownload.classList.remove('hidden');
        iconDecrypt.classList.add('hidden');

        try {
            let encryptedBlob;

            if (fileUrl === 'mock') {
                // Simulate download progress for mock
                for (let i = 0; i <= 100; i += 5) {
                    setProgress(i);
                    dlBytesStat.textContent  = `${i} B / 100 B`;
                    dlSpeedStat.textContent  = '5 B/s';
                    dlEtaStat.textContent    = `${Math.ceil((100 - i) / 5)}s left`;
                    await new Promise(r => setTimeout(r, 40));
                }
                encryptedBlob = new Blob(["Mock Decrypted Content"], {type: 'text/plain'});
                fileData = new Blob(["Mock Decrypted Content"], {type: 'text/plain'});
                originalFileName = 'mock_file.txt';
                originalMimeType = 'text/plain';
            } else {
                // ── Phase 1: Download with real streaming progress ──────────
                let fetchUrl = fileUrl;
                if (CONFIG.CORS_PROXY && !fileUrl.includes('/api/stream')) {
                    if (CONFIG.CORS_PROXY.includes('corsproxy.io')) {
                        fetchUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(fileUrl)}`;
                    } else {
                        fetchUrl = `${CONFIG.CORS_PROXY}${encodeURIComponent(fileUrl)}`;
                    }
                }

                let response;
                try {
                    response = await fetch(fetchUrl);
                    if (!response.ok) throw new Error('HTTP ' + response.status);
                } catch (fetchErr) {
                    console.error('Download failed:', fetchErr);
                    showNotification('Download failed: ' + fetchErr.message);
                    resetAfterError(originalBtnContent);
                    return;
                }

                const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
                const reader        = response.body.getReader();
                const chunks        = [];
                let received        = 0;
                let startTime       = Date.now();
                let lastTime        = startTime;
                let lastReceived    = 0;

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    chunks.push(value);
                    received += value.byteLength;

                    const now     = Date.now();
                    const elapsed = (now - lastTime) / 1000;

                    // Update UI every 150ms (not on every single chunk)
                    if (elapsed >= 0.15) {
                        const bytesPerSec = elapsed > 0 ? (received - lastReceived) / elapsed : 0;
                        lastTime     = now;
                        lastReceived = received;

                        const pct = contentLength > 0 ? (received / contentLength) * 100 : -1;
                        if (pct >= 0) {
                            setProgress(pct);
                        } else {
                            // Unknown length – pulse the bar
                            const pulse = ((Date.now() / 30) % 100);
                            setProgress(pulse);
                        }
                        dlBytesStat.textContent = contentLength > 0
                            ? `${formatBytes(received)} / ${formatBytes(contentLength)}`
                            : `${formatBytes(received)} downloaded`;
                        dlSpeedStat.textContent = bytesPerSec > 0 ? formatBytes(bytesPerSec) + '/s' : '--';
                        dlEtaStat.textContent   = (contentLength > 0 && bytesPerSec > 0)
                            ? formatTime((contentLength - received) / bytesPerSec)
                            : 'Downloading...';
                    }
                }

                // Merge chunks into single blob
                const totalLength = chunks.reduce((acc, c) => acc + c.byteLength, 0);
                const merged      = new Uint8Array(totalLength);
                let offset = 0;
                for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
                encryptedBlob = new Blob([merged]);

                // ── Phase 2: Decryption progress animation ─────────────────
                setProgress(100);
                dlBytesStat.textContent = contentLength
                    ? `${formatBytes(contentLength)} / ${formatBytes(contentLength)}`
                    : `${formatBytes(received)} downloaded`;
                dlSpeedStat.textContent = 'Done';
                dlEtaStat.textContent   = 'Decrypting...';

                // Transition UI to decrypt phase
                await new Promise(r => setTimeout(r, 300));
                activateStep(stepDecrypt);
                dlPhaseLabel.textContent = 'Decrypting...';
                dlPhaseSub.textContent   = 'Decrypting securely in your browser';
                iconDownload.classList.add('hidden');
                iconDecrypt.classList.remove('hidden');
                setProgress(10);

                // Animate progress from 10→90 while Web Crypto runs
                const animateDecrypt = (() => {
                    let pct = 10;
                    const iv = setInterval(() => {
                        pct = Math.min(90, pct + Math.random() * 8);
                        setProgress(pct);
                    }, 120);
                    return iv;
                })();

                let cryptoKey;
                try {
                    cryptoKey = await importKeyFromBase64(keyHash);
                } catch {
                    clearInterval(animateDecrypt);
                    showNotification('Invalid decryption key in link.');
                    resetAfterError(originalBtnContent);
                    return;
                }

                let decryptedData;
                try {
                    decryptedData = await decryptFile(encryptedBlob, cryptoKey);
                } catch (decryptErr) {
                    clearInterval(animateDecrypt);
                    console.error('Decryption failed:', decryptErr);
                    showNotification('Failed to decrypt. Link might be invalid or corrupted.');
                    resetAfterError(originalBtnContent);
                    return;
                }
                clearInterval(animateDecrypt);

                fileData         = decryptedData.blob;
                originalFileName = decryptedData.metadata.name || 'secure_file_teleshare';
                originalMimeType = decryptedData.metadata.type || 'application/octet-stream';
            }

            // ── Phase 3: Done ──────────────────────────────────────────────
            activateStep(stepDone);
            dlPhaseLabel.textContent = 'Complete!';
            dlPhaseSub.textContent   = 'File decrypted successfully';
            dlBytesStat.textContent  = formatBytes(fileData.size);
            dlSpeedStat.textContent  = '';
            dlEtaStat.textContent    = '';
            setProgress(100);
            await new Promise(r => setTimeout(r, 500));

            // Hide progress, show file-ready state
            decryptingState.classList.add('hidden');
            fileReadyState.classList.remove('hidden');

            dlFileName.textContent = originalFileName;
            dlFileSize.textContent = formatBytes(fileData.size);

            const objUrl = URL.createObjectURL(fileData);
            setupPreview(objUrl, originalMimeType, originalFileName, true);
            triggerDownload(objUrl, originalFileName);

            downloadBtn.disabled = false;
            downloadBtn.innerHTML = originalBtnContent;

            const currentCount = parseInt(dlDownloadCount.textContent) || 0;
            const nextCount = currentCount + 1;
            dlDownloadCount.textContent = nextCount.toString();
            
            // Increment in the database
            if (paramId) {
                fetch(CONFIG.METADATA_API, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: paramId })
                }).catch(err => console.error('Failed to increment download count:', err));
            }

            showNotification('File downloaded and decrypted successfully!');

        } catch (e) {
            console.error('Unexpected error:', e);
            showNotification('An unexpected error occurred.');
            resetAfterError(originalBtnContent);
        }
    }

    function resetAfterError(originalBtnContent) {
        decryptingState.classList.add('hidden');
        fileReadyState.classList.remove('hidden');
        downloadBtn.disabled = false;
        downloadBtn.innerHTML = originalBtnContent;
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
        } else if (directFilePath) {
            startDecryption(directFilePath);
        } else {
            showNotification('Direct download URL not available. Make sure your local Bot API server is running to support large files.');
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
