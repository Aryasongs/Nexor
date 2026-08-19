// functions/p/[id].js
// Handles the current (/p/POST_ID) share link format.
import { renderPulseSSR } from "../_shared/pulseSsr.js";

export async function onRequest(context) {
  const { params, next } = context;
  const assetResponse = await next();
  return renderPulseSSR({ id: params.id, assetResponse, context });
}
