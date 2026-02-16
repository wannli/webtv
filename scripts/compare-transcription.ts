#!/usr/bin/env tsx
import '../lib/load-env';
import { AzureOpenAI } from 'openai';
import { resolveEntryId } from '../lib/kaltura-helpers';
import { getKalturaAudioUrl } from '../lib/transcription';
import fs from 'fs';
import path from 'path';
import os from 'os';

const ASSEMBLYAI_API_KEY = process.env.ASSEMBLYAI_API_KEY!;

const usage = `Usage:
  npm run compare-transcribe -- <asset-id|entry-id>

Runs both Azure OpenAI gpt-4o-transcribe-diarize and AssemblyAI on the same
UN Web TV video, writing results to two .txt files for easy diff comparison.`;

const rawArg = process.argv[2];
if (!rawArg) {
  console.error(usage);
  process.exit(1);
}
const decodedArg = decodeURIComponent(rawArg.trim());

const outputDir = path.join(process.cwd(), 'transcription-comparisons');

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ── Resolve video & get audio URL ───────────────────────────────────────

async function resolveAudio(input: string) {
  const entryId = await resolveEntryId(input);
  if (!entryId) throw new Error(`Could not resolve entry ID for: ${input}`);

  console.log(`Entry ID: ${entryId}`);
  const { audioUrl } = await getKalturaAudioUrl(entryId);
  console.log(`Audio URL: ${audioUrl}\n`);

  return { entryId, audioUrl };
}

// ── Download audio to temp file (needed for Azure file upload) ──────────

async function downloadAudio(audioUrl: string, entryId: string): Promise<string> {
  console.log('[Azure] Downloading audio...');
  const res = await fetch(audioUrl, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);

  const buffer = Buffer.from(await res.arrayBuffer());
  const tmpPath = path.join(os.tmpdir(), `compare-${entryId}.mp4`);
  fs.writeFileSync(tmpPath, buffer);
  const sizeMB = (buffer.length / 1024 / 1024).toFixed(1);
  console.log(`[Azure] Downloaded ${sizeMB} MB to ${tmpPath}`);
  return tmpPath;
}

// ── Azure OpenAI gpt-4o-transcribe-diarize ──────────────────────────────

async function runAzureTranscribe(audioUrl: string, entryId: string): Promise<string> {
  console.log('[Azure] Starting gpt-4o-transcribe-diarize...');

  const tmpPath = await downloadAudio(audioUrl, entryId);

  try {
    const client = new AzureOpenAI({
      apiKey: process.env.AZURE_OPENAI_API_KEY,
      endpoint: process.env.AZURE_OPENAI_ENDPOINT,
      apiVersion: process.env.AZURE_OPENAI_API_VERSION,
    });

    const response = await client.audio.transcriptions.create({
      model: 'gpt-4o-transcribe-diarize',
      file: fs.createReadStream(tmpPath),
      response_format: 'diarized_json',
      chunking_strategy: 'auto',
    });

    // Save raw response for inspection
    const raw = response as any;
    fs.writeFileSync(
      path.join(outputDir, `${entryId}_azure_raw.json`),
      JSON.stringify(raw, null, 2),
    );
    console.log('[Azure] Raw JSON saved.');

    // Group consecutive segments by speaker into turns
    const turns: { speaker: string; start: number; end: number; texts: string[] }[] = [];
    if (raw.segments && Array.isArray(raw.segments)) {
      for (const seg of raw.segments) {
        const last = turns[turns.length - 1];
        if (last && last.speaker === seg.speaker) {
          last.end = seg.end;
          last.texts.push(seg.text.trim());
        } else {
          turns.push({ speaker: seg.speaker, start: seg.start, end: seg.end, texts: [seg.text.trim()] });
        }
      }
    }

    const lines = turns.map((t, i) => {
      const start = formatTime(t.start * 1000);
      const end = formatTime(t.end * 1000);
      return `[${i + 1}] Speaker ${t.speaker} (${start} - ${end})\n${t.texts.join(' ')}\n`;
    });

    console.log('[Azure] Done.');
    return lines.join('\n');
  } finally {
    fs.unlinkSync(tmpPath);
  }
}

// ── AssemblyAI ──────────────────────────────────────────────────────────

async function runAssemblyAI(audioUrl: string, entryId: string): Promise<string> {
  console.log('[AssemblyAI] Submitting transcription...');

  // Submit with audio URL directly (no upload needed)
  const submitRes = await fetch('https://api.assemblyai.com/v2/transcript', {
    method: 'POST',
    headers: {
      authorization: ASSEMBLYAI_API_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      audio_url: audioUrl,
      speaker_labels: true,
    }),
  });
  const { id: transcriptId } = (await submitRes.json()) as any;
  console.log(`[AssemblyAI] Submitted (${transcriptId}), polling...`);

  // Poll
  let result: any;
  for (let i = 0; ; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const pollRes = await fetch(
      `https://api.assemblyai.com/v2/transcript/${transcriptId}`,
      { headers: { authorization: ASSEMBLYAI_API_KEY } },
    );
    result = await pollRes.json();
    if (result.status === 'completed') break;
    if (result.status === 'error')
      throw new Error(`AssemblyAI error: ${result.error}`);
    if (i % 6 === 5) console.log(`[AssemblyAI] Still processing... (${(i + 1) * 5}s)`);
  }
  console.log('[AssemblyAI] Transcription complete.');

  // Save raw response
  fs.writeFileSync(
    path.join(outputDir, `${entryId}_assemblyai_raw.json`),
    JSON.stringify(result, null, 2),
  );

  // Format with speaker labels using utterances (one per speaker turn)
  let lines: string[] = [];
  if (result.utterances && result.utterances.length > 0) {
    lines = result.utterances.map((utt: any, i: number) => {
      const start = formatTime(utt.start);
      const end = formatTime(utt.end);
      return `[${i + 1}] Speaker ${utt.speaker} (${start} - ${end})\n${utt.text}\n`;
    });
  } else {
    lines.push(result.text ?? '(no text returned)');
  }

  console.log('[AssemblyAI] Done.');
  return lines.join('\n');
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  const { entryId, audioUrl } = await resolveAudio(decodedArg);

  fs.mkdirSync(outputDir, { recursive: true });

  const [azureResult, assemblyResult] = await Promise.all([
    runAzureTranscribe(audioUrl, entryId),
    runAssemblyAI(audioUrl, entryId),
  ]);

  const azureFile = path.join(outputDir, `${entryId}_azure.txt`);
  const assemblyFile = path.join(outputDir, `${entryId}_assemblyai.txt`);

  fs.writeFileSync(azureFile, azureResult);
  fs.writeFileSync(assemblyFile, assemblyResult);

  console.log(`\n✓ Results written to:`);
  console.log(`  Azure:      ${azureFile}`);
  console.log(`  AssemblyAI: ${assemblyFile}`);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
