#!/usr/bin/env node
// Builds a SQLite database (data/rl-reps.db) from the course files.
//
//   npm run db                       -> content only
//   npm run db -- --users data/db.json -> also import accounts/progress
//
// The course folders stay the source of truth: re-run this after editing
// a course and the database is rebuilt from scratch. Uses Node's built-in
// SQLite (node:sqlite), so there is nothing to install.

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { loadCourses } = require('../lib/courses');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const OUT = path.resolve(opt('--out') || path.join(ROOT, 'data', 'rl-reps.db'));
const USERS = opt('--users');

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE sections (
  name        TEXT PRIMARY KEY,           -- "For beginners", "Intermediate"
  sort_order  INTEGER NOT NULL
);

CREATE TABLE courses (
  id                 TEXT PRIMARY KEY,    -- folder name, e.g. "free-air-roll"
  title              TEXT NOT NULL,
  game               TEXT NOT NULL,
  level              TEXT NOT NULL,
  section            TEXT NOT NULL REFERENCES sections(name),
  sort_order         INTEGER NOT NULL,
  estimated_minutes  INTEGER NOT NULL,
  summary            TEXT NOT NULL,
  description        TEXT
);

CREATE TABLE units (
  course_id      TEXT NOT NULL REFERENCES courses(id),
  id             TEXT NOT NULL,           -- e.g. "half-flip"
  position       INTEGER NOT NULL,        -- 1, 2, 3 ... within the course
  title          TEXT NOT NULL,
  type           TEXT NOT NULL CHECK (type IN ('text','video','drill')),
  target_reps    INTEGER,                 -- drills only
  minutes        INTEGER,
  file           TEXT NOT NULL,           -- the Markdown file it came from
  body_markdown  TEXT NOT NULL,
  PRIMARY KEY (course_id, id)
);

CREATE TABLE videos (
  course_id      TEXT NOT NULL,
  unit_id        TEXT NOT NULL,
  youtube_id     TEXT NOT NULL,
  start_seconds  INTEGER,
  title          TEXT,
  creator        TEXT,
  url            TEXT NOT NULL,
  PRIMARY KEY (course_id, unit_id, youtube_id),
  FOREIGN KEY (course_id, unit_id) REFERENCES units(course_id, id)
);

CREATE TABLE media (
  course_id   TEXT NOT NULL REFERENCES courses(id),
  path        TEXT NOT NULL,              -- e.g. "media/half-flip-steps.svg"
  kind        TEXT NOT NULL,              -- inputs-clip | steps | diagram
  bytes       INTEGER NOT NULL,
  PRIMARY KEY (course_id, path)
);

CREATE TABLE unit_media (                 -- where each picture/clip is shown
  course_id  TEXT NOT NULL,
  unit_id    TEXT NOT NULL,
  path       TEXT NOT NULL,
  caption    TEXT,
  PRIMARY KEY (course_id, unit_id, path),
  FOREIGN KEY (course_id, unit_id) REFERENCES units(course_id, id),
  FOREIGN KEY (course_id, path) REFERENCES media(course_id, path)
);

CREATE TABLE training_packs (
  code        TEXT PRIMARY KEY CHECK (code GLOB '[0-9A-F][0-9A-F][0-9A-F][0-9A-F]-[0-9A-F][0-9A-F][0-9A-F][0-9A-F]-[0-9A-F][0-9A-F][0-9A-F][0-9A-F]-[0-9A-F][0-9A-F][0-9A-F][0-9A-F]'),
  name        TEXT NOT NULL,
  creator     TEXT,                       -- NULL = not stated by a source
  difficulty  TEXT,                       -- as the source rates it; NULL = unknown
  featured    INTEGER NOT NULL DEFAULT 0  -- 1 = featured by Psyonix
);

CREATE TABLE unit_packs (                 -- one pack can be used in several units
  course_id  TEXT NOT NULL,
  unit_id    TEXT NOT NULL,
  pack_code  TEXT NOT NULL REFERENCES training_packs(code),
  position   INTEGER NOT NULL,
  why        TEXT,
  PRIMARY KEY (course_id, unit_id, pack_code),
  FOREIGN KEY (course_id, unit_id) REFERENCES units(course_id, id)
);

-- Learner data (filled by --users; otherwise empty)
CREATE TABLE users (
  username    TEXT PRIMARY KEY COLLATE NOCASE,
  salt        TEXT NOT NULL,
  hash        TEXT NOT NULL,              -- scrypt hash, never the password
  created_at  TEXT NOT NULL
);

CREATE TABLE sessions (
  token       TEXT PRIMARY KEY,
  username    TEXT NOT NULL REFERENCES users(username),
  expires_at  TEXT NOT NULL
);

CREATE TABLE progress (
  username      TEXT NOT NULL REFERENCES users(username),
  course_id     TEXT NOT NULL,
  unit_id       TEXT NOT NULL,
  completed_at  TEXT NOT NULL,
  PRIMARY KEY (username, course_id, unit_id)
);

CREATE TABLE practice_days (
  username  TEXT NOT NULL REFERENCES users(username),
  day       TEXT NOT NULL,                -- YYYY-MM-DD
  PRIMARY KEY (username, day)
);
`;

function parseUnit(md) {
  const videos = [];
  const figures = [];
  const packs = [];
  let inPacks = false;
  for (const raw of md.split('\n')) {
    const line = raw.trim();
    if (line === ':::packs') { inPacks = true; continue; }
    if (inPacks && line === ':::') { inPacks = false; continue; }
    if (inPacks && line) {
      const [code, name, creator, difficulty, why, flag] = line.split('|').map((s) => s.trim());
      packs.push({ code, name, creator, difficulty, why, featured: flag === 'featured' ? 1 : 0 });
      continue;
    }
    const m = line.match(/^!\[(.*)\]\((.+)\)$/);
    if (!m) continue;
    const [, caption, src] = m;
    const yt = src.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/);
    if (yt) {
      const t = src.match(/[?&]t=(\d+)/);
      const cap = caption.match(/"(.+)"(?: by ([^.]+))?/);
      videos.push({ id: yt[1], start: t ? Number(t[1]) : null, title: cap ? cap[1] : caption, creator: cap && cap[2] ? cap[2].trim() : null, url: src });
    } else {
      figures.push({ path: src, caption });
    }
  }
  return { videos, figures, packs };
}

function mediaKind(file) {
  if (file.endsWith('-inputs-clip.svg')) return 'inputs-clip';
  if (file.endsWith('-steps.svg')) return 'steps';
  return 'diagram';
}

function build() {
  const coursesDir = path.join(ROOT, 'courses');
  const { list } = loadCourses(coursesDir);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  for (const f of [OUT, `${OUT}-wal`, `${OUT}-shm`]) fs.rmSync(f, { force: true });
  const db = new DatabaseSync(OUT);
  db.exec(SCHEMA);

  const ins = (sql) => db.prepare(sql);
  const qSection = ins('INSERT OR IGNORE INTO sections (name, sort_order) VALUES (?, ?)');
  const qCourse = ins('INSERT INTO courses VALUES (?,?,?,?,?,?,?,?,?)');
  const qUnit = ins('INSERT INTO units VALUES (?,?,?,?,?,?,?,?,?)');
  const qVideo = ins('INSERT OR IGNORE INTO videos VALUES (?,?,?,?,?,?,?)');
  const qMedia = ins('INSERT INTO media VALUES (?,?,?,?)');
  const qUnitMedia = ins('INSERT OR IGNORE INTO unit_media VALUES (?,?,?,?)');
  // A pack used in several lessons is stored once; blanks in one lesson are
  // filled from another that names the creator or difficulty.
  const qPack = ins(`INSERT INTO training_packs VALUES (?,?,?,?,?)
    ON CONFLICT(code) DO UPDATE SET
      creator    = COALESCE(training_packs.creator, excluded.creator),
      difficulty = COALESCE(training_packs.difficulty, excluded.difficulty),
      featured   = MAX(training_packs.featured, excluded.featured)`);
  const qUnitPack = ins('INSERT INTO unit_packs VALUES (?,?,?,?,?)');

  db.exec('BEGIN');
  const sorted = [...list].sort((a, b) => a.order - b.order);
  for (const c of sorted) {
    qSection.run(c.section, sorted.findIndex((x) => x.section === c.section) + 1);
    const dir = path.join(coursesDir, c.id);
    const json = JSON.parse(fs.readFileSync(path.join(dir, 'course.json'), 'utf8'));
    qCourse.run(c.id, c.title, c.game, c.level, c.section, c.order, c.estimatedMinutes, c.summary, c.description || null);

    const mediaDir = path.join(dir, 'media');
    if (fs.existsSync(mediaDir)) {
      for (const f of fs.readdirSync(mediaDir).sort()) {
        qMedia.run(c.id, `media/${f}`, mediaKind(f), fs.statSync(path.join(mediaDir, f)).size);
      }
    }

    json.units.forEach((u, i) => {
      const md = fs.readFileSync(path.join(dir, u.file), 'utf8');
      qUnit.run(c.id, u.id, i + 1, u.title, u.type, u.reps ?? null, u.minutes ?? null, u.file, md);
      const { videos, figures, packs } = parseUnit(md);
      for (const v of videos) qVideo.run(c.id, u.id, v.id, v.start, v.title, v.creator, v.url);
      for (const f of figures) qUnitMedia.run(c.id, u.id, f.path, f.caption);
      packs.forEach((p, j) => {
        qPack.run(p.code, p.name, p.creator || null, p.difficulty || null, p.featured);
        qUnitPack.run(c.id, u.id, p.code, j + 1, p.why || null);
      });
    });
  }

  if (USERS) {
    const data = JSON.parse(fs.readFileSync(USERS, 'utf8'));
    const qUser = ins('INSERT INTO users VALUES (?,?,?,?)');
    const qSess = ins('INSERT INTO sessions VALUES (?,?,?)');
    const qProg = ins('INSERT INTO progress VALUES (?,?,?,?)');
    const qDay = ins('INSERT INTO practice_days VALUES (?,?)');
    for (const u of Object.values(data.users || {})) qUser.run(u.username, u.salt, u.hash, u.createdAt);
    for (const [t, s] of Object.entries(data.sessions || {})) {
      if (s.expires > Date.now()) qSess.run(t, s.username, new Date(s.expires).toISOString());
    }
    const nameOf = (k) => (data.users[k] ? data.users[k].username : k);
    for (const [k, courses] of Object.entries(data.progress || {})) {
      for (const [courseId, units] of Object.entries(courses)) {
        for (const [unitId, ts] of Object.entries(units)) qProg.run(nameOf(k), courseId, unitId, ts);
      }
    }
    for (const [k, days] of Object.entries(data.practiceDays || {})) for (const d of days) qDay.run(nameOf(k), d);
  }
  db.exec('COMMIT');

  // Handy read-only views for browsing the data.
  db.exec(`
    CREATE VIEW course_overview AS
      SELECT s.name AS section, c.sort_order, c.title, c.level,
             COUNT(u.id) AS units, SUM(u.type = 'drill') AS drills,
             SUM(COALESCE(u.target_reps, 0)) AS total_reps, c.estimated_minutes
      FROM courses c JOIN sections s ON s.name = c.section
      LEFT JOIN units u ON u.course_id = c.id
      GROUP BY c.id ORDER BY s.sort_order, c.sort_order;
    CREATE VIEW pack_usage AS
      SELECT p.code, p.name, p.creator, p.difficulty, p.featured,
             COUNT(*) AS used_in_units, GROUP_CONCAT(up.course_id || '/' || up.unit_id, ', ') AS units
      FROM training_packs p JOIN unit_packs up ON up.pack_code = p.code
      GROUP BY p.code ORDER BY used_in_units DESC, p.name;
  `);

  const counts = {};
  for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY rowid").all()) {
    counts[name] = db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get().n;
  }
  db.close();
  console.log(`Wrote ${path.relative(process.cwd(), OUT)}`);
  for (const [t, n] of Object.entries(counts)) console.log(`  ${t.padEnd(16)} ${n} rows`);
}

build();
