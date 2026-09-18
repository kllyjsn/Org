export const DEFAULT_API_URL = 'https://api.topdown.sh';

export interface Settings {
  apiUrl: string;
  token: string;
  defaultWorkspaceId: string;
}

const DEFAULTS: Settings = {
  apiUrl: DEFAULT_API_URL,
  token: '',
  defaultWorkspaceId: '',
};

export function normalizeApiUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) return DEFAULT_API_URL;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export async function loadSettings(): Promise<Settings> {
  const stored = (await chrome.storage.local.get(DEFAULTS)) as Partial<Settings>;
  return {
    apiUrl: normalizeApiUrl(stored.apiUrl ?? DEFAULT_API_URL),
    token: stored.token ?? '',
    defaultWorkspaceId: stored.defaultWorkspaceId ?? '',
  };
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  if (patch.apiUrl !== undefined) patch.apiUrl = normalizeApiUrl(patch.apiUrl);
  await chrome.storage.local.set(patch);
}

/** Ask Chrome for host access to a non-default API origin (e.g. localhost). */
export async function ensureHostPermission(apiUrl: string): Promise<boolean> {
  const origin = `${new URL(apiUrl).origin}/*`;
  const perms = { origins: [origin] };
  if (await chrome.permissions.contains(perms)) return true;
  return chrome.permissions.request(perms);
}
