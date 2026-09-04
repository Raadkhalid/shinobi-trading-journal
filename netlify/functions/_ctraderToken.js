// Plain HTTPS token exchange/refresh - this part of the cTrader Open API is
// regular REST, unlike the deal-history fetch which needs a Protobuf/TCP
// connection (handled separately by ctrader-x in the scheduled sync function).
const TOKEN_URL = 'https://openapi.ctrader.com/apps/token';

async function requestToken(params) {
  const url = new URL(TOKEN_URL);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString());
  const body = await res.json();
  if (!res.ok || body.errorCode) {
    throw new Error(`cTrader token request failed: ${JSON.stringify(body)}`);
  }
  return body; // { accessToken, refreshToken, expiresIn, tokenType }
}

function exchangeCodeForToken({ code, redirectUri }) {
  return requestToken({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: process.env.CTRADER_CLIENT_ID,
    client_secret: process.env.CTRADER_CLIENT_SECRET,
  });
}

function refreshAccessToken(refreshToken) {
  return requestToken({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: process.env.CTRADER_CLIENT_ID,
    client_secret: process.env.CTRADER_CLIENT_SECRET,
  });
}

module.exports = { exchangeCodeForToken, refreshAccessToken };
