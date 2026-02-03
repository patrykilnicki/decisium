/**
 * Trigger daily summary generation for all users (yesterday's date).
 * Run: pnpm run run-daily-summary
 *
 * Requires .env.local with CRON_SECRET and Next.js dev server at localhost:3000,
 * or set BASE_URL to your deployed API.
 */
import "dotenv/config";
import { config } from "dotenv";
import { resolve } from "path";

// Load .env.local so CRON_SECRET is available
config({ path: resolve(process.cwd(), ".env.local") });

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const CRON_SECRET = process.env.CRON_SECRET;

async function main() {
  if (!CRON_SECRET) {
    console.error("CRON_SECRET is not set. Add it to .env.local");
    process.exit(1);
  }

  const url = `${BASE_URL}/api/cron/daily-summary`;
  console.log("Calling", url, "...");

  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
    redirect: "manual",
  });

  const text = await res.text();
  if (!res.ok) {
    console.error("Error:", res.status, text);
    process.exit(1);
  }

  try {
    const data = JSON.parse(text);
    console.log(JSON.stringify(data, null, 2));
  } catch {
    console.log(text);
  }
}

main();
