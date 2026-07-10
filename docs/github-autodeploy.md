# GitHub Auto-Deploy

Production deploy runs from `.github/workflows/deploy-production.yml` on every push to `main`.

The workflow deploys code only. It intentionally excludes:

- `.env`
- `.env.local`
- `data/db.json`
- `data/uploads`
- `node_modules`
- `.next`
- local deploy keys and logs

Before updating the app it creates:

- PostgreSQL dump in `/opt/marine-lms/backups/.../postgres.sql`
- code backup without uploads in `/opt/marine-lms/backups/.../code-no-uploads.tar.gz`

## Required GitHub Secrets

Set these repository secrets in GitHub:

```text
PROD_HOST=109.94.209.94
PROD_USER=root
PROD_SSH_KEY=<private SSH key allowed to access the server>
```

Optional:

```text
PROD_PORT=22
PROD_PATH=/opt/marine-lms/app
```

If the required secrets are missing, the workflow exits successfully with a notice and skips deploy.

## What Happens On Deploy

The workflow:

1. Builds a source archive without uploads and secrets.
2. Uploads it to `/opt/marine-lms/releases`.
3. Creates a database backup on the server.
4. Extracts the code into `/opt/marine-lms/app`.
5. Runs `npm ci --include=dev`.
6. Runs Prisma generation and migrations.
7. Runs build, production audit, and `prod:check:no-uploads`.
8. Restarts `marine-lms` in PM2.
9. Checks `/healthz`.

After the full `data/uploads` folder is copied to production, run:

```bash
cd /opt/marine-lms/app
npm run prod:check
```
