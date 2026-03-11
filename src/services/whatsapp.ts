import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WASocket,
  proto,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
} from '@whiskeysockets/baileys';
import { callAssistant } from './CallAssistantService';
import * as qrcode from 'qrcode-terminal';
import pino from 'pino';
import { resolve } from 'path';
import { mkdirSync, existsSync } from 'fs';
import { connectToMongoDB, useMongoDBAuthState } from './MongoAuthService';
import Session from '../models/Session';
import { SecurityService } from './SecurityService';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { tmpdir } from 'os';
import { join } from 'path';
import { promises as fsPromises } from 'fs';
import { randomBytes } from 'crypto';

// Set FFmpeg path
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

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
  private connectionStates: Map<string, 'connecting' | 'connected' | 'disconnected'> = new Map();
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
    // Prevent duplicate initializations
    if (this.connectionStates.get(sessionId) === 'connecting' || this.connectionStates.get(sessionId) === 'connected') {
      console.log(`ℹ️ Session ${sessionId} is already ${this.connectionStates.get(sessionId)}. Skipping start.`);
      return;
    }

    try {
      console.log(`🔄 Starting session: ${sessionId}`);
      this.connectionStates.set(sessionId, 'connecting');

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
        browser: ['Jayalath Global AI', 'Chrome', '120.0.0'],
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
          // Handle logged out (401)
          const isLoggedOut = statusCode === DisconnectReason.loggedOut || reason?.reason === 'logged_out' || statusCode === 401;

          console.log(`⚠️ Session ${sessionId} Closed: ${statusCode} (conflict: ${isConflict}, loggedOut: ${isLoggedOut})`);
          this.connectionStates.set(sessionId, 'disconnected');
          await this.updateSessionStatus(sessionId, 'disconnected');

          // For logged out, clear session and restart for new QR
          if (isLoggedOut) {
            console.log(`❌ Session ${sessionId}: Logged Out. Cleaning up and restarting for new QR...`);

            try {
              await clearState();
            } catch (e) {
              console.error('Error clearing state:', e);
            }
            this.sessions.delete(sessionId);
            this.retryCounters.delete(sessionId);
            this.connectionStates.delete(sessionId);

            setTimeout(() => this.startSession(sessionId), 2000);
            return;
          }

          // For conflict, try to reconnect with exponential backoff without wiping state
          // A 440 conflict means another instance is running with the same credentials.
          // In deployment environments (like Digital Ocean), rolling deployments cause two instances
          // to run concurrently for a short period, leading to this error. Wiping state here causes forced logouts.
          if (isConflict) {
            const retries = (this.retryCounters.get(sessionId) || 0) + 1;
            this.retryCounters.set(sessionId, retries);

            // Wait longer for each retry (5s, 10s, 20s, up to 1 minute) to allow the old instance to shut down
            const delay = Math.min(5000 * Math.pow(2, retries - 1), 60000);

            console.log(`🔄 Session ${sessionId}: Conflict detected. Another instance is likely running. Retrying in ${delay / 1000}s... (Attempt ${retries})`);

            this.sessions.delete(sessionId);
            this.connectionStates.delete(sessionId);
            setTimeout(() => this.startSession(sessionId), delay);
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
            this.sessions.delete(sessionId); // Clean up old socket ref
            setTimeout(() => this.startSession(sessionId), delay);
          } else {
            console.error(`❌ Session ${sessionId}: Max retries reached.`);
            this.connectionStates.set(sessionId, 'disconnected');
          }
        } else if (connection === 'open') {
          console.log(`✅ Session ${sessionId} Connected!`);
          this.retryCounters.set(sessionId, 0); // Reset retries
          this.connectionStates.set(sessionId, 'connected');
          await this.updateSessionStatus(
            sessionId,
            'connected',
            undefined,
            sock.user?.id,
          );
        } else if (connection === 'connecting') {
          this.connectionStates.set(sessionId, 'connecting');
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

      // Handle Incoming Calls (AI Call Assistant)
      sock.ev.on('call', async (calls) => {
        for (const call of calls) {
          if (call.status === 'offer') {
            await callAssistant.handleIncomingCall(
              call.id,
              call.from,
              sessionId,
              async (callId, from) => { await sock.rejectCall(callId, from); }
            );
          }
        }
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
  if (process.env.MONGODB_URI) {
    try {
      // Find all sessions in the database that are not permanently logged out
      // We start all prior known sessions on boot so multi-device retains connection
      const knownSessions = await Session.find({ status: { $ne: 'loggedOut' } });

      if (knownSessions.length > 0) {
        console.log(`📱 Found ${knownSessions.length} existing sessions in DB. Starting them...`);
        for (const session of knownSessions) {
          await manager.startSession(session.sessionId);
        }
      } else {
        // If no sessions exist, at least start the default one
        console.log(`📱 No existing sessions found. Starting default session...`);
        return manager.startSession('default');
      }
    } catch (e) {
      console.error('Error auto-starting sessions, falling back to default:', e);
      return manager.startSession('default');
    }
  } else {
    // File-based fallback
    return manager.startSession('default');
  }
}

export async function disconnectWhatsApp() {
  // Gracefully close all active sockets
  const activeSessions = await Session.find({ status: { $eq: 'connected' } });
  for (const session of activeSessions) {
    await manager.deleteSession(session.sessionId);
  }
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

  // Create temporary files for conversion
  const tempId = randomBytes(8).toString('hex');
  const inputPath = join(tmpdir(), `in_${tempId}.tmp`);
  const outputPath = join(tmpdir(), `out_${tempId}.ogg`);

  try {
    // Write raw buffer (MP3 or WAV) to disk
    await fsPromises.writeFile(inputPath, new Uint8Array(audioBuffer));

    // Convert to proper WhatsApp OGG/Opus using fluent-ffmpeg
    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputPath)
        .toFormat('ogg')
        .audioCodec('libopus')
        .on('end', () => resolve())
        .on('error', (err) => reject(err))
        .save(outputPath);
    });

    // Read the newly encoded Opus file
    const opusBuffer = await fsPromises.readFile(outputPath);

    // Send via Baileys
    await sock.sendMessage(jid, {
      audio: opusBuffer,
      mimetype: 'audio/ogg; codecs=opus',
      ptt: true,
    });

  } catch (error) {
    console.error('❌ Error converting/sending Voice Note:', error);
    return false;
  } finally {
    // Clean up temporary files
    await fsPromises.unlink(inputPath).catch(() => { });
    await fsPromises.unlink(outputPath).catch(() => { });
  }

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
