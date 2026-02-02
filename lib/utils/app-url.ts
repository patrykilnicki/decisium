import { NextRequest } from 'next/server';

/**
 * Get the canonical app URL for the current environment.
 * Works for localhost:3000, Vercel preview (dev-decisium.vercel.app), and production.
 *
 * Priority:
 * 1. Request URL origin - most reliable (actual URL the user hit)
 * 2. Request headers (x-forwarded-host + x-forwarded-proto) - when behind proxy
 * 3. NEXT_PUBLIC_APP_URL - explicit env config
 * 4. VERCEL_URL / VERCEL_BRANCH_URL - auto-set by Vercel
 * 5. localhost:3000 - local development fallback
 */
export function getAppUrl(request?: NextRequest | Request): string {
  if (request) {
    // 1. From request URL - actual URL the user requested
    try {
      const url = request instanceof NextRequest ? request.nextUrl : new URL(request.url);
      const origin = url.origin;
      if (origin) {
        return origin;
      }
    } catch {
      // Fall through
    }

    // 2. From Host header (always sent by client)
    const host = request.headers.get('host');
    if (host) {
      const proto = request.headers.get('x-forwarded-proto') ?? 'https';
      return `${proto === 'https' ? 'https' : 'http'}://${host.split(',')[0].trim()}`;
    }

    // 3. From forwarded headers (when behind proxy)
    const forwardedHost = request.headers.get('x-forwarded-host');
    const forwardedProto = request.headers.get('x-forwarded-proto');
    if (forwardedHost) {
      const protocol = forwardedProto === 'https' ? 'https' : 'http';
      return `${protocol}://${forwardedHost.split(',')[0].trim()}`;
    }
  }

  // 3. Explicit env (set per deployment)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl) {
    return appUrl.replace(/\/$/, ''); // strip trailing slash
  }

  // 4. Vercel auto-set (VERCEL_BRANCH_URL for branch deploys like dev-decisium.vercel.app)
  const vercelBranchUrl = process.env.VERCEL_BRANCH_URL;
  if (vercelBranchUrl) {
    return `https://${vercelBranchUrl}`;
  }
  const vercelUrl = process.env.VERCEL_URL;
  if (vercelUrl) {
    return `https://${vercelUrl}`;
  }

  // 5. Local development
  return 'http://localhost:3000';
}
