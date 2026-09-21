import { bad, type App } from '../http.js';
import { query, now } from '../db.js';
import { refreshNextDueMap } from '../background-refresh.js';
import { processDueWatches } from '../watchlist.js';
import { activeProvider } from '../llm.js';

export function registerSystemRoutes(app: App): void {
  app.get('/api/health', (c) =>
    c.json({ ok: true, provider: activeProvider() })
  );

  app.get('/api/cron/refresh', async (c) => {
    const secret = process.env.CRON_SECRET;
    if (!secret) return bad(c, 'background refresh is not configured', 503);
    if (c.req.header('authorization') !== `Bearer ${secret}`) {
      return bad(c, 'unauthorized', 401);
    }
    try {
      await query('DELETE FROM sessions WHERE expires_at < $1', [now()]);
      await query(
        `DELETE FROM research_jobs
         WHERE created_at::timestamptz < NOW() - INTERVAL '7 days'`
      );
      const refreshed = await refreshNextDueMap();
      const watches = await processDueWatches(3).catch((error) => {
        console.error('watch checks failed', error);
        return { processed: 0, errors: 0 };
      });
      return c.json({ ...refreshed, watches });
    } catch (error) {
      console.error('background refresh failed', error);
      return bad(c, 'background refresh failed', 500);
    }
  });
}
