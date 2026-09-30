# Planning Poker

Real-time Planning Poker for sprint planning. Sign in with a Google account from the allowed domain (`globant.com` by default), create a room, share the invite link, and vote on story points together.

The app has **no runtime dependencies**: a plain Node.js server (`node:http`) pushes live updates to browsers with Server-Sent Events, and verifies Google sign-in tokens with Node's built-in crypto. There is no database. Rooms, votes and profiles live in memory and disappear when a room empties or the server restarts, as the spec requires.

## Run locally

Requires Node.js 20 or newer.

```bash
npm run dev          # http://localhost:3000 with a test-only email sign-in enabled
npm test             # 15 tests: room logic, auth, HTTP + live-update flow
```

`npm run dev` sets `ALLOW_DEV_LOGIN=true`, which shows a "Sign in for testing" form that takes any `@globant.com` email without Google. Use several browser profiles or private windows to simulate a team. **Never set `ALLOW_DEV_LOGIN` in production.**

To test real Google sign-in locally, create the OAuth client below, add `http://localhost:3000` as an authorized JavaScript origin, and run:

```bash
GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com npm start
```

## Deploy (GitHub + Render, free tier)

### 1. Push to GitHub

```bash
cd planning-poker
git init && git add . && git commit -m "Planning Poker"
git branch -M main
git remote add origin https://github.com/<your-user>/planning-poker.git
git push -u origin main
```

### 2. Create the Google OAuth client

1. Open [Google Cloud Console](https://console.cloud.google.com/) → create or pick a project.
2. **APIs & Services → OAuth consent screen**: configure it (app name, support email). Choose **Internal** if the project belongs to the Globant Workspace organization; otherwise **External**.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID** → type **Web application**.
4. Under **Authorized JavaScript origins** add your site URL (e.g. `https://planning-poker-xxxx.onrender.com`) and `http://localhost:3000`. No redirect URIs are needed.
5. Copy the **Client ID**.

### 3. Deploy on Render

1. Sign in at [render.com](https://render.com) with GitHub → **New → Blueprint** → pick the repository. Render reads `render.yaml`.
2. When prompted, paste the Google Client ID into `GOOGLE_CLIENT_ID`. `SESSION_SECRET` is generated for you.
3. After the first deploy, copy the `onrender.com` URL into the OAuth client's authorized JavaScript origins (step 2.4) if you had not yet.

Free Render instances sleep after a period of inactivity and take a little while to wake on the next visit. Since nothing is stored, a sleep or redeploy closes all open rooms; people just create a new one.

Any host that runs a long-lived Node process works (Railway, Fly.io, Koyeb, a VM). Serverless platforms such as Vercel or Netlify Functions do **not** fit, because rooms live in the server's memory and live updates need open connections.

### Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID` | yes | OAuth Web client ID used to verify Google sign-in tokens |
| `SESSION_SECRET` | recommended | Signs session cookies; if missing, a random one is used and everyone is signed out on restart |
| `ALLOWED_DOMAIN` | no | Email domain allowed in (default `globant.com`) |
| `PORT` | no | Set automatically by most hosts (default 3000) |
| `ALLOW_DEV_LOGIN` | no | `true` enables email-only sign-in for local testing. Keep unset in production |

## How it works

```
server/index.js    HTTP server: static files, JSON API, Server-Sent Events stream per player
server/rooms.js    Room state machine (voting → countdown → revealed), timers, results, permissions
server/auth.js     Google ID token verification (RS256 against Google's public keys) + signed cookie
shared/constants.js Decks, defaults, emoji lists; imported by both server and browser
public/            Single-page app (vanilla JS modules, no build step)
test/              node:test suite
```

- **Sign-in**: Google Identity Services returns an ID token; the server checks its signature, audience, expiry, verified email and the `@globant.com` suffix. Other domains get "Domain not allowed to use this site." The session is a signed, HTTP-only cookie (12 h); no user data is stored on the server.
- **Live updates**: each player keeps one event stream open; actions (vote, reveal, settings…) are plain POST requests. Every player receives a personalised view in which other people's cards stay hidden until the reveal, so votes can't be peeked at in dev tools.
- **Profile**: display name and picture choice are kept in the browser's local storage only and sent to a room when you join. Uploaded pictures are cropped and shrunk to 160 px in the browser before upload and kept in memory only while you're in the room.

## Behaviour details and choices

These points were not fully specified, so here is what the app does:

- **One room at a time**: joining a second room removes you from the first (that tab shows a notice). Opening the same room in a second tab takes over from the first tab.
- **Reloading or dropping connection**: you keep your seat and vote for 45 seconds, shown as "(away)". Away players who haven't voted don't block "everyone has voted".
- **Creator leaves**: the next longest-present player becomes the creator, so the room never gets stuck without someone who can reveal or change settings.
- **Kick**: kicked players cannot rejoin that room.
- **Reveal button**: appears for the creator once everyone voted, or as soon as one vote is in if "Allow reveal before voting finishes" is on. Players who hadn't voted can't vote that round.
- **Timer**: counts down for every round. At zero the cards are revealed automatically.
- **Coffee card** counts as 0 in the average and median. **SKIP** is shown in the tally but excluded from both, and from full agreement.
- **Median** also works on non-numeric decks (T-shirt, custom text) by card order. **Average** only shows on numeric decks.
- **Full agreement**: at least two votes, all on the same card (not SKIP). Confetti also fires if agreement is reached by someone editing their card after the reveal.
- **Changing the deck** (or the SKIP/coffee cards) from settings starts a new round, since existing votes may no longer be valid cards. Other settings apply instantly without resetting.
- **Vote again** is available to everyone, as the spec doesn't restrict it.
- **Emoji reactions** are rate-limited to 6 per 3 seconds per person.
