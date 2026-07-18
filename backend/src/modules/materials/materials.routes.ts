import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../lib/http';
import { authenticate } from '../../middleware/auth';
import { requirePermission, requireRole } from '../../middleware/rbac';
import { badRequest, notFound } from '../../lib/errors';

export const materialsRouter = Router();
materialsRouter.use(authenticate);
materialsRouter.use(requirePermission('materials'));

const MAX_BYTES = 3 * 1024 * 1024; // 3 MB (keeps the upload under serverless body limits)

// GET /materials — list downloadable materials (metadata only).
materialsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const materials = await prisma.material.findMany({
      select: { id: true, title: true, description: true, fileName: true, mimeType: true, size: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ materials });
  })
);

// GET /materials/:id/content — download a material's file.
materialsRouter.get(
  '/:id/content',
  asyncHandler(async (req, res) => {
    const m = await prisma.material.findUnique({ where: { id: req.params.id } });
    if (!m) throw notFound('Material not found');
    // Always a download (never rendered inline) + nosniff, so a material file is
    // never interpreted as active content in the app's origin.
    const safeName = m.fileName.replace(/[\r\n"\\]/g, '_');
    res.setHeader('Content-Type', m.mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    res.send(Buffer.from(m.data, 'base64'));
  })
);

const uploadSchema = z.object({
  title: z.string().min(1).max(160),
  description: z.string().max(1000).optional(),
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  dataBase64: z.string().min(1),
});

// POST /materials — upload a material (Principal only).
materialsRouter.post(
  '/',
  requireRole('PRINCIPAL'),
  asyncHandler(async (req, res) => {
    const body = uploadSchema.parse(req.body);
    const data = body.dataBase64.replace(/^data:[^;]+;base64,/, '');
    const size = Math.floor((data.length * 3) / 4);
    if (size > MAX_BYTES) throw badRequest('File too large (max 3 MB)');
    const material = await prisma.material.create({
      data: {
        title: body.title,
        description: body.description ?? null,
        fileName: body.fileName,
        mimeType: body.mimeType,
        size,
        data,
        uploadedById: req.auth!.sub,
      },
      select: { id: true, title: true, fileName: true, size: true, createdAt: true },
    });
    res.status(201).json(material);
  })
);

// DELETE /materials/:id — remove a material (Principal only).
materialsRouter.delete(
  '/:id',
  requireRole('PRINCIPAL'),
  asyncHandler(async (req, res) => {
    const m = await prisma.material.findUnique({ where: { id: req.params.id } });
    if (!m) throw notFound('Material not found');
    await prisma.material.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  })
);
