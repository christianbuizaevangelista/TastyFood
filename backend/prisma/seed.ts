import { PrismaClient, OrgType, OrgStatus, DistributionType, SaleChannel } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { seedTerritories } from './seedTerritories';

const prisma = new PrismaClient();

const TIER_DISCOUNT: Record<OrgType, number> = {
  PRINCIPAL: 0,
  PROVINCIAL: 0.2,
  CITY: 0.15,
  RESELLER: 0.08,
};

const PASSWORD = 'Password123!';
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const unitPrice = (srp: number, d: number) => round2(srp * (1 - d));

let seq = 1000;
const nextSeq = () => ++seq;
const poNum = () => `PO-SEED-${nextSeq()}`;
const soNum = () => `SO-SEED-${nextSeq()}`;

function monthsAgo(m: number, day = 15): Date {
  const d = new Date();
  d.setMonth(d.getMonth() - m, day);
  d.setHours(10, 0, 0, 0);
  return d;
}

async function main() {
  console.log('🌱 Seeding Tasty Food distribution data...');

  // Clean slate (order matters for FKs).
  await prisma.territory.deleteMany();
  await prisma.saleItem.deleteMany();
  await prisma.sale.deleteMany();
  await prisma.purchaseOrderItem.deleteMany();
  await prisma.approval.deleteMany();
  await prisma.purchaseOrder.deleteMany();
  await prisma.stockLedger.deleteMany();
  await prisma.inventory.deleteMany();
  await prisma.kPIRecord.deleteMany();
  await prisma.user.deleteMany();
  await prisma.product.deleteMany();
  await prisma.organization.deleteMany();

  const hash = await bcrypt.hash(PASSWORD, 10);

  // --- Products (Juan Palaman / Tasty Food line, prices in PHP) -------------
  const productSeed = [
    { sku: 'TF-BAG-200', name: 'Juan Palaman Bagoong Alamang 200g', category: 'Condiments', srp: 85 },
    { sku: 'TF-KET-320', name: 'Juan Palaman Banana Ketchup 320g', category: 'Condiments', srp: 45 },
    { sku: 'TF-VIN-375', name: 'Juan Palaman Spicy Sukang Tuba 375ml', category: 'Condiments', srp: 38 },
    { sku: 'TF-SAR-155', name: 'Juan Palaman Sardines in Tomato 155g', category: 'Canned Goods', srp: 32 },
    { sku: 'TF-CB-150', name: 'Juan Palaman Corned Beef 150g', category: 'Canned Goods', srp: 58 },
    { sku: 'TF-PC-60', name: 'Juan Palaman Pancit Canton 60g', category: 'Noodles', srp: 16 },
    { sku: 'TF-POL-100', name: 'Juan Palaman Polvoron 100g', category: 'Snacks', srp: 65 },
    { sku: 'TF-MAN-100', name: 'Juan Palaman Dried Mangoes 100g', category: 'Snacks', srp: 120 },
    { sku: 'TF-COC-300', name: 'Juan Palaman Coco Jam 300g', category: 'Spreads', srp: 95 },
    { sku: 'TF-CHI-330', name: 'Juan Palaman Sweet Chili Sauce 330ml', category: 'Condiments', srp: 72 },
  ];
  const products: Awaited<ReturnType<typeof prisma.product.create>>[] = [];
  for (const p of productSeed) products.push(await prisma.product.create({ data: p }));
  console.log(`  • ${products.length} products`);

  // --- Organizations + users ------------------------------------------------
  async function makeOrg(opts: {
    name: string;
    type: OrgType;
    parentId: string | null;
    status?: OrgStatus;
    isActive?: boolean;
    email: string;
    contactName: string;
    contactPhone?: string;
    address?: string;
    salesTarget?: number;
  }) {
    const org = await prisma.organization.create({
      data: {
        name: opts.name,
        type: opts.type,
        parentId: opts.parentId,
        discountRate: TIER_DISCOUNT[opts.type],
        status: opts.status ?? 'APPROVED',
        isActive: opts.isActive ?? true,
        contactName: opts.contactName,
        contactEmail: opts.email,
        contactPhone: opts.contactPhone,
        address: opts.address,
        salesTarget: opts.salesTarget ?? 0,
      },
    });
    await prisma.user.create({
      data: {
        name: opts.contactName,
        email: opts.email,
        passwordHash: hash,
        role: opts.type as any,
        orgId: org.id,
        isOwner: true,
      },
    });
    return org;
  }

  const principal = await makeOrg({
    name: 'Tasty Food Manufacturing Inc.',
    type: 'PRINCIPAL',
    parentId: null,
    email: 'principal@tasty.test',
    contactName: 'Juan Dela Cruz',
    address: 'General Trias, Cavite',
    salesTarget: 5_000_000,
  });

  const prov1 = await makeOrg({
    name: 'Luzon Provincial Distributor',
    type: 'PROVINCIAL',
    parentId: principal.id,
    email: 'provincial1@tasty.test',
    contactName: 'Maria Santos',
    address: 'Calamba, Laguna',
    salesTarget: 1_500_000,
  });
  const prov2 = await makeOrg({
    name: 'Visayas Provincial Distributor',
    type: 'PROVINCIAL',
    parentId: principal.id,
    email: 'provincial2@tasty.test',
    contactName: 'Pedro Reyes',
    address: 'Cebu City',
    salesTarget: 1_200_000,
  });

  const city1 = await makeOrg({
    name: 'Cavite City Distributor',
    type: 'CITY',
    parentId: prov1.id,
    email: 'city1@tasty.test',
    contactName: 'Ana Lim',
    address: 'Dasmariñas, Cavite',
    salesTarget: 500_000,
  });
  const city2 = await makeOrg({
    name: 'Laguna City Distributor',
    type: 'CITY',
    parentId: prov1.id,
    email: 'city2@tasty.test',
    contactName: 'Jose Cruz',
    address: 'Santa Rosa, Laguna',
    salesTarget: 450_000,
  });
  const city3 = await makeOrg({
    name: 'Cebu City Distributor',
    type: 'CITY',
    parentId: prov2.id,
    email: 'city3@tasty.test',
    contactName: 'Liza Tan',
    address: 'Mandaue, Cebu',
    salesTarget: 400_000,
  });

  const reseller1 = await makeOrg({
    name: 'Sari-Sari ni Aling Nena',
    type: 'RESELLER',
    parentId: city1.id,
    email: 'reseller1@tasty.test',
    contactName: 'Nena Bautista',
    salesTarget: 120_000,
  });
  const reseller2 = await makeOrg({
    name: 'Mang Tomas Store',
    type: 'RESELLER',
    parentId: city1.id,
    email: 'reseller2@tasty.test',
    contactName: 'Tomas Aquino',
    salesTarget: 100_000,
  });
  const reseller3 = await makeOrg({
    name: 'Laguna Grocery Mart',
    type: 'RESELLER',
    parentId: city2.id,
    email: 'reseller3@tasty.test',
    contactName: 'Grace Villar',
    salesTarget: 150_000,
  });
  const reseller4 = await makeOrg({
    name: 'Cebu Mini Grocery',
    type: 'RESELLER',
    parentId: city3.id,
    email: 'reseller4@tasty.test',
    contactName: 'Mark Uy',
    salesTarget: 130_000,
  });
  // Reseller #5 is left PENDING to demonstrate the approval workflow.
  const reseller5 = await makeOrg({
    name: 'Bohol Island Traders (Pending)',
    type: 'RESELLER',
    parentId: city3.id,
    status: 'PENDING',
    email: 'reseller5@tasty.test',
    contactName: 'Carlo Bahandi',
    salesTarget: 110_000,
  });

  const allOrgs = [principal, prov1, prov2, city1, city2, city3, reseller1, reseller2, reseller3, reseller4, reseller5];
  console.log(`  • ${allOrgs.length} organizations (1 principal, 2 provincial, 3 city, 5 reseller)`);

  // Pending onboarding approval for reseller5.
  await prisma.approval.create({
    data: { type: 'ORG_ONBOARDING', status: 'PENDING', orgId: reseller5.id },
  });

  // Map each org to its admin user (sales/POs require a creator).
  const allUsers = await prisma.user.findMany({ select: { id: true, orgId: true } });
  const userByOrg = new Map(allUsers.map((u) => [u.orgId, u.id]));

  // --- Inventory: stock everyone (resellers lighter) ------------------------
  const stockByType: Record<OrgType, number> = {
    PRINCIPAL: 5000,
    PROVINCIAL: 1200,
    CITY: 400,
    RESELLER: 60,
  };
  for (const org of allOrgs) {
    if (org.status !== 'APPROVED') continue;
    for (const p of products) {
      const qty = stockByType[org.type] + Math.floor(Math.random() * 40);
      await prisma.inventory.create({
        data: { orgId: org.id, productId: p.id, quantity: qty },
      });
      await prisma.stockLedger.create({
        data: { orgId: org.id, productId: p.id, change: qty, balance: qty, reason: 'INITIAL_STOCK' },
      });
    }
  }
  console.log('  • Inventory seeded for all approved orgs');

  // --- Historical sales for charts/KPIs (last 5 months) ---------------------
  async function createSale(opts: {
    sellerId: string;
    buyerId?: string;
    channel: SaleChannel;
    distributionType: DistributionType;
    discountRate: number;
    customerName?: string;
    when: Date;
    lines: { productId: string; srp: number; qty: number }[];
  }) {
    const items = opts.lines.map((l) => {
      const up = unitPrice(l.srp, opts.discountRate);
      return { productId: l.productId, quantity: l.qty, unitSrp: l.srp, unitPrice: up, lineTotal: round2(up * l.qty) };
    });
    const subtotal = round2(items.reduce((s, i) => s + i.unitSrp * i.quantity, 0));
    const total = round2(items.reduce((s, i) => s + i.lineTotal, 0));
    return prisma.sale.create({
      data: {
        number: soNum(),
        sellerOrgId: opts.sellerId,
        buyerOrgId: opts.buyerId,
        channel: opts.channel,
        distributionType: opts.distributionType,
        customerName: opts.customerName,
        discountRate: opts.discountRate,
        subtotal,
        total,
        createdById: userByOrg.get(opts.sellerId)!,
        createdAt: opts.when,
        items: { create: items },
      },
    });
  }

  const pick = (n: number) => products.slice(0, n).map((p) => ({ productId: p.id, srp: p.srp }));

  // Resellers selling to walk-in customers at SRP (POS), across months & types.
  const resellers = [reseller1, reseller2, reseller3, reseller4];
  let saleCount = 0;
  for (let m = 5; m >= 0; m--) {
    for (const r of resellers) {
      // Trade POS sale (deducts their stock conceptually; demo data)
      await createSale({
        sellerId: r.id,
        channel: 'POS',
        distributionType: 'TRADE',
        discountRate: 0, // end customer pays SRP
        customerName: 'Walk-in Customer',
        when: monthsAgo(m, 8 + (saleCount % 15)),
        lines: pick(4).map((l, i) => ({ ...l, qty: 5 + ((m + i) % 6) })),
      });
      saleCount++;
      // Occasional drop-ship POS sale
      if (m % 2 === 0) {
        await createSale({
          sellerId: r.id,
          channel: 'POS',
          distributionType: 'DROP_SHIP',
          discountRate: 0,
          customerName: 'Online Order',
          when: monthsAgo(m, 20),
          lines: pick(3).map((l, i) => ({ ...l, qty: 3 + i })),
        });
        saleCount++;
      }
    }
    // Cities selling to resellers (PO channel) — reseller discount applies.
    for (const c of [city1, city2, city3]) {
      await createSale({
        sellerId: c.id,
        buyerId: undefined,
        channel: 'PO',
        distributionType: 'TRADE',
        discountRate: TIER_DISCOUNT.RESELLER,
        when: monthsAgo(m, 12),
        lines: pick(6).map((l, i) => ({ ...l, qty: 20 + ((m + i) % 10) })),
      });
      saleCount++;
    }
    // Provincials selling to cities (PO channel) — city discount applies.
    for (const pv of [prov1, prov2]) {
      await createSale({
        sellerId: pv.id,
        channel: 'PO',
        distributionType: m % 3 === 0 ? 'DROP_SHIP' : 'TRADE',
        discountRate: TIER_DISCOUNT.CITY,
        when: monthsAgo(m, 5),
        lines: pick(8).map((l, i) => ({ ...l, qty: 60 + ((m + i) % 20) })),
      });
      saleCount++;
    }
    // Principal selling to provincials (PO channel) — provincial discount.
    await createSale({
      sellerId: principal.id,
      channel: 'PO',
      distributionType: 'TRADE',
      discountRate: TIER_DISCOUNT.PROVINCIAL,
      when: monthsAgo(m, 3),
      lines: pick(10).map((l, i) => ({ ...l, qty: 200 + ((m + i) % 50) })),
    });
    saleCount++;
  }
  console.log(`  • ${saleCount} historical sales across both distribution types`);

  // --- A few live POs in different statuses --------------------------------
  async function createPO(opts: {
    buyer: { id: string; discountRate: number };
    sellerId: string;
    distributionType: DistributionType;
    status: any;
    createdById: string;
    lines: { productId: string; srp: number; qty: number }[];
    withApproval?: boolean;
  }) {
    const items = opts.lines.map((l) => {
      const up = unitPrice(l.srp, opts.buyer.discountRate);
      return { productId: l.productId, quantity: l.qty, unitSrp: l.srp, unitPrice: up, lineTotal: round2(up * l.qty) };
    });
    const subtotal = round2(items.reduce((s, i) => s + i.unitSrp * i.quantity, 0));
    const total = round2(items.reduce((s, i) => s + i.lineTotal, 0));
    const now = new Date();
    const po = await prisma.purchaseOrder.create({
      data: {
        number: poNum(),
        buyerOrgId: opts.buyer.id,
        sellerOrgId: opts.sellerId,
        distributionType: opts.distributionType,
        status: opts.status,
        discountRate: opts.buyer.discountRate,
        subtotal,
        total,
        createdById: opts.createdById,
        submittedAt: ['SUBMITTED', 'APPROVED', 'FULFILLED', 'RECEIVED'].includes(opts.status) ? now : null,
        approvedAt: ['APPROVED', 'FULFILLED', 'RECEIVED'].includes(opts.status) ? now : null,
        fulfilledAt: ['FULFILLED', 'RECEIVED'].includes(opts.status) ? now : null,
        receivedAt: opts.status === 'RECEIVED' ? now : null,
        items: { create: items },
      },
    });
    if (opts.withApproval) {
      await prisma.approval.create({
        data: { type: 'PO_APPROVAL', status: 'PENDING', orgId: opts.buyer.id, poId: po.id },
      });
    }
    return po;
  }

  const userOf = async (orgId: string) =>
    (await prisma.user.findFirst({ where: { orgId } }))!.id;

  await createPO({
    buyer: { id: reseller1.id, discountRate: TIER_DISCOUNT.RESELLER },
    sellerId: city1.id,
    distributionType: 'TRADE',
    status: 'DRAFT',
    createdById: await userOf(reseller1.id),
    lines: pick(3).map((l, i) => ({ ...l, qty: 10 + i })),
  });
  await createPO({
    buyer: { id: reseller2.id, discountRate: TIER_DISCOUNT.RESELLER },
    sellerId: city1.id,
    distributionType: 'TRADE',
    status: 'SUBMITTED',
    withApproval: true,
    createdById: await userOf(reseller2.id),
    lines: pick(4).map((l, i) => ({ ...l, qty: 12 + i })),
  });
  await createPO({
    buyer: { id: city1.id, discountRate: TIER_DISCOUNT.CITY },
    sellerId: prov1.id,
    distributionType: 'TRADE',
    status: 'APPROVED',
    createdById: await userOf(city1.id),
    lines: pick(6).map((l, i) => ({ ...l, qty: 40 + i })),
  });
  await createPO({
    buyer: { id: prov1.id, discountRate: TIER_DISCOUNT.PROVINCIAL },
    sellerId: principal.id,
    distributionType: 'DROP_SHIP',
    status: 'RECEIVED',
    createdById: await userOf(prov1.id),
    lines: pick(8).map((l, i) => ({ ...l, qty: 100 + i })),
  });
  console.log('  • Sample purchase orders (DRAFT, SUBMITTED, APPROVED, RECEIVED)');

  await seedTerritories(prisma);

  console.log('\n✅ Seed complete. Test logins (password for all: ' + PASSWORD + '):');
  console.log('   PRINCIPAL    principal@tasty.test');
  console.log('   PROVINCIAL   provincial1@tasty.test / provincial2@tasty.test');
  console.log('   CITY         city1@tasty.test / city2@tasty.test / city3@tasty.test');
  console.log('   RESELLER     reseller1..4@tasty.test  (reseller5 is PENDING approval)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
