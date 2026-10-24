# Production Maintenance: 23 October 2026

## Reason and Scope

The PHP advisory published on 21 October 2026 disclosed CVE-2026-109618 and
CVE-2026-109619. The LMS runs on Node.js, but its VPS also had active Apache
and PHP-FPM installations with an unpatched Ubuntu PHP package.

Maintenance covered available package updates on the existing Ubuntu release,
application dependency updates within the existing supported major versions,
full project testing, production checks, and fixes found by those checks.
The operating system was not upgraded to another Ubuntu release.

References:

- https://www.php.net/archive/2026.php#2026-10-21-5
- https://ubuntu.com/security/notices/USN-8948-1

## Restore Points

Production server: `109.94.209.94`.

Production backup: `/opt/marine-lms/backups/security-20261023`.
The backup directory is restricted to root. It contains:

- `postgres-all.sql` and `postgres-globals.sql`: PostgreSQL database and role dumps.
- `mysql-all.sql`: MySQL database dump, routines, triggers, and events.
- `app-before.tar.gz`: application source, configuration, and assets before maintenance.
- `etc-before.tar.gz`: server configuration before maintenance.
- `uploads/`: independent copies of all 243 uploaded files, approximately 56.3 GiB.
- `uploads.sha256` and `SHA256SUMS`: integrity checksums.
- `packages-before.tsv` and `packages-after.tsv`: exact installed package versions.
- `node_modules-before/`: application dependencies before the runtime update.
- `production-package-before.json`, `production-package-lock-before.json`,
  `production-lms-before.mjs`, and `prod-check-before.mjs`: files for a scoped
  application rollback.
- `backup.log`, `upgrade.log`, `full-tests.log`, and runtime preparation/application logs.

Archive integrity checks passed. All copied uploads were additionally compared
against the live source using SHA-256; all 243 matched.

Local source backup: `backups/security-20261023/local-project-before.tar.gz`.
SHA-256: `DFFED150CD52E019F9AE3540DAE1A56A1D440CAB688DE33B46338D315D93632A`.

Application rollback should stop `marine-lms`, restore the saved application
files and dependency directory, then restart the existing PM2 system service.
Restore database dumps only when a database rollback is actually required.
No production database migration was needed for this maintenance. Server
configuration recovery can use the archived files individually; reverting
patched PHP packages would reintroduce the disclosed vulnerabilities.

## Installed Versions

All available upgrades on the configured repositories were installed. The
initial refreshed upgrade plan contained 205 package upgrades.

| Component | Installed After Maintenance |
| --- | --- |
| PHP CLI, FPM, and Apache module | `8.3.6-0ubuntu0.24.04.13` |
| Apache | `2.4.58-1ubuntu8.17` |
| Nginx | `1.30.6-1~noble` |
| OpenSSL | `3.0.13-0ubuntu3.16` |
| PostgreSQL | `17.11-1.pgdg24.04+2` |
| Node.js | `22.23.4` |
| sharp | `0.35.5` |
| pg | `8.23.1` |
| Prisma client and PostgreSQL adapter | `7.10.1` |
| Next.js and ESLint Next configuration | `16.4.2` |
| React and React DOM | `19.3.1` |
| Playwright Core | `1.64.1` |

Remaining direct and transitive dependency updates are recorded in
`package.json` and `package-lock.json`.

## Corrections Found During Verification

- Test scripts now use `--experimental-test-isolation=none`, supported by
  both server Node.js 22 and local Node.js 24.
- The import test clears migration-created seed records in its disposable
  database before installing the fixture. Production data is not involved.
- Course and student deletion confirmations use a nonce-authorized script
  and `data-confirm`, replacing inline event attributes blocked by the CSP.
- Quiz elements marked `hidden` stay hidden despite the layout styles.
  Browser checks verify one visible question and correct navigation controls.
- Browser tests filter question containers rather than counting their visible
  descendants, and verify that cancelling deletion prevents submission.
- Production file checking examines live records without treating intentionally
  truncated historical audit details as current file references. A unit test
  retains coverage for user photos, certificate snapshots, materials, settings,
  and direct-certificate photos.

The production server module received only the deletion-confirmation and quiz
visibility fixes from this work. Other previously pending local application
changes, cover assets, and migrations were not included in the server update.

## Verification

The complete test bundle passed in an isolated application copy with a separate
PostgreSQL cluster on `127.0.0.1:55433`, using an unprivileged test account and
local SMTP fixtures. Production student accounts and certificates were not used.
The test cluster was stopped afterward.

| Check | Result |
| --- | --- |
| TypeScript and ESLint | Passed |
| Regression script | 165 assertions passed |
| Unit tests, including final file-reference regression | 6 passed |
| Integration tests | 33 passed |
| PostgreSQL persistence and migration tests | 5 passed |
| Import and backup tests | 3 passed |
| Desktop/mobile browser tests | 4 passed |
| Production dependency audit | 0 vulnerabilities |
| Production database verification | 0 errors, 0 warnings |
| Strict production readiness check | Passed, 0 warnings |
| Live upload references | 128 checked, 0 missing |
| Public home, login, catalogue, both health URLs | HTTP 200 |

This totals 51 tests plus 165 regression assertions. The complete bundle
finished successfully before the last file-checking unit case was added; the
updated six-case unit suite was then run separately on Windows and Linux.

Five audit findings remain in the development-only chain
`eslint-config-next -> @next/eslint-plugin-next -> fast-glob -> micromatch -> braces`.
The latest available `braces` release was `3.0.3`, with no patched release
available for the remaining advisory. An automatic forced downgrade of the
Next.js lint configuration was not applied. Runtime dependency auditing passes.

## Operational Notes

- The updated SSH service briefly refused connections during package processing.
  Access recovered, `/run/sshd` was verified, and the SSH configuration passed.
- The package upgrade stopped the PostgreSQL main cluster. It was explicitly
  started before the final application health checks.
- Updating PM2 from a transient maintenance unit stalled while restoring its
  logging module. The application update rolled back automatically; PM2 was
  restored through `pm2-root.service`, and the runtime update was successfully
  applied using that stable daemon. The saved PM2 process list was refreshed.
- No reboot-required marker remained after the updates.
- Five failed auxiliary units already existed before maintenance:
  `exim4-base`, `fastpanel-ip-update`, `ifupdown-pre`, `memcached`, and
  `systemd-networkd-wait-online`. These remain outside the LMS update scope.
- Tests remain manually triggered; the GitHub deployment workflow was unchanged.
- The initial server maintenance did not commit or push repository changes.
  Repository synchronization was requested separately on 24 October so future
  deployments retain the updated dependency lockfile and application fixes.

## Repository Synchronization: 24 October 2026

The follow-up repository update includes the dependency and verification fixes
above, together with previously pending test-timer improvements and the
INERT GAS SYSTEM cover. Tests now show a countdown, submit automatically at
the deadline, and distinguish expired attempts from below-pass-mark results.
The server allows a short submission grace period for transport latency.
A dedicated integration test covers expiration and a successful retake.

The course cover is applied by a targeted migration matching both the existing
course ID and title. No student records or certificate settings are reset.
The deployment workflow remains unchanged, with tests triggered manually.
Commit identity and deployment outcome are recorded in Git and GitHub Actions.

## Follow-up: 24 October 2026

The hosting provider's PHP security email highlighted FASTPANEL-managed PHP
packages. Refreshing the repository metadata on 24 October found one new
update, `fastpanel2-php74` from `1.0-ubuntu24.04p1` to `1.0-ubuntu24.04p2`.

Before installation, the PHP 7.4 binary tree and configuration were archived in
`/opt/marine-lms/backups/fastpanel-php74-20261024/php74-before.tar.gz`.
Archive integrity was checked and a checksum saved. The package update
completed successfully, with no further available upgrades afterward.

The PHP 7.4 FPM service remains inactive. The CLI reports PHP 7.4.33 with a
24 October 2026 build date; vendor security backports do not necessarily
change this upstream version string. Its unused CLI also reports an
`imagick`/`gmagick` extension conflict, outside the active LMS runtime.
Active Ubuntu PHP remains patched at `8.3.6-0ubuntu0.24.04.13`, and the
FASTPANEL PHP 8.4 binary reports `8.4.27`. The public LMS health check passed
after the additional package update.
