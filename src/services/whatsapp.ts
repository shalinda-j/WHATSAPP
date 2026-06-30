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
import { extractPhoneJidFromMessage, isLidJid } from '../utils/jid';
import {
  extractPhoneFromText,
  rememberLidPhoneMapping,
} from './LidPhoneMappingService';
import { BRAND_NAME } from '../config/brand';

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
  // Conflict (440) retries are tracked SEPARATELY from generic-error retries.
  // A rolling deploy can fire many 440s in ~2min; if those shared the generic
  // counter they'd exhaust MAX_RETRIES, so a later transient disconnect would
  // hit the give-up path and take the bot permanently offline. Conflicts have
  // their own unbounded-by-design backoff and never count toward MAX_RETRIES.
  private conflictCounters: Map<string, number> = new Map();
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
    // Don't let pending reconnect timers keep the event loop alive — the
    // process should be free to shut down even if a long backoff is
    // mid-wait. The session is still reachable via reconnectTimers.get(...)
    // for explicit cleanup in clearReconnectTimer().
    timer.unref?.();

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
        browser: [BRAND_NAME, 'Chrome', '120.0.0'],
        connectTimeoutMs: 60000,
        // A finite defaultQueryTimeoutMs makes the initial app-state sync
        // ("init queries") throw a 408 Request Time-out on slower links / busy
        // WhatsApp servers, which destabilises the session. Baileys' own
        // recommendation is to disable the blanket query timeout (undefined)
        // and rely on keep-alive + retry instead.
        defaultQueryTimeoutMs: undefined,
        keepAliveIntervalMs: 30000,
        retryRequestDelayMs: 1000,
        syncFullHistory: false,
        markOnlineOnConnect: false,
      });

      // Re-check the deleted flag before adopting this socket. deleteSession
      // may have run during the awaits above (Mongo connect / auth state /
      // version fetch). At that moment no socket existed for it to close, and
      // it cleared the auth — but without this guard we'd resume here, register
      // handlers, and re-link the very device the operator just deleted (it
      // would even show a fresh QR and start replying to customers).
      if (this.deletedSessions.has(sessionId)) {
        console.log(
          `🚫 Session ${sessionId} was deleted during startup. Tearing down the new socket.`,
        );
        try {
          sock.end(undefined);
        } catch {
          // ignore
        }
        this.connectionStates.delete(sessionId);
        return;
      }

      this.sessions.set(sessionId, sock);

      // Save credentials
      sock.ev.on('creds.update', saveCreds);

      // Handle Connection Updates
      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        // Defense-in-depth for the delete-during-connect race: if the session
        // was deleted after this socket was created (e.g. while it was still
        // linking / showing a QR), tear it down instead of letting the 'qr' or
        // 'open' branches re-link it. The 'close' branch has its own deleted
        // handling, so let it run its cleanup.
        if (connection !== 'close' && this.deletedSessions.has(sessionId)) {
          console.log(
            `🚫 Session ${sessionId} deleted mid-connect — ending socket.`,
          );
          try {
            sock.end(undefined);
          } catch {
            // ignore
          }
          this.sessions.delete(sessionId);
          this.connectionStates.delete(sessionId);
          this.retryCounters.delete(sessionId);
          this.conflictCounters.delete(sessionId);
          return;
        }

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
            this.conflictCounters.delete(sessionId);
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
            this.conflictCounters.delete(sessionId);
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
            // Conflict retries use their OWN counter and never count toward
            // MAX_RETRIES (see field comment). Error class changed to conflict
            // → reset the generic counter so a prior transient streak doesn't
            // carry over.
            this.retryCounters.delete(sessionId);
            const retries = (this.conflictCounters.get(sessionId) || 0) + 1;
            this.conflictCounters.set(sessionId, retries);

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

          // For other errors, try to reconnect with retry logic. Error class
          // changed away from conflict → reset the conflict counter.
          this.conflictCounters.delete(sessionId);
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
            this.sessions.delete(sessionId);
            // Clear the counter so a later MANUAL startSession isn't instantly
            // re-capped by the stale retry count.
            this.retryCounters.delete(sessionId);
          }
        } else if (connection === 'open') {
          console.log(`✅ Session ${sessionId} Connected!`);
          this.retryCounters.set(sessionId, 0); // Reset retries
          this.conflictCounters.delete(sessionId); // Reset conflict streak
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
            if (isLidJid(msg.key.remoteJid)) {
              const text = getMessageText(msg);
              rememberLidPhoneMapping({
                sessionId,
                lidJid: msg.key.remoteJid,
                phoneJid:
                  extractPhoneJidFromMessage(msg) ?? extractPhoneFromText(text),
                source: 'message',
              }).catch((err) => {
                console.error('Failed to store LID phone mapping:', err);
              });
            }

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

      const rememberContactMapping = (contact: {
        id?: string;
        lid?: string;
      }) => {
        if (!contact.lid || !contact.id) return;
        rememberLidPhoneMapping({
          sessionId,
          lidJid: contact.lid,
          phoneJid: contact.id,
          source: 'chat_metadata',
        }).catch((err) => {
          console.error('Failed to store contact LID mapping:', err);
        });
      };

      sock.ev.on('contacts.upsert', (contacts) => {
        contacts.forEach(rememberContactMapping);
      });

      sock.ev.on('contacts.update', (contacts) => {
        contacts.forEach(rememberContactMapping);
      });

      sock.ev.on('messaging-history.set', ({ contacts }) => {
        contacts.forEach(rememberContactMapping);
      });

      // Baileys emits this when WhatsApp shares the real phone number for a
      // privacy LID. Persist it so old CRM contacts can be exported with a
      // dialable number once the mapping has ever been observed.
      (sock.ev as any).on(
        'chats.phoneNumberShare',
        async (event: { lid?: string; jid?: string }) => {
          try {
            await rememberLidPhoneMapping({
              sessionId,
              lidJid: event.lid,
              phoneJid: event.jid,
              source: 'phone_number_share',
            });
          } catch (err) {
            console.error('Failed to store phoneNumberShare mapping:', err);
          }
        },
      );

      // Handle Incoming Calls (AI Call Assistant)
      // Routed through LiveCallService, which picks the best provider:
      //  • reject-reply (default, Baileys) — reject + smart text/voice reply
      //  • live-answer (WhatsApp Business Calling API) — accept + stream TTS,
      //    only when credentials + a media-capable transport are available.
      // Dynamic import keeps the module graph acyclic and the change minimal.
      sock.ev.on('call', async (calls) => {
        const { liveCallService } = await import('./LiveCallService');
        for (const call of calls) {
          if (call.status === 'offer') {
            await liveCallService.handleIncomingCall({
              callId: call.id,
              from: call.from,
              sessionId,
              rejectCall: async (callId, from) => {
                await sock.rejectCall(callId, from);
              },
            });
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

      // FIX: Emit real-time Socket.io events so the frontend Sessions dashboard
      // updates instantly instead of waiting for the 10-second fallback poll.
      // QR changes get their own event so the new QR renders the moment it's
      // available — critical for good scan UX. All other state changes
      // (connected, disconnected, connecting) use the generic status event.
      try {
        const { getIO } = await import('../server/socket');
        const io = getIO();
        if (qr) {
          io.emit('qr-update', { sessionId, qr, status });
        }
        io.emit('session-status-update', { sessionId, status, phoneNumber });
      } catch {
        // Socket.io may not be initialized yet during early boot — safe to ignore.
      }
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
    this.conflictCounters.delete(sessionId);
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
   * List the session IDs that currently have a live socket, with
   * fully-connected sessions first so callers that need "any working
   * session" pick the healthiest one.
   */
  getActiveSessionIds(): string[] {
    const ids = Array.from(this.sessions.keys());
    return ids.sort((a, b) => {
      const aConnected = this.connectionStates.get(a) === 'connected' ? 0 : 1;
      const bConnected = this.connectionStates.get(b) === 'connected' ? 0 : 1;
      return aConnected - bConnected;
    });
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
  // Gracefully close all active sockets WITHOUT logging out or wiping auth.
  //
  // The original implementation called manager.deleteSession() here, which
  // calls sock.logout() and clears MongoDB auth state — meaning every graceful
  // server shutdown permanently de-linked the device and required a QR scan on
  // the next start. That defeats the purpose of persistent sessions.
  //
  // The correct behaviour on shutdown is to close the socket cleanly (so
  // WhatsApp's cloud side marks the device offline rather than in error) but
  // leave all auth credentials intact so the next connectToWhatsApp() call
  // can re-establish the session without re-scanning a QR code.
  const allSessions = Array.from(manager['sessions'].entries()) as [
    string,
    import('@whiskeysockets/baileys').WASocket,
  ][];
  for (const [sessionId, sock] of allSessions) {
    try {
      // Update DB status without touching auth data or marking as deleted.
      await Session.findOneAndUpdate(
        { sessionId },
        { status: 'disconnected' },
      ).catch(() => undefined);
      sock.end(undefined);
      console.log(`🔌 Gracefully closed socket for session: ${sessionId}`);
    } catch {
      // Best-effort — don't let one failing socket block the rest.
    }
  }
  console.log('✅ All sockets closed. Auth state preserved for next start.');
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
  // Mirror sendMessage/sendVoiceMessage: require an actually-connected socket.
  // A socket that exists but is mid-reconnect ('connecting'/'disconnected')
  // would otherwise pass the `!sock` guard and then reject inside
  // sock.sendMessage ('Connection Closed'), which — with no try/catch here —
  // surfaced as an unhandled promise rejection for fire-and-forget callers.
  if (!sock || manager.getConnectionState(sessionId) !== 'connected') {
    console.warn(
      `⚠️ sendMediaMessage: session '${sessionId}' not connected (state: ${manager.getConnectionState(
        sessionId,
      )}). Skipping media send.`,
    );
    return false;
  }

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

  try {
    await sock.sendMessage(jid, messagePayload);
    return true;
  } catch (err: any) {
    console.error(
      `❌ sendMediaMessage failed for ${jid} (session ${sessionId}):`,
      err?.message || err,
    );
    return false;
  }
}

export function getSocket(sessionId = 'default'): WASocket | undefined {
  return manager.getSocket(sessionId);
}

/**
 * Resolve a usable session ID: the requested one if it has a live socket,
 * otherwise the first active session (connected ones first). Returns null
 * when no session is up at all. Lets admin-panel send paths work in
 * multi-device deployments where the 'default' session doesn't exist.
 */
export function resolveActiveSessionId(
  preferred = 'default',
): string | null {
  // Prefer the requested session only when it's actually connected — a stale
  // socket that's mid-reconnect would otherwise be picked and the send would
  // silently fail.
  if (
    manager.getSocket(preferred) &&
    manager.getConnectionState(preferred) === 'connected'
  ) {
    return preferred;
  }
  const active = manager.getActiveSessionIds();
  // Next best: any session whose socket is fully connected.
  const connected = active.find(
    (id) => manager.getConnectionState(id) === 'connected',
  );
  if (connected) return connected;
  // Last resort: fall back to the first active (possibly connecting) session
  // so admin send paths still have something to try when nothing is connected.
  return active.length > 0 ? active[0] : null;
}

// Helpers
export function getMessageText(message: proto.IWebMessageInfo): string {
  const raw = message.message;
  if (!raw) return '';
  // Unwrap disappearing-messages (ephemeral) and view-once wrappers. Baileys
  // delivers their real payload nested one level down; without this unwrap,
  // every TEXT message from a contact with "disappearing messages" enabled
  // (a common Business setting) reads as '' and gets dropped by the empty-
  // message guard. Mirrors the unwrap in mediaUnderstanding.ts. Falls back to
  // the raw message so normal (un-wrapped) messages are unchanged.
  const msg: NonNullable<proto.IWebMessageInfo['message']> =
    raw.ephemeralMessage?.message ??
    raw.viewOnceMessage?.message ??
    raw.viewOnceMessageV2?.message ??
    raw.viewOnceMessageV2Extension?.message ??
    raw;
  return (
    msg.conversation ||
    msg.extendedTextMessage?.text ||
    msg.imageMessage?.caption ||
    msg.videoMessage?.caption ||
    msg.documentMessage?.caption ||
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
  // Derive status from the live session manager rather than hardcoding the
  // 'default' session — multi-device deployments and any non-'default' session
  // were previously reported as disconnected even while connected.
  const ids = manager.getActiveSessionIds();
  const anyConnected = ids.some(
    (id) => manager.getConnectionState(id) === 'connected',
  );
  const anyConnecting = ids.some(
    (id) => manager.getConnectionState(id) === 'connecting',
  );

  // Prefer a QR from a session that's currently waiting to be scanned, so the
  // admin panel can render it without falling back to the DB poll.
  let qr: string | null = null;

  let status: string;
  if (anyConnected) {
    status = 'connected';
  } else if (anyConnecting) {
    status = 'connecting';
  } else {
    // Nothing live in memory — fall back to the persisted Session row's status
    // (e.g. right after boot before sockets re-establish).
    const session = await Session.findOne({ sessionId: 'default' });
    status = session?.status || 'disconnected';
    qr = session?.qr || null;
  }

  // If a live session is broadcasting a QR (scan_qr) and we don't already have
  // one, surface it from the DB so the panel shows the freshest code.
  if (!qr) {
    const qrSessionId = ids.find(
      (id) => manager.getConnectionState(id) === 'connecting',
    );
    if (qrSessionId) {
      const qrSession = await Session.findOne({ sessionId: qrSessionId });
      qr = qrSession?.qr || null;
    }
  }

  return {
    status,
    qr,
    activeSessions: manager.getActiveSessionsCount(),
  };
}

export function getActiveSessionCount(): number {
  return manager.getActiveSessionsCount();
}
