// Cloudflare Pages Function
// Path: functions/_middleware.js  (put this file at that exact path in your project)
//
// WHAT THIS DOES
// ----------------------------------------------------------------------------
// Your app is a single giant SPA — index.html contains markup for every
// screen (settings, chat, wallet, checkout, suspended-account states, etc),
// all just CSS-hidden (display:none) until JS shows the right one. A real
// browser never sees the hidden ones. But a lot of crawlers/AI fetchers
// (ChatGPT's browsing, and many simpler bots) don't run your CSS or JS —
// they just read the raw HTML text — so they see ALL of that hidden
// markup mixed together as if it were the page's actual content. That's
// the "suspended screen" text and other irrelevant app-shell junk showing
// up when something crawls a profile or post link.
//
// THE FIX: detect known crawler/bot User-Agents and, only for them, return
// a completely separate, small, clean HTML document containing just the
// real content for that URL (profile info, or a post's text/author/image,
// or a feed of recent posts) — nothing else. Real visitors (anything that
// isn't a recognized bot) get your normal index.html, completely untouched,
// exactly as before. This is "dynamic rendering" — a long-established,
// Google-endorsed technique for JS-heavy sites, not cloaking, because the
// content served to bots is a genuine, accurate subset of the same content
// a real user would see once the app loads — never anything different or
// misleading.
//
// REQUIREMENT: your Firebase Realtime Database rules must allow public read
// of `handleIndex/{handle}`, `pulses/{id}`, and the public fields under
// `users/{uid}` (handle, name, bio, followersCount, followingCount,
// photoURL, verified). If a read fails (rules block it, bad handle, etc.)
// this Function falls back to serving your normal index.html untouched —
// nothing ever breaks over this.
// ----------------------------------------------------------------------------

const DB_BASE = "https://pulse2-92372-default-rtdb.firebaseio.com";
const SITE_ORIGIN = "https://nexor-f4d.pages.dev";
const DEFAULT_IMAGE = `${SITE_ORIGIN}/IMG_8305.png`;

// Known crawler / bot / link-preview User-Agents. Covers search engines,
// social/chat link-preview fetchers, and AI browsing tools. Anything not
// matching this list is treated as a real browser and gets the untouched
// full SPA — this list only ever narrows who gets the lightweight page, it
// never affects real users.
const BOT_UA_PATTERN = new RegExp([
  "Googlebot", "Bingbot", "DuckDuckBot", "Baiduspider", "YandexBot",
  "Slurp", "facebookexternalhit", "Twitterbot", "LinkedInBot",
  "WhatsApp", "TelegramBot", "Slackbot", "Discordbot", "SkypeUriPreview",
  "Applebot", "PinterestBot",
  "GPTBot", "ChatGPT-User", "OAI-SearchBot", "ClaudeBot", "Claude-Web",
  "PerplexityBot", "Bytespider", "anthropic-ai", "CCBot",
].join("|"), "i");

function isBotRequest(request) {
  const ua = request.headers.get("User-Agent") || "";
  return BOT_UA_PATTERN.test(ua);
}

function esc(str) {
  return String(str ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function fmtCount(n) {
  n = Number(n) || 0;
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1) + "K";
  return String(n);
}
// A real https:// image URL works for crawlers/og:image; a base64 data URI
// does not (most scrapers won't fetch it, and some reject the tag outright).
function realImageOrDefault(u) {
  return typeof u === "string" && /^https?:\/\//i.test(u) ? u : DEFAULT_IMAGE;
}

// Wraps a page's real content in a minimal, valid, semantic HTML document —
// proper title/meta/canonical/JSON-LD, then just the visible content as
// plain readable markup. No app shell, no hidden screens, no JS bundle.
function renderBotPage({ title, description, image, url, bodyHtml, jsonLd }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:url" content="${esc(url)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(image)}">
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` : ""}
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

function respondHtml(html) {
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=UTF-8", "Cache-Control": "public, max-age=300" },
  });
}

async function renderProfile(handle) {
  const idxRes = await fetch(`${DB_BASE}/handleIndex/${encodeURIComponent(handle)}.json`);
  if (!idxRes.ok) return null;
  const idxVal = await idxRes.json();
  const uid = typeof idxVal === "string" ? idxVal : idxVal && idxVal.uid;
  if (!uid) return null; // handle doesn't exist

  const userRes = await fetch(`${DB_BASE}/users/${encodeURIComponent(uid)}.json`);
  if (!userRes.ok) return null;
  const u = await userRes.json();
  if (!u) return null;

  const realHandle = u.handle || handle;
  const name = u.name || `@${realHandle}`;
  const bio = (u.bio || "").trim();
  const followers = fmtCount(u.followersCount || 0);
  const following = fmtCount(u.followingCount || 0);
  const image = realImageOrDefault(u.photoURL);
  const pageUrl = `${SITE_ORIGIN}/@${realHandle}`;
  const title = `${name} (@${realHandle}) • Nexor Sparks`;
  let description = `${followers} Followers, ${following} Following`;
  if (bio) description += ` — ${bio}`;
  description = description.slice(0, 200);

  const bodyHtml = `
<article>
  <h1>${esc(name)} <span>@${esc(realHandle)}</span></h1>
  ${bio ? `<p>${esc(bio)}</p>` : ""}
  <p>${followers} Followers · ${following} Following</p>
  <p><a href="${esc(pageUrl)}">View full profile on Nexor Sparks</a></p>
</article>`;

  return renderBotPage({
    title, description, image, url: pageUrl, bodyHtml,
    jsonLd: { "@context": "https://schema.org", "@type": "ProfilePage", "name": title, "url": pageUrl },
  });
}

async function renderPost(postId) {
  const pulseRes = await fetch(`${DB_BASE}/pulses/${encodeURIComponent(postId)}.json`);
  if (!pulseRes.ok) return null;
  const p = await pulseRes.json();
  if (!p) return null; // deleted / doesn't exist

  const authorName = p.creatorName || "User";
  const authorHandle = p.creatorHandle || "user";
  const text = (p.text || "").trim();
  const postImage = (p.images && p.images[0]) || null;
  const image = realImageOrDefault(postImage);
  const pageUrl = `${SITE_ORIGIN}/p/${postId}`;
  const title = `${authorName} on Nexor Sparks`;
  const description = (text || `Check out this Pulse by @${authorHandle} on Nexor Sparks.`).slice(0, 200);

  const bodyHtml = `
<article>
  <p><a href="/@${esc(authorHandle)}">${esc(authorName)} (@${esc(authorHandle)})</a></p>
  ${text ? `<p>${esc(text)}</p>` : ""}
  ${image !== DEFAULT_IMAGE ? `<img src="${esc(image)}" alt="">` : ""}
  <p><a href="${esc(pageUrl)}">View this Pulse on Nexor Sparks</a></p>
</article>`;

  return renderBotPage({
    title, description, image, url: pageUrl, bodyHtml,
    jsonLd: { "@context": "https://schema.org", "@type": "SocialMediaPosting", "headline": title, "articleBody": text, "url": pageUrl },
  });
}

async function renderHomepage() {
  const pulsesRes = await fetch(`${DB_BASE}/pulses.json?orderBy="createdAt"&limitToLast=20`);
  const pulsesObj = pulsesRes.ok ? await pulsesRes.json() : null;
  const posts = pulsesObj
    ? Object.entries(pulsesObj).filter(([, p]) => p && !p.deleted && !p.private).sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0))
    : [];

  const bodyHtml = `
<h1>Nexor Sparks</h1>
<p>Recent Pulses</p>
${posts.map(([id, p]) => `
<article>
  <a href="/@${esc(p.creatorHandle || "user")}">${esc(p.creatorName || "User")}</a>
  <p><a href="/p/${esc(id)}">${esc((p.text || "").slice(0, 280))}</a></p>
</article>`).join("\n")}`;

  return renderBotPage({
    title: "Nexor Sparks",
    description: "Nexor Sparks is where real conversations happen. Follow people, share your Pulses, and see what's trending — join the community today.",
    image: DEFAULT_IMAGE,
    url: `${SITE_ORIGIN}/`,
    bodyHtml,
    jsonLd: { "@context": "https://schema.org", "@type": "WebSite", "name": "Nexor Sparks", "url": `${SITE_ORIGIN}/` },
  });
}

export const onRequest = async ({ request, next }) => {
  if (!isBotRequest(request)) return next(); // real browser — untouched full SPA, no overhead

  const url = new URL(request.url);
  const isHomepage = url.pathname === "/" || url.pathname === "/index.html";
  const profileMatch = url.pathname.match(/^\/@([a-zA-Z0-9_]{1,30})\/?$/);
  const postMatch = url.pathname.match(/^\/p\/([^\/?#]+)\/?$/);

  if (!isHomepage && !profileMatch && !postMatch) return next(); // any other route — normal file/SPA fallback

  try {
    let html = null;
    if (profileMatch) html = await renderProfile(profileMatch[1].toLowerCase());
    else if (postMatch) html = await renderPost(postMatch[1]);
    else if (isHomepage) html = await renderHomepage();

    if (html) return respondHtml(html);
    return next(); // couldn't build bot content (bad handle/deleted post/etc.) — fall back to normal page
  } catch (err) {
    // Any failure (network, permission-denied, bad data) -> fall back to the
    // normal SPA response. Never break anything over this.
    return next();
  }
};
