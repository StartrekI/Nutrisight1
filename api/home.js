import { getDb } from './_db.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'GET') return Response.json({ error: 'Method not allowed' }, { status: 405 });

  try {
    const url = new URL(req.url);
    const userId = url.searchParams.get('userId');
    if (!userId) return Response.json({ error: 'Missing userId' }, { status: 400 });

    const sql = getDb();

    // User info
    const userRows = await sql`SELECT id, name, email, created_at FROM users WHERE id = ${userId}`;
    if (userRows.length === 0) return Response.json({ error: 'User not found' }, { status: 404 });
    const user = userRows[0];

    // Stats
    const statsRows = await sql`SELECT * FROM user_stats WHERE user_id = ${userId}`;
    const stats = statsRows[0] || { total_scans: 0, current_streak: 0, best_streak: 0, goals_met: 0, top_picks_count: 0 };

    // Weekly score — avg health_score from last 7 days
    const weeklyRows = await sql`
      SELECT COALESCE(AVG(health_score), 0) as avg_score, COUNT(*) as scan_count
      FROM scan_summaries WHERE user_id = ${userId} AND scanned_at > NOW() - INTERVAL '7 days'
    `;
    const weeklyScore = Math.round(weeklyRows[0].avg_score);
    const weeklyTotalScans = parseInt(weeklyRows[0].scan_count);

    // Today's nutrition — sum ALL 8 nutrients from today's scans
    const todayRows = await sql`
      SELECT COALESCE(SUM(calories),0) as cal, COALESCE(SUM(protein),0) as pro, COALESCE(SUM(carbs),0) as carbs,
             COALESCE(SUM(fat),0) as fat, COALESCE(SUM(sodium),0) as na, COALESCE(SUM(sugar),0) as sug,
             COALESCE(SUM(sat_fat),0) as sfat, COALESCE(SUM(trans_fat),0) as tfat, COUNT(*) as cnt
      FROM scan_summaries WHERE user_id = ${userId} AND scanned_at::date = CURRENT_DATE
    `;
    const today = todayRows[0];

    // Weekly scan activity — count per day of week (last 7 days)
    const activityRows = await sql`
      SELECT EXTRACT(DOW FROM scanned_at) as dow, COUNT(*) as cnt
      FROM scan_summaries WHERE user_id = ${userId} AND scanned_at > NOW() - INTERVAL '7 days'
      GROUP BY dow ORDER BY dow
    `;
    const weekActivity = [0, 0, 0, 0, 0, 0, 0]; // Sun=0 ... Sat=6
    for (const r of activityRows) weekActivity[parseInt(r.dow)] = parseInt(r.cnt);
    // Reorder to Mon-Sun
    const monSun = [...weekActivity.slice(1), weekActivity[0]];

    // Health insights — aggregated distinct concerns with counts
    const concernRows = await sql`
      SELECT concern, COUNT(*) as cnt FROM (
        SELECT top_concern as concern FROM scan_summaries WHERE user_id = ${userId} AND top_concern IS NOT NULL
        UNION ALL
        SELECT top_concern_2 as concern FROM scan_summaries WHERE user_id = ${userId} AND top_concern_2 IS NOT NULL
      ) sub GROUP BY concern ORDER BY cnt DESC
    `;
    const allConcerns = concernRows.map(r => ({ text: r.concern, count: parseInt(r.cnt) }));
    // Top 2 for default display, all for "show all"
    const topConcerns = allConcerns.slice(0, 2);
    const totalConcernCount = allConcerns.length;

    // Recommended products — from alternatives saved
    const recs = await sql`
      SELECT DISTINCT ON (name) name, brand, score, nova, nutri, category
      FROM recommendations WHERE user_id = ${userId} ORDER BY name, score DESC LIMIT 6
    `;

    // Greeting
    const hour = new Date().getUTCHours() + 5.5; // IST
    const greeting = hour < 12 ? 'Good Morning' : hour < 17 ? 'Good Afternoon' : 'Good Evening';

    return Response.json({
      success: true,
      greeting,
      user: { name: user.name, email: user.email },
      weeklyScore,
      weeklyMessage: weeklyScore >= 70 ? "Great progress! You're eating healthier this week." : weeklyScore >= 40 ? "Moderate progress. Try scanning more healthy options." : "Let's improve! Scan healthier products this week.",
      todayNutrition: {
        calories: Math.round(today.cal),
        protein: Math.round(today.pro),
        carbs: Math.round(today.carbs),
        fat: Math.round(today.fat),
        sodium: Math.round(today.na),
        sugar: Math.round(today.sug),
        satFat: parseFloat(today.sfat).toFixed(1),
        transFat: parseFloat(today.tfat).toFixed(1),
        scansToday: parseInt(today.cnt),
      },
      streak: stats.current_streak,
      totalScans: stats.total_scans,
      topPicks: stats.top_picks_count,
      goalsMet: stats.goals_met,
      topConcerns,
      allConcerns,
      totalConcernCount,
      recommendations: recs,
      weekActivity: monSun,
      weekTotalScans: weeklyTotalScans,
    });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
