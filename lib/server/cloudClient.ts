/**
 * Server-side R2 client for Vercel API routes.
 * Uses R2 credentials from environment variables directly.
 */
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

let r2Client: S3Client | null = null;

function getR2Client(): S3Client {
  if (!r2Client) {
    const accountId = process.env.R2_ACCOUNT_ID;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    const bucket = process.env.R2_BUCKET;

    if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
      throw new Error('R2 credentials not configured');
    }

    r2Client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
  }
  return r2Client;
}

/**
 * Download a file from R2 as Uint8Array.
 */
export async function downloadFromR2Server(key: string): Promise<Uint8Array> {
  const client = getR2Client();
  const bucket = process.env.R2_BUCKET!;
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  const response = await client.send(command);
  if (!response.Body) throw new Error('Empty response from R2');
  const chunks: Uint8Array[] = [];
  for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}