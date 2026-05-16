export const config = {
  api: {
    bodyParser: {
      sizeLimit: '2mb',
    },
  },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const userMessages = body.messages   || [];
    const maxTokens    = body.max_tokens || 600;
    const dataContext  = body.data_context || '';

    // Detect detail mode
    const lastUserMsg = userMessages.filter(m => m.role === 'user').slice(-1)[0];
    const lastText    = lastUserMsg ? lastUserMsg.content.toLowerCase() : '';
    const wantsDetail = ['detailed','elaborate','full analysis','explain more','deep dive',
      'breakdown','report','analyse','analyze','why','forecast','predict',
      'recommend','suggestion','insight'].some(k => lastText.includes(k));

    const briefPrompt = `You are TMW Assistant for The Momo Warehouse.
CRITICAL RULES:
- ONLY use the LIVE BUSINESS DATA below. Never guess or hallucinate.
- Use exact names, amounts and dates from the data.
- Today's date is clearly marked — use it precisely for date queries.
- Respond in 1-3 sentences max. Facts only. No commentary unless asked.

LIVE BUSINESS DATA:
${dataContext}`;

    const detailPrompt = `You are TMW Assistant — AI business intelligence for The Momo Warehouse, Kolkata.
CRITICAL RULES:
- ONLY use the LIVE BUSINESS DATA below. Never guess or hallucinate.
- Use exact names, amounts and dates from the data.
- Today's date is clearly marked — use it precisely for date queries.
- Provide thorough analysis with insights, trends and recommendations.
- Max 300 words.

LIVE BUSINESS DATA:
${dataContext}`;

    const systemPrompt = wantsDetail ? detailPrompt : briefPrompt;
    const messages = [
      { role: 'system', content: systemPrompt },
      ...userMessages
    ];

    // ── Model fallback chain ────────────────────────────────────────
    // Each provider is tried in order. If it hits rate limit (429) or
    // server error (5xx), the next provider is tried automatically.
    const providers = [];

    // 1. Groq — Llama 3.3 70B
    if (process.env.GROQ_API_KEY) {
      providers.push({
        name: 'Groq/Llama-3.3',
        call: async () => {
          const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
            },
            body: JSON.stringify({
              model: 'llama-3.3-70b-versatile',
              max_tokens: wantsDetail ? 600 : 250,
              temperature: 0.3,
              messages
            })
          });
          const data = await r.json();
          if (!r.ok) throw { status: r.status, message: data?.error?.message || 'Groq error' };
          return data.choices?.[0]?.message?.content || null;
        }
      });
    }

    // 2. Gemini 2.5 Flash
    if (process.env.GEMINI_API_KEY) {
      providers.push({
        name: 'Gemini/2.5-Flash',
        call: async () => {
          // Convert messages to Gemini format
          const geminiContents = messages
            .filter(m => m.role !== 'system')
            .map(m => ({
              role: m.role === 'assistant' ? 'model' : 'user',
              parts: [{ text: m.content }]
            }));

          // Prepend system prompt as first user message if needed
          const systemMsg = messages.find(m => m.role === 'system');
          if (systemMsg && geminiContents.length > 0) {
            geminiContents[0].parts[0].text = systemMsg.content + '\n\n' + geminiContents[0].parts[0].text;
          }

          const r = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-04-17:generateContent?key=${process.env.GEMINI_API_KEY}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: geminiContents,
                generationConfig: {
                  maxOutputTokens: wantsDetail ? 600 : 250,
                  temperature: 0.3
                }
              })
            }
          );
          const data = await r.json();
          if (!r.ok) throw { status: r.status, message: data?.error?.message || 'Gemini error' };
          return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
        }
      });
    }

    // 3. Groq — fallback model (mixtral)
    if (process.env.GROQ_API_KEY) {
      providers.push({
        name: 'Groq/Llama-3.1-8B',
        call: async () => {
          const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
            },
            body: JSON.stringify({
              model: 'llama-3.1-8b-instant',
              max_tokens: wantsDetail ? 600 : 250,
              temperature: 0.3,
              messages
            })
          });
          const data = await r.json();
          if (!r.ok) throw { status: r.status, message: data?.error?.message || 'Groq fallback error' };
          return data.choices?.[0]?.message?.content || null;
        }
      });
    }

    if (providers.length === 0) {
      return res.status(500).json({ error: 'No API keys configured. Add GROQ_API_KEY or GEMINI_API_KEY.' });
    }

    // ── Try each provider in order ──────────────────────────────────
    let lastError = null;
    for (const provider of providers) {
      try {
        console.log(`Trying ${provider.name}...`);
        const reply = await provider.call();
        if (reply) {
          console.log(`Success: ${provider.name}`);
          return res.status(200).json({
            choices: [{ message: { content: reply } }],
            provider: provider.name // useful for debugging
          });
        }
      } catch (err) {
        lastError = err;
        const status = err.status || 500;
        // Only retry on rate limit (429) or server errors (5xx)
        // On auth errors (401, 403) don't bother retrying same provider class
        if (status === 429 || status >= 500) {
          console.warn(`${provider.name} failed (${status}): ${err.message} — trying next...`);
          continue;
        }
        // Auth/bad request error — log but still try next provider
        console.warn(`${provider.name} error (${status}): ${err.message} — trying next...`);
        continue;
      }
    }

    // All providers failed
    console.error('All providers failed. Last error:', lastError);
    return res.status(503).json({
      error: 'All AI providers are currently unavailable. Last error: ' + (lastError?.message || 'Unknown'),
      fallback: true // signal frontend to use local engine
    });

  } catch (err) {
    console.error('Proxy error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
