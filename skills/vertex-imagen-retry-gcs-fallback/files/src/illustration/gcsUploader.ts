import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Storage } from "@google-cloud/storage";

// Upload generated images to GCS (skill vertex-imagen-retry-gcs-fallback). ADC, no key file.
// Local fallback is for development only. In production a failed upload must fail loudly:
// a localhost URL stored in the database is silently broken for every real visitor.
export class GcsUploader {
  constructor(
    private readonly bucketName: string = process.env.GCS_BUCKET ?? "",
    /** Test seam: tests must NOT write into the real generated-images/ folder (a suite once wiped real PNGs). */
    private readonly localDir: string = join(process.cwd(), "generated-images"),
  ) {}

  async uploadImage(key: string, buffer: Buffer, contentType: string): Promise<string> {
    if (process.env.LOCAL_DEV === "true") return this.saveLocally(key, buffer);
    try {
      if (!this.bucketName) throw new Error("GCS_BUCKET must be set (see .env.example)");
      const bucket = new Storage().bucket(this.bucketName);
      await bucket.file(key).save(buffer, {
        metadata: { contentType, cacheControl: "public, max-age=31536000" },
      });
      return `https://storage.googleapis.com/${bucket.name}/${key}`;
    } catch (err) {
      if (process.env.NODE_ENV === "production") throw err;
      console.warn(`bucket upload failed, falling back to local storage: ${err instanceof Error ? err.message : String(err)}`);
      return this.saveLocally(key, buffer);
    }
  }

  private saveLocally(key: string, buffer: Buffer): string {
    const filePath = join(this.localDir, key);
    if (!existsSync(dirname(filePath))) mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, buffer);
    // Store the same-origin path in the database, not this machine's URL: /generated-images/<key>
    return `/generated-images/${key}`;
  }
}
