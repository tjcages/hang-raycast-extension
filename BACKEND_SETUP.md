# Backend Setup Guide

The Hang extension uses a secure backend architecture where OAuth secrets are stored server-side, not in the extension code.

## Architecture Overview

```
Extension → Backend API → Google Calendar API
         ↑
    (OAuth flow)
```

- **Extension**: Public client, no secrets
- **Backend**: Owns OAuth credentials, handles token exchange
- **User Tokens**: Stored securely in Cloudflare KV

## Quick Setup

### 1. Deploy Backend

```bash
cd backend
npm install
wrangler login
wrangler kv:namespace create USER_TOKENS
# Add namespace IDs to wrangler.toml
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put JWT_SECRET  # Generate random string
npm run deploy
```

### 2. Configure Google OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Add authorized redirect URI: `https://your-worker.workers.dev/oauth/callback`
3. Ensure Calendar API is enabled

### 3. Configure Extension

1. Open Raycast → Extensions → Hang → Preferences
2. Set **Backend API URL** to your deployed worker URL (e.g., `https://hang-backend.workers.dev`)
3. Leave empty to use default production backend (if provided)

## How It Works

1. **First Use**: Extension opens browser → User authorizes → Backend stores tokens → Extension polls for token
2. **Subsequent Uses**: Extension uses stored token → Backend proxies requests → Returns meeting link

## Security

- ✅ No secrets in extension code
- ✅ OAuth credentials stored as Cloudflare secrets
- ✅ User tokens encrypted in KV storage
- ✅ Extension tokens expire after 7 days
- ✅ Google tokens automatically refreshed

## Development

For local development:

```bash
cd backend
npm run dev
```

Set `BACKEND_URL` in extension's `.env` file:
```
BACKEND_URL=http://localhost:8787
```

## Troubleshooting

**"Backend URL not configured"**
- Set the backend URL in Preferences or `.env` file

**"Authentication timeout"**
- Complete OAuth flow in browser, then try again
- Check that backend is deployed and accessible

**"Token expired"**
- Run the command again to re-authenticate
- Tokens are automatically refreshed by backend



