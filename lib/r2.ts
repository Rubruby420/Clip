import {
  S3Client,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const R2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.CLOUDFLARE_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY!,
  },
  // Prevent the SDK from forcing x-amz-checksum headers, which break
  // browser uploads via presigned URLs (CORS / signature mismatch).
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
  // R2 only guarantees DNS for `<account>.r2.cloudflarestorage.com`. The
  // SDK's default virtual-hosted style (`<bucket>.<account>...`) can resolve
  // in some browsers but fails server-side with ENOTFOUND, which broke the
  // export route's source-video download.
  forcePathStyle: true,
});

const BUCKET = process.env.CLOUDFLARE_R2_BUCKET_NAME!;
const PUBLIC_URL = process.env.CLOUDFLARE_R2_PUBLIC_URL!;

export interface UploadedPart {
  partNumber: number;
  etag: string;
}

/** Start a multipart upload, returns the R2 uploadId. */
export async function createMultipartUpload(key: string, contentType: string): Promise<string> {
  const res = await R2.send(
    new CreateMultipartUploadCommand({ Bucket: BUCKET, Key: key, ContentType: contentType })
  );
  if (!res.UploadId) throw new Error("R2 did not return an UploadId");
  return res.UploadId;
}

/** Presign a single part-upload PUT URL the browser can use directly. */
export async function signUploadPart(
  key: string,
  uploadId: string,
  partNumber: number
): Promise<string> {
  return getSignedUrl(
    R2,
    new UploadPartCommand({
      Bucket: BUCKET,
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
    }),
    { expiresIn: 21600 } // 6 hours — enough for slow connections / large files
  );
}

/** Finalise a multipart upload once all parts are uploaded. */
export async function completeMultipartUpload(
  key: string,
  uploadId: string,
  parts: UploadedPart[]
): Promise<void> {
  await R2.send(
    new CompleteMultipartUploadCommand({
      Bucket: BUCKET,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: parts
          .sort((a, b) => a.partNumber - b.partNumber)
          .map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
      },
    })
  );
}

/** Cancel an in-progress multipart upload (cleanup on failure). */
export async function abortMultipartUpload(key: string, uploadId: string): Promise<void> {
  await R2.send(
    new AbortMultipartUploadCommand({ Bucket: BUCKET, Key: key, UploadId: uploadId })
  );
}

export async function getDownloadPresignedUrl(key: string): Promise<string> {
  return getSignedUrl(R2, new GetObjectCommand({ Bucket: BUCKET, Key: key }), {
    expiresIn: 3600,
  });
}

// Presigned URL that makes R2 send the object with Content-Disposition:
// attachment, so the browser saves the file to disk instead of streaming it
// inline. Used by the editor's Download button — `<a download>` is ignored
// cross-origin, but this header is honoured everywhere.
export async function getAttachmentDownloadUrl(key: string, filename: string): Promise<string> {
  return getSignedUrl(
    R2,
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ResponseContentDisposition: `attachment; filename="${filename}"`,
    }),
    { expiresIn: 3600 }
  );
}

export function getPublicUrl(key: string): string {
  return `${PUBLIC_URL}/${key}`;
}

export async function deleteObject(key: string): Promise<void> {
  await R2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

export async function uploadBuffer(
  key: string,
  buffer: Buffer,
  contentType: string
): Promise<string> {
  await R2.send(
    new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: buffer, ContentType: contentType })
  );
  return getPublicUrl(key);
}

export function r2EnvMissing(): string[] {
  return [
    "CLOUDFLARE_R2_ACCOUNT_ID",
    "CLOUDFLARE_R2_ACCESS_KEY_ID",
    "CLOUDFLARE_R2_SECRET_ACCESS_KEY",
    "CLOUDFLARE_R2_BUCKET_NAME",
    "CLOUDFLARE_R2_PUBLIC_URL",
  ].filter((k) => !process.env[k]);
}
