// functions/_shared/pulseSsr.js
// ---------------------------------------------------------------------
// Shared SSR logic for rendering real Pulse meta tags + a crawler-visible
// <noscript> content block. Used by both:
//   - functions/p/[id].js        →  /p/POST_ID          (new share format)
//   - functions/index.js         →  /?pulse=POST_ID      (legacy share format)
// so both link formats are equally crawlable by AI bots / link-unfurlers.
// ---------------------------------------------------------------------

export const RTDB_BASE = "https://pulse2-92372-default-rtdb.firebaseio.com";
export const SITE_ORIGIN = "https://nexor-f4d.pages.dev"; // update if on a custom domain
export const DEFAULT_IMAGE = `${SITE_ORIGIN}/IMG_8305.png`;
export const DEFAULT_TITLE = "Nexor Sparks";
export const DEFAULT_DESC =
  "Nexor Sparks is where real conversations happen. Follow people, share your Pulses, and see what's trending — join the community today.";

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

async function fetchJson(path) {
  try {
    const res = await fetch(`${RTDB_BASE}${path}.json`);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

// canonicalUrl is always the clean /p/ID form — even when reached via the
// legacy ?pulse= link — so crawlers/search engines converge on one URL.
export async function renderPulseSSR({ id, assetResponse, context }) {
  const contentType = assetResponse.headers.get("content-type") || "";
  if (!id || !contentType.includes("text/html")) {
    return assetResponse;
  }

  const cache = caches.default;
  const cacheKey = new Request(`${SITE_ORIGIN}/__ssr-cache/p/${id}`, { method: "GET" });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const pulse = await fetchJson(`/pulses/${encodeURIComponent(id)}`);
  if (!pulse || !pulse.uid) {
    return assetResponse;
  }

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

  class MetaContentRewriter {
    constructor(value) { this.value = value; }
    element(element) { if (this.value != null) element.setAttribute("content", this.value); }
  }
  class HrefRewriter {
    constructor(value) { this.value = value; }
    element(element) { element.setAttribute("href", this.value); }
  }
  class TitleRewriter {
    constructor(value) { this.value = value; }
    element(element) { element.setText(this.value); }
  }

  const ssrBlock = gated
    ? ""
    : `<noscript>
  <article>
    <h1>${escapeHtml(authorName)} (@${escapeHtml(authorHandle)}) on Nexor Sparks</h1>
    ${postedAt ? `<p><time datetime="${escapeHtml(postedAt)}">${escapeHtml(new Date(pulse.createdAt).toUTCString())}</time></p>` : ""}
    <p>${escapeHtml(postText).replace(/\n/g, "<br>")}</p>
    ${postImage ? `<img src="${escapeHtml(postImage)}" alt="Image attached to this post">` : ""}
    <p>Likes: ${Number(pulse.likes || 0)} · Replies: ${Number(pulse.replies || 0)} · Reposts: ${Number(pulse.reposts || 0)}</p>
    <p><a href="${escapeHtml(canonicalUrl)}">View this post on Nexor Sparks</a></p>
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
  "author": { "@type": "Person", "name": authorName, "url": `${SITE_ORIGIN}/@${authorHandle}` },
  "interactionStatistic": [
    { "@type": "InteractionCounter", "interactionType": "https://schema.org/LikeAction", "userInteractionCount": Number(pulse.likes || 0) },
    { "@type": "InteractionCounter", "interactionType": "https://schema.org/ReplyAction", "userInteractionCount": Number(pulse.replies || 0) },
  ],
})}
</script>`;

  class BodyPrepender {
    element(element) { if (ssrBlock) element.prepend(ssrBlock, { html: true }); }
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
  finalResponse.headers.set("Cache-Control", `public, max-age=60, s-maxage=${CACHE_TTL_SECONDS}`);

  context.waitUntil(cache.put(cacheKey, finalResponse.clone()));

  return finalResponse;
}
