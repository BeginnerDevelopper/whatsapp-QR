// ========================================
// 🎤 INDEX.JS - SOLUCIÓN FINAL PARA BAILEYS 7.0.0-rc.9
// ========================================
// PROBLEMA: extractMediaContent no existe en Baileys 7.0
// SOLUCIÓN: Usar la API correcta de Baileys para obtener media
// 
// En Baileys 7.0, el media se obtiene directamente del mensaje
// usando la URL y las credenciales incluidas en audioMessage

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const pino = require('pino');
require('dotenv').config();

// Logger
const logger = pino({ level: 'info' });

// Configuración
const WEBHOOK_URL = process.env.WEBHOOK_URL || 'https://agentv1-0-citasconcal-com-premium-version.onrender.com/webhook/whatsapp';
const AUTH_DIR = path.join(__dirname, 'auth_info_baileys');

// Crear directorio de autenticación si no existe
if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
}

// ========================================
// FUNCIÓN PARA DESCARGAR AUDIO DE BAILEYS 7.0 version alternativa version 2.0
// ========================================
// ========================================
// FUNCIÓN MEJORADA: Descargar Audio Decodificado
// ========================================
async function downloadAudio(msg, sock) {
    try {
        logger.info("📥 Descargando archivo de audio...");
        
        const audioMessage = msg.message?.audioMessage;
        
        if (!audioMessage) {
            throw new Error("No hay datos de audio en el mensaje");
        }
        
        // ========================================
        // MÉTODO 1: Usar downloadMediaMessage de Baileys
        // ========================================
        try {
            logger.info("🔐 Intentando usar downloadMediaMessage de Baileys...");
            
            const { downloadMediaMessage } = require('@whiskeysockets/baileys');
            
            const mediaBuffer = await downloadMediaMessage(
                msg,
                'buffer',
                {},
                {
                    logger: pino({ level: 'silent' })
                }
            );
            
            if (mediaBuffer && mediaBuffer.length > 1000) {
                logger.info(`✅ Audio descargado y decodificado: ${mediaBuffer.length} bytes`);
                
                // Validar encabezado
                const header = mediaBuffer.slice(0, 4).toString('hex');
                logger.info(`🏷️ Encabezado: ${header}`);
                
                if (header === '4f676753') {
                    logger.info(`✅ Es un OGG válido (OggS)`);
                    return mediaBuffer;
                } else {
                    logger.warn(`⚠️ No es OGG estándar, pero continuando...`);
                    return mediaBuffer;
                }
            }
        } catch (e) {
            logger.warn(`⚠️ downloadMediaMessage no disponible: ${e.message}`);
        }
        
        // ========================================
        // MÉTODO 2: Descargar manualmente y decodificar
        // ========================================
        logger.info("🔄 Usando método alternativo de descarga...");
        
        const mediaUrl = audioMessage.url;
        if (!mediaUrl) {
            throw new Error("No hay URL de media");
        }
        
        let audioBuffer = null;
        let attempts = 0;
        const maxAttempts = 3;
        
        while (attempts < maxAttempts && !audioBuffer) {
            try {
                attempts++;
                logger.info(`📥 Intento ${attempts}/${maxAttempts}...`);
                
                const response = await axios.get(mediaUrl, {
                    responseType: 'arraybuffer',
                    timeout: 30000,
                    maxContentLength: 50 * 1024 * 1024,
                    headers: {
                        'User-Agent': 'WhatsApp/2.21.24.0'
                    }
                });
                
                audioBuffer = Buffer.from(response.data);
                logger.info(`✅ Audio descargado: ${audioBuffer.length} bytes`);
                
            } catch (error) {
                logger.error(`❌ Intento ${attempts} falló: ${error.message}`);
                if (attempts < maxAttempts) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
        }
        
        if (!audioBuffer || audioBuffer.length === 0) {
            throw new Error("No se pudo descargar el audio");
        }
        
        // ========================================
        // VALIDACIÓN: Verificar que el audio es válido (OGG)
        // ========================================
        const header = audioBuffer.slice(0, 4).toString('hex');
        logger.info(`🏷️ Encabezado del archivo: ${header}`);
        
        // OGG válido comienza con "OggS" (4F 67 67 53)
        if (header !== '4f676753') {
            logger.error(`❌ AUDIO ENCRIPTADO O CORRUPTO (header: ${header})`);
            logger.error(`❌ El audio NO es un OGG válido`);
            logger.error(`❌ Necesita decodificación en Baileys`);
            throw new Error("Audio encriptado, no se puede procesar");
        }
        logger.info(`✅ Encabezado OGG válido`);
        return audioBuffer;
        
    } catch (error) {
        logger.error(`❌ Error descargando audio: ${error.message}`);
        throw error;
    }
}


// ========================================
// FUNCIÓN PARA ENVIAR AUDIO A RENDER nueva version 2.0 
// ========================================
async function sendAudioToRender(audioBuffer, from, sock, audioMessage) {
    try {
        logger.info("🌐 Enviando audio a Render para transcripción...");
        
        // ========================================
        // VALIDACIÓN: Verificar base64
        // ========================================
        const audioBase64 = audioBuffer.toString('base64');
        logger.info(`📊 Tamaño del audio en base64: ${audioBase64.length} caracteres`);
        
        // Validar que la conversión fue correcta
        const decodedSize = Buffer.from(audioBase64, 'base64').length;
        if (decodedSize !== audioBuffer.length) {
            logger.error(`❌ Error en conversión base64: ${audioBuffer.length} → ${decodedSize}`);
            throw new Error("Error en conversión base64");
        }
        logger.info(`✅ Base64 válido (${decodedSize} bytes)`);
        
        // Preparar payload
        const payload = {
            message: '',
            sender: from,
            platform: 'whatsapp',
            isVoiceMessage: true,
            audio: audioBase64,
            audio_mimetype: audioMessage.mimetype || 'audio/ogg' // 👈 CLAVE

        };
        
        // Enviar a Render
        const response = await axios.post(WEBHOOK_URL, payload, {
            timeout: 60000,
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        const agentResponse = response.data.response || 'Sin respuesta del agente';
        logger.info(`✅ Respuesta de Render: ${agentResponse.substring(0, 100)}...`);
        
        // Enviar respuesta al usuario
        await sock.sendMessage(from, { text: agentResponse });
        logger.info(`✅ Respuesta enviada a ${from}`);
        
    } catch (error) {
        logger.error(`❌ Error enviando audio a Render: ${error.message}`);
        
        // Enviar mensaje de error al usuario
        await sock.sendMessage(from, { 
            text: "Lo siento, no pude procesar tu mensaje de voz. Por favor, intenta de nuevo o envía un mensaje de texto."
        });
    }
}


// ========================================
// FUNCIÓN PRINCIPAL DE CONEXIÓN
// ========================================
async function startWhatsAppBot() {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    
    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' })
    });
    
    // Evento: Actualización de conexión (incluye QR)
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            logger.info("📱 Escanea este código QR:");
            QRCode.generate(qr, { small: true });
        }
        
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            logger.error(`❌ Conexión cerrada: ${lastDisconnect?.error?.message}`);
            
            if (shouldReconnect) {
                logger.info("🔄 Reconectando...");
                setTimeout(startWhatsAppBot, 3000);
            }
        } else if (connection === 'open') {
            logger.info("✅ Conexión con WhatsApp establecida con éxito.");
            logger.info(`📱 Versión de Baileys: ${require('@whiskeysockets/baileys/package.json').version}`);
        }
    });
    
    // Evento: Guardar credenciales
    sock.ev.on('creds.update', saveCreds);
    
    // ========================================
    // EVENTO: RECIBIR MENSAJES
    // ========================================
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        
        if (!msg.message) return;
        
        const from = msg.key.remoteJid;
        const isGroup = from.includes('@g.us');
        
        // Ignorar mensajes de grupos y propios
        if (isGroup || msg.key.fromMe) return;
        
        try {
            // ========================================
            // 🎤 DETECTAR MENSAJE DE VOZ
            // ========================================
            if (msg.message?.audioMessage) {
                logger.info(`🎤 Mensaje de voz de ${from}`);
                
                try {
                    // Descargar audio
                    const audioBuffer = await downloadAudio(msg, sock);
                    
                    // Enviar a Render para transcripción
                    await sendAudioToRender(audioBuffer, from, sock, msg.message.audioMessage);
                    
                } catch (audioError) {
                    logger.error(`❌ Error procesando audio: ${audioError.message}`);
                    await sock.sendMessage(from, { 
                        text: "🤔 Im sorry, I didn't catch your message. Could you repeat it again."
                    });
                }
                
                return;
            }
            
            // ========================================
            // 📝 DETECTAR MENSAJE DE TEXTO
            // ========================================
            const messageBody = msg.message?.conversation || 
                               msg.message?.extendedTextMessage?.text || 
                               '';
            
            if (!messageBody) {
                logger.warn(`⚠️ Mensaje sin contenido de ${from}`);
                return;
            }
            
            logger.info(`📨 Mensaje de ${from}: ${messageBody}`);
            
            // Preparar payload para Render
            const payload = {
                message: messageBody,
                sender: from,
                platform: 'whatsapp'
            };
            
            try {
                // Enviar a Render
                logger.info(`🌐 Enviando a Render: ${WEBHOOK_URL}`);
                const response = await axios.post(WEBHOOK_URL, payload, {
                    timeout: 30000,
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });
                
                // Obtener respuesta del agente
                const agentResponse = response.data.response || 'No entendí tu mensaje.';
                logger.info(`🤖 Respuesta del Agente: ${agentResponse.substring(0, 100)}...`);
                
                // Enviar respuesta al usuario
                await sock.sendMessage(from, { text: agentResponse });
                logger.info(`✅ Respuesta enviada a ${from}`);
                
            } catch (error) {
                logger.error(`❌ Error enviando a Render: ${error.message}`);
                await sock.sendMessage(from, { 
                    text: "Lo siento, hubo un error procesando tu solicitud. Por favor, intenta de nuevo."
                });
            }
            
        } catch (error) {
            logger.error(`❌ Error general procesando mensaje: ${error.message}`, error);
        }
    });
    
    return sock;
}

// ========================================
// INICIAR BOT
// ========================================
logger.info("🚀 Iniciando WhatsApp Bot...");
startWhatsAppBot().catch(err => {
    logger.error("❌ Error fatal:", err);
    process.exit(1);
});

// Manejo de señales de terminación
process.on('SIGINT', () => {
    logger.info("👋 Cerrando bot...");
    process.exit(0);
});
