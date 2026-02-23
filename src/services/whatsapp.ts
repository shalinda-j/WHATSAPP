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
import { SecurityService } from './SecurityService';

// Logger
const logger = pino({ level: process.env.DEBUG === 'true' ? 'debug' : 'warn' });

// Global message handlers (shared across sessions for now)
const messageHandlers: Array<
  (
    message: proto.IWebMessageInfo,
    sock: WASocket,
    sessionId: string,
  ) => Promise<void>
> = [];

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
        console.warn(
          '⚠️ No MongoDB URI found. Falling back to file system (Single Session Only).',
        );
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
          const reason = lastDisconnect?.error as any;
          
          // Handle conflict (440) - another device took over
          const isConflict = statusCode === 440 || reason?.reason === 'conflict';
          // Handle logged out
          const isLoggedOut = statusCode === DisconnectReason.loggedOut || reason?.reason === 'logged_out';
          
          console.log(`⚠️ Session ${sessionId} Closed: ${statusCode} (conflict: ${isConflict}, loggedOut: ${isLoggedOut})`);
          await this.updateSessionStatus(sessionId, 'disconnected');

          // For conflict or logged out, clear session and restart with new QR
          if (isConflict || isLoggedOut) {
            console.log(
              `❌ Session ${sessionId}: ${isConflict ? 'Conflict - Another device took over' : 'Logged Out'}. Cleaning up and restarting for new QR...`,
            );

            // Clear credentials and restart
            try {
              await clearState();
            } catch (e) {
              console.error('Error clearing state:', e);
            }
            this.sessions.delete(sessionId);
            this.retryCounters.delete(sessionId);

            // Restart after a short delay
            setTimeout(() => this.startSession(sessionId), 2000);
            return;
          }

          // For other errors, try to reconnect with retry logic
          const retries = (this.retryCounters.get(sessionId) || 0) + 1;
          this.retryCounters.set(sessionId, retries);

          if (retries <= WhatsAppSessionManager.MAX_RETRIES) {
            const delay = Math.min(retries * 2000, 10000);
            console.log(
              `   Reconnecting session ${sessionId} in ${delay}ms... (attempt ${retries})`,
            );
            setTimeout(() => this.startSession(sessionId), delay);
          } else {
            console.error(`❌ Session ${sessionId}: Max retries reached.`);
          }
        } else if (connection === 'open') {
          console.log(`✅ Session ${sessionId} Connected!`);
          this.retryCounters.set(sessionId, 0); // Reset retries
          await this.updateSessionStatus(
            sessionId,
            'connected',
            undefined,
            sock.user?.id,
          );
        } else if (connection === 'connecting') {
          await this.updateSessionStatus(sessionId, 'connecting');
        }
      });

      // Handle Messages
      sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        await Promise.all(
          messages.map(async (msg) => {
            const text = getMessageText(msg);
            // Global Security Middleware
            // If the message is deemed unsafe, we silently drop it or log it.
            if (text && !SecurityService.isSafe(text)) {
              console.warn(
                `🛡️ Blocked unsafe message from ${msg.key.remoteJid
                }: ${text.substring(0, 50)}...`,
              );
              return;
            }

            for (const handler of messageHandlers) {
              try {
                await handler(msg, sock, sessionId);
              } catch (err) {
                console.error('Handler error:', err);
              }
            }
          }),
        );
      });
    } catch (error) {
      console.error(`❌ startSession error (${sessionId}):`, error);
    }
  }

  /**
   * Helper to update database status
   */
  private async updateSessionStatus(
    sessionId: string,
    status: string,
    qr?: string,
    phoneNumber?: string,
  ) {
    try {
      await Session.findOneAndUpdate(
        { sessionId },
        {
          status,
          qr: qr || null,
          phoneNumber: phoneNumber || undefined,
          updatedAt: new Date(),
        },
        { upsert: true },
      );
    } catch (err) {
      console.error('Failed to update session status in DB', err);
    }
  }

  /**
   * Get a specific socket
   */
  getSocket(sessionId = 'default'): WASocket | undefined {
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

  /**
   * Get the count of active sessions
   */
  getActiveSessionsCount(): number {
    return this.sessions.size;
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
export function onMessage(
  handler: (
    message: proto.IWebMessageInfo,
    sock: WASocket,
    sessionId: string,
  ) => Promise<void>,
) {
  messageHandlers.push(handler);
}

// These functions now need a session ID or default to 'default'
export async function sendMessage(
  jid: string,
  text: string,
  sessionId = 'default',
): Promise<boolean> {
  const sock = manager.getSocket(sessionId);
  if (!sock) {
    console.error(`❌ sendMessage failed: Session '${sessionId}' not found or disconnected.`);
    return false;
  }
  console.log(`📤 sending message to ${jid} using session: ${sessionId}`);
  await sock.sendMessage(jid, { text });
  return true;
}

export async function sendTyping(jid: string, sessionId = 'default') {
  const sock = manager.getSocket(sessionId);
  if (sock) await sock.sendPresenceUpdate('composing', jid);
}

export async function downloadWhatsAppAudio(
  message: proto.IWebMessageInfo,
): Promise<Buffer | null> {
  try {
    return (await downloadMediaMessage(message, 'buffer', {})) as Buffer;
  } catch (e) {
    return null;
  }
}

export async function sendVoiceMessage(
  jid: string,
  audioBuffer: Buffer,
  sessionId = 'default',
): Promise<boolean> {
  const sock = manager.getSocket(sessionId);
  if (!sock) return false;
  await sock.sendMessage(jid, {
    audio: audioBuffer,
    mimetype: 'audio/mp4',
    ptt: true,
  });
  return true;
}

export async function sendMediaMessage(
  jid: string,
  mediaBuffer: Buffer,
  type: 'image' | 'video' | 'audio' | 'document',
  options: { caption?: string; mimetype?: string; fileName?: string } = {},
  sessionId = 'default'
): Promise<boolean> {
  const sock = manager.getSocket(sessionId);
  if (!sock) return false;

  const messagePayload: any = {};

  if (type === 'image') {
    messagePayload.image = mediaBuffer;
    messagePayload.caption = options.caption;
  } else if (type === 'video') {
    messagePayload.video = mediaBuffer;
    messagePayload.caption = options.caption;
  } else if (type === 'audio') {
    messagePayload.audio = mediaBuffer;
    messagePayload.mimetype = options.mimetype || 'audio/mp4';
    messagePayload.ptt = false; // Send as audio file, not voice note
  } else if (type === 'document') {
    messagePayload.document = mediaBuffer;
    messagePayload.mimetype = options.mimetype || 'application/pdf';
    messagePayload.fileName = options.fileName || 'file.pdf';
    messagePayload.caption = options.caption;
  }

  await sock.sendMessage(jid, messagePayload);
  return true;
}

export function getSocket(sessionId = 'default'): WASocket | undefined {
  return manager.getSocket(sessionId);
}

// Helpers
export function getMessageText(message: proto.IWebMessageInfo): string {
  const msg = message.message;
  if (!msg) return '';
  return (
    msg.conversation ||
    msg.extendedTextMessage?.text ||
    msg.imageMessage?.caption ||
    ''
  );
}

export function isFromMe(message: proto.IWebMessageInfo): boolean {
  return message.key.fromMe === true;
}

export function getSenderJid(message: proto.IWebMessageInfo): string {
  return message.key.remoteJid || '';
}

export async function getConnectionStatus() {
  const session = await Session.findOne({ sessionId: 'default' });
  return {
    status: session?.status || 'disconnected',
    qr: session?.qr || null,
    activeSessions: manager.getActiveSessionsCount(),
  };
}

export function getActiveSessionCount(): number {
  return manager.getActiveSessionsCount();
}
