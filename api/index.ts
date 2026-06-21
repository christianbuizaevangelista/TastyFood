// Vercel serverless entry. The Express app (compiled to backend/dist by the
// `vercel-build` step) is itself a (req, res) handler, so we export it directly.
// vercel.json rewrites every /api/* request here, preserving the original URL,
// so the app's existing `/api/...` routes match unchanged.
import { createApp } from '../backend/dist/app';

const app = createApp();

export default app;
