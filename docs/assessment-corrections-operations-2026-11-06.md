# Assessment Correction Maintenance

Date: 2026-11-06. Requested by the platform owner after a read-only review of all 499 production assessment questions. This maintenance corrects demonstrable content/key errors and repairs unfair student outcomes without changing course configuration.

## Content Scope

The independent review is in `docs/assessment-correction-review-2026-11-06.md`; exact before/after snapshots and primary references are in `scripts/assessment-corrections-2026-11-06.json`. Of 90 original error candidates, 79 were accepted (40 unchanged-wording rekeys; 39 future repairs whose old versions are excluded from retrospective grading). Eleven candidates were deferred. Other uncertain, outdated and course-specific audit findings remain unchanged and need an instructor's review.

## Grading Rules

- Window frozen at `2026-11-06T12:23:59.696Z`, inclusive from `2026-10-30T12:23:59.696Z`; selects finished attempts, not student registration dates.
- Match all current question IDs, original text, ordered options, types and flags against the reviewed plan. Stop on drift; never force an overwrite.
- Rekeyed items receive credit for an exact corrected option-ID set. Already accepted answers retain their credit. Multiple-choice selections must match the full set.
- Voided historic questions are excluded from both numerator and denominator. Their new wording is never used to infer old student answers.
- Preserve original answers, score, status and failure reason under the attempt's `source.assessmentCorrections`; retain attempt IDs, sequence and timestamps.
- Never lower an awarded score or passing result, revoke certificates or forgive recorded expiry/failure reasons. No remaining valid questions or a mismatched historic paper requires human review.
- Use a saved historical pass threshold when present; otherwise use the course threshold. This operation does not edit pass thresholds, timers, attempt limits, prices, certificate templates or automation checkboxes.
- New test submissions save question snapshots, scoring settings and a paper hash. The public hash excludes correctness flags and uses a random revision on administrator edits so a key-only change invalidates the form without exposing a brute-force oracle for the key. Corrected courses reject obsolete forms with HTTP 409 and consume no attempt. A rejected POST cannot reset the timer; a new clock is allowed only after a server-recorded paper change.

## Certificates

Eligible corrected passes complete the original assignment. Existing active certificates are reused. New certificates use the platform's existing number, snapshot, template, QR, audit-event and notification functions; no separate PDF implementation is introduced. Automatic issuance honors the course checkbox. Inactive students, incomplete required materials and missing photos block new issuance.

For owner-approved one-off manual issuance only, `--approve-certificates` accepts an explicit comma-separated list of eligible assignment IDs. This invokes the ordinary manual-issue path and records the approved IDs in the operation audit. It does not enable automatic issuance for the course or unrelated students.

## Execution

Dry-run is the default and reads PostgreSQL without importing the application server:

```sh
node scripts/apply-assessment-corrections.mjs \
  --as-of 2026-11-06T12:23:59.696Z \
  --report /secure-backup-directory/assessment-dry-run.json
```

Before applying, stop every application writer, take a fresh database backup, and preserve the old server source. Run the CLI once with `LMS_MAINTENANCE_CONFIRMED=true` and `--apply`; provide an approval list only with explicit owner authorization. Restart the application even if the maintenance command fails. The PostgreSQL delta (questions, results, assignments, certificates, notifications and audit event) is one transaction. It does not replace the database or delete unrelated records. SMTP delivery is not run inside maintenance; the normal application delivers queued certificate notifications after restart.

The audit event action is `assessment_correction`, with the operation version, exact plan SHA-256 and detailed before/after report. Repeating the same version is a no-op. Reusing that version with a different plan hash is rejected. Content/grading maintenance is never run automatically during deploy.

## Recovery

Initial SQL backup: `/opt/marine-lms/app/backups/production-2026-11-06T12-29-05-564Z/postgres.sql` (private directory/file permissions). Immediate offline pre-apply SQL backup, original server source, dry-run and final report: `/opt/marine-lms/backups/assessment-20261106-preapply/` (directory 700, files 600).

If an application failure occurs before transaction commit, the delta rolls back. After a successful commit, do not restore an old full database over newer student activity. Use the exact plan's old snapshots and the attempt's original metadata for a targeted, instructor-approved correction; review any already-issued certificate and sent email before reversal. Reverting Git alone does not undo production data changes. Uploads are not modified.

## Verification

Manual only: build/typecheck/lint, 165 regression assertions, existing unit and integration suites, focused correction tests, PostgreSQL persistence/rollback tests, import/backup tests and browser tests. PostgreSQL/import tests use a disposable database on isolated verification cluster port 55433, not production port 5432. Local port 5433 was unavailable, so those tests were run on that isolated cluster. GitHub Actions deployment remains unchanged and does not run these tests.

## Production Outcome

Applied successfully at approximately `2026-11-06T12:45Z`, operation version `assessment-corrections-2026-11-06`, plan SHA-256 `0434ca5f911e646c4d022f5a401e4843f2e981cf7a25a8a4d9159f48e7604421`.

- 79 questions corrected, same 499 question and 1,877 option records retained. Eleven disputed candidates remain deferred.
- Six finished attempts reviewed; five affected attempts improved; one unrelated attempt unchanged. No skipped papers and no lowered outcomes.
- Port State Control: three failed attempts changed from 67% to 82% (two distinct students); another attempt improved from 58% to 73% and remains failed against the 80% threshold.
- Dangerous Goods: an already-passed attempt improved from 81% to 93%; its existing certificate was reused.
- Two corrected Port State Control assignments completed and two missing certificates issued through the normal manual path pursuant to the owner's explicit instruction to issue certificates withheld by platform error. The repair initially preserved the course's false automatic-issuance checkbox. After the owner explicitly confirmed "issue both and enable automatic issuance", the checkbox was enabled in a separate offline transaction at approximately `2026-11-06T12:55Z`. Audit event `assessment_autocert_psc_20261106` records false-to-true, course ID `wp_course_180` and owner authorization. The separate pre-change SQL backup is `before-psc-auto-enable.sql` in the same protected backup directory. Other courses' settings were not changed.
- Original attempt IDs, attempt counts and timestamps remain intact; source metadata preserves the old answers/results. The database audit records the two one-off approval IDs.
- Application restarted successfully; strict production readiness passed with zero warnings, 143 upload references checked and none missing. Both student photo files exist.
- Certificate email generation reached SMTP, but both messages failed with `certificate has expired`. Diagnostic TLS inspection confirmed the separate mail host `mail.maritimelearning.store` (`109.94.209.50`) presents a Let's Encrypt certificate expired on `2026-10-20T10:13:34Z`. Strict TLS remains enabled. The issued LMS certificates are unaffected and available in the students' accounts. Renew the mail-server certificate, then retry the two failed certificate notifications through the normal queue. Do not disable TLS verification or reissue certificates merely to resend email.
- All 64 distinct automated test cases (15 unit, 33 existing integration, 2 focused integration, 7 PostgreSQL, 3 import/backup, 4 browser) and 165 regression assertions passed across local and isolated verification runs. The focused suite also passed on Linux after the final guards. Tests remain manual, not part of auto-deploy.

Both application deployments passed: [initial corrections](https://github.com/bernik1986/LMS/actions/runs/42220455035), [paper-revision hardening](https://github.com/bernik1986/LMS/actions/runs/42221022594). A post-deploy read-only rerun confirmed the correction is a no-op, exactly two affected active certificates exist, and exactly one correction audit event exists. No additional attempts were submitted between the frozen review cutoff and the production application, so no old-key submissions were missed during preparation.

Private per-student evidence and certificate identifiers are retained in the protected production audit/backup, not this public source document. Subsequent documentation-only deployment verification is retained in GitHub Actions.
