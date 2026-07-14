# Marine LMS: Project Documentation

Last updated: 13 July 2026

## 1. Purpose

Marine LMS is a controlled learning management system for maritime training. It provides a public course catalogue, a student learning area, an administrative area for staff, course delivery, tests, certificates, reporting, invoices, notifications, and operational controls needed to run the platform on a VPS.

The platform was designed to replace and consolidate the operational content previously held in a WordPress/Tutor LMS installation while keeping the new system independently deployable.

## 2. Product scope

### Public area

- Course showcase on the home page, selected and ordered by an administrator.
- Full course catalogue with search, pagination, alphabetical sorting, position and category filters.
- Public course detail pages with cover image, prices in USD, course structure, and application action.
- Course applications from anonymous visitors and simplified course applications from signed-in students.
- Blog area with imported IMO RSS news cards, images, dates, and newest-first ordering.
- Configurable footer with policy links, policy-page contents, and feedback form text.

### Student area

- Secure sign-in, password reset, and personal profile.
- Required profile fields: first name, last name, date of birth, email, and position. Company is optional.
- Student photo upload for certificate use, including visible reminders when a photo is missing.
- Assigned course list, progress, embedded video playback, and inline reading materials.
- Sequential completion of required materials before a test becomes available.
- Timed tests, server-side scoring, result presentation, and retry limits.
- Certificate download after course completion and certificate issuance.

### Staff and administration

- Role-based access for administrators and instructors.
- Instructors can register students, edit student details, upload photos, and assign courses. They cannot delete records, issue certificates manually, or access reports.
- Administrators manage users, courses, lessons, materials, tests, applications, prices, public home-page showcase, footer, notifications, certificates, reports, invoices, files, and audit events.
- Course list and home showcase management use compact cover-and-title lists to support high-volume course administration.

## 3. Implementation timeline

Dates below are taken from the repository commit history. Work that was performed within a commit is grouped by its delivered outcome rather than by individual conversation step.

| Date | Commit | Delivered outcome | Why it was added |
|---|---|---|---|
| 10 Jul 2026 | `a916ca9` | Initial production setup | Established the production-oriented Marine LMS codebase and server deployment foundation. |
| 10 Jul 2026 | `a33ee5a` | Local SSH files excluded | Prevented workstation SSH material from entering version control or deployment archives. |
| 10 Jul 2026 | `ad6b175` | Production deploy trigger | Added the GitHub Actions deployment trigger for the production branch. |
| 10 Jul 2026 | `681838f` | Demo credentials protected | Stopped production logs from exposing demo access details. |
| 11 Jul 2026 | `5cb922d` | Course price management | Added old/new course prices, price export, and report-ready pricing data. |
| 12 Jul 2026 | `52cf31f` | Security and persistence hardening | Strengthened persistence, production checks, security controls, and data handling. |
| 13 Jul 2026 | `9e34e7b` | Invoice management and certificate template pack | Added invoice workflows and reusable certificate template capabilities. |
| 13 Jul 2026 | `c7276ad` | Catalogue, learning workflow, regression coverage | Added catalogue workflow, LMS delivery improvements, and regression coverage. |
| 13 Jul 2026 | `d346f0b` | Admin course improvements and IMO news blog | Improved compact administration of courses and added IMO news blog presentation. |
| 13 Jul 2026 | working tree | Full English localisation | Translated public pages, student area, administration, reports, exports, system messages, seed data, and scaffold UI to English without translating user content or imported course titles. |

## 4. Runtime architecture

### Application layers

| Layer | Location | Status | Responsibility |
|---|---|---|---|
| Production application | `scripts/lms-server.mjs` | Active runtime | HTTP routes, HTML rendering, authentication, business rules, uploads, certificates, reports, and administration. |
| Operational scripts | `scripts/` | Active runtime support | Database migration, import, backup, production readiness checks, deployment helpers, smoke and regression tests. |
| Database schema | `prisma/` | Active | PostgreSQL schema, SQL migrations, seed data, Prisma generation. |
| Next.js scaffold | `src/` | Future migration scaffold | Type-checked reference UI and design structure; not served as the production application. |
| Uploaded media | `data/uploads/` | Persistent external data | Course covers, course material, video files, student photos, and certificate assets. |

### Technical stack

- Node.js standalone HTTP application.
- PostgreSQL 16 for production data.
- Prisma schema and custom SQL migration runner.
- PM2 process manager in production.
- Nginx/FastPanel reverse proxy in front of the Node application.
- PDF generation through `pdf-lib` and `pdfkit`.
- QR-code generation through `qrcode`.
- `sharp` for image processing.
- GitHub Actions for archive-based deployment to the VPS.

## 5. Data and persistence

### Storage model

Production must use:

```text
LMS_STORAGE=prisma
DATABASE_URL=postgresql://...
```

The application keeps relational operational data in PostgreSQL. File data remains outside the database in `data/uploads/`.

### Important entities

- Users: students, instructors, and administrators.
- Courses, lessons, materials, tests, questions, and answer options.
- Course assignments and learning progress.
- Course applications.
- Certificates and certificate activity events.
- Notifications and SMTP queue state.
- Audit events.
- Invoice and reporting data.
- Site settings, including home showcase and configurable footer data.

### Import from WordPress/Tutor LMS

The import tools map legacy course structure and media references into the new LMS. Imported course titles and existing user data are preserved; they are not automatically translated by the English localisation work.

Relevant commands:

```powershell
npm.cmd run import:wp:dry-run
npm.cmd run import:wp:apply
npm.cmd run prod:repair-uploads
```

## 6. Course delivery and assessment

1. An administrator or instructor creates a student and assigns a course.
2. The student opens the course in the learning area.
3. Required materials are completed in the configured sequence.
4. The test is unlocked only when required materials are complete.
5. The server validates answers and stores the attempt result.
6. A completed course can produce a certificate when certificate conditions are met.

Course pricing stores both an old price and a new price. The new price is used in reporting and invoicing when present; otherwise the old price is used. Public course prices are displayed in USD.

## 7. Certificates

### Issuance rules

- Automatic issuance follows successful course completion where configured.
- Administrators can issue a certificate manually without a course and choose the issue date.
- Automatic issuance uses the current date.
- Certificate expiry is calculated as issue date plus five years.
- A student photo is required before a certificate can be issued.

### Certificate number

Certificate numbers use the configured sequential number with date suffix format:

```text
000000000/dd/mm/yyyy
```

The configured sequence begins at `725645565`.

### Template system

- Each course can have its own HTML/PDF certificate template.
- The visual template editor supports placed variables and assets.
- Templates can be applied across courses.
- The stamp is rendered at the highest layer.
- QR verification links to the public certificate validation route.

Supported variables include:

```text
{{firstName}}
{{lastName}}
{{fullName}}
{{birthDate}}
{{position}}
{{company}}
{{courseTitle}}
{{certificateNumber}}
{{issuedAt}}
{{expiresAt}}
{{photoImage}}
{{photoUrl}}
{{verificationUrl}}
{{qrCode}}
```

## 8. Reporting, checks, and invoices

The Checks area records staff activity and supports filters for staff member, reporting period, and student/course scope. It calculates course price totals and supports Excel export.

Invoice support includes:

- Draft, generated, sent, viewed, partially paid, paid, overdue, and cancelled statuses.
- Recipient and reporting-period data.
- Student and course line items.
- Individual price overrides, discounts, additional charges, comments, issue date, and due date.
- Preview, print, PDF/download-ready content, email delivery, and in-panel history.
- Change history, payment status, currency, and stored invoice details.

## 9. Security controls

- Password hashing using PBKDF2.
- Session-based authentication with role checks.
- Same-origin protection for POST requests and CSRF controls.
- Rate limiting around authentication-sensitive actions.
- Soft-delete/archival behaviour where appropriate.
- Audit log with human-readable events and technical details on demand.
- Production readiness check for environment, database, upload references, and configuration warnings.
- Deployment archive excludes secrets, local SSH material, uploads, JSON fallback data, backups, logs, and build cache.

## 10. Email and notifications

SMTP configuration is supplied through environment variables:

```text
SMTP_HOST
SMTP_PORT
SMTP_SECURE
SMTP_STARTTLS
SMTP_USER
SMTP_PASS
SMTP_FROM
PUBLIC_BASE_URL
```

When SMTP is configured, email events enter the delivery queue and can be sent from the administration area. When it is unavailable, events remain logged for operational visibility.

## 11. Local development and validation

### Start

```powershell
npm.cmd install
npm.cmd run dev
```

### Database services

```powershell
docker compose up -d
```

### Checks

```powershell
npm.cmd run build
npm.cmd run audit:prod
npm.cmd run prod:check:no-uploads
npm.cmd run test
```

`build` runs TypeScript validation and ESLint. The regression runner creates child processes, so it requires a regular local terminal or CI runner. Some restricted desktop sandboxes can block it before assertions with `spawn EPERM`.

## 12. Production deployment

### Server requirements

- Ubuntu 24.04 or compatible Linux VPS.
- Node.js, npm, PM2, PostgreSQL client tools (`pg_dump`), and Docker where PostgreSQL is containerised.
- Nginx/FastPanel reverse proxy forwarding the configured domain to the Node process.
- Persistent disk space for database backups and `data/uploads/` media.

### GitHub Actions workflow

The workflow is located at:

```text
.github/workflows/deploy-production.yml
```

It runs on pushes to `main` or manual dispatch. It:

1. Builds a source archive without uploads, secrets, backup files, and local development folders.
2. Connects to the server with repository secrets.
3. Creates a PostgreSQL and code backup on the server.
4. Extracts the new source into the configured application directory.
5. Installs packages, regenerates Prisma, applies migrations, builds, audits dependencies, and performs production checks.
6. Restarts PM2 and checks `/healthz` locally.

Required repository secrets:

```text
PROD_HOST
PROD_USER
PROD_SSH_KEY
PROD_PORT
PROD_PATH
```

The upload folder is deliberately excluded from automated deployments. It must be copied separately and retained across releases:

```text
data/uploads/
```

### Domains and TLS

DNS records should point the LMS subdomain to the VPS public IP. FastPanel or Nginx must issue and renew the Let's Encrypt certificate after DNS propagation. The application `PUBLIC_BASE_URL` must use the final HTTPS domain without a trailing slash.

## 13. Backup and recovery

Local data backup:

```powershell
npm.cmd run backup:data
```

Production backup commands:

```powershell
npm.cmd run prod:backup
npm.cmd run prod:backup:db
```

The deployment workflow also takes a PostgreSQL dump and source backup before applying a release. Media uploads are intentionally not overwritten during deployment.

## 14. Current operational status and follow-up work

### Completed

- Core LMS workflows, administration, roles, courses, tests, certificates, pricing, reports, invoices, imports, mail queue, auditing, media management, and public catalogue.
- PostgreSQL migration path and production-readiness tooling.
- English-only application interface, reports, exports, server messages, scaffold UI, and seed content.

### Requires operational verification

- Resolve the failed GitHub Actions run by checking the exact failed step in its log. The local build, production audit, and no-upload readiness check pass.
- Confirm the final production domain DNS, reverse proxy route, TLS certificate, and `PUBLIC_BASE_URL`.
- Verify that `data/uploads/` is fully present and readable on the VPS.
- Run the complete regression suite on a normal local terminal or GitHub Actions runner.
- Rotate any credentials that have ever been shared in chat, screenshots, local files, or prior configuration.

## 15. Maintenance rules

- Do not commit `.env`, private SSH keys, database dumps, or uploaded media.
- Do not overwrite `data/uploads/` during code deployment.
- Create a database backup before schema or data imports.
- Use `npm.cmd run build` before a requested commit.
- Push to GitHub only after explicit approval from the project owner.
- Keep production changes observable through the audit log, application logs, PM2 logs, and GitHub Actions logs.
