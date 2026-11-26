# BuJo Dashboard

A calm Bullet Journal style dashboard for your desktop, phone, tablet and e-reader. It is a static page with no backend or database of its own. All data comes from Google Calendar and Google Tasks through a small Google Apps Script Web App that you deploy in your own Google account.

```
○ event   • task   × done   > repeated   * priority
```

## What is on the page

| Block | Source | What you can do |
| --- | --- | --- |
| Header | — | Date, ISO week, clock, sync status, **Refresh**, **Week** layout toggle, **E-Ink** toggle, **Settings** |
| 01 Everyday | Google Tasks list `Everyday Reminders` | Tap to check off, see `[■■■□□□] 3/6`, **reset** all |
| 02 Today | Google Calendar | Timed and all-day events, past events crossed out, a "now" line, the current event highlighted |
| 03 Upcoming | Google Calendar | The next 7 to 14 days (Settings), grouped by date |
| 04 To-Dos · One-time | Google Tasks default list (`My Tasks`) | Check off, uncheck, quick-add. Overdue tasks are marked |
| 04 To-Dos · Repeated | Google Tasks list `Repeated Tasks` | Check off to finish the current cycle |

**Week layout.** The **Week** button changes Today and Upcoming into one "This week" list, Monday to Sunday. Each day shows its events only. To-dos stay in the To-Dos block. Everyday and To-Dos move to a narrower right column, and on a narrow screen (an e-reader or a phone) all blocks stack in one column. Past days of the week need the current `Code.gs` (it sends `earlierEvents`). With an older deployment, past days show no events.

Conventions you type in Google Tasks:

- Start a title with `*` (or `!`) to mark it as a priority. Priority tasks go to the top of the list.
- In a repeated task, write the cycle in the notes: `every: 3d`, `every: 2w`, `every: 1m`, or simply `daily`, `weekly`, `monthly`. Without a cycle, a task repeats every week. When you check it off, it stays done until the next cycle date, and then it opens again by itself.
- Everyday reminders open again each day. A time-driven trigger runs at about 03:00, and the first sync of a new day also resets them in case the trigger was late.

## 1. Set up the Apps Script backend

1. Go to <https://script.google.com> and create a new project, for example "BuJo API".
2. Open **Project Settings** and turn on **Show "appsscript.json" manifest file in editor**.
3. Replace the contents of `Code.gs` and `appsscript.json` with the files from `apps-script/`.
4. In the editor, select the function `setup` and click **Run**. Accept the permissions (Calendar read-only, Tasks, triggers, external requests, your email address).
   `setup` saves your Google account as `ALLOWED_EMAIL`, creates the `Everyday Reminders` and `Repeated Tasks` lists, and the daily reset trigger. It also removes the old `TOKEN` property if there is one.
5. Click **Deploy → New deployment → Web app**. Set *Execute as* to **Me** and *Who has access* to **Anyone**. Copy the Web App URL (it ends with `/exec`).

"Anyone" is necessary because a static page cannot send your Google cookies to Apps Script. The script itself refuses every data request that does not come from a device you signed in with your Google account (see [Access control](#access-control)).

## 2. Create the Google sign-in client

The page uses Google Identity Services ("Sign in with Google"). It needs an OAuth client ID. The client ID is not a secret.

1. Open <https://console.cloud.google.com>, and create a project (or use an existing one).
2. Go to **APIs & Services → OAuth consent screen** (in the new console: **Google Auth Platform**). Choose **External**, add an app name and your email. You do not need to add scopes: sign-in uses only `openid`, `email` and `profile`. Under **Audience → Test users**, add your Google account. The app can stay in *Testing* mode.
3. Go to **APIs & Services → Credentials → Create credentials → OAuth client ID**. Application type: **Web application**.
4. Under **Authorized JavaScript origins**, add:
   - `http://localhost`
   - `http://localhost:5173`
   - your host, without a path, for example `https://your-name.github.io`

   Leave **Authorized redirect URIs** empty.
5. Copy the **Client ID** (it ends with `.apps.googleusercontent.com`).
6. In Apps Script, open **Project Settings → Script Properties** and add `CLIENT_ID` with this value. The page reads the client ID from the Web App, so you do not type it on each device.

Google sign-in works only on `https://` pages and on `localhost`. It does not work when you open the dev server through your network address (for example `http://192.168.1.20:5173`). Use a pairing code there, or test with the hosted page.

Optional script properties:

| Property | Default | Meaning |
| --- | --- | --- |
| `REMINDERS_LIST` | `Everyday Reminders` | List name or id for the Everyday block |
| `ONE_TIME_LIST` | `@default` | List name or id for one-time to-dos |
| `REPEATED_LIST` | `Repeated Tasks` | List name or id for repeated to-dos |
| `CALENDAR_IDS` | (default calendar) | Comma-separated calendar ids. You can also choose the calendars in **Settings → Calendars** on a device that is signed in with Google. The choice is saved here and is used on all devices |
| `UPCOMING_DAYS` | `14` | Used when the page does not send a value |
| `ALLOWED_EMAIL` | (set by `setup`) | The only Google account that can sign in. If you change it, all signed-in devices are signed out |
| `CLIENT_ID` | — | OAuth client ID from step 2. Required |
| `DEVICE_IDLE_DAYS` | `90` | A device that does not sync for this many days must sign in again |

After you change `Code.gs`, use **Deploy → Manage deployments → Edit → New version**, so the same URL gets the new code.

## 3. Build and run the page

Requires Node.js 22.18 or newer.

```bash
npm install
npm run build     # writes dist/ and checks that the bundle is ES5
npm run dev       # rebuilds on change and serves dist/ at http://localhost:5173
npm run serve     # serves an existing dist/ build
npm test          # unit tests for the page logic and the Apps Script access control
```

`npm run dev` and `npm run serve` also print your local network address, so you can open the page on an e-reader or a phone on the same Wi-Fi.

Open the page, click **Settings**, and paste the Web App URL. Then click **Sign in with Google** and choose your account. The URL and this device's sign-in stay in that browser's `localStorage` only. They are never in the HTML, so the built site is safe to host publicly.

To connect an e-reader (or any browser where Google sign-in does not work):

1. On a device where you signed in with Google, open **Settings** and click **Add a device**. A code such as `K7MQ-2XWP` shows.
2. On the e-reader, open **Settings**, paste the Web App URL, type the code in **Pairing code**, and click **Pair**.

A code works one time, for 10 minutes. **Settings → Devices** shows all signed-in devices, and you can remove one there (for example a lost e-reader). **Sign out** removes the current device.

## 4. Host it

`dist/` is a plain static site. Upload it to any static host: GitHub Pages, Netlify, Cloudflare Pages, or a folder on your own server. All paths are relative, so a sub-folder works too.

- **Phone / tablet:** open the page and use "Add to Home Screen". The page has a web manifest and icons, so it opens like an app.
- **Google sign-in:** add the host's origin (for example `https://your-name.github.io`) to **Authorized JavaScript origins** of the OAuth client. A new origin can take a few minutes to work.
- **E-reader:** bookmark the page with `?eink=1` at the end of the URL (for example `https://you.github.io/bujo/?eink=1`). This turns E-Ink mode on for that device. `?eink=0` turns it off. Add `&layout=week` (or `&layout=classic`) to set the layout for that device too.

## Access control

Only your Google account can use the dashboard:

- On a capable browser, Google sign-in gives the page a signed ID token. The page sends it to the Web App one time. The Web App checks it with Google's `tokeninfo` endpoint: the audience must be your `CLIENT_ID`, the issuer must be Google, the email must be verified and must be the same as `ALLOWED_EMAIL`, and the token must not be expired.
- When the check passes, the Web App gives a random **device token**. The page stores it in `localStorage` and sends it with each request. The Web App stores only a SHA-256 hash of the secret part, in the `DEVICES` script property.
- Old e-reader browsers cannot run Google sign-in, so they use a one-time **pairing code** that you make on a signed-in device. After 10 incorrect codes, pairing stops for 10 minutes.
- Paired devices can read and change the dashboard, but they cannot make pairing codes or remove other devices.

Trade-off: a device token is a long-lived bearer secret, the same as the old shared token, but each device has its own token that expires when not used and that you can remove. If someone copies the `localStorage` of a signed-in device, they can use the dashboard until you remove that device.

## E-ink and old browser support

The source is modern JavaScript (ES modules, classes with private fields, `async`/`await`, `??`, spread). The build turns it into one ES5 file that runs on old WebKit, such as the PocketBook browser and the experimental Kindle browser:

- **Rollup** bundles the modules into one IIFE script.
- **Babel 8** (`@babel/preset-env`) transpiles the code for the targets in `browserslist` in `package.json` (Safari 5.1 and newer, Android 4.4, and current browsers).
- **core-js 3** (through `babel-plugin-polyfill-corejs3`) adds only the polyfills the code uses, for example `Promise`, `Object.assign` and `Array.prototype.find`.
- **es-check** fails the build if any non-ES5 syntax is left in `dist/`.
- The file names have content hashes, so an e-reader never keeps an old cached script.

The code also avoids browser APIs that old engines do not have: it uses `XMLHttpRequest` (with a JSONP fallback for browsers that block cross-origin requests), formats dates without `Intl`, and parses date strings by hand. The CSS uses no Grid, no CSS variables and no flexbox. It uses floats and `display: table` instead.

**E-Ink mode** gives a pure white background, pure black ink, 2px borders, no shadows, no transitions or animations, and larger text. The page redraws a block only when its data changes, and in E-Ink mode the clock in the "now" line does not tick, so the screen does not flash every minute. Auto-refresh is set in Settings (default 15 minutes, `0` turns it off). **Refresh** syncs on demand.

## Project layout

```
apps-script/
  Code.gs              Web App: sign-in check, device tokens, Calendar + Tasks API, daily reset trigger
  appsscript.json      Manifest: V8 runtime, Tasks advanced service, scopes
src/
  index.html           Page skeleton
  styles/app.css       Paper, dot grid and E-Ink styles
  js/main.js           Entry point
  js/app.js            Dashboard controller: sync, actions, rendering
  js/api.js            XHR + JSONP transport to the Web App
  js/auth.js           Device names and pairing code format
  js/google.js         Loads Google sign-in and draws its button
  js/render.js         Block renderers
  js/bujo.js           Signifiers, progress bar, grouping, cycles
  js/dates.js          Date helpers without Intl
  js/settings.js       Settings in localStorage
  js/storage.js        Safe localStorage wrapper
  public/              Manifest and icons, copied to dist/ as they are
scripts/               Dev server and watch helper
test/                  node:test unit tests
rollup.config.mjs      Bundle + Babel + static files + hashed names
babel.config.mjs       Babel targets, assumptions and polyfill settings
```

## New events

**+ Event** in the header opens a small form: title, calendar, date, and start and end times (or all day). The calendar list has the calendars that the dashboard shows and that your account owns. Subscribed calendars, such as school or holiday calendars, are read-only. The page remembers the last calendar you used. On an old e-reader browser without date and time pickers, type the date as `YYYY-MM-DD` and the times as `HH:MM`.

Creating events needs the full Calendar scope (`https://www.googleapis.com/auth/calendar`) in `appsscript.json`. After you update the files, Apps Script asks you to approve this permission again.
