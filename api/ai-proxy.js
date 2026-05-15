export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb',
    },
  },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GROQ_API_KEY not configured' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const userMessages = body.messages  || [];
    const maxTokens    = body.max_tokens || 600;
    const dataContext  = body.data_context || '';

    // Detect if user wants detailed analysis
    const lastUserMsg = userMessages.filter(function(m){ return m.role === 'user'; }).slice(-1)[0];
    const lastText    = lastUserMsg ? lastUserMsg.content.toLowerCase() : '';
    const wantsDetail = ['detailed','elaborate','full analysis','explain more','deep dive',
      'breakdown','report','analyse','analyze','why','forecast','predict',
      'recommend','suggestion','insight'].some(function(k){ return lastText.includes(k); });

    const systemPrompt = wantsDetail
      ? `You are TMW Assistant — AI business intelligence for The Momo Warehouse, a food delivery business in Kolkata.
CRITICAL RULES — MUST FOLLOW:
- You ONLY know what is in the LIVE BUSINESS DATA section below. Never guess or hallucinate.
- Use exact names, amounts and dates from the data. Do not invent any.
- Today's date and yesterday's date are clearly marked in the data — use them precisely.
- The FULL EXPENSE LEDGER contains every expense entry ever recorded — use it for any time range.
- Provide thorough analysis with insights, trends and recommendations.
- Max 300 words.

LIVE BUSINESS DATA:
${dataContext}`
      : `You are TMW Assistant for The Momo Warehouse.
CRITICAL RULES — MUST FOLLOW:
- You ONLY know what is in the LIVE BUSINESS DATA section below. Never guess or hallucinate.
- Use exact names, amounts and dates from the data. Do not invent any.
- Today's date and yesterday's date are clearly marked — use them precisely for date queries.
- The FULL EXPENSE LEDGER contains every expense entry ever recorded — use it for any time range.
- Respond in 1-3 sentences max. Facts only. No commentary unless asked.

LIVE BUSINESS DATA:
${dataContext}`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...userMessages
    ];

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: wantsDetail ? 600 : 250,
        temperature: 0.3,
        messages: messages
      })
    });

    if (!response.ok) {
      const errData = await response.json();
      console.error('Groq error:', JSON.stringify(errData));
      return res.status(response.status).json({ 
        error: errData?.error?.message || 'Groq API error',
        detail: errData 
      });
    }

    const data = await response.json();
    return res.status(200).json(data);

  } catch (err) {
    console.error('Proxy error:', err.message, err.stack);
    return res.status(500).json({ error: err.message });
  }
}
