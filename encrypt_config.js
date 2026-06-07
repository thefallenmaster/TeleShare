const OBFUSCATION_KEY = 'skyshare-secret-key-2026';

function encryptConfigValue(plainText) {
    let encoded = "";
    for (let i = 0; i < plainText.length; i++) {
        encoded += String.fromCharCode(plainText.charCodeAt(i) ^ OBFUSCATION_KEY.charCodeAt(i % OBFUSCATION_KEY.length));
    }
    return Buffer.from(encoded).toString('base64');
}

const input = process.argv[2];
if (!input) {
    console.log("Usage: node encrypt_config.js <YOUR_NEW_TOKEN_OR_CHAT_ID>");
    process.exit(1);
}

console.log("\nEncrypted String:");
console.log(encryptConfigValue(input));
console.log("\nReplace the string in js/script.js with the above string.");
