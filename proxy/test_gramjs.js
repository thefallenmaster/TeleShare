const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");

const apiId = 6;
const apiHash = "eb06d4abfb49dc3eeb1aeb98ae0f581e";
const botToken = "8696168616:AAEFe0U1D9WF7gqtBrTdypTBBRBYvebeKag";

const chatId = "-1002227237895"; // Example from the CONFIG (Wait, what is the chat ID in js/script.js? Let's use the one decrypted)
// Let me just import it or mock it. Wait, I'll pass it as arguments or get it from script.js.
// Let's read CONFIG.TELEGRAM_CHAT_ID from script.js decryption

(async () => {
    // Decrypt config
    const OBFUSCATION_KEY = 'skyshare-secret-key-2026';
    function decryptConfigValue(encodedText) {
        const raw = Buffer.from(encodedText, 'base64').toString('binary');
        let decoded = "";
        for (let i = 0; i < raw.length; i++) {
            decoded += String.fromCharCode(raw.charCodeAt(i) ^ OBFUSCATION_KEY.charCodeAt(i % OBFUSCATION_KEY.length));
        }
        return decoded;
    }
    const realChatId = decryptConfigValue('Mx8cABwTGBdHAwIB'); // TELEGRAM_CHAT_ID

    const client = new TelegramClient(new StringSession(""), apiId, apiHash, {
        connectionRetries: 5,
    });
    
    await client.start({
        botAuthToken: botToken,
    });
    console.log("GramJS Bot Logged In!");

    try {
        const msgId = 330; // from the URL ?msg=330
        console.log(`Fetching message ${msgId} from chat ${realChatId}...`);
        const messages = await client.getMessages(realChatId, { ids: [msgId] });
        
        if (messages.length > 0 && messages[0].media) {
            console.log("Message found! Media:", messages[0].media.className);
            const buffer = await client.downloadMedia(messages[0].media, { workers: 1 });
            console.log("Download successful! Buffer size:", buffer.length);
        } else {
            console.log("Message or media not found.");
        }
    } catch (e) {
        console.error("Error fetching message:", e.message);
    }
    
    process.exit(0);
})();
