import { getDb } from '../_db.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 });

  try {
    const { email, password } = await req.json();
    if (!email || !password) return Response.json({ error: 'Missing fields' }, { status: 400 });

    const sql = getDb();
    const hash = btoa(password + ':nutrisight_salt_2024');

    const rows = await sql`SELECT id, email, name, created_at FROM users WHERE email = ${email} AND password_hash = ${hash}`;
    if (rows.length === 0) return Response.json({ error: 'Invalid email or password' }, { status: 401 });

    return Response.json({ success: true, user: rows[0] });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
