import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../lib/http';
import { authenticate } from '../../middleware/auth';
import { requireRole, requirePermission } from '../../middleware/rbac';
import { notFound, badRequest } from '../../lib/errors';

// HR System — a workspace separate from DMS, Finance, and Marketing.
// Principal-only (owner or staff with the 'hr' permission).
export const hrRouter = Router();
hrRouter.use(authenticate);
hrRouter.use(requireRole('PRINCIPAL'));
hrRouter.use(requirePermission('hr'));

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const dayOnly = (s: string) => new Date(`${String(s).slice(0, 10)}T00:00:00.000Z`);

// =============================== Employees ==================================
const employeeSchema = z.object({
  employeeNo: z.string().min(1).max(40),
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  position: z.string().max(80).nullable().optional(),
  department: z.string().max(80).nullable().optional(),
  employmentType: z.enum(['REGULAR', 'PROBATIONARY', 'CONTRACTUAL', 'PART_TIME']).default('REGULAR'),
  status: z.enum(['ACTIVE', 'INACTIVE', 'RESIGNED']).default('ACTIVE'),
  dateHired: z.coerce.date().nullable().optional(),
  email: z.string().email().nullable().optional().or(z.literal('')),
  phone: z.string().max(40).nullable().optional(),
  address: z.string().max(200).nullable().optional(),
  baseSalary: z.number().min(0).default(0),
  notes: z.string().max(1000).nullable().optional(),
});
function empData(b: z.infer<typeof employeeSchema>) {
  return {
    employeeNo: b.employeeNo,
    firstName: b.firstName,
    lastName: b.lastName,
    position: b.position || null,
    department: b.department || null,
    employmentType: b.employmentType,
    status: b.status,
    dateHired: b.dateHired ?? null,
    email: b.email || null,
    phone: b.phone || null,
    address: b.address || null,
    baseSalary: round2(b.baseSalary),
    notes: b.notes || null,
  };
}

hrRouter.get(
  '/employees',
  asyncHandler(async (_req, res) => {
    const employees = await prisma.employee.findMany({ orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] });
    res.json({ employees });
  })
);
hrRouter.post(
  '/employees',
  asyncHandler(async (req, res) => {
    const b = employeeSchema.parse(req.body);
    if (await prisma.employee.findUnique({ where: { employeeNo: b.employeeNo } })) {
      throw badRequest('An employee with that Employee No already exists');
    }
    const e = await prisma.employee.create({ data: { ...empData(b), createdById: req.auth!.sub } });
    res.status(201).json(e);
  })
);
hrRouter.put(
  '/employees/:id',
  asyncHandler(async (req, res) => {
    const existing = await prisma.employee.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('Employee not found');
    const b = employeeSchema.parse(req.body);
    if (b.employeeNo !== existing.employeeNo && (await prisma.employee.findUnique({ where: { employeeNo: b.employeeNo } }))) {
      throw badRequest('An employee with that Employee No already exists');
    }
    const e = await prisma.employee.update({ where: { id: existing.id }, data: empData(b) });
    res.json(e);
  })
);
hrRouter.delete(
  '/employees/:id',
  asyncHandler(async (req, res) => {
    const existing = await prisma.employee.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('Employee not found');
    await prisma.employee.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  })
);

// =============================== Attendance =================================
const attendanceSchema = z.object({
  date: z.string().min(8),
  records: z
    .array(
      z.object({
        employeeId: z.string().min(1),
        status: z.enum(['PRESENT', 'ABSENT', 'LATE', 'HALF_DAY', 'LEAVE', 'HOLIDAY']),
        timeIn: z.string().max(10).nullable().optional(),
        timeOut: z.string().max(10).nullable().optional(),
      })
    )
    .max(1000),
});

// GET /hr/attendance?date=YYYY-MM-DD — every active employee + their record.
hrRouter.get(
  '/attendance',
  asyncHandler(async (req, res) => {
    const date = dayOnly((req.query.date as string) || new Date().toISOString());
    const employees = await prisma.employee.findMany({
      where: { status: 'ACTIVE' },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
    const records = await prisma.attendance.findMany({ where: { date } });
    const byEmp = new Map(records.map((r) => [r.employeeId, r]));
    res.json({
      date: date.toISOString().slice(0, 10),
      rows: employees.map((e) => {
        const r = byEmp.get(e.id);
        return {
          employeeId: e.id,
          name: `${e.firstName} ${e.lastName}`,
          department: e.department,
          status: r?.status ?? 'PRESENT',
          timeIn: r?.timeIn ?? '',
          timeOut: r?.timeOut ?? '',
        };
      }),
    });
  })
);
hrRouter.post(
  '/attendance',
  asyncHandler(async (req, res) => {
    const b = attendanceSchema.parse(req.body);
    const date = dayOnly(b.date);
    for (const r of b.records) {
      await prisma.attendance.upsert({
        where: { employeeId_date: { employeeId: r.employeeId, date } },
        update: { status: r.status, timeIn: r.timeIn || null, timeOut: r.timeOut || null },
        create: { employeeId: r.employeeId, date, status: r.status, timeIn: r.timeIn || null, timeOut: r.timeOut || null },
      });
    }
    res.json({ ok: true, saved: b.records.length });
  })
);

// =============================== Leave ======================================
const leaveSchema = z.object({
  employeeId: z.string().min(1),
  type: z.enum(['VACATION', 'SICK', 'EMERGENCY', 'UNPAID']).default('VACATION'),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  days: z.number().min(0.5).default(1),
  reason: z.string().max(500).nullable().optional(),
});
hrRouter.get(
  '/leaves',
  asyncHandler(async (_req, res) => {
    const leaves = await prisma.leaveRequest.findMany({
      orderBy: { createdAt: 'desc' },
      include: { employee: { select: { firstName: true, lastName: true, employeeNo: true } } },
    });
    res.json({ leaves });
  })
);
hrRouter.post(
  '/leaves',
  asyncHandler(async (req, res) => {
    const b = leaveSchema.parse(req.body);
    const emp = await prisma.employee.findUnique({ where: { id: b.employeeId } });
    if (!emp) throw badRequest('Employee not found');
    const leave = await prisma.leaveRequest.create({
      data: {
        employeeId: b.employeeId,
        type: b.type,
        startDate: b.startDate,
        endDate: b.endDate,
        days: b.days,
        reason: b.reason || null,
        createdById: req.auth!.sub,
      },
    });
    res.status(201).json(leave);
  })
);
hrRouter.post(
  '/leaves/:id/decision',
  asyncHandler(async (req, res) => {
    const { decision } = z.object({ decision: z.enum(['APPROVED', 'REJECTED']) }).parse(req.body);
    const existing = await prisma.leaveRequest.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('Leave request not found');
    const leave = await prisma.leaveRequest.update({
      where: { id: existing.id },
      data: { status: decision, decidedById: req.auth!.sub, decidedAt: new Date() },
    });
    res.json(leave);
  })
);

// =============================== Payroll ====================================
// GET /hr/payroll?month=YYYY-MM — computed monthly payslips for active staff.
// Statutory deductions are simplified estimates (SSS 4.5%, PhilHealth 2.5%,
// Pag-IBIG 2% capped ₱100); absences are deducted at the daily rate.
hrRouter.get(
  '/payroll',
  asyncHandler(async (req, res) => {
    const now = new Date();
    const monthStr = (req.query.month as string) || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const [y, m] = monthStr.split('-').map(Number);
    const from = new Date(Date.UTC(y, m - 1, 1));
    const to = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));

    const employees = await prisma.employee.findMany({ where: { status: 'ACTIVE' }, orderBy: [{ lastName: 'asc' }] });
    const absences = await prisma.attendance.groupBy({
      by: ['employeeId'],
      where: { date: { gte: from, lte: to }, status: 'ABSENT' },
      _count: true,
    });
    const absByEmp = new Map(absences.map((a) => [a.employeeId, a._count]));

    const rows = employees.map((e) => {
      const basic = round2(e.baseSalary);
      const dailyRate = round2(basic / 22);
      const absentDays = absByEmp.get(e.id) ?? 0;
      const absenceDeduction = round2(absentDays * dailyRate);
      const sss = round2(basic * 0.045);
      const philhealth = round2(basic * 0.025);
      const pagibig = Math.min(round2(basic * 0.02), 100);
      const totalDeductions = round2(absenceDeduction + sss + philhealth + pagibig);
      const net = round2(basic - totalDeductions);
      return {
        employeeId: e.id,
        name: `${e.firstName} ${e.lastName}`,
        employeeNo: e.employeeNo,
        department: e.department,
        basic,
        absentDays,
        absenceDeduction,
        sss,
        philhealth,
        pagibig,
        totalDeductions,
        net,
      };
    });
    const sum = (k: keyof (typeof rows)[number]) => round2(rows.reduce((s, r) => s + (r[k] as number), 0));
    res.json({
      month: monthStr,
      rows,
      totals: { basic: sum('basic'), deductions: sum('totalDeductions'), net: sum('net'), headcount: rows.length },
    });
  })
);

// =============================== Dashboard ==================================
hrRouter.get(
  '/summary',
  asyncHandler(async (_req, res) => {
    const now = new Date();
    const today = dayOnly(now.toISOString());
    const [employees, byDept, presentToday, onLeaveToday, pendingLeaves] = await Promise.all([
      prisma.employee.findMany({ select: { status: true, employmentType: true } }),
      prisma.employee.groupBy({ by: ['department'], where: { status: 'ACTIVE' }, _count: true }),
      prisma.attendance.count({ where: { date: today, status: { in: ['PRESENT', 'LATE', 'HALF_DAY'] } } }),
      prisma.attendance.count({ where: { date: today, status: 'LEAVE' } }),
      prisma.leaveRequest.count({ where: { status: 'PENDING' } }),
    ]);
    const active = employees.filter((e) => e.status === 'ACTIVE').length;
    res.json({
      headcount: employees.length,
      active,
      inactive: employees.length - active,
      presentToday,
      onLeaveToday,
      pendingLeaves,
      byDepartment: byDept.map((d) => ({ department: d.department ?? 'Unassigned', count: d._count })),
    });
  })
);
