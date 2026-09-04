const { supabaseAdmin, getUserIdFromRequest } = require('./_supabaseAdmin');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const userId = await getUserIdFromRequest(event);
  if (!userId) return { statusCode: 401, body: JSON.stringify({ error: 'Not authenticated' }) };

  const { error } = await supabaseAdmin
    .from('broker_connections')
    .delete()
    .eq('user_id', userId)
    .eq('broker', 'ctrader');

  if (error) {
    console.error('ctrader-disconnect error:', error);
    return { statusCode: 500, body: JSON.stringify({ error: 'Disconnect failed' }) };
  }

  return { statusCode: 200, body: JSON.stringify({ success: true }) };
};
