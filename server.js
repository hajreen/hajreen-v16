const express = require("express");

const app = express();
const PORT = process.env.PORT || 10000;

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || "";
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.6-sol";

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(express.static(__dirname));

function token(req) {
  const h = req.headers.authorization || "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}

async function getUser(accessToken) {
  if (!accessToken || !SUPABASE_URL || !SUPABASE_SECRET_KEY) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${accessToken}` }
  });
  return r.ok ? await r.json() : null;
}

app.get("/api/health", (_req, res) =>
  res.json({ ok: true, service: "HAJREEN V16", time: new Date().toISOString() })
);

app.get("/api/config", (_req, res) =>
  res.json({
    ok: true,
    supabaseConfigured: Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY),
    openaiConfigured: Boolean(OPENAI_API_KEY),
    model: OPENAI_MODEL
  })
);

app.get("/api/supabase/health", async (_req, res) => {
  try {
    if (!SUPABASE_URL || !SUPABASE_SECRET_KEY)
      return res.status(503).json({ ok: false, error: "Supabase not configured" });
    const r = await fetch(`${SUPABASE_URL}/rest/v1/app_data?select=user_id&limit=1`, {
      headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}` }
    });
    res.status(r.ok ? 200 : 503).json({ ok: r.ok, status: r.status });
  } catch (e) {
    res.status(503).json({ ok: false, error: e.message });
  }
});

app.get("/api/data", async (req, res) => {
  try {
    const user = await getUser(token(req));
    if (!user?.id) return res.status(401).json({ error: "Unauthorized" });

    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/app_data?select=data,updated_at&user_id=eq.${encodeURIComponent(user.id)}&limit=1`,
      {
        headers: {
          apikey: SUPABASE_SECRET_KEY,
          Authorization: `Bearer ${SUPABASE_SECRET_KEY}`
        }
      }
    );
    if (!r.ok) return res.status(502).json({ error: "Cloud read failed", detail: (await r.text()).slice(0, 500) });
    const rows = await r.json();
    res.json(rows[0] || { data: {}, updated_at: null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put("/api/data", async (req, res) => {
  try {
    const user = await getUser(token(req));
    if (!user?.id) return res.status(401).json({ error: "Unauthorized" });

    const r = await fetch(`${SUPABASE_URL}/rest/v1/app_data?on_conflict=user_id`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SECRET_KEY,
        Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=representation"
      },
      body: JSON.stringify({
        user_id: user.id,
        data: req.body?.data ?? req.body ?? {},
        updated_at: new Date().toISOString()
      })
    });
    if (!r.ok) return res.status(502).json({ error: "Cloud save failed", detail: (await r.text()).slice(0, 800) });
    res.json({ ok: true, row: (await r.json())[0] || null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/ai/analyze", async (req, res) => {
  try {
    if (!OPENAI_API_KEY) return res.status(503).json({ error: "OPENAI_API_KEY is not configured" });

    const question = String(req.body?.question || "Analyze the current HAJREEN business data.");
    const businessData = req.body?.businessData ?? {};
    const input = [
      "You are HAJREEN CEO Intelligence, a serious executive business analyst.",
      "Use only the supplied data. Do not invent numbers.",
      "Separate facts from estimates. Give findings, risks, opportunities and prioritized actions.",
      "Respond in clear Swahili unless asked otherwise.",
      `QUESTION: ${question}`,
      `BUSINESS DATA: ${JSON.stringify(businessData)}`
    ].join("\n\n");

    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({ model: OPENAI_MODEL, input, max_output_tokens: 2200 })
    });
    const raw = await r.text();
    if (!r.ok) return res.status(r.status).json({ error: "OpenAI request failed", detail: raw.slice(0, 1200) });

    const data = JSON.parse(raw);
    const output = data.output_text || (data.output || [])
      .flatMap(x => x.content || [])
      .map(x => x.text || "")
      .filter(Boolean).join("\n");

    res.json({ ok: true, model: OPENAI_MODEL, output });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("*", (_req, res) => res.sendFile(__dirname + "/index.html"));

app.listen(PORT, "0.0.0.0", () => console.log(`HAJREEN V16 running on ${PORT}`));
