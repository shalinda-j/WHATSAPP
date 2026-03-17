import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// Warn if using default secret in production
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_key_change_in_prod';
if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  console.warn(
    '⚠️ WARNING: Using default JWT_SECRET in production is insecure!',
  );
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
