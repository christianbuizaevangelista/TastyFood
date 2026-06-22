import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { peso } from './format';
import { distLabel } from './labels';

interface PoLike {
  number: string;
  status: string;
  distributionType: string;
  discountRate: number;
  subtotal: number;
  total: number;
  createdAt: string;
  buyerOrg: { name: string; type: string };
  sellerOrg: { name: string; type: string };
  items: {
    quantity: number;
    receivedQuantity?: number;
    unitSrp: number;
    unitPrice: number;
    lineTotal: number;
    product: { sku: string; name: string };
  }[];
}

// Builds and downloads a one-page PDF for a purchase order.
export function exportPoPdf(po: PoLike) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const M = 40;

  // Brand header
  doc.setFillColor(232, 82, 29); // brand-500
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), 64, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('Juan Palaman', M, 28);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text('Tasty Food Manufacturing Inc. — Purchase Order', M, 46);

  // Title + status
  doc.setTextColor(30, 30, 30);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(po.number, M, 96);
  doc.setFontSize(11);
  doc.setTextColor(120, 120, 120);
  doc.text(`Status: ${po.status.replace('_', ' ')}`, doc.internal.pageSize.getWidth() - M, 96, {
    align: 'right',
  });

  // Meta
  doc.setTextColor(60, 60, 60);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const meta = [
    `Buyer: ${po.buyerOrg.name} (${po.buyerOrg.type})`,
    `Supplier: ${po.sellerOrg.name} (${po.sellerOrg.type})`,
    `Distribution: ${distLabel(po.distributionType)}`,
    `Date: ${new Date(po.createdAt).toLocaleString('en-PH')}`,
    `Buyer discount: ${(po.discountRate * 100).toFixed(0)}%`,
  ];
  meta.forEach((line, i) => doc.text(line, M, 120 + i * 15));

  // Items table
  autoTable(doc, {
    startY: 120 + meta.length * 15 + 10,
    head: [['SKU', 'Product', 'Ordered', 'Received', 'Unit Price', 'Line Total']],
    body: po.items.map((it) => [
      it.product.sku,
      it.product.name,
      String(it.quantity),
      String(it.receivedQuantity ?? 0),
      peso(it.unitPrice),
      peso(it.lineTotal),
    ]),
    styles: { fontSize: 9, cellPadding: 5 },
    headStyles: { fillColor: [232, 82, 29] },
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
  doc.text(`Subtotal (SRP): ${peso(po.subtotal)}`, doc.internal.pageSize.getWidth() - M, endY, {
    align: 'right',
  });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(`Total: ${peso(po.total)}`, doc.internal.pageSize.getWidth() - M, endY + 18, {
    align: 'right',
  });

  doc.save(`${po.number}.pdf`);
}
