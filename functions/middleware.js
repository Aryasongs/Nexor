/**
 * functions/_middleware.js  (Cloudflare Pages Function)
 * -------------------------------------------------------------------------
 * WHY THIS EXISTS
 * Nexor Sparks is a client-rendered SPA. updateShareMeta() in index.html
 * only edits <meta> tags AFTER Firebase loads, using JavaScript. Link-preview
 * bots (WhatsApp, Telegram, X, Slack, Discord) and most AI/LLM crawlers do
 * NOT execute JavaScript — they only read the raw HTML the server returns.
 * So every shared /@handle link falls back to the generic default meta
 * tags baked into <head>, and nobody (bot or AI) can see the real name,
 * follower count, following count, verified status, or post count.
 *
 * WHAT THIS DOES
 * Runs at the edge, in front of the static index.html. If the request is
 * for a /@handle profile URL AND the User-Agent looks like a bot/crawler/AI
 * fetcher, it fetches that profile's public stats from Firebase RTDB and
 * rewrites the <meta> tags (+ adds JSON-LD) directly in the HTML response,
 * before it ever reaches the requester. Normal browsers are untouched —
 * they still get the SPA and updateShareMeta() takes over as usual.
 *
 * SETUP NEEDED ON YOUR END
 * 1. Drop this file at functions/_middleware.js in your Pages project repo
 *    (same repo root that has index.html), redeploy.
 * 2. Your Firebase RTDB rules must allow public READ on these specific
 *    child paths for any uid (NOT the whole /users/{uid} node — that would
 *    leak email/phone/etc. to this edge function and beyond):
 *      users/{uid}/name
 *      users/{uid}/handle
 *      users/{uid}/followersCount
 *      users/{uid}/followingCount
 *      users/{uid}/pulsesCount
 *      users/{uid}/verified
 *      users/{uid}/accountType
 *      users/{uid}/badgeUrl
 *      users/{uid}/photoBase64      (this field actually holds the
 *                                     Cloudinary URL string in this app,
 *                                     never raw base64 — kept the old name)
 *      users/{uid}/private
 *      handleIndex/{handle}
 *    Everything else on the user record (email, phone, payment info, etc.)
 *    stays exactly as locked-down as it is today — this function never
 *    touches those paths.
 * 3. If you'd rather not open even those fields to public REST reads,
 *    maintain a separate `publicProfiles/{uid}` node (Cloud Function/DB
 *    trigger keeps it in sync) with just these 8 fields, and point the
 *    fetch below at that node instead. That's the safer long-term setup.
 */

const RTDB_BASE = 'https://pulse2-92372-default-rtdb.firebaseio.com';
const SITE_ORIGIN = 'https://nexor-f4d.pages.dev';
const DEFAULT_IMAGE = `${SITE_ORIGIN}/IMG_8305.png`;

// Known link-preview bots + AI/LLM crawlers. Add to this list as needed.
const BOT_UA_RE = new RegExp(
  [
    'facebookexternalhit', 'Facebot', 'Twitterbot', 'WhatsApp',
    'TelegramBot', 'Slackbot', 'LinkedInBot', 'Discordbot', 'SkypeUriPreview',
    'Pinterest', 'redditbot', 'Googlebot', 'bingbot', 'DuckDuckBot',
    'GPTBot', 'ChatGPT-User', 'OAI-SearchBot', 'ClaudeBot', 'anthropic-ai',
    'Claude-User', 'Claude-SearchBot', 'PerplexityBot', 'Perplexity-User',
    'Google-Extended', 'CCBot', 'Applebot', 'Bytespider', 'YandexBot'
  ].join('|'), 'i'
);

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function fetchField(uid, field) {
  const r = await fetch(`${RTDB_BASE}/users/${uid}/${field}.json`);
  if (!r.ok) return null;
  return r.json();
}

async function getProfileData(handle) {
  const idxRes = await fetch(`${RTDB_BASE}/handleIndex/${handle}.json`);
  if (!idxRes.ok) return null;
  const idxVal = await idxRes.json();
  const uid = idxVal && typeof idxVal === 'object' ? idxVal.uid : idxVal;
  if (!uid) return null;

  const [name, storedHandle, followersCount, followingCount, pulsesCount,
    verified, photo] = await Promise.all([
    fetchField(uid, 'name'),
    fetchField(uid, 'handle'),
    fetchField(uid, 'followersCount'),
    fetchField(uid, 'followingCount'),
    fetchField(uid, 'pulsesCount'),
    fetchField(uid, 'verified'),
    fetchField(uid, 'photoBase64'), // holds a Cloudinary URL, not base64
  ]);

  return {
    uid,
    name: name || storedHandle || handle,
    handle: storedHandle || handle,
    followersCount: followersCount || 0,
    followingCount: followingCount || 0,
    pulsesCount: pulsesCount || 0,
    verified: !!verified,
    photo: photo || DEFAULT_IMAGE,
  };
}

function buildDescription(p) {
  const tick = p.verified ? ' ✅ Verified' : '';
  return `@${p.handle}${tick} · ${p.followersCount} followers · ` +
    `${p.followingCount} following · ${p.pulsesCount} posts — on Nexor Sparks`;
}

function injectMeta(html, p, url) {
  const title = `${p.name} (@${p.handle}) · Nexor Sparks`;
  const description = buildDescription(p);

  html = html
    .replace(/<title>.*?<\/title>/, `<title>${esc(title)}</title>`)
    .replace(/(id="meta-description" content=").*?(")/, `$1${esc(description)}$2`)
    .replace(/(id="meta-og-title" content=").*?(")/, `$1${esc(title)}$2`)
    .replace(/(id="meta-og-description" content=").*?(")/, `$1${esc(description)}$2`)
    .replace(/(id="meta-og-image" content=").*?(")/, `$1${esc(p.photo)}$2`)
    .replace(/(id="meta-og-url" content=").*?(")/, `$1${esc(url)}$2`)
    .replace(/(id="meta-twitter-title" content=").*?(")/, `$1${esc(title)}$2`)
    .replace(/(id="meta-twitter-description" content=").*?(")/, `$1${esc(description)}$2`)
    .replace(/(id="meta-twitter-image" content=").*?(")/, `$1${esc(p.photo)}$2`);

  // Structured data — lets AI answer engines / search crawlers parse the
  // stats reliably instead of scraping prose.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    dateModified: new Date().toISOString(),
    mainEntity: {
      '@type': 'Person',
      name: p.name,
      alternateName: `@${p.handle}`,
      image: p.photo,
      url,
      identifier: p.uid,
      ...(p.verified ? { agentInteractionStatistic: 'verified' } : {}),
      interactionStatistic: [
        { '@type': 'InteractionCounter', interactionType: 'https://schema.org/FollowAction', userInteractionCount: p.followersCount, name: 'followers' },
        { '@type': 'InteractionCounter', interactionType: 'https://schema.org/FollowAction', userInteractionCount: p.followingCount, name: 'following' },
        { '@type': 'InteractionCounter', interactionType: 'https://schema.org/WriteAction', userInteractionCount: p.pulsesCount, name: 'posts' },
      ],
    },
  };
  html = html.replace(
    '</head>',
    `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script></head>`
  );

  return html;
}

// ---------------------------------------------------------------------
// LINK WRAPPING — verifies links generated by withUtmSource()/
// signWrappedUrl() in index.html (app-mode only) and redirects to the
// real destination. Must use the EXACT same key + hash as index.html's
// signWrappedUrl(), or every wrapped link will fail to verify.
const LINK_WRAP_KEY = 'cb38663b66dc0c98683872cd3cff971b';
function signWrappedUrl(str) {
  let h = 0x811c9dc5;
  const s = LINK_WRAP_KEY + str;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}
function isSafeRedirectTarget(u) {
  // Defense in depth beyond the signature: only ever redirect to a real
  // http(s) URL — never javascript:, data:, file:, etc.
  return u.protocol === 'http:' || u.protocol === 'https:';
}
function handleWrappedLink(url) {
  const wrapped = url.searchParams.get('u');
  const sig = url.searchParams.get('e');
  if (!wrapped || !sig) return null; // not a wrapped-link request

  if (signWrappedUrl(wrapped) !== sig) {
    return new Response(
      '<!DOCTYPE html><meta charset="utf-8"><title>Invalid link</title>' +
      '<body style="font-family:sans-serif;padding:40px;text-align:center;">' +
      '<h2>This link isn\u2019t valid</h2><p>It may have been altered or is expired. ' +
      'Go back to <a href="/">Nexor Sparks</a>.</p></body>',
      { status: 400, headers: { 'content-type': 'text/html; charset=UTF-8' } }
    );
  }

  let dest;
  try { dest = new URL(wrapped); } catch (e) { return null; }
  if (!isSafeRedirectTarget(dest)) {
    return new Response('Blocked redirect target.', { status: 400 });
  }
  return Response.redirect(dest.toString(), 302);
}

export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);

  // Wrapped-link redirect (?u=...&e=...) takes priority over everything else.
  if (url.pathname === '/' && url.searchParams.has('u')) {
    const redirectResponse = handleWrappedLink(url);
    if (redirectResponse) return redirectResponse;
  }

  const isBot = BOT_UA_RE.test(request.headers.get('user-agent') || '');
  const m = url.pathname.match(/^\/@([^/?#]+)\/?$/);

  // Not a profile URL, or not a bot/crawler → serve the SPA untouched.
  if (!m || !isBot) return next();

  const handle = decodeURIComponent(m[1]).toLowerCase();

  try {
    const profile = await getProfileData(handle);
    const assetResponse = await next(); // fetch the static index.html
    if (!profile) return assetResponse; // handle not found → default meta stands

    const html = await assetResponse.text();
    const rewritten = injectMeta(html, profile, url.toString());

    return new Response(rewritten, {
      headers: { 'content-type': 'text/html; charset=UTF-8' },
    });
  } catch (err) {
    // Any failure (RTDB down, bad rules, etc.) → fail open to the normal SPA
    // rather than breaking the page for the bot.
    return next();
  }
}
