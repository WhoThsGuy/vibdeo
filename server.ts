import express, { type Request, type Response } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3333;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const UPLOAD_DIR = path.resolve("uploads");
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const VIDEO_EXTS = new Set([".mp4", ".mov", ".avi", ".mkv", ".webm"]);

// ── Types ────────────────────────────────────────────────────────────────────

interface JobState {
  clients: Response[];
}

interface OptimizeSettings {
  genCover: boolean;
  genWebm: boolean;
  genMp4: boolean;
  removeAudio: boolean;
  mp4Crf: number;
  mp4Preset: string;
  webmCrf: number;
  webmBitrate: string;
}

interface OptimizeResult {
  mp4: string | null;
  webm: string | null;
  cover: string | null;
}

// ── State ────────────────────────────────────────────────────────────────────

const jobs = new Map<string, JobState>();

// ── Multer ───────────────────────────────────────────────────────────────────

const upload = multer({ dest: UPLOAD_DIR });

// ── API ──────────────────────────────────────────────────────────────────────

// Default config (upload dir path for client init)
app.get("/api/config", (_req: Request, res: Response) => {
  res.json({ uploadDir: UPLOAD_DIR });
});

// List video files in a directory
app.get("/api/files", (req: Request, res: Response) => {
  const dir = req.query.dir as string;

  if (!dir) return void res.status(400).json({ error: "No directory specified" });

  let stat: fs.Stats;
  try {
    stat = fs.statSync(dir);
  } catch {
    return void res.status(400).json({ error: "Directory not found" });
  }

  if (!stat.isDirectory()) {
    return void res.status(400).json({ error: "Not a directory" });
  }

  const files = fs
    .readdirSync(dir)
    .filter((f) => VIDEO_EXTS.has(path.extname(f).toLowerCase()))
    .map((f) => {
      const filePath = path.join(dir, f);
      const size = fs.statSync(filePath).size;
      const name = path.parse(f).name;
      const optimizedDir = path.join(dir, "optimized");
      const isOptimized =
        fs.existsSync(path.join(optimizedDir, `${name}.mp4`)) ||
        fs.existsSync(path.join(optimizedDir, `${name}.webm`));
      return { name: f, path: filePath, size, isOptimized };
    });

  res.json({ files });
});

// Upload a video file
app.post("/api/upload", upload.single("video"), (req: Request, res: Response) => {
  if (!req.file) return void res.status(400).json({ error: "No file uploaded" });

  const targetDir = req.query.dir as string | undefined;
  const originalName = Buffer.from(req.file.originalname, "latin1").toString("utf8");

  let finalPath: string;
  if (targetDir && fs.existsSync(targetDir) && fs.statSync(targetDir).isDirectory()) {
    finalPath = path.join(targetDir, originalName);
  } else {
    finalPath = path.join(UPLOAD_DIR, originalName);
  }

  fs.renameSync(req.file.path, finalPath);
  res.json({ name: originalName, path: finalPath });
});

// Serve any local file (with range support for video streaming)
app.get("/api/serve", (req: Request, res: Response) => {
  const filePath = req.query.path as string;

  if (!filePath) return void res.status(400).json({ error: "No path" });
  if (!fs.existsSync(filePath)) return void res.status(404).json({ error: "File not found" });

  res.sendFile(path.resolve(filePath), (err) => {
    if (err && !res.headersSent) {
      res.status((err as NodeJS.ErrnoException & { status?: number }).status ?? 500).end();
    }
  });
});

// Check existing optimized files for a given source file
app.get("/api/optimized-info", (req: Request, res: Response) => {
  const filePath = req.query.path as string;
  if (!filePath) return void res.status(400).json({ error: "No path" });

  const dir = path.dirname(filePath);
  const name = path.parse(filePath).name;
  const optimizedDir = path.join(dir, "optimized");

  const result: OptimizeResult = { mp4: null, webm: null, cover: null };

  if (fs.existsSync(optimizedDir)) {
    for (const ext of ["mp4", "webm"] as const) {
      const p = path.join(optimizedDir, `${name}.${ext}`);
      if (fs.existsSync(p)) result[ext] = p;
    }
    const coverPath = path.join(optimizedDir, `${name}.jpg`);
    if (fs.existsSync(coverPath)) result.cover = coverPath;
  }

  res.json(result);
});

// Open file location in Finder (macOS)
app.get("/api/reveal", (req: Request, res: Response) => {
  const filePath = req.query.path as string;
  if (!filePath || !fs.existsSync(filePath)) {
    return void res.status(400).json({ error: "File not found" });
  }
  spawn("open", ["-R", filePath]);
  res.json({ ok: true });
});

// Start optimization job
app.post("/api/optimize", (req: Request, res: Response) => {
  const { filePath, settings } = req.body as {
    filePath: string;
    settings: Partial<OptimizeSettings>;
  };

  if (!filePath || !fs.existsSync(filePath)) {
    return void res.status(400).json({ error: "File not found" });
  }

  const jobId = Date.now().toString();
  jobs.set(jobId, { clients: [] });

  res.json({ jobId });

  runOptimization(jobId, filePath, settings ?? {}).catch(console.error);
});

// SSE progress stream
app.get("/api/progress/:jobId", (req: Request, res: Response) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return void res.status(404).end();

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  job.clients.push(res);
  req.on("close", () => {
    job.clients = job.clients.filter((c) => c !== res);
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function broadcast(jobId: string, data: object) {
  const job = jobs.get(jobId);
  if (!job) return;
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of job.clients) {
    try {
      client.write(payload);
    } catch {}
  }
}

function getDuration(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn("ffprobe", [
      "-v", "quiet",
      "-print_format", "json",
      "-show_format",
      filePath,
    ]);
    let out = "";
    proc.stdout.on("data", (d: Buffer) => (out += d.toString()));
    proc.on("close", () => {
      try {
        const parsed = JSON.parse(out) as { format?: { duration?: string } };
        resolve(parseFloat(parsed.format?.duration ?? "0") || 0);
      } catch {
        resolve(0);
      }
    });
    proc.on("error", () => resolve(0));
  });
}

function runStep(
  args: string[],
  jobId: string,
  duration: number,
  label: string,
  stepOffset: number,  // 0..1 fraction of total where this step starts
  stepFraction: number // how much of total progress this step covers
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", [
      "-y", "-loglevel", "error", "-progress", "pipe:1",
      ...args,
    ]);

    let buf = "";

    proc.stdout.on("data", (data: Buffer) => {
      buf += data.toString();
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";

      for (const line of lines) {
        const m = line.match(/^out_time_ms=(\d+)/);
        if (m && duration > 0) {
          const stepPct = Math.min(parseInt(m[1]) / (duration * 1_000_000), 1);
          const total = Math.round((stepOffset + stepPct * stepFraction) * 100);
          broadcast(jobId, { progress: total, step: label });
        }
      }
    });

    let stderrOut = "";
    proc.stderr.on("data", (d: Buffer) => (stderrOut += d.toString()));

    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg code ${code}:\n${stderrOut.trim()}`));
    });

    proc.on("error", reject);
  });
}

// ── Optimization ─────────────────────────────────────────────────────────────

async function runOptimization(
  jobId: string,
  filePath: string,
  settings: Partial<OptimizeSettings>
) {
  const dir = path.dirname(filePath);
  const name = path.parse(filePath).name;
  const optimizedDir = path.join(dir, "optimized");

  if (!fs.existsSync(optimizedDir)) {
    fs.mkdirSync(optimizedDir, { recursive: true });
  }

  const coverPath = path.join(optimizedDir, `${name}.jpg`);
  const webmPath = path.join(optimizedDir, `${name}.webm`);
  const mp4Path = path.join(optimizedDir, `${name}.mp4`);

  const mp4Crf = settings.mp4Crf ?? 28;
  const mp4Preset = settings.mp4Preset ?? "medium";
  const webmCrf = settings.webmCrf ?? 4;
  const webmBitrate = settings.webmBitrate ?? "1M";
  const genCover = settings.genCover !== false;
  const genWebm = settings.genWebm !== false;
  const genMp4 = settings.genMp4 !== false;
  const removeAudio = settings.removeAudio !== false;

  type Step = { label: string; args: string[] };
  const steps: Step[] = [];

  if (genCover) {
    steps.push({
      label: "Generating cover",
      args: ["-i", filePath, "-vframes", "1", "-q:v", "1", coverPath],
    });
  }
  if (genWebm) {
    steps.push({
      label: "Converting WebM",
      args: [
        "-i", filePath,
        "-c:v", "libvpx",
        "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
        "-qmin", "0", "-qmax", "25",
        "-crf", String(webmCrf),
        "-b:v", webmBitrate,
        ...(removeAudio ? ["-an"] : []), "-threads", "0",
        webmPath,
      ],
    });
  }
  if (genMp4) {
    steps.push({
      label: "Converting MP4",
      args: [
        "-i", filePath,
        "-c:v", "libx264",
        "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
        "-pix_fmt", "yuv420p",
        "-crf", String(mp4Crf),
        "-preset", mp4Preset,
        ...(removeAudio ? ["-an"] : []), "-movflags", "+faststart",
        mp4Path,
      ],
    });
  }

  if (steps.length === 0) {
    broadcast(jobId, { error: "No output format selected", done: true });
    return;
  }

  try {
    const duration = await getDuration(filePath);
    const fraction = 1 / steps.length;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      broadcast(jobId, { progress: Math.round((i / steps.length) * 100), step: step.label });
      await runStep(step.args, jobId, duration, step.label, i / steps.length, fraction);
    }

    const results: OptimizeResult = {
      mp4: genMp4 ? mp4Path : null,
      webm: genWebm ? webmPath : null,
      cover: genCover ? coverPath : null,
    };

    broadcast(jobId, { progress: 100, step: "Done!", done: true, results });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    broadcast(jobId, { error: msg, done: true });
  }
}

// ── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\nVideo Optimizer → http://localhost:${PORT}\n`);
});
