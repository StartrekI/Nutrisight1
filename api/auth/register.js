import { getDb } from '../_db.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 });

  try {
    const { email, password, name } = await req.json();
    if (!email || !password || !name) return Response.json({ error: 'Missing fields' }, { status: 400 });

    const sql = getDb();

    // Check if user exists
    const existing = await sql`SELECT id FROM users WHERE email = ${email}`;
    if (existing.length > 0) return Response.json({ error: 'Email already registered' }, { status: 409 });

    const hash = btoa(password + ':nutrisight_salt_2024');

    const result = await sql`
      INSERT INTO users (email, password_hash, name) VALUES (${email}, ${hash}, ${name})
      RETURNING id, email, name, created_at
    `;

    // Create user_stats row
    await sql`INSERT INTO user_stats (user_id) VALUES (${result[0].id})`;

    return Response.json({ success: true, user: result[0] });
  } catch (e) {
    const correlationId = crypto.randomUUID();
    console.error(`[${correlationId}] /api/auth/register failed:`, e);
    return Response.json(
      { error: 'Request failed, please try again.', correlationId },
      { status: 500 }
    );
  }
}
