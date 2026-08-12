// Cloudflare Pages Function
// Path: functions/sitemap.xml.js
// Serves a real, always-current sitemap at https://nexor-f4d.pages.dev/sitemap.xml
//
// WHY THIS IS A FUNCTION, NOT A STATIC FILE: your content (profiles, Pulses)
// lives in Firebase and changes constantly — a hand-written static
// sitemap.xml would go stale immediately. This queries Firebase fresh on
// every request (Cloudflare edge-caches the response for an hour, see the
// Cache-Control header below, so it isn't hammering your database) and
// builds the XML from the same `createdAt`-ordered indexes the app itself
// already uses, so it's always accurate.
//
// SCOPE: lists the 500 most recent public Pulses and their authors' profile
// pages, plus the homepage. That's a deliberately conservative cap — a
// sitemap isn't meant to list literally everything, just give crawlers a
// reliable, fresh starting set of your most relevant/recent URLs. Google
// discovers further pages by following links between them from there.
//
// REQUIREMENT: same as _middleware.js — `pulses` (ordered by createdAt) and
// the public fields under `users/{uid}` need to be readable without auth.

const DB_BASE = "https://pulse2-92372-default-rtdb.firebaseio.com";
const SITE_ORIGIN = "https://nexor-f4d.pages.dev";
const MAX_POSTS = 500;

function xmlEscape(str) {
  return String(str ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function isoDate(ms) {
  try { return new Date(ms || Date.now()).toISOString(); } catch { return new Date().toISOString(); }
}

export const onRequest = async () => {
  const urls = [
    { loc: `${SITE_ORIGIN}/`, lastmod: isoDate(Date.now()), priority: "1.0" },
  ];

  try {
    // Most recent public Pulses, same index the app's own feed uses.
    const pulsesRes = await fetch(`${DB_BASE}/pulses.json?orderBy="createdAt"&limitToLast=${MAX_POSTS}`);
    if (pulsesRes.ok) {
      const pulsesObj = await pulsesRes.json();
      const seenHandles = new Set();
      if (pulsesObj) {
        for (const [id, p] of Object.entries(pulsesObj)) {
          if (!p || p.deleted || p.private) continue; // skip removed/private posts if those flags exist
          urls.push({
            loc: `${SITE_ORIGIN}/p/${id}`,
            lastmod: isoDate(p.editedAt || p.createdAt),
            priority: "0.7",
          });
          if (p.creatorHandle && !seenHandles.has(p.creatorHandle)) {
            seenHandles.add(p.creatorHandle);
            urls.push({
              loc: `${SITE_ORIGIN}/@${p.creatorHandle}`,
              lastmod: isoDate(p.createdAt),
              priority: "0.6",
            });
          }
        }
      }
    }
  } catch (err) {
    // If Firebase is unreachable, still serve a valid (if minimal) sitemap
    // rather than a broken response.
  }

  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map(u =>
      `  <url>\n    <loc>${xmlEscape(u.loc)}</loc>\n    <lastmod>${u.lastmod}</lastmod>\n    <priority>${u.priority}</priority>\n  </url>`
    ).join("\n") +
    `\n</urlset>\n`;

  return new Response(body, {
    headers: {
      "Content-Type": "application/xml; charset=UTF-8",
      // Edge-cache for an hour so this doesn't hit Firebase on every crawl.
      "Cache-Control": "public, max-age=3600",
    },
  });
};
