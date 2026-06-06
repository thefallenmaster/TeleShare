const http = require('http');

const PORT = 8081;

http.createServer(async (req, res) => {
    // Add CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    // Extract destination URL from path and decode URL-encoded components
    const targetUrl = decodeURIComponent(req.url.substring(1));
    if (!targetUrl.startsWith('http')) {
        res.writeHead(400);
        res.end('Invalid target URL');
        return;
    }

    try {
        console.log(`Proxying request [${req.method}] to: ${targetUrl}`);
        
        const fetchOptions = {
            method: req.method,
            headers: {}
        };

        // Forward content-type header
        if (req.headers['content-type']) {
            fetchOptions.headers['Content-Type'] = req.headers['content-type'];
        }

        // Forward body for non-GET requests
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            fetchOptions.body = req;
            fetchOptions.duplex = 'half';
        }

        // Fetch target URL
        const response = await fetch(targetUrl, fetchOptions);

        // Copy response headers
        if (response.headers.get('content-type')) {
            res.setHeader('Content-Type', response.headers.get('content-type'));
        }
        if (response.headers.get('content-length')) {
            res.setHeader('Content-Length', response.headers.get('content-length'));
        }
        
        // Return status
        res.writeHead(response.status);

        // Pipe body if present
        if (response.body) {
            const reader = response.body.getReader();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                res.write(value);
            }
        }
        res.end();
    } catch (err) {
        console.error('Proxy Error:', err);
        if (!res.headersSent) {
            res.writeHead(500);
            res.end('Proxy error: ' + err.message);
        } else {
            res.end();
        }
    }
}).listen(PORT, () => {
    console.log(`Local CORS proxy running on http://localhost:${PORT}`);
});
