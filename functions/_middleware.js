// Cloudflare Pages Function
// Path: functions/_middleware.js  (put this file at that exact path in your project)
//
// WHAT THIS DOES
// ----------------------------------------------------------------------------
// Your app is a client-side SPA — index.html is the same static file for every
// URL, and the real profile data (bio, followers, following) only gets written
// into the meta tags AFTER Firebase loads in the browser (updateShareMeta()).
// Any fetcher that doesn't run JS (search engine crawlers, ChatGPT's browsing,
// link-preview bots, etc.) only ever sees the generic default meta tags.
//
// This Function intercepts requests to /@handle, fetches that user's PUBLIC
// data straight from your Firebase Realtime Database REST API (server-side,
// no auth — the exact same unauthenticated read your app already relies on
// for handleIndex/{handle} lookups), and rewrites the <meta id="..."> tags in
// the HTML before it's sent out. Real visitors are unaffected — your existing
// client JS still runs and overwrites these same tags with fresh data once
// Firebase loads in-browser.
//
// REQUIREMENT: your Firebase Realtime Database rules must allow public read
// of `handleIndex/{handle}` and at least the public fields under `users/{uid}`
// (handle, name, bio, followersCount, followingCount, photoURL/avatar,
// verified). If rules block it, this Function fails silently and falls back
// to your normal default meta tags — nothing breaks.
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

export const onRequest = async ({ request, next }) => {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/@([a-zA-Z0-9_]{1,30})\/?$/);

  // Not a profile URL — let the static file / SPA fallback handle it as usual.
  if (!match) return next();

  const handle = match[1].toLowerCase();
  const response = await next(); // the normal static index.html response

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return response;

  try {
    // 1) handleIndex/{handle} -> uid  (same lookup the app itself does)
    const idxRes = await fetch(`${DB_BASE}/handleIndex/${encodeURIComponent(handle)}.json`);
    if (!idxRes.ok) return response;
    const idxVal = await idxRes.json();
    const uid = typeof idxVal === "string" ? idxVal : idxVal && idxVal.uid;
    if (!uid) return response; // handle doesn't exist — keep defaults

    // 2) users/{uid} -> public profile fields
    const userRes = await fetch(`${DB_BASE}/users/${encodeURIComponent(uid)}.json`);
    if (!userRes.ok) return response;
    const u = await userRes.json();
    if (!u) return response;

    const realHandle = u.handle || handle;
    const name = u.name || `@${realHandle}`;
    const bio = (u.bio || "").trim();
    const followers = fmtCount(u.followersCount || 0);
    const following = fmtCount(u.followingCount || 0);
    const image = u.photoURL || u.avatar || DEFAULT_IMAGE;
    const pageUrl = `${SITE_ORIGIN}/@${realHandle}`;

    const title = `${name} (@${realHandle}) • Nexor Sparks`;
    let description = `${followers} Followers, ${following} Following`;
    if (bio) description += ` — ${bio}`;
    description = description.slice(0, 200);

    const values = {
      title: esc(title),
      description: esc(description),
      image: esc(image),
      url: esc(pageUrl),
    };

    return new HTMLRewriter()
      .on('meta[id^="meta-"]', new MetaTagRewriter(values))
      .on("title", new TitleRewriter(values.title))
      .transform(response);
  } catch (err) {
    // Any failure (network, permission-denied, bad data) -> just serve the
    // normal default page. Never break the real app over this.
    return response;
  }
};
