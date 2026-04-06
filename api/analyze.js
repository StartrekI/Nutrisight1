export const config = { runtime: 'edge', maxDuration: 60 };

const SYSTEM_PROMPT =
  'You are NutriSight, an AI food-label analyst for Indian consumers. ' +
  'Expertise: ingredient analysis, E-numbers, NOVA classification, WHO nutrition guidelines, USDA FoodData, Open Food Facts. ' +
  'CRITICAL: Your entire response must be ONLY the raw JSON object. No thinking, no explanation, no preamble, no markdown, no code fences, no text before or after the JSON. Start your response with { and end with }. ' +
  'Rules: Output ONLY minified JSON (zero whitespace) matching the schema below. No medical advice. Indian dietary context only. ' +
  'Suggest only real products sold in India; exact brand + product names. Never invent nutrition facts if visible in input. ' +
  'Flag OCR uncertainty in note fields. All text fields (r, note, w, notes): 12 words max. Max 3 items in alts; max 5 in factors; max 3 in refs. ' +
  'Enums: conf\u2192H/M/L \u00b7 nova.n\u2192integer 1-4. nutrition.rate: G=good O=ok B=bad \u00b7 assess each nutrient using WHO/USDA guidelines for the actual serving size shown. ' +
  'SCHEMA: {"ing":[{"n":string,"tags":["additive"|"allergen"|"oil"|"sugar"|"flavour"|"preservative"|"whole_food"|"salt"|"grain"|"dairy"|"meat"|"plant_oil"],"note":string}],' +
  '"nutrition":{"per":{"kcal":number,"fat":number,"sfat":number,"tfat":number,"carb":number,"sug":number,"pro":number,"na":number},' +
  '"rate":{"kcal":"G"|"O"|"B","fat":"G"|"O"|"B","sfat":"G"|"O"|"B","tfat":"G"|"O"|"B","carb":"G"|"O"|"B","sug":"G"|"O"|"B","pro":"G"|"O"|"B","na":"G"|"O"|"B"},' +
  '"conf":"H"|"M"|"L"},' +
  '"score":{"val":number,"factors":[{"f":string,"i":number,"r":string}],"notes":string},' +
  '"class":{"nova":{"n":1|2|3|4,"r":string},"nutri":{"g":"A"|"B"|"C"|"D"|"E","r":string}},' +
  '"concerns":[string],"avoid":[string],' +
  '"alts":[{"n":string,"b":string,"cat":string,"w":string,"score":string,"nova":1|2|3|4,"nutri":string}],' +
  '"refs":[{"src":string,"c":"H"|"M"|"L"}]}';

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const { text } = await req.json();

    if (!text) {
      return Response.json({ error: 'Missing text field' }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return Response.json({ error: 'Anthropic API key not configured' }, { status: 500 });
    }

    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        stream: true,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: `Country: India\n\n${text}` }],
      }),
    });

    if (!claudeResponse.ok) {
      const correlationId = crypto.randomUUID();
      const errBody = await claudeResponse.text();
      console.error(`[${correlationId}] Claude API error (${claudeResponse.status}):`, errBody);
      return Response.json(
        { error: 'Analysis service unavailable, please try again.', correlationId },
        { status: 502 }
      );
    }

    // Forward the SSE stream directly from Claude to the mobile app
    return new Response(claudeResponse.body, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (err) {
    const correlationId = crypto.randomUUID();
    console.error(`[${correlationId}] /api/analyze failed:`, err);
    return Response.json(
      { error: 'Request failed, please try again.', correlationId },
      { status: 500 }
    );
  }
}
