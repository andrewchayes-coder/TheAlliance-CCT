import { Client } from '@replit/object-storage';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';

export const MAX_PROFILE_PHOTO = 3 * 1024 * 1024;
export class PhotoError extends Error { constructor(message: string, public status = 400) { super(message); } }
const validKey = (key: string) => /^private\/profiles\/[a-f0-9-]+\.png$/.test(key);
const client = () => {
  if (!process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID) throw new PhotoError('Photo storage is not configured yet. Please contact Alliance staff.', 503);
  return new Client({ bucketId: process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID });
};
export async function preparePhoto(bytes: Buffer) {
  if (!bytes.length || bytes.length > MAX_PROFILE_PHOTO) throw new PhotoError('Choose a PNG, JPEG or WebP photo no larger than 3 MB.');
  try {
    const image = sharp(bytes, { limitInputPixels: 16_777_216, animated: false });
    const metadata = await image.metadata();
    if (!['png', 'jpeg', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) > 1) throw new Error('Unsupported image');
    // Decode/re-encode instead of trusting a filename or MIME header. Strip EXIF/GPS metadata.
    return await image.rotate().resize(512, 512, { fit: 'cover', withoutEnlargement: true }).png().toBuffer();
  } catch {
    throw new PhotoError('This file could not be read as a photo. Choose a valid PNG, JPEG or WebP image.');
  }
}
export async function uploadPhoto(bytes: Buffer) {
  const image = await preparePhoto(bytes);
  const key = `private/profiles/${randomUUID()}.png`;
  const result = await client().uploadFromBytes(key, image, { compress: false });
  if (!result.ok) throw new PhotoError('Your photo could not be uploaded. Please try again.', 503);
  return key;
}
export async function deletePhoto(key: string | null) {
  if (!key || !validKey(key)) return;
  const result = await client().delete(key, { ignoreNotFound: true });
  if (!result.ok) throw new PhotoError('An unused profile photo needs storage cleanup.', 503);
}
export function photoStream(key: string) {
  if (!validKey(key)) throw new PhotoError('Photo not found.', 404);
  return client().downloadAsStream(key);
}
