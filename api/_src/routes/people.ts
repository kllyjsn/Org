import { bad, param, type App } from '../http.js';
import {
  mapForUser,
  recordAnalytics,
  requireAuth,
  workspaceSellerProfile,
} from '../authz.js';
import { draftOutreach } from '../outreach.js';
import type { MapState, Person } from '../types.js';

function personFromState(map: { state: unknown }, personId: string): Person | null {
  return (
    ((map.state as MapState).people ?? []).find((p) => p.id === personId) ?? null
  );
}

export function registerPeopleRoutes(app: App): void {
  // Grounded outreach draft for a single stakeholder: email, LinkedIn note,
  // and call-prep bullets. Works without an LLM key via the template fallback.
  app.post('/api/maps/:id/people/:personId/outreach', requireAuth, async (c) => {
    const user = c.get('user');
    const [map, role] = await mapForUser(user, param(c, 'id'));
    if (!map || !role) return bad(c, 'not found', 404);
    const person = personFromState(map, param(c, 'personId'));
    if (!person) return bad(c, 'person not found', 404);
    const sellerProfile = await workspaceSellerProfile(map.workspace_id);
    const draft = await draftOutreach(
      map.state as MapState,
      person,
      sellerProfile
    );
    await recordAnalytics({
      eventName: 'outreach_drafted',
      userId: user.id,
      workspaceId: map.workspace_id,
      mapId: map.id,
      properties: { provider: draft.provider },
    });
    return c.json({ draft });
  });
}
