export const config = {
    api: {
        bodyParser: false,
    },
};

export default function handler(req, res) {
    return new Promise((resolve) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', '*');

        if (req.method === 'OPTIONS') {
            res.status(204).end();
            return resolve();
        }

        const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        let targetUrl = parsedUrl.searchParams.get('url');
        
        if (!targetUrl) {
            const cleanPath = req.url.replace(/^\/api\/proxy\/?/, '').replace(/^\//, '');
            targetUrl = decodeURIComponent(cleanPath);
        }
        
        if (targetUrl) {
            targetUrl = targetUrl.replace(/^(https?):\/([^\/])/, '$1://$2');
        }

        if (!targetUrl || !targetUrl.startsWith('http')) {
            res.status(400).json({ error: 'Invalid target URL. Must start with http.' });
            return resolve();
        }

        const targetUrlParsed = new URL(targetUrl);
        const protocol = targetUrlParsed.protocol === 'https:' ? require('https') : require('http');

        const options = {
            hostname: targetUrlParsed.hostname,
            port: targetUrlParsed.port || (targetUrlParsed.protocol === 'https:' ? 443 : 80),
            path: targetUrlParsed.pathname + targetUrlParsed.search,
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
            res.status(proxyRes.statusCode);

            proxyRes.pipe(res);
            proxyRes.on('end', resolve);
        });

        proxyReq.on('error', (err) => {
            if (!res.headersSent) {
                res.status(500).json({ error: 'Proxy error: ' + err.message });
            }
            resolve();
        });

        if (req.method !== 'GET' && req.method !== 'HEAD') {
            req.pipe(proxyReq);
        } else {
            proxyReq.end();
        }
    });
}
