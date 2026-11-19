# RL Reps — project context for Claude

Open-source (MIT) learning site for deliberate practice in Rocket League. Owner: Blain College (GitHub `BlainC44`). Live at https://theblaincollege.com.

Success metric: a gamer finishes a course, comes back the next day, and starts more reps.

If `CLAUDE.local.md` exists next to this file, read it too: it holds the AWS deploy details.

## How it's built

- Zero-dependency Node.js (>= 22). `node:http`, `node:crypto` (scrypt passwords, HttpOnly session cookie), JSON file store.
- `server.js`: API (`/api/register|login|logout|me|courses|courses/:id|progress`), `/media/<course>/<path>`, static SPA.
- `lib/store.js`: users, sessions (30 days), progress, practice days → streak. Data file: `data/db.json` (`DATA_FILE` env).
- `lib/courses.js`: loads and validates every course at startup. A missing media file or bad pack code throws.
- `lib/markdown.js`: small HTML-safe Markdown renderer with three extras:
  - `![caption](media/x.svg)` on its own line → figure. Files named `*-clip.*` get a "looping clip" chip.
  - `![caption](https://www.youtube.com/watch?v=ID&t=56)` → youtube-nocookie embed.
  - `:::packs` … `:::` block, one line per pack: `CODE | Name | Creator | Difficulty | Why | featured`. Creator/difficulty may be blank; `featured` = featured by Psyonix. Code must match `XXXX-XXXX-XXXX-XXXX` (hex).
- `public/`: vanilla JS SPA, hash routes `#/`, `#/login`, `#/register`, `#/course/:id/:unit`. Homepage groups courses by `section`.

## Courses (`courses/<id>/course.json` + Markdown units + `media/`)

| Order | Course | Section | Lessons |
| --- | --- | --- | --- |
| 1 | Aerial Foundations | For beginners | 5 |
| 2 | Recovery & Movement | For beginners | 4 |
| 3 | Backboard Defense | For beginners (tagged Intermediate) | 6 |
| 4 | Free Air Roll | Intermediate | 4 |
| 5 | Shooting & Power Shooting | Intermediate | 5 |
| 6 | Shooting with Free Air Roll | Intermediate | 4 |

The house outline. Follow it for every new course:

- **Read-first text unit:** has an overview diagram.
- **Drill units**, in this order:
  1. `# Goal`
  2. Real gameplay YouTube embed. Check it's embeddable with YouTube's oEmbed endpoint first.
  3. Inputs clip (`*-inputs-clip.svg`).
  4. `# Cues`, with the step-by-step picture (`*-steps.svg`).
  5. Common mistakes.
  6. `# Setup`.
  7. `# Training packs` (`:::packs`).
  8. `# A rep counts when…`
- **Last unit:** ends with "You finished the course 🎉".

Pack codes and pack facts must come from a real source: Psyonix's featured lists on rocketleague.com, Dignitas guides, or a creator's own video description. Leave creator or difficulty blank rather than guess.

## Visuals

`npm run media` runs `scripts/build-media.js`, which generates original animated SVGs:
- side-view comic strips
- top-down diagrams
- behind-the-car roll strips
- controller clips (stick + buttons, slowed down)

Every label must go through `esc()`, since a raw `&` breaks the SVG. After changing visuals, render them and look for overlapping labels.

## Commands

- `npm start`: dev server on :3000 with auto-restart (`--watch-path`).
- `npm run serve`: production (what the Procfile runs).
- `npm test`: 9 tests. Covers rendering, that every drill has video + inputs clip + packs, pack-code validation, media/static traversal, and the full rep loop.
- `npm run media`: rebuild SVGs.
- `npm run db`: build `data/rl-reps.db`, a SQLite copy of all content, using `node:sqlite`. Add `-- --users data/db.json` to import accounts/progress.
  - Tables: sections, courses, units, videos, media, unit_media, training_packs, unit_packs, users, sessions, progress, practice_days.
  - Views: course_overview, pack_usage.
  - The live app does not read it yet.

## Hosting (summary)

AWS Elastic Beanstalk (Node, Amazon Linux 2023, one t3.micro, us-east-2) behind CloudFront with HTTPS. Domain theblaincollege.com is in Route 53.
- App data persists in `/var/app/rlreps-data/db.json`; `.platform` hooks create the folder.
- `.ebextensions/01-env.config` sets `NODE_ENV`, `DATA_FILE`, `COOKIE_SECURE`.
- Deploy = zip `HEAD` (`git archive`) and upload via EB "Upload and deploy". The user picks the file themselves in the browser dialog.
- IDs and the step-by-step flow are in `CLAUDE.local.md`.

## Status (2026-11-19)

- Live version: **v0.7** (Intermediate section). Health Green.
- On GitHub/laptop but **not yet deployed**: commit `89e4e55`.
  - Adds the database build.
  - Fixes the Powershots pack in Aerial Foundations → First touches (now Yeeza, Diamond, featured, per Psyonix). The live page still says Silver.
  - Removes unsourced difficulty labels.
  - Next deploy should be v0.8.

## Open questions for the user

- Backboard Defense is tagged Intermediate but sits under "For beginners". Move it to the Intermediate section?
- Switch the live app from `db.json` to the SQLite database? This needs a careful migration of the live accounts on the server.

## Working with Blain

- Wants things done for him end to end, with short plain-language updates.
- His Mac runs an older macOS (< 13.5), so Node 22 LTS, not newer.
- Never type passwords or payment details; he enters those.
- Commit as `Blain College <BlainC44@users.noreply.github.com>`.
