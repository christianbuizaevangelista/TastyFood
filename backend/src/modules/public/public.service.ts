import { prisma } from '../../lib/prisma';

// Shared helpers for the unauthenticated landing-page and application routes.
// They live here rather than in either router because both need them, and
// because getting any of them wrong loses a real enquiry.

// Every sign-up and application has to land in a funnel. Leaving the landing
// page's funnel unset used to mean registrations quietly became leads for
// nobody, which is indistinguishable from losing them — so fall back to an
// existing active funnel, and create one if the account has none at all.
export async function resolveFunnel(funnelId: string | null, createdById: string | null) {
  if (funnelId) {
    const chosen = await prisma.leadFunnel.findUnique({ where: { id: funnelId } });
    if (chosen) return chosen;
  }
  const existing = await prisma.leadFunnel.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'asc' },
  });
  if (existing) return existing;

  // Nothing to attach to and no author to credit — better to skip than to
  // create an orphaned funnel owned by nobody.
  if (!createdById) return null;
  return prisma.leadFunnel.create({
    data: {
      name: 'Distributor Recruitment',
      description: 'Sign-ups from the /join landing page and Zoom orientations.',
      stages: ['Registered', 'Attended orientation', 'Application sent', 'Interviewed', 'Signed'],
      createdById,
    },
  });
}

// Move a lead forward when something real happens. Stage names are written by
// the user, so match on meaning first and fall back to nudging one step. Never
// move a lead backwards, and never touch one that is already won or lost.
export async function advanceLead(leadId: string | null | undefined, keywords: string[]): Promise<void> {
  if (!leadId) return;
  try {
    const lead = await prisma.lead.findUnique({ where: { id: leadId }, include: { funnel: true } });
    if (!lead || lead.status !== 'OPEN') return;
    const found = lead.funnel.stages.findIndex((s) =>
      keywords.some((k) => s.toLowerCase().includes(k))
    );
    const target = found >= 0 ? found : Math.min(lead.stageIndex + 1, lead.funnel.stages.length - 1);
    if (target > lead.stageIndex) {
      await prisma.lead.update({ where: { id: lead.id }, data: { stageIndex: target } });
    }
  } catch (err: any) {
    // A funnel problem must never cost us the thing that triggered it.
    console.error('[public.advanceLead]', err?.message);
  }
}

// The one person who owns the business. Applications and concerns go to them
// alone, never to Principal staff.
export async function principalOwnerEmail(): Promise<string | null> {
  const owner = await prisma.user.findFirst({
    where: { role: 'PRINCIPAL', isOwner: true, isActive: true },
    select: { email: true },
    orderBy: { createdAt: 'asc' },
  });
  return owner?.email ?? null;
}
