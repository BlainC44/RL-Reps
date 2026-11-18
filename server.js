// RL Reps — a minimal LMS for deliberate practice in video games.
// Zero dependencies: Node.js built-ins only. Run with `node server.js`.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { loadCourses } = require('./lib/courses');
const { Store } = require('./lib/store');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const COURSES_DIR = process.env.COURSES_DIR || path.join(ROOT, 'courses');
const DATA_FILE = process.env.DATA_FILE || path.join(ROOT, 'data', 'db.json');
const SESSION_DAYS = 30;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function createApp({ coursesDir = COURSES_DIR, dataFile = DATA_FILE } = {}) {
  const courses = loadCourses(coursesDir);
  const store = new Store(dataFile);

  // ---------- helpers ----------
  function send(res, status, body, headers = {}) {
    const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
    res.writeHead(status, {
      'Content-Type': isJson ? MIME['.json'] : headers['Content-Type'] || 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    });
    res.end(isJson ? JSON.stringify(body) : body);
  }

  function readJson(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > 64 * 1024) {
          reject(Object.assign(new Error('Request body too large'), { status: 413 }));
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => {
        if (!chunks.length) return resolve({});
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          reject(Object.assign(new Error('Invalid JSON'), { status: 400 }));
        }
      });
      req.on('error', reject);
    });
  }

  function parseCookies(req) {
    const out = {};
    for (const part of (req.headers.cookie || '').split(';')) {
      const i = part.indexOf('=');
      if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    }
    return out;
  }

  function sessionCookie(token, maxAgeSeconds) {
    return `rlreps_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`;
  }

  function currentUser(req) {
    const token = parseCookies(req).rlreps_session;
    return token ? store.userForSession(token) : null;
  }

  function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return { salt, hash };
  }

  function verifyPassword(password, salt, hash) {
    const candidate = crypto.scryptSync(password, salt, 64);
    const stored = Buffer.from(hash, 'hex');
    return stored.length === candidate.length && crypto.timingSafeEqual(stored, candidate);
  }

  function startSession(res, username, status, body) {
    const token = crypto.randomBytes(32).toString('hex');
    store.createSession(token, username, SESSION_DAYS);
    send(res, status, body, { 'Set-Cookie': sessionCookie(token, SESSION_DAYS * 86400) });
  }

  function courseSummary(course, username) {
    const done = username ? store.completedUnits(username, course.id) : {};
    const completed = course.units.filter((u) => done[u.id]).length;
    return {
      id: course.id,
      title: course.title,
      game: course.game,
      summary: course.summary,
      level: course.level,
      estimatedMinutes: course.estimatedMinutes,
      unitCount: course.units.length,
      completedCount: completed,
    };
  }

  // ---------- API ----------
  async function handleApi(req, res, url) {
    const user = currentUser(req);
    const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
    const route = `${req.method} /${parts.slice(1).join('/')}`;

    if (route === 'POST /register') {
      const { username, password } = await readJson(req);
      const name = String(username || '').trim();
      if (!/^[a-zA-Z0-9_-]{3,24}$/.test(name)) {
        return send(res, 400, { error: 'Username must be 3–24 letters, numbers, _ or -.' });
      }
      if (typeof password !== 'string' || password.length < 8) {
        return send(res, 400, { error: 'Password must be at least 8 characters.' });
      }
      if (store.getUser(name)) return send(res, 409, { error: 'That username is taken.' });
      store.createUser(name, hashPassword(password));
      return startSession(res, name, 201, { username: name });
    }

    if (route === 'POST /login') {
      const { username, password } = await readJson(req);
      const name = String(username || '').trim();
      const record = store.getUser(name);
      if (!record || typeof password !== 'string' || !verifyPassword(password, record.salt, record.hash)) {
        return send(res, 401, { error: 'Wrong username or password.' });
      }
      return startSession(res, record.username, 200, { username: record.username });
    }

    if (route === 'POST /logout') {
      const token = parseCookies(req).rlreps_session;
      if (token) store.deleteSession(token);
      return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
    }

    if (route === 'GET /me') {
      if (!user) return send(res, 200, { user: null });
      return send(res, 200, {
        user: { username: user },
        streak: store.streak(user),
        resume: store.lastActivity(user, courses),
      });
    }

    if (route === 'GET /courses') {
      return send(res, 200, { courses: courses.list.map((c) => courseSummary(c, user)) });
    }

    if (req.method === 'GET' && parts[1] === 'courses' && parts.length === 3) {
      const course = courses.byId[parts[2]];
      if (!course) return send(res, 404, { error: 'Course not found.' });
      const done = user ? store.completedUnits(user, course.id) : {};
      return send(res, 200, {
        ...courseSummary(course, user),
        description: course.description,
        units: course.units.map((u) => ({ ...u, completedAt: done[u.id] || null })),
      });
    }

    if (route === 'POST /progress') {
      if (!user) return send(res, 401, { error: 'Log in to save progress.' });
      const { courseId, unitId, completed } = await readJson(req);
      const course = courses.byId[courseId];
      if (!course || !course.units.some((u) => u.id === unitId)) {
        return send(res, 404, { error: 'Unknown course or unit.' });
      }
      store.setProgress(user, courseId, unitId, completed !== false);
      return send(res, 200, {
        completedCount: Object.keys(store.completedUnits(user, courseId)).length,
        streak: store.streak(user),
      });
    }

    return send(res, 404, { error: 'Not found.' });
  }

  // ---------- static files ----------
  function serveStatic(req, res, url) {
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/index.html';
    const file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden');
    fs.readFile(file, (err, data) => {
      if (err) {
        // Single-page app: unknown paths fall back to index.html
        return fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, html) =>
          e2 ? send(res, 404, 'Not found') : send(res, 200, html, { 'Content-Type': MIME['.html'] }),
        );
      }
      send(res, 200, data, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    });
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
      return serveStatic(req, res, url);
    } catch (err) {
      const status = err.status || 500;
      if (status === 500) console.error(err);
      if (!res.headersSent) send(res, status, { error: status === 500 ? 'Server error.' : err.message });
    }
  });

  return { server, store, courses };
}

if (require.main === module) {
  const { server, courses } = createApp();
  server.listen(PORT, () => {
    console.log(`RL Reps running at http://localhost:${PORT}`);
    console.log(`Loaded ${courses.list.length} course(s) from ${path.relative(ROOT, COURSES_DIR) || '.'}/`);
  });
}

module.exports = { createApp };
