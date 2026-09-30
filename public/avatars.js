// A small cast of original characters, drawn as SVG so they stay crisp at any size.

const INK = '#1d2433';

function eyes(y, gap = 13, style = 'dot', cx = 50) {
  const l = cx - gap;
  const r = cx + gap;
  if (style === 'happy') {
    return `<path d="M${l - 5} ${y + 1}q5 -7 10 0M${r - 5} ${y + 1}q5 -7 10 0" stroke="${INK}" stroke-width="3.2" fill="none" stroke-linecap="round"/>`;
  }
  if (style === 'sleepy') {
    return `<path d="M${l - 5} ${y}q5 5 10 0M${r - 5} ${y}q5 5 10 0" stroke="${INK}" stroke-width="3.2" fill="none" stroke-linecap="round"/>`;
  }
  if (style === 'big') {
    return `<circle cx="${l}" cy="${y}" r="7.5" fill="#fff"/><circle cx="${r}" cy="${y}" r="7.5" fill="#fff"/>
      <circle cx="${l + 1.5}" cy="${y + 1}" r="4.5" fill="${INK}"/><circle cx="${r + 1.5}" cy="${y + 1}" r="4.5" fill="${INK}"/>
      <circle cx="${l + 3}" cy="${y - 1}" r="1.5" fill="#fff"/><circle cx="${r + 3}" cy="${y - 1}" r="1.5" fill="#fff"/>`;
  }
  return `<circle cx="${l}" cy="${y}" r="4.6" fill="${INK}"/><circle cx="${r}" cy="${y}" r="4.6" fill="${INK}"/>
    <circle cx="${l + 1.6}" cy="${y - 1.6}" r="1.5" fill="#fff"/><circle cx="${r + 1.6}" cy="${y - 1.6}" r="1.5" fill="#fff"/>`;
}

function mouth(y, style = 'smile', cx = 50) {
  switch (style) {
    case 'open':
      return `<path d="M${cx - 7} ${y}q7 10 14 0z" fill="${INK}"/><path d="M${cx - 4} ${y + 4.5}q4 3 8 0" fill="#ff7a8a"/>`;
    case 'o':
      return `<ellipse cx="${cx}" cy="${y + 2}" rx="3.6" ry="4.4" fill="${INK}"/>`;
    case 'tongue':
      return `<path d="M${cx - 7} ${y}q7 7 14 0" stroke="${INK}" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M${cx + 1} ${y + 3}q3 8 7 1z" fill="#ff7a8a"/>`;
    case 'teeth':
      return `<path d="M${cx - 10} ${y}q10 9 20 0z" fill="${INK}"/><path d="M${cx - 7} ${y + 0.5}l2.5 3.5 2.5-3.5zM${cx + 2} ${y + 0.5}l2.5 3.5 2.5-3.5z" fill="#fff"/>`;
    case 'flat':
      return `<path d="M${cx - 5} ${y + 2}h10" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`;
    default:
      return `<path d="M${cx - 6} ${y}q6 6 12 0" stroke="${INK}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
  }
}

const blush = (y, gap = 22, cx = 50) =>
  `<ellipse cx="${cx - gap}" cy="${y}" rx="5" ry="3" fill="#ff8fa3" opacity=".55"/><ellipse cx="${cx + gap}" cy="${y}" rx="5" ry="3" fill="#ff8fa3" opacity=".55"/>`;

export const PRESET_AVATARS = [
  {
    id: 'blobby', name: 'Blobby', bg: '#d5f1dc',
    body: `<path d="M50 20c21 0 33 17 33 37S72 88 50 88 17 77 17 57s12-37 33-37z" fill="#46c173"/>` + eyes(52) + blush(62) + mouth(63),
  },
  {
    id: 'nimbus', name: 'Nimbus', bg: '#d6e6ff',
    body: `<path d="M26 76c-10 0-15-8-12-16 2-6 8-8 12-7 1-11 10-19 21-18 6-8 20-8 26 1 9 0 16 8 15 17 7 2 10 9 7 15-2 5-7 8-12 8z" fill="#fff"/>` + eyes(58, 11, 'sleepy') + blush(66, 19) + mouth(66, 'o'),
  },
  {
    id: 'toastie', name: 'Toastie', bg: '#ffe7c7',
    body: `<path d="M24 45c-8 0-11-16 3-22 12-6 34-6 46 0 14 6 11 22 3 22v38H24z" fill="#e0a45c"/><path d="M30 47c-5 0-7-11 2-15 10-5 26-5 36 0 9 4 7 15 2 15v31H30z" fill="#ffd89a"/>` + eyes(56, 10) + blush(64, 16) + mouth(64, 'open'),
  },
  {
    id: 'sprout', name: 'Sprout', bg: '#eef6cf',
    body: `<path d="M50 30c-2-10 4-18 14-19-1 10-6 16-14 19zM50 30c1-8-3-14-11-15 0 8 4 13 11 15z" fill="#6cb33f"/><path d="M50 28v8" stroke="#6cb33f" stroke-width="3"/><circle cx="50" cy="62" r="28" fill="#f2c14e"/>` + eyes(58, 11, 'happy') + blush(67, 18) + mouth(67),
  },
  {
    id: 'ghosty', name: 'Ghosty', bg: '#e6dcff',
    body: `<path d="M22 86V50c0-17 12-30 28-30s28 13 28 30v36l-7-6-7 6-7-6-7 6-7-6-7 6-7-6z" fill="#fbfaff"/>` + eyes(50, 11, 'big') + blush(62, 18) + mouth(62, 'tongue'),
  },
  {
    id: 'mochi', name: 'Mochi', bg: '#ffdfe6',
    body: `<path d="M25 44l-3-22 17 12zM75 44l3-22-17 12z" fill="#b6a5a0"/><ellipse cx="50" cy="60" rx="31" ry="27" fill="#d9ccc6"/><path d="M28 60h-12M29 65l-11 3M72 60h12M71 65l11 3" stroke="${INK}" stroke-width="1.6" stroke-linecap="round"/>` + eyes(56, 12) + blush(64, 20) + `<path d="M46 63l4 3 4-3" stroke="${INK}" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  {
    id: 'bun', name: 'Bun', bg: '#d7f3f2',
    body: `<ellipse cx="38" cy="26" rx="7" ry="17" fill="#fff"/><ellipse cx="62" cy="26" rx="7" ry="17" fill="#fff"/><ellipse cx="38" cy="28" rx="3.5" ry="11" fill="#ffb8c6"/><ellipse cx="62" cy="28" rx="3.5" ry="11" fill="#ffb8c6"/><circle cx="50" cy="62" r="27" fill="#fff"/>` + eyes(58, 11) + blush(66, 18) + mouth(66, 'o'),
  },
  {
    id: 'zorp', name: 'Zorp', bg: '#dcd7ff',
    body: `<path d="M50 32V18" stroke="#5a4bd1" stroke-width="3"/><circle cx="50" cy="16" r="5" fill="#ffd23f"/><ellipse cx="50" cy="60" rx="30" ry="26" fill="#7b6cf0"/><circle cx="50" cy="54" r="12" fill="#fff"/><circle cx="52" cy="55" r="7" fill="${INK}"/><circle cx="55" cy="52" r="2.2" fill="#fff"/>` + mouth(71, 'smile'),
  },
  {
    id: 'chompy', name: 'Chompy', bg: '#ffd9cf',
    body: `<path d="M30 40l-6-16 14 10zM70 40l6-16-14 10z" fill="#fff4d6"/><rect x="20" y="34" width="60" height="52" rx="22" fill="#f06b4f"/>` + eyes(54, 12, 'big') + mouth(68, 'teeth'),
  },
  {
    id: 'pip', name: 'Pip', bg: '#d4ecff',
    body: `<ellipse cx="50" cy="60" rx="27" ry="30" fill="#2e3c55"/><ellipse cx="50" cy="66" rx="18" ry="21" fill="#fff"/>` + eyes(50, 10) + `<path d="M44 58l6 6 6-6z" fill="#ffa62b"/>` + blush(62, 16),
  },
  {
    id: 'sprinkle', name: 'Sprinkle', bg: '#fff0d4',
    body: `<circle cx="50" cy="56" r="30" fill="#d9964b"/><path d="M22 52c0-16 13-26 28-26s28 10 28 26c-5 5-9-2-14 3-6 6-10-1-14 3-5 4-9-2-14 2-5 4-9-3-14-8z" fill="#ff8fb8"/><path d="M32 40l4 2M46 34l1 4M60 38l3-2M68 46l-2 3M40 46l3 1" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>` + eyes(58, 11, 'happy') + mouth(68),
  },
  {
    id: 'bolt', name: 'Bolt', bg: '#e1e7ee',
    body: `<path d="M50 28v-8" stroke="#8795a8" stroke-width="3"/><circle cx="50" cy="18" r="4" fill="#ff5d73"/><rect x="22" y="30" width="56" height="50" rx="12" fill="#9fb0c4"/><rect x="29" y="40" width="42" height="24" rx="8" fill="#1d2433"/><circle cx="41" cy="52" r="4.5" fill="#7df9c1"/><circle cx="59" cy="52" r="4.5" fill="#7df9c1"/><path d="M40 71h20" stroke="#1d2433" stroke-width="3" stroke-linecap="round" stroke-dasharray="3 3"/>`,
  },
];

const byId = new Map(PRESET_AVATARS.map((a) => [a.id, a]));

export function presetSvg(id) {
  const a = byId.get(id) || PRESET_AVATARS[0];
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${a.name}"><rect width="100" height="100" fill="${a.bg}"/>${a.body}</svg>`;
}

export function isPreset(id) {
  return byId.has(id);
}
