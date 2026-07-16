import { blobHead } from "@/lib/blob";

const SUPPORTED_AUDIO_TYPES = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
]);

const TRANSCRIPTION_CONCURRENCY = 4;
const TRANSCRIPTION_RETRY_DELAY_MS = 300;

function isRetryableTranscriptionError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return false;
  }

  const status = (error as { status?: unknown }).status;
  return (
    typeof status === "number" &&
    (status === 429 || (status >= 500 && status <= 599))
  );
}

async function waitForRetry(): Promise<void> {
  await new Promise((resolve) =>
    setTimeout(resolve, TRANSCRIPTION_RETRY_DELAY_MS),
  );
}

async function downloadAudio(url: string): Promise<{
  bytes: ArrayBuffer;
  filename: string;
  contentType: string;
}> {
  const metadata = await blobHead(url);
  if (!metadata.pathname.startsWith("audio/")) {
    throw new Error("Audio URL does not point to the audio/ Blob prefix");
  }

  const downloadUrl = new URL(metadata.url);
  downloadUrl.searchParams.set("etag", metadata.etag);
  const response = await fetch(downloadUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(
      `Unable to download audio segment ${metadata.pathname}: ${response.status}`,
    );
  }

  const responseType = response.headers.get("content-type")?.split(";")[0];
  const contentType = SUPPORTED_AUDIO_TYPES.has(metadata.contentType)
    ? metadata.contentType
    : responseType && SUPPORTED_AUDIO_TYPES.has(responseType)
      ? responseType
      : "audio/webm";

  return {
    bytes: await response.arrayBuffer(),
    filename: metadata.pathname.split("/").at(-1) ?? "segment.webm",
    contentType,
  };
}

export async function transcribeAudioUrls(audioUrls: string[]): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  const { default: OpenAI, toFile } = await import("openai");
  // Keep retries explicit and bounded so each model receives at most one retry.
  const client = new OpenAI({ apiKey, maxRetries: 0 });
  const transcripts = new Array<string>(audioUrls.length);
  let nextIndex = 0;

  async function transcribeOne(url: string): Promise<string> {
    const audio = await downloadAudio(url);

    async function transcribeWithRetry(
      model: "gpt-4o-transcribe" | "whisper-1",
    ): Promise<string> {
      for (let attempt = 0; ; attempt += 1) {
        const file = await toFile(audio.bytes, audio.filename, {
          type: audio.contentType,
        });

        try {
          const result = await client.audio.transcriptions.create({
            file,
            model,
            language: "ko",
          });
          return result.text;
        } catch (error) {
          if (attempt === 0 && isRetryableTranscriptionError(error)) {
            await waitForRetry();
            continue;
          }
          throw error;
        }
      }
    }

    let text: string;
    try {
      text = await transcribeWithRetry("gpt-4o-transcribe");
    } catch (error) {
      console.error(
        "gpt-4o-transcribe failed; falling back to whisper-1",
        error,
      );
      text = await transcribeWithRetry("whisper-1");
    }

    return text.trim();
  }

  async function worker(): Promise<void> {
    while (nextIndex < audioUrls.length) {
      const index = nextIndex;
      nextIndex += 1;
      transcripts[index] = await transcribeOne(audioUrls[index]);
    }
  }

  const workerCount = Math.min(TRANSCRIPTION_CONCURRENCY, audioUrls.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return transcripts.filter(Boolean).join(" ");
}
