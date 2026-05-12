import crypto from 'node:crypto';

const cookieName = 'bili_cache_auth';
const defaultInviteCode = 'change-me';
const inviteCode = process.env.BILI_INVITE_CODE || defaultInviteCode;
const authSecret = process.env.BILI_AUTH_SECRET || crypto.createHash('sha256').update(inviteCode).digest('hex');
const maxAgeMs = Number(process.env.BILI_AUTH_MAX_AGE_MS || 7 * 24 * 60 * 60 * 1000);
const loginAttempts = new Map();
const loginWindowMs = 10 * 60 * 1000;
const maxLoginAttempts = 8;

export function warnIfAuthDefaults() {
  if (inviteCode === defaultInviteCode) {
    console.warn('[auth] BILI_INVITE_CODE is not set. Default invite code is "change-me". Set it before exposing this app.');
  }
}

export function loginPage(req, res) {
  const failed = req.query.failed === '1';
  res.type('html').send(`<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Bili Cache Watch 登录</title>
    <style>
      :root { color-scheme: light; font-family: Inter, "Microsoft YaHei", Arial, sans-serif; background: #f6f7f9; color: #18202a; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; }
      main { width: min(420px, 100%); background: #fff; border: 1px solid #dfe5ed; border-radius: 10px; padding: 24px; }
      h1 { margin: 0 0 8px; font-size: 28px; letter-spacing: 0; }
      p { margin: 0 0 18px; color: #617081; }
      form { display: grid; gap: 12px; }
      input { width: 100%; min-height: 44px; border: 1px solid #cfd7e2; border-radius: 8px; padding: 0 12px; font: inherit; }
      button { min-height: 44px; border: 1px solid #1f6feb; border-radius: 8px; background: #1f6feb; color: #fff; font-weight: 700; cursor: pointer; }
      .error { margin-bottom: 12px; padding: 10px 12px; border-radius: 8px; background: #ffe9e8; color: #b42318; }
      .note { margin-top: 14px; font-size: 13px; color: #718096; }
    </style>
  </head>
  <body>
    <main>
      <h1>Bili Cache Watch</h1>
      <p>请输入邀请码后查看缓存视频监控页面。</p>
      ${failed ? '<div class="error">邀请码不正确</div>' : ''}
      <form method="post" action="/login">
        <input name="inviteCode" type="password" placeholder="邀请码" autocomplete="current-password" autofocus required>
        <button type="submit">进入</button>
      </form>
      <div class="note">登录状态会保存在当前浏览器一段时间。</div>
    </main>
  </body>
</html>`);
}

export function handleLogin(req, res) {
  if (isRateLimited(req)) {
    res.status(429).type('html').send('尝试次数过多，请稍后再试。');
    return;
  }

  if (String(req.body.inviteCode || '') !== inviteCode) {
    recordFailedLogin(req);
    res.redirect('/login?failed=1');
    return;
  }

  clearFailedLogins(req);
  res.setHeader('Set-Cookie', serializeCookie(cookieName, createToken(), {
    httpOnly: true,
    sameSite: 'Lax',
    secure: isSecureRequest(req),
    maxAge: Math.floor(maxAgeMs / 1000),
    path: '/'
  }));
  res.redirect('/');
}

export function handleLogout(_req, res) {
  res.setHeader('Set-Cookie', serializeCookie(cookieName, '', {
    httpOnly: true,
    sameSite: 'Lax',
    maxAge: 0,
    path: '/'
  }));
  res.redirect('/login');
}

export function requireAuth(req, res, next) {
  if (verifyToken(readCookie(req, cookieName))) {
    next();
    return;
  }

  if (req.path.startsWith('/api/')) {
    res.status(401).json({ error: 'Login required' });
    return;
  }

  res.redirect('/login');
}

function createToken() {
  const expiresAt = Date.now() + maxAgeMs;
  const payload = Buffer.from(JSON.stringify({ expiresAt })).toString('base64url');
  const signature = sign(payload);
  return `${payload}.${signature}`;
}

function verifyToken(token) {
  if (!token || !token.includes('.')) {
    return false;
  }

  const [payload, signature] = token.split('.');
  if (!safeEqual(signature, sign(payload))) {
    return false;
  }

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return Number(data.expiresAt) > Date.now();
  } catch {
    return false;
  }
}

function sign(value) {
  return crypto.createHmac('sha256', authSecret).update(value).digest('base64url');
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function readCookie(req, name) {
  const cookies = String(req.headers.cookie || '').split(';');
  for (const cookie of cookies) {
    const [key, ...rest] = cookie.trim().split('=');
    if (key === name) {
      return decodeURIComponent(rest.join('='));
    }
  }
  return null;
}

function serializeCookie(name, value, options) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  return parts.join('; ');
}

function isSecureRequest(req) {
  return req.secure || req.headers['x-forwarded-proto'] === 'https';
}

function isRateLimited(req) {
  const attempts = activeAttempts(req);
  return attempts.length >= maxLoginAttempts;
}

function recordFailedLogin(req) {
  const ip = requestIp(req);
  loginAttempts.set(ip, [...activeAttempts(req), Date.now()]);
}

function clearFailedLogins(req) {
  loginAttempts.delete(requestIp(req));
}

function activeAttempts(req) {
  const now = Date.now();
  const ip = requestIp(req);
  const attempts = (loginAttempts.get(ip) || []).filter((time) => now - time < loginWindowMs);
  loginAttempts.set(ip, attempts);
  return attempts;
}

function requestIp(req) {
  return req.ip || req.socket.remoteAddress || 'unknown';
}
