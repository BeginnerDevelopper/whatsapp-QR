// ==========================================================================
// 🚀 PARCHE DE INTERCEPCIÓN TOTAL (SOLUCIÓN DEFINITIVA PARA RENDER)
// ==========================================================================
const Module = require('module');
const originalRequire = Module.prototype.require;

Module.prototype.require = function (id) {
    if (id === './error' && this.filename.includes('@hapi/hoek')) {
        return class extends Error {
            constructor(args) {
                super(Array.isArray(args) ? args.join(' ') : args || 'Unknown error');
            }
        };
    }
    if (id === 'whatwg-url' || id.includes('whatwg-url')) {
        try {
            return originalRequire.apply(this, arguments);
        } catch (e) {
            const { URL, URLSearchParams } = require('url');
            return {
                URL,
                URLSearchParams,
                parseURL: (input) => { try { return new URL(input); } catch(e) { return null; } },
                serializeURL: (url) => url.toString()
            };
        }
    }
    return originalRequire.apply(this, arguments);
};
console.log('--- 🛡️ SISTEMA DE INTERCEPCIÓN ACTIVO ---');

// ==========================================================================
// 🎤 CÓDIGO PRINCIPAL (WhatsApp Bridge)
// ==========================================================================
const { 
    default: makeWASocket, 
    DisconnectReason, 
    fetchLatestBaileysVersion,
    Browsers,
    downloadMediaMessage,
    BufferJSON 
} = require('@whiskeysockets/baileys');
const qrcodeTerminal = require('qrcode-terminal');
const axios = require('axios');
const pino = require('pino');
const express = require('express');
const { MongoClient } = require('mongodb');
const useMongoDBAuthState = require('./mongo_auth'); 
require('dotenv').config();

const app = express();
app.use(express.json());
const logger = pino({ level: 'info' });

const WEBHOOK_URL = process.env.WEBHOOK_URL || 'https://agentv1-0-citasconcal-com-premium-version.onrender.com/webhook/whatsapp';
const PORT = process.env.PORT || 3000;
const MONGODB_URL = process.env.MONGODB_URL || process.env.MONGO_URI;

let sock; 

async function startWhatsAppBot() {
    if (!MONGODB_URL) {
        console.error("❌ ERROR: No se encontró MONGODB_URL ni MONGO_URI.");
        process.exit(1);
    }

    const client = new MongoClient(MONGODB_URL);
    await client.connect();
    const db = client.db('whatsapp_bridge');
    const collection = db.collection('auth_session');

    const { state, saveCreds } = useMongoDBAuthState(collection);
    
    const credsData = await collection.findOne({ _id: 'creds' });
    if (credsData) {
        state.creds = JSON.parse(credsData.data, BufferJSON.reviver);
    }

    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        auth: state,
        version,
        browser: Browsers.macOS('Chrome'),
        printQRInTerminal: false,
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('creds.update', async () => {
        const jsonStr = JSON.stringify(state.creds, BufferJSON.replacer);
        await collection.updateOne({ _id: 'creds' }, { $set: { data: jsonStr } }, { upsert: true });
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log('📱 Escanea este código QR:');
            qrcodeTerminal.generate(qr, { small: true });
        }
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            if (statusCode !== DisconnectReason.loggedOut) {
                console.log('🔄 Reconectando...');
                setTimeout(startWhatsAppBot, 3000);
            }
        } else if (connection === 'open') {
            console.log('✅ Conexión establecida con éxito.');
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;
        const from = msg.key.remoteJid;
        if (from.includes('@g.us')) return;

        try {
            if (msg.message?.audioMessage) {
                const audioBuffer = await downloadMediaMessage(msg, 'buffer', {}, { logger: pino({ level: 'silent' }) });
                const audioBase64 = audioBuffer.toString('base64');
                const payload = {
                    message: '', sender: from, platform: 'whatsapp',
                    isVoiceMessage: true, audio: audioBase64,
                    audio_mimetype: msg.message.audioMessage.mimetype || 'audio/ogg'
                };
                const response = await axios.post(WEBHOOK_URL, payload, { timeout: 60000 });
                const agentResponse = response.data.response || 'Sin respuesta.';
                await sock.sendMessage(from, { text: agentResponse });
                return;
            }
            const messageBody = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
            if (!messageBody) return;
            const payload = { message: messageBody, sender: from, platform: 'whatsapp' };
            const response = await axios.post(WEBHOOK_URL, payload, { timeout: 30000 });
            const agentResponse = response.data.response || 'No entendí tu mensaje.';
            await sock.sendMessage(from, { text: agentResponse });
        } catch (error) {
            logger.error(`❌ Error en mensaje: ${error.message}`);
        }
    });
}

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor en puerto ${PORT}`);
});

startWhatsAppBot().catch(err => console.error('❌ Error fatal:', err));
