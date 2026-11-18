// RL Reps front end — a tiny hash-routed single-page app, no framework.
// Routes:  #/  ·  #/login  ·  #/register  ·  #/course/:id  ·  #/course/:id/:unitId

const app = document.getElementById('app');
const nav = document.getElementById('nav');
let me = { user: null }; // from GET /api/me

// ---------- utilities ----------
async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// h('div', {class: 'x', onclick: fn}, child, 'text', ...) — builds DOM safely.
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v; // only used for server-rendered course Markdown
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
  return el;
}

function render(...nodes) {
  app.replaceChildren(...nodes);
  window.scrollTo(0, 0);
}

function progressBar(done, total) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return h('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100 },
    h('div', { class: 'progress-fill', style: `width:${pct}%` }));
}

const TYPE_LABEL = { text: 'Lesson', video: 'Video', drill: 'Drill' };

function errorView(err) {
  render(h('div', { class: 'empty' }, h('h1', {}, 'Something went wrong'), h('p', {}, err.message), h('a', { href: '#/', class: 'btn' }, 'Back to courses')));
}

// ---------- nav ----------
async function refreshMe() {
  me = await api('/me');
  nav.replaceChildren(
    // filter(Boolean): replaceChildren() would render a null entry as the text "null"
    ...(me.user
      ? [
          me.streak && me.streak.days > 0
            ? h('span', { class: 'streak', title: 'Days in a row with at least one completed unit' }, `🔥 ${me.streak.days}-day streak`)
            : null,
          h('span', { class: 'who' }, me.user.username),
          h('button', { class: 'btn ghost small', onclick: logout }, 'Log out'),
        ]
      : [h('a', { href: '#/login', class: 'btn ghost small' }, 'Log in'), h('a', { href: '#/register', class: 'btn small' }, 'Sign up')]
    ).filter(Boolean),
  );
}

async function logout() {
  await api('/logout', { method: 'POST' });
  await refreshMe();
  location.hash = '#/';
}

// ---------- views ----------
async function catalogView() {
  const { courses } = await api('/courses');
  const nodes = [];

  if (me.user && me.resume && !me.resume.finished) {
    nodes.push(
      h('section', { class: 'resume' },
        h('div', {},
          h('p', { class: 'eyebrow' }, me.streak.practicedToday ? 'Nice work today — keep going' : 'Today’s reps'),
          h('h2', {}, me.resume.courseTitle),
          h('p', { class: 'muted' }, `Next up: ${me.resume.nextUnitTitle}`)),
        h('a', { class: 'btn big', href: `#/course/${me.resume.courseId}/${me.resume.nextUnitId}` }, 'Continue')),
    );
  } else if (!me.user) {
    nodes.push(
      h('section', { class: 'hero' },
        h('h1', {}, 'Get your reps in.'),
        h('p', { class: 'lead' }, 'Short, structured courses for deliberate practice. Pick a course, run the drills, and pick up where you left off tomorrow.'),
        h('a', { class: 'btn big', href: '#/register' }, 'Create a free account')),
    );
  }

  nodes.push(h('h2', { class: 'section-title' }, 'Courses'));
  if (!courses.length) {
    nodes.push(h('p', { class: 'muted' }, 'No courses yet. Add one under courses/ — see the README.'));
  }
  nodes.push(
    h('div', { class: 'grid' },
      courses.map((c) =>
        h('a', { class: 'card', href: `#/course/${c.id}` },
          h('div', { class: 'card-meta' },
            c.game ? h('span', { class: 'tag' }, c.game) : null,
            c.level ? h('span', { class: 'tag subtle' }, c.level) : null),
          h('h3', {}, c.title),
          h('p', { class: 'muted' }, c.summary),
          h('div', { class: 'card-foot' },
            h('span', {}, `${c.unitCount} units${c.estimatedMinutes ? ` · ~${c.estimatedMinutes} min` : ''}`),
            me.user ? h('span', {}, c.completedCount === c.unitCount ? '✓ Done' : `${c.completedCount}/${c.unitCount}`) : null),
          me.user ? progressBar(c.completedCount, c.unitCount) : null),
      )),
  );
  render(...nodes);
}

function authView(mode) {
  const isLogin = mode === 'login';
  const error = h('p', { class: 'error', role: 'alert' });
  const form = h('form', { class: 'auth', onsubmit: async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    error.textContent = '';
    try {
      await api(isLogin ? '/login' : '/register', { method: 'POST', body: { username: fd.get('username'), password: fd.get('password') } });
      await refreshMe();
      const back = sessionStorage.getItem('rlreps_after_login');
      sessionStorage.removeItem('rlreps_after_login');
      location.hash = back || '#/';
    } catch (err) {
      error.textContent = err.message;
    }
  } },
    h('h1', {}, isLogin ? 'Log in' : 'Create your account'),
    h('label', {}, 'Username', h('input', { name: 'username', autocomplete: 'username', required: true, minlength: 3, maxlength: 24, pattern: '[A-Za-z0-9_\\-]+' })),
    h('label', {}, 'Password', h('input', { name: 'password', type: 'password', autocomplete: isLogin ? 'current-password' : 'new-password', required: true, minlength: isLogin ? null : 8 })),
    error,
    h('button', { class: 'btn big', type: 'submit' }, isLogin ? 'Log in' : 'Sign up'),
    h('p', { class: 'muted' }, isLogin ? 'New here? ' : 'Already have an account? ',
      h('a', { href: isLogin ? '#/register' : '#/login' }, isLogin ? 'Create an account' : 'Log in')),
  );
  render(form);
  form.querySelector('input').focus();
}

async function courseView(id) {
  const c = await api(`/courses/${encodeURIComponent(id)}`);
  const next = c.units.find((u) => !u.completedAt) || c.units[0];
  const started = c.completedCount > 0;
  const finished = c.completedCount === c.unitCount;

  render(
    h('a', { href: '#/', class: 'back' }, '← All courses'),
    h('section', { class: 'course-head' },
      h('div', { class: 'card-meta' },
        c.game ? h('span', { class: 'tag' }, c.game) : null,
        c.level ? h('span', { class: 'tag subtle' }, c.level) : null),
      h('h1', {}, c.title),
      h('p', { class: 'lead' }, c.summary),
      c.description ? h('div', { class: 'prose', html: c.description }) : null,
      me.user ? h('div', { class: 'course-progress' }, progressBar(c.completedCount, c.unitCount), h('span', { class: 'muted' }, `${c.completedCount} of ${c.unitCount} complete`)) : null,
      h('a', { class: 'btn big', href: `#/course/${c.id}/${next.id}` }, finished ? 'Run it again' : started ? 'Continue' : 'Start course'),
      !me.user ? h('p', { class: 'muted small' }, h('a', { href: '#/login', onclick: () => sessionStorage.setItem('rlreps_after_login', location.hash) }, 'Log in'), ' to save your progress.') : null,
    ),
    h('ol', { class: 'unit-list' },
      c.units.map((u) =>
        h('li', { class: u.completedAt ? 'done' : '' },
          h('a', { href: `#/course/${c.id}/${u.id}` },
            h('span', { class: 'check', 'aria-label': u.completedAt ? 'Completed' : 'Not completed' }, u.completedAt ? '✓' : ''),
            h('span', { class: 'unit-title' }, u.title),
            h('span', { class: 'tag subtle' }, TYPE_LABEL[u.type]),
            u.reps ? h('span', { class: 'muted small' }, `${u.reps} reps`) : null)),
      )),
  );
}

async function unitView(courseId, unitId) {
  const c = await api(`/courses/${encodeURIComponent(courseId)}`);
  const index = c.units.findIndex((u) => u.id === unitId);
  if (index === -1) throw new Error('That unit doesn’t exist.');
  const u = c.units[index];
  const prev = c.units[index - 1];
  const next = c.units[index + 1];
  const status = h('p', { class: 'muted small', role: 'status' });

  // Drill rep counter (in-page only; completion is what gets saved).
  let reps = 0;
  const repCount = h('span', { class: 'rep-count' }, '0');
  const repBox = u.type === 'drill'
    ? h('div', { class: 'reps' },
        h('div', {},
          h('p', { class: 'eyebrow' }, 'Rep counter'),
          h('p', {}, repCount, u.reps ? h('span', { class: 'muted' }, ` / ${u.reps}`) : null)),
        h('div', { class: 'rep-buttons' },
          h('button', { class: 'btn ghost', onclick: () => { reps = Math.max(0, reps - 1); repCount.textContent = reps; } }, '−1'),
          h('button', { class: 'btn', onclick: () => {
            reps++;
            repCount.textContent = reps;
            if (u.reps && reps === u.reps) status.textContent = 'Target hit — mark it complete when you’re ready.';
          } }, '+1 rep')))
    : null;

  async function complete(goNext) {
    if (!me.user) {
      sessionStorage.setItem('rlreps_after_login', location.hash);
      location.hash = '#/login';
      return;
    }
    try {
      await api('/progress', { method: 'POST', body: { courseId, unitId, completed: true } });
      await refreshMe();
      location.hash = goNext && next ? `#/course/${courseId}/${next.id}` : `#/course/${courseId}`;
    } catch (err) {
      status.textContent = err.message;
    }
  }

  async function undo() {
    await api('/progress', { method: 'POST', body: { courseId, unitId, completed: false } });
    await refreshMe();
    route();
  }

  let video = null;
  if (u.video) {
    video = u.video.kind === 'iframe'
      ? h('div', { class: 'video' }, h('iframe', { src: u.video.src, title: u.title, allow: 'encrypted-media; picture-in-picture', allowfullscreen: true, loading: 'lazy' }))
      : h('video', { class: 'video-file', src: u.video.src, controls: true, preload: 'metadata' });
  }

  render(
    h('div', { class: 'player' },
      h('aside', { class: 'player-side' },
        h('a', { href: `#/course/${c.id}`, class: 'back' }, `← ${c.title}`),
        me.user ? progressBar(c.completedCount, c.unitCount) : null,
        h('ol', { class: 'mini-units' },
          c.units.map((x) => h('li', { class: [x.id === u.id ? 'current' : '', x.completedAt ? 'done' : ''].join(' ') },
            h('a', { href: `#/course/${c.id}/${x.id}` }, h('span', { class: 'check' }, x.completedAt ? '✓' : ''), x.title))))),
      h('article', { class: 'player-main' },
        h('p', { class: 'eyebrow' }, `Unit ${index + 1} of ${c.units.length} · ${TYPE_LABEL[u.type]}${u.minutes ? ` · ~${u.minutes} min` : ''}`),
        h('h1', {}, u.title),
        video,
        h('div', { class: 'prose', html: u.html }),
        repBox,
        h('div', { class: 'player-actions' },
          prev ? h('a', { class: 'btn ghost', href: `#/course/${c.id}/${prev.id}` }, '← Previous') : h('span'),
          u.completedAt
            ? h('div', { class: 'done-row' },
                h('span', { class: 'done-label' }, '✓ Completed'),
                h('button', { class: 'linkish', onclick: undo }, 'Mark incomplete'),
                next ? h('a', { class: 'btn', href: `#/course/${c.id}/${next.id}` }, 'Next →') : h('a', { class: 'btn', href: '#/' }, 'Back to courses'))
            : h('button', { class: 'btn big', onclick: () => complete(true) },
                me.user ? (next ? 'Complete & next →' : 'Complete course ✓') : 'Log in to save progress')),
        status)),
  );
}

// ---------- router ----------
async function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  try {
    if (parts[0] === 'login') return authView('login');
    if (parts[0] === 'register') return authView('register');
    if (parts[0] === 'course' && parts[2]) return await unitView(parts[1], parts[2]);
    if (parts[0] === 'course' && parts[1]) return await courseView(parts[1]);
    return await catalogView();
  } catch (err) {
    errorView(err);
  }
}

// Clicking a looping clip restarts it from the beginning.
app.addEventListener('click', (e) => {
  const img = e.target.closest('figure.clip img');
  if (!img) return;
  const url = new URL(img.src);
  url.searchParams.set('replay', Date.now());
  img.src = url.toString();
});

window.addEventListener('hashchange', route);
refreshMe().then(route, errorView);
