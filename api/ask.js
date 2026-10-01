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

  const model = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
  const fallbackModel = process.env.GEMINI_MODEL_FALLBACK || 'gemini-2.5-flash-lite';
  const system = json
    ? '你是一個資料查詢規劃器，只能依照給定的schema回傳結構化資料。'
    : '請用繁體中文，語氣自然口語，簡潔回答（3到4句）。直接輸出這段摘要的內容本身，不要加任何標題、前綴、編號、「Sentence」字樣、引用標記或markdown格式（不要用*號、#號等），第一個字就要是摘要正文。';

  const generationConfig = json
    ? { responseMimeType: 'application/json', responseSchema: QUERY_SPEC_SCHEMA, maxOutputTokens: 800, thinkingConfig: { thinkingBudget: 0 } }
    : { maxOutputTokens: 600, thinkingConfig: { thinkingBudget: 0 } };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const requestBody = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    systemInstruction: { parts: [{ text: system }] },
    generationConfig,
  });

  // Tries one model with a couple of quick retries on 503 (temporary overload).
  // Returns { apiRes, errText, modelUsed }.
  async function tryModel(modelName, maxAttempts) {
    let apiRes;
    let errText = '';
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      apiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: requestBody }
      );
      if (apiRes.ok) break;
      if (apiRes.status !== 503 || attempt === maxAttempts) {
        errText = await apiRes.text();
        break;
      }
      await sleep(attempt * 800); // 800ms, then 1600ms
    }
    return { apiRes, errText, modelUsed: modelName };
  }

  try {
    let { apiRes, errText, modelUsed } = await tryModel(model, 3);

    // Primary model still overloaded after retries — try a different model
    // once before giving up, since a 503 is specific to that one model being busy.
    if (!apiRes.ok && apiRes.status === 503 && fallbackModel && fallbackModel !== model) {
      console.error(`${model} still overloaded after retries, trying fallback ${fallbackModel}`);
      ({ apiRes, errText, modelUsed } = await tryModel(fallbackModel, 2));
    }

    if (!apiRes.ok) {
      console.error('Gemini API error', modelUsed, apiRes.status, errText);

      const status = apiRes.status === 429 ? 429 : 502;
      let msg = 'AI 服務暫時無法使用，請稍後再試。';
      if (apiRes.status === 429) {
        msg = '免費額度暫時用完了，請稍後再試（通常隔幾分鐘或隔天就會恢復）。';
      } else if (apiRes.status === 404) {
        msg = '目前設定的模型（' + model + '）可能已被 Google 下架，請到 aistudio.google.com 查目前可用的模型名稱，更新 Vercel 的 GEMINI_MODEL 環境變數。';
      } else if (apiRes.status === 503) {
        msg = 'Gemini 現在使用量太大、暫時滿載中（已經自動重試並換過備用模型），過一下下再問一次通常就會恢復。';
      }
      res.status(status).json({ error: msg, detail: apiRes.status === 429 ? undefined : errText.slice(0, 500) });
      return;
    }

    const data = await apiRes.json();
    let text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';

    if (!json) {
      // Safety net: strip any leaked internal formatting scaffolding
      // (e.g. "Sentence 2 (Data details):", "**Summary:**") some models
      // occasionally prepend before the actual answer text.
      text = text
        .replace(/^\s*(\*\*?)?Sentence\s*\d+[^:\n]*:\s*\**\s*/gim, '')
        .replace(/^\s*(\*\*?)?(Summary|Data details|摘要)\s*[:：]\s*\**\s*/gim, '')
        .replace(/^[\s*#>-]+/, '')
        .trim();
    }

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
