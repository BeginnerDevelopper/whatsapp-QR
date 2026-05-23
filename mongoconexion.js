import 'dotenv/config'

import express from 'express'

import makeWASocket, {
    useMultiFileAuthState,
    DisconnectReason
} from '@whiskeysockets/baileys'

import { Boom } from '@hapi/boom'

import QRCode from 'qrcode'

const app = express()

async function startSock() {

    const { state, saveCreds } =
        await useMultiFileAuthState('./auth_info_baileys')

    const sock = makeWASocket({
        auth: state
    })

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', async (update) => {

        const {
            connection,
            qr,
            lastDisconnect
        } = update

        if (qr) {

            console.log('QR RECIBIDO')

            QRCode.toString(qr, {
                type: 'terminal',
                small: true
            }, function (err, url) {

                console.log(url)
            })
        }

        if (connection === 'close') {

            const shouldReconnect =
                (lastDisconnect?.error instanceof Boom)
                    ? lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut
                    : true

            console.log('Conexión cerrada')

            if (shouldReconnect) {

                startSock()
            }
        }

        if (connection === 'open') {

            console.log('WhatsApp conectado')
        }
    })
}

startSock()

app.get('/', (req, res) => {

    res.send('WhatsApp Bridge online')
})

app.listen(process.env.PORT || 3000, () => {

    console.log('Servidor iniciado')
})