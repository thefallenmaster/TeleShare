document.addEventListener('DOMContentLoaded', () => {
    const dropzone = document.getElementById('dropzone');
    const fileInput = document.getElementById('file-input');
    const fileDetails = document.getElementById('file-details');
    const fileNameEl = document.getElementById('file-name');
    const fileSizeEl = document.getElementById('file-size');
    const removeFileBtn = document.getElementById('remove-file');
    const uploadBtn = document.getElementById('upload-btn');
    const progressContainer = document.getElementById('upload-progress-container');
    const progressBar = document.getElementById('progress-bar');
    const uploadPercentage = document.getElementById('upload-percentage');
    const uploadSpeedEl = document.getElementById('upload-speed');
    const uploadTimeLeftEl = document.getElementById('upload-time-left');
    const shareContainer = document.getElementById('share-container');
    const shareLinkInput = document.getElementById('share-link');
    const copyBtn = document.getElementById('copy-btn');
    const showQrBtn = document.getElementById('show-qr-btn');
    const qrcodeContainer = document.getElementById('qrcode');
    const emailBtn = document.getElementById('email-btn');
    const uploadAnotherBtn = document.getElementById('upload-another-btn');
    const toggleSettingsBtn = document.getElementById('toggle-settings');
    const settingsPanel = document.getElementById('settings-panel');

    let selectedFile = null;
    let isUploading = false;

    // Drag and Drop Events
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropzone.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    ['dragenter', 'dragover'].forEach(eventName => {
        dropzone.addEventListener(eventName, () => dropzone.classList.add('dragover'), false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropzone.addEventListener(eventName, () => dropzone.classList.remove('dragover'), false);
    });

    dropzone.addEventListener('drop', handleDrop, false);
    fileInput.addEventListener('change', handleFileSelect, false);

    function handleDrop(e) {
        if (isUploading) return;
        const dt = e.dataTransfer;
        const files = dt.files;
        handleFiles(files);
    }

    function handleFileSelect(e) {
        if (isUploading) return;
        const files = e.target.files;
        handleFiles(files);
    }

    function handleFiles(files) {
        if (files.length > 0) {
            selectedFile = files[0];
            
            // Validate file size (2GB limit)
            const MAX_SIZE = 2 * 1024 * 1024 * 1024;
            if (selectedFile.size > MAX_SIZE) {
                showNotification('File is too large. Maximum size is 2GB.');
                selectedFile = null;
                return;
            }

            fileNameEl.textContent = selectedFile.name;
            fileSizeEl.textContent = formatBytes(selectedFile.size);
            
            dropzone.classList.add('hidden');
            fileDetails.classList.remove('hidden');
        }
    }

    removeFileBtn.addEventListener('click', () => {
        if (isUploading) return;
        selectedFile = null;
        fileInput.value = '';
        fileDetails.classList.add('hidden');
        dropzone.classList.remove('hidden');
    });

    toggleSettingsBtn.addEventListener('click', () => {
        settingsPanel.classList.toggle('hidden');
    });

    uploadBtn.addEventListener('click', async () => {
        if (!selectedFile || isUploading) return;
        
        isUploading = true;
        fileDetails.classList.add('hidden');
        progressContainer.classList.remove('hidden');
        
        // Encrypt the file
        let fileToUpload;
        let exportedKey;
        try {
            const uploadStatus = document.getElementById('upload-status');
            uploadStatus.textContent = 'Encrypting file...';
            const key = await generateEncryptionKey();
            exportedKey = await exportKeyToBase64(key);
            fileToUpload = await encryptFile(selectedFile, key);
            uploadStatus.textContent = 'Uploading...';
        } catch (error) {
            showNotification('Encryption failed.');
            resetUpload();
            return;
        }

        const formData = new FormData();
        formData.append('chat_id', CONFIG.TELEGRAM_CHAT_ID);
        formData.append('document', fileToUpload, 'encrypted_file.dat');
        
        const url = `${CONFIG.TELEGRAM_API_BASE}/bot${CONFIG.TELEGRAM_BOT_TOKEN}/sendDocument`;
        
        const xhr = new XMLHttpRequest();
        let startTime = Date.now();
        let lastLoaded = 0;

        xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
                const percentComplete = (e.loaded / e.total) * 100;
                progressBar.style.width = percentComplete + '%';
                uploadPercentage.textContent = Math.round(percentComplete) + '%';

                const currentTime = Date.now();
                const timeDiff = (currentTime - startTime) / 1000; // in seconds
                
                if (timeDiff > 0.5) {
                    const loadedDiff = e.loaded - lastLoaded;
                    const speed = loadedDiff / timeDiff; // bytes per second
                    uploadSpeedEl.textContent = formatBytes(speed) + '/s';
                    
                    const bytesRemaining = e.total - e.loaded;
                    const secondsRemaining = bytesRemaining / speed;
                    uploadTimeLeftEl.textContent = formatTime(secondsRemaining);
                    
                    startTime = currentTime;
                    lastLoaded = e.loaded;
                }
            }
        });

        xhr.addEventListener('load', () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                const res = JSON.parse(xhr.responseText);
                if (res.ok) {
                    // Success
                    const fileId = res.result.document.file_id;
                    const messageId = res.result.message_id;

                    const uploadStatus = document.getElementById('upload-status');
                    if (supabaseClient) {
                        if (uploadStatus) uploadStatus.textContent = 'Saving details to database...';
                        
                        supabaseClient.from('skyshare_files').insert([{
                            telegram_file_id: fileId,
                            telegram_message_id: messageId,
                            file_name: selectedFile.name,
                            file_size: selectedFile.size,
                            mime_type: selectedFile.type
                        }]).select().then(({ data, error }) => {
                            if (error || !data || data.length === 0) {
                                console.error('Supabase save error:', error);
                                generateShareLink(fileId, messageId, exportedKey);
                            } else {
                                generateShareLink(null, null, exportedKey, data[0].id);
                            }
                        }).catch(err => {
                            console.error('Supabase save exception:', err);
                            generateShareLink(fileId, messageId, exportedKey);
                        });
                    } else {
                        generateShareLink(fileId, messageId, exportedKey);
                    }
                } else {
                    handleUploadError(res.description || 'Telegram API Error');
                }
            } else {
                handleUploadError(xhr.responseText || 'Upload failed');
            }
        });

        xhr.addEventListener('error', () => {
            handleUploadError('Network error occurred during upload.');
        });

        // DEMO MOCKUP FALLBACK
        if (CONFIG.TELEGRAM_BOT_TOKEN === 'YOUR_TELEGRAM_BOT_TOKEN') {
            console.warn('Mocking upload because Telegram Bot token is missing.');
            mockUpload(exportedKey);
            return;
        }

        xhr.open('POST', url, true);
        xhr.send(formData);
    });

    function generateShareLink(fileId, messageId, exportedKey, supabaseId = null) {
        const pathParts = window.location.pathname.split('/');
        pathParts.pop();
        const basePath = pathParts.join('/');
        
        let finalUrl;
        if (supabaseId) {
            finalUrl = `${window.location.origin}${basePath}/download.html?id=${supabaseId}#${exportedKey}`;
        } else {
            finalUrl = `${window.location.origin}${basePath}/download.html?msg=${messageId}&id=${fileId}#${exportedKey}`;
        }
        
        shareLinkInput.value = finalUrl;
        emailBtn.href = `mailto:?subject=File shared via SkyShare&body=I've shared a file with you. Download it here: ${finalUrl}`;
        progressContainer.classList.add('hidden');
        shareContainer.classList.remove('hidden');
    }

    function mockUpload(exportedKey) {
        let progress = 0;
        const interval = setInterval(() => {
            progress += Math.random() * 10;
            if (progress >= 100) {
                progress = 100;
                clearInterval(interval);
                
                const mockFileId = 'mock_file_id_' + Math.random().toString(36).substring(2, 10);
                const mockMsgId = Math.floor(Math.random() * 10000);
                
                setTimeout(async () => {
                    if (supabaseClient) {
                        try {
                            const { data, error } = await supabaseClient.from('skyshare_files').insert([{
                                telegram_file_id: mockFileId,
                                telegram_message_id: mockMsgId,
                                file_name: selectedFile.name,
                                file_size: selectedFile.size,
                                mime_type: selectedFile.type
                            }]).select();
                            
                            if (error || !data || data.length === 0) {
                                console.error('Mock Supabase save error:', error);
                                generateShareLink(mockFileId, mockMsgId, exportedKey);
                            } else {
                                generateShareLink(null, null, exportedKey, data[0].id);
                            }
                        } catch (err) {
                            console.error('Mock Supabase exception:', err);
                            generateShareLink(mockFileId, mockMsgId, exportedKey);
                        }
                    } else {
                        generateShareLink(mockFileId, mockMsgId, exportedKey);
                    }
                }, 500);
            }
            progressBar.style.width = progress + '%';
            uploadPercentage.textContent = Math.round(progress) + '%';
            uploadSpeedEl.textContent = formatBytes(1024 * 1024 * (Math.random() * 5 + 1)) + '/s';
            uploadTimeLeftEl.textContent = formatTime((100 - progress) / 10);
        }, 200);
    }

    function handleUploadError(msg) {
        showNotification(msg);
        resetUpload();
    }

    function resetUpload() {
        isUploading = false;
        progressContainer.classList.add('hidden');
        fileDetails.classList.remove('hidden');
        progressBar.style.width = '0%';
        uploadPercentage.textContent = '0%';
        const uploadStatus = document.getElementById('upload-status');
        if (uploadStatus) uploadStatus.textContent = 'Uploading...';
    }

    copyBtn.addEventListener('click', () => {
        copyToClipboard(shareLinkInput.value);
    });

    showQrBtn.addEventListener('click', () => {
        if (qrcodeContainer.classList.contains('hidden')) {
            qrcodeContainer.innerHTML = '';
            new QRCode(qrcodeContainer, {
                text: shareLinkInput.value,
                width: 128,
                height: 128,
                colorDark : "#000000",
                colorLight : "#ffffff",
                correctLevel : QRCode.CorrectLevel.L
            });
            qrcodeContainer.classList.remove('hidden');
        } else {
            qrcodeContainer.classList.add('hidden');
        }
    });

    uploadAnotherBtn.addEventListener('click', () => {
        shareContainer.classList.add('hidden');
        dropzone.classList.remove('hidden');
        qrcodeContainer.classList.add('hidden');
        fileInput.value = '';
        selectedFile = null;
        isUploading = false;
        progressBar.style.width = '0%';
    });
});
