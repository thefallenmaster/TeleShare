export const config = {
    api: {
        bodyParser: false,
    },
};

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
    }

    // Extract target URL
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
        return res.status(400).json({ error: 'Invalid target URL. Must start with http.' });
    }

    try {
        const fetchOptions = {
            method: req.method,
            headers: {}
        };

        if (req.headers['content-type']) fetchOptions.headers['Content-Type'] = req.headers['content-type'];
        if (req.headers['content-length']) fetchOptions.headers['Content-Length'] = req.headers['content-length'];

        if (req.method !== 'GET' && req.method !== 'HEAD') {
            fetchOptions.body = req;
            fetchOptions.duplex = 'half';
        }

        const response = await fetch(targetUrl, fetchOptions);

        if (response.headers.get('content-type')) res.setHeader('Content-Type', response.headers.get('content-type'));
        if (response.headers.get('content-length')) res.setHeader('Content-Length', response.headers.get('content-length'));

        res.status(response.status);

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
        if (!res.headersSent) res.status(500).json({ error: 'Proxy error: ' + err.message });
        else res.end();
    }
}
