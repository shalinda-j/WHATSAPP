import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { ACTUAL_JWT_SECRET } from './jwt-secret';

let io: Server;

export const initSocket = (server: HttpServer) => {
  io = new Server(server, {
    cors: {
      origin: process.env.CORS_ORIGIN || '*', // Adjust for production
      methods: ['GET', 'POST'],
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
