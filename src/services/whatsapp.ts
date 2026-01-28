import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WASocket,
  proto,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
} from '@whiskeysockets/baileys';
import * as qrcode from 'qrcode-terminal';
import pino from 'pino';
import { resolve } from 'path';
import { mkdirSync, existsSync } from 'fs';
import { connectToMongoDB, useMongoDBAuthState } from './MongoAuthService';

// Logger with configurable output
const logger = pino({
  level: process.env.DEBUG === 'true' ? 'debug' : 'warn'
});

// Auth state directory (fallback)
const AUTH_DIR = resolve(__dirname, '..', 'auth_info');

// Ensure auth directory exists (fallback)
if (!existsSync(AUTH_DIR)) {
  mkdirSync(AUTH_DIR, { recursive: true });
}

// Track connection details
let currentQR: string | null = null;
let connectionStatus: string = 'disconnected';

/**
 * Get current Status
 */
function getConnectionStatus() {
  return { status: connectionStatus, qr: currentQR };
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
    connectionStatus = 'connecting';
    console.log(`🔄 Connection attempt ${connectionAttempts}...`);

    let authState;
    let saveCreds;

    // Use MongoDB if available, otherwise file system
    if (process.env.MONGODB_URI) {
      console.log('📦 Using MongoDB for session storage...');
      await connectToMongoDB(process.env.MONGODB_URI);
      const auth = await useMongoDBAuthState('auth_info');
      authState = auth.state;
      saveCreds = auth.saveCreds;
    } else {
      console.log('📂 Using file system for session storage (WARNING: Ephemeral)...');
      const auth = await useMultiFileAuthState(AUTH_DIR);
      authState = auth.state;
      saveCreds = auth.saveCreds;
    }

    const { version } = await fetchLatestBaileysVersion();

    console.log(`📱 Using WA version: ${version.join('.')}`);

    sock = makeWASocket({
      version,
      auth: authState,
      logger,
      printQRInTerminal: false, // We handle it manually
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

      if (qr) {
        currentQR = qr;
        connectionStatus = 'scan_qr';
        connectionAttempts = 0; // Reset attempts when QR is shown
        console.log('\n📲 Scan this QR code with WhatsApp to connect:\n');
        qrcode.generate(qr, { small: true });
        console.log('\n⏳ Waiting for QR code scan...\n');
      }

      if (connection === 'close') {
        currentQR = null;
        connectionStatus = 'disconnected';
        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        console.log(`⚠️ Connection closed. Status: ${statusCode}`);

        if (shouldReconnect && connectionAttempts < MAX_RECONNECT_ATTEMPTS) {
          connectionStatus = 'reconnecting';
          const delay = Math.min(connectionAttempts * 2000, 10000);
          console.log(`   Reconnecting in ${delay / 1000}s...`);
          setTimeout(() => connectToWhatsApp(), delay);
        } else if (statusCode === DisconnectReason.loggedOut) {
          console.log('❌ Logged out. Please delete auth_info folder and restart.');
        } else {
          console.log(`❌ Max reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached.`);
        }
      } else if (connection === 'open') {
        currentQR = null;
        connectionStatus = 'connected';
        connectionAttempts = 0;
        console.log('✅ WhatsApp connected successfully!');
        console.log('💬 Ready to receive messages...');
      } else if (connection === 'connecting') {
        connectionStatus = 'connecting';
        console.log('🔄 Connecting to WhatsApp...');
      }
    });

    // Handle incoming messages
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;

      // Process all messages in parallel using Promise.all
      // This ensures that one slow message (waiting for AI) doesn't block others
      await Promise.all(messages.map(async (message) => {
        // Ignore status broadcasts
        if (message.key.remoteJid?.includes('status@broadcast')) return;

        // Call all registered message handlers for this message
        // We await handlers here to ensure this specific message is fully processed,
        // but since we are inside Promise.all(map), other messages run in parallel.
        for (const handler of messageHandlers) {
          try {
            await handler(message);
          } catch (error) {
            console.error('❌ Message handler error:', error);
          }
        }
      }));
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
 * Download media from message
 */
async function downloadWhatsAppAudio(message: proto.IWebMessageInfo): Promise<Buffer | null> {
  try {
    const buffer = await downloadMediaMessage(
      message,
      'buffer',
      {}
    );
    return buffer as Buffer;
  } catch (error: any) {
    console.error('❌ Failed to download media:', error.message || error);
    return null;
  }
}

/**
 * Send a voice message
 */
async function sendVoiceMessage(jid: string, audioBuffer: Buffer): Promise<boolean> {
  if (!sock) {
    console.error('❌ Socket not connected');
    return false;
  }

  try {
    await sock.sendMessage(jid, {
      audio: audioBuffer,
      mimetype: 'audio/mp4',
      ptt: true // Send as "Push to Talk" (voice note)
    });
    return true;
  } catch (error: any) {
    console.error('❌ Failed to send voice message:', error.message || error);
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


/**
 * Gracefully disconnect WhatsApp
 */
async function disconnectWhatsApp(): Promise<void> {
  if (sock) {
    try {
      console.log('🔌 Closing WhatsApp connection...');
      sock.end(undefined);
      sock = null;
      connectionStatus = 'disconnected';
    } catch (error) {
      console.error('❌ Error closing socket:', error);
    }
  }
}

export {
  sendMessage,
  sendTyping,
  onMessage,
  getSocket,
  getMessageText,
  isFromMe,
  getSenderJid,
  connectToWhatsApp,
  disconnectWhatsApp,
  downloadWhatsAppAudio,
  sendVoiceMessage,
  getConnectionStatus,
};

