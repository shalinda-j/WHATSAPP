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
import Session from '../models/Session';

// Logger
const logger = pino({ level: process.env.DEBUG === 'true' ? 'debug' : 'warn' });

// Global message handlers (shared across sessions for now)
const messageHandlers: Array<(message: proto.IWebMessageInfo, sock: WASocket) => Promise<void>> = [];

export class WhatsAppSessionManager {
  private sessions: Map<string, WASocket> = new Map();
  private retryCounters: Map<string, number> = new Map();
  private static MAX_RETRIES = 5;

  constructor() {
    // Ensure auth dir exists for file-based fallback
    const AUTH_DIR = resolve(__dirname, '..', 'auth_info');
    if (!existsSync(AUTH_DIR)) mkdirSync(AUTH_DIR, { recursive: true });
  }

  /**
   * Start a specific session
   */
  async startSession(sessionId: string) {
    try {
      console.log(`🔄 Starting session: ${sessionId}`);

      let authState;
      let saveCreds;
      let clearState;

      // Database vs File System Auth
      if (process.env.MONGODB_URI) {
        // Ensure connection is established (idempotent)
        await connectToMongoDB(process.env.MONGODB_URI);
        const auth = await useMongoDBAuthState(sessionId);
        authState = auth.state;
        saveCreds = auth.saveCreds;
        clearState = auth.clearState; // Custom method we added
      } else {
        console.warn('⚠️ No MongoDB URI found. Falling back to file system (Single Session Only).');
        const AUTH_DIR = resolve(__dirname, '..', 'auth_info');
        const auth = await useMultiFileAuthState(AUTH_DIR);
        authState = auth.state;
        saveCreds = auth.saveCreds;
        clearState = async () => { }; // No-op for file system
      }

      const { version } = await fetchLatestBaileysVersion();

      const sock = makeWASocket({
        version,
        auth: authState,
        logger,
        printQRInTerminal: false, // We update DB instead
        browser: ['WhatsApp AI Bot', 'Chrome', '120.0.0'],
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        syncFullHistory: false,
      });

      this.sessions.set(sessionId, sock);

      // Save credentials
      sock.ev.on('creds.update', saveCreds);

      // Handle Connection Updates
      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        // Update Session Status in DB
        if (qr) {
          await this.updateSessionStatus(sessionId, 'scan_qr', qr);
          console.log(`📲 Session ${sessionId}: Scan QR Code`);
          // Optional: Print to terminal for default session
          if (sessionId === 'default') qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
          const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

          console.log(`⚠️ Session ${sessionId} Closed: ${statusCode}`);
          await this.updateSessionStatus(sessionId, 'disconnected');

          if (shouldReconnect) {
            const retries = (this.retryCounters.get(sessionId) || 0) + 1;
            this.retryCounters.set(sessionId, retries);

            if (retries <= WhatsAppSessionManager.MAX_RETRIES) {
              const delay = Math.min(retries * 2000, 10000);
              console.log(`   Reconnecting session ${sessionId} in ${delay}ms...`);
              setTimeout(() => this.startSession(sessionId), delay);
            } else {
              console.error(`❌ Session ${sessionId}: Max retries reached.`);
            }
          } else if (statusCode === DisconnectReason.loggedOut) {
            console.log(`❌ Session ${sessionId} Logged Out. Cleaning up and restarting for new QR...`);

            // CRITICAL: Immediate QR Generation Logic
            await clearState(); // Delete creds from DB
            this.sessions.delete(sessionId);
            this.retryCounters.delete(sessionId);

            // Restart immediately as a fresh session
            setTimeout(() => this.startSession(sessionId), 1000);
          }
        } else if (connection === 'open') {
          console.log(`✅ Session ${sessionId} Connected!`);
          this.retryCounters.set(sessionId, 0); // Reset retries
          await this.updateSessionStatus(sessionId, 'connected', undefined, sock.user?.id);
        } else if (connection === 'connecting') {
          await this.updateSessionStatus(sessionId, 'connecting');
        }
      });

      // Handle Messages
      sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        await Promise.all(messages.map(async (msg) => {
          for (const handler of messageHandlers) {
            try {
              await handler(msg, sock);
            } catch (err) {
              console.error('Handler error:', err);
            }
          }
        }));
      });

    } catch (error) {
      console.error(`❌ startSession error (${sessionId}):`, error);
    }
  }

  /**
   * Helper to update database status
   */
  private async updateSessionStatus(sessionId: string, status: string, qr?: string, phoneNumber?: string) {
    try {
      await Session.findOneAndUpdate(
        { sessionId },
        {
          status,
          qr: qr || null,
          phoneNumber: phoneNumber || undefined,
          updatedAt: new Date()
        },
        { upsert: true }
      );
    } catch (err) {
      console.error('Failed to update session status in DB', err);
    }
  }

  /**
   * Get a specific socket
   */
  getSocket(sessionId: string = 'default'): WASocket | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Disconnect and remove a session
   */
  async deleteSession(sessionId: string) {
    const sock = this.sessions.get(sessionId);
    if (sock) {
      sock.end(undefined);
      this.sessions.delete(sessionId);
    }
    await Session.deleteOne({ sessionId });
    // Clean up auth data would require exposing clearState publicly or handling it here
    // For now, the loop handles it on 'loggedOut', but manual delete might need it too.
  }

  // Legacy support methods (migrating old single-file functions to use 'default' session)
  static instance = new WhatsAppSessionManager();
}

// --- Legacy Adapters for Existing Code (index.ts) ---
const manager = WhatsAppSessionManager.instance;

export async function connectToWhatsApp() {
  return manager.startSession('default');
}

export async function disconnectWhatsApp() {
  return manager.deleteSession('default');
}

// Forward compatible message registry
export function onMessage(handler: (message: proto.IWebMessageInfo, sock: WASocket) => Promise<void>) {
  messageHandlers.push(handler);
}

// These functions now need a session ID or default to 'default'
export async function sendMessage(jid: string, text: string, sessionId: string = 'default'): Promise<boolean> {
  const sock = manager.getSocket(sessionId);
  if (!sock) return false;
  await sock.sendMessage(jid, { text });
  return true;
}

export async function sendTyping(jid: string, sessionId: string = 'default') {
  const sock = manager.getSocket(sessionId);
  if (sock) await sock.sendPresenceUpdate('composing', jid);
}

export async function downloadWhatsAppAudio(message: proto.IWebMessageInfo): Promise<Buffer | null> {
  try {
    return (await downloadMediaMessage(message, 'buffer', {})) as Buffer;
  } catch (e) { return null; }
}

export async function sendVoiceMessage(jid: string, audioBuffer: Buffer, sessionId: string = 'default'): Promise<boolean> {
  const sock = manager.getSocket(sessionId);
  if (!sock) return false;
  await sock.sendMessage(jid, { audio: audioBuffer, mimetype: 'audio/mp4', ptt: true });
  return true;
}

export function getSocket(sessionId: string = 'default') {
  return manager.getSocket(sessionId);
}

// Helpers
export function getMessageText(message: proto.IWebMessageInfo): string {
  const msg = message.message;
  if (!msg) return '';
  return msg.conversation || msg.extendedTextMessage?.text || msg.imageMessage?.caption || '';
}

export function isFromMe(message: proto.IWebMessageInfo): boolean {
  return message.key.fromMe === true;
}

export function getSenderJid(message: proto.IWebMessageInfo): string {
  return message.key.remoteJid || '';
}

export function getConnectionStatus() {
  // For legacy single-session polling
  // In real multi-session app, use DB or API
  return { status: 'managed-by-db', qr: null };
}

