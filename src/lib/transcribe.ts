// OpenAI Whisper speech-to-text. Kept tiny and dependency-free (multipart via
// fetch) so it works in a serverless route. Whisper accepts mp4/mov/webm/etc.
// and pulls the audio itself; the hard limit is 25 MB per file.

export const WHISPER_MAX_BYTES = 25 * 1024 * 1024;

export class TranscribeNotConfigured extends Error {
  constructor() {
    super("Transcription isn't configured — set OPENAI_API_KEY.");
  }
}

// Returns the plain-text transcript. Throws TranscribeNotConfigured when no key,
// or a descriptive Error on an API failure.
export async function transcribeAudio(file: Blob, fileName: string): Promise<string> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new TranscribeNotConfigured();

  const form = new FormData();
  form.append("file", file, fileName);
  form.append("model", "whisper-1");
  form.append("response_format", "text");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Whisper ${res.status}: ${detail.slice(0, 300)}`);
  }
  return (await res.text()).trim();
}
