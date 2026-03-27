# Video Optimizer — Claude context

Local video optimization tool with a web UI. Express backend + vanilla JS frontend, no build step.

## Git & Commit Guidelines

- User prefers simple commit messages without auto-generated signatures
- Don't add "Generated with Claude Code" or "Co-Authored-By" unless explicitly requested
- **CRITICAL: Always review ALL untracked files before committing**
  - Run `git status` as a separate command before staging — never skip this step
  - Check for files marked with `??` (untracked) and include all related files
  - Pay special attention to new directories that may contain implementation files
- **CRITICAL: Every git command must be run separately and go through user approval**
  - NEVER chain git commands with `&&` (e.g., no `git add ... && git commit ...`)
  - Run `git add`, `git commit` as individual commands, one at a time
- Always stage changes with `git add .` or specific files before committing
- Follow conventional commit format: `feat:`, `fix:`, `refactor:`, etc.
- **Commit descriptions should be comprehensive** - include all major changes like new components, refactoring, migrations
- **Don't check git log unnecessarily** - user finds this excessive and annoying

## Stack

- **Server**: `server.ts` — Express, runs via `tsx`
- **Frontend**: `public/index.html` + `public/main.css` + `public/main.js`
- **Runtime**: `npm start` → `tsx server.ts` → http://localhost:3333

## Key files

| File                | Purpose                                    |
| ------------------- | ------------------------------------------ |
| `server.ts`         | Express API, ffmpeg spawning, SSE progress |
| `public/index.html` | HTML markup only                           |
| `public/main.css`   | All styles                                 |
| `public/main.js`    | All frontend logic                         |

## API

| Endpoint                        | Description                                     |
| ------------------------------- | ----------------------------------------------- |
| `GET /api/config`               | Returns `{ uploadDir }` for frontend init       |
| `GET /api/files?dir=`           | List video files in a directory                 |
| `POST /api/upload?dir=`         | Upload a video file via multipart               |
| `GET /api/serve?path=`          | Stream any local file (supports range requests) |
| `GET /api/optimized-info?path=` | Check if optimized versions exist               |
| `GET /api/reveal?path=`         | Open file location in Finder                    |
| `POST /api/optimize`            | Start optimization job, returns `{ jobId }`     |
| `GET /api/progress/:jobId`      | SSE stream with progress events                 |

## Layout — important

`.app` uses a CSS grid with 4 rows and 3 columns:

```
grid-template-columns: 260px 1fr 1fr
grid-template-rows:    auto  1fr auto auto
                       ^     ^   ^    ^
                       heads vid feet playback
```

`.panel` uses `display: contents` — panels are invisible to the grid, their children (`.panel-head`, `.video-wrap`, `.panel-foot`) become direct grid participants. This makes the video row (`1fr`) identical height in both panels regardless of footer content.

`.sidebar` spans all 4 rows (`grid-row: span 4`).

**When adding a new shared row**: increment `grid-template-rows` in `.app` and update `grid-row: span N` on `.sidebar`. Panels don't need changes.

> Subgrid was tried but removed due to Safari bugs. `display: contents` achieves the same alignment without subgrid.

## ffmpeg commands

**Cover:**

```
ffmpeg -y -i input -vframes 1 -q:v 1 output.jpg
```

**WebM (libvpx):**

```
ffmpeg -y -i input -c:v libvpx -vf scale=trunc(iw/2)*2:trunc(ih/2)*2 -qmin 0 -qmax 25 -crf {0-25} -b:v {bitrate} -an -threads 0 output.webm
```

**MP4 (libx264):**

```
ffmpeg -y -i input -c:v libx264 -vf scale=trunc(iw/2)*2:trunc(ih/2)*2 -pix_fmt yuv420p -crf {0-51} -preset {preset} -an -movflags +faststart output.mp4
```

The `-vf scale=trunc(iw/2)*2:trunc(ih/2)*2` filter ensures even dimensions (required by both encoders).

Progress is tracked via `-progress pipe:1` (stdout) and streamed to the client over SSE.

## Uploads

Dropped/uploaded files go to `uploads/` (created on server start). If a directory is selected, files go there instead.

Optimized files are always saved to `optimized/` inside the source file's directory.
