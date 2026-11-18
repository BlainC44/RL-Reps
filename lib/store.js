// Tiny JSON-file data store. Good enough for a single-server v1;
// swap for SQLite/Postgres later without touching the API layer.

const fs = require('node:fs');
const path = require('node:path');

// Practice days use the server's local calendar date (YYYY-MM-DD).
function localDate(ms = Date.now()) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

class Store {
  constructor(file) {
    this.file = file;
    this.data = { users: {}, sessions: {}, progress: {}, practiceDays: {} };
    if (fs.existsSync(file)) {
      this.data = { ...this.data, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
    }
    this.pruneSessions();
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file); // atomic replace
  }

  // ----- users -----
  key(username) {
    return username.toLowerCase();
  }

  getUser(username) {
    return this.data.users[this.key(username)] || null;
  }

  createUser(username, { salt, hash }) {
    this.data.users[this.key(username)] = { username, salt, hash, createdAt: new Date().toISOString() };
    this.save();
  }

  // ----- sessions -----
  createSession(token, username, days) {
    this.data.sessions[token] = { username: this.getUser(username).username, expires: Date.now() + days * 86400000 };
    this.save();
  }

  userForSession(token) {
    const s = this.data.sessions[token];
    if (!s) return null;
    if (s.expires < Date.now()) {
      delete this.data.sessions[token];
      this.save();
      return null;
    }
    return s.username;
  }

  deleteSession(token) {
    delete this.data.sessions[token];
    this.save();
  }

  pruneSessions() {
    const now = Date.now();
    for (const [t, s] of Object.entries(this.data.sessions)) if (s.expires < now) delete this.data.sessions[t];
  }

  // ----- progress -----
  completedUnits(username, courseId) {
    return this.data.progress[this.key(username)]?.[courseId] || {};
  }

  setProgress(username, courseId, unitId, completed) {
    const k = this.key(username);
    const userProgress = (this.data.progress[k] ||= {});
    const course = (userProgress[courseId] ||= {});
    if (completed) {
      course[unitId] = new Date().toISOString();
      const days = (this.data.practiceDays[k] ||= []);
      const today = localDate();
      if (!days.includes(today)) days.push(today);
    } else {
      delete course[unitId];
    }
    this.save();
  }

  // Consecutive practice days ending today (or yesterday, so a streak
  // isn't shown as broken before the user has practiced today).
  streak(username) {
    const days = new Set(this.data.practiceDays[this.key(username)] || []);
    const cursor = new Date();
    if (!days.has(localDate(cursor))) cursor.setDate(cursor.getDate() - 1);
    let count = 0;
    while (days.has(localDate(cursor))) {
      count++;
      cursor.setDate(cursor.getDate() - 1);
    }
    return { days: count, practicedToday: days.has(localDate()) };
  }

  // The most recently touched course with its next unfinished unit.
  lastActivity(username, courses) {
    const userProgress = this.data.progress[this.key(username)] || {};
    let best = null;
    for (const [courseId, units] of Object.entries(userProgress)) {
      const course = courses.byId[courseId];
      if (!course) continue;
      for (const ts of Object.values(units)) if (!best || ts > best.ts) best = { ts, course };
    }
    if (!best) return null;
    const done = userProgress[best.course.id];
    const next = best.course.units.find((u) => !done[u.id]);
    return {
      courseId: best.course.id,
      courseTitle: best.course.title,
      nextUnitId: next ? next.id : null,
      nextUnitTitle: next ? next.title : null,
      finished: !next,
    };
  }
}

module.exports = { Store, localDate };
