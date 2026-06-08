require('dotenv').config();

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
            
            // Server-Side Injection of Secrets
            if (targetUrl.includes('api.telegram.org')) {
                const apiBase = process.env.TELEGRAM_API_BASE || 'https://api.telegram.org';
                targetUrl = targetUrl.replace('https://api.telegram.org', apiBase);
                targetUrl = targetUrl.replace('BOT_TOKEN_PLACEHOLDER', process.env.TELEGRAM_BOT_TOKEN);
                targetUrl = targetUrl.replace('CHAT_ID_PLACEHOLDER', process.env.TELEGRAM_CHAT_ID);
            }
        }

        if (!targetUrl || !targetUrl.startsWith('http')) {
            res.status(400).json({ error: 'Invalid target URL. Must start with http.' });
            return resolve();
        }
        
        if (targetUrl.includes('BOT_TOKEN_PLACEHOLDER') || targetUrl.includes('undefined')) {
            // Means it failed to replace properly because process.env was undefined
            res.status(500).json({ 
                error: 'Server Configuration Error: TELEGRAM_BOT_TOKEN is missing. If you are on Vercel, please add it to your Project Settings -> Environment Variables.' 
            });
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
