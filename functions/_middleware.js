// Cloudflare Pages Function
// Path: functions/_middleware.js  (put this file at that exact path in your project)
//
// WHAT THIS DOES
// ----------------------------------------------------------------------------
// Your app is a client-side SPA — index.html is the same static file for every
// URL, and real content (profile bio/followers, a Pulse's own text/image)
// only gets written into the meta tags AFTER Firebase loads in the browser
// (updateShareMeta()). Any fetcher that doesn't run JS — search engine
// crawlers, ChatGPT's browsing, link-preview bots, WhatsApp/Telegram link
// previews — only ever sees the generic default meta tags.
//
// This Function intercepts two URL patterns and rewrites the <meta id="...">
// tags (and <title>, and adds a <link rel="canonical">) server-side, before
// the HTML is sent out:
//   /@handle   — profile pages  (bio, real follower/following counts)
//   /p/postId  — individual Pulses (the post's own text + image + author)
// Real visitors are unaffected — your existing client JS still runs and
// overwrites these same tags with fresh data once Firebase loads in-browser.
// Every other URL passes through untouched.
//
// REQUIREMENT: your Firebase Realtime Database rules must allow public read
// of `handleIndex/{handle}`, `pulses/{id}`, and the public fields under
// `users/{uid}` (handle, name, bio, followersCount, followingCount,
// photoURL, verified). If rules block it, this Function fails silently and
// falls back to your normal default meta tags — nothing breaks.
//
// WHY THIS MATTERS FOR GOOGLE SPECIFICALLY: Google (and other engines) index
// whatever's actually in the HTML response, not what JS renders later. A
// <link rel="canonical"> per page plus a real, unique <title>/description
// per profile and per Pulse is what lets Google show a proper title +
// snippet for that exact URL instead of the same generic "Nexor Sparks"
// text for every page (which reads as low-quality/duplicate content to a
// crawler and actively hurts ranking). This is also required groundwork for
// getting a sitemap indexed usefully — see sitemap.xml / robots.txt.
// ----------------------------------------------------------------------------

const DB_BASE = "https://pulse2-92372-default-rtdb.firebaseio.com";
const SITE_ORIGIN = "https://nexor-f4d.pages.dev";
const DEFAULT_IMAGE = `${SITE_ORIGIN}/IMG_8305.png`;

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

class MetaTagRewriter {
  constructor(values) { this.v = values; }
  element(el) {
    const id = el.getAttribute("id");
    switch (id) {
      case "meta-description":
      case "meta-og-description":
      case "meta-twitter-description":
        el.setAttribute("content", this.v.description);
        break;
      case "meta-og-title":
      case "meta-twitter-title":
        el.setAttribute("content", this.v.title);
        break;
      case "meta-og-image":
      case "meta-twitter-image":
        el.setAttribute("content", this.v.image);
        break;
      case "meta-og-url":
        el.setAttribute("content", this.v.url);
        break;
    }
  }
}
class TitleRewriter {
  constructor(title) { this.title = title; }
  element(el) { el.setInnerContent(this.title); }
}
// Injects <link rel="canonical" href="..."> into <head> — tells Google
// exactly which URL is the "real" one for this content, so it indexes and
// ranks that specific /@handle or /p/id page instead of treating every
// route as a duplicate of the homepage.
class CanonicalInjector {
  constructor(url) { this.url = url; }
  element(el) {
    el.append(`<link rel="canonical" href="${this.url}">`, { html: true });
  }
}

function applyMeta(response, values) {
  return new HTMLRewriter()
    .on('meta[id^="meta-"]', new MetaTagRewriter(values))
    .on("title", new TitleRewriter(values.title))
    .on("head", new CanonicalInjector(values.url))
    .transform(response);
}

async function handleProfile(handle, response) {
  const idxRes = await fetch(`${DB_BASE}/handleIndex/${encodeURIComponent(handle)}.json`);
  if (!idxRes.ok) return response;
  const idxVal = await idxRes.json();
  const uid = typeof idxVal === "string" ? idxVal : idxVal && idxVal.uid;
  if (!uid) return response; // handle doesn't exist — keep defaults

  const userRes = await fetch(`${DB_BASE}/users/${encodeURIComponent(uid)}.json`);
  if (!userRes.ok) return response;
  const u = await userRes.json();
  if (!u) return response;

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

  return applyMeta(response, {
    title: esc(title), description: esc(description),
    image: esc(image), url: esc(pageUrl),
  });
}

async function handlePost(postId, response) {
  const pulseRes = await fetch(`${DB_BASE}/pulses/${encodeURIComponent(postId)}.json`);
  if (!pulseRes.ok) return response;
  const p = await pulseRes.json();
  if (!p) return response; // post doesn't exist / was deleted — keep defaults

  const authorName = p.creatorName || "User";
  const authorHandle = p.creatorHandle || "user";
  const text = (p.text || "").trim();
  const postImage = (p.images && p.images[0]) || p.imageBase64 || null;
  const image = realImageOrDefault(postImage);
  const pageUrl = `${SITE_ORIGIN}/p/${postId}`;

  const title = `${authorName} on Nexor Sparks`;
  const description = (text ? text : `Check out this Pulse by @${authorHandle} on Nexor Sparks.`).slice(0, 200);

  return applyMeta(response, {
    title: esc(title), description: esc(description),
    image: esc(image), url: esc(pageUrl),
  });
}

export const onRequest = async ({ request, next }) => {
  const url = new URL(request.url);
  const profileMatch = url.pathname.match(/^\/@([a-zA-Z0-9_]{1,30})\/?$/);
  const postMatch = url.pathname.match(/^\/p\/([^\/?#]+)\/?$/);

  if (!profileMatch && !postMatch) return next(); // any other route — untouched

  const response = await next(); // the normal static index.html response
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return response;

  try {
    if (profileMatch) return await handleProfile(profileMatch[1].toLowerCase(), response);
    if (postMatch) return await handlePost(postMatch[1], response);
    return response;
  } catch (err) {
    // Any failure (network, permission-denied, bad data) -> just serve the
    // normal default page. Never break the real app over this.
    return response;
  }
};
