import { PrismaClient, TerritoryLevel } from '@prisma/client';

// Seeds the geographic territory tree and links existing orgs to their
// territory by their admin user's login email (stable across data edits).
// Safe to run repeatedly: it only resets the Territory table.
export async function seedTerritories(prisma: PrismaClient) {
  await prisma.territory.deleteMany();

  const users = await prisma.user.findMany({ select: { email: true, orgId: true } });
  const orgIdByEmail = new Map(users.map((u) => [u.email, u.orgId]));

  async function t(name: string, level: TerritoryLevel, parentId: string | null, assignEmail?: string) {
    const assignedOrgId = assignEmail ? orgIdByEmail.get(assignEmail) ?? null : null;
    return prisma.territory.create({ data: { name, level, parentId, assignedOrgId } });
  }

  // --- Luzon ---------------------------------------------------------------
  const luzon = await t('Luzon', 'REGION', null);
  const cavite = await t('Cavite', 'PROVINCE', luzon.id, 'provincial1@tasty.test');

  const dasma = await t('Dasmariñas City', 'CITY', cavite.id, 'city1@tasty.test');
  await t('Barangay Burol', 'BARANGAY', dasma.id, 'reseller1@tasty.test');
  await t('Barangay Salitran', 'BARANGAY', dasma.id, 'reseller2@tasty.test');
  await t('Barangay Sampaloc', 'BARANGAY', dasma.id); // vacant

  const srosa = await t('Santa Rosa City', 'CITY', cavite.id, 'city2@tasty.test');
  await t('Barangay Balibago', 'BARANGAY', srosa.id, 'reseller3@tasty.test');
  await t('Barangay Macabling', 'BARANGAY', srosa.id); // vacant

  const imus = await t('Imus City', 'CITY', cavite.id); // vacant city
  await t('Barangay Anabu', 'BARANGAY', imus.id); // vacant
  await t('General Trias City', 'CITY', cavite.id); // vacant city

  await t('Batangas', 'PROVINCE', luzon.id); // vacant province

  // --- Visayas -------------------------------------------------------------
  const visayas = await t('Visayas', 'REGION', null);
  const cebu = await t('Cebu', 'PROVINCE', visayas.id, 'provincial2@tasty.test');

  const mandaue = await t('Mandaue City', 'CITY', cebu.id, 'city3@tasty.test');
  await t('Barangay Casuntingan', 'BARANGAY', mandaue.id, 'reseller4@tasty.test');
  await t('Barangay Tipolo', 'BARANGAY', mandaue.id); // vacant (reseller5 is pending/unassigned)

  await t('Lapu-Lapu City', 'CITY', cebu.id); // vacant city
  await t('Bohol', 'PROVINCE', visayas.id); // vacant province

  const count = await prisma.territory.count();
  console.log(`  • ${count} territories seeded`);
}

if (require.main === module) {
  const prisma = new PrismaClient();
  seedTerritories(prisma)
    .then(() => console.log('✅ Territories seeded'))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
