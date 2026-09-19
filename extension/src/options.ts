import { ApiError, ExtensionApi } from './api';
import { ensureHostPermission, loadSettings, normalizeApiUrl, saveSettings } from './settings';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>('form');
const apiUrl = $<HTMLInputElement>('apiUrl');
const token = $<HTMLInputElement>('token');
const workspace = $<HTMLSelectElement>('workspace');
const status = $<HTMLParagraphElement>('status');

function say(text: string, tone: 'muted' | 'ok' | 'bad' = 'muted') {
  status.className = tone;
  status.textContent = text;
}

async function fillWorkspaces(url: string, tok: string, selected: string) {
  workspace.replaceChildren(new Option('(first available)', ''));
  if (!tok) return;
  try {
    const me = await new ExtensionApi({ apiUrl: url, token: tok }).me();
    for (const ws of me.workspaces) {
      workspace.append(new Option(`${ws.name} (${ws.role})`, ws.id, false, ws.id === selected));
    }
    say(`Signed in as ${me.user.email}.`, 'ok');
  } catch (err) {
    say(err instanceof ApiError ? err.message : 'Could not load workspaces.', 'bad');
  }
}

async function init() {
  const s = await loadSettings();
  apiUrl.value = s.apiUrl;
  token.value = s.token;
  await fillWorkspaces(s.apiUrl, s.token, s.defaultWorkspaceId);
}

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const url = normalizeApiUrl(apiUrl.value);
  const tok = token.value.trim();
  say('Saving…');
  if (!(await ensureHostPermission(url))) {
    say(`Chrome did not grant access to ${url}.`, 'bad');
    return;
  }
  await saveSettings({ apiUrl: url, token: tok, defaultWorkspaceId: workspace.value });
  apiUrl.value = url;
  await fillWorkspaces(url, tok, workspace.value);
  if (!tok) say('Saved.', 'ok');
});

$<HTMLButtonElement>('clear').addEventListener('click', async () => {
  await saveSettings({ token: '', defaultWorkspaceId: '' });
  token.value = '';
  workspace.replaceChildren(new Option('(first available)', ''));
  say('Token removed from this browser.', 'ok');
});

void init();
