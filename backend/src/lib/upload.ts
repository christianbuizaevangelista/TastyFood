import { Response } from 'express';
import { badRequest } from './errors';

// The only file types any upload endpoint accepts. Everything users can upload
// (proof of payment, valid IDs, agreements, receipts, materials) is an image or
// a PDF — never HTML/SVG/scripts, which could execute if served back inline.
export const ALLOWED_UPLOAD_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'application/pdf',
] as const;

export function assertAllowedUploadType(mimeType: string): void {
  if (!ALLOWED_UPLOAD_TYPES.includes(mimeType.toLowerCase() as any)) {
    throw badRequest('File must be an image (PNG/JPG/WEBP) or PDF');
  }
}

// Downloadables legitimately carry price lists and forms, not just proofs, so
// they take a wider set — but still a list, never "anything the client says".
export const ALLOWED_DOCUMENT_TYPES = [
  ...ALLOWED_UPLOAD_TYPES,
  'text/plain',
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip',
] as const;

export function assertAllowedDocumentType(mimeType: string): void {
  if (!ALLOWED_DOCUMENT_TYPES.includes(mimeType.toLowerCase() as any)) {
    throw badRequest('Unsupported file type. Use a PDF, image, Office document, CSV or ZIP.');
  }
}

// Sends a stored file back to the browser with defenses against a stored file
// ever being interpreted as active content in the app's origin:
//  - nosniff: the browser must honour the declared type, not guess it;
//  - a locked-down CSP + sandbox: even if the type were HTML, no script runs;
//  - the declared type is re-validated against the allowlist before sending.
export function sendStoredFile(
  res: Response,
  file: { mimeType: string; fileName: string; data: string },
  disposition: 'inline' | 'attachment' = 'inline',
  // Which types may keep their declared value. Downloadables pass the wider
  // document list so a spreadsheet is not flattened to octet-stream; anything
  // outside the list still falls back, so the default stays strict.
  allowed: readonly string[] = ALLOWED_UPLOAD_TYPES
): void {
  const safeType = allowed.includes(file.mimeType.toLowerCase())
    ? file.mimeType
    : 'application/octet-stream';
  // Strip anything that could break out of the filename header.
  const safeName = file.fileName.replace(/[\r\n"\\]/g, '_');
  res.setHeader('Content-Type', safeType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Content-Disposition', `${disposition}; filename="${safeName}"`);
  res.send(Buffer.from(file.data, 'base64'));
}
