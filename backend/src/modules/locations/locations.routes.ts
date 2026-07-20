import { Router } from 'express';
import { asyncHandler } from '../../lib/http';
import { authenticate } from '../../middleware/auth';
import { HttpError } from '../../lib/errors';

// Proxies the public PSGC (Philippine Standard Geographic Code) API so the
// browser avoids CORS and we can cache the rarely-changing province list.
export const locationsRouter = Router();
locationsRouter.use(authenticate);

const BASE = 'https://psgc.gitlab.io/api';
let provincesCache: { code: string; name: string }[] | null = null;

// PSGC classifies Metro Manila as a REGION (NCR), not a province, so its 17
// cities never appear under /provinces and can't be picked. Since the address
// picker asks for a province, NCR is offered as one under the name people
// actually use, and its cities are read from the region endpoint instead.
const NCR_CODE = '130000000';
const NCR_NAME = 'Metro Manila';

async function psgc(path: string): Promise<any[]> {
  const r = await fetch(`${BASE}${path}`);
  if (!r.ok) throw new HttpError(502, `Location service error (${r.status})`);
  return (await r.json()) as any[];
}

function simplify(arr: any[]): { code: string; name: string }[] {
  return arr
    .map((x) => ({ code: String(x.code), name: String(x.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// GET /locations/provinces
locationsRouter.get(
  '/provinces',
  asyncHandler(async (_req, res) => {
    if (!provincesCache) {
      const provinces = await psgc('/provinces/');
      provincesCache = simplify([...provinces, { code: NCR_CODE, name: NCR_NAME }]);
    }
    res.json({ provinces: provincesCache });
  })
);

// GET /locations/provinces/:code/cities
locationsRouter.get(
  '/provinces/:code/cities',
  asyncHandler(async (req, res) => {
    const path =
      req.params.code === NCR_CODE
        ? `/regions/${NCR_CODE}/cities-municipalities/`
        : `/provinces/${req.params.code}/cities-municipalities/`;
    res.json({ cities: simplify(await psgc(path)) });
  })
);

// GET /locations/cities/:code/barangays
locationsRouter.get(
  '/cities/:code/barangays',
  asyncHandler(async (req, res) => {
    const barangays = simplify(await psgc(`/cities-municipalities/${req.params.code}/barangays/`));
    res.json({ barangays });
  })
);
