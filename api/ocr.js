export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  if (req.method !== 'POST') {
    return Response.json({ success: false, error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const { image } = await req.json();

    if (!image) {
      return Response.json({ success: false, error: 'Missing image field' }, { status: 400 });
    }

    const gcvKey = process.env.GCV_API_KEY;
    if (!gcvKey) {
      return Response.json({ success: false, error: 'GCV API key not configured' }, { status: 500 });
    }

    const gcvResponse = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${gcvKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [
            {
              image: { content: image },
              features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
            },
          ],
        }),
      }
    );

    if (!gcvResponse.ok) {
      const correlationId = crypto.randomUUID();
      const errBody = await gcvResponse.text();
      console.error(`[${correlationId}] Vision API error (${gcvResponse.status}):`, errBody);
      return Response.json(
        { success: false, error: 'OCR service unavailable, please try again.', correlationId },
        { status: 502 }
      );
    }

    const data = await gcvResponse.json();
    const firstResponse = data.responses?.[0];

    if (firstResponse?.error) {
      const correlationId = crypto.randomUUID();
      console.error(`[${correlationId}] Vision API returned error:`, firstResponse.error);
      return Response.json(
        { success: false, error: 'OCR service unavailable, please try again.', correlationId },
        { status: 502 }
      );
    }

    const text = firstResponse?.fullTextAnnotation?.text || '';
    const wordCount = text.trim().split(/\s+/).filter(Boolean).length;

    if (!text || wordCount < 20) {
      return Response.json(
        {
          success: false,
          error:
            'Could not read enough text. Please retake the photo in better lighting and hold the camera steady.',
        },
        { status: 422 }
      );
    }

    return Response.json({ success: true, text, wordCount });
  } catch (err) {
    const correlationId = crypto.randomUUID();
    console.error(`[${correlationId}] /api/ocr failed:`, err);
    return Response.json(
      { success: false, error: 'Request failed, please try again.', correlationId },
      { status: 500 }
    );
  }
}
