import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

// SECURITY: Generate a default secret if JWT_SECRET is not configured
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.warn('⚠️ WARNING: JWT_SECRET environment variable not set. Using default secret for development. Set a secure secret in production.');
}
if (JWT_SECRET && JWT_SECRET.length < 32) {
  console.warn('⚠️ WARNING: JWT_SECRET should be at least 32 characters for security.');
}
// Use provided secret or generate a random one for development
const ACTUAL_JWT_SECRET = JWT_SECRET || crypto.randomBytes(32).toString('hex');

export interface JwtPayload {
  id: string;
  username: string;
  role: string;
}

export interface AuthRequest extends Request {
  user?: JwtPayload;
}

export const authenticateToken = (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): void => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    console.log('Authentication failed: No token provided for', req.path);
    res.status(401).json({ error: 'No authentication token provided' });
    return;
  }

  jwt.verify(token, ACTUAL_JWT_SECRET, (err, user) => {
    if (err) {
      console.error('JWT Verification Error:', {
        message: err.message,
        name: err.name,
        expiredAt: err instanceof jwt.TokenExpiredError ? err.expiredAt : undefined,
        path: req.path,
      });
      res.status(403).json({
        error: 'Invalid or expired token',
        expired: err.name === 'TokenExpiredError',
      });
      return;
    }
    req.user = user as JwtPayload;
    next();
  });
};
