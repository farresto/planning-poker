// Shared between the Node server and the browser (served at /shared/constants.js).

export const SKIP_CARD = 'SKIP';
export const COFFEE_CARD = '☕';

export const DECKS = {
  fibonacci: { label: 'Fibonacci', values: ['0', '1', '2', '3', '5', '8', '13', '21', '34', '55'] },
  modfib: { label: 'Modified Fibonacci', values: ['0', '½', '1', '2', '3', '5', '8', '13', '20', '40', '100'] },
  sequential: { label: 'Sequential', values: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'] },
  tshirt: { label: 'T-Shirt', values: ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL'] },
  powers2: { label: 'Powers of 2', values: ['0', '1', '2', '4', '8', '16', '32', '64', '128'] },
  half: { label: 'Half Cards', values: ['0', '0.5', '1', '1.5', '2', '2.5', '3'] },
  large: { label: 'Large Cards', values: ['0', '20', '40', '60', '80', '100'] },
  custom: { label: 'Custom', values: null },
};

export const DEFAULT_SETTINGS = {
  deckType: 'fibonacci',
  customValues: '',
  skipCard: true,
  coffeeCard: false,
  autoReveal: false,
  allowEarlyReveal: false,
  timer: false,
  timerSeconds: 60,
  showAverage: true,
  showMedian: false,
  countdown: true,
  emojis: true,
  throwing: true,
};

export const SETTING_LABELS = {
  skipCard: 'Include “SKIP” card',
  coffeeCard: 'Include coffee card ☕',
  autoReveal: 'Auto-reveal cards when everyone has voted',
  allowEarlyReveal: 'Allow reveal before voting finishes',
  timer: 'Add timer',
  showAverage: 'Show average result',
  showMedian: 'Show median result',
  countdown: 'Show countdown animation',
  emojis: 'Enable emojis',
  throwing: 'Enable throwing emojis at players',
};

export const REACTIONS = ['👍', '👏', '🎉', '😂', '🤔', '😱', '🔥', '❤️', '☕', '🚀', '🙈', '💯'];
export const THROWABLES = ['🍅', '🎯', '💖', '🧻', '🥚', '✈️', '🌸', '🏀'];

export const MAX_CUSTOM_CARDS = 20;
export const MAX_CARD_LENGTH = 10;
export const TIMER_MIN = 10;
export const TIMER_MAX = 600;
export const COUNTDOWN_MS = 3000;

/** Parse a card label to a number, or null if not numeric. */
export function cardNumber(v) {
  if (v === COFFEE_CARD) return 0;
  if (typeof v !== 'string') return null;
  const s = v.trim().replace('½', '.5');
  if (s === '.5') return 0.5;
  if (!/^-?\d+(\.\d+)?$|^-?\d*\.5$/.test(s)) return null;
  const n = Number(s.startsWith('.') ? '0' + s : s);
  return Number.isFinite(n) ? n : null;
}

/** Parse the free-text custom deck. Returns {values} or {error}. */
export function parseCustomValues(text) {
  const seen = new Set();
  const values = [];
  for (const raw of String(text || '').split(',')) {
    const v = raw.trim();
    if (!v || v.toUpperCase() === SKIP_CARD || v === COFFEE_CARD) continue;
    if (v.length > MAX_CARD_LENGTH) return { error: `Card “${v.slice(0, 12)}…” is longer than ${MAX_CARD_LENGTH} characters.` };
    if (seen.has(v)) continue;
    seen.add(v);
    values.push(v);
  }
  if (values.length < 2) return { error: 'Enter at least two card values, separated by commas.' };
  if (values.length > MAX_CUSTOM_CARDS) return { error: `Use at most ${MAX_CUSTOM_CARDS} card values.` };
  return { values };
}

/** Full ordered list of cards for a room's settings. */
export function buildDeck(settings) {
  let values;
  if (settings.deckType === 'custom') {
    values = parseCustomValues(settings.customValues).values || [];
  } else {
    values = (DECKS[settings.deckType] || DECKS.fibonacci).values;
  }
  const cards = [...values];
  if (settings.coffeeCard) cards.push(COFFEE_CARD);
  if (settings.skipCard) cards.push(SKIP_CARD);
  return { values, cards, numeric: values.length > 0 && values.every((v) => cardNumber(v) !== null) };
}
