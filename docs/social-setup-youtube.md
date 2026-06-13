# YouTube Shorts Direct Publish — Setup Guide

## What you need
- A Google account with a YouTube channel
- Access to Google Cloud Console (free)
- Your existing **Clip** Google Cloud project (from the YouTube Data API key) — 
  or create a new one if you prefer to keep them separate.

No HTTPS tunnel needed — Google allows `http://localhost` OAuth redirects!

---

## Step 1 — Create an OAuth 2.0 client in Google Cloud

1. Go to https://console.cloud.google.com → select your project.
2. Navigation menu → **APIs & Services** → **Credentials**.
3. Click **+ Create Credentials** → **OAuth client ID**.
4. If prompted to configure the consent screen, do that first:
   - User type: **External** (for your own use) → fill in app name → save.
   - Add scope: `https://www.googleapis.com/auth/youtube.upload`
   - Add your Google account email as a **Test user**.
5. Back at Create credentials → OAuth client ID:
   - Application type: **Web application**
   - Name: "Clip Publisher"
   - Authorized redirect URIs → **+ Add URI**:
     `http://localhost:3000/api/social/youtube/callback`
6. Click **Create** → copy the **Client ID** and **Client Secret** from the popup.

## Step 2 — Enable the YouTube Data API v3

1. In Google Cloud → **APIs & Services** → **Enabled APIs & Services**.
2. Check if "YouTube Data API v3" is already enabled (it should be if you set up
   the Viral Remix feature). If not, search for it and enable it.

## Step 3 — Enter credentials in Clip

1. Open Clip → Settings → scroll to **Social Publish → App credentials**.
2. Paste **YouTube OAuth Client ID** and **YouTube OAuth Client Secret**.
3. **App public URL**: leave as `http://localhost:3000` (default) — Google is fine with localhost.
4. Click **Save credentials** and restart the dev server (`npm run dev`).

## Step 4 — Connect your YouTube account

1. Settings → **Social Publish → Connected Accounts** → **Connect** next to YouTube Shorts.
2. Google sign-in screen → select your account → approve the YouTube upload permission.
3. You'll land back on Settings showing "Connected as [Your Channel Name]".

## Step 5 — Publish a clip as a Short

1. Open a finished, exported clip in the editor.
2. Click **Publish** → YouTube Shorts → enter a title and description.
3. Choose visibility: **Public**, **Unlisted**, or **Private**.
4. Click **Publish**. The file uploads directly via Google's resumable upload API.

**How it becomes a Short:** YouTube auto-classifies a vertical (9:16) video under
3 minutes as a Short when `#Shorts` is in the title. Clip adds `#Shorts` automatically
if it's not already there.

---

## Troubleshooting

| Error | Fix |
|-------|-----|
| "redirect_uri_mismatch" | The redirect URI in Google Cloud must be `http://localhost:3000/api/social/youtube/callback` exactly |
| "Access blocked: This app's request is invalid" | Your OAuth consent screen is not published. For personal use, just add yourself as a Test user (step 1 above). |
| "The caller does not have permission" | Make sure `youtube.upload` scope is added to the consent screen and re-connect. |
| Upload fails with large file | Files over ~500 MB may time out. Trim the clip shorter before exporting. |
| "Session expired — please reconnect" | Click Disconnect and reconnect. YouTube refresh tokens should work automatically but the OAuth consent screen sometimes revokes them. |
