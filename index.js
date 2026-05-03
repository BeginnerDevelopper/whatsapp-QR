// ========================================
// 🎤 INDEX.JS - SOLUCIÓN FINAL PARA BAILEYS 7.0.0-rc.9
// ========================================
const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion,
    Browsers,
    downloadMediaMessage
} = require('@whiskeysockets/baileys');
const qrcodeTerminal = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const pino = require('pino');
const express = require('express');
const { Boom } = require('@hapi/boom');
require('dotenv').config();

// Inicializar Express
const app = express();
app.use(express.json());

// Logger
const logger = pino({ level: 'info' });

// Configuración
const WEBHOOK_URL = process.env.WEBHOOK_URL || 'https://agentv1-0-citasconcal-com-premium-version.onrender.com/webhook/whatsapp';
const AUTH_DIR = path.join(__dirname, 'auth_info_baileys');
const PORT = process.env.PORT || 3000;

// Crear directorio de autenticación si no existe
if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
}

let sock; // Variable global para el socket

// ========================================
// FUNCIÓN PARA DESCARGAR AUDIO
// ========================================
async function downloadAudio(msg) {
    try {
        logger.info("📥 Descargando archivo de audio...");
        const mediaBuffer = await downloadMediaMessage(
            msg,
            'buffer',
            {},
            { logger: pino({ level: 'silent' }) }
        );
        return mediaBuffer;
    } catch (error) {
        logger.error(`❌ Error descargando audio: ${error.message}`);
        throw error;
    }
}

// ========================================
// FUNCIÓN PARA ENVIAR AUDIO A RENDER
// ========================================
async function sendAudioToRender(audioBuffer, from, audioMessage) {
    try {
        logger.info("🌐 Enviando audio a Render para transcripción...");
        const audioBase64 = audioBuffer.toString('base64');
        
        const payload = {
            message: '',
            sender: from,
            platform: 'whatsapp',
            isVoiceMessage: true,
            audio: audioBase64,
            audio_mimetype: audioMessage.mimetype || 'audio/ogg'
        };
        
        const response = await axios.post(WEBHOOK_URL, payload, {
            timeout: 60000,
            headers: { 'Content-Type': 'application/json' }
        });
        
        const agentResponse = response.data.response || 'Sin respuesta del agente';
        await sock.sendMessage(from, { text: agentResponse });
    } catch (error) {
        logger.error(`❌ Error enviando audio a Render: ${error.message}`);
        await sock.sendMessage(from, { 
            text: "🤔 Lo siento, no pude procesar tu mensaje de voz."
        });
    }
}

// ========================================
// ENDPOINT PARA ENVIAR MENSAJES (Para Render/n8n)
// ========================================
// ENDPOINT PARA ENVIAR MENSAJES (Limpio y Dinámico) Ajustado para multimedia) 4-30-26
// ========================================

app.post('/send-message', async (req, res) => {
    const { number, message, to, isImage } = req.body;
    const phoneNumber = to || number;

    if (!phoneNumber || !message) {
        return res.status(400).json({ error: 'Faltan parámetros' });
    }

    try {
        const jid = phoneNumber.includes('@s.whatsapp.net') ? phoneNumber : `${phoneNumber}@s.whatsapp.net`;
        const urlString = String(message).toLowerCase();

        // 1. 🎥 DETECTAR SI ES VIDEO (.mp4)
        if (urlString.includes('.mp4') || urlString.includes('video')) {
            logger.info(`🎥 Enviando VIDEO limpio a ${phoneNumber}...`);
            await sock.sendMessage(jid, { 
                video: { url: message } // Enviamos solo el video, sin caption
            });
        } 
        // 2. 📸 DETECTAR SI ES IMAGEN
        else if (isImage === true || isImage === "true" || urlString.includes('.png') || urlString.includes('.jpg')) {
            logger.info(`📸 Enviando IMAGEN limpia a ${phoneNumber}...`);
            await sock.sendMessage(jid, { 
                image: { url: message } // Enviamos solo la imagen, sin caption
            });
        } 
        // 3. ✉️ TEXTO NORMAL
        else {
            await sock.sendMessage(jid, { text: message });
        }

        res.json({ status: 'success', to: jid });
    } catch (error) {
        logger.error(`❌ Error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});


// ========================================
// FUNCIÓN PRINCIPAL DE CONEXIÓN
// ========================================
async function startWhatsAppBot() {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        auth: state,
        version,
        browser: Browsers.macOS('Chrome'),
        printQRInTerminal: false,
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('📱 Escanea este código QR:');
            qrcodeTerminal.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                console.log('🔄 Reconectando...');
                setTimeout(startWhatsAppBot, 3000);
            }
        } else if (connection === 'open') {
            console.log('✅ Conexión con WhatsApp establecida con éxito.');
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

            const messageBody = msg.message?.conversation || 
                               msg.message?.extendedTextMessage?.text || '';
            
            if (!messageBody) return;

            const payload = { message: messageBody, sender: from, platform: 'whatsapp' };
            const response = await axios.post(WEBHOOK_URL, payload, { timeout: 30000 });
            const agentResponse = response.data.response || 'No entendí tu mensaje.';
            await sock.sendMessage(from, { text: agentResponse });

        } catch (error) {
            logger.error(`❌ Error procesando mensaje: ${error.message}`);
        }
    });
}

// Iniciar Servidor Web
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n=================================================`);
    console.log(`🚀 SERVIDOR WEB BAILEYS INICIADO`);
    console.log(`📡 Puerto: ${PORT}`);
    console.log(`🔗 URL de envío: http://localhost:${PORT}/send-message`);
    console.log(`=================================================\n`);
}).on('error', (err) => {
    console.error('❌ ERROR AL INICIAR EL SERVIDOR WEB:', err.message);
});

// Iniciar Bot
startWhatsAppBot().catch(err => console.error('❌ Error fatal:', err));
