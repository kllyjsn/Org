import { ApiError, ExtensionApi, guessDomain, type Account } from './api';
import { h, replaceChildren } from './dom';
import { sendToTab, type ContentResponse } from './messages';
import type { PageContext, ParsedPerson } from './parsers';
import { ensureHostPermission, loadSettings, saveSettings, type Settings } from './settings';

const view = document.getElementById('view') as HTMLElement;
const who = document.getElementById('who') as HTMLElement;
document.getElementById('open-options')!.addEventListener('click', () => {
  void chrome.runtime.openOptionsPage();
});

const PAGE_DELAY_MS = 2500; // polite pause between Sales Navigator pages

function webAppUrl(settings: Settings): string {
  const url = new URL(settings.apiUrl);
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
    return 'http://localhost:5173';
  }
  return `${url.protocol}//${url.hostname.replace(/^api\./, '')}`;
}

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong.';
}

// ------------------------------------------------------------- sign-in

function renderSignIn(settings: Settings, error = ''): void {
  const input = h('input', { type: 'password', placeholder: 'tdx_…', autocomplete: 'off' });
  const status = h('p', { class: error ? 'bad' : 'muted' }, error);
  const form = h(
    'form',
    {
      onsubmit: async (ev) => {
        ev.preventDefault();
        const token = input.value.trim();
        if (!token) return;
        status.className = 'muted';
        status.textContent = 'Checking token…';
        try {
          if (!(await ensureHostPermission(settings.apiUrl))) {
            throw new ApiError(0, `Allow access to ${settings.apiUrl} to continue.`);
          }
          const me = await new ExtensionApi({ ...settings, token }).me();
          await saveSettings({
            token,
            defaultWorkspaceId: settings.defaultWorkspaceId || me.workspaces[0]?.id || '',
          });
          void init();
        } catch (err) {
          status.className = 'bad';
          status.textContent = errorMessage(err);
        }
      },
    },
    h('h2', {}, 'Connect to TopDown'),
    h(
      'p',
      { class: 'muted' },
      'Create a personal token in TopDown (Accounts → Chrome extension) and paste it here. Tokens are stored locally in this browser only.'
    ),
    h('label', {}, 'Extension token', input),
    h('button', { class: 'primary', type: 'submit' }, 'Sign in'),
    status,
    h('p', { class: 'muted' }, `API: ${settings.apiUrl}`)
  );
  replaceChildren(view, form);
  input.focus();
}

// ------------------------------------------------------ account picker

interface PickerOptions {
  api: ExtensionApi;
  initialQuery: string;
  initialDomain: string;
  workspaceId: string;
  onSelect: (account: Account | null) => void;
}

function accountPicker(opts: PickerOptions): HTMLElement {
  let selected: Account | null = null;
  let timer: number | undefined;
  const list = h('ul', { class: 'accounts', 'aria-label': 'Accounts' });
  const status = h('p', { class: 'muted' });
  const search = h('input', {
    type: 'text',
    value: opts.initialQuery,
    placeholder: 'Search accounts by name or domain',
    oninput: () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void load(search.value.trim()), 200);
    },
  });
  const domainInput = h('input', {
    type: 'text',
    value: opts.initialDomain,
    placeholder: 'acme.com',
  });
  const createBtn = h('button', {
    class: 'fixed',
    type: 'button',
    onclick: async () => {
      const domain = domainInput.value.trim().toLowerCase();
      if (!domain) return;
      createBtn.disabled = true;
      status.className = 'muted';
      status.textContent = 'Creating account…';
      try {
        const { id, created } = await opts.api.createAccount({
          domain,
          name: opts.initialQuery || undefined,
          workspaceId: opts.workspaceId || undefined,
        });
        const accounts = await opts.api.accounts({ domain });
        const account = accounts.find((a) => a.id === id) ?? accounts[0] ?? null;
        render(accounts);
        if (account) choose(account);
        status.textContent = created
          ? 'Account created. Research runs in the background.'
          : 'That account already existed — selected it.';
      } catch (err) {
        status.className = 'bad';
        status.textContent = errorMessage(err);
      } finally {
        createBtn.disabled = false;
      }
    },
  }, 'Create');

  const choose = (account: Account) => {
    selected = account;
    for (const btn of list.querySelectorAll('button')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.id === account.id));
    }
    opts.onSelect(account);
  };

  const render = (accounts: Account[]) => {
    replaceChildren(
      list,
      ...accounts.map((a) =>
        h(
          'li',
          {},
          h(
            'button',
            {
              type: 'button',
              dataset: { id: a.id },
              'aria-pressed': String(selected?.id === a.id),
              onclick: () => choose(a),
            },
            h('span', {}, a.name, ' ', h('span', { class: 'domain' }, a.domain)),
            a.match === 'domain'
              ? h('span', { class: 'badge' }, 'domain match')
              : h('span', { class: 'domain' }, `${a.peopleCount} people`)
          )
        )
      ),
      accounts.length === 0 &&
        h('li', {}, h('p', { class: 'muted', style: 'padding:8px 10px' }, 'No matching accounts — create one below.'))
    );
  };

  const load = async (q: string) => {
    status.className = 'muted';
    status.textContent = 'Loading accounts…';
    try {
      let accounts: Account[] = [];
      if (opts.initialDomain && q === opts.initialQuery) {
        accounts = await opts.api.accounts({ domain: opts.initialDomain });
      }
      if (accounts.length === 0) accounts = await opts.api.accounts(q ? { q } : {});
      render(accounts);
      status.textContent = '';
      const best = accounts.find((a) => a.match === 'domain') ?? (accounts.length === 1 ? accounts[0] : null);
      if (best && !selected) choose(best);
      else if (selected && !accounts.some((a) => a.id === selected?.id)) {
        selected = null;
        opts.onSelect(null);
      }
    } catch (err) {
      status.className = 'bad';
      status.textContent = errorMessage(err);
    }
  };
  void load(opts.initialQuery);

  return h(
    'div',
    { style: 'display:grid;gap:8px' },
    h('label', {}, 'Account', search),
    list,
    h('div', { class: 'row' }, h('label', {}, 'New account domain', domainInput), createBtn),
    status
  );
}

// ---------------------------------------------------------- profile page

function personCard(p: ParsedPerson): HTMLElement {
  return h(
    'div',
    { class: 'card' },
    h('div', { class: 'name' }, p.name),
    p.title && h('div', {}, p.title),
    h('div', { class: 'muted' }, [p.company, p.location].filter(Boolean).join(' · ')),
    p.linkedinUrl && h('a', { href: p.linkedinUrl, target: '_blank' }, p.linkedinUrl.replace(/^https?:\/\/(www\.)?/, ''))
  );
}

function renderProfile(api: ExtensionApi, settings: Settings, person: ParsedPerson): void {
  let account: Account | null = null;
  const result = h('p', { class: 'muted' });
  const addBtn = h('button', { class: 'primary', type: 'button', disabled: true }, 'Add to roster');
  addBtn.addEventListener('click', async () => {
    if (!account) return;
    addBtn.disabled = true;
    result.className = 'muted';
    result.textContent = 'Adding…';
    try {
      const r = await api.addToRoster(account.id, [person], 'linkedin_url');
      result.className = 'ok';
      result.textContent =
        r.alreadyKnown > 0
          ? `${person.name} was already on ${account.name}'s roster — details refreshed.`
          : `Added ${person.name} to ${account.name}. Roster now has ${r.counts.suggested + r.counts.added} people.`;
    } catch (err) {
      result.className = 'bad';
      result.textContent = errorMessage(err);
      addBtn.disabled = false;
    }
  });
  replaceChildren(
    view,
    personCard(person),
    accountPicker({
      api,
      initialQuery: person.company ?? '',
      initialDomain: guessDomain(person.company),
      workspaceId: settings.defaultWorkspaceId,
      onSelect: (a) => {
        account = a;
        addBtn.disabled = !a;
        addBtn.textContent = a ? `Add to ${a.name}` : 'Add to roster';
      },
    }),
    addBtn,
    result
  );
}

// ------------------------------------------------------- sales navigator

function renderSales(api: ExtensionApi, settings: Settings, tabId: number, ctx: PageContext): void {
  let account: Account | null = null;
  let people = ctx.people;
  const checked = new Set(people.map((_, i) => i));
  const list = h('ul', { class: 'people', 'aria-label': 'Leads on this page' });
  const count = h('h2', {});
  const result = h('p', { class: 'muted' });
  const bar = h('div', {});
  const progress = h('div', { class: 'progress', hidden: true }, bar);

  const syncBtn = h('button', { class: 'primary', type: 'button', disabled: true });
  const allBtn = h('button', { type: 'button', disabled: true }, 'Sync all pages');
  const selectAll = h('input', { type: 'checkbox', checked: true });

  const updateButtons = () => {
    count.textContent = `${checked.size} of ${people.length} leads selected`;
    syncBtn.textContent = `Sync ${checked.size} to roster`;
    syncBtn.disabled = !account || checked.size === 0;
    allBtn.disabled = !account || !ctx.pagination.hasNext;
    selectAll.checked = checked.size === people.length && people.length > 0;
  };

  const renderList = () => {
    replaceChildren(
      list,
      ...people.map((p, i) => {
        const box = h('input', {
          type: 'checkbox',
          checked: checked.has(i),
          onchange: () => {
            if (box.checked) checked.add(i);
            else checked.delete(i);
            updateButtons();
          },
        });
        return h(
          'li',
          {},
          h(
            'label',
            {},
            box,
            h('span', {}, p.name, h('div', { class: 'sub' }, [p.title, p.company].filter(Boolean).join(' · ')))
          )
        );
      })
    );
    updateButtons();
  };

  selectAll.addEventListener('change', () => {
    checked.clear();
    if (selectAll.checked) people.forEach((_, i) => checked.add(i));
    renderList();
  });

  const push = async (batch: ParsedPerson[]) => {
    if (!account || batch.length === 0) return { upserted: 0, alreadyKnown: 0 };
    return api.addToRoster(account.id, batch, 'sales_navigator');
  };

  syncBtn.addEventListener('click', async () => {
    syncBtn.disabled = allBtn.disabled = true;
    result.className = 'muted';
    result.textContent = 'Syncing…';
    try {
      const r = await push(people.filter((_, i) => checked.has(i)));
      result.className = 'ok';
      result.textContent = `Synced ${r.upserted} lead${r.upserted === 1 ? '' : 's'} to ${account?.name} (${r.alreadyKnown} already known).`;
    } catch (err) {
      result.className = 'bad';
      result.textContent = errorMessage(err);
    } finally {
      updateButtons();
    }
  });

  allBtn.addEventListener('click', async () => {
    syncBtn.disabled = allBtn.disabled = true;
    progress.hidden = false;
    let upserted = 0;
    let known = 0;
    let page = ctx.pagination.page ?? 1;
    let stopReason: string | null = null;
    const total = ctx.pagination.total;
    const setProgress = () => {
      bar.style.width = total ? `${Math.min(100, (page / total) * 100)}%` : '50%';
      result.className = 'muted';
      result.textContent = `Page ${page}${total ? ` of ${total}` : ''} — ${upserted} synced, ${known} already known…`;
    };
    try {
      let current = people.filter((_, i) => checked.has(i));
      for (;;) {
        setProgress();
        const r = await push(current);
        upserted += r.upserted;
        known += r.alreadyKnown;
        setProgress();
        const next = await sendToTab<Extract<ContentResponse, { type: 'nextPage' }>>(tabId, {
          type: 'nextPage',
          previousFirstUrl: people[0]?.linkedinUrl ?? null,
        });
        if (!next.ok) {
          if (next.reason !== 'no next page') stopReason = next.reason ?? 'could not advance';
          break;
        }
        await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
        const parsed = await sendToTab<Extract<ContentResponse, { type: 'page' }>>(tabId, { type: 'parse' });
        ctx = parsed.context;
        people = ctx.people;
        page = ctx.pagination.page ?? page + 1;
        checked.clear();
        people.forEach((_, i) => checked.add(i));
        renderList();
        current = people;
        if (people.length === 0) break;
      }
      const incomplete = stopReason ?? (total && page < total ? `stopped at page ${page} of ${total}` : null);
      bar.style.width = incomplete ? `${total ? Math.min(100, (page / total) * 100) : 50}%` : '100%';
      result.className = incomplete ? 'bad' : 'ok';
      result.textContent = incomplete
        ? `Stopped (${incomplete}) — synced ${upserted} leads to ${account?.name} (${known} already known). Scroll/refresh the page and retry.`
        : `Done — synced ${upserted} leads to ${account?.name} (${known} already known).`;
    } catch (err) {
      result.className = 'bad';
      result.textContent = `${errorMessage(err)} Synced ${upserted} so far.`;
    } finally {
      updateButtons();
    }
  });

  renderList();
  replaceChildren(
    view,
    h(
      'div',
      { class: 'row' },
      count,
      h('label', { class: 'fixed', style: 'display:flex;gap:6px;align-items:center' }, selectAll, 'Select all on page')
    ),
    list,
    accountPicker({
      api,
      initialQuery: people[0]?.company ?? '',
      initialDomain: guessDomain(people[0]?.company ?? null),
      workspaceId: settings.defaultWorkspaceId,
      onSelect: (a) => {
        account = a;
        updateButtons();
      },
    }),
    h('div', { class: 'row' }, syncBtn, allBtn),
    progress,
    result
  );
}

// -------------------------------------------------------------- fallback

function renderElsewhere(api: ExtensionApi, settings: Settings, note: string): void {
  replaceChildren(
    view,
    h('p', { class: 'muted' }, note),
    accountPicker({
      api,
      initialQuery: '',
      initialDomain: '',
      workspaceId: settings.defaultWorkspaceId,
      onSelect: (a) => {
        if (a) void chrome.tabs.create({ url: `${webAppUrl(settings)}/map/${a.id}` });
      },
    }),
    h('button', { type: 'button', onclick: () => void chrome.tabs.create({ url: webAppUrl(settings) }) }, 'Open TopDown')
  );
}

// ------------------------------------------------------------------ init

async function currentPage(): Promise<{ tabId: number; ctx: PageContext | null; url: string }> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url ?? '';
  if (!tab?.id || !/^https:\/\/(www\.)?linkedin\.com\//.test(url)) {
    return { tabId: tab?.id ?? -1, ctx: null, url };
  }
  const tabId = tab.id;
  const parse = () =>
    sendToTab<Extract<ContentResponse, { type: 'page' }>>(tabId, { type: 'parse' });
  try {
    return { tabId, ctx: (await parse()).context, url };
  } catch {
    // Tab was open before the extension was installed/reloaded: inject on demand.
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      return { tabId, ctx: (await parse()).context, url };
    } catch {
      return { tabId, ctx: null, url };
    }
  }
}

async function init(): Promise<void> {
  const settings = await loadSettings();
  who.textContent = '';
  if (!settings.token) return renderSignIn(settings);
  const api = new ExtensionApi(settings);
  replaceChildren(view, h('p', { class: 'muted' }, 'Reading page…'));

  const [meResult, page] = await Promise.all([
    api.me().then(
      (me) => ({ ok: true as const, me }),
      (err: unknown) => ({ ok: false as const, err })
    ),
    currentPage(),
  ]);
  if (!meResult.ok) {
    if (meResult.err instanceof ApiError && meResult.err.status === 401) {
      await saveSettings({ token: '' });
      return renderSignIn(settings, 'Your token was revoked or expired. Paste a new one.');
    }
    return renderSignIn(settings, errorMessage(meResult.err));
  }
  who.textContent = meResult.me.user.email;

  const { ctx, tabId, url } = page;
  if (ctx?.kind === 'profile' && ctx.person) return renderProfile(api, settings, ctx.person);
  if (ctx?.kind === 'profile') {
    return renderElsewhere(api, settings, "Couldn't read this profile. Scroll to the top and reopen the popup.");
  }
  if ((ctx?.kind === 'sales_search' || ctx?.kind === 'sales_list') && ctx.people.length > 0) {
    return renderSales(api, settings, tabId, ctx);
  }
  if (ctx?.kind === 'sales_search' || ctx?.kind === 'sales_list') {
    return renderElsewhere(api, settings, 'No leads found on this page yet. Wait for the list to load and reopen the popup.');
  }
  const isLinkedIn = /linkedin\.com/.test(url);
  return renderElsewhere(
    api,
    settings,
    isLinkedIn && !ctx
      ? 'Reload this LinkedIn tab so the extension can read it.'
      : 'Open a LinkedIn profile or a Sales Navigator lead list to add people. Or jump to an account:'
  );
}

void init();
