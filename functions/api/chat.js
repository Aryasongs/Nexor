import { KNOWLEDGE_BASE } from "./_kb.js";

// Cloudflare Pages Function — POST /api/chat
// Keeps the Gemini API key on the server. It is NEVER sent to the browser.
// Set GEMINI_API_KEY in: Cloudflare Pages dashboard → your project →
// Settings → Environment variables → Production (and Preview) → Add variable.

const SYSTEM_PROMPT = `You are "Sparky", the AI Help Assistant for Nexor Sparks, a social app where users post "Pulses" (short posts) and "Articles".
Answer briefly (2-5 sentences), in friendly Hinglish (Hindi+English mix, Latin script), like Instagram's help bot.

You must answer ONLY using the information in the HELP CENTER KNOWLEDGE BASE below — this is the site's real, official help content.
Do not invent steps, policies, or features that are not written in the knowledge base.
If the knowledge base does not cover the user's question, say clearly that you don't have that information yet and suggest they use the "Report a Problem" page, instead of guessing.
Never claim to take real actions (like actually resetting a password) — only guide the user on the steps to do it themselves in the app, based on the knowledge base.

===== HELP CENTER KNOWLEDGE BASE =====
${KNOWLEDGE_BASE}
===== END OF KNOWLEDGE BASE =====`;

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.GEMINI_API_KEY) {
    return new Response(JSON.stringify({ error: "AI is not configured yet. Add GEMINI_API_KEY in Cloudflare Pages environment variables." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const userMessage = String(body.message || "").slice(0, 1500);
  if (!userMessage.trim()) {
    return new Response(JSON.stringify({ error: "Empty message" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const resp = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-goog-api-key": env.GEMINI_API_KEY,
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: `${SYSTEM_PROMPT}\n\nUser message: ${userMessage}` }],
            },
          ],
        }),
      }
    );

    if (!resp.ok) {
      const errText = await resp.text();
      return new Response(JSON.stringify({ error: "AI service error", detail: errText }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    const data = await resp.json();
    const reply =
      data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
      "Sorry, main abhi jawaab generate nahi kar paaya. Kripya doosre shabdon mein try karein.";

    return new Response(JSON.stringify({ reply }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Request failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
