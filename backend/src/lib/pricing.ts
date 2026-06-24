import { OrgType } from '@prisma/client';

// Discount off SRP each tier receives when buying from the level above.
export const TIER_DISCOUNT: Record<OrgType, number> = {
  PRINCIPAL: 0,
  PROVINCIAL: 0.2,
  CITY: 0.15,
  RESELLER: 0.08,
};

// The tier each org type buys from (its immediate parent).
export const PARENT_TYPE: Record<OrgType, OrgType | null> = {
  PRINCIPAL: null,
  PROVINCIAL: 'PRINCIPAL',
  CITY: 'PROVINCIAL',
  RESELLER: 'CITY',
};

// Valid parent (supplier) tiers for each org type. A City may report directly to
// the Principal when no Provincial is assigned yet, then be moved under a
// Provincial once one exists — its POs always follow whoever its parent is.
export const ALLOWED_PARENTS: Record<OrgType, OrgType[]> = {
  PRINCIPAL: [],
  PROVINCIAL: ['PRINCIPAL'],
  CITY: ['PROVINCIAL', 'PRINCIPAL'],
  RESELLER: ['CITY', 'PROVINCIAL', 'PRINCIPAL'],
};

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// buyer price = SRP * (1 - tier discount)
export function unitPrice(srp: number, discountRate: number): number {
  return round2(srp * (1 - discountRate));
}

export interface PricedLine {
  productId: string;
  quantity: number;
  unitSrp: number;
  unitPrice: number;
  lineTotal: number;
}

export function priceLines(
  lines: { productId: string; quantity: number; srp: number }[],
  discountRate: number
): { items: PricedLine[]; subtotal: number; total: number } {
  const items = lines.map((l) => {
    const price = unitPrice(l.srp, discountRate);
    return {
      productId: l.productId,
      quantity: l.quantity,
      unitSrp: l.srp,
      unitPrice: price,
      lineTotal: round2(price * l.quantity),
    };
  });
  const subtotal = round2(items.reduce((s, i) => s + i.unitSrp * i.quantity, 0));
  const total = round2(items.reduce((s, i) => s + i.lineTotal, 0));
  return { items, subtotal, total };
}
