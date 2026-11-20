const ENDPOINT = '/api/v1/checkout/user';

const $ = (selector, root = document) => root.querySelector(selector);

const state = {
  mode: 'proxy',
  busy: false,
  upstreamUrl: null,
  llmMode: null,
  llmModel: null,
  hasRendered: false,
  lastPayload: null,
};

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
  timeZoneName: 'short',
});

const timeFormatter = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

function describe(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number' && !Number.isFinite(value)) return 'non-finite number';
  return typeof value;
}

function expectString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${field} must be a non-empty string; received ${describe(value)}`);
  }
  return value;
}

function readBaseline(payload) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TypeError(`Expected a billing account object; received ${describe(payload)}`);
  }

  const userId = expectString(payload.user_id, 'user_id');
  const email = expectString(payload.email, 'email');
  if (!email.includes('@')) {
    throw new TypeError(`email is not a valid address: "${email}"`);
  }

  if (typeof payload.account_balance !== 'number' || !Number.isFinite(payload.account_balance)) {
    throw new TypeError(
      `account_balance must be a finite number; received ${describe(payload.account_balance)}`,
    );
  }

  if (typeof payload.is_verified !== 'boolean') {
    throw new TypeError(`is_verified must be a boolean; received ${describe(payload.is_verified)}`);
  }

  if (typeof payload.created_at !== 'string' || Number.isNaN(Date.parse(payload.created_at))) {
    throw new RangeError(
      `created_at must be an ISO-8601 timestamp; received ${describe(payload.created_at)}`,
    );
  }

  const createdAt = new Date(payload.created_at);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(payload.created_at) || Number.isNaN(createdAt.getTime())) {
    throw new RangeError(`created_at is not a valid ISO-8601 timestamp: "${payload.created_at}"`);
  }

  return {
    userId,
    email,
    accountBalance: payload.account_balance,
    isVerified: payload.is_verified,
    createdAt,
    createdAtRaw: payload.created_at,
  };
}

function displayNameFromEmail(email) {
  const local = email.split('@')[0]?.replace(/[._-]+/g, ' ').trim();
  if (!local) return 'Demo member';
  return local.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

async function ensureRemoteState() {
  if (state.upstreamUrl) return;
  const response = await fetch('/__autopatch/api/state', {
    headers: { accept: 'application/json' },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`AutoPatch state returned HTTP ${response.status}`);
  const snapshot = await response.json();
  state.upstreamUrl = typeof snapshot.upstreamUrl === 'string' ? snapshot.upstreamUrl : null;
  state.llmMode = typeof snapshot.llmMode === 'string' ? snapshot.llmMode : null;
  state.llmModel = typeof snapshot.llmModel === 'string' ? snapshot.llmModel : null;
  applyInferenceLabel();
}

function applyInferenceLabel() {
  const footer = $('#footer-llm');
  const cell = $('#conn-llm');
  if (state.mode === 'direct') {
    if (footer) footer.textContent = `LLM: ${state.llmMode ?? 'unknown'} · not used`;
    if (cell) cell.textContent = 'not involved';
    return;
  }
  const mode = state.llmMode ?? 'unknown';
  const model = state.llmMode === 'live' && state.llmModel ? ` · ${state.llmModel}` : '';
  if (footer) footer.textContent = `LLM: ${mode}${model}`;
  if (cell) cell.textContent = state.llmMode === 'mock' ? 'mock mapper (labelled)' : state.llmMode === 'live' ? `Gemini${state.llmModel ? ` · ${state.llmModel}` : ''}` : 'unknown';
}

function setText(selector, value) {
  const element = $(selector);
  if (element) element.textContent = value;
}

function setModeNote() {
  const note = $('#mode-note');
  const dot = $('#mode-dot');
  const text = $('#mode-note-text');
  const endpoint = $('#mode-endpoint');
  if (!note || !dot || !text || !endpoint) return;

  note.classList.toggle('is-direct', state.mode === 'direct');
  note.classList.toggle('is-proxy', state.mode === 'proxy');

  if (state.mode === 'proxy') {
    text.textContent =
      'Requests are routed through AutoPatch, which validates the response against the baseline contract before this page sees it.';
    endpoint.textContent = `GET ${ENDPOINT}`;
  } else {
    text.textContent =
      'Requests bypass AutoPatch and go straight to the upstream. Any schema change reaches this page untouched.';
    let host = 'upstream';
    if (state.upstreamUrl) {
      try {
        host = new URL(state.upstreamUrl).host;
      } catch {
        host = state.upstreamUrl;
      }
    }
    endpoint.textContent = `direct · ${host}`;
  }
}

function updateModeUI(mode) {
  state.mode = mode;
  for (const button of [$('#btn-direct'), $('#btn-proxy')]) {
    if (!button) continue;
    const active = button.dataset.mode === mode;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  }

  setModeNote();

  const pill = $('#conn-mode-pill');
  if (pill) {
    pill.textContent = mode === 'proxy' ? 'proxy' : 'direct';
    pill.classList.toggle('is-proxy', mode === 'proxy');
  }
  setText('#conn-mode', mode === 'proxy' ? 'Via AutoPatch' : 'Direct upstream');
  setText('#conn-endpoint', `GET ${ENDPOINT}`);
  setText(
    '#conn-note',
    mode === 'proxy'
      ? 'This page renders baseline fields. AutoPatch restores that shape when the upstream drifts.'
      : 'This page still expects baseline fields. Nothing is translating the upstream response.',
  );
  applyInferenceLabel();
}

function renderAccount(account) {
  const name = displayNameFromEmail(account.email);
  setText('#display-name', name);
  setText('#profile-email', account.email);
  setText('#avatar', name.slice(0, 1).toUpperCase());
  setText('#balance', currency.format(account.accountBalance));

  const userId = $('#detail-user-id');
  if (userId) {
    userId.textContent = account.userId;
    userId.classList.add('mono');
  }
  setText('#detail-email', account.email);
  setText('#detail-created', dateFormatter.format(account.createdAt));
  setText(
    '#detail-source',
    state.mode === 'direct'
      ? 'Upstream (unprotected)'
      : `AutoPatch · ${($('#conn-status')?.textContent ?? 'verified').trim()}`,
  );
  setText('#signed-in', `${account.email} · demo workspace`);

  const pill = $('#verified-pill');
  if (pill) {
    pill.classList.toggle('is-bad', account.isVerified === false);
    pill.classList.toggle('is-neutral', account.isVerified !== true);
    const label = pill.querySelector('span:last-child');
    if (label) label.textContent = account.isVerified ? 'Verified' : 'Unverified';
  }
}

function showAccount() {
  const skeleton = $('#account-skeleton');
  const content = $('#account-content');
  if (skeleton) skeleton.hidden = true;
  if (content) content.hidden = false;
  const grid = $('#content-grid');
  if (grid) grid.hidden = false;
  state.hasRendered = true;
}

function hideScreens() {
  const crash = $('#crash-screen');
  const service = $('#service-error');
  if (crash) crash.hidden = true;
  if (service) service.hidden = true;
}

function beginLoad() {
  hideScreens();
  const grid = $('#content-grid');
  const content = $('#account-content');
  const skeleton = $('#account-skeleton');
  const hadContent = content ? !content.hidden : false;
  if (grid) grid.hidden = false;
  if (!hadContent) {
    if (skeleton) skeleton.hidden = false;
    if (content) content.hidden = true;
  }
}

function setBusy(busy) {
  const refresh = $('#refresh');
  if (refresh) {
    refresh.disabled = busy;
    refresh.classList.toggle('is-busy', busy);
  }
  for (const button of [$('#btn-direct'), $('#btn-proxy')]) {
    if (button) button.disabled = busy;
  }
  const card = $('#account-card');
  if (card) card.setAttribute('aria-busy', busy ? 'true' : 'false');
}

function renderRaw(payload, meta) {
  const pre = $('#raw-json');
  if (!pre) return;
  pre.textContent =
    payload === null || payload === undefined
      ? meta.text || '(empty response body)'
      : JSON.stringify(payload, null, 2);
  setText('#raw-meta', meta.label);
}

function setConnection({ http, autoStatus, fetchMs, mode, failed = false }) {
  const httpCell = $('#conn-http');
  const statusCell = $('#conn-status');
  const timeCell = $('#conn-time');
  if (httpCell) httpCell.textContent = http || 'no response';
  if (statusCell) statusCell.textContent = failed ? 'request failed' : mode === 'proxy' ? autoStatus || '-' : 'not proxied';
  if (timeCell) timeCell.textContent = Number.isFinite(fetchMs) ? `${fetchMs.toFixed(0)} ms` : '-';
  setText('#last-updated', `Updated ${timeFormatter.format(new Date())}`);
}

function updateConnectionNote(autoStatus) {
  if (state.mode === 'direct') return;
  const status = (autoStatus ?? '').toLowerCase();
  if (status === 'healed' || status === 'healed-cached') {
    setText(
      '#conn-note',
      status === 'healed-cached'
        ? 'The upstream drifted. A previously verified rule healed the response without another model call.'
        : 'The upstream drifted. AutoPatch mapped it back to the baseline shape before this page rendered.',
    );
  } else if (status === 'verified') {
    setText(
      '#conn-note',
      'The response matched the baseline contract exactly. AutoPatch forwarded it without changing a field.',
    );
  } else if (status === 'passthrough') {
    setText('#conn-note', 'AutoPatch forwarded this response untouched; no contract matched it.');
  }
}

function firstStackLine(error) {
  const stack = typeof error?.stack === 'string' ? error.stack : '';
  const lines = stack
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.find((line) => line.startsWith('at ')) ?? lines[1] ?? 'Stack unavailable';
}

function showCrash(error, payload, details) {
  const screen = $('#crash-screen');
  const service = $('#service-error');
  const grid = $('#content-grid');
  if (!screen) return;
  if (service) service.hidden = true;
  if (grid) grid.hidden = true;
  screen.hidden = false;

  const modeLabel = details.mode === 'proxy' ? 'via AutoPatch' : 'direct to upstream';
  setText('#crash-mode', modeLabel);
  const copy = screen.querySelector('.crash-title p');
  if (copy) {
    copy.textContent =
      details.mode === 'proxy'
        ? 'AutoPatch returned a response this page could not render. The exception below was thrown by the browser, not staged.'
        : 'The client code reads baseline fields directly. With no mapping layer, the upstream change reaches the browser.';
  }

  setText('#crash-message', `${error?.name ?? 'Error'}: ${error?.message ?? String(error)}`);
  setText('#crash-stack', firstStackLine(error));
  setText(
    '#crash-source',
    `GET ${ENDPOINT} · HTTP ${details.status || '-'} · ${details.bytes} B · ${Number(details.fetchMs ?? 0).toFixed(0)} ms`,
  );

  const rawWrap = $('#crash-raw-wrap');
  const raw = $('#crash-raw');
  const rawText =
    payload === null || payload === undefined ? details.text ?? '' : JSON.stringify(payload, null, 2);
  if (rawWrap && raw) {
    rawWrap.hidden = rawText.trim() === '';
    raw.textContent = rawText;
  }

  const skeleton = $('#account-skeleton');
  if (skeleton) skeleton.hidden = true;
}

function showService({ body, text, status, fetchMs, mode, autoStatus }) {
  const screen = $('#service-error');
  const crash = $('#crash-screen');
  const grid = $('#content-grid');
  if (!screen) return;
  if (crash) crash.hidden = true;
  if (grid) grid.hidden = true;
  screen.hidden = false;

  const payload = body !== null && typeof body === 'object' ? body : null;
  const reason = typeof payload?.reason === 'string' ? payload.reason : status ? `HTTP_${status}` : 'NETWORK_ERROR';
  const message =
    typeof payload?.message === 'string'
      ? payload.message
      : text?.trim()
        ? text.trim().slice(0, 400)
        : 'No response body was returned.';

  setText(
    '#service-title',
    mode === 'proxy' && status === 502
      ? 'AutoPatch could not heal this response'
      : `The request failed with HTTP ${status || '-'}`,
  );
  setText('#service-status', status ? String(status) : 'ERR');
  setText('#service-reason', reason);
  setText('#service-message', message);

  const missing = Array.isArray(payload?.missingFields)
    ? payload.missingFields.filter((field) => typeof field === 'string')
    : [];
  const missingWrap = $('#service-missing-wrap');
  const missingBox = $('#service-missing');
  if (missingWrap && missingBox) {
    missingWrap.hidden = missing.length === 0;
    missingBox.replaceChildren();
    for (const field of missing) {
      const chip = document.createElement('code');
      chip.textContent = field;
      missingBox.append(chip);
    }
  }

  const diagnostics = Array.isArray(payload?.diagnostics)
    ? payload.diagnostics.filter((entry) => typeof entry === 'string')
    : Array.isArray(payload?.errors)
      ? payload.errors.filter((entry) => typeof entry === 'string')
      : [];
  const diagWrap = $('#service-diag-wrap');
  const diagBox = $('#service-diagnostics');
  if (diagWrap && diagBox) {
    diagWrap.hidden = diagnostics.length === 0;
    diagBox.textContent = diagnostics.join('\n');
  }

  setText(
    '#service-note',
    autoStatus === 'unrecoverable' || mode === 'direct'
      ? 'No fabricated data was returned. AutoPatch fails loudly instead of guessing a value.'
      : 'The error above came from the live request. Nothing on this page was mocked in.',
  );

  const skeleton = $('#account-skeleton');
  if (skeleton) skeleton.hidden = true;
}

function directUrl() {
  if (!state.upstreamUrl) {
    throw new Error('The upstream URL is unknown because AutoPatch state could not be loaded.');
  }
  return new URL(ENDPOINT, state.upstreamUrl).href;
}

async function load() {
  if (state.busy) return;
  state.busy = true;
  setBusy(true);
  beginLoad();

  const mode = state.mode;
  const started = performance.now();
  let response = null;
  let text = '';
  let payload = null;
  let fetchMs = Number.NaN;
  let bytes = 0;

  try {
    const url = mode === 'proxy' ? ENDPOINT : directUrl();
    response = await fetch(url, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
    fetchMs = performance.now() - started;
    text = await response.text();
    bytes = new TextEncoder().encode(text).length;
    try {
      payload = text.trim() === '' ? null : JSON.parse(text);
    } catch {
      payload = null;
    }

    state.lastPayload = payload;
    const autoStatus = response.headers.get('x-autopatch-status');
    const overhead = response.headers.get('x-autopatch-overhead-ms');

    const metaParts = [
      mode === 'proxy' ? 'proxy' : 'direct',
      `HTTP ${response.status}`,
      `${bytes} B`,
      `${fetchMs.toFixed(0)} ms`,
    ];
    if (autoStatus) metaParts.push(autoStatus);
    if (overhead) metaParts.push(`overhead ${overhead} ms`);
    renderRaw(payload, { label: metaParts.join(' · '), text });
    setConnection({ http: `${response.status}`, autoStatus, fetchMs, mode });

    if (mode === 'proxy' && !response.ok) {
      updateConnectionNote(autoStatus);
      showService({ body: payload, text, status: response.status, fetchMs, mode, autoStatus });
      return;
    }

    if (mode === 'direct' && !response.ok) {
      throw new Error(
        `The upstream returned HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}.`,
      );
    }

    const account = readBaseline(payload);
    renderAccount(account);
    updateConnectionNote(autoStatus);
    showAccount();
  } catch (error) {
    setConnection({ http: response ? `${response.status}` : null, fetchMs, mode, failed: true });
    if (mode === 'proxy' && (!response || !response.ok)) {
      showService({
        body: payload,
        text,
        status: response?.status ?? 0,
        fetchMs,
        mode,
        autoStatus: null,
      });
      if (!response) {
        setText('#service-title', 'Could not reach AutoPatch');
        setText('#service-message', error?.message ?? String(error));
      }
      return;
    }
    showCrash(error, payload, {
      mode,
      status: response?.status ?? 0,
      fetchMs,
      bytes,
      text,
    });
  } finally {
    state.busy = false;
    setBusy(false);
  }
}

async function switchMode(mode) {
  if (state.busy || state.mode === mode) return;
  updateModeUI(mode);
  await load();
}

function showToast(message, kind = 'info') {
  const toast = $('#toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.toggle('is-error', kind === 'error');
  toast.hidden = false;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toast.hidden = true;
  }, 5200);
}

function wire() {
  $('#btn-direct')?.addEventListener('click', () => switchMode('direct'));
  $('#btn-proxy')?.addEventListener('click', () => switchMode('proxy'));
  $('#refresh')?.addEventListener('click', load);
  $('#crash-retry')?.addEventListener('click', async () => {
    if (state.mode !== 'proxy') updateModeUI('proxy');
    await load();
  });
  $('#service-retry')?.addEventListener('click', load);
}

async function init() {
  wire();
  updateModeUI('proxy');
  try {
    await ensureRemoteState();
    setModeNote();
  } catch (error) {
    showToast(
      `Could not read AutoPatch state: ${error instanceof Error ? error.message : String(error)}`,
      'error',
    );
  }
  await load();
}

init();
