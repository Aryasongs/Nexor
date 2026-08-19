// functions/index.js
// Handles the root route "/". If a legacy "?pulse=POST_ID" share link
// (the format the old shareUrl() button used to generate, and any links
// already sitting in people's chats) is opened, this applies the exact
// same SSR meta/content rendering as /p/[id].js — so both link formats
// remain crawlable by AI bots / link-unfurlers.
// Every other "/" request (normal homepage visits) passes straight
// through untouched.
import { renderPulseSSR } from "./_shared/pulseSsr.js";

export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);
  const pulseId = url.searchParams.get("pulse");

  const assetResponse = await next();
  if (!pulseId) return assetResponse;

  return renderPulseSSR({ id: pulseId, assetResponse, context });
}
