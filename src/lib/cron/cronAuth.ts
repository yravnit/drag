import { timingSafeEqual } from "crypto";

/**
 * Validates the Vercel Cron Authorization header using a timing-safe comparison.
 * Returns false when CRON_SECRET is unset or the token is missing/mismatched.
 * Intended for production-only use; skipped outside production.
 */
export function isCronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  // If CRON_SECRET is not configured, reject all requests
  if (!secret) {
    return false;
  }

  const authHeader = request.headers.get("Authorization");
  if (!authHeader) {
    return false;
  }

  const expected = `Bearer ${secret}`;

  // timingSafeEqual requires same-length buffers; reject immediately on length mismatch
  if (authHeader.length !== expected.length) {
    return false;
  }

  try {
    const a = Buffer.from(authHeader, "utf-8");
    const b = Buffer.from(expected, "utf-8");
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
