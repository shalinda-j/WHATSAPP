/**
 * Race a promise against a timeout. If the promise does not settle within `ms`
 * milliseconds, the returned promise rejects with a timeout error.
 *
 * The internal timer is ALWAYS cleared (via finally) once the race settles,
 * so it never leaks even when the underlying promise resolves before the
 * timeout fires.
 *
 * @param p     The promise to guard.
 * @param ms    Timeout in milliseconds.
 * @param label Human-readable label used in the timeout error message.
 */
export async function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  label = 'operation',
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
  });

  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
