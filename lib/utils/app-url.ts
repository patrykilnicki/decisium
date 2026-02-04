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
function isLocalhostUrl(url: string): boolean {
  return (
    url.startsWith('http://localhost') || url.startsWith('https://localhost')
  );
}

export function getAppUrl(request?: NextRequest | Request): string {
  let fromRequest: string | null = null;

  if (request) {
    // 1. From request URL - actual URL the user requested
    try {
      const url = request instanceof NextRequest ? request.nextUrl : new URL(request.url);
      const origin = url.origin;
      if (origin) {
        fromRequest = origin;
      }
    } catch {
      // Fall through
    }

    if (!fromRequest) {
      // 2. From Host header (always sent by client)
      const host = request.headers.get('host');
      if (host) {
        const proto = request.headers.get('x-forwarded-proto') ?? 'https';
        fromRequest = `${proto === 'https' ? 'https' : 'http'}://${host.split(',')[0].trim()}`;
      }
    }

    if (!fromRequest) {
      // 3. From forwarded headers (when behind proxy)
      const forwardedHost = request.headers.get('x-forwarded-host');
      const forwardedProto = request.headers.get('x-forwarded-proto');
      if (forwardedHost) {
        const protocol = forwardedProto === 'https' ? 'https' : 'http';
        fromRequest = `${protocol}://${forwardedHost.split(',')[0].trim()}`;
      }
    }

    // On Vercel, never redirect to localhost (e.g. auth callback must stay on production host)
    if (fromRequest && !isLocalhostUrl(fromRequest)) {
      return fromRequest;
    }
    if (fromRequest && isLocalhostUrl(fromRequest)) {
      const onVercel = process.env.VERCEL_URL ?? process.env.VERCEL_BRANCH_URL;
      if (onVercel) {
        return process.env.VERCEL_BRANCH_URL
          ? `https://${process.env.VERCEL_BRANCH_URL}`
          : `https://${process.env.VERCEL_URL}`;
      }
      return fromRequest;
    }
  }

  // 3. Explicit env (set per deployment)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl) {
    const normalized = appUrl.replace(/\/$/, ''); // strip trailing slash
    // Never use localhost when we're on Vercel (avoids auth callback redirecting to localhost in production)
    const onVercel = process.env.VERCEL_URL ?? process.env.VERCEL_BRANCH_URL;
    if (!isLocalhostUrl(normalized) || !onVercel) {
      return normalized;
    }
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

/**
 * Build the Google Calendar webhook URL for push notifications.
 * When Vercel Deployment Protection is enabled, appends the bypass secret so
 * Google's POST requests (which have no auth) are allowed (avoids 401).
 * @see https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation
 */
export function getGoogleCalendarWebhookUrl(baseUrl: string): string {
  const path = '/api/webhooks/google-calendar';
  const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  const url = `${baseUrl.replace(/\/$/, '')}${path}`;
  if (bypassSecret) {
    return `${url}?x-vercel-protection-bypass=${encodeURIComponent(bypassSecret)}`;
  }
  return url;
}
