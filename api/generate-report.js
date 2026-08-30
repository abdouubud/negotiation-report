module.exports = async (req, res) => {
  // Allow the browser's CORS preflight check
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ success: false, error: 'Method not allowed' });
    return;
  }

  try {
    const { nA, nB, sA, sB, feA, feB, factorDetails, circleGroups, topStrengths } = req.body || {};

    // ---- 1) Build the coaching prompt server-side ----
    const factorLines = (factorDetails || []).map(f =>
      `  - ${f.name} [${f.cat}]: ${nA} ${f.a}% / ${nB} ${f.b}% → Edge: ${f.edge}`
    ).join('\n');

    const listCircle = (list) => (list || []).map(f => `${f.name} (${nA} ${f.a}% / ${nB} ${f.b}%)`).join(', ') || 'none selected';
    const controlList = listCircle(circleGroups && circleGroups.control);
    const influenceList = listCircle(circleGroups && circleGroups.influence);
    const concernList = listCircle(circleGroups && circleGroups.concern);
    const strengthsList = (topStrengths || []).map(f => `${f.name} (${nA} ${f.a}% vs ${nB} ${f.b}%)`).join(', ') || 'no clear leading factor';

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
  "comparison_insight": "3-4 SHORT, plain-English sentences comparing the subjective gut-feel score (${feA}%) against the calculated score (${sA}%) for ${nA}. Name explicitly whether ${nA} over-estimated or under-estimated their own power. State the concrete risk this bias creates in plain terms (e.g. conceding too early, opening too weak). Wrap the 3-5 most important words or short phrases in <strong> tags so they stand out — do not bold whole sentences, only key terms.",
  "strengths_advice": "3-4 SHORT, plain-English sentences on how ${nA} should reinforce and bank the strengths listed below (${strengthsList}). For each one, suggest a concrete way to make it visible to ${nB} and ask whether ${nA} could push it further (gain another 5-10%). Wrap key terms in <strong> tags.",
  "control_actions": [
    { "action": "one short, plain-English, immediately actionable step for nA this week", "why": "one short sentence tying it to a specific factor from the Circle of Control list below" }
    // one object per factor in the Circle of Control list, focused on what nA can do right now — skip a factor only if nA already has a decisive lead on it
  ],
  "influence_actions": [
    { "action": "one short, plain-English, concrete action that builds this factor over the coming weeks/months", "why": "one short sentence tying it to a specific factor from the Circle of Influence list below" }
    // one object per factor in the Circle of Influence list
  ],
  "concern_notes": [
    { "factor": "factor name from the Circle of Concern list below", "note": "one short, plain sentence on how this factor could still affect the deal, with no actionable advice implied — these are largely outside nA's direct control" }
    // one object per factor in the Circle of Concern list
  ]
}

## Situation
- Our side (${nA}): Intuitive score ${feA}% → Calculated score ${sA}%
- Their side (${nB}): Intuitive score ${feB}% → Calculated score ${sB}%
- Power gap: ${diff} points ${leader ? `in favour of ${leader}` : '— balanced'}
${weakerParty ? `- Bias signal for ${nA}: ${biasDir}` : ''}

## Full factor breakdown (Critical > Strong > Medium > Low weight)
${factorLines}

## Circle of Control (short-term, directly actionable by nA)
${controlList}

## Circle of Influence (medium-term, can be built up over time)
${influenceList}

## Circle of Concern (long-term, largely outside nA's direct control)
${concernList}

## Top strengths for nA
${strengthsList}

Write in plain, simple English — short sentences, no jargon, no run-on explanations. Reference actual factor names throughout. Coach-like, direct, no hedging, no filler. Return ONLY the JSON object, nothing else.`;

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
        max_tokens: 2400,
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
