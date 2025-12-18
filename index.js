const {
    default: makeWASocket,
    DisconnectReason,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    isJidBroadcast,
    makeCacheableSignalKeyStore
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const { Boom } = require('@hapi/boom');
const fs = require('fs');
const fetch = require('node-fetch');

// ⚠️ REEMPLAZAR CON LA URL DE SU AGENTE EN RENDER ⚠️
const RENDER_WEBHOOK_URL = 'https://agentv1-0-citasconcal-com-premium-version.onrender.com/webhook/whatsapp'; 

// Función principal para conectar con WhatsApp
async function connectWhatsApp() {
    // Usar un logger pino para mejor manejo de logs
    const logger = pino({ level: 'silent' });
    
    // Cargar el estado de autenticación (sesión)
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    // Obtener la última versión de Baileys
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`Usando Baileys versión: ${version.join('.')}`);

    // Crear la instancia del socket de WhatsApp
    const sock = makeWASocket({
        version,
        logger,
        // ✅ REMOVIDO: printQRInTerminal (deprecado)
        // Ahora manejamos el QR manualmente en connection.update
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        browser: ['Whatsapp Bridge', 'Chrome', '1.0.0'], // Identificador del navegador
        getMessage: async (key) => {
            // Función para obtener mensajes anteriores (opcional)
            return { conversation: 'Mensaje anterior' };
        }
    });

    // Guardar credenciales de sesión cada vez que se actualizan
    sock.ev.on('creds.update', saveCreds);

    // Manejar eventos de conexión
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        // ✅ NUEVO: Manejar el QR manualmente
        if (qr) {
            console.log('\n📱 Escanea este código QR con tu teléfono:\n');
            qrcode.generate(qr, { small: true });
            console.log('\n');
        }
        
        if (connection === 'close') {
            let reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
            if (reason === DisconnectReason.badSession) {
                console.log(`❌ Sesión incorrecta. Por favor, elimine la carpeta 'auth_info_baileys' y escanee el QR de nuevo.`);
                process.exit(1);
            } else if (reason === DisconnectReason.connectionClosed) {
                console.log("⚠️ Conexión cerrada, reconectando...");
                connectWhatsApp();
            } else if (reason === DisconnectReason.connectionLost) {
                console.log("⚠️ Conexión perdida, reconectando...");
                connectWhatsApp();
            } else if (reason === DisconnectReason.loggedOut) {
                console.log(`❌ Dispositivo desconectado. Por favor, elimine la carpeta 'auth_info_baileys' y escanee el QR de nuevo.`);
                process.exit(1);
            } else if (reason === DisconnectReason.restartRequired) {
                console.log("🔄 Reinicio requerido, reconectando...");
                connectWhatsApp();
            } else if (reason === DisconnectReason.timedOut) {
                console.log("⏱️ Tiempo de espera agotado, reconectando...");
                connectWhatsApp();
            } else {
                console.log(`❓ Razón de desconexión desconocida: ${reason}. Reconectando...`);
                connectWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('✅ Conexión con WhatsApp establecida con éxito.');
        }
    });

    // Manejar mensajes entrantes
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        
        // Ignorar mensajes de estado, broadcast o del propio bot
        if (!msg.message || isJidBroadcast(msg.key.remoteJid) || msg.key.fromMe) return;

        // Extraer el texto del mensaje
        let messageText = msg.message.conversation || 
                         msg.message.extendedTextMessage?.text || 
                         msg.message.imageMessage?.caption || 
                         msg.message.videoMessage?.caption || '';
        
        // Si el mensaje es de voz, puede que necesite un paso adicional de transcripción
        if (msg.message.audioMessage) {
            messageText = "Mensaje de voz recibido. Por favor, envíe un mensaje de texto."; // Simplificación
            // ⚠️ Nota: La transcripción de voz requiere librerías adicionales (ej: Whisper API)
        }

        // Si no hay texto, ignorar
        if (!messageText) return;

        const senderJid = msg.key.remoteJid;
        console.log(`\n📨 Mensaje de ${senderJid}: ${messageText}`);

        try {
            // 1. Enviar el mensaje al webhook de Render
            console.log(`🌐 Enviando a Render: ${RENDER_WEBHOOK_URL}`);
            const response = await fetch(RENDER_WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: messageText,
                    sender: senderJid,
                    platform: 'whatsapp' // Identificador de plataforma
                })
            });

            // 2. Recibir la respuesta del agente de IA
            if (!response.ok) {
                throw new Error(`Error HTTP: ${response.status} - ${response.statusText}`);
            }
            
            const result = await response.json();
            const agentResponseText = result.response || "Lo siento, no pude obtener una respuesta de mi agente de IA.";

            console.log(`🤖 Respuesta del Agente: ${agentResponseText}`);

            // 3. Enviar la respuesta de vuelta a WhatsApp
            await sock.sendMessage(senderJid, { text: agentResponseText });
            console.log(`✅ Respuesta enviada a ${senderJid}\n`);

        } catch (error) {
            console.error(`❌ Error en el flujo de mensaje: ${error.message}`);
            // Enviar un mensaje de error al usuario
            await sock.sendMessage(senderJid, { text: "Lo siento, hubo un error al procesar tu solicitud. Por favor, inténtalo de nuevo más tarde." });
        }
    });
}

// Iniciar la conexión
connectWhatsApp().catch(err => {
    console.error('❌ Error al conectar:', err);
    process.exit(1);
});
