import { getDb } from '../_db.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 });

  try {
    const { userId, result } = await req.json();
    if (!userId || !result) return Response.json({ error: 'Missing fields' }, { status: 400 });

    const sql = getDb();
    const d = result;

    // Extract only needed fields from the scan result
    const healthScore = Math.round(d.score?.val ?? 0);
    const novaClass = d.class?.nova?.n ?? null;
    const nutriGrade = d.class?.nutri?.g ?? null;
    const per = d.nutrition?.per ?? {};
    const topConcern = (d.concerns ?? [])[0] ?? null;
    const topConcern2 = (d.concerns ?? [])[1] ?? null;
    const productName = (d.ing ?? [])[0]?.n ?? 'Unknown';

    // Save scan summary with top 2 concerns
    await sql`
      INSERT INTO scan_summaries (user_id, health_score, nova_class, nutri_grade, calories, protein, carbs, fat, sodium, sugar, sat_fat, trans_fat, top_concern, top_concern_2, product_name)
      VALUES (${userId}, ${healthScore}, ${novaClass}, ${nutriGrade}, ${per.kcal??0}, ${per.pro??0}, ${per.carb??0}, ${per.fat??0}, ${per.na??0}, ${per.sug??0}, ${per.sfat??0}, ${per.tfat??0}, ${topConcern}, ${topConcern2}, ${productName})
    `;

    // Save alternatives as recommendations — run up to 3 inserts concurrently
    // (fixes the prior N+1 sequential pattern; still ON CONFLICT DO NOTHING)
    await Promise.all((d.alts ?? []).slice(0, 3).map(alt =>
      sql`INSERT INTO recommendations (user_id, name, brand, score, nova, nutri, category) VALUES (${userId}, ${alt.n}, ${alt.b}, ${parseInt(alt.score)||0}, ${alt.nova}, ${alt.nutri}, ${alt.cat}) ON CONFLICT DO NOTHING`
    ));

    // Update user_stats
    const today = new Date().toISOString().split('T')[0];
    const stats = await sql`SELECT * FROM user_stats WHERE user_id = ${userId}`;

    if (stats.length > 0) {
      const st = stats[0];
      const lastDate = st.last_scan_date ? new Date(st.last_scan_date).toISOString().split('T')[0] : null;
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

      let newStreak = st.current_streak;
      if (lastDate === yesterday) newStreak = st.current_streak + 1;
      else if (lastDate !== today) newStreak = 1;

      const newBest = Math.max(st.best_streak, newStreak);
      const newGoals = healthScore >= 70 ? st.goals_met + 1 : st.goals_met;
      const newTopPicks = healthScore >= 80 ? st.top_picks_count + 1 : st.top_picks_count;

      await sql`
        UPDATE user_stats SET
          total_scans = total_scans + 1,
          current_streak = ${newStreak},
          best_streak = ${newBest},
          goals_met = ${newGoals},
          top_picks_count = ${newTopPicks},
          last_scan_date = ${today}
        WHERE user_id = ${userId}
      `;
    }

    return Response.json({ success: true });
  } catch (e) {
    const correlationId = crypto.randomUUID();
    console.error(`[${correlationId}] /api/scan/save failed:`, e);
    return Response.json(
      { error: 'Request failed, please try again.', correlationId },
      { status: 500 }
    );
  }
}
