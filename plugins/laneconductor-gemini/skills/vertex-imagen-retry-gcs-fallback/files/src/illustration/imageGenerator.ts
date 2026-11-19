import { GoogleGenAI, Modality } from "@google/genai";

// Image generation on Vertex AI with ADC and 429 backoff (skill vertex-imagen-retry-gcs-fallback).
const DEFAULT_MODEL = "gemini-3.1-flash-lite-image";
const MAX_RETRIES = 5;
// Gemini image models are served from the global endpoint only; text calls use GCP_REGION.
const LOCATION = "global";

export function resolveImageModel(): string {
  return process.env.IMAGE_MODEL || DEFAULT_MODEL;
}

function isRateLimited(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const status = (err as { status?: number }).status;
  return status === 429 || /RESOURCE_EXHAUSTED/i.test(err.message);
}

export interface ImageGeneratorOptions {
  /** Test seam: replace the real SDK client. */
  client?: Pick<GoogleGenAI, "models">;
  /** Test seam: skip the real backoff delay. */
  sleep?: (ms: number) => Promise<void>;
}

export class ImageGenerator {
  private client: Pick<GoogleGenAI, "models"> | undefined;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly model = resolveImageModel(), overrides: ImageGeneratorOptions = {}) {
    this.client = overrides.client;
    this.sleep = overrides.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  private getClient(): Pick<GoogleGenAI, "models"> {
    if (this.client) return this.client;
    const project = process.env.GCP_PROJECT;
    if (!project) throw new Error("GCP_PROJECT must be set to use Vertex AI (see .env.example)");
    this.client = new GoogleGenAI({ vertexai: true, project, location: LOCATION });
    return this.client;
  }

  /** Retries ONLY this call on 429 / RESOURCE_EXHAUSTED; never re-run the caller's DB or prompt work. */
  async generate(prompt: string, seed?: number, retryCount = 0): Promise<{ bytes: Buffer; mimeType: string }> {
    try {
      const response = await this.getClient().models.generateContent({
        model: this.model,
        contents: prompt,
        config: { responseModalities: [Modality.IMAGE], seed },
      });
      const parts = response.candidates?.[0]?.content?.parts ?? [];
      const image = parts.find((part) => part.inlineData?.data)?.inlineData;
      if (!image?.data) throw new Error("response carried no image data (possibly filtered by Responsible AI checks)");
      return { bytes: Buffer.from(image.data, "base64"), mimeType: image.mimeType ?? "image/png" };
    } catch (err) {
      if (isRateLimited(err) && retryCount < MAX_RETRIES) {
        // 2^n * 5000 ms + up to 2000 ms jitter: 5s, 10s, 20s, 40s, 80s
        await this.sleep(Math.pow(2, retryCount) * 5000 + Math.random() * 2000);
        return this.generate(prompt, seed, retryCount + 1);
      }
      throw err;
    }
  }
}
