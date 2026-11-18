// Loads courses from disk. Each course is a folder:
//
//   courses/<course-id>/course.json   metadata + ordered list of units
//   courses/<course-id>/*.md          one Markdown file per unit
//
// Courses are read once at startup; restart the server after editing them.

const fs = require('node:fs');
const path = require('node:path');
const { renderMarkdown } = require('./markdown');

const UNIT_TYPES = new Set(['text', 'video', 'drill']);

// Turn a YouTube/Vimeo watch link into an embeddable URL. Anything else
// (e.g. a direct .mp4) is returned as-is and played with <video>.
function toEmbed(url) {
  if (!url) return null;
  let m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{11})/);
  if (m) return { kind: 'iframe', src: `https://www.youtube-nocookie.com/embed/${m[1]}` };
  m = url.match(/vimeo\.com\/(\d+)/);
  if (m) return { kind: 'iframe', src: `https://player.vimeo.com/video/${m[1]}` };
  if (/^https?:\/\//.test(url)) return { kind: 'file', src: url };
  return null;
}

function loadCourses(dir) {
  const list = [];
  if (!fs.existsSync(dir)) return { list, byId: {} };

  for (const id of fs.readdirSync(dir).sort()) {
    const folder = path.join(dir, id);
    const metaFile = path.join(folder, 'course.json');
    if (!fs.statSync(folder).isDirectory() || !fs.existsSync(metaFile)) continue;

    const where = `courses/${id}/course.json`;
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    if (!meta.title || !Array.isArray(meta.units) || !meta.units.length) {
      throw new Error(`${where}: needs a "title" and a non-empty "units" array`);
    }

    const seen = new Set();
    const units = meta.units.map((u, n) => {
      if (!u.id || !u.title) throw new Error(`${where}: unit #${n + 1} needs an "id" and "title"`);
      if (seen.has(u.id)) throw new Error(`${where}: duplicate unit id "${u.id}"`);
      seen.add(u.id);
      const type = u.type || 'text';
      if (!UNIT_TYPES.has(type)) throw new Error(`${where}: unit "${u.id}" has unknown type "${type}"`);
      const body = u.file ? fs.readFileSync(path.join(folder, u.file), 'utf8') : '';
      return {
        id: u.id,
        title: u.title,
        type,
        reps: type === 'drill' ? Number(u.reps) || null : null,
        minutes: Number(u.minutes) || null,
        video: toEmbed(u.video),
        html: renderMarkdown(body),
      };
    });

    list.push({
      id,
      title: meta.title,
      game: meta.game || '',
      summary: meta.summary || '',
      description: meta.description ? renderMarkdown(meta.description) : '',
      level: meta.level || '',
      estimatedMinutes: Number(meta.estimatedMinutes) || null,
      order: Number(meta.order) || 999,
      units,
    });
  }

  list.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
  return { list, byId: Object.fromEntries(list.map((c) => [c.id, c])) };
}

module.exports = { loadCourses, toEmbed };
