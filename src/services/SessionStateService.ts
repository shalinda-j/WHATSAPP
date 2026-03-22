import SessionState, { SessionType, ISessionState } from '../models/SessionState';

/**
 * SessionStateService
 * Provides persistent session storage that survives server restarts
 * Replaces in-memory Maps with MongoDB-backed storage
 */

// Default session expiry time (30 minutes)
const DEFAULT_SESSION_TTL_MS = 30 * 60 * 1000;

export class SessionStateService {
  private static instance: SessionStateService;

  private constructor() {}

  public static getInstance(): SessionStateService {
    if (!SessionStateService.instance) {
      SessionStateService.instance = new SessionStateService();
    }
    return SessionStateService.instance;
  }

  /**
   * Create or update a session
   */
  async setSession(
    phoneNumber: string,
    type: SessionType,
    state: Record<string, any>,
    data: Record<string, any> = {},
    ttlMs: number = DEFAULT_SESSION_TTL_MS,
  ): Promise<ISessionState> {
    const expiresAt = new Date(Date.now() + ttlMs);

    const session = await SessionState.findOneAndUpdate(
      { phoneNumber, type },
      {
        state,
        data,
        expiresAt,
        updatedAt: new Date(),
      },
      { upsert: true, new: true },
    );

    return session;
  }

  /**
   * Get a session by phone number and type
   */
  async getSession(
    phoneNumber: string,
    type: SessionType,
  ): Promise<ISessionState | null> {
    const session = await SessionState.findOne({ phoneNumber, type });

    if (!session) {
      return null;
    }

    // Check if expired
    if (session.expiresAt < new Date()) {
      await this.deleteSession(phoneNumber, type);
      return null;
    }

    return session;
  }

  /**
   * Check if a session exists
   */
  async hasSession(phoneNumber: string, type: SessionType): Promise<boolean> {
    const session = await this.getSession(phoneNumber, type);
    return session !== null;
  }

  /**
   * Update session state partially
   */
  async updateSessionState(
    phoneNumber: string,
    type: SessionType,
    stateUpdate: Record<string, any>,
  ): Promise<ISessionState | null> {
    const session = await SessionState.findOne({ phoneNumber, type });

    if (!session) {
      return null;
    }

    session.state = { ...session.state, ...stateUpdate };
    session.updatedAt = new Date();
    await session.save();

    return session;
  }

  /**
   * Update session data partially
   */
  async updateSessionData(
    phoneNumber: string,
    type: SessionType,
    dataUpdate: Record<string, any>,
  ): Promise<ISessionState | null> {
    const session = await SessionState.findOne({ phoneNumber, type });

    if (!session) {
      return null;
    }

    session.data = { ...session.data, ...dataUpdate };
    session.updatedAt = new Date();
    await session.save();

    return session;
  }

  /**
   * Delete a session
   */
  async deleteSession(phoneNumber: string, type: SessionType): Promise<boolean> {
    const result = await SessionState.deleteOne({ phoneNumber, type });
    return result.deletedCount > 0;
  }

  /**
   * Extend session expiry
   */
  async extendSession(
    phoneNumber: string,
    type: SessionType,
    additionalMs: number = DEFAULT_SESSION_TTL_MS,
  ): Promise<boolean> {
    const result = await SessionState.updateOne(
      { phoneNumber, type },
      {
        expiresAt: new Date(Date.now() + additionalMs),
        updatedAt: new Date(),
      },
    );

    return result.modifiedCount > 0;
  }

  /**
   * Get all active sessions for a phone number
   */
  async getAllSessionsForPhone(phoneNumber: string): Promise<ISessionState[]> {
    return SessionState.find({
      phoneNumber,
      expiresAt: { $gt: new Date() },
    });
  }

  /**
   * Clean up expired sessions (manual cleanup, TTL index handles automatic)
   */
  async cleanupExpiredSessions(): Promise<number> {
    const result = await SessionState.deleteMany({
      expiresAt: { $lt: new Date() },
    });
    return result.deletedCount;
  }

  /**
   * Get session count by type
   */
  async getSessionCount(type?: SessionType): Promise<number> {
    const query = type ? { type } : {};
    return SessionState.countDocuments({
      ...query,
      expiresAt: { $gt: new Date() },
    });
  }

  /**
   * Migrate in-memory session to database
   */
  async migrateFromMemory(
    phoneNumber: string,
    type: SessionType,
    state: Record<string, any>,
    data: Record<string, any> = {},
  ): Promise<ISessionState> {
    return this.setSession(phoneNumber, type, state, data);
  }
}

export const sessionStateService = SessionStateService.getInstance();
export default sessionStateService;