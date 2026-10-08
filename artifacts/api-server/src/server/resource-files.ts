import { Client } from '@replit/object-storage';
import { randomUUID } from 'node:crypto';
import { ResourceError } from './resource-error';
export const MAX_RESOURCE_FILE = 15 * 1024 * 1024;
export const privateResourceKey = (key: string | null): key is string => /^private\/resources\/[\w.-]+$/.test(key ?? '');
const client = () => {
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  if (!bucketId) throw new ResourceError('Private file storage is not configured. Please contact The Alliance.', 503);
  return new Client({ bucketId });
};
export function documentKind(name: string, data: Buffer) {
  if (!data.length || data.length > MAX_RESOURCE_FILE) throw new ResourceError('Choose a PDF or DOCX file no larger than 15 MB.', 400);
  if (/\.pdf$/i.test(name) && data.subarray(0, 5).equals(Buffer.from('%PDF-')))
    return { extension: 'pdf', mime: 'application/pdf' };
  if (/\.docx$/i.test(name) && data.length >= 4 && data.readUInt32LE(0) === 0x04034b50 && isWordArchive(data))
    return { extension: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
  throw new ResourceError('The file contents must be a valid PDF or DOCX. Renaming another file is not supported.', 400);
}
/** Inspect the central directory without inflating an untrusted ZIP. */
function isWordArchive(data: Buffer) {
  let end = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65557); i--)
    if (data.readUInt32LE(i) === 0x06054b50 && i + 22 + data.readUInt16LE(i + 20) === data.length) { end = i; break; }
  if (end < 0 || data.readUInt16LE(end + 4) || data.readUInt16LE(end + 6)) return false;
  const count = data.readUInt16LE(end + 10), size = data.readUInt32LE(end + 12), start = data.readUInt32LE(end + 16);
  if (!count || count > 5000 || start + size !== end) return false;
  const names = new Set<string>(); let pos = start, total = 0;
  for (let i = 0; i < count; i++) {
    if (pos + 46 > end || data.readUInt32LE(pos) !== 0x02014b50 || (data.readUInt16LE(pos + 8) & 1)) return false;
    const length = data.readUInt16LE(pos + 28);
    const next = pos + 46 + length + data.readUInt16LE(pos + 30) + data.readUInt16LE(pos + 32);
    if (next > end || data.readUInt32LE(pos + 42) >= start) return false;
    const name = data.toString('utf8', pos + 46, pos + 46 + length);
    if (name.includes('..') || name.startsWith('/') || name.includes('\\')) return false;
    if (/vbaProject\.bin$/i.test(name) || names.has(name)) return false;
    const local = data.readUInt32LE(pos + 42);
    const compressed = data.readUInt32LE(pos + 20);
    if (local + 30 > start || data.readUInt32LE(local) !== 0x04034b50) return false;
    const localNameLength = data.readUInt16LE(local + 26), extraLength = data.readUInt16LE(local + 28);
    if (local + 30 + localNameLength + extraLength + compressed > start
      || data.toString('utf8', local + 30, local + 30 + localNameLength) !== name) return false;
    names.add(name); total += data.readUInt32LE(pos + 24); pos = next;
  }
  return pos === end && total <= 100 * 1024 * 1024 && names.has('[Content_Types].xml') && names.has('word/document.xml');
}
export async function uploadResourceFile(name: string, bytes: Buffer) {
  const kind = documentKind(name, bytes), key = `private/resources/${randomUUID()}.${kind.extension}`;
  const result = await client().uploadFromBytes(key, bytes, { compress: false }).catch(() => {
    throw new ResourceError('File storage is unavailable. Your resource has not been saved; please try again.', 503);
  });
  if (!result.ok) throw new ResourceError('File storage is unavailable. Your resource has not been saved; please try again.', 503);
  return { fileKey: key, fileName: name.split(/[\\/]/).pop()!.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 180), fileMimeType: kind.mime };
}
export async function deleteResourceFile(key: string | null) {
  if (!privateResourceKey(key)) return;
  const result = await client().delete(key, { ignoreNotFound: true });
  if (!result.ok) throw new ResourceError('The unused file could not be removed from storage.', 503);
}
export const resourceFileStream = (key: string) => {
  if (!privateResourceKey(key)) throw new ResourceError('This resource has no private uploaded file.', 404);
  return client().downloadAsStream(key);
};
