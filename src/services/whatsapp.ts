import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WASocket,
  proto,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import * as qrcode from 'qrcode-terminal';
import pino from 'pino';
import { resolve } from 'path';
import { mkdirSync, existsSync } from 'fs';

// Logger with configurable output
const logger = pino({
  level: process.env.DEBUG === 'true' ? 'debug' : 'warn'
});

// Auth state directory
const AUTH_DIR = resolve(__dirname, '..', 'auth_info');

// Ensure auth directory exists
if (!existsSync(AUTH_DIR)) {
  mkdirSync(AUTH_DIR, { recursive: true });
}

// Socket instance
let sock: WASocket | null = null;

// Message handlers
const messageHandlers: Array<(message: proto.IWebMessageInfo) => Promise<void>> = [];

// Track connection attempts
let connectionAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

/**
 * Initialize WhatsApp connection using Baileys
 */
async function connectToWhatsApp(): Promise<void> {
  try {
    connectionAttempts++;
    console.log(`🔄 Connection attempt ${connectionAttempts}...`);

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();

    console.log(`📱 Using WA version: ${version.join('.')}`);

    sock = makeWASocket({
      version,
      auth: state,
      logger,
      printQRInTerminal: false,
      browser: ['WhatsApp AI Bot', 'Chrome', '120.0.0'],
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      syncFullHistory: false,
    });

    // Save credentials when updated
    sock.ev.on('creds.update', saveCreds);

    // Handle connection updates
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      // Show QR code
      if (qr) {
        connectionAttempts = 0; // Reset attempts when QR is shown
        console.log('\n📲 Scan this QR code with WhatsApp to connect:\n');
        qrcode.generate(qr, { small: true });
        console.log('\n⏳ Waiting for QR code scan...\n');
      }

      // Handle connection states
      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        console.log(`⚠️ Connection closed. Status: ${statusCode}`);

        if (shouldReconnect && connectionAttempts < MAX_RECONNECT_ATTEMPTS) {
          const delay = Math.min(connectionAttempts * 2000, 10000);
          console.log(`   Reconnecting in ${delay / 1000}s...`);
          setTimeout(() => connectToWhatsApp(), delay);
        } else if (statusCode === DisconnectReason.loggedOut) {
          console.log('❌ Logged out. Please delete auth_info folder and restart.');
        } else {
          console.log(`❌ Max reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached.`);
        }
      } else if (connection === 'open') {
        connectionAttempts = 0;
        console.log('✅ WhatsApp connected successfully!');
        console.log('💬 Ready to receive messages...');
      } else if (connection === 'connecting') {
        console.log('🔄 Connecting to WhatsApp...');
      }
    });

    // Handle incoming messages
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const message of messages) {
        // Ignore status broadcasts
        if (message.key.remoteJid?.includes('status@broadcast')) continue;

        // Call all registered message handlers
        for (const handler of messageHandlers) {
          try {
            await handler(message);
          } catch (error) {
            console.error('❌ Message handler error:', error);
          }
        }
      }
    });

  } catch (error: any) {
    console.error('❌ Connection error:', error.message || error);

    if (connectionAttempts < MAX_RECONNECT_ATTEMPTS) {
      const delay = Math.min(connectionAttempts * 2000, 10000);
      console.log(`   Retrying in ${delay / 1000}s...`);
      setTimeout(() => connectToWhatsApp(), delay);
    }
  }
}

/**
 * Send a text message
 */
async function sendMessage(jid: string, text: string): Promise<boolean> {
  if (!sock) {
    console.error('❌ Socket not connected');
    return false;
  }

  try {
    await sock.sendMessage(jid, { text });
    return true;
  } catch (error: any) {
    console.error('❌ Failed to send message:', error.message || error);
    return false;
  }
}

/**
 * Send typing indicator
 */
async function sendTyping(jid: string): Promise<void> {
  if (!sock) return;
  try {
    await sock.sendPresenceUpdate('composing', jid);
  } catch (error) {
    // Ignore typing errors
  }
}

/**
 * Register a message handler
 */
function onMessage(handler: (message: proto.IWebMessageInfo) => Promise<void>): void {
  messageHandlers.push(handler);
}

/**
 * Get the socket instance
 */
function getSocket(): WASocket | null {
  return sock;
}

/**
 * Extract text from message
 */
function getMessageText(message: proto.IWebMessageInfo): string {
  const msg = message.message;
  if (!msg) return '';

  return (
    msg.conversation ||
    msg.extendedTextMessage?.text ||
    msg.imageMessage?.caption ||
    msg.videoMessage?.caption ||
    ''
  );
}

/**
 * Check if message is from self
 */
function isFromMe(message: proto.IWebMessageInfo): boolean {
  return message.key.fromMe === true;
}

/**
 * Get sender JID
 */
function getSenderJid(message: proto.IWebMessageInfo): string {
  return message.key.remoteJid || '';
}

// Initialize connection
connectToWhatsApp();

export {
  sendMessage,
  sendTyping,
  onMessage,
  getSocket,
  getMessageText,
  isFromMe,
  getSenderJid,
  connectToWhatsApp,
};
