module.exports = async (req, res) => {
  // Allow the browser's CORS preflight check
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method === 'GET') { const key = process.env.OPENROUTER_API_KEY; res.status(200).json({ keyFound: !!key, keyStartsWith: key ? key.slice(0, 7) : null, keyLength: key ? key.length : 0 }); return; }
  if (req.method !== 'POST') {
    res.status(405).json({ success: false, error: 'Method not allowed' });
    return;
  }

  try {
    const { nA, nB, sA, sB, feA, feB, factorDetails } = req.body || {};

    // ---- 1) Build the coaching prompt server-side ----
    const factorLines = (factorDetails || []).map(f =>
      `  - ${f.name} [${f.cat}]: ${nA} ${f.a}% / ${nB} ${f.b}% → Edge: ${f.edge}`
    ).join('\n');

    const diff = Math.abs(sA - sB);
    const leader = sA > sB ? nA : sB > sA ? nB : null;
    const weakerParty = sA < sB ? nA : sB < sA ? nB : null;
    const feWeaker = weakerParty === nA ? feA : feB;
    const calcWeaker = weakerParty === nA ? sA : sB;
    const biasDir = feWeaker < calcWeaker
      ? 'underconfidence (you gave the other side more power than the analysis shows)'
      : 'overconfidence (you underestimated the other side)';

    const prompt = `You are a senior sales and negotiation coach advising ${nA}. Analyse this Balance of power in depth and return your analysis as STRICT JSON ONLY — no markdown, no code fences, no preamble, matching exactly this schema:

{
  "bias": "underconfidence" or "overconfidence" or "aligned",
  "comparison_insight": "3-4 SHORT, plain-English sentences comparing the subjective gut-feel score (${feA}%) against the calculated score (${sA}%) for ${nA}. Name explicitly whether ${nA} over-estimated or under-estimated their own power. Ground the explanation in Preparation, Alignment, and Initiative wherever relevant — these are the most workable, fastest-to-fix factors for ${nA}, so prefer referencing these over harder-to-shift factors when explaining the gap. State the concrete risk this bias creates in plain terms (e.g. conceding too early, opening too weak). Wrap the 3-5 most important words or short phrases in <strong> tags (e.g. key numbers, the bias name, the risk) so they stand out — do not bold whole sentences, only key terms.",
  "leverage_advice": "3-4 SHORT, plain-English sentences on how ${nA} should reinforce their strengths. Prioritise Preparation, Alignment, and Initiative first if ${nA} holds any edge on them — call these out as the most workable, immediately actionable levers. Only after that, briefly mention one other strong factor if relevant. Give one concrete, simple action per factor, not abstract advice. Wrap the 3-5 most important words or phrases in <strong> tags so they stand out — do not bold whole sentences, only key terms.",
  "short_term_actions": [
    { "action": "one short, plain-English, concrete action nA can take immediately/this week — written simply, no jargon", "why": "one short sentence explaining why, tied to a specific factor" }
    // 4-5 of these objects. Preparation, Alignment, and Initiative are the most workable short-term levers — prioritise actions tied to these three factors first, then fill remaining slots with other factors where nA is behind nB
  ],
  "long_term_actions": [
    { "action": "one short, plain-English, concrete structural action", "why": "one short sentence on why this shifts the balance of power over time, tied to a specific factor" }
    // 3-4 of these objects, covering structural levers that take weeks/months: BATNA development, network & influence, conditionality, competitive alternatives, relationship building
  ]
}

## Situation
- Our side (${nA}): Intuitive score ${feA}% → Calculated score ${sA}%
- Their side (${nB}): Intuitive score ${feB}% → Calculated score ${sB}%
- Power gap: ${diff} points ${leader ? `in favour of ${leader}` : '— balanced'}
${weakerParty ? `- Bias signal for ${nA}: ${biasDir}` : ''}

## Factor breakdown (Critical > Strong > Medium > Low weight)
${factorLines}

Write in plain, simple English — short sentences, no jargon, no run-on explanations. Reference actual factor names from the breakdown. Preparation, Alignment, and Initiative are the most workable factors for ${nA} to act on quickly — favour these in your explanations wherever they're relevant, over harder-to-shift factors like Brand or Dependency. Coach-like, direct, no hedging, no filler. Return ONLY the JSON object, nothing else.`;

    // ---- 2) Call Claude via OpenRouter, using the key stored privately as a Vercel environment variable ----
    const aiResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        // Optional but recommended by OpenRouter — identifies your app, no functional effect otherwise
        'HTTP-Referer': 'https://negotiation-power-balance.example',
        'X-Title': 'Negotiation Power Balance',
      },
      body: JSON.stringify({
        model: 'anthropic/claude-sonnet-4.5', // swap this slug any time — browse options at openrouter.ai/models
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const aiData = await aiResponse.json();
    if (!aiResponse.ok) {
      throw new Error(aiData.error?.message || `OpenRouter API error ${aiResponse.status}`);
    }

    const rawText = aiData.choices?.[0]?.message?.content || '';

    // The model may occasionally wrap the JSON in ```json fences despite instructions — strip them defensively
    const cleaned = rawText.replace(/^```json\s*|```$/g, '').trim();
    let reportData;
    try {
      reportData = JSON.parse(cleaned);
    } catch (e) {
      throw new Error('Could not parse the analysis. Please try again.');
    }

    // ---- 3) Return the structured report data straight to the page — no email, no PDF ----
    res.status(200).json({ success: true, reportData });

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};
