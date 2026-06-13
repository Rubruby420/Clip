# Instagram Reels Direct Publish — Setup Guide

## What you need
- An **Instagram Professional account** (Business or Creator) linked to a **Facebook Page**
- A **Facebook Developer app**
- A **public HTTPS URL** — Instagram fetches the video from your server, so `localhost` won't work.
  Use a free tunnel: `ngrok http 3000` → copy the `https://` URL.
  Set `PUBLIC_BASE_URL` to it in Clip's Settings **and keep the tunnel running** during every publish.

---

## Step 1 — Link your Instagram to a Facebook Page

1. Go to https://www.instagram.com/accounts/contact_point/phone/add/ — convert to a Professional account (Business or Creator) if not already done.
2. In Instagram Settings → **Linked accounts** → connect your Facebook account.
3. Make sure you are the admin of a Facebook Page. The IG account must be linked to that Page.

## Step 2 — Create a Facebook Developer app

1. Go to https://developers.facebook.com → **My Apps** → **Create App**.
2. Use case: **Other** → Next. App type: **Business** → Next. Fill in name.
3. In the App Dashboard → **Add a Product** → find **Instagram Graph API** → click **Set up**.
4. Also add **Facebook Login** → Set up → platform: **Web**.

## Step 3 — Configure Facebook Login

1. In the app → **Facebook Login** → **Settings**:
2. Under **Valid OAuth Redirect URIs** add:
   `<your-ngrok-https-url>/api/social/instagram/callback`
   e.g. `https://abc123.ngrok.io/api/social/instagram/callback`
3. Save changes.

## Step 4 — Copy credentials

In the app dashboard → **Settings** → **Basic**:
- **App ID** → copy
- **App Secret** → show & copy

## Step 5 — Enter credentials in Clip

1. Clip → Settings → **Social Publish → App credentials**.
2. Paste **Instagram / Facebook App ID** and **Instagram / Facebook App Secret**.
3. Set **App public URL** to your ngrok HTTPS URL (e.g. `https://abc123.ngrok.io`).
   ⚠️ This URL must be running (tunnel active) during every publish.
4. Click **Save credentials** and restart the dev server.

## Step 6 — Connect your Instagram account

1. Settings → **Social Publish → Connected Accounts** → **Connect** next to Instagram Reels.
2. Facebook login → select the account linked to your Business Page → approve all permissions.
3. You'll land back on Settings showing "Connected as @yourhandle".

## Step 7 — Publish a Reel

1. **Start your ngrok tunnel** (`ngrok http 3000`) — Instagram must be able to fetch the video from `PUBLIC_BASE_URL/api/files/...`.
2. Open a finished, exported clip or generate a Highlight Reel.
3. Click **Publish** → Instagram Reels → add a caption.
4. Click **Publish**. Instagram fetches the video from your tunnel URL, processes it, then publishes it.

---

## How it works under the hood

Unlike TikTok/YouTube, Instagram does **not** accept a direct byte upload. Instead:
1. Clip sends Instagram a URL pointing to your video file (via the tunnel).
2. Instagram's servers download and process the video — this can take 1–3 minutes.
3. Once it reports `status_code: FINISHED`, Clip triggers the publish.

If the tunnel is not running, you'll get: _"Instagram Reels requires a public HTTPS URL..."_

---

## Troubleshooting

| Error | Fix |
|-------|-----|
| "requires a public HTTPS URL" | Start your tunnel and set `PUBLIC_BASE_URL` to the `https://` URL. |
| Container status `ERROR` | The video format is unsupported. Make sure you're using the 9:16 export from Clip. |
| "App not approved" | For testing, add your Instagram account as a test user in the FB app → Roles → Test Users. |
| "Instagram account not linked" | Disconnect and reconnect — the FB page → IG account link may have changed. |
| Publish hangs | Container processing can take up to 5 min. If it times out, check your tunnel is still active. |
