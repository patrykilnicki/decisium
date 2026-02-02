import type { NextRequest } from 'next/server';

/**
 * Get the canonical app URL for the current environment.
 * Works for localhost:3000, Vercel preview (dev-decisium.vercel.app), and production.
 *
 * Priority:
 * 1. Request headers (x-forwarded-host + x-forwarded-proto) - when behind proxy/Vercel
 * 2. NEXT_PUBLIC_APP_URL - explicit env config
 * 3. VERCEL_URL - auto-set by Vercel for deployments
 * 4. localhost:3000 - local development fallback
 */
export function getAppUrl(request?: NextRequest | Request): string {
  // 1. From request headers (Vercel, proxies set these)
  if (request) {
    const forwardedHost = request.headers.get('x-forwarded-host');
    const forwardedProto = request.headers.get('x-forwarded-proto');
    if (forwardedHost) {
      const protocol = forwardedProto === 'https' ? 'https' : 'http';
      return `${protocol}://${forwardedHost.split(',')[0].trim()}`;
    }
  }

  // 2. Explicit env (set per deployment: localhost, dev URL, production)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl) {
    return appUrl.replace(/\/$/, ''); // strip trailing slash
  }

  // 3. Vercel auto-set (deployments: preview + production)
  const vercelUrl = process.env.VERCEL_URL;
  if (vercelUrl) {
    return `https://${vercelUrl}`;
  }

  // 4. Local development
  return 'http://localhost:3000';
}
