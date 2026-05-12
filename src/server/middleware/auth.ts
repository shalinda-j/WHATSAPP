import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { ACTUAL_JWT_SECRET } from '../jwt-secret';

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
        expiredAt:
          err instanceof jwt.TokenExpiredError ? err.expiredAt : undefined,
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
