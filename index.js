import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys'
import express from 'express'
import pino from 'pino'
import qrcode from 'qrcode'

const app = express()
app.use(express.json())

let sock = null
let isConnected = false
let currentQR = null

function toJid(phone) {
  const digits = phone.replace(/\D/g, '')
  const intl = digits.startsWith('0') ? '972' + digits.slice(1) : digits
  return intl + '@s.whatsapp.net'
}

async function connect() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info')
  const { version } = await fetchLatestBaileysVersion()

  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      currentQR = qr
      console.log('📱 QR ready — open /qr in browser to scan')
    }
    if (connection === 'open') {
      isConnected = true
      currentQR = null
      console.log('✅ WhatsApp connected!')
    }
    if (connection === 'close') {
      isConnected = false
      const code = lastDisconnect?.error?.output?.statusCode
      if (code !== DisconnectReason.loggedOut) {
        connect()
      } else {
        console.log('🔒 Logged out — open /qr to reconnect')
      }
    }
  })
}

connect()

app.get('/qr', async (req, res) => {
  if (isConnected) {
    return res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#111;color:#fff">
      <h2>✅ WhatsApp מחובר!</h2>
      <p>אין צורך לסרוק שוב.</p>
    </body></html>`)
  }
  if (!currentQR) {
    return res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#111;color:#fff">
      <h2>⏳ ממתין ל-QR...</h2>
      <p>רענן את הדף בעוד כמה שניות</p>
      <script>setTimeout(()=>location.reload(), 3000)</script>
    </body></html>`)
  }
  const imgData = await qrcode.toDataURL(currentQR)
  res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:40px;background:#fff">
    <h2>📱 סרוק עם WhatsApp</h2>
    <p>WhatsApp ← הגדרות ← מכשירים מקושרים ← קשר מכשיר</p>
    <img src="${imgData}" style="width:280px;height:280px" />
    <p style="color:#888;font-size:13px">הדף יתרענן אוטומטית</p>
    <script>setTimeout(()=>location.reload(), 30000)</script>
  </body></html>`)
})

app.get('/health', (_req, res) => res.json({ connected: isConnected }))

app.post('/send', async (req, res) => {
  const { phone, message } = req.body
  if (!phone || !message) return res.status(400).json({ error: 'missing phone or message' })
  if (!isConnected) return res.status(503).json({ error: 'WhatsApp not connected' })
  try {
    await sock.sendMessage(toJid(phone), { text: message })
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`🚀 Running on port ${PORT}`))
