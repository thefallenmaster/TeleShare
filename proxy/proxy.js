const http = require('http');
const https = require('https');
const url = require('url');
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");

const PORT = process.env.PORT || 8081;

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
        const { msg_id, chat_id, bot_token, size } = parsedUrl.query;
        if (!msg_id || !chat_id || !bot_token) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'Missing msg_id, chat_id, or bot_token' }));
            return;
        }

        try {
            const client = await getTelegramClient(bot_token);
            const messages = await client.getMessages(chat_id, { ids: [parseInt(msg_id, 10)] });
            
            if (!messages || messages.length === 0 || !messages[0].media) {
                res.writeHead(404);
                res.end(JSON.stringify({ error: 'Message or media not found' }));
                return;
            }

            const media = messages[0].media;
            const fileSize = size || (media.document ? media.document.size : 0);

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
    let targetUrl = parsedUrl.query.url;
    if (!targetUrl) {
        const cleanPath = req.url.replace(/^\//, '');
        targetUrl = decodeURIComponent(cleanPath);
    }
    if (targetUrl) {
        targetUrl = targetUrl.replace(/^(https?):\/([^\/])/, '$1://$2');
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
}).listen(PORT, () => {
    console.log(`\n🚀 TeleShare Proxy running on port ${PORT}`);
});

