const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const scenarios = {
  combo_v2: {
    label: 'Combo v2',
    status: 'healed',
    ok: true,
    note: 'Combo v2 applied: 5 fields mapped and coerced. Rule cached.',
    before: {
      id: 'usr_99',
      contact: { email_addr: 'dev@acme.io' },
      balance: '450.50',
      verified: 1,
      created: 1731576600,
    },
    after: {
      user_id: 'usr_99',
      email: 'dev@acme.io',
      account_balance: 450.5,
      is_verified: true,
      created_at: '2024-11-14T09:30:00.000Z',
    },
  },
  rename: {
    label: 'Renamed fields',
    status: 'healed',
    ok: true,
    note: 'Renamed fields mapped back to the contract. Rule cached.',
    before: {
      id: 'usr_99',
      user_email: 'dev@acme.io',
      account_balance: 450.5,
      is_verified: true,
      created_at: '2026-11-14T09:30:00Z',
    },
    after: {
      user_id: 'usr_99',
      email: 'dev@acme.io',
      account_balance: 450.5,
      is_verified: true,
      created_at: '2026-11-14T09:30:00Z',
    },
  },
  nest: {
    label: 'Nested object',
    status: 'healed',
    ok: true,
    note: 'Deep path resolved: contact.email_addr to email. Rule cached.',
    before: {
      user_id: 'usr_99',
      contact: { email_addr: 'dev@acme.io' },
      account_balance: 450.5,
      is_verified: true,
      created_at: '2026-11-14T09:30:00Z',
    },
    after: {
      user_id: 'usr_99',
      email: 'dev@acme.io',
      account_balance: 450.5,
      is_verified: true,
      created_at: '2026-11-14T09:30:00Z',
    },
  },
  type_mismatch: {
    label: 'Changed types',
    status: 'healed',
    ok: true,
    note: 'String balance and integer boolean coerced to the contract types.',
    before: {
      user_id: 'usr_99',
      email: 'dev@acme.io',
      account_balance: '450.50',
      is_verified: 1,
      created_at: '2026-11-14T09:30:00Z',
    },
    after: {
      user_id: 'usr_99',
      email: 'dev@acme.io',
      account_balance: 450.5,
      is_verified: true,
      created_at: '2026-11-14T09:30:00Z',
    },
  },
  array_wrap: {
    label: 'Wrapped array',
    status: 'healed',
    ok: true,
    note: 'Payload unwrapped from data[0]. Rule cached.',
    before: {
      data: [
        {
          user_id: 'usr_99',
          email: 'dev@acme.io',
          account_balance: 450.5,
          is_verified: true,
          created_at: '2026-11-14T09:30:00Z',
        },
      ],
    },
    after: {
      user_id: 'usr_99',
      email: 'dev@acme.io',
      account_balance: 450.5,
      is_verified: true,
      created_at: '2026-11-14T09:30:00Z',
    },
  },
  field_deleted: {
    label: 'Deleted field',
    status: '502 refused',
    ok: false,
    note: 'Gate 1 fails: email has no mapping. No data is served.',
    before: {
      user_id: 'usr_99',
      account_balance: 450.5,
      is_verified: true,
      created_at: '2026-11-14T09:30:00Z',
    },
    after: {
      error: 'AUTOPATCH_UNRECOVERABLE',
      reason: 'RULE_VERIFICATION_FAILED',
      missingFields: ['email'],
      message: 'The proposed mapping rule failed verification; no data was served.',
    },
  },
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function scalarHtml(value) {
  if (value === null) return '<span class="j-null">null</span>';
  if (typeof value === 'string') return `<span class="j-str">"${escapeHtml(value)}"</span>`;
  if (typeof value === 'number') return `<span class="j-num">${escapeHtml(value)}</span>`;
  if (typeof value === 'boolean') return `<span class="j-bool">${value}</span>`;
  return `<span class="j-str">"${escapeHtml(String(value))}"</span>`;
}

function jsonHtml(value, depth = 0) {
  const pad = '  '.repeat(depth);
  if (Array.isArray(value)) {
    if (value.length === 0) return '<span class="j-punct">[]</span>';
    const inner = value.map((item) => jsonHtml(item, depth + 1)).join(',\n');
    return `<span class="j-punct">[</span>\n${inner}\n${pad}<span class="j-punct">]</span>`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) return '<span class="j-punct">{}</span>';
    const inner = entries
      .map(([key, child], index) => {
        const comma = index < entries.length - 1 ? '<span class="j-punct">,</span>' : '';
        return `${'  '.repeat(depth + 1)}<span class="j-key">"${escapeHtml(key)}"</span><span class="j-punct">: </span>${jsonHtml(child, depth + 1)}${comma}`;
      })
      .join('\n');
    return `<span class="j-punct">{</span>\n${inner}\n${pad}<span class="j-punct">}</span>`;
  }
  return scalarHtml(value);
}

function renderSpecimen(root, key) {
  const scenario = scenarios[key];
  if (!root || !scenario) return;
  const before = $('[data-specimen-before]', root);
  const after = $('[data-specimen-after]', root);
  const status = $('[data-specimen-status]', root);
  const note = $('[data-specimen-note]', root);
  const mode = $('[data-specimen-mode]', root);

  if (before) before.innerHTML = jsonHtml(scenario.before);
  if (after) after.innerHTML = jsonHtml(scenario.after);
  if (note) note.textContent = scenario.note;
  if (mode) mode.textContent = key;
  if (status) {
    status.className = `chip ${scenario.ok ? 'is-online' : 'is-offline'}`;
    status.innerHTML = `<span class="dot ${scenario.ok ? 'dot--green' : 'dot--red'}"></span><span>${escapeHtml(scenario.status)}</span>`;
  }
}

function wireSpecimenTabs(root, onChange) {
  const tabs = $$('.specimen-tab', root);
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const key = tab.dataset.scenario;
      if (!key) return;
      tabs.forEach((item) => {
        const active = item === tab;
        item.classList.toggle('is-active', active);
        item.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      renderSpecimen(root, key);
      onChange?.(key);
    });
  });
}

/* Live runtime state */
function setLiveValue(name, text, kind) {
  const element = $(`[data-live="${name}"]`);
  if (!element) return;
  element.textContent = text;
  element.classList.toggle('is-ok', kind === 'ok');
  element.classList.toggle('is-bad', kind === 'bad');
}

function readTime() {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date());
}

async function loadLiveState() {
  const note = $('#live-note');
  const button = $('#live-refresh');
  if (note) note.textContent = 'Reading runtime state.';
  if (button) {
    button.disabled = true;
    button.textContent = 'Refreshing';
  }

  try {
    const response = await fetch('/__autopatch/api/state', {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const state = await response.json();

    setLiveValue('upstream', state.upstreamOk ? 'reachable' : 'unreachable', state.upstreamOk ? 'ok' : 'bad');
    setLiveValue('contracts', String(state.contracts ?? 0));
    setLiveValue('rules', String(state.rulesCount ?? 0));
    setLiveValue('model', state.llmMode === 'live' ? state.llmModel || 'live' : 'mock (labelled)');
    if (note) note.textContent = `Read at ${readTime()} from this AutoPatch instance.`;
  } catch {
    setLiveValue('upstream', 'offline', 'bad');
    setLiveValue('contracts', '-');
    setLiveValue('rules', '-');
    setLiveValue('model', '-');
    if (note) note.textContent = 'AutoPatch is not reachable from this page. Start the app with npm run dev.';
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = 'Refresh';
    }
  }
}

/* Simulator */
function wireSimulator() {
  const root = $('[data-specimen="sim"]');
  if (!root) return;
  const scenarioButtons = $$('.scenario');
  const status = $('#sim-status');
  const sendButton = $('#cmd-simulate-btn');
  let selected = 'combo_v2';

  renderSpecimen(root, selected);

  scenarioButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const key = button.dataset.scenario;
      if (!key || !scenarios[key]) return;
      selected = key;
      scenarioButtons.forEach((item) => {
        const active = item === button;
        item.classList.toggle('is-active', active);
        item.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      renderSpecimen(root, key);
      if (status) {
        status.className = 'sim-status';
        status.textContent = `Selected ${scenarios[key].label}. Send it to the local upstream when you are ready.`;
      }
    });
  });

  sendButton?.addEventListener('click', async () => {
    sendButton.disabled = true;
    const original = sendButton.textContent;
    sendButton.textContent = 'Sending drift';
    if (status) {
      status.className = 'sim-status';
      status.textContent = 'Sending the selected drift to the local upstream.';
    }

    try {
      const response = await fetch('/__autopatch/api/chaos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: selected }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.message || `HTTP ${response.status}`);
      }
      if (status) {
        status.className = 'sim-status is-ok';
        status.textContent = `Upstream now sends ${scenarios[selected].label}. Open the console to watch the heal.`;
      }
      await loadLiveState();
    } catch (error) {
      if (status) {
        status.className = 'sim-status is-bad';
        status.textContent = `Could not change the upstream: ${error.message}. Start the app with npm run dev.`;
      }
    } finally {
      sendButton.disabled = false;
      sendButton.textContent = original;
    }
  });
}

/* Theme */
function wireTheme() {
  const button = $('#theme-toggle');
  const meta = document.querySelector('meta[name="theme-color"]');

  const sync = () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    if (button) button.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
    if (meta) meta.setAttribute('content', dark ? '#0e100d' : '#f2f2ee');
  };

  sync();
  button?.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('autopatch-theme', next);
    } catch {
      // Storage can be unavailable in a private window. The theme still applies.
    }
    sync();
  });
}

/* FAQ: native details, with a class hook for the old accordion styles. */
function wireFaq() {
  for (const item of $$('.faq-item')) {
    if (!$('.faq-trigger', item)) continue;
    const sync = () => item.classList.toggle('is-open', item.open);
    item.addEventListener('toggle', sync);
    sync();
  }
}

/* Mobile navigation */
function wireNav() {  const toggle = $('#nav-toggle');
  const nav = $('#site-nav');
  if (!toggle || !nav) return;

  const setOpen = (open) => {
    nav.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  };

  toggle.addEventListener('click', () => setOpen(!nav.classList.contains('is-open')));
  nav.addEventListener('click', (event) => {
    if (event.target.closest('a')) setOpen(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setOpen(false);
  });
  document.addEventListener('click', (event) => {
    if (!nav.classList.contains('is-open')) return;
    if (event.target.closest('.site-header')) return;
    setOpen(false);
  });
}

function init() {
  wireTheme();
  wireNav();
  wireFaq();
  wireSpecimenTabs($('[data-specimen="hero"]'), undefined);
  wireSimulator();
  $('#live-refresh')?.addEventListener('click', loadLiveState);
  loadLiveState();
}

init();
