// Best-effort in-memory rate limit. On serverless this is per-instance, not global,
// so treat it as a courtesy throttle. The real spend backstop is a hard budget cap on
// the OpenAI key (see .env.example). Retrieval is embeddings-only, so cost is tiny.

const WINDOW_MS = 60_000;
const MAX_PER_MINUTE = 8;
const DAY_MS = 86_400_000;
const MAX_PER_DAY = 60;

type Entry = { recent: number[]; dayStart: number; dayCount: number };
const store = new Map<string, Entry>();

export function rateLimit(ip: string): { ok: boolean; reason?: string } {
  const now = Date.now();
  let e = store.get(ip);
  if (!e) {
    e = { recent: [], dayStart: now, dayCount: 0 };
    store.set(ip, e);
  }

  if (now - e.dayStart > DAY_MS) {
    e.dayStart = now;
    e.dayCount = 0;
  }

  e.recent = e.recent.filter((t) => now - t < WINDOW_MS);
  if (e.recent.length >= MAX_PER_MINUTE) return { ok: false, reason: "minute" };
  if (e.dayCount >= MAX_PER_DAY) return { ok: false, reason: "day" };

  e.recent.push(now);
  e.dayCount += 1;

  if (store.size > 5000) {
    for (const [k, v] of store) {
      if (now - v.dayStart > DAY_MS && v.recent.length === 0) store.delete(k);
    }
  }

  return { ok: true };
}
