require('dotenv').config();
const http = require('http');
const https = require('https');
const url = require('url');
const fs = require('fs');
const path = require('path');
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");

const PORT = process.env.PORT || 8081;
const rootDir = path.join(__dirname, '..');

let telegramClient = null;
const apiId = 6;
const apiHash = "eb06d4abfb49dc3eeb1aeb98ae0f581e";

async function getTelegramClient(botToken) {
    if (telegramClient) return telegramClient;
    telegramClient = new TelegramClient(new StringSession(""), apiId, apiHash, {
        connectionRetries: 5,
    });
    await telegramClient.start({ botAuthToken: botToken });
    console.log('GramJS Bot Client Ready');
    return telegramClient;
}

http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const parsedUrl = url.parse(req.url, true);

    // New Direct Stream Endpoint to bypass 20MB limit
    if (parsedUrl.pathname === '/api/stream') {
        const { msg_id, size } = parsedUrl.query;
        if (!msg_id) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'Missing msg_id' }));
            return;
        }

        try {
            const client = await getTelegramClient(process.env.TELEGRAM_BOT_TOKEN);
            const messages = await client.getMessages(process.env.TELEGRAM_CHAT_ID, { ids: [parseInt(msg_id, 10)] });
            
            if (!messages || messages.length === 0 || !messages[0].media) {
                res.writeHead(404);
                res.end(JSON.stringify({ error: 'Message or media not found' }));
                return;
            }

            const media = messages[0].media;
            const fileSize = (size || (media.document ? media.document.size : 0)).toString();

            res.writeHead(200, {
                'Content-Type': 'application/octet-stream',
                'Content-Length': fileSize
            });

            console.log(`[STREAM] Streaming msg_id=${msg_id} (Size: ${fileSize} bytes)`);

            // Iterate over the chunks and stream to the client
            const sender = await client.iterDownload({
                file: media,
                requestSize: 1024 * 1024,
            });

            for await (const chunk of sender) {
                res.write(chunk);
            }
            res.end();
            console.log(`[STREAM] Stream completed for msg_id=${msg_id}`);
        } catch (err) {
            console.error('[STREAM ERROR]', err.message);
            if (!res.headersSent) {
                res.writeHead(500);
                res.end(JSON.stringify({ error: err.message }));
            } else {
                res.end();
            }
        }
        return;
    }

    // Standard Proxy Logic
    if (parsedUrl.pathname === '/api/proxy' || parsedUrl.query.url) {
        let targetUrl = parsedUrl.query.url;
        
        if (targetUrl) {
            targetUrl = targetUrl.replace(/^(https?):\/([^\/])/, '$1://$2');
            
            // Server-Side Injection of Secrets
            if (targetUrl.includes('api.telegram.org')) {
                // The frontend now sends literal strings to be replaced
                const apiBase = process.env.TELEGRAM_API_BASE || 'https://api.telegram.org';
                targetUrl = targetUrl.replace('https://api.telegram.org', apiBase);
                targetUrl = targetUrl.replace('BOT_TOKEN_PLACEHOLDER', process.env.TELEGRAM_BOT_TOKEN);
                targetUrl = targetUrl.replace('CHAT_ID_PLACEHOLDER', process.env.TELEGRAM_CHAT_ID);
            }
        }

        if (!targetUrl || !targetUrl.startsWith('http')) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'Invalid target URL. Must start with http.' }));
            return;
        }

        try {
            console.log(`[${new Date().toISOString()}] ${req.method} → ${targetUrl}`);

            const targetUrlParsed = new URL(targetUrl);
            const protocol = targetUrlParsed.protocol === 'https:' ? https : http;

            const options = {
                hostname: targetUrlParsed.hostname,
                port: targetUrlParsed.port || (targetUrlParsed.protocol === 'https:' ? 443 : 80),
                path: targetUrlParsed.pathname + (targetUrlParsed.search || ''),
                method: req.method,
                headers: {}
            };

            if (req.headers['content-type']) {
                options.headers['Content-Type'] = req.headers['content-type'];
            }
            if (req.headers['content-length']) {
                options.headers['Content-Length'] = req.headers['content-length'];
            }

            const proxyReq = protocol.request(options, (proxyRes) => {
                if (proxyRes.headers['content-type']) {
                    res.setHeader('Content-Type', proxyRes.headers['content-type']);
                }
                if (proxyRes.headers['content-length']) {
                    res.setHeader('Content-Length', proxyRes.headers['content-length']);
                }
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.writeHead(proxyRes.statusCode);

                proxyRes.pipe(res);
            });

            proxyReq.on('error', (err) => {
                console.error('Proxy request error:', err.message);
                if (!res.headersSent) {
                    res.writeHead(500);
                    res.end(JSON.stringify({ error: 'Proxy error: ' + err.message }));
                }
            });

            if (req.method !== 'GET' && req.method !== 'HEAD') {
                req.pipe(proxyReq);
            } else {
                proxyReq.end();
            }
        } catch (err) {
            console.error('Proxy Error:', err.message);
            if (!res.headersSent) {
                res.writeHead(500);
                res.end(JSON.stringify({ error: 'Proxy error: ' + err.message }));
            } else {
                res.end();
            }
        }
        return;
    }

    // Serve Static Files for the Frontend
    let pathname = parsedUrl.pathname;
    if (pathname === '/') pathname = '/index.html';
    
    // Prevent directory traversal
    pathname = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
    const filePath = path.join(rootDir, pathname);

    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            res.writeHead(404);
            res.end('404 Not Found');
            return;
        }
        
        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes = {
            '.html': 'text/html',
            '.js': 'text/javascript',
            '.css': 'text/css',
            '.json': 'application/json',
            '.png': 'image/png',
            '.jpg': 'image/jpg',
            '.svg': 'image/svg+xml'
        };
        
        const contentType = mimeTypes[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        const stream = fs.createReadStream(filePath);
        stream.pipe(res);
        stream.on('error', (streamErr) => {
            if (!res.headersSent) {
                res.writeHead(500);
                res.end('Server Error');
            }
        });
    });

}).listen(PORT, () => {
    console.log(`\n🚀 TeleShare Proxy running on port ${PORT}`);
});

