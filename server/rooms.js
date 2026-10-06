import crypto from 'node:crypto';
import {
  DEFAULT_SETTINGS, DECKS, SKIP_CARD, COFFEE_CARD, REACTIONS, THROWABLES,
  TIMER_MIN, TIMER_MAX, COUNTDOWN_MS, MAX_PLAYERS, ROOM_FULL_ERROR, buildDeck, cardNumber, parseCustomValues,
} from '../shared/constants.js';

const BOOL_KEYS = ['skipCard', 'coffeeCard', 'autoReveal', 'allowEarlyReveal', 'timer',
  'showAverage', 'showMedian', 'countdown', 'emojis', 'throwing'];

export class ActionError extends Error {}

/** Validate settings coming from a client, merged on top of `base`. */
export function sanitizeSettings(input = {}, base = DEFAULT_SETTINGS) {
  const s = { ...base };
  if (input.deckType !== undefined) {
    if (!Object.hasOwn(DECKS, input.deckType)) throw new ActionError('Unknown deck type.');
    s.deckType = input.deckType;
  }
  if (input.customValues !== undefined) s.customValues = String(input.customValues).slice(0, 400);
  for (const k of BOOL_KEYS) if (input[k] !== undefined) s[k] = Boolean(input[k]);
  if (input.timerSeconds !== undefined) {
    const n = Math.round(Number(input.timerSeconds));
    if (!Number.isFinite(n) || n < TIMER_MIN || n > TIMER_MAX) {
      throw new ActionError(`Timer must be between ${TIMER_MIN} and ${TIMER_MAX} seconds.`);
    }
    s.timerSeconds = n;
  }
  if (s.deckType === 'custom') {
    const parsed = parseCustomValues(s.customValues);
    if (parsed.error) throw new ActionError(parsed.error);
    s.customValues = parsed.values.join(', ');
  }
  return s;
}

export function sanitizeRoomName(name) {
  const n = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!n) throw new ActionError('Give the room a name.');
  return n;
}

export function sanitizeDisplayName(name, fallback) {
  const n = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 32);
  return n || fallback;
}

/** Compute results for revealed votes. */
export function computeResults(votes, settings) {
  const deck = buildDeck(settings);
  const counts = new Map();
  for (const v of votes) counts.set(v, (counts.get(v) || 0) + 1);
  const ordered = deck.cards.filter((c) => counts.has(c)).map((c) => ({ value: c, count: counts.get(c) }));
  // Votes whose card no longer exists in the deck (should not happen, but be safe).
  for (const [value, count] of counts) if (!deck.cards.includes(value)) ordered.push({ value, count });

  const valid = votes.filter((v) => v !== SKIP_CARD);
  let average = null;
  let median = null;
  if (valid.length) {
    if (deck.numeric) {
      const nums = valid.map(cardNumber).filter((n) => n !== null).sort((a, b) => a - b);
      if (nums.length) {
        average = round(nums.reduce((a, b) => a + b, 0) / nums.length);
        const mid = Math.floor(nums.length / 2);
        median = round(nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2);
      }
    } else {
      // Ordinal median (e.g. T-shirt sizes). Coffee sits below the first card.
      const rank = (v) => (v === COFFEE_CARD ? -1 : deck.values.indexOf(v));
      const sorted = [...valid].sort((a, b) => rank(a) - rank(b));
      const mid = Math.floor(sorted.length / 2);
      median = sorted.length % 2 || sorted[mid - 1] === sorted[mid]
        ? sorted[mid] : `${sorted[mid - 1]} / ${sorted[mid]}`;
    }
  }
  const agreement = votes.length >= 2 && votes[0] !== SKIP_CARD && votes.every((v) => v === votes[0]);
  return {
    counts: ordered,
    average: settings.showAverage && deck.numeric ? average : null,
    median: settings.showMedian ? median : null,
    agreement,
    voteCount: votes.length,
  };
}

function round(n) {
  return Math.round(n * 100) / 100;
}

export function publicId(email) {
  return crypto.createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 12);
}

/**
 * Holds all rooms. Transport-agnostic: it calls `emit(roomId, userEmail|null, event, data)`
 * to push events; userEmail null means "everyone in the room".
 */
export class RoomManager {
  constructor({ emit = () => {}, graceMs = 45_000, emptyRoomTtlMs = 10 * 60_000, now = () => Date.now() } = {}) {
    this.rooms = new Map();
    this.userRoom = new Map(); // email -> roomId
    this.emit = emit;
    this.graceMs = graceMs;
    this.emptyRoomTtlMs = emptyRoomTtlMs;
    this.now = now;
  }

  // ---------- lookup helpers ----------
  getRoom(roomId) {
    return this.rooms.get(roomId) || null;
  }

  requireRoom(roomId) {
    const room = this.getRoom(roomId);
    if (!room) throw new ActionError('This room no longer exists.');
    return room;
  }

  requirePlayer(room, email) {
    const p = room.players.get(email);
    if (!p) throw new ActionError('You are not in this room.');
    return p;
  }

  requireCreator(room, email) {
    if (room.creator !== email) throw new ActionError('Only the room creator can do that.');
  }

  // ---------- room lifecycle ----------
  createRoom(user, { name, settings }) {
    const room = {
      id: this.newRoomId(),
      name: sanitizeRoomName(name),
      settings: sanitizeSettings(settings),
      creator: user.email,
      players: new Map(),
      banned: new Set(),
      phase: 'voting', // voting | countdown | revealed
      round: 1,
      revealAt: null,
      timerEndsAt: null,
      lastAgreement: false,
      timeouts: {},
      joinSeq: 0,
    };
    this.rooms.set(room.id, room);
    this.scheduleEmptyCheck(room);
    return room;
  }

  newRoomId() {
    let id;
    do id = crypto.randomBytes(6).toString('base64url').replace(/[-_]/g, 'x').slice(0, 8);
    while (this.rooms.has(id));
    return id;
  }

  join(roomId, user, { spectator = false, profile = {} } = {}) {
    const room = this.requireRoom(roomId);
    if (room.banned.has(user.email)) throw new ActionError('You were removed from this room by its creator.');
    if (!room.players.has(user.email) && room.players.size >= MAX_PLAYERS) throw new ActionError(ROOM_FULL_ERROR);
    const previous = this.userRoom.get(user.email);
    if (previous && previous !== roomId) this.leave(previous, user.email, 'joined-other-room');

    let p = room.players.get(user.email);
    if (!p) {
      p = {
        email: user.email,
        id: publicId(user.email),
        name: user.name,
        avatar: { kind: 'google', url: user.picture || null },
        spectator: Boolean(spectator),
        vote: null,
        connected: false,
        seq: room.joinSeq++,
        disconnectTimer: null,
        lastEmojiTimes: [],
      };
      room.players.set(user.email, p);
      if (room.phase === 'voting' && room.settings.timer && !room.timerEndsAt) this.startTimer(room);
    } else {
      p.spectator = Boolean(spectator);
      if (p.spectator) p.vote = null;
    }
    this.applyProfile(p, user, profile);
    this.userRoom.set(user.email, roomId);
    clearTimeout(room.timeouts.empty);
    this.broadcast(room);
    return room;
  }

  applyProfile(p, user, profile = {}) {
    p.name = sanitizeDisplayName(profile.name, user.name || user.email.split('@')[0]);
    const a = profile.avatar || {};
    if (a.kind === 'preset' && /^[a-z0-9-]{1,24}$/.test(a.id || '')) {
      p.avatar = { kind: 'preset', id: a.id };
    } else if (a.kind === 'upload' && a.image) {
      p.avatar = { kind: 'upload', image: a.image, version: a.image.hash };
    } else {
      p.avatar = { kind: 'google', url: user.picture || null };
    }
  }

  setConnected(roomId, email, connected) {
    const room = this.getRoom(roomId);
    const p = room?.players.get(email);
    if (!p) return;
    p.connected = connected;
    clearTimeout(p.disconnectTimer);
    if (!connected) {
      p.disconnectTimer = setTimeout(() => this.leave(roomId, email, 'disconnected'), this.graceMs);
      p.disconnectTimer.unref?.();
    }
    this.checkAutoReveal(room);
    this.broadcast(room);
  }

  leave(roomId, email, reason = 'left') {
    const room = this.getRoom(roomId);
    const p = room?.players.get(email);
    if (!p) return;
    clearTimeout(p.disconnectTimer);
    room.players.delete(email);
    if (this.userRoom.get(email) === roomId) this.userRoom.delete(email);
    if (reason !== 'disconnected') this.emit(roomId, email, 'removed', { reason });
    if (room.creator === email) {
      const next = [...room.players.values()].sort((a, b) => (b.connected - a.connected) || (a.seq - b.seq))[0];
      if (next) room.creator = next.email;
    }
    if (room.players.size === 0) {
      this.scheduleEmptyCheck(room);
      return;
    }
    this.checkAutoReveal(room);
    this.refreshAgreement(room);
    this.broadcast(room);
  }

  scheduleEmptyCheck(room) {
    clearTimeout(room.timeouts.empty);
    room.timeouts.empty = setTimeout(() => {
      if (room.players.size === 0) this.destroyRoom(room);
    }, this.emptyRoomTtlMs);
    room.timeouts.empty.unref?.();
  }

  destroyRoom(room) {
    for (const t of Object.values(room.timeouts)) clearTimeout(t);
    this.rooms.delete(room.id);
  }

  // ---------- voting ----------
  eligibleVoters(room) {
    return [...room.players.values()].filter((p) => !p.spectator && (p.connected || p.vote !== null));
  }

  allVoted(room) {
    const voters = this.eligibleVoters(room);
    return voters.length > 0 && voters.every((p) => p.vote !== null);
  }

  vote(roomId, email, value) {
    const room = this.requireRoom(roomId);
    const p = this.requirePlayer(room, email);
    if (p.spectator) throw new ActionError('Spectators do not vote. Leave spectator mode to vote.');
    if (value !== null && !buildDeck(room.settings).cards.includes(value)) throw new ActionError('That card is not in this deck.');
    if (room.phase === 'countdown') throw new ActionError('Cards are being revealed.');
    if (room.phase === 'revealed') {
      if (p.vote === null) throw new ActionError('You did not vote this round, so you cannot change a card.');
      if (value === null) throw new ActionError('Pick a card to change your vote.');
      p.vote = value;
      this.refreshAgreement(room);
    } else {
      p.vote = value;
      this.checkAutoReveal(room);
    }
    this.broadcast(room);
  }

  reveal(roomId, email) {
    const room = this.requireRoom(roomId);
    this.requireCreator(room, email);
    if (room.phase !== 'voting') throw new ActionError('Cards are already revealed.');
    const anyVote = [...room.players.values()].some((p) => p.vote !== null);
    if (!this.allVoted(room)) {
      if (!room.settings.allowEarlyReveal) throw new ActionError('Wait until everyone has voted.');
      if (!anyVote) throw new ActionError('Nobody has voted yet.');
    }
    this.startReveal(room);
  }

  checkAutoReveal(room) {
    if (room.phase === 'voting' && room.settings.autoReveal && this.allVoted(room)) this.startReveal(room);
  }

  startReveal(room) {
    this.clearTimer(room);
    if (room.settings.countdown) {
      room.phase = 'countdown';
      room.revealAt = this.now() + COUNTDOWN_MS;
      clearTimeout(room.timeouts.reveal);
      room.timeouts.reveal = setTimeout(() => this.finishReveal(room), COUNTDOWN_MS);
      room.timeouts.reveal.unref?.();
      this.broadcast(room);
    } else {
      this.finishReveal(room);
    }
  }

  finishReveal(room) {
    if (!this.rooms.has(room.id) || room.phase === 'revealed') return;
    room.phase = 'revealed';
    room.revealAt = null;
    // Spectators never have votes; non-voters lose the ability to vote this round.
    room.lastAgreement = false;
    this.refreshAgreement(room);
    this.broadcast(room);
  }

  refreshAgreement(room) {
    if (room.phase !== 'revealed') return;
    const { agreement } = computeResults(this.votes(room), room.settings);
    if (agreement && !room.lastAgreement) {
      // Deliver after the state update that shows the revealed cards.
      setTimeout(() => this.emit(room.id, null, 'celebrate', { round: room.round }), 0);
    }
    room.lastAgreement = agreement;
  }

  votes(room) {
    return [...room.players.values()].filter((p) => !p.spectator && p.vote !== null).map((p) => p.vote);
  }

  resetVoting(roomId, email) {
    const room = this.requireRoom(roomId);
    this.requirePlayer(room, email);
    this.resetRound(room);
    this.broadcast(room);
  }

  resetRound(room) {
    clearTimeout(room.timeouts.reveal);
    for (const p of room.players.values()) p.vote = null;
    room.phase = 'voting';
    room.revealAt = null;
    room.round += 1;
    room.lastAgreement = false;
    this.clearTimer(room);
    if (room.settings.timer) this.startTimer(room);
  }

  // ---------- timer ----------
  startTimer(room) {
    this.clearTimer(room);
    room.timerEndsAt = this.now() + room.settings.timerSeconds * 1000;
    room.timeouts.timer = setTimeout(() => {
      room.timerEndsAt = null;
      if (room.phase === 'voting') this.startReveal(room);
    }, room.settings.timerSeconds * 1000);
    room.timeouts.timer.unref?.();
  }

  clearTimer(room) {
    clearTimeout(room.timeouts.timer);
    room.timerEndsAt = null;
  }

  // ---------- player & room management ----------
  setSpectator(roomId, email, spectator) {
    const room = this.requireRoom(roomId);
    const p = this.requirePlayer(room, email);
    p.spectator = Boolean(spectator);
    if (p.spectator) p.vote = null;
    this.checkAutoReveal(room);
    this.refreshAgreement(room);
    this.broadcast(room);
  }

  updateProfile(roomId, user, profile) {
    const room = this.requireRoom(roomId);
    const p = this.requirePlayer(room, user.email);
    this.applyProfile(p, user, profile);
    this.broadcast(room);
  }

  updateSettings(roomId, email, input) {
    const room = this.requireRoom(roomId);
    this.requireCreator(room, email);
    if (input.name !== undefined) room.name = sanitizeRoomName(input.name);
    const before = room.settings;
    const after = sanitizeSettings(input.settings || {}, before);
    room.settings = after;
    const deckChanged = buildDeck(before).cards.join('\n') !== buildDeck(after).cards.join('\n');
    if (deckChanged) {
      this.resetRound(room);
    } else if (room.phase === 'voting') {
      if (after.timer && (!before.timer || before.timerSeconds !== after.timerSeconds)) this.startTimer(room);
      if (!after.timer) this.clearTimer(room);
      this.checkAutoReveal(room);
    }
    this.broadcast(room);
    return { deckChanged };
  }

  kick(roomId, email, ids) {
    const room = this.requireRoom(roomId);
    this.requireCreator(room, email);
    const targets = [...room.players.values()].filter((p) => ids.includes(p.id) && p.email !== email);
    if (!targets.length) throw new ActionError('Select at least one player to kick.');
    for (const p of targets) {
      room.banned.add(p.email);
      this.leave(roomId, p.email, 'kicked');
    }
    return targets.length;
  }

  react(roomId, email, emoji) {
    const room = this.requireRoom(roomId);
    const p = this.requirePlayer(room, email);
    if (!room.settings.emojis) throw new ActionError('Emojis are turned off in this room.');
    if (!REACTIONS.includes(emoji)) throw new ActionError('Unknown emoji.');
    this.rateLimit(p);
    this.emit(roomId, null, 'emoji', { from: p.id, name: p.name, emoji });
  }

  throwAt(roomId, email, targetId, emoji) {
    const room = this.requireRoom(roomId);
    const p = this.requirePlayer(room, email);
    if (!room.settings.throwing) throw new ActionError('Throwing is turned off in this room.');
    if (!THROWABLES.includes(emoji)) throw new ActionError('Unknown emoji.');
    const target = [...room.players.values()].find((x) => x.id === targetId);
    if (!target) throw new ActionError('That player is no longer here.');
    if (target === p) throw new ActionError('You cannot throw at yourself.');
    this.rateLimit(p);
    this.emit(roomId, null, 'throw', { from: p.id, to: target.id, emoji });
  }

  rateLimit(p) {
    const t = this.now();
    p.lastEmojiTimes = p.lastEmojiTimes.filter((x) => t - x < 3000);
    if (p.lastEmojiTimes.length >= 6) throw new ActionError('Slow down a little.');
    p.lastEmojiTimes.push(t);
  }

  // ---------- views ----------
  broadcast(room) {
    this.emit(room.id, null, 'state', null);
  }

  viewFor(roomId, email) {
    const room = this.getRoom(roomId);
    if (!room) return null;
    const me = room.players.get(email);
    if (!me) return null;
    const revealed = room.phase === 'revealed';
    const deck = buildDeck(room.settings);
    const players = [...room.players.values()].sort((a, b) => a.seq - b.seq).map((p) => ({
      id: p.id,
      name: p.name,
      avatar: this.avatarView(room, p),
      spectator: p.spectator,
      voted: p.vote !== null,
      vote: revealed || p === me ? p.vote : null,
      connected: p.connected,
      isCreator: room.creator === p.email,
    }));
    const t = this.now();
    return {
      id: room.id,
      name: room.name,
      settings: room.settings,
      deck: deck.cards,
      numericDeck: deck.numeric,
      phase: room.phase,
      round: room.round,
      players,
      you: { id: me.id, isCreator: room.creator === email, spectator: me.spectator, vote: me.vote },
      allVoted: this.allVoted(room),
      votedCount: players.filter((p) => !p.spectator && p.voted).length,
      voterCount: this.eligibleVoters(room).length,
      countdownRemainingMs: room.revealAt ? Math.max(0, room.revealAt - t) : null,
      timerRemainingMs: room.timerEndsAt ? Math.max(0, room.timerEndsAt - t) : null,
      results: revealed ? computeResults(this.votes(room), room.settings) : null,
    };
  }

  avatarView(room, p) {
    if (p.avatar.kind === 'preset') return { kind: 'preset', id: p.avatar.id };
    if (p.avatar.kind === 'upload') return { kind: 'url', url: `/api/rooms/${room.id}/avatars/${p.id}?v=${p.avatar.version}` };
    return p.avatar.url ? { kind: 'url', url: p.avatar.url } : { kind: 'initials' };
  }

  avatarImage(roomId, playerId) {
    const room = this.getRoom(roomId);
    const p = room && [...room.players.values()].find((x) => x.id === playerId);
    return p?.avatar.kind === 'upload' ? p.avatar.image : null;
  }
}
