import { prisma } from './prisma';

// Returns the unique, lowercased email recipients at an org who should receive a
// feature notification: the org's contact email plus every active user who is the
// owner or has been granted the given permission. This is how staff get notified
// for the features they're assigned to (mana, purchase-orders, inventory, …).
export async function notifyRecipients(orgId: string, permission: string): Promise<string[]> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    include: {
      users: {
        where: { isActive: true, OR: [{ isOwner: true }, { permissions: { has: permission } }] },
        select: { email: true },
      },
    },
  });
  if (!org) return [];
  const all = [
    ...(org.contactEmail ? [org.contactEmail] : []),
    ...org.users.map((u) => u.email),
  ];
  return [...new Set(all.filter(Boolean).map((e) => e.toLowerCase()))];
}
