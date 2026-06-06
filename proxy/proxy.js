const http = require('http');
const url = require('url');
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");

const PORT = 8081;
const MAX_BODY_BYTES = 55 * 1024 * 1024;

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
    const targetUrl = decodeURIComponent(req.url.substring(1));
    if (!targetUrl.startsWith('http')) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid target URL. Must start with http.' }));
        return;
    }

    try {
        console.log(`[${new Date().toISOString()}] ${req.method} → ${targetUrl}`);

        const fetchOptions = {
            method: req.method,
            headers: {}
        };

        if (req.headers['content-type']) {
            fetchOptions.headers['Content-Type'] = req.headers['content-type'];
        }

        if (req.headers['content-length']) {
            fetchOptions.headers['Content-Length'] = req.headers['content-length'];
        }

        if (req.method !== 'GET' && req.method !== 'HEAD') {
            fetchOptions.body = req;
            fetchOptions.duplex = 'half';
        }

        const response = await fetch(targetUrl, fetchOptions);

        if (response.headers.get('content-type')) {
            res.setHeader('Content-Type', response.headers.get('content-type'));
        }
        if (response.headers.get('content-length')) {
            res.setHeader('Content-Length', response.headers.get('content-length'));
        }

        res.writeHead(response.status);

        if (response.body) {
            const reader = response.body.getReader();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                res.write(value);
            }
        }
        res.end();

        console.log(`  ← ${response.status} OK`);
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
    console.log(`\n🚀 TeleShare Proxy running on http://localhost:${PORT}`);
});
