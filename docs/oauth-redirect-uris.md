# OAuth redirect URIs

To fix **redirect_uri_mismatch**, add the exact redirect URI(s) below in [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials → your OAuth 2.0 Client ID → **Authorized redirect URIs**.

## Which OAuth client?

- **Google Calendar (or other integrations)**  
  Use the OAuth client that has the Google Calendar API (or the API you’re connecting) enabled. Add the **Integrations** URIs below.

- **Supabase Auth (Google Sign-In)**  
  Supabase uses its own redirect URI (e.g. `https://<project-ref>.supabase.co/auth/v1/callback`). In Google Cloud Console, add that Supabase callback URL to the OAuth client that Supabase is using (the one whose client ID you put in Supabase Dashboard).

---

## Integrations (Google Calendar, etc.)

The app uses this path: `/api/integrations/{provider}/callback`.

Add **every** environment you use (no trailing slash):

| Environment | Redirect URI |
|-------------|--------------|
| **Production** | `https://your-production-domain.com/api/integrations/google_calendar/callback` |
| **Vercel dev/preview** | `https://dev-decisium.vercel.app/api/integrations/google_calendar/callback` |
| **Local** | `http://localhost:3000/api/integrations/google_calendar/callback` |

Replace `your-production-domain.com` or `dev-decisium.vercel.app` with the actual host you use.

---

## App sign-in (Supabase + Google)

Sign-in uses: `{origin}/auth/callback`.  
Supabase receives the OAuth callback first; the **Authorized redirect URI** in Google must be the **Supabase** callback URL (from Supabase Dashboard → Authentication → URL Configuration).  
Your app’s “Redirect URLs” in Supabase should include e.g. `https://dev-decisium.vercel.app/auth/callback` and `http://localhost:3000/auth/callback`.
