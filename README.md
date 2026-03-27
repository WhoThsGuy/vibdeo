# Video Optimizer

Local web interface for optimizing video files using ffmpeg. Converts videos to MP4 and WebM with configurable quality settings, generates cover images, and lets you compare the original and optimized result side by side.

## Requirements

- [Node.js](https://nodejs.org/) 18+
- [ffmpeg](https://ffmpeg.org/) (must be available in `PATH`)

```bash
brew install ffmpeg
```

## Setup

```bash
npm install
npm start
```

Open [http://localhost:3333](http://localhost:3333).

## Usage

1. Enter a directory path in the sidebar and press Enter — video files in that directory will appear in the list
2. Or drag and drop video files directly onto the drop zone
3. Click a file to preview the original
4. Adjust settings if needed
5. Click **Optimize** — progress is shown in real time
6. When done, the optimized video appears in the right panel for comparison
7. Switch between MP4 / WebM previews using the format buttons

Optimized files are saved to an `optimized/` subdirectory inside the source directory.

## Settings

| Setting | Description |
|---|---|
| **Cover JPG** | Extract first frame as a JPEG thumbnail |
| **WebM** | Convert using libvpx |
| **MP4** | Convert using libx264 with faststart |
| **Remove audio** | Strip audio track from output files (on by default) |
| **CRF (MP4)** | Quality: 0 = lossless, 51 = worst. Recommended: 18–28 |
| **Preset (MP4)** | Encoding speed vs file size. `medium` is a good default |
| **CRF (WebM)** | Quality: 0–25 (capped by qmax=25). Recommended: 4–10 |
| **Bitrate (WebM)** | Upper bitrate limit. Use `—` for CRF-only mode |

## Output formats

Each optimized file is saved alongside the source in `optimized/`:

```
videos/
  clip.mp4
  optimized/
    clip.mp4      ← H.264, no audio, web-optimized
    clip.webm     ← VP8, no audio
    clip.jpg      ← cover image
```
