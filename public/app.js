import {
  DECKS, DEFAULT_SETTINGS, SETTING_LABELS, REACTIONS, THROWABLES, SKIP_CARD, COFFEE_CARD,
  TIMER_MIN, TIMER_MAX, buildDeck, parseCustomValues,
} from '/shared/constants.js';
import { PRESET_AVATARS, presetSvg, isPreset } from '/avatars.js';
import { confetti, floatEmoji, throwEmoji } from '/effects.js';

const DOMAIN_ERROR = 'Domain not allowed to use this site.';
const app = document.getElementById('app');

const S = {
  config: null,
  user: null,
  profile: null,
  roomId: null,
  room: null,
  es: null,
  notice: null,
  editingVote: false,
  inviteCopiedUntil: 0,
  countdownEnd: null,
  lastCountdownNum: null,
  timerEnd: null,
  lastSpectatorChoice: false,
  seatEls: new Map(),
  layoutKey: '',
};

// ---------------- utilities ----------------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (sel, root = document) => root.querySelector(sel);
const isLong = (v) => String(v).length > 3;

const ICONS = {
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  pencil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
  gear: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  link: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>',
  boot: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M17 8l5 5M22 8l-5 5"/></svg>',
  exit: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>',
};

const BRAND = `<a class="brand" href="/" data-nav="/"><svg viewBox="0 0 64 64" aria-hidden="true"><rect x="8" y="12" width="30" height="42" rx="5" fill="#4148b8" transform="rotate(-12 23 33)"/><rect x="24" y="8" width="30" height="42" rx="5" fill="#fff" stroke="#17614f" stroke-width="3" transform="rotate(8 39 29)"/></svg><span>Planning Poker</span></a>`;

async function api(path, body, method = body === undefined ? 'GET' : 'POST') {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  let data = {};
  try {
    data = await res.json();
  } catch { /* empty body */ }
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status}).`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function toast(message, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  ta.remove();
  return Promise.resolve();
}

// ---------------- profile (kept only in this browser) ----------------
function profileKey() {
  return `pp-profile:${S.user.email}`;
}

function loadProfile() {
  let p = null;
  try {
    p = JSON.parse(localStorage.getItem(profileKey()) || 'null');
  } catch { /* storage unavailable */ }
  const fallback = { name: S.user.name, avatar: { kind: 'google' } };
  if (!p || typeof p !== 'object') return fallback;
  if (p.avatar?.kind === 'preset' && !isPreset(p.avatar.id)) p.avatar = { kind: 'google' };
  return { name: p.name || S.user.name, avatar: p.avatar || { kind: 'google' } };
}

function saveProfile(p) {
  S.profile = p;
  try {
    localStorage.setItem(profileKey(), JSON.stringify(p));
  } catch { /* storage unavailable */ }
}

function profilePayload() {
  return { name: S.profile.name, avatar: S.profile.avatar };
}

function avatarHtml(avatar, name) {
  if (avatar?.kind === 'preset') return `<span class="avatar">${presetSvg(avatar.id)}</span>`;
  if (avatar?.kind === 'url' && avatar.url) return `<span class="avatar"><img src="${esc(avatar.url)}" alt="" referrerpolicy="no-referrer"></span>`;
  const initials = String(name || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return `<span class="avatar" aria-hidden="true">${esc(initials)}</span>`;
}

function myAvatarView(profile = S.profile) {
  const a = profile.avatar;
  if (a.kind === 'preset') return { kind: 'preset', id: a.id };
  if (a.kind === 'upload' && a.dataUrl) return { kind: 'url', url: a.dataUrl };
  return S.user.picture ? { kind: 'url', url: S.user.picture } : { kind: 'initials' };
}

// ---------------- routing ----------------
function roomIdFromPath() {
  return /^\/room\/([A-Za-z0-9]{1,16})\/?$/.exec(location.pathname)?.[1] || null;
}

function navigate(path, replace = false) {
  if (location.pathname !== path) history[replace ? 'replaceState' : 'pushState']({}, '', path);
  route();
}

window.addEventListener('popstate', route);
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-nav]');
  if (a && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    navigate(a.dataset.nav);
  }
});

async function route() {
  closePopovers();
  if (!S.user) return renderLogin();
  const roomId = roomIdFromPath();
  if (!roomId) {
    if (S.roomId) await leaveRoom(false);
    return renderHome();
  }
  if (S.roomId === roomId && S.es) return; // already inside
  if (S.roomId && S.roomId !== roomId) disconnect();
  try {
    const info = await api(`/api/rooms/${roomId}`);
    if (info.member) return enterRoom(roomId);
    if (info.banned) return renderMessage('You can’t rejoin this room', 'The room creator removed you from this room.');
    renderJoin(info);
  } catch (err) {
    if (err.status === 401 || err.status === 403) return signedOut(err.status === 403 ? DOMAIN_ERROR : null);
    renderMessage('Room not found', 'This room doesn’t exist anymore. Rooms close after everyone leaves. Create a new room or ask for a fresh invite link.');
  }
}

// ---------------- boot & auth ----------------
async function boot() {
  try {
    S.config = await api('/api/config');
  } catch {
    app.innerHTML = '<div class="boot">The server is not reachable. Refresh the page to try again.</div>';
    return;
  }
  try {
    const me = await api('/api/me');
    S.user = me.user;
    S.profile = loadProfile();
  } catch {
    S.user = null;
  }
  route();
}

function signedOut(error) {
  disconnect();
  S.user = null;
  S.room = null;
  S.roomId = null;
  renderLogin(error);
}

let gsiLoaded = null;
function loadGsi() {
  gsiLoaded ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load Google sign-in.'));
    document.head.appendChild(s);
  });
  return gsiLoaded;
}

function renderLogin(error = null) {
  document.title = 'Sign in · Planning Poker';
  const { googleClientId, devLogin, allowedDomain } = S.config;
  app.innerHTML = `
    <main class="login">
      <div class="login-card">
        <div class="fan" aria-hidden="true"><span>3</span><span>5</span><span class="back"></span></div>
        <h1>Planning Poker</h1>
        <p>Estimate stories together with your team. Sign in with your ${esc(allowedDomain)} Google account.</p>
        <div class="login-alert" id="login-error" role="alert" ${error ? '' : 'hidden'}>${esc(error || '')}</div>
        <div class="gsi-slot" id="gsi-button">${googleClientId ? '' : '<p class="error-text">Google sign-in is not configured on this server yet.</p>'}</div>
        ${devLogin ? `
          <form class="dev-login" id="dev-login">
            <p class="hint">Local testing only: sign in with any ${esc(allowedDomain)} email.</p>
            <input class="input" name="email" type="email" placeholder="name@${esc(allowedDomain)}" required>
            <input class="input" name="name" placeholder="Display name">
            <button class="btn" type="submit">Sign in for testing</button>
          </form>` : ''}
      </div>
    </main>`;

  const showError = (msg) => {
    const el = $('#login-error');
    el.textContent = msg;
    el.hidden = false;
  };
  const afterLogin = async (user) => {
    S.user = user;
    S.profile = loadProfile();
    route();
  };

  if (googleClientId) {
    loadGsi().then(() => {
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        hd: allowedDomain,
        ux_mode: 'popup',
        callback: async ({ credential }) => {
          try {
            const { user } = await api('/api/auth/google', { credential });
            afterLogin(user);
          } catch (err) {
            showError(err.status === 403 ? DOMAIN_ERROR : err.message);
          }
        },
      });
      const slot = $('#gsi-button');
      if (slot) window.google.accounts.id.renderButton(slot, { theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with', width: 260 });
    }).catch((err) => showError(err.message));
  }

  $('#dev-login')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      const { user } = await api('/api/auth/dev', { email: f.get('email'), name: f.get('name') });
      afterLogin(user);
    } catch (err) {
      showError(err.status === 403 ? DOMAIN_ERROR : err.message);
    }
  });
}

// ---------------- shared header ----------------
function profileButtonHtml() {
  return `<div class="profile-wrap">
    <button class="profile-btn" id="profile-btn" aria-haspopup="dialog" aria-expanded="false">
      ${avatarHtml(myAvatarView(), S.profile.name)}<span class="name">${esc(S.profile.name)}</span>
    </button>
  </div>`;
}

function bindProfileButton() {
  $('#profile-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if ($('#profile-pop')) closePopovers();
    else openProfileMenu();
  });
}

function refreshProfileButton() {
  const wrap = $('.profile-wrap');
  if (!wrap) return;
  wrap.outerHTML = profileButtonHtml();
  bindProfileButton();
}

function closePopovers() {
  $('#profile-pop')?.remove();
  $('#profile-btn')?.setAttribute('aria-expanded', 'false');
  hideThrowMenu(true);
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('#profile-pop')) $('#profile-pop') && closePopovers();
  if (!e.target.closest('.reactions')) $('#reactions-tray')?.setAttribute('hidden', '');
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if ($('.modal-backdrop')) return closeModal();
    closePopovers();
    $('#reactions-tray')?.setAttribute('hidden', '');
  }
});

function openProfileMenu() {
  const draft = structuredClone(S.profile);
  const wrap = $('.profile-wrap');
  const pop = document.createElement('div');
  pop.className = 'popover';
  pop.id = 'profile-pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'Your profile');
  wrap.appendChild(pop);
  $('#profile-btn').setAttribute('aria-expanded', 'true');

  const draw = () => {
    const choice = (kind, id) => (draft.avatar.kind === kind && (kind !== 'preset' || draft.avatar.id === id));
    pop.innerHTML = `
      <label class="field"><span>Display name</span>
        <input class="input" id="profile-name" maxlength="32" value="${esc(draft.name)}"></label>
      <div class="field"><span>Profile picture</span>
        <div class="avatar-grid" role="radiogroup" aria-label="Profile picture">
          <button type="button" class="avatar-choice" role="radio" aria-checked="${choice('google')}" data-kind="google" title="Google photo">
            ${avatarHtml(S.user.picture ? { kind: 'url', url: S.user.picture } : { kind: 'initials' }, S.user.name)}</button>
          ${PRESET_AVATARS.map((a) => `<button type="button" class="avatar-choice" role="radio" aria-checked="${choice('preset', a.id)}" data-kind="preset" data-id="${a.id}" title="${a.name}">${avatarHtml({ kind: 'preset', id: a.id })}</button>`).join('')}
          ${draft.avatar.kind === 'upload' && draft.avatar.dataUrl
            ? `<button type="button" class="avatar-choice" role="radio" aria-checked="true" data-kind="upload" title="Your upload">${avatarHtml({ kind: 'url', url: draft.avatar.dataUrl })}</button>` : ''}
          <label class="avatar-choice upload" title="Upload your own picture"><span class="avatar" aria-hidden="true">＋</span>
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" class="visually-hidden" id="avatar-upload" aria-label="Upload your own picture"></label>
        </div>
      </div>
      <div class="popover-actions">
        <button type="button" class="btn btn-ghost" id="sign-out">Sign out</button>
        <button type="button" class="btn btn-primary" id="profile-save">Save profile</button>
      </div>`;
    $('#profile-name', pop).addEventListener('input', (e) => { draft.name = e.target.value; });
    pop.querySelectorAll('button.avatar-choice').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.kind === 'preset') draft.avatar = { kind: 'preset', id: b.dataset.id };
      else if (b.dataset.kind === 'google') draft.avatar = { kind: 'google' };
      draw();
    }));
    $('#avatar-upload', pop).addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        draft.avatar = { kind: 'upload', dataUrl: await resizeImage(file) };
        draw();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
    $('#profile-save', pop).addEventListener('click', saveProfileFromDraft);
    $('#sign-out', pop).addEventListener('click', async () => {
      await api('/api/logout', {}).catch(() => {});
      history.replaceState({}, '', '/');
      signedOut();
    });
  };

  const saveProfileFromDraft = async () => {
    const name = draft.name.replace(/\s+/g, ' ').trim().slice(0, 32);
    if (!name) return toast('Enter a display name.', 'error');
    draft.name = name;
    const previous = S.profile;
    saveProfile(draft);
    if (S.roomId) {
      try {
        await api(`/api/rooms/${S.roomId}/action`, { type: 'profile', profile: profilePayload() });
      } catch (err) {
        saveProfile(previous);
        return toast(err.message, 'error');
      }
    }
    closePopovers();
    refreshProfileButton();
    toast('Profile saved');
  };

  pop.addEventListener('click', (e) => e.stopPropagation());
  draw();
  $('#profile-name', pop).focus();
}

function resizeImage(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error('Choose an image file.'));
    if (file.size > 15 * 1024 * 1024) return reject(new Error('Choose an image smaller than 15 MB.'));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const size = 160;
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const ctx = c.getContext('2d');
      const s = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
      URL.revokeObjectURL(url);
      let data = c.toDataURL('image/webp', 0.85);
      if (!data.startsWith('data:image/webp')) data = c.toDataURL('image/jpeg', 0.85);
      resolve(data);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That image could not be read.'));
    };
    img.src = url;
  });
}

// ---------------- settings form (create + edit) ----------------
function settingsFormHtml(s, { roomName = '', includeSpectator = false } = {}) {
  const deckOptions = Object.entries(DECKS).map(([k, d]) => {
    const values = d.values ? ` (${d.values.join(', ')})` : '';
    return `<option value="${k}" ${s.deckType === k ? 'selected' : ''}>${esc(d.label + values)}</option>`;
  }).join('');
  const check = (key) => `<label class="check"><input type="checkbox" name="${key}" ${s[key] ? 'checked' : ''}><span>${esc(SETTING_LABELS[key])}</span></label>`;
  return `
    <label class="field"><span>Room name</span>
      <input class="input" name="roomName" maxlength="60" required placeholder="Sprint 42 planning" value="${esc(roomName)}"></label>
    <label class="field"><span>Deck</span><select class="select" name="deckType">${deckOptions}</select></label>
    <label class="field" data-custom ${s.deckType === 'custom' ? '' : 'hidden'}><span>Custom card values</span>
      <textarea class="textarea" name="customValues" placeholder="1, 2, 3, 5, 8, ?">${esc(s.customValues)}</textarea>
      <span class="hint">Separate values with commas. Up to 20 cards, 10 characters each.</span></label>
    <div class="deck-preview" data-preview aria-label="Cards in this deck"></div>
    <p class="error-text" data-form-error hidden></p>
    <div class="options">
      ${check('skipCard')}${check('coffeeCard')}${check('autoReveal')}${check('allowEarlyReveal')}
      <div>${check('timer')}<label class="inline-number" data-timer ${s.timer ? '' : 'hidden'}>
        <input class="input" type="number" name="timerSeconds" min="${TIMER_MIN}" max="${TIMER_MAX}" value="${s.timerSeconds}"> <span>seconds per vote</span></label></div>
      ${check('showAverage')}${check('showMedian')}${check('countdown')}${check('emojis')}${check('throwing')}
    </div>
    ${includeSpectator ? '<label class="check"><input type="checkbox" name="spectator"><span>Join as spectator</span></label>' : ''}`;
}

function readSettingsForm(form) {
  const f = new FormData(form);
  const settings = { deckType: f.get('deckType'), customValues: f.get('customValues') || '', timerSeconds: Number(f.get('timerSeconds')) };
  for (const k of Object.keys(SETTING_LABELS)) settings[k] = f.get(k) === 'on';
  const ts = settings.timerSeconds;
  if (!settings.timer && !(ts >= TIMER_MIN && ts <= TIMER_MAX)) settings.timerSeconds = DEFAULT_SETTINGS.timerSeconds;
  return { roomName: String(f.get('roomName') || '').trim(), settings, spectator: f.get('spectator') === 'on' };
}

function validateSettingsForm(form) {
  const { roomName, settings } = readSettingsForm(form);
  if (!roomName) return 'Give the room a name.';
  if (settings.deckType === 'custom') {
    const parsed = parseCustomValues(settings.customValues);
    if (parsed.error) return parsed.error;
  }
  if (settings.timer && !(settings.timerSeconds >= TIMER_MIN && settings.timerSeconds <= TIMER_MAX)) {
    return `Timer must be between ${TIMER_MIN} and ${TIMER_MAX} seconds.`;
  }
  return null;
}

function bindSettingsForm(form) {
  const update = () => {
    const { settings } = readSettingsForm(form);
    $('[data-custom]', form).hidden = settings.deckType !== 'custom';
    $('[data-timer]', form).hidden = !settings.timer;
    const cards = buildDeck(settings).cards;
    $('[data-preview]', form).innerHTML = cards.length
      ? cards.map((c) => `<span>${esc(c)}</span>`).join('')
      : '<p class="hint">Add card values to preview the deck.</p>';
  };
  form.addEventListener('input', update);
  form.addEventListener('change', update);
  update();
}

function showFormError(form, msg) {
  const el = $('[data-form-error]', form);
  el.textContent = msg || '';
  el.hidden = !msg;
}

// ---------------- home ----------------
function renderHome() {
  document.title = 'Planning Poker';
  const notice = S.notice;
  S.notice = null;
  app.innerHTML = `
    <header class="topbar">${BRAND}<div class="spacer"></div>${profileButtonHtml()}</header>
    <main class="home">
      ${notice ? `<div class="notice" role="status"><span>${esc(notice)}</span><button class="btn btn-ghost btn-icon" aria-label="Dismiss" data-dismiss>✕</button></div>` : ''}
      <section class="home-intro">
        <h1>Estimate the sprint together.</h1>
        <p>Start a room, share the link, and everyone picks a card at the same time. Nobody gets anchored by the first number said out loud.</p>
      </section>
      <div class="home-grid">
        <form class="panel panel-create" id="create-form" novalidate>
          <h2>Create a room</h2>
          ${settingsFormHtml(DEFAULT_SETTINGS, { includeSpectator: true })}
          <div class="form-foot"><span class="hint">You can change these options later from the room.</span>
            <button class="btn btn-primary btn-lg" type="submit">Create room</button></div>
        </form>
        <form class="panel panel-join" id="join-form" novalidate>
          <h2>Join a room</h2>
          <label class="field"><span>Invite link or room code</span>
            <input class="input" name="code" required placeholder="Paste the link you received" autocomplete="off"></label>
          <label class="check"><input type="checkbox" name="spectator"><span>Join as spectator</span></label>
          <p class="error-text" data-form-error hidden></p>
          <button class="btn btn-lg" type="submit">Join room</button>
        </form>
      </div>
    </main>`;
  bindProfileButton();
  $('[data-dismiss]')?.addEventListener('click', (e) => e.target.closest('.notice').remove());

  const create = $('#create-form');
  bindSettingsForm(create);
  create.addEventListener('submit', async (e) => {
    e.preventDefault();
    const error = validateSettingsForm(create);
    showFormError(create, error);
    if (error) return;
    const { roomName, settings, spectator } = readSettingsForm(create);
    const btn = $('button[type="submit"]', create);
    btn.disabled = true;
    try {
      const { roomId } = await api('/api/rooms', { name: roomName, settings, spectator, profile: profilePayload() });
      S.lastSpectatorChoice = spectator;
      history.pushState({}, '', `/room/${roomId}`);
      enterRoom(roomId);
    } catch (err) {
      showFormError(create, err.message);
      btn.disabled = false;
    }
  });

  const join = $('#join-form');
  join.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(join);
    const raw = String(f.get('code') || '').trim();
    const id = /\/room\/([A-Za-z0-9]{1,16})/.exec(raw)?.[1] || (/^[A-Za-z0-9]{1,16}$/.test(raw) ? raw : null);
    if (!id) return showFormError(join, 'Paste an invite link or a room code.');
    await joinRoom(id, f.get('spectator') === 'on', (msg) => showFormError(join, msg));
  });
}

async function joinRoom(roomId, spectator, onError) {
  try {
    await api(`/api/rooms/${roomId}/join`, { spectator, profile: profilePayload() });
    S.lastSpectatorChoice = spectator;
    history.pushState({}, '', `/room/${roomId}`);
    enterRoom(roomId);
  } catch (err) {
    onError(err.status === 404 ? 'That room doesn’t exist. Check the link or code.' : err.message);
  }
}

function renderJoin(info) {
  document.title = `Join ${info.name} · Planning Poker`;
  app.innerHTML = `
    <header class="topbar">${BRAND}<div class="spacer"></div>${profileButtonHtml()}</header>
    <main class="center-page">
      <form class="panel" id="join-room">
        <h2>Join “${esc(info.name)}”</h2>
        <p class="hint">${info.players} ${info.players === 1 ? 'person is' : 'people are'} in this room.</p>
        <label class="check"><input type="checkbox" name="spectator"><span>Join as spectator</span></label>
        <p class="error-text" data-form-error hidden></p>
        <button class="btn btn-primary btn-lg" type="submit">Join room</button>
        <a class="btn btn-ghost" href="/" data-nav="/">Back to start</a>
      </form>
    </main>`;
  bindProfileButton();
  const form = $('#join-room');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    joinRoom(info.id, new FormData(form).get('spectator') === 'on', (msg) => showFormError(form, msg));
  });
}

function renderMessage(title, text) {
  document.title = `${title} · Planning Poker`;
  app.innerHTML = `
    <header class="topbar">${BRAND}<div class="spacer"></div>${profileButtonHtml()}</header>
    <main class="center-page"><div class="panel"><h2>${esc(title)}</h2><p class="hint">${esc(text)}</p>
      <a class="btn btn-primary" href="/" data-nav="/">Go to start</a></div></main>`;
  bindProfileButton();
}

// ---------------- room connection ----------------
function enterRoom(roomId) {
  disconnect();
  S.roomId = roomId;
  S.room = null;
  S.editingVote = false;
  S.seatEls = new Map();
  S.layoutKey = '';
  renderRoomShell();
  connect();
}

function connect() {
  const roomId = S.roomId;
  const es = new EventSource(`/api/rooms/${roomId}/stream`);
  S.es = es;
  const on = (name, fn) => es.addEventListener(name, (e) => {
    if (S.es !== es) return;
    fn(JSON.parse(e.data));
  });
  on('state', onState);
  on('emoji', ({ emoji, name }) => floatEmoji(emoji, name));
  on('throw', ({ from, to, emoji }) => {
    const target = S.seatEls.get(to)?.querySelector('.seat-avatar');
    const source = S.seatEls.get(from)?.querySelector('.seat-avatar');
    throwEmoji(emoji, source, target);
  });
  on('celebrate', () => celebrate());
  on('removed', ({ reason }) => {
    const name = S.room?.name || 'the room';
    disconnect();
    S.roomId = null;
    if (reason === 'signed-out') return signedOut();
    S.notice = {
      kicked: `The creator removed you from “${name}”.`,
      'joined-other-room': `You left “${name}” because you joined another room. You can be active in one room at a time.`,
    }[reason] || null;
    navigate('/', true);
  });
  on('replaced', () => {
    disconnect();
    S.roomId = null;
    renderMessage('Room opened in another tab', 'You can only be active in one place at a time. Keep using the other tab, or reload this page to continue here.');
  });
  es.onerror = async () => {
    if (S.es !== es || es.readyState !== EventSource.CLOSED) return; // browser retries by itself
    // The server refused the stream: session expired, room gone, or we were dropped after being away.
    try {
      const info = await api(`/api/rooms/${roomId}`);
      if (S.es !== es) return;
      if (info.banned) {
        disconnect();
        return renderMessage('You can’t rejoin this room', 'The room creator removed you from this room.');
      }
      if (!info.member) await api(`/api/rooms/${roomId}/join`, { spectator: S.room?.you.spectator ?? S.lastSpectatorChoice, profile: profilePayload() });
      if (S.es === es) connect();
    } catch (err) {
      if (S.es !== es) return;
      disconnect();
      if (err.status === 401 || err.status === 403) return signedOut(err.status === 403 ? DOMAIN_ERROR : 'Your session expired. Sign in again.');
      S.roomId = null;
      renderMessage('Room closed', 'This room is no longer available. The server may have restarted, which clears all rooms. Create a new room to keep going.');
    }
  };
}

function disconnect() {
  if (S.es) S.es.close();
  S.es = null;
  S.countdownEnd = null;
  S.timerEnd = null;
  hideThrowMenu(true);
}

async function leaveRoom(goHome = true) {
  const roomId = S.roomId;
  disconnect();
  S.roomId = null;
  S.room = null;
  if (roomId) await api(`/api/rooms/${roomId}/action`, { type: 'leave' }).catch(() => {});
  if (goHome) navigate('/');
}

async function act(body) {
  try {
    return await api(`/api/rooms/${S.roomId}/action`, body);
  } catch (err) {
    toast(err.message, 'error');
    throw err;
  }
}

// ---------------- room rendering ----------------
function renderRoomShell() {
  app.innerHTML = `
    <header class="topbar">
      <div class="topbar-title">${BRAND.replace('<span>Planning Poker</span>', '<span class="visually-hidden">Planning Poker</span>')}<h1 id="room-name">Joining…</h1></div>
      <nav class="room-actions" id="room-actions" aria-label="Room actions"></nav>
      ${profileButtonHtml()}
    </header>
    <main class="room">
      <section class="stage" id="stage" aria-label="Table">
        <div class="table-outer" id="table-outer">
          <div class="table-scale" id="table-scale">
            <div class="table" id="table"><div class="table-status" id="table-status"></div><div class="countdown" id="countdown" aria-live="assertive"></div></div>
            <div id="seats"></div>
          </div>
        </div>
      </section>
      <section class="hand" id="hand" aria-label="Your cards"></section>
      <section class="results" id="results" aria-live="polite"></section>
    </main>
    <div class="reactions" id="reactions" hidden>
      <div class="reactions-tray" id="reactions-tray" hidden role="menu" aria-label="Send an emoji to everyone">
        ${REACTIONS.map((r) => `<button type="button" role="menuitem" data-reaction="${r}" aria-label="Send ${r}">${r}</button>`).join('')}
      </div>
      <button class="reactions-toggle" id="reactions-toggle" aria-label="Send an emoji" aria-haspopup="menu">😀</button>
    </div>`;
  bindProfileButton();

  $('#room-actions').addEventListener('click', onRoomAction);
  $('#hand').addEventListener('click', onHandClick);
  $('#results').addEventListener('click', (e) => {
    if (e.target.closest('[data-action="reset"]')) {
      S.editingVote = false;
      act({ type: 'reset' }).catch(() => {});
    }
  });
  $('#table-status').addEventListener('click', (e) => {
    if (e.target.closest('[data-action="reveal"]')) act({ type: 'reveal' }).catch(() => {});
  });
  $('#seats').addEventListener('click', (e) => {
    if (e.target.closest('.edit-vote')) {
      S.editingVote = !S.editingVote;
      renderHand();
      renderSeats();
    }
  });
  $('#reactions-toggle').addEventListener('click', (e) => {
    e.stopPropagation();
    const tray = $('#reactions-tray');
    tray.hidden = !tray.hidden;
    if (!tray.hidden) tray.querySelector('button').focus();
  });
  $('#reactions-tray').addEventListener('click', (e) => {
    const b = e.target.closest('[data-reaction]');
    if (b) act({ type: 'emoji', emoji: b.dataset.reaction }).catch(() => {});
  });
}

function onState(view) {
  const prev = S.room;
  S.room = view;
  if (view.phase !== 'revealed' || !view.you.vote) S.editingVote = false;
  S.countdownEnd = view.countdownRemainingMs != null ? performance.now() + view.countdownRemainingMs : null;
  S.timerEnd = view.timerRemainingMs != null ? performance.now() + view.timerRemainingMs : null;
  if (!prev || prev.name !== view.name) {
    $('#room-name').textContent = view.name;
    document.title = `${view.name} · Planning Poker`;
  }
  renderActions();
  renderSeats();
  renderTableStatus();
  renderHand();
  renderResults();
  $('#reactions').hidden = !view.settings.emojis;
  if (!view.settings.throwing) hideThrowMenu(true);
  if ($('.modal-backdrop[data-modal="kick"]')) refreshKickModal();
}

function renderActions() {
  const r = S.room;
  const copied = Date.now() < S.inviteCopiedUntil;
  $('#room-actions').innerHTML = `
    <button class="btn" data-action="invite">${ICONS.link}<span>${copied ? 'Invite link copied' : 'Invite players'}</span></button>
    ${r.you.isCreator ? `<button class="btn" data-action="kick">${ICONS.boot}<span class="label">Kick player</span></button>` : ''}
    <button class="btn ${r.you.spectator ? 'is-on' : ''}" data-action="spectator" aria-pressed="${r.you.spectator}">${ICONS.eye}<span class="label">${r.you.spectator ? 'Leave spectator mode' : 'Spectator mode'}</span></button>
    ${r.you.isCreator ? `<button class="btn btn-icon" data-action="settings" aria-label="Room settings" title="Room settings">${ICONS.gear}</button>` : ''}
    <button class="btn btn-ghost" data-action="leave">${ICONS.exit}<span class="label">Leave</span></button>`;
}

async function onRoomAction(e) {
  const b = e.target.closest('[data-action]');
  if (!b) return;
  const r = S.room;
  switch (b.dataset.action) {
    case 'invite': {
      try {
        await copyText(`${location.origin}/room/${S.roomId}`);
      } catch {
        toast('Copying failed. Share the page address instead.', 'error');
        break;
      }
      S.inviteCopiedUntil = Date.now() + 2500;
      renderActions();
      setTimeout(() => S.room && renderActions(), 2600);
      break;
    }
    case 'spectator':
      act({ type: 'spectator', spectator: !r.you.spectator }).catch(() => {});
      break;
    case 'kick':
      openKickModal();
      break;
    case 'settings':
      openSettingsModal();
      break;
    case 'leave':
      leaveRoom(true);
      break;
    default:
  }
}

// ----- table geometry -----
const SEAT_W = 104;
const SEAT_H = 124;

function layoutFor(n) {
  // The table grows with the number of players so seats never crowd each other.
  const compact = ($('#stage')?.clientWidth || 1000) < 620;
  const perimeterNeeded = Math.max(n, 1) * (compact ? 108 : 120);
  const a = Math.max(compact ? 200 : 270, perimeterNeeded / 5.16);
  const b = Math.max(compact ? 170 : 180, a * 0.62);
  return {
    a, b,
    width: 2 * a + SEAT_W + 16,
    height: 2 * b + SEAT_H + 8,
    tableW: 2 * (a - 60),
    tableH: 2 * (b - 70),
  };
}

function renderSeats() {
  const r = S.room;
  const players = r.players;
  const L = layoutFor(players.length);
  const scaleBox = $('#table-scale');
  const seatsEl = $('#seats');
  scaleBox.style.width = `${L.width}px`;
  scaleBox.style.height = `${L.height}px`;
  const table = $('#table');
  table.style.width = `${L.tableW}px`;
  table.style.height = `${L.tableH}px`;
  fitTable();

  const alive = new Set();
  players.forEach((p, i) => {
    alive.add(p.id);
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / players.length;
    const x = L.width / 2 + L.a * Math.cos(angle);
    const y = L.height / 2 + L.b * Math.sin(angle);
    let el = S.seatEls.get(p.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'seat';
      el.dataset.id = p.id;
      el.innerHTML = '<div class="slot"></div><div class="seat-avatar"></div><div class="seat-name"></div>';
      seatsEl.appendChild(el);
      S.seatEls.set(p.id, el);
      bindSeatHover(el);
    }
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.classList.toggle('top', Math.sin(angle) < -0.2);
    el.classList.toggle('offline', !p.connected);
    el.classList.toggle('is-you', p.id === r.you.id);

    const avatarKey = JSON.stringify(p.avatar) + p.name;
    const av = el.querySelector('.seat-avatar');
    if (av.dataset.key !== avatarKey) {
      av.dataset.key = avatarKey;
      av.innerHTML = avatarHtml(p.avatar, p.name);
    }
    const throwable = r.settings.throwing && p.id !== r.you.id;
    av.classList.toggle('throwable', throwable);
    av.tabIndex = throwable ? 0 : -1;
    av.setAttribute('aria-label', throwable ? `Throw something at ${p.name}` : p.name);

    el.querySelector('.seat-name').innerHTML = `${p.isCreator ? '<span class="crown" title="Room creator">★</span>' : ''}${esc(p.name)}${p.id === r.you.id ? ' (you)' : ''}${p.connected ? '' : ' (away)'}`;

    const slot = el.querySelector('.slot');
    let cls = 'slot slot-empty';
    let inner = '';
    let label = `${p.name} has not voted`;
    if (p.spectator) {
      cls = 'slot slot-spectator';
      inner = ICONS.eye;
      label = `${p.name} is spectating`;
    } else if (r.phase === 'revealed') {
      if (p.vote != null) {
        cls = `slot slot-revealed${isLong(p.vote) ? ' small-text' : ''}`;
        inner = esc(p.vote);
        label = `${p.name} voted ${p.vote}`;
        if (p.id === r.you.id) {
          inner += `<button type="button" class="edit-vote ${S.editingVote ? 'active' : ''}" aria-pressed="${S.editingVote}" aria-label="Change your card" title="Change your card">${ICONS.pencil}</button>`;
        }
      } else {
        cls = 'slot slot-none';
        inner = '—';
        label = `${p.name} did not vote`;
      }
    } else if (p.voted) {
      cls = 'slot slot-voted';
      label = `${p.name} has voted`;
    }
    const key = cls + inner;
    if (slot.dataset.key !== key) {
      slot.dataset.key = key;
      slot.className = cls;
      slot.innerHTML = inner;
    }
    slot.setAttribute('aria-label', label);
    slot.setAttribute('role', 'img');
  });
  for (const [id, el] of S.seatEls) {
    if (!alive.has(id)) {
      el.remove();
      S.seatEls.delete(id);
    }
  }
}

function fitTable() {
  const box = $('#table-scale');
  const outer = $('#table-outer');
  if (!box || !outer) return;
  const w = parseFloat(box.style.width);
  const h = parseFloat(box.style.height);
  const avail = $('#stage').clientWidth - 4;
  const scale = Math.min(1, avail / w);
  box.style.transform = `scale(${scale})`;
  outer.style.width = `${w * scale}px`;
  outer.style.height = `${h * scale}px`;
}
window.addEventListener('resize', () => {
  if (S.room && $('#seats')) renderSeats();
});

function renderTableStatus() {
  const r = S.room;
  const el = $('#table-status');
  if (r.phase === 'countdown') {
    el.innerHTML = '';
    return;
  }
  $('#countdown').innerHTML = '';
  S.lastCountdownNum = null;
  if (r.phase === 'revealed') {
    const agreement = r.results?.agreement;
    el.innerHTML = `<h2>${agreement ? 'Full agreement' : 'Cards revealed'}</h2>
      <span class="sub">${r.results.voteCount} ${r.results.voteCount === 1 ? 'vote' : 'votes'}${r.you.vote ? '. Use the pencil to change yours.' : ''}</span>`;
    return;
  }
  const canReveal = r.you.isCreator && (r.allVoted || (r.settings.allowEarlyReveal && r.votedCount > 0));
  let title = r.allVoted ? 'Awaiting Reveal' : 'Voting in Progress';
  let sub = `${r.votedCount} of ${r.voterCount} voted`;
  if (r.voterCount === 0) {
    title = 'Waiting for players';
    sub = 'Invite your team to start voting';
  }
  el.innerHTML = `<h2>${title}</h2>
    <span class="sub">${sub}</span>
    ${canReveal ? '<button class="btn btn-primary" data-action="reveal">Reveal Cards</button>' : ''}
    <span class="timer" id="timer" ${S.timerEnd ? '' : 'hidden'}></span>`;
  tick();
}

function renderHand() {
  const r = S.room;
  const hand = $('#hand');
  const revealed = r.phase === 'revealed';
  let label;
  let enabled = true;
  if (r.you.spectator) {
    label = 'You’re spectating. Leave spectator mode to vote.';
    enabled = false;
  } else if (r.phase === 'countdown') {
    label = 'Revealing cards…';
    enabled = false;
  } else if (revealed) {
    if (!r.you.vote) {
      label = 'Cards are revealed. You can vote in the next round.';
      enabled = false;
    } else if (S.editingVote) {
      label = 'Pick a new card to change your vote.';
    } else {
      label = 'Cards are revealed. Use the pencil on your card to change it.';
      enabled = false;
    }
  } else {
    label = r.you.vote ? 'Card chosen. Tap it again to take it back.' : 'Choose your card';
  }
  hand.classList.toggle('editing', revealed && S.editingVote);
  hand.innerHTML = `<p class="hand-label">${label}</p>
    <div class="cards" role="group" aria-label="Deck">
      ${r.deck.map((c) => `<button type="button" class="card${isLong(c) ? ' small-text' : ''}" data-card="${esc(c)}" aria-pressed="${r.you.vote === c}" ${enabled ? '' : 'disabled'} aria-label="${c === COFFEE_CARD ? 'Coffee break' : c === SKIP_CARD ? 'Skip this vote' : `Vote ${esc(c)}`}">${esc(c)}</button>`).join('')}
    </div>`;
}

async function onHandClick(e) {
  const b = e.target.closest('[data-card]');
  if (!b || b.disabled) return;
  const r = S.room;
  const card = b.dataset.card;
  const revealed = r.phase === 'revealed';
  const value = !revealed && r.you.vote === card ? null : card;
  const previous = r.you.vote;
  r.you.vote = value; // optimistic
  if (revealed) S.editingVote = false;
  renderHand();
  try {
    await act({ type: 'vote', value });
  } catch {
    if (S.room === r) {
      r.you.vote = previous;
      renderHand();
    }
  }
}

function renderResults() {
  const r = S.room;
  const el = $('#results');
  if (r.phase !== 'revealed') {
    el.innerHTML = '';
    return;
  }
  const res = r.results;
  const max = Math.max(1, ...res.counts.map((c) => c.count));
  const stats = [];
  if (res.average !== null) stats.push(`<div class="stat"><b>${esc(res.average)}</b><span>Average</span></div>`);
  if (res.median !== null) stats.push(`<div class="stat"><b>${esc(res.median)}</b><span>Median</span></div>`);
  el.innerHTML = `
    <div class="results-panel">
      ${res.counts.length ? `<div class="tally" aria-label="Votes per card">
        ${res.counts.map((c) => `<div class="tally-item">
          <div class="tally-bar" aria-hidden="true"><i style="height:${(c.count / max) * 100}%"></i></div>
          <div class="tally-card${isLong(c.value) ? ' small-text' : ''}">${esc(c.value)}</div>
          <span class="tally-count">${c.count} ${c.count === 1 ? 'vote' : 'votes'}</span></div>`).join('')}
      </div>` : '<p class="hint">Nobody voted this round.</p>'}
      ${stats.length ? `<div class="stats">${stats.join('')}</div>` : ''}
      ${res.agreement ? '<span class="agreement">Full agreement 🎉</span>' : ''}
    </div>
    <button class="btn btn-primary btn-lg" data-action="reset">Vote again</button>`;
}

function celebrate() {
  confetti();
  const b = document.createElement('div');
  b.className = 'banner';
  b.textContent = 'Full agreement! 🎉';
  document.body.appendChild(b);
  setTimeout(() => b.remove(), 3300);
}

// ----- timers (countdown animation + vote timer) -----
function tick() {
  const now = performance.now();
  if (S.countdownEnd && S.room?.phase === 'countdown') {
    const n = Math.max(1, Math.ceil((S.countdownEnd - now) / 1000));
    if (n !== S.lastCountdownNum) {
      S.lastCountdownNum = n;
      $('#countdown').innerHTML = `<span>${n}</span>`;
    }
  }
  const t = $('#timer');
  if (t && S.timerEnd && S.room?.phase === 'voting') {
    const secs = Math.max(0, Math.ceil((S.timerEnd - now) / 1000));
    t.hidden = false;
    t.textContent = secs > 0 ? `⏱ ${secs}s left` : 'Time’s up';
    t.classList.toggle('urgent', secs <= 10);
  }
}
setInterval(tick, 200);

// ----- throw menu -----
let throwMenu = null;
let throwTarget = null;
let hideTimer = null;

function bindSeatHover(seat) {
  const av = seat.querySelector('.seat-avatar');
  const show = () => {
    if (!av.classList.contains('throwable')) return;
    clearTimeout(hideTimer);
    showThrowMenu(seat.dataset.id, av);
  };
  av.addEventListener('mouseenter', show);
  av.addEventListener('focus', show);
  av.addEventListener('click', (e) => {
    e.stopPropagation();
    if (throwTarget === seat.dataset.id && throwMenu && !throwMenu.hidden) hideThrowMenu(true);
    else show();
  });
  av.addEventListener('mouseleave', () => hideThrowMenu());
  av.addEventListener('blur', () => hideThrowMenu());
}

function showThrowMenu(playerId, anchor) {
  if (!throwMenu) {
    throwMenu = document.createElement('div');
    throwMenu.className = 'throw-menu';
    throwMenu.setAttribute('role', 'menu');
    throwMenu.innerHTML = THROWABLES.map((t) => `<button type="button" role="menuitem" data-throw="${t}" aria-label="Throw ${t}">${t}</button>`).join('');
    document.body.appendChild(throwMenu);
    throwMenu.addEventListener('mouseenter', () => clearTimeout(hideTimer));
    throwMenu.addEventListener('mouseleave', () => hideThrowMenu());
    throwMenu.addEventListener('focusin', () => clearTimeout(hideTimer));
    throwMenu.addEventListener('focusout', () => hideThrowMenu());
    throwMenu.addEventListener('click', (e) => {
      e.stopPropagation();
      const b = e.target.closest('[data-throw]');
      if (b && throwTarget) act({ type: 'throw', to: throwTarget, emoji: b.dataset.throw }).catch(() => {});
    });
  }
  throwTarget = playerId;
  const rect = anchor.getBoundingClientRect();
  throwMenu.style.left = `${Math.min(Math.max(rect.left + rect.width / 2, 170), innerWidth - 170)}px`;
  throwMenu.style.top = `${Math.max(rect.top - 6, 56)}px`;
  throwMenu.hidden = false;
}

function hideThrowMenu(now = false) {
  clearTimeout(hideTimer);
  const hide = () => {
    if (throwMenu) throwMenu.hidden = true;
    throwTarget = null;
  };
  if (now) hide();
  else hideTimer = setTimeout(hide, 280);
}
document.addEventListener('click', (e) => {
  if (throwMenu && !throwMenu.hidden && !e.target.closest('.throw-menu')) hideThrowMenu(true);
});
window.addEventListener('scroll', () => hideThrowMenu(true), { passive: true });

// ---------------- modals ----------------
let lastFocus = null;

function openModal(name, html) {
  closeModal();
  lastFocus = document.activeElement;
  const back = document.createElement('div');
  back.className = 'modal-backdrop';
  back.dataset.modal = name;
  back.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  back.addEventListener('mousedown', (e) => {
    if (e.target === back) closeModal();
  });
  document.body.appendChild(back);
  back.querySelector('input, select, button')?.focus();
  return back.firstElementChild;
}

function closeModal() {
  const m = $('.modal-backdrop');
  if (!m) return;
  m.remove();
  lastFocus?.focus?.();
}

function openSettingsModal() {
  const r = S.room;
  const modal = openModal('settings', `
    <form id="settings-form" novalidate>
      <div style="display:grid;gap:18px">
        <h2>Room settings</h2>
        ${settingsFormHtml(r.settings, { roomName: r.name })}
        <p class="hint">Changing the deck or the SKIP/coffee cards starts a new round.</p>
        <div class="modal-actions">
          <button type="button" class="btn" data-close>Cancel</button>
          <button type="submit" class="btn btn-primary">Save changes</button>
        </div>
      </div>
    </form>`);
  const form = $('#settings-form', modal);
  bindSettingsForm(form);
  $('[data-close]', modal).addEventListener('click', closeModal);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const error = validateSettingsForm(form);
    showFormError(form, error);
    if (error) return;
    const { roomName, settings } = readSettingsForm(form);
    try {
      await api(`/api/rooms/${S.roomId}/action`, { type: 'settings', name: roomName, settings });
      closeModal();
      toast('Settings saved for everyone');
    } catch (err) {
      showFormError(form, err.message);
    }
  });
}

function kickListHtml(selected = new Set()) {
  const others = S.room.players.filter((p) => p.id !== S.room.you.id);
  if (!others.length) return '<p class="hint">Nobody else is in the room.</p>';
  return others.map((p) => `<label class="kick-item"><input type="checkbox" value="${p.id}" ${selected.has(p.id) ? 'checked' : ''}>
    ${avatarHtml(p.avatar, p.name)}<span>${esc(p.name)}${p.spectator ? ' <span class="hint">(spectator)</span>' : ''}</span></label>`).join('');
}

function openKickModal() {
  const modal = openModal('kick', `
    <h2>Kick players</h2>
    <p class="hint">Kicked players leave the room and can’t rejoin it.</p>
    <div class="kick-list" id="kick-list">${kickListHtml()}</div>
    <div class="modal-actions">
      <button type="button" class="btn" data-close>Cancel</button>
      <button type="button" class="btn btn-danger" id="kick-confirm" disabled>Kick</button>
    </div>`);
  const selected = () => [...modal.querySelectorAll('#kick-list input:checked')].map((i) => i.value);
  const sync = () => {
    const n = selected().length;
    $('#kick-confirm', modal).disabled = n === 0;
    $('#kick-confirm', modal).textContent = n > 1 ? `Kick ${n} players` : 'Kick';
  };
  modal.addEventListener('change', sync);
  $('[data-close]', modal).addEventListener('click', closeModal);
  $('#kick-confirm', modal).addEventListener('click', async () => {
    const ids = selected();
    try {
      const { kicked } = await act({ type: 'kick', ids });
      closeModal();
      toast(kicked === 1 ? 'Player kicked' : `${kicked} players kicked`);
    } catch { /* toast shown */ }
  });
}

function refreshKickModal() {
  const list = $('#kick-list');
  if (!list) return;
  const selected = new Set([...list.querySelectorAll('input:checked')].map((i) => i.value));
  list.innerHTML = kickListHtml(selected);
  list.dispatchEvent(new Event('change', { bubbles: true }));
}

boot();
