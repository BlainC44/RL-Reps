// Loads courses from disk. Each course is a folder:
//
//   courses/<course-id>/course.json   metadata + ordered list of units
//   courses/<course-id>/*.md          one Markdown file per unit
//
// Courses are read once at startup; restart the server after editing them.

const fs = require('node:fs');
const path = require('node:path');
const { renderMarkdown, toEmbed } = require('./markdown');

const UNIT_TYPES = new Set(['text', 'video', 'drill']);

function loadCourses(dir) {
  const list = [];
  if (!fs.existsSync(dir)) return { list, byId: {} };

  for (const id of fs.readdirSync(dir).sort()) {
    const folder = path.resolve(dir, id);
    const metaFile = path.join(folder, 'course.json');
    if (!fs.statSync(folder).isDirectory() || !fs.existsSync(metaFile)) continue;

    const where = `courses/${id}/course.json`;
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));

    // Relative media paths in Markdown (e.g. media/fast-aerial-clip.svg) must
    // exist inside the course folder; they're served from /media/<id>/...
    const mediaOptions = (fileLabel) => ({
      resolveMedia(rel) {
        const file = path.resolve(folder, rel);
        if (!file.startsWith(folder + path.sep) || !fs.existsSync(file)) {
          throw new Error(`courses/${id}/${fileLabel}: media file not found: ${rel}`);
        }
        return `/media/${id}/${path.relative(folder, file).split(path.sep).map(encodeURIComponent).join('/')}`;
      },
    });
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
        html: renderMarkdown(body, mediaOptions(u.file || 'course.json')),
      };
    });

    list.push({
      id,
      title: meta.title,
      game: meta.game || '',
      summary: meta.summary || '',
      description: meta.description ? renderMarkdown(meta.description, mediaOptions('course.json')) : '',
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
