# Bili Cache Watch

A local full-stack web app for importing Bilibili cached video BV IDs, checking whether videos are removed or restricted, and previewing locally cached abnormal videos with local danmaku.

## Run Locally

```powershell
npm install
npm run dev
```

Open `http://localhost:3000`.

If port `3000` is already in use:

```powershell
$env:PORT="3001"; npm run dev
```

The default check interval is 60 minutes. You can change it with:

```powershell
$env:CHECK_INTERVAL_MINUTES="30"; npm run dev
```

## Invite-Code Login

Set a private invite code and cookie signing secret before exposing the app:

```powershell
$env:PORT="3001"
$env:BILI_INVITE_CODE="reeshiram-YuBirdSing-202605"
$env:BILI_AUTH_SECRET="a-long-random-secret-at-least-32-characters"
node --experimental-sqlite src/server.js
```

When logged out, the home page, API, covers, previews, and downloads are redirected to the login page or return `401`. The default invite code is `change-me`; use it only for local testing.

You can also copy `.env.example` to `.env` and set `BILI_INVITE_CODE=reeshiram-YuBirdSing-202605`.

## Cloudflare Tunnel

This is the easiest free way to put the local app online without uploading your cache files:

1. Keep this computer running.
2. Keep the local server running on `http://localhost:3001`.
3. Start `cloudflared tunnel --url http://localhost:3001`.
4. Share the generated `trycloudflare.com` URL.
5. Visitors must enter the invite code before seeing anything.

Use the included Windows control panel:

```text
Bili Cache Watch Control Panel.cmd
```

It can start the local server, start the public tunnel, stop both, open the local URL, open the public URL, and copy the public URL.

## Docker

```powershell
docker build -t bili-cache-watch .
docker run -d --name bili-cache-watch -p 3001:3001 `
  -e BILI_INVITE_CODE="reeshiram-YuBirdSing-202605" `
  -e BILI_AUTH_SECRET="a-long-random-secret-at-least-32-characters" `
  -v bili-cache-data:/app/data `
  bili-cache-watch
```

Or with Compose:

```powershell
$env:BILI_AUTH_SECRET="a-long-random-secret-at-least-32-characters"
docker compose up -d --build
```

Cloud platforms need these environment variables:

- `PORT=3001`
- `BILI_INVITE_CODE=reeshiram-YuBirdSing-202605`
- `BILI_AUTH_SECRET=a-long-random-secret-at-least-32-characters`
- `CHECK_INTERVAL_MINUTES=60`

The app also needs persistent storage mounted at `/app/data`.

## Android Emulator Import

1. Start an Android emulator and log in to the Bilibili app.
2. Manually open the cached or offline videos page in the app.
3. Confirm the computer can see the emulator:

```powershell
npm run android:devices
```

The output should include something like `emulator-5554 device`.

4. Install the Appium Android driver:

```powershell
npm run appium:setup
```

5. Start Appium:

```powershell
npm run appium:start
```

6. In another terminal, run:

```powershell
npm run import:android
```

You can also click `Import From Android Emulator` in the web page.

The import script first tries to read Bilibili offline cache metadata from:

```text
/sdcard/Android/data/tv.danmaku.bili/download/**/entry.json
```

If metadata is unavailable, it falls back to Android UI automation.

For diagnostics:

```powershell
npm run android:inspect
```

The diagnostic command saves the current page XML and screenshot to `data/`.

## Local Folder Import

If you manually copied a Bilibili cache folder from a phone to this computer, enter the folder path in `Import Local Folder`. The app recursively scans `entry.json` files and imports BV IDs, titles, owners, covers, and cache paths.

Example:

```text
D:\BiliCache\download
```

Or a project-relative folder:

```text
data\android-download-copy
```

## Real Phone Import

The web page can also copy cache files directly from a Windows MTP phone path.

Before using it, confirm:

- The phone is connected by USB.
- The phone has allowed this computer to access files.
- The path points to the Bilibili `download` cache folder.

Example path:

```text
This PC\REDMI K90 Pro Max\Internal shared storage\Android\data\tv.danmaku.bili\download
```

The importer compares BV IDs against the existing database and copies only cache items that were not imported before. Copied files are stored under:

```text
data\phone-import
```

Some old cache entries contain only `avid`; the app converts them to BV IDs automatically.

## Manual Check

```powershell
npm run check
```

## Data Location

The SQLite database is stored at:

```text
data/bili-watch.sqlite
```

Local cache copies and exported MP4 files are also stored under `data/`.
