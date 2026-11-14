const allowed = new Set(['requestCode', 'verifyCode', 'logout', 'dashboard', 'download',
  'upload', 'submit', 'revise', 'review', 'settings', 'reviewer', 'createIssue', 'editIssue',
  'assign', 'decide', 'final', 'schedule', 'issueManifest', 'publish']);

function json(body, status = 200, extra = {}) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...extra } });
}

export default async function journal(request, context) {
  if (request.method !== 'POST') return json({ message: 'Use POST.' }, 405, { Allow: 'POST' });
  const url = new URL(request.url);
  if ((request.headers.get('origin') && request.headers.get('origin') !== url.origin) ||
      request.headers.get('sec-fetch-site') === 'cross-site') {
    return json({ message: 'Request denied.' }, 403);
  }
  if (!request.headers.get('content-type')?.startsWith('application/json')) {
    return json({ message: 'Send JSON.' }, 415);
  }
  const upstream = process.env.JOURNAL_SCRIPT_URL;
  const secret = process.env.JOURNAL_API_SECRET;
  if (!secret || secret.length < 32 || !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(upstream || '')) {
    return json({ code: 'SETUP', message: 'Connect the Google Apps Script deployment first.' }, 503);
  }

  let input;
  try {
    const raw = await request.text();
    if (raw.length > 5650000) return json({ message: 'Upload a PDF of up to 4 MiB.' }, 413);
    input = JSON.parse(raw);
    if (!input || !allowed.has(input.action) || !input.data || typeof input.data !== 'object' || Array.isArray(input.data)) {
      return json({ message: 'Invalid request.' }, 400);
    }
  } catch {
    return json({ message: 'Invalid JSON.' }, 400);
  }

  const token = request.headers.get('cookie')?.match(/(?:^|;\s*)__Host-journal=([a-f0-9]{64})(?:;|$)/)?.[1];
  try {
    const response = await fetch(upstream, {
      method: 'POST', redirect: 'follow', signal: AbortSignal.timeout(48000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, action: input.action, data: input.data, token, network: context?.ip })
    });
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
      return json({ message: 'Google Apps Script did not return journal data. Check deployment access and URL.' }, 502);
    }
    const result = await response.json();
    const headers = {};
    if (input.action === 'verifyCode' && result.ok) {
      const session = result.data.token;
      if (!/^[a-f0-9]{64}$/.test(session)) return json({ message: 'Invalid session response.' }, 502);
      headers['Set-Cookie'] = '__Host-journal=' + session + '; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=43200';
      delete result.data.token;
    }
    if (input.action === 'logout' || result.code === 'AUTH') {
      headers['Set-Cookie'] = '__Host-journal=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0';
    }
    const statuses = { AUTH: 401, FORBIDDEN: 403, NOT_FOUND: 404, RATE: 429, BUSY: 503, SETUP: 503, SERVER_ERROR: 502 };
    return json(result, result.ok ? 200 : statuses[result.code] || 400, headers);
  } catch {
    return json({ message: 'The Google Apps Script deployment is unavailable. Please retry.' }, 502);
  }
}
