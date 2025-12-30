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
cd hang-backend
npm install
wrangler login
wrangler kv namespace create USER_TOKENS
wrangler kv namespace create USER_TOKENS --preview
```

The commands will output namespace IDs. Add them to `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "USER_TOKENS"
id = "your-namespace-id"

[[kv_namespaces]]
binding = "USER_TOKENS"
preview_id = "your-preview-namespace-id"
```

Then set secrets:

```bash
# Google OAuth
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET

# JWT Secret (generate a random string)
wrangler secret put JWT_SECRET

# Zoom OAuth credentials (for user-level OAuth)
wrangler secret put ZOOM_CLIENT_ID
wrangler secret put ZOOM_CLIENT_SECRET
```

**Note:** When you run `wrangler secret put`, it will prompt you to enter the secret value. You can also pipe it:
```bash
echo "your-secret-value" | wrangler secret put ZOOM_CLIENT_ID
```

Finally, deploy:

```bash
npm run deploy
```

### 2. Configure OAuth

**Google OAuth:**
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Add authorized redirect URI: `https://your-worker.workers.dev/oauth/callback`
3. Ensure Calendar API is enabled

**Zoom OAuth:**
1. Go to [Zoom App Marketplace](https://marketplace.zoom.us/develop/create)
2. Create an **OAuth** app (not Server-to-Server OAuth)
3. Add redirect URI: `https://hang-backend.workers.dev/oauth/callback` (or your custom domain)
4. Add scopes: `meeting:write`
5. Activate your app

**Important:** After deploying, update your Zoom app's redirect URI to match your production URL!

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

1. **Create `.dev.vars` file** (for local secrets):
   ```bash
   cd hang-backend
   cp .dev.vars.example .dev.vars
   # Edit .dev.vars and add your secrets
   ```

2. **Add your secrets to `.dev.vars`**:
   ```
   GOOGLE_CLIENT_ID=your-client-id
   GOOGLE_CLIENT_SECRET=your-client-secret
   JWT_SECRET=your-jwt-secret
   
   # Zoom OAuth credentials
   ZOOM_CLIENT_ID=your-client-id
   ZOOM_CLIENT_SECRET=your-client-secret
   ```

3. **Start the dev server**:
   ```bash
   npm run dev
   ```

4. **Set `BACKEND_URL` in extension's `.env` file**:
   ```
   BACKEND_URL=http://localhost:8787
   ```

**Important**: Make sure your Google OAuth redirect URI includes:
- `http://localhost:8787/oauth/callback` (for local testing)

## Troubleshooting

**"Backend URL not configured"**
- Set the backend URL in Preferences or `.env` file

**"Authentication timeout"**
- Complete OAuth flow in browser, then try again
- Check that backend is deployed and accessible

**"Token expired"**
- Run the command again to re-authenticate
- Tokens are automatically refreshed by backend

