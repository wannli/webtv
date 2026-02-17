# AGENTS.md

## What This Project Is

**UN Web TV Transcribed** — a Next.js app that browses UN Web TV videos and generates AI-powered transcriptions with speaker identification. Hosted at `webtv.unfck.org`. Forked from `un-fck/webtv.unfck.org`.

The app scrapes the UN Web TV schedule (no official API), displays videos in a filterable table, embeds the Kaltura video player, and lets users generate transcripts via AssemblyAI with automatic speaker diarization and identification.

## Tech Stack

- **Framework**: Next.js 16 (App Router, Server Components, API Routes, Turbopack dev)
- **Language**: TypeScript (strict)
- **Styling**: Tailwind CSS v4 + `tw-animate-css`
- **UI**: shadcn/ui components, Lucide icons
- **Table**: TanStack Table v8
- **Database**: Turso (libSQL) — stores transcripts, speaker mappings, usage tracking, video metadata
- **Transcription**: AssemblyAI (speech-to-text with speaker diarization)
- **Speaker ID**: Azure OpenAI (GPT-4.1-mini via structured outputs / Zod schemas)
- **Video**: Kaltura embedded player (partner ID 2503451)
- **Package manager**: pnpm
- **Analysis**: Python 3.13+ with Jupyter/pandas (cost estimation notebook)

## Project Structure

```
app/
├── page.tsx                          # Homepage — server component, fetches schedule, renders VideoTable
├── layout.tsx                        # Root layout (metadata, fonts, global CSS)
├── globals.css                       # Tailwind v4 theme with UN color palette
├── video/[id]/page.tsx               # Individual video page (player + transcription panel)
├── json/route.ts                     # JSON API: all videos
├── json/[id]/route.ts                # JSON API: single video with transcript
└── api/
    ├── transcribe/route.ts           # Start transcription pipeline (AssemblyAI → speaker ID)
    ├── transcribe/segments/route.ts  # Return transcript segments/statements
    ├── transcribe/poll/route.ts      # Poll transcription status
    ├── download-hls/route.ts         # Proxy HLS stream download from Kaltura
    ├── identify-speakers/route.ts    # Trigger speaker identification for a transcript
    ├── get-speaker-mapping/route.ts  # Retrieve speaker mapping for a transcript
    └── stream-transcribe/token/      # Token endpoint for streaming transcription

components/
├── video-table.tsx                   # Main filterable/sortable table (TanStack Table, client component)
├── video-page-client.tsx             # Client wrapper for video page (player + panels)
├── video-player.tsx                  # Kaltura embedded video player
├── transcription-panel.tsx           # Transcript display with speaker labels, topics, propositions
└── live-transcription.tsx            # Real-time streaming transcription UI

lib/
├── config.ts                         # App constants (lookback days, AssemblyAI pricing)
├── turso.ts                          # Turso DB client, schema init, all CRUD for transcripts/speakers/usage/videos
├── un-api.ts                         # Scrapes UN Web TV HTML schedule, extracts metadata
├── kaltura.ts                        # Kaltura ID extraction from various URL/asset formats
├── kaltura-helpers.ts                # Higher-level Kaltura utilities (video duration, HLS URLs)
├── transcription.ts                  # Transcription pipeline orchestration (AssemblyAI + speaker ID)
├── speaker-identification.ts         # Azure OpenAI-based speaker identification & re-segmentation
├── speakers.ts                       # Speaker mapping helpers (get/set per transcript)
├── usage-tracking.ts                 # Token & cost tracking for AssemblyAI and OpenAI calls
├── country-lookup.ts                 # Country name/code lookup utilities
├── utils.ts                          # shadcn/ui cn() utility
└── load-env.ts                       # Loads .env.local via dotenv

scripts/
├── sync-videos.ts                    # Sync video metadata from UN Web TV into Turso
├── fetch-video-metadata.ts           # Fetch and store additional video metadata
├── reidentify.ts                     # Re-run speaker identification on existing transcripts
├── retranscribe.ts                   # Re-transcribe videos (e.g., after pipeline changes)
├── usage-report.ts                   # Generate usage/cost reports from tracking data
├── usage-benchmark.ts                # Benchmark transcription costs
└── compare-transcription.ts          # Compare transcription outputs (quality analysis)

analysis/
└── cost_estimate.ipynb               # Jupyter notebook for cost estimation (Python/pandas)

public/images/                        # UN logo assets (stacked/horizontal, white/black/colour)
```

## Key Concepts

### Transcription Pipeline
1. User clicks "Transcribe" on a video page
2. Backend fetches audio URL from Kaltura API
3. Audio sent to AssemblyAI for transcription with speaker diarization
4. Paragraphs stored in Turso with status `transcribing` → `transcribed`
5. Azure OpenAI identifies speakers by name/function/affiliation from transcript context
6. Optionally: topic analysis and proposition extraction
7. Status progresses through: `transcribing` → `transcribed` → `identifying_speakers` → `analyzing_topics` → `completed`

### Database (Turso)
Tables: `speaker_mappings`, `transcripts`, `processing_usage`, `videos`, `pipeline_locks`. Schema auto-created on first access via `ensureInitialized()`.

### Data Source
No official UN API — the app scrapes HTML from `https://webtv.un.org/en/schedule` for each date, extracting video metadata, Kaltura entry IDs, event codes, committee names, and session info via regex.

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `ASSEMBLYAI_API_KEY` | AssemblyAI transcription |
| `TURSO_DB` | Turso database URL |
| `TURSO_TOKEN` | Turso auth token |
| `AZURE_OPENAI_API_KEY` | Azure OpenAI for speaker identification |
| `AZURE_OPENAI_ENDPOINT` | Azure OpenAI endpoint |
| `AZURE_OPENAI_API_VERSION` | Azure OpenAI API version |
| `AZURE_OPENAI_DEPLOYMENT` | Azure OpenAI model deployment name |

## Development

```bash
pnpm install
cp .env.example .env.local   # fill in API keys
pnpm dev                      # runs next dev --turbopack on localhost:3000
```

## Conventions

- Use Tailwind CSS v4 syntax (consult docs — many v3 patterns are outdated)
- Use shadcn/ui components (`npx shadcn@latest add`)
- Use colors from `globals.css` UN theme
- Left-align content; follow clear design hierarchy
- No parallel infrastructures; prefer global solutions; avoid hard-to-find hardcoding
- Understand the API and page structure before making singular changes
