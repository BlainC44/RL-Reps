// A small, safe Markdown renderer for course content.
// Supports: # headings, paragraphs, - / * / 1. lists, > quotes, ``` code blocks,
// `inline code`, **bold**, *italic*, [links](https://...), --- rules, and
// ![caption](media/file.svg) on its own line for pictures, clips and videos.
// All text is HTML-escaped first, so course files can't inject scripts.

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function inline(text) {
  let out = escapeHtml(text);
  const codes = [];
  out = out.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  out = out.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
  return out;
}

const VIDEO_EXT = /\.(mp4|webm|mov)$/i;

// YouTube/Vimeo watch link → embeddable player URL (keeps a start time like
// ?t=56 or &t=1m30s). Anything else returns null.
function toEmbed(url) {
  if (!url) return null;
  let m = url.match(/(?:youtube\.com\/watch\?(?:.*&)?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([\w-]{11})/);
  if (m) {
    const t = url.match(/[?&](?:t|start)=(?:(\d+)m)?(\d+)s?/);
    const start = t ? Number(t[1] || 0) * 60 + Number(t[2]) : 0;
    return { kind: 'iframe', src: `https://www.youtube-nocookie.com/embed/${m[1]}${start ? `?start=${start}` : ''}`, site: 'YouTube' };
  }
  m = url.match(/vimeo\.com\/(\d+)/);
  if (m) return { kind: 'iframe', src: `https://player.vimeo.com/video/${m[1]}`, site: 'Vimeo' };
  if (/^https?:\/\//.test(url)) return { kind: 'file', src: url };
  return null;
}
const IMAGE_LINE = /^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/;

// A figure: an image, animated SVG/GIF, or a video file. Files named
// "*-clip.*" (and all videos) are shown as looping clips.
function figure(alt, url) {
  const embed = /^https:\/\//.test(url) ? toEmbed(url) : null;
  if (embed && embed.kind === 'iframe') {
    return `<figure class="media embed"><div class="video"><iframe src="${escapeHtml(embed.src)}" title="${escapeHtml(alt)}" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe></div><figcaption><span class="chip">Real gameplay · ${embed.site}</span>${inline(alt)}</figcaption></figure>`;
  }
  const isVideo = VIDEO_EXT.test(url.split('?')[0]);
  const isClip = isVideo || /-clip\.[a-z0-9]+$/i.test(url.split('?')[0]);
  const media = isVideo
    ? `<video src="${escapeHtml(url)}" autoplay muted loop playsinline controls preload="metadata" aria-label="${escapeHtml(alt)}"></video>`
    : `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" loading="lazy">`;
  const chip = isClip ? `<span class="chip">${isVideo ? 'Clip' : 'Looping clip · click to replay'}</span>` : '';
  return `<figure class="media${isClip ? ' clip' : ''}">${media}<figcaption>${chip}${inline(alt)}</figcaption></figure>`;
}

// options.resolveMedia(path) → URL for a relative media path (or throws).
function renderMarkdown(src, options = {}) {
  const resolveMedia = options.resolveMedia || ((p) => p);
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const html = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    const img = line.match(IMAGE_LINE);
    if (img) {
      const url = /^https:\/\//.test(img[2]) ? img[2] : resolveMedia(img[2]);
      html.push(figure(img[1], url));
      i++;
      continue;
    }

    if (/^```/.test(line)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      html.push(`<pre><code>${escapeHtml(buf.join('\n'))}</code></pre>`);
      continue;
    }

    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const level = Math.min(h[1].length + 1, 5); // course "#" renders as <h2>
      html.push(`<h${level}>${inline(h[2])}</h${level}>`);
      i++;
      continue;
    }

    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      html.push('<hr>');
      i++;
      continue;
    }

    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        items.push(`<li>${inline(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ''))}</li>`);
        i++;
      }
      const tag = ordered ? 'ol' : 'ul';
      html.push(`<${tag}>${items.join('')}</${tag}>`);
      continue;
    }

    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      html.push(`<blockquote>${inline(buf.join(' '))}</blockquote>`);
      continue;
    }

    if (!line.trim()) {
      i++;
      continue;
    }

    const buf = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,4}\s|```|>|!\[|\s*([-*]|\d+\.)\s+|\s*(-{3,}|\*{3,})\s*$)/.test(lines[i])
    ) {
      buf.push(lines[i++]);
    }
    html.push(`<p>${inline(buf.join(' '))}</p>`);
  }

  return html.join('\n');
}

module.exports = { renderMarkdown, escapeHtml, toEmbed };
