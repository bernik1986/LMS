# Marine LMS

Marine LMS is a maritime learning platform for course delivery, testing, certificate issuance, staff operations, reporting, and controlled production deployment.

## Production application

The live application is the standalone Node.js server:

```text
scripts/lms-server.mjs
```

The `src/app/` tree is a Next.js UI scaffold used for future migration and design work. It is not the production runtime.

## Documentation

Read the complete project record here:

- [Project documentation](docs/PROJECT_DOCUMENTATION.md)

It covers the product scope, architecture, confirmed implementation timeline, workflows, roles, data model, certificates, imports, deployment, operations, security, tests, and known limitations.

## Local start

```powershell
npm.cmd install
npm.cmd run dev
```

Open `http://127.0.0.1:3000`.

If port 3000 is in use:

```powershell
$env:PORT="3100"; npm.cmd run dev
```

## Essential checks

```powershell
npm.cmd run build
npm.cmd run audit:prod
npm.cmd run prod:check:no-uploads
```

`npm.cmd run test` launches the full regression runner. It must be run in a normal local terminal or CI environment that allows child-process creation.

## Data safety

Never commit or overwrite these production data locations:

```text
.env
data/uploads/
data/db.json
```

The production database is PostgreSQL (`LMS_STORAGE=prisma`). Uploaded media is stored separately under `data/uploads/`.
