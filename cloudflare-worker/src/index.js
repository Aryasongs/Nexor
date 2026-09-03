/**
 * Kashish reminder pusher — Cloudflare Worker
 * -------------------------------------------
 * Runs on a cron schedule (see wrangler.toml). Each run:
 *  1. Reads `pendingReminders` from Firebase Realtime Database (REST API,
 *     filtered by `due <= now` server-side using an indexed query).
 *  2. For each due reminder, looks up the owning user's saved FCM token
 *     (`users/{uid}/fcmToken`), sends a push via the FCM HTTP v1 API.
 *  3. Deletes the `pendingReminders/{id}` entry either way (sent, or no
 *     token / user disabled notifications) so it's never retried forever.
 *
 * This is independent of the in-app 30s timer in kashish.html — that one
 * only fires while the tab is open. This Worker is what delivers the
 * notification when the app/tab/phone is closed.
 *
 * ---- Required secrets (set with `wrangler secret put <NAME>`) ----
 *   FIREBASE_DB_URL        e.g. https://pulse2-92372-default-rtdb.firebaseio.com
 *   FIREBASE_DB_SECRET     Firebase Realtime Database legacy secret
 *                           (console → Project settings → Service accounts →
 *                           Database secrets). Used only for REST auth here.
 *   FCM_SERVICE_ACCOUNT    The FULL JSON of a service account key with the
 *                           "Firebase Cloud Messaging API" role, as a single
 *                           minified JSON string (console → Project settings
 *                           → Service accounts → Generate new private key).
 *   FCM_PROJECT_ID          Your Firebase project id, e.g. pulse2-92372
 */

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runReminderSweep(env));
  },
  // Lets you trigger a sweep manually by visiting the Worker URL, handy for
  // testing without waiting for the cron tick.
  async fetch(request, env) {
    const result = await runReminderSweep(env);
    return new Response(JSON.stringify(result, null, 2), {
      headers: { 'content-type': 'application/json' },
    });
  },
};

async function runReminderSweep(env) {
  const now = Date.now();
  const due = await fetchDueReminders(env, now);
  const ids = Object.keys(due);
  if (ids.length === 0) return { checked: 0, sent: 0 };

  const accessToken = await getFcmAccessToken(env);
  const tokenCache = new Map(); // uid -> fcmToken | null
  let sent = 0;

  for (const id of ids) {
    const reminder = due[id];
    try {
      let fcmToken = tokenCache.get(reminder.uid);
      if (fcmToken === undefined) {
        fcmToken = await fetchUserFcmToken(env, reminder.uid);
        tokenCache.set(reminder.uid, fcmToken);
      }
      if (fcmToken) {
        await sendFcmPush(env, accessToken, fcmToken, reminder);
        sent++;
      }
    } catch (e) {
      console.error('Failed to push reminder', id, e);
    } finally {
      // Always clear the pending entry — a failed/token-less reminder still
      // gets caught by the client's own in-app check when the app reopens.
      await deletePendingReminder(env, id);
    }
  }
  return { checked: ids.length, sent };
}

/** Firebase REST query: pendingReminders ordered by "due", up to `now`. */
async function fetchDueReminders(env, now) {
  const url =
    `${env.FIREBASE_DB_URL}/pendingReminders.json` +
    `?orderBy="due"&endAt=${now}&auth=${env.FIREBASE_DB_SECRET}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Firebase query failed: ' + res.status);
  const data = await res.json();
  return data || {};
}

async function fetchUserFcmToken(env, uid) {
  const url = `${env.FIREBASE_DB_URL}/users/${uid}/fcmToken.json?auth=${env.FIREBASE_DB_SECRET}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  return await res.json(); // string token, or null
}

async function deletePendingReminder(env, id) {
  const url = `${env.FIREBASE_DB_URL}/pendingReminders/${id}.json?auth=${env.FIREBASE_DB_SECRET}`;
  await fetch(url, { method: 'DELETE' });
}

async function sendFcmPush(env, accessToken, fcmToken, reminder) {
  const url = `https://fcm.googleapis.com/v1/projects/${env.FCM_PROJECT_ID}/messages:send`;
  const body = {
    message: {
      token: fcmToken,
      notification: {
        title: 'Kashish reminder',
        body: reminder.text,
      },
      data: { reminderId: String(reminder.uid) },
      webpush: { fcm_options: { link: '/' } },
    },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('FCM send failed: ' + res.status + ' ' + (await res.text()));
}

/* ---------------- Google OAuth2 (service account) ---------------- */
// FCM's HTTP v1 API needs a short-lived OAuth access token, obtained by
// signing a JWT with the service account's private key (RS256) and
// exchanging it at Google's token endpoint. No npm packages needed — just
// the Workers-native Web Crypto API.

let cachedToken = null; // { accessToken, expiresAt }

async function getFcmAccessToken(env) {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.accessToken;
  }
  const sa = JSON.parse(env.FCM_SERVICE_ACCOUNT);
  const jwt = await buildSignedJwt(sa);

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!res.ok) throw new Error('OAuth token exchange failed: ' + res.status + ' ' + (await res.text()));
  const data = await res.json();
  cachedToken = { accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.accessToken;
}

async function buildSignedJwt(serviceAccount) {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: nowSec,
    exp: nowSec + 3600,
  };
  const encodedHeader = base64url(JSON.stringify(header));
  const encodedClaims = base64url(JSON.stringify(claims));
  const unsigned = `${encodedHeader}.${encodedClaims}`;

  const key = await importPrivateKey(serviceAccount.private_key);
  const signature = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    new TextEncoder().encode(unsigned)
  );
  return `${unsigned}.${base64url(signature)}`;
}

async function importPrivateKey(pem) {
  const pemBody = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '');
  const binary = atob(pemBody);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return crypto.subtle.importKey(
    'pkcs8',
    bytes.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

function base64url(input) {
  let bytes;
  if (typeof input === 'string') bytes = new TextEncoder().encode(input);
  else bytes = new Uint8Array(input);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
