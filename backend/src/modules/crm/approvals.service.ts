import { OrgType, UserRole } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { getDescendantOrgIds } from '../../lib/scope';

// Which org types each role is allowed to approve for onboarding.
//  - Principal approves Provincial & City distributors.
//  - Provincial approves Resellers (within its chain).
const ONBOARDING_RIGHTS: Partial<Record<UserRole, OrgType[]>> = {
  PRINCIPAL: ['PROVINCIAL', 'CITY'],
  PROVINCIAL: ['RESELLER'],
};

export async function canApproveOrgOnboarding(
  role: UserRole,
  approverOrgId: string,
  subjectOrgType: OrgType,
  subjectOrgId: string
): Promise<boolean> {
  const allowed = ONBOARDING_RIGHTS[role];
  if (!allowed || !allowed.includes(subjectOrgType)) return false;
  // Subject must be within the approver's descendant chain.
  const scope = await getDescendantOrgIds(approverOrgId);
  return scope.includes(subjectOrgId);
}

// Count of approvals the given user can currently act on (org onboarding + PO).
export async function pendingApprovalsCount(role: UserRole, orgId: string): Promise<number> {
  const poPending = await prisma.approval.count({
    where: { type: 'PO_APPROVAL', status: 'PENDING', po: { sellerOrgId: orgId } },
  });

  const allowedTypes = ONBOARDING_RIGHTS[role];
  let onboardingPending = 0;
  if (allowedTypes && allowedTypes.length > 0) {
    const scope = await getDescendantOrgIds(orgId);
    onboardingPending = await prisma.approval.count({
      where: {
        type: 'ORG_ONBOARDING',
        status: 'PENDING',
        org: { id: { in: scope }, type: { in: allowedTypes } },
      },
    });
  }
  return poPending + onboardingPending;
}
