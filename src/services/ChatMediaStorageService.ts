import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

export const CHAT_MEDIA_DIR = process.env.CHAT_MEDIA_DIR
  ? path.resolve(process.env.CHAT_MEDIA_DIR)
  : path.resolve(process.cwd(), 'uploads', 'chat-media');

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'audio/ogg': '.ogg',
  'audio/opus': '.opus',
  'audio/webm': '.webm',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'text/plain': '.txt',
  'text/csv': '.csv',
};

function safeExtension(mimeType: string): string {
  const mapped = EXTENSIONS[mimeType.split(';', 1)[0].trim().toLowerCase()];
  if (mapped) return mapped;
  // Never reflect an arbitrary uploaded extension into a publicly-served
  // path (e.g. .html/.svg). Unknown formats are inert binary downloads.
  return '.bin';
}

export interface StoredChatMedia {
  mediaUrl: string;
  mediaMimeType: string;
  mediaFileName?: string;
  mediaSize: number;
}

/** Persist a chat attachment outside MongoDB and return public message fields. */
export async function storeChatMedia(
  buffer: Buffer,
  mimeType: string,
  originalName?: string,
): Promise<StoredChatMedia> {
  if (!buffer.length) throw new Error('Cannot store an empty media file');
  const normalizedMime =
    mimeType.split(';', 1)[0].trim().toLowerCase() ||
    'application/octet-stream';
  await fs.mkdir(CHAT_MEDIA_DIR, { recursive: true });
  const storedName = `${Date.now()}-${randomUUID()}${safeExtension(
    normalizedMime,
  )}`;
  await fs.writeFile(path.join(CHAT_MEDIA_DIR, storedName), buffer, {
    flag: 'wx',
  });
  return {
    mediaUrl: `/uploads/chat-media/${storedName}`,
    mediaMimeType: normalizedMime,
    mediaFileName: originalName,
    mediaSize: buffer.length,
  };
}
