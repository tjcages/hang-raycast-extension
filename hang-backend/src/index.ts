// Hang Backend API - OAuth flow and meeting creation

interface Env {
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  JWT_SECRET: string;
  ZOOM_CLIENT_ID: string;
  ZOOM_CLIENT_SECRET: string;
  USER_TOKENS: KVNamespace;
}

function generateToken(userId: string, secret: string): string {
  const payload = {
    userId,
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
  };
  const header = { alg: "HS256", typ: "JWT" };
  return btoa(JSON.stringify(header)) + "." + btoa(JSON.stringify(payload));
}

function verifyToken(token: string, secret: string): { userId: string } | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    const payload = JSON.parse(atob(parts[1]));
    if (payload.exp < Date.now()) return null;
    return { userId: payload.userId };
  } catch {
    return null;
  }
}

async function generatePKCE(): Promise<{ codeVerifier: string; codeChallenge: string }> {
  const codeVerifier = generateRandomString(128);
  const encoder = new TextEncoder();
  const data = encoder.encode(codeVerifier);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashBase64 = btoa(String.fromCharCode(...hashArray));
  const codeChallenge = hashBase64
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  return { codeVerifier, codeChallenge };
}

function generateRandomString(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

async function handleGoogleOAuthStart(env: Env, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const providedState = url.searchParams.get("state");
  const state = providedState || generateRandomString(32);
  const { codeVerifier, codeChallenge } = await generatePKCE();
  
  await env.USER_TOKENS.put(`pkce:google:${state}`, JSON.stringify({ codeVerifier, state, provider: "google" }), {
    expirationTtl: 600,
  });

  const redirectUri = `${new URL(request.url).origin}/oauth/callback`;
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "https://www.googleapis.com/auth/calendar.events");
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("state", `google:${state}`);
  authUrl.searchParams.set("access_type", "offline");

  return Response.redirect(authUrl.toString());
}

async function handleZoomOAuthStart(env: Env, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const providedState = url.searchParams.get("state");
  const state = providedState || generateRandomString(32);
  const clientId = env.ZOOM_CLIENT_ID?.trim() || "";
  
  if (!clientId) {
    return new Response("Zoom OAuth credentials not configured", { status: 500 });
  }

  const redirectUri = `${new URL(request.url).origin}/oauth/callback`;
  await env.USER_TOKENS.put(`pkce:zoom:${state}`, JSON.stringify({ state, provider: "zoom", redirectUri }), {
    expirationTtl: 600,
  });
  const authUrl = new URL("https://zoom.us/oauth/authorize");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("state", `zoom:${state}`);

  return Response.redirect(authUrl.toString());
}

async function handleOAuthCallback(env: Env, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  console.log("OAuth callback:", { hasCode: !!code, hasState: !!state, error, state });

  if (error) {
    return new Response(`OAuth error: ${error}`, { status: 400 });
  }

  if (!code || !state) {
    return new Response("Missing code or state", { status: 400 });
  }

  const [provider, actualState] = state.includes(":") ? state.split(":", 2) : ["google", state];
  const pkceData = await env.USER_TOKENS.get(`pkce:${provider}:${actualState}`, "json");
  
  if (!pkceData) {
    return new Response("Invalid or expired state", { status: 400 });
  }

  const redirectUri = (pkceData as { redirectUri?: string }).redirectUri || `${new URL(request.url).origin}/oauth/callback`;
  let tokens: { access_token: string; refresh_token?: string; expires_in?: number };

  if (provider === "google") {
    const { codeVerifier } = pkceData as { codeVerifier: string };

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        code,
        code_verifier: codeVerifier,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      return new Response(`Token exchange failed: ${errorText}`, { status: 400 });
    }

    tokens = await tokenResponse.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };
  } else if (provider === "zoom") {
    const clientId = env.ZOOM_CLIENT_ID?.trim() || "";
    const clientSecret = env.ZOOM_CLIENT_SECRET?.trim() || "";
    
    if (!clientId || !clientSecret) {
      return new Response("Zoom OAuth credentials not configured", { status: 500 });
    }

    const credentials = btoa(`${clientId}:${clientSecret}`);

    const tokenResponse = await fetch("https://zoom.us/oauth/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      return new Response(`Token exchange failed: ${errorText}`, { status: 400 });
    }

    tokens = await tokenResponse.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };
  } else {
    return new Response("Unknown provider", { status: 400 });
  }

  const userId = generateRandomString(32);
  
  await env.USER_TOKENS.put(
    `user:${userId}:${provider}`,
    JSON.stringify({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: Date.now() + (tokens.expires_in || 3600) * 1000,
    }),
  );

  const extensionToken = generateToken(userId, env.JWT_SECRET);
  await env.USER_TOKENS.put(`callback:${actualState}`, extensionToken, {
    expirationTtl: 300,
  });

  await env.USER_TOKENS.delete(`pkce:${provider}:${actualState}`);

  const successUrl = new URL(`${new URL(request.url).origin}/oauth/success`);
  successUrl.searchParams.set("state", actualState);
  return Response.redirect(successUrl.toString());
}

async function handleCreateMeeting(env: Env, request: Request): Promise<Response> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return new Response("Missing or invalid authorization", { status: 401 });
  }

  const token = authHeader.substring(7);
  const tokenData = verifyToken(token, env.JWT_SECRET);
  if (!tokenData) {
    return new Response("Invalid token", { status: 401 });
  }

  const userData = await env.USER_TOKENS.get(`user:${tokenData.userId}:google`, "json");
  if (!userData) {
    return new Response("Google account not authenticated. Please authenticate with Google first.", { status: 403 });
  }

  const { access_token, expires_at } = userData as {
    access_token: string;
    refresh_token?: string;
    expires_at: number;
  };

  if (expires_at < Date.now()) {
    return new Response("Token expired - please re-authenticate", { status: 401 });
  }

  const now = new Date();
  const endTime = new Date(now.getTime() + 60 * 60 * 1000);

  const event = {
    summary: "Quick Meeting",
    visibility: "public",
    guestsCanInviteOthers: true,
    guestsCanModify: false,
    start: {
      dateTime: now.toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    end: {
      dateTime: endTime.toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    conferenceData: {
      createRequest: {
        requestId: `meet-${Date.now()}`,
        conferenceSolutionKey: {
          type: "hangoutsMeet",
        },
      },
    },
  };

  const createResponse = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(event),
    },
  );

  if (!createResponse.ok) {
    const errorText = await createResponse.text();
    return new Response(`Failed to create event: ${errorText}`, { status: createResponse.status });
  }

  const createdEvent = await createResponse.json() as {
    id?: string;
    conferenceData?: {
      entryPoints?: Array<{ entryPointType?: string; uri?: string }>;
    };
    hangoutLink?: string;
  };

  const meetLink =
    createdEvent.conferenceData?.entryPoints?.find((ep) => ep.entryPointType === "video")?.uri ||
    createdEvent.hangoutLink;

  if (!meetLink) {
    if (createdEvent.id) {
      await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${createdEvent.id}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${access_token}`,
          },
        },
      );
    }
    return new Response("No meeting link found", { status: 500 });
  }

  if (createdEvent.id) {
    try {
      await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${createdEvent.id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
      });
    } catch {
      // Ignore deletion errors
    }
  }

  return Response.json({ meetLink });
}

async function handleCreateZoomMeeting(env: Env, request: Request): Promise<Response> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return new Response("Missing or invalid authorization", { status: 401 });
  }

  const token = authHeader.substring(7);
  const tokenData = verifyToken(token, env.JWT_SECRET);
  if (!tokenData) {
    return new Response("Invalid token", { status: 401 });
  }

  const userData = await env.USER_TOKENS.get(`user:${tokenData.userId}:zoom`, "json");
  if (!userData) {
    return new Response(
      JSON.stringify({ error: "Zoom account not authenticated. Please authenticate with Zoom first.", code: "ZOOM_NOT_AUTHENTICATED" }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }

  const { access_token, expires_at } = userData as {
    access_token: string;
    refresh_token?: string;
    expires_at: number;
  };

  if (expires_at < Date.now()) {
    return new Response("Token expired - please re-authenticate", { status: 401 });
  }
  
  const response = await fetch("https://api.zoom.us/v2/users/me/meetings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      topic: "Quick Meeting",
      type: 1,
      settings: {
        join_before_host: true,
        participant_video: false,
        host_video: false,
        mute_upon_entry: false,
        approval_type: 0,
        audio: "both",
        auto_recording: "none",
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    return new Response(`Failed to create Zoom meeting: ${errorText}`, { status: response.status });
  }

  const meeting = (await response.json()) as {
    join_url?: string;
    id?: number;
  };

  if (!meeting.join_url) {
    return new Response("No meeting link found in Zoom response", { status: 500 });
  }

  return Response.json({ meetLink: meeting.join_url });
}

async function handleOAuthSuccess(request: Request): Promise<Response> {
  const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Hang - Authentication Successful</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    :root {
      --bg-color: #f6f6f6;
      --card-bg: #ffffff;
      --text-primary: #1a1a1a;
      --text-secondary: #666666;
      --border-color: #e5e5e5;
      --accent: #6366f1;
      --success: #10b981;
    }
    
    @media (prefers-color-scheme: dark) {
      :root {
        --bg-color: #0f0f0f;
        --card-bg: #1a1a1a;
        --text-primary: #ffffff;
        --text-secondary: #a0a0a0;
        --border-color: #2d2d2d;
        --accent: #818cf8;
        --success: #34d399;
      }
    }
    
    body {
      font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Roboto Mono', 'Courier New', monospace;
      background: var(--bg-color);
      color: var(--text-primary);
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 24px;
      position: relative;
      overflow: hidden;
    }
    
    /* Background grid pattern */
    body::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-image: 
        linear-gradient(var(--border-color) 1px, transparent 1px),
        linear-gradient(90deg, var(--border-color) 1px, transparent 1px);
      background-size: 24px 24px;
      opacity: 0.3;
      pointer-events: none;
    }
    
    .container {
      position: relative;
      background: var(--card-bg);
      border-radius: 16px;
      padding: 64px 48px;
      max-width: 520px;
      width: 100%;
      text-align: center;
      backdrop-filter: blur(20px);
      border: 1px dashed var(--border-color);
      box-shadow: 
        0 4px 6px -1px rgba(0, 0, 0, 0.1),
        0 2px 4px -1px rgba(0, 0, 0, 0.06);
    }
    
    .icon-container {
      width: 80px;
      height: 80px;
      margin: 0 auto 32px;
      border-radius: 20px;
      background: var(--card-bg);
      border: 2px dashed var(--border-color);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      backdrop-filter: blur(10px);
    }
    
    .icon-container img {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
    
    h1 {
      font-size: 28px;
      font-weight: 600;
      margin-bottom: 24px;
      color: var(--text-primary);
      letter-spacing: -0.5px;
    }
    
    .instruction {
      font-size: 13px;
      color: var(--text-secondary);
      font-family: 'SF Mono', 'Monaco', monospace;
      padding: 16px;
      background: rgba(99, 102, 241, 0.05);
      border: 1px dashed var(--accent);
      border-radius: 8px;
      margin-top: 24px;
      line-height: 1.6;
    }
  </style>
  <script>
    setTimeout(function() {
      window.close();
    }, 1500);
  </script>
</head>
<body>
  <div class="container">
    <h1>Authentication Successful</h1>
    <div class="instruction">You can close this window and return to Raycast.</div>
  </div>
</body>
</html>
  `;

  return new Response(html, {
    headers: { "Content-Type": "text/html" },
  });
}

async function handleTokenRetrieval(env: Env, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const state = url.searchParams.get("state");

  if (!state) {
    return Response.json({ error: "Missing state parameter" }, { status: 400 });
  }

  const token = await env.USER_TOKENS.get(`callback:${state}`);
  if (!token) {
    return Response.json({ error: "Token not found or expired" }, { status: 404 });
  }

  await env.USER_TOKENS.delete(`callback:${state}`);
  return Response.json({ token });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      if (path === "/oauth/google/start") {
        return handleGoogleOAuthStart(env, request);
      } else if (path === "/oauth/zoom/start") {
        return handleZoomOAuthStart(env, request);
      } else if (path === "/oauth/callback") {
        return handleOAuthCallback(env, request);
      } else if (path === "/oauth/success") {
        return handleOAuthSuccess(request);
      } else if (path === "/oauth/token" && request.method === "GET") {
        return handleTokenRetrieval(env, request);
      } else if (path === "/api/create-meeting" && request.method === "POST") {
        const response = await handleCreateMeeting(env, request);
        Object.entries(corsHeaders).forEach(([key, value]) => {
          response.headers.set(key, value);
        });
        return response;
      } else if (path === "/api/create-zoom-meeting" && request.method === "POST") {
        const response = await handleCreateZoomMeeting(env, request);
        Object.entries(corsHeaders).forEach(([key, value]) => {
          response.headers.set(key, value);
        });
        return response;
      } else {
        return new Response(`Not found: ${path}`, { status: 404 });
      }
    } catch (error) {
      console.error("Error:", error);
      return new Response(`Internal server error: ${error}`, { status: 500 });
    }
  },
};

