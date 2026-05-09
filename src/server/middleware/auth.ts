import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// SECURITY FIX: Throw error if JWT_SECRET not configured
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('CRITICAL: JWT_SECRET environment variable must be set. Application cannot start without proper authentication secret.');
}
if (JWT_SECRET.length < 32) {
  console.warn('⚠️ WARNING: JWT_SECRET should be at least 32 characters for security.');
}

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
    res.sendStatus(401);
    return;
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      console.error('JWT Verification Error:', err.message);
      res.sendStatus(403);
      return;
    }
    req.user = user as JwtPayload;
    next();
  });
};
