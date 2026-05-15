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
import { HumanizerService } from './HumanizerService';

// Set FFmpeg path
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

// Logger - using pino with any type for Baileys compatibility
const logger = pino({
  level: process.env.DEBUG === 'true' ? 'debug' : 'warn',
}) as any;

// Global message handlers (shared across sessions for now)
// MEMORY LEAK FIX: Add limit to prevent unbounded growth
const MAX_MESSAGE_HANDLERS = 50;
const messageHandlers: Array<
  (
    message: proto.IWebMessageInfo,
    sock: WASocket,
    sessionId: string,
  ) => Promise<void>
> = [];

// MEMORY LEAK FIX: Track reconnect timers for cleanup
const reconnectTimers: Map<string, NodeJS.Timeout> = new Map();

export class WhatsAppSessionManager {
  private sessions: Map<string, WASocket> = new Map();
  private retryCounters: Map<string, number> = new Map();
  private connectionStates: Map<
    string,
    'connecting' | 'connected' | 'disconnected'
  > = new Map();
  private deletedSessions: Set<string> = new Set(); // Track sessions marked for deletion
  private static MAX_RETRIES = 5;

  constructor() {
    // Ensure auth dir exists for file-based fallback
    const AUTH_DIR = resolve(__dirname, '..', 'auth_info');
    if (!existsSync(AUTH_DIR)) mkdirSync(AUTH_DIR, { recursive: true });
  }

  /**
   * MEMORY LEAK FIX: Helper to schedule reconnect with cleanup tracking
   */
  private scheduleReconnect(sessionId: string, delay: number): void {
    // Clear any existing timer for this session
    const existingTimer = reconnectTimers.get(sessionId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Schedule new reconnect
    const timer = setTimeout(() => {
      reconnectTimers.delete(sessionId);
      this.startSession(sessionId);
    }, delay);

    reconnectTimers.set(sessionId, timer);
  }

  /**
   * MEMORY LEAK FIX: Clear reconnect timer for a session
   */
  private clearReconnectTimer(sessionId: string): void {
    const timer = reconnectTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      reconnectTimers.delete(sessionId);
    }
  }

  /**
   * Start a specific session
   */
  async startSession(sessionId: string) {
    // Check if this session was explicitly deleted (don't auto-restart)
    if (this.deletedSessions.has(sessionId)) {
      console.log(
        `🚫 Session ${sessionId} was deleted (in-memory flag). Skipping auto-start.`,
      );
      return;
    }

    // Also check the database for deleted flag (persists across restarts)
    if (process.env.MONGODB_URI) {
      try {
        const sessionDoc = await Session.findOne({ sessionId });
        if (sessionDoc && sessionDoc.deleted) {
          console.log(
            `🚫 Session ${sessionId} was deleted (DB flag). Skipping auto-start. Clear from deleted list if you want to restart.`,
          );
          // Also add to in-memory set for faster checks
          this.deletedSessions.add(sessionId);
          return;
        }
      } catch (dbErr: any) {
        if (!dbErr?.message?.includes('buffering timed out')) {
          console.warn(
            `   ⚠️ Error checking session deleted status:`,
            dbErr?.message,
          );
        }
      }
    }

    // Prevent duplicate initializations
    if (
      this.connectionStates.get(sessionId) === 'connecting' ||
      this.connectionStates.get(sessionId) === 'connected'
    ) {
      console.log(
        `ℹ️ Session ${sessionId} is already ${this.connectionStates.get(
          sessionId,
        )}. Skipping start.`,
      );
      return;
    }

    try {
      console.log(`🔄 Starting session: ${sessionId}`);
      this.connectionStates.set(sessionId, 'connecting');

      let authState;
      let saveCreds;
      let clearState: () => Promise<void> = async () => {
        // No-op default implementation
      };

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
        clearState = async () => {
          // No-op for file system - state is managed by files
        };
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
          const isConflict =
            statusCode === 440 || reason?.reason === 'conflict';
          // Handle logged out (401)
          const isLoggedOut =
            statusCode === DisconnectReason.loggedOut ||
            reason?.reason === 'logged_out' ||
            statusCode === 401;

          console.log(
            `⚠️ Session ${sessionId} Closed: ${statusCode} (conflict: ${isConflict}, loggedOut: ${isLoggedOut}, deleted: ${this.deletedSessions.has(
              sessionId,
            )})`,
          );

          // Check if this session was deliberately deleted - don't auto-restart
          if (this.deletedSessions.has(sessionId)) {
            console.log(
              `🚫 Session ${sessionId} was deleted. Not auto-restarting.`,
            );
            this.sessions.delete(sessionId);
            this.connectionStates.delete(sessionId);
            this.retryCounters.delete(sessionId);
            return;
          }

          this.connectionStates.set(sessionId, 'disconnected');
          await this.updateSessionStatus(sessionId, 'disconnected');

          // For logged out, clear session and restart for new QR
          if (isLoggedOut) {
            console.log(
              `❌ Session ${sessionId}: Logged Out. Cleaning up and restarting for new QR...`,
            );

            try {
              await clearState();
            } catch (e) {
              console.error('Error clearing state:', e);
            }
            this.sessions.delete(sessionId);
            this.retryCounters.delete(sessionId);
            this.connectionStates.delete(sessionId);

            // MEMORY LEAK FIX: Use tracked timer
            this.scheduleReconnect(sessionId, 2000);
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

            console.log(
              `🔄 Session ${sessionId}: Conflict detected. Another instance is likely running. Retrying in ${
                delay / 1000
              }s... (Attempt ${retries})`,
            );

            this.sessions.delete(sessionId);
            this.connectionStates.delete(sessionId);
            // MEMORY LEAK FIX: Use tracked timer
            this.scheduleReconnect(sessionId, delay);
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
            // MEMORY LEAK FIX: Use tracked timer
            this.scheduleReconnect(sessionId, delay);
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

          // Process any queued messages now that we're connected
          const queueSize = HumanizerService.getQueueSize();
          if (queueSize > 0) {
            console.log(
              `📬 Processing ${queueSize} queued messages for session ${sessionId}`,
            );
            HumanizerService.triggerQueueProcessing();
          }

          // Process any queued voice messages
          const voiceQueueSize = getVoiceQueueSize();
          if (voiceQueueSize > 0) {
            console.log(
              `📬 Processing ${voiceQueueSize} queued voice messages for session ${sessionId}`,
            );
            triggerVoiceQueueProcessing();
          }
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
                `🛡️ Blocked unsafe message from ${
                  msg.key.remoteJid
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
              async (callId, from) => {
                await sock.rejectCall(callId, from);
              },
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
   * Will NOT recreate deleted sessions (upsert disabled if session is deleted)
   */
  private async updateSessionStatus(
    sessionId: string,
    status: string,
    qr?: string,
    phoneNumber?: string,
  ) {
    try {
      // Don't recreate session if it was deleted
      if (this.deletedSessions.has(sessionId)) {
        console.log(
          `   ⏭️ Skipping DB update for deleted session: ${sessionId}`,
        );
        return;
      }

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
    } catch (err: any) {
      if (!err?.message?.includes('buffering timed out')) {
        console.warn('Failed to update session status in DB', err?.message);
      }
    }
  }

  /**
   * Get a specific socket
   */
  getSocket(sessionId = 'default'): WASocket | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Disconnect and remove a session completely
   * This will logout from WhatsApp, clear all auth data, and remove the session
   */
  async deleteSession(sessionId: string) {
    console.log(`🗑️ Deleting session: ${sessionId}`);

    // 0. Mark as deleted in memory to prevent auto-reconnect
    this.deletedSessions.add(sessionId);

    // 0.5. Mark as deleted in DATABASE first (persistent, survives restart)
    // This is the most important step - do it before anything else
    try {
      await Session.findOneAndUpdate(
        { sessionId },
        { deleted: true, status: 'deleted', qr: null },
        { new: true },
      );
      console.log(`   ✅ Marked session as deleted in database: ${sessionId}`);
    } catch (dbErr: any) {
      if (!dbErr?.message?.includes('buffering timed out')) {
        console.warn(
          `   ⚠️ Failed to mark session as deleted in DB: ${dbErr.message}`,
        );
      }
      // Continue with deletion anyway
    }

    // 1. Get socket and logout properly
    const sock = this.sessions.get(sessionId);
    if (sock) {
      try {
        // Use logout() instead of end() to properly disconnect from WhatsApp
        // This tells WhatsApp to unlink the device
        await sock.logout('Session deleted by user');
        console.log(`   ✅ Logged out from WhatsApp for session: ${sessionId}`);
      } catch (logoutErr: any) {
        // If logout fails (e.g., already disconnected), just continue
        console.log(`   ⚠️ Logout error (continuing): ${logoutErr.message}`);
      }
      // Force close the socket
      try {
        sock.end(undefined);
      } catch {
        // Ignore
      }
    }

    // 2. Clear all internal state
    this.sessions.delete(sessionId);
    this.connectionStates.delete(sessionId);
    this.retryCounters.delete(sessionId);
    // MEMORY LEAK FIX: Clear reconnect timer
    this.clearReconnectTimer(sessionId);
    console.log(`   ✅ Cleared internal state for session: ${sessionId}`);

    // 3. Clear auth data from MongoDB
    if (process.env.MONGODB_URI) {
      try {
        // Import dynamically to avoid circular dependency
        const { clearSessionAuthData } = await import('./MongoAuthService');
        await clearSessionAuthData(sessionId);
        console.log(
          `   ✅ Cleared auth data from MongoDB for session: ${sessionId}`,
        );
      } catch (authErr: any) {
        console.error(`   ⚠️ Failed to clear auth data: ${authErr.message}`);
      }
    }

    // 4. Delete session document from database (after marking deleted)
    try {
      await Session.deleteOne({ sessionId });
      console.log(`   ✅ Deleted session document from DB: ${sessionId}`);
    } catch (dbErr: any) {
      if (!dbErr?.message?.includes('buffering timed out')) {
        console.warn(
          `   ⚠️ Failed to delete session from DB: ${dbErr.message}`,
        );
      }
    }

    console.log(`✅ Session ${sessionId} fully deleted and logged out`);
  }

  /**
   * Get the count of active sessions
   */
  getActiveSessionsCount(): number {
    return this.sessions.size;
  }

  /**
   * Get the connection state of a specific session
   */
  getConnectionState(
    sessionId: string,
  ): 'connecting' | 'connected' | 'disconnected' | undefined {
    return this.connectionStates.get(sessionId);
  }

  /**
   * Allow a deleted session to be recreated
   * Call this before starting a new session with the same ID after deletion
   */
  allowSessionRestart(sessionId: string): void {
    this.deletedSessions.delete(sessionId);
    console.log(
      `🔓 Session ${sessionId} removed from deleted list, can now be restarted`,
    );
  }

  /**
   * Check if a session is marked as deleted
   */
  isSessionDeleted(sessionId: string): boolean {
    return this.deletedSessions.has(sessionId);
  }

  // Legacy support methods (migrating old single-file functions to use 'default' session)
  static instance = new WhatsAppSessionManager();
}

// --- Legacy Adapters for Existing Code (index.ts) ---
const manager = WhatsAppSessionManager.instance;

export async function connectToWhatsApp() {
  if (process.env.MONGODB_URI) {
    try {
      // Find all sessions in the database that are not permanently logged out or deleted
      // We start all prior known sessions on boot so multi-device retains connection
      const knownSessions = await Session.find({
        status: { $ne: 'loggedOut' },
        deleted: { $ne: true }, // Don't auto-start deleted sessions
      });

      if (knownSessions.length > 0) {
        console.log(
          `📱 Found ${knownSessions.length} existing sessions in DB. Starting them...`,
        );
        for (const session of knownSessions) {
          await manager.startSession(session.sessionId);
        }
      } else {
        // If no sessions exist, at least start the default one
        console.log(
          `📱 No existing sessions found. Starting default session...`,
        );
        return manager.startSession('default');
      }
    } catch (e) {
      console.error(
        'Error auto-starting sessions, falling back to default:',
        e,
      );
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
// MEMORY LEAK FIX: Limit handler count
export function onMessage(
  handler: (
    message: proto.IWebMessageInfo,
    sock: WASocket,
    sessionId: string,
  ) => Promise<void>,
) {
  if (messageHandlers.length >= MAX_MESSAGE_HANDLERS) {
    console.warn(
      `⚠️ Message handler limit reached (${MAX_MESSAGE_HANDLERS}). Handler not registered.`,
    );
    return;
  }
  messageHandlers.push(handler);
}

// These functions now need a session ID or default to 'default'
export async function sendMessage(
  jid: string,
  text: string,
  sessionId = 'default',
): Promise<boolean> {
  return HumanizerService.sendHumanizedMessage(jid, text, sessionId);
}

export async function sendTyping(jid: string, sessionId = 'default') {
  const sock = manager.getSocket(sessionId);
  if (sock) await sock.sendPresenceUpdate('composing', jid);
}

export async function downloadWhatsAppAudio(
  message: proto.IWebMessageInfo,
): Promise<Buffer | null> {
  try {
    return (await downloadMediaMessage(message as any, 'buffer', {})) as Buffer;
  } catch (e) {
    return null;
  }
}

// Voice message queue for retry when connection is unavailable
interface QueuedVoiceMessage {
  jid: string;
  audioBuffer: Buffer;
  sessionId: string;
  attempts: number;
  timestamp: Date;
}

const voiceMessageQueue: QueuedVoiceMessage[] = [];
let isProcessingVoiceQueue = false;
const MAX_VOICE_QUEUE_SIZE = 50;
const MAX_VOICE_RETRIES = 3;
const VOICE_RETRY_DELAY_MS = 5000;
// MEMORY LEAK FIX: Add max age for queued voice messages
const MAX_VOICE_QUEUE_AGE_MS = 30 * 60 * 1000; // 30 minutes
let voiceCleanupInterval: NodeJS.Timeout | null = null;

/**
 * MEMORY LEAK FIX: Initialize voice queue cleanup
 */
function initializeVoiceCleanup(): void {
  if (voiceCleanupInterval) return;

  voiceCleanupInterval = setInterval(
    () => {
      const now = Date.now();
      const cutoff = now - MAX_VOICE_QUEUE_AGE_MS;

      const oldCount = voiceMessageQueue.length;
      // Filter out old messages and clear buffers to free memory
      for (let i = voiceMessageQueue.length - 1; i >= 0; i--) {
        if (voiceMessageQueue[i].timestamp.getTime() < cutoff) {
          voiceMessageQueue.splice(i, 1);
        }
      }

      if (voiceMessageQueue.length < oldCount) {
        console.log(
          `🧹 VoiceQueue: Removed ${
            oldCount - voiceMessageQueue.length
          } old voice messages`,
        );
      }
    },
    5 * 60 * 1000,
  ); // Clean every 5 minutes
}

// Initialize cleanup on module load
initializeVoiceCleanup();

/**
 * Process queued voice messages when connection is restored
 */
async function processVoiceQueue(): Promise<void> {
  if (isProcessingVoiceQueue || voiceMessageQueue.length === 0) return;

  isProcessingVoiceQueue = true;

  while (voiceMessageQueue.length > 0) {
    const msg = voiceMessageQueue[0];
    const sock = manager.getSocket(msg.sessionId);

    // Check if socket is available and connected
    const connectionState = manager.getConnectionState(msg.sessionId);
    if (!sock || connectionState !== 'connected') {
      if (msg.attempts >= MAX_VOICE_RETRIES) {
        console.error(
          `❌ Max retries reached for queued voice message to ${msg.jid}, dropping`,
        );
        voiceMessageQueue.shift();
        continue;
      }

      msg.attempts++;
      console.log(
        `⏳ Socket not ready for voice, waiting ${
          VOICE_RETRY_DELAY_MS / 1000
        }s before retry (${msg.attempts}/${MAX_VOICE_RETRIES})`,
      );
      await new Promise((r) => setTimeout(r, VOICE_RETRY_DELAY_MS));
      continue;
    }

    try {
      await sendVoiceMessageDirect(
        sock,
        msg.jid,
        msg.audioBuffer,
        msg.sessionId,
      );
      voiceMessageQueue.shift();
      console.log(`✅ Queued voice message sent to ${msg.jid}`);
    } catch (error) {
      console.error(
        `❌ Failed to send queued voice message to ${msg.jid}:`,
        error,
      );
      if (msg.attempts >= MAX_VOICE_RETRIES) {
        voiceMessageQueue.shift();
      } else {
        msg.attempts++;
        await new Promise((r) => setTimeout(r, VOICE_RETRY_DELAY_MS));
      }
    }
  }

  isProcessingVoiceQueue = false;
}

/**
 * Send voice message directly (internal function)
 */
async function sendVoiceMessageDirect(
  sock: WASocket,
  jid: string,
  audioBuffer: Buffer,
  sessionId: string,
): Promise<boolean> {
  // Create temporary files for conversion
  const tempId = randomBytes(8).toString('hex');
  const inputPath = join(tmpdir(), `in_${tempId}.tmp`);
  const outputPath = join(tmpdir(), `out_${tempId}.ogg`);

  try {
    // Log buffer size for debugging
    console.log(`   📦 Audio buffer size: ${audioBuffer.length} bytes`);

    // Validate buffer
    if (!audioBuffer || audioBuffer.length < 100) {
      console.error('   ❌ Audio buffer too small or empty');
      return false;
    }

    // Write raw buffer (MP3, WAV, or other format) to disk
    await fsPromises.writeFile(inputPath, new Uint8Array(audioBuffer));
    console.log(`   📝 Wrote temp audio file: ${inputPath}`);

    // Convert to proper WhatsApp OGG/Opus using fluent-ffmpeg
    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputPath)
        .toFormat('ogg')
        .audioCodec('libopus')
        .audioFrequency(48000) // Standard Opus sample rate
        .audioChannels(1) // Mono for voice notes
        .on('start', () => {
          console.log(`   🔄 FFmpeg conversion started...`);
        })
        .on('end', () => {
          console.log(`   ✅ FFmpeg conversion complete`);
          resolve();
        })
        .on('error', (err) => {
          console.error(`   ❌ FFmpeg error: ${err.message}`);
          reject(err);
        })
        .save(outputPath);
    });

    // Read the newly encoded Opus file
    const opusBuffer = await fsPromises.readFile(outputPath);
    console.log(`   📦 Converted OGG size: ${opusBuffer.length} bytes`);

    // Validate converted buffer
    if (opusBuffer.length < 50) {
      console.error(
        '   ❌ Converted audio too small, likely conversion failed',
      );
      return false;
    }

    // Send via Baileys as voice note (ptt: true)
    const sent = await sock.sendMessage(jid, {
      audio: opusBuffer,
      mimetype: 'audio/ogg; codecs=opus',
      ptt: true, // This makes it a voice note (appears as waveform in WhatsApp)
    });

    console.log(`   ✅ Voice message sent successfully to ${jid}`);
    console.log(`   📋 Message ID: ${sent?.key?.id || 'unknown'}`);
    return true;
  } catch (error: any) {
    console.error(
      '❌ Error converting/sending Voice Note:',
      error.message || error,
    );
    return false;
  } finally {
    // Clean up temporary files
    try {
      await fsPromises.unlink(inputPath);
      await fsPromises.unlink(outputPath);
    } catch {
      // Ignore cleanup errors
    }
  }
}

export async function sendVoiceMessage(
  jid: string,
  audioBuffer: Buffer,
  sessionId = 'default',
): Promise<boolean> {
  const sock = manager.getSocket(sessionId);
  const connectionState = manager.getConnectionState(sessionId);

  // Check if socket is available AND connected
  if (!sock || connectionState !== 'connected') {
    console.warn(
      `⚠️ sendVoiceMessage: Session '${sessionId}' socket not available or not connected (state: ${connectionState}). Queueing voice message...`,
    );

    // Queue the voice message for retry
    if (voiceMessageQueue.length >= MAX_VOICE_QUEUE_SIZE) {
      console.warn('⚠️ Voice message queue full, dropping oldest message');
      voiceMessageQueue.shift();
    }

    voiceMessageQueue.push({
      jid,
      audioBuffer: Buffer.from(audioBuffer), // Clone the buffer
      sessionId,
      attempts: 0,
      timestamp: new Date(),
    });
    console.log(
      `📬 Voice message queued for ${jid} (queue size: ${voiceMessageQueue.length})`,
    );
    return false;
  }

  try {
    return await sendVoiceMessageDirect(sock, jid, audioBuffer, sessionId);
  } catch (error) {
    console.error('❌ Error sending voice message:', error);
    // Queue for retry on error
    if (voiceMessageQueue.length < MAX_VOICE_QUEUE_SIZE) {
      voiceMessageQueue.push({
        jid,
        audioBuffer: Buffer.from(audioBuffer),
        sessionId,
        attempts: 1,
        timestamp: new Date(),
      });
      console.log(
        `📬 Voice message queued for retry after error (queue size: ${voiceMessageQueue.length})`,
      );
    }
    return false;
  }
}

/**
 * Trigger voice queue processing (call when connection is restored)
 */
export function triggerVoiceQueueProcessing(): void {
  processVoiceQueue();
}

/**
 * Get voice message queue size (for monitoring)
 */
export function getVoiceQueueSize(): number {
  return voiceMessageQueue.length;
}

export async function sendMediaMessage(
  jid: string,
  mediaBuffer: Buffer,
  type: 'image' | 'video' | 'audio' | 'document',
  options: { caption?: string; mimetype?: string; fileName?: string } = {},
  sessionId = 'default',
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
  return message.key?.fromMe === true;
}

export function getSenderJid(message: proto.IWebMessageInfo): string {
  return message.key?.remoteJid || '';
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
