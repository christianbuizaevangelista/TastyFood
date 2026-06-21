import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../lib/http';
import { authenticate } from '../../middleware/auth';
import { requireRole } from '../../middleware/rbac';
import { notFound } from '../../lib/errors';

export const productsRouter = Router();
productsRouter.use(authenticate);

// Anyone authenticated can read the catalog (SRP is the pricing basis).
productsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const products = await prisma.product.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
    res.json({ products });
  })
);

const productSchema = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  category: z.string().optional(),
  srp: z.number().positive(),
});

// Only the Principal manages the product catalog.
productsRouter.post(
  '/',
  requireRole('PRINCIPAL'),
  asyncHandler(async (req, res) => {
    const body = productSchema.parse(req.body);
    const product = await prisma.product.create({ data: body });
    res.status(201).json(product);
  })
);

productsRouter.put(
  '/:id',
  requireRole('PRINCIPAL'),
  asyncHandler(async (req, res) => {
    const body = productSchema.partial().parse(req.body);
    const existing = await prisma.product.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('Product not found');
    const product = await prisma.product.update({ where: { id: req.params.id }, data: body });
    res.json(product);
  })
);
