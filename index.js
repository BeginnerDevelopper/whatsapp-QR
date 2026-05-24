// ==========================================================================
// 🛡️ PARCHE DE EMERGENCIA DE DOBLE ACCIÓN PARA RENDER
// Repara @hapi/hoek y whatwg-url (dependencia de MongoDB)
// ==========================================================================
const fs = require('fs');
const path = require('path');

function applyEmergencyPatches() {
    // --- PARCHE 1: @HAPI/HOEK ---
    try {
        const hoekLibPath = path.join(process.cwd(), 'node_modules', '@hapi', 'hoek', 'lib');
        const errorJsPath = path.join(hoekLibPath, 'error.js');
        if (!fs.existsSync(hoekLibPath)) { fs.mkdirSync(hoekLibPath, { recursive: true }); }
        if (!fs.existsSync(errorJsPath)) {
            const content = `'use strict';
const Stringify = require('./stringify');
module.exports = class extends Error {
    constructor(args) {
        const msgs = args.filter((arg) => arg !== '').map((arg) => typeof arg === 'string' ? arg : arg instanceof Error ? arg.message : Stringify(arg));
        super(msgs.join(' ') || 'Unknown error');
        if (typeof Error.captureStackTrace === 'function') { Error.captureStackTrace(this, exports.assert); }
    }
};`;
            console.log('--- 🛠️ PARCHE RENDER: Reparando @hapi/hoek... ---');
            fs.writeFileSync(errorJsPath, content);
        }
    } catch (e) {}

    // --- PARCHE 2: WHATWG-URL (MongoDB Fix) ---
    try {
        const whatwgPath = path.join(process.cwd(), 'node_modules', 'whatwg-url');
        const indexJsPath = path.join(whatwgPath, 'index.js');
        const packageJsonPath = path.join(whatwgPath, 'package.json');

        if (!fs.existsSync(whatwgPath)) { fs.mkdirSync(whatwgPath, { recursive: true }); }

        // Asegurar que el package.json de whatwg-url sea válido
        if (!fs.existsSync(packageJsonPath)) {
            fs.writeFileSync(packageJsonPath, JSON.stringify({ name: "whatwg-url", main: "index.js", version: "11.0.0" }));
        }

        // Asegurar que el index.js de whatwg-url exista (redirección a lib/public-api.js)
        if (!fs.existsSync(indexJsPath)) {
            console.log('--- 🛠️ PARCHE RENDER: Reparando whatwg-url (MongoDB)... ---');
            const content = "module.exports = require('./lib/public-api.js');";
            fs.writeFileSync(indexJsPath, content);
        }
    } catch (e) {}
}

applyEmergencyPatches();


// ==========================================================================
// 🎤 INICIO DEL CÓDIGO PRINCIPAL
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

// Configuración de Variables de Entorno
const WEBHOOK_URL = process.env.WEBHOOK_URL || 'https://agentv1-0-citasconcal-com-premium-version.onrender.com/webhook/whatsapp';
const PORT = process.env.PORT || 3000;
const MONGODB_URL = process.env.MONGODB_URL || process.env.MONGO_URI; // Soporta ambos nombres

let sock; 

// Función para descargar audio
async function downloadAudio(msg) {
    try {
        const mediaBuffer = await downloadMediaMessage(msg, 'buffer', {}, { logger: pino({ level: 'silent' }) });
        return mediaBuffer;
    } catch (error) {
        logger.error(`❌ Error descargando audio: ${error.message}`);
        throw error;
    }
}

// Función para enviar audio a Render
async function sendAudioToRender(audioBuffer, from, audioMessage) {
    try {
        const audioBase64 = audioBuffer.toString('base64');
        const payload = {
            message: '', sender: from, platform: 'whatsapp',
            isVoiceMessage: true, audio: audioBase64,
            audio_mimetype: audioMessage.mimetype || 'audio/ogg'
        };
        const response = await axios.post(WEBHOOK_URL, payload, { timeout: 60000 });
        const agentResponse = response.data.response || 'Sin respuesta del agente';
        await sock.sendMessage(from, { text: agentResponse });
    } catch (error) {
        logger.error(`❌ Error enviando audio: ${error.message}`);
    }
}

// Endpoint para enviar mensajes
app.post('/send-message', async (req, res) => {
    const { number, message, to, isImage } = req.body;
    const phoneNumber = to || number;
    if (!phoneNumber || !message) return res.status(400).json({ error: 'Faltan parámetros' });

    try {
        const jid = phoneNumber.includes('@s.whatsapp.net') ? phoneNumber : `${phoneNumber}@s.whatsapp.net`;
        const urlString = String(message).toLowerCase();

        if (urlString.includes('.mp4') || urlString.includes('video')) {
            await sock.sendMessage(jid, { video: { url: message } });
        } else if (isImage === true || isImage === "true" || urlString.includes('.png') || urlString.includes('.jpg')) {
            await sock.sendMessage(jid, { image: { url: message } });
        } else {
            await sock.sendMessage(jid, { text: message });
        }
        res.json({ status: 'success', to: jid });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Función de conexión principal
async function startWhatsAppBot() {
    if (!MONGODB_URL) {
        console.error("❌ ERROR: No se encontró MONGODB_URL ni MONGO_URI en el entorno.");
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
            console.log('✅ Conexión establecida y persistente en MongoDB.');
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;
        const from = msg.key.remoteJid;
        if (from.includes('@g.us')) return;

        try {
            if (msg.message?.audioMessage) {
                const audioBuffer = await downloadAudio(msg);
                await sendAudioToRender(audioBuffer, from, msg.message.audioMessage);
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
