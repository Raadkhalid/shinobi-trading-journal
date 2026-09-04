const { SpotwareTransport, SpotwareHost, SpotwareSocketAuthenticator } = require('ctrader-x');
const { exchangeCodeForToken } = require('./_ctraderToken');
const { supabaseAdmin } = require('./_supabaseAdmin');

const SITE_URL = process.env.URL || 'https://shinobitradingjournal.com';
const REDIRECT_URI = `${SITE_URL}/.netlify/functions/ctrader-callback`;

function redirect(path) {
  return { statusCode: 302, headers: { Location: `${SITE_URL}${path}` }, body: '' };
}

exports.handler = async (event) => {
  const { code, state, error } = event.queryStringParameters || {};

  if (error) return redirect(`/?ctrader=denied`);
  if (!code || !state || !/^[0-9a-f-]{36}$/i.test(state)) return redirect(`/?ctrader=error`);

  const userId = state;

  try {
    const token = await exchangeCodeForToken({ code, redirectUri: REDIRECT_URI });

    // Briefly connect over the Protobuf/TCP transport just to discover which
    // trading account this access token grants access to (v1 assumes a live
    // account - demo-account support would need trying SpotwareHost.DEMO too).
    const transport = new SpotwareTransport({ host: SpotwareHost.LIVE });
    await transport.connect();
    const authenticator = new SpotwareSocketAuthenticator(transport);
    await authenticator.authenticateApplication(
      process.env.CTRADER_CLIENT_ID,
      process.env.CTRADER_CLIENT_SECRET
    );
    const accounts = await authenticator.listAccounts(token.accessToken);
    await transport.disconnect?.();

    if (!accounts || accounts.length === 0) {
      return redirect(`/?ctrader=no-accounts`);
    }
    const ctidTraderAccountId = String(accounts[0].ctidTraderAccountId);

    const expiresAt = new Date(Date.now() + token.expiresIn * 1000).toISOString();

    const { error: dbError } = await supabaseAdmin
      .from('broker_connections')
      .upsert(
        {
          user_id: userId,
          broker: 'ctrader',
          ctid_trader_account_id: ctidTraderAccountId,
          access_token: token.accessToken,
          refresh_token: token.refreshToken,
          token_type: token.tokenType || 'bearer',
          expires_at: expiresAt,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,broker' }
      );

    if (dbError) {
      console.error('Failed to store cTrader connection:', dbError);
      return redirect(`/?ctrader=error`);
    }

    return redirect(`/?ctrader=connected`);
  } catch (err) {
    console.error('cTrader OAuth callback failed:', err);
    return redirect(`/?ctrader=error`);
  }
};
