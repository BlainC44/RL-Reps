# RL Reps

**Open-source LMS for deliberate practice in video games.**

RL Reps is a minimal learning platform built for one thing: giving video gamers structured, self-guided repetitions. Create an account, pick a course, and work through drills or lessons at your own pace. No classrooms, no deadlines, no social features — just focused reps.

## Quick start

You need [Node.js](https://nodejs.org) 22 or newer (on macOS older than 13.5, use the Node 22 installer). There is nothing to install: RL Reps has **zero dependencies**.

```bash
git clone https://github.com/BlainC44/RL-Reps.git
cd RL-Reps
npm start
```

Open <http://localhost:3000>, create an account, and start a course.

`npm start` restarts the server automatically when you edit `server.js`, `lib/` or anything in `courses/`. For production, use `npm run serve` (no file watching).

Run the tests with `npm test`.

## What it does

| Capability | How it works |
| --- | --- |
| **Accounts** | Username + password sign-up and login. Passwords are hashed with scrypt; sessions use an HttpOnly cookie. |
| **Course catalog** | Every folder in `courses/` shows up as a course card with your progress on it. |
| **Course player** | Step through units in order. Units can be a **lesson** (text), a **video**, or a **drill** with a rep target and an on-page rep counter. |
| **Progress tracking** | Completing a unit is saved to your account. The home page shows a **Continue** button that drops you on your next unfinished unit, plus a daily practice streak. |

### The repetition loop

```
start a course → complete a unit → progress is saved → continue, or come back tomorrow
```

Everything in the UI is built around that loop: the home page's first thing is "Continue", every unit ends with **Complete & next**, and the streak gives a reason to return the next day.

### Intentionally left out

Forums, certificates, payments, instructor dashboards, live sessions, AI tutors, and complex assessments. These can be added later. v1 stays small enough that one developer can ship and maintain it.

## Writing a course

A course is a folder inside `courses/` with a `course.json` file and one Markdown file per unit:

```
courses/
  aerial-foundations/
    course.json
    01-how-to-practice.md
    02-first-touches.md
    ...
```

The folder name is the course's ID (it appears in the URL), so use lowercase words and dashes.

### `course.json`

```json
{
  "title": "Aerial Foundations",
  "game": "Rocket League",
  "level": "Beginner",
  "order": 1,
  "estimatedMinutes": 45,
  "summary": "One-line pitch shown on the course card.",
  "description": "Longer intro shown on the course page. Markdown allowed.",
  "units": [
    { "id": "how-to-practice", "title": "How to practice", "type": "text", "minutes": 3, "file": "01-how-to-practice.md" },
    { "id": "basic-aerial", "title": "The basic aerial", "type": "drill", "reps": 25, "minutes": 10, "file": "03-basic-aerial.md" },
    { "id": "breakdown", "title": "Pro breakdown", "type": "video", "video": "https://www.youtube.com/watch?v=VIDEO_ID", "file": "notes.md" }
  ]
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `title` | ✓ | Course name. |
| `units` | ✓ | Ordered list. Learners go through it top to bottom. |
| `units[].id` | ✓ | Unique within the course. **Don't rename it after launch** — saved progress is keyed by it. |
| `units[].title` | ✓ | |
| `units[].type` | | `text` (default), `video`, or `drill`. |
| `units[].file` | | Markdown file with the unit's content. |
| `units[].reps` | | Rep target for drills. |
| `units[].video` | | YouTube or Vimeo link (auto-embedded) or a direct video file URL. |
| `units[].minutes` | | Rough time estimate. |
| `game`, `level`, `summary`, `description`, `estimatedMinutes`, `order` | | Shown in the catalog. Lower `order` comes first. |

### Unit Markdown

Supported: `#` headings, paragraphs, bullet and numbered lists, `> callouts`, **bold**, *italic*, `code`, links, and `---` rules. Raw HTML is escaped, so course files can't run scripts.

### Pictures and clips

Put media files in a `media/` folder inside the course and reference them on their own line. The text in brackets becomes the caption:

```markdown
![Watch it: jump, tilt back, then boost at the ball.](media/basic-aerial-clip.svg)
```

| File | Shows as |
| --- | --- |
| `.png` `.jpg` `.webp` `.svg` | A picture |
| `.gif`, or any file named `*-clip.*` | A looping clip (click to replay) |
| `.mp4` `.webm` `.mov` | A muted, looping video with controls — great for your own recorded gameplay |
| A YouTube or Vimeo link | An embedded player, labeled "Real gameplay". Add `&t=56` to start at 0:56 |

The server refuses to start if a lesson points at a media file that doesn't exist, so broken images are caught right away.

Each drill in the sample courses has three visuals:

1. **Real gameplay** — an embedded YouTube tutorial by a Rocket League creator (credited in the caption; videos are embedded with YouTube's player, not copied).
2. **What to press** — an animated left-stick + buttons clip (`*-inputs-clip.svg`), slowed down and synced to the numbered steps.
3. **Step by step** — a numbered picture of the car at each key moment (`*-steps.svg`).

The stick clips and pictures are original SVGs generated by `scripts/build-media.js`. Each move is described as timelines (car position, stick position, buttons held), and the script renders the files from them. Edit a timeline and run `npm run media` to rebuild.

A good drill unit usually has: **Goal**, **Setup**, **Cues**, and **A rep counts when…**. See the sample courses for examples.

With `npm start`, the server reloads automatically after you edit a course.

## Project layout

```
server.js          HTTP server + JSON API (Node built-ins only)
lib/store.js       Users, sessions, progress, streaks — saved to data/db.json
lib/courses.js     Loads and validates courses/ at startup
lib/markdown.js    Small, HTML-safe Markdown renderer
public/            Front end: one HTML page, vanilla JS, CSS
courses/           Course content (JSON + Markdown + media/)
scripts/           build-media.js — generates the sample clips and pictures
test/              Tests (node --test)
```

### API

| Method | Path | Body | Notes |
| --- | --- | --- | --- |
| POST | `/api/register` | `{ username, password }` | Creates account and logs in. |
| POST | `/api/login` | `{ username, password }` | |
| POST | `/api/logout` | | |
| GET | `/api/me` | | Current user, streak, and where to resume. |
| GET | `/api/courses` | | Catalog with per-user progress counts. |
| GET | `/api/courses/:id` | | Course with units and completion times. |
| POST | `/api/progress` | `{ courseId, unitId, completed }` | `completed: false` un-marks a unit. |

### Configuration

| Env var | Default |
| --- | --- |
| `PORT` | `3000` |
| `DATA_FILE` | `data/db.json` |
| `COURSES_DIR` | `courses/` |

## Deploying

Any host that runs Node works (Render, Railway, Fly.io, a VPS). Keep `data/` on persistent storage and put the app behind HTTPS. The JSON file store is meant for a single server; swapping it for SQLite or Postgres only touches `lib/store.js`.

## Success metric

A gamer finishes a short course, comes back the next day without being prompted, and starts another set of reps.

## License

[MIT](LICENSE)

## Deploying to AWS (Elastic Beanstalk + CloudFront)

The repo is ready for Elastic Beanstalk's **Node.js** platform:

- `Procfile` runs `npm run serve` (no file watching).
- `.platform/hooks/…/01-data-dir.sh` creates `/var/app/rlreps-data`, which keeps accounts and progress across redeploys. Data is lost if the instance itself is replaced, so back up `db.json` (or move to a database) before relying on it.
- `.ebextensions/01-env.config` sets `DATA_FILE` and `COOKIE_SECURE=true` (login cookies only over HTTPS).

To deploy: zip the repo contents (`git archive -o rl-reps.zip HEAD`), create a single-instance Node.js environment in Elastic Beanstalk and upload the zip. Then create a CloudFront distribution with the environment's URL as an **HTTP-only** origin, **Redirect HTTP to HTTPS**, all HTTP methods allowed, cache policy **CachingDisabled** and origin request policy **AllViewer**. Use the `https://….cloudfront.net` address. Because cookies are Secure, logging in over the plain `http://…elasticbeanstalk.com` address won't work — that's intended.

To update, upload a new zip in the environment's **Upload and deploy**.
