# TimeSheet

Attendance and timesheets for office employees. React and Tailwind on the front end, Express and Prisma on the back end, PostgreSQL for the database.

## Getting started

You need Node.js 24 or newer. PostgreSQL doesn't need installing, because the project runs its own local copy from `node_modules`, with its data in `database/data/`.

If your antivirus or firewall asks about `postgres.exe`, allow it. Otherwise the database can hang on startup.

```sh
npm install
cp backend/.env.example backend/.env  # then fill in JWT_SECRET (the file shows how to generate one)
npm run setup                        # creates the tables and the demo accounts
npm start                            # starts everything and opens the browser
```

The app opens in your browser at http://localhost:5015. Press Ctrl+C in the terminal to stop everything.

| Demo account | Role | Password |
|---|---|---|
| `admin@shimento.com` | Admin | `Admin123` |
| `manager@example.com` | Manager | `ChangeMe123!` |
| `employee@example.com` | Employee | `ChangeMe123!` |
| `hr@example.com` | HR | `ChangeMe123!` |

The demo accounts come with about a month of made-up attendance history, so that timesheets have something to show.

## Commands

| Command | What it does |
|---|---|
| `npm start` | Starts the database, API (port 4000) and web app (port 5015), and opens the browser |
| `npm run dev` | Same as `npm start` |
| `npm test` | Runs the API tests in a separate `timesheet_test` database, leaving dev data alone |
| `npm run typecheck` | Type-checks all three parts |
| `npm run db:migrate` | Creates and applies a migration after editing `database/schema.prisma` |
| `npm run db:seed` | Adds the demo accounts and history again |

## Background jobs and email

The API runs background jobs itself, every `JOB_INTERVAL_SECONDS` (60 by default), so alerts go out whether or not anyone has the app open. Each job takes a lease in the `JobRun` table first, so running several API servers is safe, and a restart simply carries on from what's in the database.

- **Forgotten check-outs:** once a shift has ended and the grace period has passed, the employee is reminded, then their manager and HR are told. Admins set the timings on the Check-outs page. Overnight shifts (an end time earlier than the start time) are supported.

Notifications always appear in the app (the bell at the top). They're also emailed when `SMTP_HOST` and the other `SMTP_*` settings in `backend/.env` are filled in. Without them, each notification records that email wasn't sent, and in development the email is printed to the API log instead.

## Project layout

```
frontend/               The React web app
  public/               Static files
  src/
    api/                Calls to the backend
    components/         Shared interface pieces
    hooks/              Login state
    lib/                Date and time formatting
    pages/              One file per screen

backend/                The Express API
  src/
    routes/             API endpoints
    services/           Business logic and attendance rules
    middleware/         Login and role checks
    lib/                Configuration, database connection, office time
    generated/          Database client, created by Prisma (not edited by hand)
  scripts/              Test runner
  tests/                API tests
  .env                  Settings and secrets (never committed)

database/               Everything about the data
  schema.prisma         The tables
  migrations/           The history of changes to the tables
  seed.ts               Demo accounts and attendance history
  scripts/              Starts and sets up the local database
  data/                 The local database's files (never committed)
```

Attendance rules such as shift times, grace period, and half-day and overtime thresholds are stored on the `Shift` table rather than in code. Each attendance record keeps a copy of the rules from its check-in, so editing a shift doesn't change past days.

All attendance days and lateness use one office timezone, set by `OFFICE_TIMEZONE` (default `Asia/Kolkata`).

## Before going to production

- Set `DATABASE_URL`, `JWT_SECRET`, `CLIENT_URL`, `OFFICE_TIMEZONE` and `NODE_ENV=production`. The local database is for development only.
- Connect an email provider in `backend/src/services/mailer.ts`. Until then, forgot-password emails are not sent: reset links only appear in the server log during development. Admins can still issue temporary passwords from the People page.
- If the API runs behind a load balancer or reverse proxy, set Express's `trust proxy`. Otherwise login limits treat all traffic as one IP address.
- Don't run the seed script. It refuses to run when `NODE_ENV=production`.
