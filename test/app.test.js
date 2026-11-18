// Run with: npm test   (uses Node's built-in test runner, no installs)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createApp } = require('../server');
const { renderMarkdown } = require('../lib/markdown');
const { toEmbed } = require('../lib/markdown');

function startServer() {
  const dataFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rlreps-')), 'db.json');
  const { server } = createApp({ dataFile });
  return new Promise((resolve) => server.listen(0, () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` })));
}

function client(base) {
  let cookie = '';
  return async (method, p, body) => {
    const res = await fetch(base + p, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json().catch(() => null) };
  };
}

test('markdown escapes HTML and renders basics', () => {
  const html = renderMarkdown('# Hi\n\n<script>alert(1)</script> **bold** [x](javascript:alert(1))\n\n- a\n- b');
  assert.match(html, /<h2>Hi<\/h2>/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /href="javascript/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<ul><li>a<\/li><li>b<\/li><\/ul>/);
});

test('images and clips render as figures', () => {
  const html = renderMarkdown('![A <b>clip</b>](media/x-clip.svg)\n\n![Pic](media/y.png)\n\n![Vid](media/z.mp4)', {
    resolveMedia: (p) => `/media/c/${p}`,
  });
  assert.match(html, /<figure class="media clip"><img src="\/media\/c\/media\/x-clip.svg" alt="A &lt;b&gt;clip&lt;\/b&gt;"/);
  assert.match(html, /<figure class="media"><img src="\/media\/c\/media\/y.png"/);
  assert.match(html, /<video src="\/media\/c\/media\/z.mp4" autoplay muted loop/);
  assert.doesNotMatch(html, /<b>/);
});

test('every sample lesson has visuals and they all load', async () => {
  const { server, base } = await startServer();
  try {
    const call = client(base);
    const { body } = await call('GET', '/api/courses');
    for (const c of body.courses) {
      const course = (await call('GET', `/api/courses/${c.id}`)).body;
      for (const u of course.units) {
        const srcs = [...u.html.matchAll(/<img src="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
        assert.ok(srcs.length > 0, `${c.id}/${u.id} has no pictures or clips`);
        if (u.type === 'drill') {
          assert.match(u.html, /youtube-nocookie\.com\/embed\//, `${c.id}/${u.id} has no real gameplay video`);
          assert.ok(srcs.some((src) => src.includes('-inputs-clip.svg')), `${c.id}/${u.id} has no stick/button clip`);
        }
        for (const src of srcs) {
          const res = await fetch(base + src);
          assert.equal(res.status, 200, src);
          assert.equal(res.headers.get('content-type'), 'image/svg+xml', src);
          await res.arrayBuffer();
        }
      }
    }
    // Media can't escape its course folder or serve non-media files.
    assert.equal((await fetch(`${base}/media/aerial-foundations/course.json`)).status, 404);
    assert.equal((await fetch(`${base}/media/aerial-foundations/..%2f..%2fserver.js`)).status, 404);
    assert.equal((await fetch(`${base}/media/nope/media/x.svg`)).status, 404);
  } finally {
    server.close();
  }
});

test('video links become embeds', () => {
  assert.equal(toEmbed('https://www.youtube.com/watch?v=dQw4w9WgXcQ').src, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  assert.equal(toEmbed('https://vimeo.com/12345').src, 'https://player.vimeo.com/video/12345');
  assert.equal(toEmbed('https://example.com/clip.mp4').kind, 'file');
  assert.equal(toEmbed('not a url'), null);
  assert.equal(toEmbed('https://www.youtube.com/watch?v=KOMQSgjLJ7k&t=56').src, 'https://www.youtube-nocookie.com/embed/KOMQSgjLJ7k?start=56');
  assert.equal(toEmbed('https://youtu.be/dQw4w9WgXcQ?t=1m30s').src, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=90');
});

test('YouTube links on their own line become embedded players', () => {
  const html = renderMarkdown('![Real gameplay: half-flip](https://www.youtube.com/watch?v=XZIkmuheKe8)');
  assert.match(html, /<figure class="media embed"><div class="video"><iframe src="https:\/\/www.youtube-nocookie.com\/embed\/XZIkmuheKe8"/);
  assert.match(html, /Real gameplay · YouTube/);
});

test('full repetition loop: register → browse → complete → resume', async () => {
  const { server, base } = await startServer();
  const call = client(base);
  try {
    let r = await call('GET', '/api/me');
    assert.equal(r.body.user, null);

    r = await call('POST', '/api/register', { username: 'x', password: 'short' });
    assert.equal(r.status, 400);

    r = await call('POST', '/api/register', { username: 'blain', password: 'password123' });
    assert.equal(r.status, 201);

    r = await call('POST', '/api/register', { username: 'BLAIN', password: 'password123' });
    assert.equal(r.status, 409, 'usernames are case-insensitive');

    r = await call('GET', '/api/courses');
    assert.ok(r.body.courses.length >= 1);
    const course = r.body.courses[0];
    assert.equal(course.completedCount, 0);

    r = await call('GET', `/api/courses/${course.id}`);
    const [u1, u2] = r.body.units;
    assert.ok(u1.html.length > 0);

    r = await call('POST', '/api/progress', { courseId: course.id, unitId: 'nope' });
    assert.equal(r.status, 404);

    r = await call('POST', '/api/progress', { courseId: course.id, unitId: u1.id, completed: true });
    assert.equal(r.body.completedCount, 1);
    assert.equal(r.body.streak.days, 1);
    assert.equal(r.body.streak.practicedToday, true);

    r = await call('GET', '/api/me');
    assert.equal(r.body.resume.courseId, course.id);
    assert.equal(r.body.resume.nextUnitId, u2.id, 'resume points at the next unfinished unit');

    // Log out and back in: progress persists.
    await call('POST', '/api/logout');
    r = await call('GET', '/api/me');
    assert.equal(r.body.user, null);
    r = await call('POST', '/api/progress', { courseId: course.id, unitId: u2.id });
    assert.equal(r.status, 401);

    r = await call('POST', '/api/login', { username: 'blain', password: 'wrong-password' });
    assert.equal(r.status, 401);
    r = await call('POST', '/api/login', { username: 'Blain', password: 'password123' });
    assert.equal(r.status, 200);
    r = await call('GET', `/api/courses/${course.id}`);
    assert.ok(r.body.units[0].completedAt);
    assert.equal(r.body.units[1].completedAt, null);

    // Undo completion.
    r = await call('POST', '/api/progress', { courseId: course.id, unitId: u1.id, completed: false });
    assert.equal(r.body.completedCount, 0);
  } finally {
    server.close();
  }
});

test('static files are served and path traversal is blocked', async () => {
  const { server, base } = await startServer();
  try {
    let res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /RL Reps/);
    res = await fetch(`${base}/..%2fserver.js`);
    assert.notEqual((await res.text()).includes('createApp'), true);
  } finally {
    server.close();
  }
});
