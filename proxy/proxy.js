const http = require('http');

const PORT = 8081;

// Maximum body size: 55 MB (slightly above Telegram's 50 MB bot API limit)
const MAX_BODY_BYTES = 55 * 1024 * 1024;

http.createServer(async (req, res) => {
    // CORS headers – allow all origins (local use only)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    // Parse destination URL from request path
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

        // Forward the Content-Type header (critical for multipart/form-data boundary)
        if (req.headers['content-type']) {
            fetchOptions.headers['Content-Type'] = req.headers['content-type'];
        }

        // Forward the Content-Length header from the browser (critical for Nginx/Telegram)
        if (req.headers['content-length']) {
            fetchOptions.headers['Content-Length'] = req.headers['content-length'];
        }

        // Forward body as stream for non-GET/HEAD requests
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            fetchOptions.body = req;
            fetchOptions.duplex = 'half';
            console.log(`  Streaming upload: ${req.headers['content-length'] ? (parseInt(req.headers['content-length'], 10) / 1024 / 1024).toFixed(2) + ' MB' : 'Unknown size'}`);
        }

        // Forward to Telegram (no timeout — large uploads can take minutes)
        const response = await fetch(targetUrl, fetchOptions);

        // Copy response headers
        if (response.headers.get('content-type')) {
            res.setHeader('Content-Type', response.headers.get('content-type'));
        }
        if (response.headers.get('content-length')) {
            res.setHeader('Content-Length', response.headers.get('content-length'));
        }

        res.writeHead(response.status);

        // Stream response body back to browser
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
    console.log(`\n🚀 TeleShare CORS Proxy running on http://localhost:${PORT}`);
    console.log(`   Max upload size: ${MAX_BODY_BYTES / 1024 / 1024} MB\n`);
});
