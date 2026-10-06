# Planning Poker

Real-time Planning Poker for sprint planning. Sign in with a Google or Microsoft account (any email domain by default), create a room, share the invite link, and vote on story points together or join as spectator. Features the usual card types to choose from and allows for a custom set to be created. There's also optional Skip and Coffee Cards.

The app has **no runtime dependencies**: a plain Node.js server (`node:http`) pushes live updates to browsers with Server-Sent Events, and verifies Google and Microsoft sign-in tokens with Node's built-in crypto. There is no database. Rooms, votes and profiles live in memory and disappear when a room empties or the server restarts, as the spec requires.

![Create a Room](https://github.com/farresto/planning-poker/blob/e643f5e4594bef3621de2308b33e8df49028800a/create-or-join-room.png)
![Room of 6](https://github.com/farresto/planning-poker/blob/e643f5e4594bef3621de2308b33e8df49028800a/1-room-6-players.png)
![Room of 24](https://github.com/farresto/planning-poker/blob/e643f5e4594bef3621de2308b33e8df49028800a/5b-room-24-players-revealed.png)



## Run locally

Requires Node.js 20 or newer.

```bash
npm run dev          # http://localhost:3000 with a test-only email sign-in enabled
npm test             # room logic, Google + Microsoft auth, HTTP + live-update flow
```

`npm run dev` sets `ALLOW_DEV_LOGIN=true`, which shows a "Sign in for testing" form that takes any email from an allowed domain without Google. Use several browser profiles or private windows to simulate a team. **Never set `ALLOW_DEV_LOGIN` in production.**

To test real Google sign-in locally, create the OAuth client below, add `http://localhost:3000` as an authorized JavaScript origin, and run:

```bash
GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com MICROSOFT_CLIENT_ID=<application-id> npm start
```

For Microsoft locally, add `http://localhost:3000/api/auth/microsoft/callback` as a redirect URI (step 3 below).

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
2. **APIs & Services → OAuth consent screen**: configure it (app name, support email). Choose **Internal** if the project belongs to the Workspace organization; otherwise **External**.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID** → type **Web application**.
4. Under **Authorized JavaScript origins** add your site URL (e.g. `https://planning-poker-xxxx.onrender.com`) and `http://localhost:3000`. No redirect URIs are needed.
5. Copy the **Client ID**.

### 3. Create the Microsoft app registration

1. Open the [Microsoft Entra admin center](https://entra.microsoft.com/) (any Microsoft account works; a free tenant is created if needed) → **Identity → Applications → App registrations → New registration**.
2. **Supported account types**: *Accounts in any organizational directory and personal Microsoft accounts*.
3. **Redirect URI**: platform **Web**, `https://<your-site>.onrender.com/api/auth/microsoft/callback`. After creating, add `http://localhost:3000/api/auth/microsoft/callback` too (**Authentication → Add URI**).
4. **Authentication → Implicit grant and hybrid flows**: tick **ID tokens**. No client secret is needed: the app only receives a signed ID token.
5. **Token configuration → Add optional claim → ID** → tick `email` and `xms_edov` (accept the prompt to add the Graph `email` permission).
6. Copy the **Application (client) ID** from **Overview**.

### 4. Deploy on Render

1. Sign in at [render.com](https://render.com) with GitHub → **New → Blueprint** → pick the repository. Render reads `render.yaml`.
2. When prompted, paste the Google Client ID into `GOOGLE_CLIENT_ID` and the Microsoft Application ID into `MICROSOFT_CLIENT_ID`. `SESSION_SECRET` is generated for you.
3. After the first deploy, copy the `onrender.com` URL into the OAuth client's authorized JavaScript origins (step 2.4) if you had not yet.

Free Render instances sleep after a period of inactivity and take a little while to wake on the next visit. Since nothing is stored, a sleep or redeploy closes all open rooms; people just create a new one.

Any host that runs a long-lived Node process works (Railway, Fly.io, Koyeb, a VM). Serverless platforms such as Vercel or Netlify Functions do **not** fit, because rooms live in the server's memory and live updates need open connections.

### Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID` | yes* | OAuth Web client ID used to verify Google sign-in tokens |
| `MICROSOFT_CLIENT_ID` | yes* | Entra app registration (Application ID) for Microsoft sign-in; the button is hidden when unset |
| `SESSION_SECRET` | recommended | Signs session cookies; if missing, a random one is used and everyone is signed out on restart |
| `ALLOWED_DOMAIN` | no | `*` (default) allows any email domain. Or a comma-separated list, e.g. `gmail.com,yourcompany.com` |
| `PUBLIC_URL` | no | Site address used to build the Microsoft redirect URI, e.g. `https://planning-poker-xxxx.onrender.com`. Worked out from the request if unset |
| `PORT` | no | Set automatically by most hosts (default 3000) |
| `ALLOW_DEV_LOGIN` | no | `true` enables email-only sign-in for local testing. Keep unset in production |

\* At least one of the two sign-in providers must be configured.

## How it works

```
server/index.js    HTTP server: static files, JSON API, Server-Sent Events stream per player
server/rooms.js    Room state machine (voting → countdown → revealed), timers, results, permissions
server/auth.js     Google + Microsoft ID token verification (RS256 against each provider's public keys) + signed cookie
shared/constants.js Decks, defaults, emoji lists; imported by both server and browser
public/            Single-page app (vanilla JS modules, no build step)
test/              node:test suite
```

- **Sign-in with Google**: Google Identity Services returns an ID token in a popup; the server checks its signature, audience, expiry and verified email.
- **Sign-in with Microsoft**: the button sends the browser to Microsoft (OpenID Connect, `response_mode=form_post`). Microsoft posts a signed ID token back to `/api/auth/microsoft/callback`; the server checks its signature, tenant issuer, audience, expiry, and a one-time nonce and state kept in a 10-minute cookie. For work/school accounts the `email` claim is only trusted when Microsoft marks it domain-verified (`xms_edov`); otherwise the sign-in name (UPN) is used, so nobody can pose as someone else's address. People are identified by email, so the same address through Google or Microsoft is the same person.
- **Allowed domains**: any by default (`ALLOWED_DOMAIN=*`). With a list, other domains get "Domain not allowed to use this site." The session is a signed, HTTP-only cookie (12 h); no user data is stored on the server.
- **Live updates**: each player keeps one event stream open; actions (vote, reveal, settings…) are plain POST requests. Every player receives a personalised view in which other people's cards stay hidden until the reveal, so votes can't be peeked at in dev tools.
- **Profile**: display name and picture choice are kept in the browser's local storage only and sent to a room when you join. Uploaded pictures are cropped and shrunk to 160 px in the browser before upload and kept in memory only while you're in the room.
