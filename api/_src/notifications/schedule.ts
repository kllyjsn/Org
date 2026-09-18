import { createHash } from 'node:crypto';
import type { MapChangeAlert } from '../changes.js';

export function changeAlertDedupeKey(
  mapId: string,
  alerts: Pick<MapChangeAlert, 'id'>[]
): string {
  const ids = alerts
    .map((alert) => alert.id)
    .sort()
    .join(',');
  const hash = createHash('sha1').update(ids).digest('hex').slice(0, 12);
  return `change:${mapId}:${hash}`;
}

export function briefDedupeKey(touchpointExternalId: string): string {
  return `brief:${touchpointExternalId}`;
}

export function isoWeek(date: Date): string {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function weeklyDedupeKey(workspaceId: string, week: string): string {
  return `weekly:${workspaceId}:${week}`;
}
