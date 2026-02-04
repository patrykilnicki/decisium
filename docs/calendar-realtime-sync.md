# Real-time calendar sync: official docs & industry practice

Reference: [Google Calendar API – Push notifications](https://developers.google.com/calendar/api/guides/push) and [Synchronize resources efficiently](https://developers.google.com/workspace/calendar/api/guides/sync).

---

## 1. Push notifications (webhook)

### What Google sends

- **HTTPS POST** to your webhook URL when a watched resource changes.
- **No message body** – only headers. You must call the API to get actual changes.
- **Headers**: `X-Goog-Channel-ID`, `X-Goog-Resource-State` (`sync` or `exists`), `X-Goog-Resource-ID`, `X-Goog-Message-Number`, etc.

### Resource states

| `X-Goog-Resource-State` | Meaning |
|-------------------------|--------|
| `sync` | Channel was just created. Safe to ignore, or use to prepare for later events. |
| `exists` | Resource changed (create/update/delete). Perform incremental sync. |

### How to respond (official)

- **Success**: Return **200, 201, 202, 204, or 102**.
- **Retries**: If you return **500, 502, 503, or 504**, Google retries with **exponential backoff**.
- **Respond quickly**: Acknowledge with 200 quickly; do the actual sync **asynchronously** (e.g. queue + worker or cron). Do not block the webhook on long sync work.

### Channel lifecycle

- Channels **expire** (e.g. 7 days). You must **renew** by calling the `watch` method again before expiry.
- There is **no automatic renewal**; use a cron to recreate channels when they are close to expiring.

### Reliability (official)

> Notifications are not 100% reliable. Expect a small percentage of messages to be dropped under normal conditions. Make sure to handle these missing messages gracefully, so that the application still syncs even if no push messages are received.

So: **use periodic full/incremental sync** (e.g. every 6 hours) as a backup, not only push.

---

## 2. Incremental sync (syncToken)

### Flow (official)

1. **Initial sync**: Full list request (optional filters, e.g. date range). Store **`nextSyncToken`** from the response (on the **last page** if paginated).
2. **Later syncs**: List request with **`syncToken`** (your stored token). Response contains only changes since that token. Store the new **`nextSyncToken`** from the last page.
3. **Pagination**: If the response has **`nextPageToken`** but no `nextSyncToken`, keep requesting with the **same `syncToken`** and **`pageToken`** until you get **`nextSyncToken`** on the last page. Use that as the new stored token.

### Sync token invalid (410 Gone)

- The server may respond with **HTTP 410 Gone** (e.g. token expired or ACL changes).
- **Official guidance**: Treat 410 as “sync token invalid” → **full wipe of client state** and **new full sync**; then store the new `nextSyncToken`.

### Query restrictions

- With **syncToken**, you cannot use most list filters (e.g. `timeMin`/`timeMax`). Use the same query shape as in the initial full sync when doing incremental pages.

---

## 3. Industry best practices (webhooks)

- **Respond immediately** with 200, then process (e.g. enqueue and sync in a job).
- **Idempotency**: Same change can be delivered more than once; use idempotent processing (e.g. upsert by event id, or queue per resource and dedupe).
- **Handle duplicates**: Multiple webhook calls for one change are normal; design so duplicate processing is safe.
- **Periodic sync as backup**: Don’t rely only on push; run scheduled sync (e.g. every N hours) so missed notifications don’t leave data stale.
- **Renew channels** before expiry so push continues to work.

---

## 4. How we implement it

| Requirement | Implementation |
|-------------|----------------|
| Respond quickly | Webhook returns 200 immediately after enqueuing to `pending_calendar_syncs`. |
| Async processing | Cron `/api/cron/process-pending-calendar-syncs` every 1 min processes the queue (Vercel invokes with GET; set `CRON_SECRET` so it runs). |
| Incremental sync | We store `sync_token` in `calendar_watches`; sync pipeline uses it for incremental list and stores `nextSyncToken`. |
| Backup sync | Cron `/api/cron/integration-sync` every 6 hours syncs all active integrations. |
| Channel renewal | Cron `/api/cron/renew-calendar-watches` daily recreates expiring watches. |
| 410 handling | Sync pipeline treats 410 from Calendar API as invalid token and retries with full sync (see code). |

### Vercel Cron: make it run automatically

- **Vercel invokes cron with GET** (not POST). The route handles GET when the request is authorized.
- **Set `CRON_SECRET`** in the Vercel project (Settings → Environment Variables): a random string (e.g. 16+ chars). Vercel sends `Authorization: Bearer <CRON_SECRET>` when invoking the cron; the route uses this to authorize.
- **Production only**: Cron runs on the **production** deployment. Preview deployments do not run cron.
- **Plan**: The `*/1 * * * *` (every 1 min) schedule requires a plan that allows sub-daily cron (Hobby allows only once per day). Use Pro/Team for every-minute cron, or change the schedule in `vercel.json` if on Hobby.
