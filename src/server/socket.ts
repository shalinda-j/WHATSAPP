import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { ACTUAL_JWT_SECRET } from './jwt-secret';
import { isDigitalOceanOrigin } from './corsOrigins';

let io: Server;

export const initSocket = (server: HttpServer) => {
  // Mirror the HTTP CORS policy (app.ts) so the Socket.io handshake honours the
  // SAME ALLOWED_ORIGINS list. Previously this read CORS_ORIGIN (which is never
  // set in the deploy) and fell back to '*', silently widening the socket to any
  // origin even while the REST API was locked down.
  const localOrigins = [
    'http://localhost:5000',
    'http://localhost:5173',
    'http://localhost:8080',
    'http://127.0.0.1:5000',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:8080',
  ];
  const envOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter((o) => o.length > 0);
  const allowedOrigins = [...localOrigins, ...envOrigins];
  const isDev = process.env.NODE_ENV !== 'production';

  io = new Server(server, {
    cors: {
      origin: (origin, callback) => {
        // No Origin header (native/server clients): allow only in dev.
        if (!origin) return callback(null, isDev);
        const normalised = origin.replace(/\/$/, '');
        if (allowedOrigins.includes(normalised)) return callback(null, true);
        // Fallback: always allow the app's own DigitalOcean App Platform
        // origin. The admin panel is served BY this same service, so its
        // Socket.io handshake carries the *.ondigitalocean.app origin.
        // ALLOWED_ORIGINS is *supposed* to list it, but the deployed env
        // drifted from .do/app.yaml (the var was never set on the live app),
        // which silently blocked every real-time dashboard update — live
        // chat, session status, QR, agent traces. The JWT auth middleware
        // below still gates actual access, so allowing the platform origin
        // here is safe and self-heals the config drift.
        if (isDigitalOceanOrigin(normalised)) return callback(null, true);
        console.warn(`⚠️ Socket CORS blocked origin: ${origin}`);
        return callback(null, false);
      },
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  // SECURITY FIX: Authentication middleware for WebSocket connections
  io.use((socket: Socket, next) => {
    // Check for token in handshake auth or query
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;

    if (!token) {
      console.warn(
        `🔌 Unauthorized WebSocket connection rejected: ${socket.id} - No token provided`,
      );
      return next(new Error('Authentication error: Token required'));
    }

    try {
      // Verify JWT token
      const decoded = jwt.verify(token as string, ACTUAL_JWT_SECRET) as {
        userId?: string;
        role?: string;
      };

      // Attach user info to socket for later use
      socket.data.user = decoded;

      console.log(
        `🔌 Authenticated WebSocket connection: ${socket.id} (user: ${
          decoded.userId || 'unknown'
        })`,
      );
      next();
    } catch (err) {
      console.warn(
        `🔌 Unauthorized WebSocket connection rejected: ${socket.id} - Invalid token`,
      );
      next(new Error('Authentication error: Invalid token'));
    }
  });

  io.on('connection', (socket: Socket) => {
    console.log(`🔌 Client connected to WebSocket: ${socket.id}`);

    socket.on('disconnect', () => {
      console.log(`🔌 Client disconnected from WebSocket: ${socket.id}`);
    });
  });

  return io;
};

export const getIO = () => {
  if (!io) {
    throw new Error('Socket.io is not initialized!');
  }
  return io;
};
