import { z } from 'zod';
import { dayToDb, dbToDay } from './officeTime.js';

export const dayString = z.string().refine((value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = dayToDb(value);
  // Rejects dates that roll over, such as 31 February.
  return !Number.isNaN(date.getTime()) && dbToDay(date) === value;
}, 'Enter a valid date');
