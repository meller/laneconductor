import { GoogleGenAI } from "@google/genai";

// Vertex AI + Application Default Credentials: no API key (skill vertex-gemini-adc).
// Locally: `gcloud auth application-default login`. In Cloud Functions: the runtime service account.
let client: GoogleGenAI | undefined;

export function geminiModel(): string {
  return process.env.GEMINI_MODEL || "gemini-2.5-flash";
}

export function getGeminiClient(): GoogleGenAI {
  if (client) return client;
  const project = process.env.GCP_PROJECT;
  const location = process.env.GCP_REGION;
  if (!project || !location) {
    throw new Error("GCP_PROJECT and GCP_REGION must be set to use Vertex AI (see .env.example)");
  }
  client = new GoogleGenAI({
    vertexai: true,
    project,
    location,
    // Bound the SDK's own retries (default 5 attempts) so a transient 503 cannot hang for minutes.
    httpOptions: { timeout: 30000, retryOptions: { attempts: 2 } },
  });
  return client;
}

export async function generateJson(prompt: string, responseSchema: unknown) {
  const response = await getGeminiClient().models.generateContent({
    model: geminiModel(),
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      responseSchema: responseSchema as any,
      temperature: 0, // extraction/classification: no upside to sampling
      thinkingConfig: { thinkingBudget: 0 }, // Flash tier only; Pro needs >= 128
    },
  });
  if (response.text === undefined) throw new Error("Gemini response carried no text (blocked or empty)");
  return {
    text: response.text,
    // thinking tokens are billed as output but arrive in a separate usage field
    tokensIn: response.usageMetadata?.promptTokenCount ?? 0,
    tokensOut: (response.usageMetadata?.candidatesTokenCount ?? 0) + (response.usageMetadata?.thoughtsTokenCount ?? 0),
  };
}
