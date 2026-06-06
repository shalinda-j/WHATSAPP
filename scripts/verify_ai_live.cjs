/**
 * Live AI provider probe — verifies, against the REAL keys in .env, which
 * Gemini models actually answer vs 429 (paid-only) vs 404 (retired), and
 * whether Groq is reachable as a failover. Prints status only; never the key.
 *
 *   node scripts/verify_ai_live.cjs
 */
require('dotenv').config();
const axios = require('axios');

const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const GROQ_KEY = process.env.GROQ_API_KEY || '';
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || '';

function mask(k) {
  if (!k) return '(none)';
  return `${k.slice(0, 4)}…${k.slice(-2)} (len ${k.length})`;
}

async function probeGemini(model) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  try {
    const res = await axios.post(
      url,
      { contents: [{ parts: [{ text: 'Reply with the single word OK.' }] }] },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': GEMINI_KEY,
        },
        timeout: 20000,
      },
    );
    const text =
      res.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '(empty)';
    return { model, ok: true, status: res.status, text };
  } catch (err) {
    const status = err.response?.status;
    const apiErr =
      err.response?.data?.error?.status ||
      err.response?.data?.error?.message ||
      err.message;
    return { model, ok: false, status, error: String(apiErr).slice(0, 160) };
  }
}

async function probeGroq() {
  if (!GROQ_KEY) return { provider: 'groq', ok: false, error: 'no key' };
  try {
    const res = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
        max_tokens: 5,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${GROQ_KEY}`,
        },
        timeout: 20000,
      },
    );
    return {
      provider: 'groq',
      ok: true,
      status: res.status,
      text: res.data?.choices?.[0]?.message?.content?.trim() ?? '(empty)',
    };
  } catch (err) {
    return {
      provider: 'groq',
      ok: false,
      status: err.response?.status,
      error: String(
        err.response?.data?.error?.message || err.message,
      ).slice(0, 160),
    };
  }
}

(async () => {
  console.log('— AI provider live probe —');
  console.log('GEMINI_API_KEY   :', mask(GEMINI_KEY));
  console.log('GROQ_API_KEY     :', mask(GROQ_KEY));
  console.log('OPENROUTER_API_KEY:', mask(OPENROUTER_KEY));
  console.log('');

  if (GEMINI_KEY) {
    const models = [
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
      'gemini-3.5-flash',
    ];
    for (const m of models) {
      const r = await probeGemini(m);
      if (r.ok) {
        console.log(`✅ ${m.padEnd(24)} HTTP ${r.status}  → "${r.text}"`);
      } else {
        console.log(
          `❌ ${m.padEnd(24)} HTTP ${r.status ?? '???'}  → ${r.error}`,
        );
      }
    }
  } else {
    console.log('GEMINI_API_KEY not set — skipping Gemini probe.');
  }

  console.log('');
  const g = await probeGroq();
  if (g.ok) console.log(`✅ groq                     HTTP ${g.status}  → "${g.text}"`);
  else console.log(`❌ groq                     HTTP ${g.status ?? '???'}  → ${g.error}`);
})();
