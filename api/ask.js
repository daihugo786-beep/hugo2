// Vercel serverless function: POST /api/ask
// Uses Google Gemini's FREE tier (Google AI Studio) — no credit card required.
// Body: { prompt: string, json: boolean }
// - json:true  -> forces Gemini to return a JSON object matching QUERY_SPEC_SCHEMA, returns { json }
// - json:false -> asks for a short zh-TW text answer, returns { text }
//
// The Gemini API key lives ONLY here (server-side env var), never in the frontend.

const hits = new Map(); // naive in-memory rate limiter (per warm instance, resets on cold start)

function isRateLimited(ip) {
  const now = Date.now();
  const windowMs = 60_000;
  const limit = Number(process.env.RATE_LIMIT_PER_MIN || 20);
  const arr = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > limit;
}

// Matches the query-spec JSON the frontend expects from the "json:true" call.
// Passing this as responseSchema makes Gemini's structured-output mode guarantee
// the shape, so we don't need to regex-strip markdown fences or risk malformed JSON.
const QUERY_SPEC_SCHEMA = {
  type: 'object',
  properties: {
    mode: { type: 'string', enum: ['trend', 'ranking', 'growth'] },
    counties: { type: 'array', items: { type: 'string' } },
    yearStart: { type: 'number' },
    yearEnd: { type: 'number' },
    metric: { type: 'string', enum: ['total', 'poll', 'expert', 'rank'] },
    party: { type: 'array', items: { type: 'string' } },
    topN: { type: 'number' },
    interpretation: { type: 'string' },
  },
  required: ['mode', 'counties', 'yearStart', 'yearEnd', 'metric', 'interpretation'],
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const ip =
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown';

  if (isRateLimited(ip)) {
    res.status(429).json({ error: '請求太頻繁，請稍後再試。' });
    return;
  }

  const { prompt, json } = req.body || {};

  if (!prompt || typeof prompt !== 'string') {
    res.status(400).json({ error: '缺少 prompt' });
    return;
  }
  if (prompt.length > 6000) {
    res.status(400).json({ error: 'prompt 過長' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: '伺服器尚未設定 GEMINI_API_KEY' });
    return;
  }

  const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash-lite';
  const system = json
    ? '你是一個資料查詢規劃器，只能依照給定的schema回傳結構化資料。'
    : '請用繁體中文，語氣自然口語，簡潔回答（3到4句），不要使用markdown格式（不要用*號、#號等）。';

  const generationConfig = json
    ? { responseMimeType: 'application/json', responseSchema: QUERY_SPEC_SCHEMA, maxOutputTokens: 800 }
    : { maxOutputTokens: 500 };

  try {
    const apiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          systemInstruction: { parts: [{ text: system }] },
          generationConfig,
        }),
      }
    );

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      console.error('Gemini API error', apiRes.status, errText);
      const status = apiRes.status === 429 ? 429 : 502;
      const msg =
        apiRes.status === 429
          ? '免費額度暫時用完了，請稍後再試（通常隔幾分鐘或隔天就會恢復）。'
          : 'AI 服務暫時無法使用，請稍後再試。';
      res.status(status).json({ error: msg, detail: apiRes.status === 429 ? undefined : errText.slice(0, 500) });
      return;
    }

    const data = await apiRes.json();
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';

    if (!text) {
      res.status(502).json({ error: 'AI 沒有回傳內容，請換個問法再試一次。' });
      return;
    }

    if (json) {
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        console.error('JSON parse failed', text);
        res.status(502).json({ error: 'AI 回傳格式無法解析，請換個問法再試一次。' });
        return;
      }
      res.status(200).json({ json: parsed });
    } else {
      res.status(200).json({ text });
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || '未知錯誤' });
  }
};
