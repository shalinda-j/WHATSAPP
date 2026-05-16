import { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Wraps an async route handler so a rejection forwards to Express's error
 * middleware instead of becoming an unhandled promise rejection. Express 5
 * does this for some shapes automatically, but not consistently across
 * middleware signatures — wrapping explicitly removes the footgun.
 */
export function asyncHandler<P = unknown, ResBody = unknown, ReqBody = unknown>(
  fn: (
    req: Request<P, ResBody, ReqBody>,
    res: Response<ResBody>,
    next: NextFunction,
  ) => Promise<unknown>,
): RequestHandler<P, ResBody, ReqBody> {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
