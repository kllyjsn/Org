import {
  appUrl,
  bad,
  param,
  sendWorkbook,
  type App,
} from '../http.js';
import { query } from '../db.js';
import {
  mapForUser,
  requireAuth,
  workspaceAccessFor,
} from '../authz.js';
import { exaCompanyProfile } from '../exa.js';
import {
  buildTerritoryWorkbook,
  type ExportAccount,
} from '../territory-export.js';
import type { AccountBriefing } from '../briefing.js';
import type { StrategyInsights } from '../strategy.js';
import type { MapRow, MapState } from '../types.js';

async function exportAccountForMap(
  map: MapRow,
  origin: string
): Promise<ExportAccount> {
  const [strategyRows, briefingRows] = await Promise.all([
    query<{ insights: StrategyInsights }>(
      `SELECT insights FROM account_strategies
       WHERE map_id = $1 ORDER BY generated_at DESC LIMIT 1`,
      [map.id]
    ),
    query<{ briefing: AccountBriefing }>(
      `SELECT briefing FROM account_briefings
       WHERE map_id = $1 ORDER BY generated_at DESC LIMIT 1`,
      [map.id]
    ),
  ]);
  let state = map.state as MapState;
  let companyProfile = state.meta?.companyProfile ?? null;
  if (!companyProfile && process.env.EXA_API_KEY) {
    companyProfile = await exaCompanyProfile(map.domain);
    if (companyProfile) {
      state = {
        ...state,
        meta: { ...state.meta, companyProfile },
      };
      await query(
        `UPDATE maps
         SET state = jsonb_set(state, '{meta,companyProfile}', $2::jsonb)
         WHERE id = $1`,
        [map.id, JSON.stringify(companyProfile)]
      );
    }
  }
  return {
    id: map.id,
    name: map.name,
    domain: map.domain,
    companyName: map.company_name,
    isLiveOpportunity: map.is_live_opportunity,
    state,
    strategy: strategyRows[0]?.insights ?? null,
    briefing: briefingRows[0]?.briefing ?? null,
    mapUrl: `${origin}/maps/${map.id}`,
  };
}

export function registerExportRoutes(app: App): void {
  app.get('/api/maps/:id/export.xlsx', requireAuth, async (c) => {
    const user = c.get('user');
    const [map, role] = await mapForUser(user, param(c, 'id'));
    if (!map || !role) return bad(c, 'not found', 404);
    const account = await exportAccountForMap(map, appUrl(c));
    const workbook = await buildTerritoryWorkbook([account], {
      includeTerritorySheet: false,
    });
    return sendWorkbook(
      c,
      workbook,
      `${account.companyName || account.name} - Account Plan.xlsx`
    );
  });

  app.get('/api/workspaces/:id/export.xlsx', requireAuth, async (c) => {
    const user = c.get('user');
    const workspaceId = param(c, 'id');
    const access = await workspaceAccessFor(user, workspaceId);
    if (!access) return bad(c, 'not a member', 403);
    const rows = access.scoped
      ? await query<MapRow>(
          `SELECT id, workspace_id, name, domain, company_name, state,
                  is_live_opportunity, created_by, created_at, updated_at
           FROM maps WHERE workspace_id = $1
             AND id IN (
               SELECT map_id FROM member_map_access
               WHERE workspace_id = $1 AND user_id = $2
             )
           ORDER BY updated_at DESC`,
          [workspaceId, user.id]
        )
      : await query<MapRow>(
          `SELECT id, workspace_id, name, domain, company_name, state,
                  is_live_opportunity, created_by, created_at, updated_at
           FROM maps WHERE workspace_id = $1 ORDER BY updated_at DESC`,
          [workspaceId]
        );
    const workspaces = await query<{ name: string }>(
      'SELECT name FROM workspaces WHERE id = $1',
      [workspaceId]
    );
    if (!workspaces[0]) return bad(c, 'workspace not found', 404);
    const accounts = await Promise.all(
      rows.map((map) => exportAccountForMap(map, appUrl(c)))
    );
    const workbook = await buildTerritoryWorkbook(accounts, {
      includeTerritorySheet: true,
    });
    return sendWorkbook(
      c,
      workbook,
      `Territory - ${workspaces[0].name}.xlsx`
    );
  });
}
