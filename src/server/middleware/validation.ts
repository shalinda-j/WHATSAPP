import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';

/**
 * Validates that a string is a valid MongoDB ObjectId
 * @param id String to validate
 * @returns true if valid ObjectId, false otherwise
 */
export function isValidObjectId(id: string): boolean {
  return mongoose.Types.ObjectId.isValid(id);
}

/**
 * Middleware to validate MongoDB ObjectId in route params
 * @param paramName Name of the route parameter to validate (default: 'id')
 */
export function validateObjectId(paramName = 'id') {
  return (req: Request, res: Response, next: NextFunction): void => {
    const rawId = req.params[paramName];
    const id = Array.isArray(rawId) ? rawId[0] : rawId;

    if (!id) {
      res.status(400).json({
        error: 'Bad Request',
        message: `Missing ${paramName} parameter`,
      });
      return;
    }

    if (!isValidObjectId(id)) {
      res.status(400).json({
        error: 'Bad Request',
        message: `Invalid ${paramName}: must be a valid MongoDB ObjectId`,
      });
      return;
    }

    next();
  };
}

/**
 * Validate multiple ObjectId parameters
 * @param paramNames Array of parameter names to validate
 */
export function validateObjectIds(paramNames: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    for (const paramName of paramNames) {
      const rawId = req.params[paramName];
      const id = Array.isArray(rawId) ? rawId[0] : rawId;

      if (id && !isValidObjectId(id)) {
        res.status(400).json({
          error: 'Bad Request',
          message: `Invalid ${paramName}: must be a valid MongoDB ObjectId`,
        });
        return;
      }
    }

    next();
  };
}

/**
 * Sanitize string input by trimming and limiting length
 * @param input String to sanitize
 * @param maxLength Maximum allowed length
 * @returns Sanitized string
 */
export function sanitizeString(input: string, maxLength = 1000): string {
  if (!input || typeof input !== 'string') return '';
  return input.trim().substring(0, maxLength);
}

/**
 * Sanitize and validate email
 * @param email Email to validate
 * @returns Sanitized email or null if invalid
 */
export function sanitizeEmail(email: string): string | null {
  if (!email || typeof email !== 'string') return null;
  const sanitized = email.trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(sanitized)) return null;
  return sanitized;
}

/**
 * Sanitize and validate phone number
 * @param phone Phone number to validate
 * @returns Sanitized phone or null if invalid
 */
export function sanitizePhone(phone: string): string | null {
  if (!phone || typeof phone !== 'string') return null;
  const sanitized = phone.replace(/\D/g, ''); // Keep only digits
  // Valid phone: 5-15 digits
  if (sanitized.length < 5 || sanitized.length > 15) return null;
  return sanitized;
}

/**
 * Validate and sanitize numeric input
 * @param value Value to validate
 * @param min Minimum value
 * @param max Maximum value
 * @returns Valid number or null
 */
export function sanitizeNumber(
  value: any,
  min?: number,
  max?: number,
): number | null {
  const num = Number(value);
  if (isNaN(num)) return null;
  if (min !== undefined && num < min) return null;
  if (max !== undefined && num > max) return null;
  return num;
}
