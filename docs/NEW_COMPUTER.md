# New Computer Handoff

## Scope

This guide was prepared on 2026-11-25. The live site remains on the existing VPS.
Turning off the previous computer does not stop the site or GitHub Actions.

- Repository: https://github.com/bernik1986/LMS
- Prepared branch: `handoff/new-computer-2026-11-25`
- Production branch: `main`
- Public site: https://maritimelearning.store
- Existing alias: https://lms.maritimelearning.store
- VPS: `109.94.209.94`, application: `/opt/marine-lms/app`
- PM2 application: `marine-lms`, entry point: `scripts/prod-start.mjs`
- Local application entry point: `scripts/lms-server.mjs`
- Separate SMTP host: `mail.maritimelearning.store` / `109.94.209.50`

The handoff branch does not deploy automatically. Do not push to main until the
desired changes have been reviewed. Tests remain manual; no tests were added to
the auto-deploy workflow.

## 1. Accounts And Software

On the new Windows computer install Git, Node.js 22.12+ (production uses 22.23.4),
and GitHub CLI. Docker Desktop is optional for local PostgreSQL, not required for
the isolated JSON demo. WinRAR is needed only to unpack the private transfer.

Sign in to your existing GitHub account and the coding application. Account
sessions, browser cookies, password-manager entries, connector permissions, and
computer-control permissions are not transferred by Git or by the private
archive. Approve those on the new computer as needed.

Keep access to the LMS administrator account, hosting panel, domain/DNS account,
mail panel, and their MFA recovery methods in your password manager. Do not put
passwords or recovery codes in this repository.

## 2. Clone The Prepared Code

```powershell
gh auth login --hostname github.com --git-protocol https --web
git clone --branch handoff/new-computer-2026-11-25 https://github.com/bernik1986/LMS.git
cd LMS
git status
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/setup-new-computer.ps1 -InstallDependencies -Start
```

If port 3000 is occupied, pass `-Port 3100`. The script uses a separate
`data/local-development/` folder, explicitly disables SMTP, and does not connect
to production. It never overwrites an incompatible existing `.env.local`.
Re-running the same isolated configuration is safe.

The demo login details are printed by the local app. They are not production
credentials. An empty local installation is expected; real students and uploads
remain on the VPS. Do not seed or reset production to populate a local demo.

The previous computer uses nonstandard Git directories. A fresh clone has a
normal `.git` folder: use ordinary `git status`, `git commit`, and `git push`.
Do not copy the old `.git`, `.gitlocal`, or `.gitpush` over a fresh clone.

## 3. Optional Local PostgreSQL

`docker compose up -d postgres` creates the project database exposed on port
5433. Port 5432 is deliberately not used because another project used it.
Before changing the local storage mode, back up the generated `.env.local`,
review the connection string, and confirm it points only to this local container.
The setup script intentionally supports the safe JSON demo rather than silently
switching a machine to a real database.

Never run `db:first-import`, `reset:data`, a force-replace migration, a student
purge, or a seed command against production during workstation setup.

## 4. Private Operations Transfer

The separate password-protected RAR contains operational scripts, existing SSH
keys and host pins, archived local environment files, local database history,
and selected generated PDF/ZIP outputs. Treat it as highly sensitive.

1. Transfer the RAR through a trusted private channel.
2. Obtain its password separately; do not publish either item.
3. Extract it to a private folder outside the clone, not directly over the app.
4. Read the included manifest and instructions before restoring selected items.
5. Keep archived `.env` files as reference; do not replace the isolated demo
   configuration with them.

For SSH tooling, copy only `.deploy-keys` and required private `.deploy` scripts
into the clone after checking their contents. Both folders are Git-ignored.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/setup-new-computer.ps1 -WithServerTools
```

If using a non-default demo port, pass that same `-Port` here.
This installs the private helper dependency but does not connect to a server.

Existing SSH keys can preserve continuity temporarily. Prefer creating a separate
key on the new computer and adding its public key to the VPS after verifying the
account and permissions. Do not revoke old keys or change GitHub Actions secrets
until the new machine is tested. GitHub authentication must be performed again;
the archive intentionally excludes GitHub CLI tokens and browser credentials.

Private one-off scripts may contain old computer paths, historical approvals,
financial data, or production-writing actions. Do not bulk-run them. They are
history and examples for review, not an initialization sequence.

## 5. Read-Only Access Verification

Verify the pinned server key before using SSH. The private transfer contains
`.deploy-keys/server_known_hosts`. For example, after installing Git's OpenSSH:

```powershell
ssh -o StrictHostKeyChecking=yes -o UserKnownHostsFile=.deploy-keys/server_known_hosts -o HostKeyAlgorithms=ssh-ed25519 -i .deploy-keys/marine_lms_codex_rsa root@109.94.209.94 "whoami; curl -fsS http://127.0.0.1:3000/healthz"
```

If OpenSSH reports a private-key ACL problem, restrict that file to the current
Windows account instead of making it readable by everyone. Never bypass a host
key mismatch. Check with the server administrator when the pin changes.

SSH access is distinct from GitHub access. GitHub Actions uses repository secrets;
an ordinary push does not require a production key on the developer computer.
Direct server investigation, mail checks, database operations and recovery do.

## 6. Tests And Deployment

```powershell
npm.cmd run build
npm.cmd run test:assessment-corrections
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests/workstation/new-computer-setup.test.ps1
npm.cmd run test:manual
```

Browser and PostgreSQL suites may require Chrome and local PostgreSQL. Review
`docs/TESTING.md` for their prerequisites. Do not point test databases at production.

Continue work on a feature branch and push it to GitHub. A push to a non-main
branch does not deploy. Merging reviewed changes into main triggers the existing
production workflow, which backs up the database/code, installs dependencies,
migrates the schema, checks readiness and reloads PM2.

Repository secrets remain in GitHub. They are not exported and cannot be recovered
from this archive. Tests are not automatically run by the deployment workflow.

Handoff verification on 2026-11-25: build, 165 regression assertions, unit,
assessment-correction and all nine HTTP integration suites passed. The workstation
setup checks passed. PostgreSQL tests and the database-backed price import could
not run because the local PostgreSQL container was unavailable on port 5433;
therefore the complete `test:manual` run was not successful. WordPress import and
file backup tests passed. Browser tests were not run for this handoff.

## 7. Data And Operational Notes

- PostgreSQL and `/opt/marine-lms/app/data/uploads` are authoritative production
  data. The local JSON file in the private archive is historical, not a fresh
  production database snapshot.
- Full local backup/media trees and dependencies are not part of the small
  transfer. Keep the previous disk and existing VPS backups until verification
  finishes. A separately recorded current SQL backup is kept on the VPS.
- Course prices, passing marks, attempts, certificate settings, invoices and
  recipients were changed in the production database, not pending Git commits.
- The Yialos invoice `INV-20261116-0001` currently totals 3205 USD, contains 30
  certified enrollments and excludes Vitalii Ivanov. No email was sent.
- Certificate typography/signature experiments are samples only. They were not
  applied to live templates or existing certificates.
- The Hazmat 1.45 inherited template was observed to contain a PSSR reference.
  This is an unresolved content-review item, not approved for automatic repair.
- The SMTP certificate was issued manually and expires on 2027-02-04. Automatic
  mail-certificate renewal/install has not been established; verify it separately.

## Completion Checklist

- GitHub authentication and repository access work on the new machine.
- The handoff branch and its commit match the transfer manifest.
- The isolated local demo starts and sends no real email.
- The existing LMS administrator login works through the public site.
- SSH host-pin verification and a read-only health check succeed.
- No production secrets or student documents appear in `git status`.
- All required private files have been transferred securely.
- Only then retire the previous workstation or rotate its access keys.
