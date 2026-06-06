const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");

export const config = {
    maxDuration: 300, // 5 minutes max execution time to allow large 1GB+ file streams
};

let telegramClient = null;
const apiId = 6;
const apiHash = "eb06d4abfb49dc3eeb1aeb98ae0f581e";

async function getTelegramClient(botToken) {
    if (telegramClient) return telegramClient;
    telegramClient = new TelegramClient(new StringSession(""), apiId, apiHash, {
        connectionRetries: 5,
    });
    await telegramClient.start({ botAuthToken: botToken });
    return telegramClient;
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

    if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
    }

    const { msg_id, chat_id, bot_token } = req.query;
    if (!msg_id || !chat_id || !bot_token) {
        return res.status(400).json({ error: 'Missing msg_id, chat_id, or bot_token' });
    }

    try {
        const client = await getTelegramClient(bot_token);
        const messages = await client.getMessages(chat_id, { ids: [parseInt(msg_id, 10)] });
        
        if (!messages || messages.length === 0 || !messages[0].media) {
            return res.status(404).json({ error: 'Message or media not found' });
        }

        const media = messages[0].media;
        const fileSize = media.document ? media.document.size : 0;

        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Length', fileSize);

        const sender = await client.iterDownload({
            file: media,
            requestSize: 1024 * 1024,
        });

        for await (const chunk of sender) {
            res.write(chunk);
        }
        res.end();
    } catch (err) {
        if (!res.headersSent) {
            res.status(500).json({ error: err.message });
        } else {
            res.end();
        }
    }
}
