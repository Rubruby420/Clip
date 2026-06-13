# TikTok Direct Publish — Setup Guide

## What you need
- A TikTok account (personal or creator)
- A free TikTok developer app (takes ~5 min to create)
- An HTTPS redirect URI — TikTok requires this even for dev.
  Use a free tunnel: `ngrok http 3000` → copy the `https://` URL.

---

## Step 1 — Create a TikTok developer app

1. Go to https://developers.tiktok.com and log in with your TikTok account.
2. Click **Manage apps** → **Connect an app** (or "Create app").
3. App name: anything (e.g. "Clip Publisher"). Category: "Video".
4. Under **Products**, add:
   - **Login Kit** (enables OAuth sign-in)
   - **Content Posting API** (enables `video.publish` scope)
5. Still in the app, find **Login Kit → Redirect domain** and add:
   `<your-ngrok-https-url>` (just the domain, no path, e.g. `abc123.ngrok.io`)
6. Under **Login Kit → Redirect URI for OAuth**, add the full callback URL:
   `<your-ngrok-https-url>/api/social/tiktok/callback`
   e.g. `https://abc123.ngrok.io/api/social/tiktok/callback`
7. Save.

## Step 2 — Copy your credentials

On the app's **App info** page:
- **Client Key** → copy it
- **Client Secret** → reveal and copy it

## Step 3 — Enter credentials in Clip

1. Open Clip → Settings → scroll to **Social Publish → App credentials**.
2. Paste **TikTok Client Key** and **TikTok Client Secret**.
3. Set **App public URL** to your ngrok HTTPS URL (e.g. `https://abc123.ngrok.io`).
4. Click **Save credentials** and restart the dev server (`npm run dev`).

## Step 4 — Connect your TikTok account

1. In Settings → **Social Publish → Connected Accounts**, click **Connect** next to TikTok.
2. You'll be redirected to TikTok's login/consent screen.
3. Approve the permissions — you'll land back on Settings showing "Connected as @you".

## Step 5 — Publish a clip

1. Open a clip in the editor. Export it if not done yet.
2. Click **Publish** (next to Download) → select TikTok → set a title and caption.
3. **Privacy**: choose **Private (only me)** — this is the only option until your TikTok
   app is approved for the `video.publish` scope by TikTok's review team.
4. Click **Publish**. The clip uploads directly (no re-download needed).

---

## Unlock public posting (TikTok app audit)

Once you want posts to be public:
1. In the TikTok Developer Portal → your app → **Audit**.
2. Submit for review (takes 1–7 business days).
3. After approval, the **Public** option in Clip will work.

Until then, "Public" posts will be rejected by TikTok's API with an error — the
**Private** option is always available without review.

---

## Troubleshooting

| Error | Fix |
|-------|-----|
| "redirect_uri mismatch" | The redirect URI in TikTok app settings must exactly match `PUBLIC_BASE_URL/api/social/tiktok/callback` |
| "invalid_state" | State expired (>10 min) — click Connect again |
| "Session expired — please reconnect" | TikTok access tokens expire in 24h; refresh tokens last 365 days. Click Disconnect and reconnect. |
| Chunk upload error | File might be too large. Clips under 100 MB work best. |
