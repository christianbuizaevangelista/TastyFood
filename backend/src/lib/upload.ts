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

// Sends a stored file back to the browser with defenses against a stored file
// ever being interpreted as active content in the app's origin:
//  - nosniff: the browser must honour the declared type, not guess it;
//  - a locked-down CSP + sandbox: even if the type were HTML, no script runs;
//  - the declared type is re-validated against the allowlist before sending.
export function sendStoredFile(
  res: Response,
  file: { mimeType: string; fileName: string; data: string },
  disposition: 'inline' | 'attachment' = 'inline'
): void {
  const safeType = ALLOWED_UPLOAD_TYPES.includes(file.mimeType.toLowerCase() as any)
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
