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
    const userMessages = body.messages || [];
    const maxTokens    = body.max_tokens || 600;
    const dataContext  = body.data_context || '';

    // Detect if user wants detailed analysis
    const lastUserMsg  = userMessages.filter(m => m.role === 'user').slice(-1)[0];
    const lastText     = lastUserMsg ? lastUserMsg.content.toLowerCase() : '';
    const wantsDetail  = ['detailed','elaborate','full analysis','explain more','deep dive','breakdown','report','analyse','analyze','why','forecast','predict','recommend','suggestion','insight'].some(k => lastText.includes(k));

    const systemPrompt = wantsDetail
      ? `You are TMW Assistant — AI business intelligence for The Momo Warehouse, a food delivery business in Kolkata.
The user wants a detailed analysis. Provide thorough insights, reasoning, trends, recommendations and forecasts.
Use the live business data provided. Structure your response clearly with short sections.
Be analytical, operational, and insight-driven. Max 300 words.

LIVE BUSINESS DATA:
${dataContext}`
      : `You are TMW Assistant for The Momo Warehouse.
RESPOND BRIEFLY AND DIRECTLY. 1-3 sentences max. Facts only. No insights, no forecasts, no recommendations unless asked.
If the answer is a list, keep it to top 3-5 items max.
Use the live business data provided.

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
        model: 'model: "llama-3.3-70b-versatile"',
        max_tokens: wantsDetail ? 600 : 200,
        temperature: 0.5,
        messages: messages
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Groq error:', JSON.stringify(data));
      return res.status(response.status).json({ error: data?.error?.message || 'Groq API error' });
    }

    return res.status(200).json(data);

  } catch (err) {
    console.error('Proxy error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
