// Demo data for local development. Safe to run repeatedly.
import bcrypt from 'bcryptjs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Role, type User } from '../backend/src/generated/prisma/client.js';
import { addDays, dayToDb, officeTime, weekday } from '../backend/src/lib/officeTime.js';
import { calcDay, calcLateMinutes } from '../backend/src/services/attendanceCalc.js';

if (process.env.NODE_ENV === 'production') {
  throw new Error('The seed script creates accounts with a known password and must not run in production.');
}
const password = process.env.SEED_PASSWORD;
if (!password) throw new Error('SEED_PASSWORD is not set');
const adminPassword = process.env.SEED_ADMIN_PASSWORD;
if (!adminPassword) throw new Error('SEED_ADMIN_PASSWORD is not set');

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

const department = await prisma.department.upsert({
  where: { name: 'General' }, update: {}, create: { name: 'General' },
});
const shift = await prisma.shift.upsert({
  where: { name: 'General Shift' }, update: {},
  create: { name: 'General Shift', startTime: '09:00', endTime: '18:00' },
});

const passwordHash = await bcrypt.hash(password, 12);
const upsertUser = (employeeCode: string, name: string, email: string, role: Role, managerId?: string) =>
  prisma.user.upsert({
    where: { email }, update: {},
    create: { employeeCode, name, email, role, passwordHash, departmentId: department.id, shiftId: shift.id, managerId },
  });

// The admin has its own login. Keyed on the employee code, so an older admin account is renamed rather than duplicated.
const adminEmail = 'admin@shimento.com';
const adminPasswordHash = await bcrypt.hash(adminPassword, 12);
const admin = await prisma.user.upsert({
  where: { employeeCode: 'EMP001' },
  update: { email: adminEmail, passwordHash: adminPasswordHash },
  create: {
    employeeCode: 'EMP001', name: 'Admin', email: adminEmail, role: Role.ADMIN,
    passwordHash: adminPasswordHash, departmentId: department.id, shiftId: shift.id,
  },
});
const manager = await upsertUser('EMP002', 'Demo Manager', 'manager@example.com', Role.MANAGER);
const employee = await upsertUser('EMP003', 'Demo Employee', 'employee@example.com', Role.EMPLOYEE, manager.id);
await upsertUser('EMP004', 'Demo HR', 'hr@example.com', Role.HR);

// About a month of varied history, so that timesheets and reports have something to show.
const HISTORY_DAYS = 30;
const today = officeTime(new Date()).date;
const ist = (day: string, time: string) => new Date(`${day}T${time}:00+05:30`);

async function addHistory(user: User, seedOffset: number) {
  const firstDay = addDays(today, -HISTORY_DAYS);
  await prisma.user.update({ where: { id: user.id }, data: { createdAt: ist(firstDay, '09:00') } });

  const rules = {
    shiftStart: shift.startTime, shiftEnd: shift.endTime, graceMinutes: shift.graceMinutes,
    fullDayMinutes: shift.fullDayMinutes, halfDayMinutes: shift.halfDayMinutes,
    overtimeAfterMins: shift.overtimeAfterMins, scheduled: true,
  };

  let n = seedOffset;
  for (let day = firstDay; day < today; day = addDays(day, 1)) {
    if (shift.weeklyOffDays.includes(weekday(day))) continue;
    n++;
    const date = dayToDb(day);
    if (await prisma.attendance.findUnique({ where: { userId_date: { userId: user.id, date } } })) continue;
    if (n % 17 === 7) continue; // Absent

    const minute = String(n % 10).padStart(2, '0');
    const checkInAt = ist(day, n % 11 === 3 ? '09:40' : `09:${minute}`);
    const base = { ...rules, userId: user.id, date, checkInAt, shiftName: shift.name, lateMinutes: calcLateMinutes(checkInAt, rules) };

    if (n % 19 === 5) { // Forgot to check out
      await prisma.attendance.create({ data: base });
      continue;
    }

    const checkOutAt = ist(day, n % 13 === 5 ? '14:00' : n % 9 === 2 ? '19:30' : '18:10');
    const breaks = n % 13 === 5 ? [] : [{ startAt: ist(day, '13:00'), endAt: ist(day, '13:45') }];
    await prisma.attendance.create({
      data: { ...base, checkOutAt, ...calcDay(checkInAt, checkOutAt, breaks, rules), breaks: { create: breaks } },
    });
  }
}

await addHistory(admin, 2);
await addHistory(manager, 9);
await addHistory(employee, 0);

console.log(`Seeded accounts: ${adminEmail}, manager@example.com, employee@example.com and hr@example.com`);
await prisma.$disconnect();
