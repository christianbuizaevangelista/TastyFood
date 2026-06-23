import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../lib/http';
import { authenticate } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { badRequest, forbidden, notFound, conflict } from '../../lib/errors';
import { canApproveOrgOnboarding } from './approvals.service';

export const approvalsRouter = Router();
approvalsRouter.use(authenticate);
approvalsRouter.use(requirePermission('approvals'));

// GET /approvals — pending items the requester can act on.
approvalsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const scope = req.scopeOrgIds!;
    const status = (req.query.status as string) || 'PENDING';

    const approvals = await prisma.approval.findMany({
      where: {
        status: status as any,
        OR: [
          { type: 'ORG_ONBOARDING', org: { id: { in: scope } } },
          { type: 'PO_APPROVAL', po: { sellerOrgId: req.auth!.orgId } },
        ],
      },
      include: {
        org: { select: { id: true, name: true, type: true, parentId: true, contactName: true } },
        po: {
          select: {
            id: true,
            number: true,
            total: true,
            distributionType: true,
            buyerOrg: { select: { name: true, type: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ approvals });
  })
);

const decideSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED']),
  note: z.string().optional(),
});

// POST /approvals/:id/decide — decide an ORG_ONBOARDING approval.
// (PO approvals are decided through the /purchase-orders endpoints.)
approvalsRouter.post(
  '/:id/decide',
  asyncHandler(async (req, res) => {
    const body = decideSchema.parse(req.body);
    const approval = await prisma.approval.findUnique({
      where: { id: req.params.id },
      include: { org: true },
    });
    if (!approval) throw notFound('Approval not found');
    if (approval.status !== 'PENDING') throw conflict('Approval already decided');
    if (approval.type !== 'ORG_ONBOARDING') {
      throw badRequest('PO approvals are decided via the purchase order endpoints');
    }

    const ok = await canApproveOrgOnboarding(
      req.auth!.role,
      req.auth!.orgId,
      approval.org.type,
      approval.orgId
    );
    if (!ok) throw forbidden('You are not authorized to decide this onboarding approval');

    const result = await prisma.$transaction(async (tx) => {
      const a = await tx.approval.update({
        where: { id: approval.id },
        data: {
          status: body.status,
          note: body.note,
          decidedById: req.auth!.sub,
          decidedAt: new Date(),
        },
      });
      await tx.organization.update({
        where: { id: approval.orgId },
        data: { status: body.status === 'APPROVED' ? 'APPROVED' : 'REJECTED' },
      });
      return a;
    });

    res.json(result);
  })
);
