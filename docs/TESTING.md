# Marine LMS Testing Guide

## Purpose

The project has a layered manual test suite. It covers fast helpers, complete HTTP workflows, PostgreSQL persistence, data imports, generated documents, security boundaries, concurrency, and real browser behavior.

No test command is attached to the production deployment workflow. Run these checks manually before a requested commit or deployment.

## Data safety

The automated tests do not use the development or production database.

- HTTP integration and browser tests create a temporary JSON database and temporary uploads directory.
- PostgreSQL and course-price import tests create a uniquely named temporary database, apply all migrations, and drop it after the run.
- WordPress/Tutor import and backup tests create temporary directory trees under the operating-system temp directory.
- SMTP tests use a local fake SMTP server. They do not send real email.
- Tests never write to `data/db.json`, `data/uploads/`, or the production server.

## Prerequisites

Install dependencies:

```powershell
npm.cmd install
```

Start the project PostgreSQL container for database and import tests:

```powershell
docker compose up -d postgres
```

The default test admin connection is:

```text
postgresql://postgres:postgres@127.0.0.1:5433/postgres
```

Override it when necessary:

```powershell
$env:TEST_POSTGRES_ADMIN_URL="postgresql://user:password@127.0.0.1:5432/postgres"
```

Browser tests use an installed Google Chrome. Override its path when Chrome is installed elsewhere:

```powershell
$env:CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"
```

## Commands

Fast existing regression suite:

```powershell
npm.cmd test
```

Focused categories:

```powershell
npm.cmd run test:unit
npm.cmd run test:integration
npm.cmd run test:postgres
npm.cmd run test:imports
npm.cmd run test:e2e
```

All non-browser checks, including build and the existing regression runner:

```powershell
npm.cmd run test:manual
```

Everything, including desktop and mobile browser checks:

```powershell
npm.cmd run test:full
```

Generate category-level V8 coverage reports:

```powershell
npm.cmd run test:coverage
```

Coverage is printed separately for each isolated category so HTTP servers cannot share ports or environment variables. Do not add the category percentages together.

Generate one combined report across regression, unit, integration, PostgreSQL, and import processes:

```powershell
npm.cmd run test:coverage:combined
```

Skip the initial TypeScript and ESLint build when it has already passed:

```powershell
npm.cmd run test:coverage:combined:quick
```

The combined command is a manual Windows PowerShell workflow. It merges raw V8 process data and writes the machine-readable result to `.coverage/combined-summary.json`. The `.coverage/` directory is ignored by Git.

## Current measured baseline

The combined coverage report measured on 23 July 2026 includes these baselines:

- `scripts/lms-server.mjs`: 82.24% lines, 85.38% functions, and 49.93% V8 block/branch ranges;
- all loaded production modules combined: 83.18% lines, 85.41% functions, and 46.35% V8 block/branch ranges;
- `scripts/prisma-db.mjs`: 81.04% lines and 83.95% functions;
- `scripts/import-course-price-revision.mjs`: 90.05% lines and 100% functions;
- `scripts/import-wordpress-tutor.mjs`: 81.99% lines and 78.48% functions.

The merger adds counters from every isolated Node process before calculating the result. Blank and comment-only lines are excluded. V8 block ranges are reported as branches, so that number is intentionally more conservative than line coverage. The browser suite validates rendered behavior that server-side V8 coverage does not measure.

## Coverage map

### Existing regression runner

The regression runner contains more than 160 assertions covering the principal product flow:

- authentication, session renewal, CSRF, and role access;
- user registration, duplicate email handling, first sign-in, and password reset;
- deferred course assignment email and SMTP queue behavior;
- course creation, editing, deletion, merge, pricing, catalogue filters, and homepage configuration;
- lessons, inline materials, tests, automatic certificate issuance, and student navigation;
- manual issue, resend, reissue, verification, and email delivery of certificate PDFs;
- invoice/report screens and Excel exports;
- audit details and permanent user deletion with related-data cleanup.

### Node test suites

The focused suites add 42 independent non-browser tests plus 4 browser tests:

- connection-string parsing, environment loading, relational flattening, and graph validation;
- public routes, policy pages, catalogue details, password recovery, applications, feedback, profile editing, and session invalidation;
- personalized SMTP templates, registration credentials, deferred assignment delivery, first sign-in activation, password reset, failure logging, and retry;
- security headers, same-origin checks, CSRF rejection, private routes, hardened cookies, and brute-force throttling;
- complete student/instructor/administrator permission matrices, cross-user isolation, audit redaction, output escaping, and concurrent duplicate-request idempotency;
- course image validation, catalogue metadata, course/lesson/material/question CRUD, test validation, merge cloning, and protected deletion;
- administration screens, filters, exports, homepage selection, editable policies, pricing, applications, assignments, and cascade deletion;
- invoice template editing, calculations, selected columns, public sharing, PDF, Excel, print, and email;
- certificate visual designer, custom fields, A4 output, embedded Unicode fonts, long-text wrapping, print/download disposition, backup/restore, apply-to-all, numbering, five-year expiry, QR verification, revoke/reissue/resend, and PDF attachments;
- upload signature validation, size limits, private file access, byte-range responses, and certificate photos;
- all SQL migrations, checksum idempotency, PostgreSQL round trips, updates, unique constraints, cascades, and cleanup;
- course-price XLSX dry-run/apply/idempotency, generated covers, and database snapshots;
- WordPress/Tutor users, courses, lessons, tests, assignments, media copying, and dry-run safety;
- local database and uploads backup integrity;
- desktop catalogue layout, 12-course pagination, filters, hero rotation, student test wizard, admin course creation, and mobile overflow.

## Browser-test note

Some restricted automation environments prohibit launching Chrome and return `spawn EPERM`. This is an environment restriction, not an LMS test failure. Run `npm.cmd run test:e2e` from a normal local PowerShell session.

## Expected result

Every command must finish with:

```text
fail 0
```

The PostgreSQL container may remain running after the tests. Temporary databases and files are removed automatically even when assertions fail.

Production auto-deploy deliberately does not invoke `test:manual`, `test:full`, or either coverage command. Add a CI gate only after an explicit project decision.
