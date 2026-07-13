# Maritime Learning Academy portrait templates

This package contains six cleaned, import-ready PDF certificate backgrounds. Personal data, old certificate numbers, issue dates, expiry dates, the student photo and the academy stamp were removed from the source files.

The course title and course-specific regulatory text remain in each PDF background. The LMS adds the following values when a certificate is issued:

- full name;
- birth date in `04-Nov-1972` format;
- unique certificate number;
- issue date;
- expiry date (issue date plus five years);
- student photo;
- verification QR code;
- academy stamp as the top layer.

Run a dry check:

```powershell
node scripts/install-certificate-template-pack.mjs imports/certificate-templates/marine-academy-portrait-v1
```

Apply the templates after reviewing the matches:

```powershell
node scripts/install-certificate-template-pack.mjs imports/certificate-templates/marine-academy-portrait-v1 --apply
```

Only course templates are updated. Certificates that were already issued retain their saved template snapshot.
