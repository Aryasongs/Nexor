// functions/p/[id].js
// ---------------------------------------------------------------------
// Cloudflare Pages Function — runs at the edge for every request to
// /p/:id (a shared Pulse link). It fetches the Pulse straight from the
// Firebase Realtime Database REST API and rewrites the HTML that would
// otherwise be served (the plain SPA shell with generic/default meta
// tags) so it contains:
//   1) real per-post <title>/OG/Twitter meta tags (fixes link-preview
//      cards on WhatsApp/Telegram/X/etc.)
//   2) an actual, human-readable block of the post's text + author,
//      placed inside <noscript> — invisible to a normal browser (which
//      runs the SPA as usual and hides <noscript> content) but fully
//      visible in the raw HTML to any crawler that does NOT execute
//      JavaScript. This is exactly the class of bot AI answer-engines
//      use (GPTBot, ClaudeBot, PerplexityBot, ChatGPT-User, etc.) and
//      exactly what they need to "read" the post when a link is pasted
//      into them.
//   3) JSON-LD SocialMediaPosting structured data, same purpose.
//
// Nothing about the real app changes — client-side updateShareMeta()
// still runs as before and simply overwrites these tags once JS boots,
// and the pendingPulseId sessionStorage flow still opens the detail
// screen normally for real visitors.
// ---------------------------------------------------------------------

const RTDB_BASE = "https://pulse2-92372-default-rtdb.firebaseio.com";
const SITE_ORIGIN = "https://nexor-f4d.pages.dev"; // update if you're on a custom domain
const DEFAULT_IMAGE = `${SITE_ORIGIN}/IMG_8305.png`;
const DEFAULT_TITLE = "Nexor Sparks";
const DEFAULT_DESC =
  "Nexor Sparks is where real conversations happen. Follow people, share your Pulses, and see what's trending — join the community today.";

// Edge cache for the rendered fragment (per post) so repeated crawler
// hits (and real traffic) don't hammer the RTDB REST endpoint.
const CACHE_TTL_SECONDS = 300;

function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

function escapeAttr(str) {
  return escapeHtml(str);
}

async function fetchJson(path) {
  try {
    const res = await fetch(`${RTDB_BASE}${path}.json`);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

export async function onRequest(context) {
  const { request, params, next } = context;
  const id = params.id;

  // 1) Get the normal SPA HTML that _redirects would already be serving
  //    for this route (i.e. index.html, status 200).
  const assetResponse = await next();

  // Only rewrite actual HTML documents.
  const contentType = assetResponse.headers.get("content-type") || "";
  if (!id || !contentType.includes("text/html")) {
    return assetResponse;
  }

  // Edge cache check (per post id) — avoids re-hitting RTDB on every crawl.
  const cache = caches.default;
  const cacheKey = new Request(`${SITE_ORIGIN}/__ssr-cache/p/${id}`, request);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  // 2) Pull the Pulse straight from the Realtime Database REST API.
  const pulse = await fetchJson(`/pulses/${encodeURIComponent(id)}`);

  if (!pulse || !pulse.uid) {
    // Post not found / deleted — just serve the normal shell untouched.
    return assetResponse;
  }

  // Respect privacy: don't SSR content for private accounts, subscriber
  // -only Pulses, or restricted/suspended authors. Fall back to a generic
  // (non-revealing) card instead of leaking gated content to crawlers.
  const [authorPrivate, authorSuspended] = await Promise.all([
    fetchJson(`/users/${pulse.uid}/private`),
    fetchJson(`/users/${pulse.uid}/suspended`),
  ]);
  const gated = !!authorPrivate || !!authorSuspended || !!pulse.subscribersOnly;

  const authorName = pulse.creatorName || "User";
  const authorHandle = pulse.creatorHandle || "user";
  const postText = pulse.text || "";
  const postImage = (pulse.images && pulse.images[0]) || pulse.imageBase64 || null;

  const title = gated ? DEFAULT_TITLE : `${authorName} (@${authorHandle}) on Nexor Sparks`;
  const description = gated
    ? DEFAULT_DESC
    : (postText ? postText.slice(0, 200) : `Check out this Pulse by @${authorHandle} on Nexor Sparks.`);
  const image = gated ? DEFAULT_IMAGE : (postImage || DEFAULT_IMAGE);
  const canonicalUrl = `${SITE_ORIGIN}/p/${encodeURIComponent(id)}`;
  const postedAt = pulse.createdAt ? new Date(pulse.createdAt).toISOString() : undefined;

  // Rewrite the existing meta tags (they already carry the right ids).
  class MetaContentRewriter {
    constructor(value) { this.value = value; }
    element(element) {
      if (this.value != null) element.setAttribute("content", this.value);
    }
  }
  class HrefRewriter {
    constructor(value) { this.value = value; }
    element(element) { element.setAttribute("href", this.value); }
  }
  class TitleRewriter {
    constructor(value) { this.value = value; }
    element(element) { element.setText(this.value); }
  }

  // Human-readable fallback content for non-JS crawlers, wrapped in
  // <noscript> so it never shows up for real (JS-enabled) visitors —
  // the browser suppresses <noscript> content whenever scripting is on.
  const ssrBlock = gated
    ? ""
    : `<noscript>
  <article>
    <h1>${escapeHtml(authorName)} (@${escapeHtml(authorHandle)}) on Nexor Sparks</h1>
    ${postedAt ? `<p><time datetime="${escapeAttr(postedAt)}">${escapeHtml(new Date(pulse.createdAt).toUTCString())}</time></p>` : ""}
    <p>${escapeHtml(postText).replace(/\n/g, "<br>")}</p>
    ${postImage ? `<img src="${escapeAttr(postImage)}" alt="Image attached to this post">` : ""}
    <p>Likes: ${Number(pulse.likes || 0)} · Replies: ${Number(pulse.replies || 0)} · Reposts: ${Number(pulse.reposts || 0)}</p>
    <p><a href="${escapeAttr(canonicalUrl)}">View this post on Nexor Sparks</a></p>
  </article>
</noscript>
<script type="application/ld+json">
${JSON.stringify({
  "@context": "https://schema.org",
  "@type": "SocialMediaPosting",
  "headline": title,
  "articleBody": postText,
  "datePublished": postedAt,
  "url": canonicalUrl,
  "image": postImage || undefined,
  "author": {
    "@type": "Person",
    "name": authorName,
    "url": `${SITE_ORIGIN}/@${authorHandle}`,
  },
  "interactionStatistic": [
    { "@type": "InteractionCounter", "interactionType": "https://schema.org/LikeAction", "userInteractionCount": Number(pulse.likes || 0) },
    { "@type": "InteractionCounter", "interactionType": "https://schema.org/ReplyAction", "userInteractionCount": Number(pulse.replies || 0) },
  ],
})}
</script>`;

  class BodyPrepender {
    element(element) {
      if (ssrBlock) element.prepend(ssrBlock, { html: true });
    }
  }

  const rewritten = new HTMLRewriter()
    .on("title", new TitleRewriter(title))
    .on("#meta-description", new MetaContentRewriter(description))
    .on("#meta-og-title", new MetaContentRewriter(title))
    .on("#meta-og-description", new MetaContentRewriter(description))
    .on("#meta-og-image", new MetaContentRewriter(image))
    .on("#meta-og-url", new MetaContentRewriter(canonicalUrl))
    .on("#meta-canonical", new HrefRewriter(canonicalUrl))
    .on("#meta-twitter-title", new MetaContentRewriter(title))
    .on("#meta-twitter-description", new MetaContentRewriter(description))
    .on("#meta-twitter-image", new MetaContentRewriter(image))
    .on("body", new BodyPrepender())
    .transform(assetResponse);

  const finalResponse = new Response(rewritten.body, rewritten);
  finalResponse.headers.set(
    "Cache-Control",
    `public, max-age=60, s-maxage=${CACHE_TTL_SECONDS}`
  );

  // Store in edge cache for next crawler/visitor hitting the same post.
  context.waitUntil(cache.put(cacheKey, finalResponse.clone()));

  return finalResponse;
}
