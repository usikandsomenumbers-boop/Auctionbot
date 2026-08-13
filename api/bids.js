import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  // Allow requests from anywhere (needed for Telegram Mini App)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    if (req.method === 'GET') {
      const bids = await sql`
        SELECT user_id as "userId", username, amount, updated_at as "updatedAt"
        FROM bids
        ORDER BY amount DESC, updated_at ASC
      `;

      return res.status(200).json({
        bids,
        maxBid: bids.length ? bids[0].amount : 0,
        serverTime: Date.now()
      });
    }

    if (req.method === 'POST') {
      const { userId, username, amount } = req.body;

      if (!userId) {
        return res.status(400).json({ error: 'userId is required' });
      }

      const cleanAmount = Math.max(0, Math.floor(Number(amount) || 0));
      const cleanUsername = String(username || 'unknown').trim();

      // ===== Remove bid =====
      if (cleanAmount === 0) {
        await sql`DELETE FROM bids WHERE user_id = ${userId}`;
      } 
      // ===== Place / update bid =====
      else {
        // Only accept if higher than current maximum
        await sql`
          INSERT INTO bids (user_id, username, amount, updated_at)
          SELECT ${userId}, ${cleanUsername}, ${cleanAmount}, NOW()
          WHERE ${cleanAmount} > (SELECT COALESCE(MAX(amount), 0) FROM bids)
          ON CONFLICT (user_id) DO UPDATE
          SET 
            username = EXCLUDED.username,
            amount = EXCLUDED.amount,
            updated_at = NOW()
          WHERE EXCLUDED.amount > (SELECT COALESCE(MAX(amount), 0) FROM bids)
        `;
      }

      // Return the fresh list
      const bids = await sql`
        SELECT user_id as "userId", username, amount, updated_at as "updatedAt"
        FROM bids
        ORDER BY amount DESC, updated_at ASC
      `;

      return res.status(200).json({
        bids,
        maxBid: bids.length ? bids[0].amount : 0,
        serverTime: Date.now()
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
}