import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { distLabel } from './labels';

interface Party {
  name: string;
  type: string;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  address?: string | null;
}

interface PoLike {
  number: string;
  status: string;
  distributionType: string;
  discountRate: number;
  subtotal: number;
  total: number;
  createdAt: string;
  expectedDeliveryDate?: string | null;
  note?: string | null;
  recipientName?: string | null;
  recipientAddress?: string | null;
  recipientPhone?: string | null;
  landmark?: string | null;
  buyerOrg: Party;
  sellerOrg: Party;
  items: {
    quantity: number;
    receivedQuantity?: number;
    unitSrp: number;
    unitPrice: number;
    lineTotal: number;
    product: { sku: string; name: string };
  }[];
}

// Tasty Food brand fresh green (used for the Principal letterhead + table head).
const TF_GREEN: [number, number, number] = [76, 175, 80];

// Load the Tasty Food logo for embedding (resolves null if it can't load).
function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// Draws the Tasty Food letterhead: green band with the logo upper right. The
// logo now carries its own white outline, so no white chip is drawn behind it.
async function drawTastyHeader(doc: jsPDF, W: number, M: number, subtitle: string) {
  doc.setFillColor(...TF_GREEN);
  doc.rect(0, 0, W, 64, 'F');
  const logo = await loadImage('/tasty-food-splash.png');
  if (logo) {
    // Keep the artwork's 708x336 proportions — squeezing it into a square box
    // would distort the wordmark.
    const lw = 108;
    const lh = Math.round((lw * 336) / 708);
    doc.addImage(logo, 'PNG', W - M - lw, (64 - lh) / 2, lw, lh);
  }
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('Tasty Food Manufacturing Inc.', M, 30);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(subtitle, M, 48);
}

// jsPDF's standard fonts can't render the ₱ glyph, so use an ASCII money format.
function money(n: number): string {
  return 'PHP ' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function partyLines(p: Party): string[] {
  const lines = [`${p.name} (${p.type})`];
  if (p.contactName) lines.push(`Attn: ${p.contactName}`);
  if (p.contactEmail) lines.push(p.contactEmail);
  if (p.contactPhone) lines.push(p.contactPhone);
  if (p.address) lines.push(p.address);
  return lines;
}

// Builds and downloads a one-page PDF for a purchase order.
// Only orders supplied by the Principal carry the Tasty Food letterhead;
// orders from any distributor tier use that distributor's own name.
export async function exportPoPdf(po: PoLike) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const M = 40;
  const isPrincipalSupplier = po.sellerOrg.type === 'PRINCIPAL';

  if (isPrincipalSupplier) {
    // Tasty Food letterhead (manufacturer is the supplier).
    await drawTastyHeader(doc, W, M, 'Purchase Order');
  } else {
    // Distributor supplier: use their own name, no Tasty Food branding.
    doc.setTextColor(30, 30, 30);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text(po.sellerOrg.name, M, 34);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(120, 120, 120);
    doc.text('Purchase Order', M, 50);
    doc.setDrawColor(220, 220, 220);
    doc.line(M, 60, W - M, 60);
  }

  // PO number + status
  doc.setTextColor(30, 30, 30);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(po.number, M, 92);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(120, 120, 120);
  doc.text(`Status: ${po.status.replace('_', ' ')}`, W - M, 92, { align: 'right' });

  // Two-column party details: supplier (From) and customer (Bill To)
  const colY = 118;
  const rightX = W / 2 + 10;
  doc.setFontSize(9);
  doc.setTextColor(150, 150, 150);
  doc.setFont('helvetica', 'bold');
  doc.text('SUPPLIER', M, colY);
  doc.text('CUSTOMER', rightX, colY);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(60, 60, 60);
  doc.setFontSize(10);
  const supplier = partyLines(po.sellerOrg);
  const customer = partyLines(po.buyerOrg);
  supplier.forEach((l, i) => doc.text(l, M, colY + 16 + i * 13));
  customer.forEach((l, i) => doc.text(l, rightX, colY + 16 + i * 13));

  const detailRows = Math.max(supplier.length, customer.length);
  let y = colY + 16 + detailRows * 13 + 14;

  // Order meta
  doc.setFontSize(10);
  doc.setTextColor(60, 60, 60);
  doc.text(`Order date: ${new Date(po.createdAt).toLocaleString('en-PH')}`, M, y);
  doc.text(`Distribution: ${distLabel(po.distributionType)}`, M, y + 14);
  doc.text(`Buyer discount: ${(po.discountRate * 100).toFixed(0)}%`, M, y + 28);
  if (po.note) {
    doc.text(`Note: ${po.note}`, M, y + 42);
    y += 14;
  }
  if (po.expectedDeliveryDate) {
    doc.text(
      `Expected delivery: ${new Date(po.expectedDeliveryDate).toLocaleDateString('en-PH')}`,
      M,
      y + 42
    );
    y += 14;
  }
  y += 44;

  // Drop-ship delivery block (ship directly to end recipient).
  if (po.distributionType === 'DROP_SHIP') {
    doc.setDrawColor(196, 181, 253);
    doc.setFillColor(245, 243, 255);
    doc.rect(M, y - 12, W - M * 2, 74, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(91, 33, 182);
    doc.text('Drop-ship Delivery — ship directly to recipient', M + 8, y + 2);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(60, 60, 60);
    doc.text(`Name: ${po.recipientName ?? '—'}`, M + 8, y + 18);
    doc.text(`Cellphone: ${po.recipientPhone ?? '—'}`, M + 8, y + 32);
    doc.text(`Address: ${po.recipientAddress ?? '—'}`, M + 8, y + 46);
    doc.text(`Landmark: ${po.landmark ?? '—'}`, M + 8, y + 60);
    y += 84;
  }

  // Items table
  autoTable(doc, {
    startY: y,
    head: [['SKU', 'Product', 'Ordered', 'Received', 'Unit Price', 'Line Total']],
    body: po.items.map((it) => [
      it.product.sku,
      it.product.name,
      String(it.quantity),
      String(it.receivedQuantity ?? 0),
      money(it.unitPrice),
      money(it.lineTotal),
    ]),
    styles: { fontSize: 9, cellPadding: 5 },
    headStyles: { fillColor: TF_GREEN },
    columnStyles: {
      2: { halign: 'right' },
      3: { halign: 'right' },
      4: { halign: 'right' },
      5: { halign: 'right' },
    },
  });

  const endY = (doc as any).lastAutoTable.finalY + 20;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(90, 90, 90);
  doc.text(`Subtotal (SRP): ${money(po.subtotal)}`, W - M, endY, { align: 'right' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(30, 30, 30);
  doc.text(`Total: ${money(po.total)}`, W - M, endY + 18, { align: 'right' });

  doc.save(`${po.number}.pdf`);
}

interface SaleLike {
  number: string;
  channel?: string;
  distributionType: string;
  customerName?: string | null;
  customerEmail?: string | null;
  discountRate: number;
  subtotal: number;
  total: number;
  savings?: number;
  createdAt: string;
  seller: { name: string; type: string };
  lines: {
    sku: string;
    name: string;
    quantity: number;
    refundedQuantity?: number;
    unitSrp: number;
    unitPrice: number;
    lineTotal: number;
  }[];
}

// Builds and downloads a one-page sales receipt. Principal seller carries the
// Tasty Food letterhead; distributor sellers use their own name.
export async function exportSaleReceiptPdf(sale: SaleLike) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const M = 40;

  if (sale.seller.type === 'PRINCIPAL') {
    await drawTastyHeader(doc, W, M, 'Sales Receipt');
  } else {
    doc.setTextColor(30, 30, 30);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text(sale.seller.name, M, 34);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(120, 120, 120);
    doc.text('Sales Receipt', M, 50);
    doc.setDrawColor(220, 220, 220);
    doc.line(M, 60, W - M, 60);
  }

  doc.setTextColor(30, 30, 30);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(sale.number, M, 92);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(90, 90, 90);
  doc.text(`Date: ${new Date(sale.createdAt).toLocaleString('en-PH')}`, M, 110);
  doc.text(`Channel: ${sale.channel ?? '—'} · ${distLabel(sale.distributionType)}`, M, 124);
  doc.text(`Customer: ${sale.customerName ?? 'Walk-in'}`, M, 138);
  if (sale.customerEmail) doc.text(`Email: ${sale.customerEmail}`, M, 152);

  autoTable(doc, {
    startY: 168,
    head: [['SKU', 'Product', 'Qty', 'Unit Price', 'Line Total']],
    body: sale.lines.map((it) => [
      it.sku,
      it.name + (it.refundedQuantity ? ` (refunded ${it.refundedQuantity})` : ''),
      String(it.quantity),
      money(it.unitPrice),
      money(it.lineTotal),
    ]),
    styles: { fontSize: 9, cellPadding: 5 },
    headStyles: { fillColor: TF_GREEN },
    columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
  });

  const endY = (doc as any).lastAutoTable.finalY + 20;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(90, 90, 90);
  doc.text(`Subtotal (SRP): ${money(sale.subtotal)}`, W - M, endY, { align: 'right' });
  doc.text(`Less discount (${(sale.discountRate * 100).toFixed(0)}%): -${money(sale.savings ?? sale.subtotal - sale.total)}`, W - M, endY + 14, { align: 'right' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(30, 30, 30);
  doc.text(`Grand Total: ${money(sale.total)}`, W - M, endY + 34, { align: 'right' });

  doc.save(`${sale.number}.pdf`);
}
