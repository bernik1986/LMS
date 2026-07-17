# Marine LMS - Figma Design Brief

Copy the prompt below into Figma AI or give it to a product designer. The application interface must be entirely in English.

---

## Prompt for Figma

Design a complete, high-fidelity responsive web application called **Marine Portal LMS**. It is a professional maritime training platform for maritime professionals, training centre staff, instructors, and students. This is an operational learning-management system, not a marketing landing page.

The product has three distinct experiences:

1. Public website and course catalogue.
2. Student learning portal.
3. Administrator and instructor back office.

Create a reusable desktop and mobile design system, then create the screens listed below. Use realistic English content and maritime course examples. Make the interface polished, calm, credible, and practical for repeated daily work.

### Brand and visual direction

- Brand: **Marine Portal**. Use a marine compass / maritime professional identity.
- Main palette: clean white, deep navy `#06395D`, ocean blue `#0B4F7A`, turquoise accent `#0E9FBD`, pale blue `#DCEEF8`, pale cyan `#DDF7FB`, charcoal text, restrained red for destructive actions, green for successful completion.
- Tone: modern maritime training centre, international, reliable, regulated, premium but not luxurious.
- Do not use generic SaaS purple gradients, bokeh/orb backgrounds, oversized rounded cards, or decorative dashboard clutter.
- Use ample white space, concise typography, subtle 1px borders, 6-8px corner radius, soft shadows only where necessary.
- Use Lucide-style familiar icons for icon buttons and show tooltips for unfamiliar controls.
- All text and UI labels must be English.
- Desktop target: 1440px wide. Mobile target: 390px wide. Create responsive states rather than simply shrinking desktop.
- Use tables for operational data, compact filters, predictable navigation, visible statuses, empty states, confirmation states, error states, and loading/saving feedback.

### Design system to create first

Create components and variants for:

- Top public navigation: logo, Catalog, Blog, About, Contacts, Login / My portal.
- Admin sidebar navigation and compact mobile navigation drawer.
- Student sidebar / top navigation.
- Primary, secondary, destructive, ghost, icon-only, and disabled buttons.
- Search field, select, date picker, multi-select, checkbox, radio group, file upload, text area, rich text input, filter chips.
- Status pills: Active, Draft, Completed, In progress, Failed, Issued, Revoked, Sent, Paid, Overdue, Cancelled.
- Course card, course thumbnail/avatar, student avatar/photo placeholder, certificate thumbnail, notification row, audit log row, invoice line item.
- Data table with sticky header, selectable rows, sortable columns, pagination, empty and loading states.
- Toasts and inline notices for success, warning, error, and informational feedback.
- Modal, confirmation dialog, side sheet/drawer, tabs, segmented controls, and tooltips.

## Information architecture and screens

### A. Public website

#### 1. Home / catalog showcase

Purpose: allow unauthenticated visitors to discover courses and submit an application.

- Simple header with the Marine Portal logo at left, centered navigation (Catalog, Blog, About, Contacts), Login at right.
- Do not create a text-heavy hero. Use a full-width maritime bridge / navigation / vessel-learning visual with a subtle animated or layered movement treatment. The brand and available training must be visible in the first viewport.
- Featured course area: curated courses selected by an admin. Each card shows cover image, course title, and actions **View details** and **Apply**. Public prices are temporarily hidden, so leave no price element or reserve a discreet optional component for future use.
- Clear continuation into the course catalogue, visible pagination and total course count.
- Footer: editable policy links (Terms & Conditions, Privacy, User Policy), editable link labels and contents, plus a feedback form with Name, Email, Subject, Message.

#### 2. Course catalogue

- Grid/list of all active courses with cover image, title, **View details**, and **Apply**.
- Filter bar: keyword search, Suitable for / Position, Category, sort by title A-Z or Z-A. Do not include course author.
- Course categories include Safety, Soft Skills, Navigation, Engineering, Environment, Cargo Operations.
- Suitable-for positions include Any position, Master, Chief Mate, Engine Officer, Deck Officer, All Seafarers, Chief Engineer, Second Mate, Electro-technical Officer, Catering, ETO.
- Pagination must look clear and intentional, not like a hidden text link.

#### 3. Public course detail

- Course cover, title, summary, learning outcomes, duration, course contents/lesson outline, category, suitable positions, and a prominent Apply action.
- Public visitor application form asks for contact information and selected course.
- If a student is logged in, the Apply flow should be reduced: they only confirm the course; the application is linked to their account and an email notification is sent to the administrator.

#### 4. Blog

- Editorial grid for official IMO maritime-news RSS articles.
- Use card-based news with real image, title, publication date, short excerpt, and Read article link.
- Latest articles always appear first. Make articles visually more prominent than tiny feed rows.

#### 5. About and contacts

- About Marine Portal page with this key content: English-only blended maritime learning, periodic assessments, final test, instructor oral examination and discussion, additional guidance where needed, and certificate issuance only after demonstrated competence.
- Contacts page and feedback form.
- Separate editable policy pages.

#### 6. Authentication

- Login, Forgot password, Reset password.
- Professional, small focused form surface with clear validation and rate-limit/error states. No marketing card overload.

### B. Student portal

#### 7. Student dashboard

- Welcome area, active courses, progress indicators, upcoming tests, recent certificates, profile completion reminder.
- Important persistent warning when certificate photo is missing: explain that a profile photo is required before a future certificate can be issued. This warning should also be shown after course completion if photo is still missing.

#### 8. My courses

- Assigned course cards/list with progress, lesson count, course status, Continue learning action.
- A completed course with an issued certificate displays a **Certificate** action that downloads/opens the certificate.

#### 9. Learning course player

- Desktop: course outline / lesson navigation at left, lesson content at centre, progress and material completion controls.
- Video materials must play directly inside the portal. Text/PDF/material reading must happen in the portal where possible; avoid an "Open file" dependency for normal study.
- Support video, document, text, and link material types, required/optional items, completed state, and Next lesson.
- Mobile: outline becomes a drawer or collapsible section.

#### 10. Test-taking flow

- One question per screen, not all questions on one long page.
- Prominent progress indicator, question number, answer options, Back/Next navigation, Submit test confirmation.
- Immediately after submit, scroll/focus to results: score, pass/fail status, feedback, retake availability, and next steps.

#### 11. My certificates

- Certificates table/grid with course, issue date, expiry date (five years from issue), certificate number, status, View/Download actions.
- Certificate number follows `000000000/DD/MM/YYYY`, beginning from serial number `725645565`.
- Certificate verification uses a QR code leading to a public verification page.

#### 12. My profile

- Required fields: Last name, First name, Date of birth, Email, Position.
- Optional field: Company.
- Profile photo upload specifically for certificates, with a clear photo preview and requirements.
- Change password section.

### C. Administrator / instructor back office

Create a dense but calm operational UI. Admin has full access; Instructor has limited access: can register students, edit student information and photo, and assign courses, but cannot delete data, issue certificates manually, edit prices, access reports/invoices/audit, or manage global settings.

#### 13. Admin dashboard

- High-signal operational overview: total students, active assignments, course applications, pending actions, certificates, and notifications.
- Quick actions: New course, New student, Assign course, Issue certificate, Review applications.

#### 14. Students / Users

- Start with a compact searchable student list. Do not place the full create-user form at the top by default.
- Toolbar actions include **New user**. Clicking it opens a dedicated creation screen or drawer.
- Student list/cards show profile photo/avatar, name, email, position, company, status, assigned courses, certificate shortcut, and contextual actions.
- Create user fields: role, email, first name, last name, date of birth, position, company, phone, temporary password, optional photo upload.
- After creation show a clear success message and focus/scroll to the new user.
- Student detail: edit profile, upload/review photo, current assigned courses, assign course, certificate history, manual certificate issue with a selectable issue date, reset password, archive action for admins only.

#### 15. Courses overview

- A compact list/table of courses with round/square course avatar, title, status, category, lesson count, test state, and actions.
- Do not show the full New Course form at the top. Toolbar: **New course**, **Merge courses**, **Course prices**, **Configure home page**.
- New course opens a separate dedicated form.
- Support deleting/archive course action with a clear confirmation dialog and warnings about assignments/materials.

#### 16. Course editor

- Compact course heading; do not waste a large hero area on course title/description.
- Settings: title, short/long description, cover image, status, category, suitable positions, convention reference (large multi-line text area with effectively no artificial small character limit), certificate settings, course visibility.
- Lesson builder with lessons and ordered materials. Material types: Video, PDF/document, text, link. Upload/replace files, set required flag, reorder, preview/open media.
- Test builder: questions, answers, passing settings, preview.
- Certificate settings: select/template editor, automatic certificate issuance toggle, and convention/header textual fields.

#### 17. Merge courses

- Admin-only, guided merge workflow: choose two or more source courses, preview lessons/materials/tests that will remain, create merged course, specify title and cover, source-course retention warning. Preserve all learning materials and assessments in the merged result.

#### 18. Course prices

- Compact editable table only: course thumbnail/name, Old price, New price, and **Auto-issue certificate on completion** checkbox.
- Currency is USD. Prices are managed here but currently not shown publicly.
- Export filtered data to Excel.

#### 19. Homepage management

- Curate featured courses for the public homepage through a clear selected/unselected course list with course cover and title only.
- Footer editor: change policy link label, destination/content for each policy, and feedback section text.

#### 20. Tests and course results

- Test attempts, filtering, score, status, pass/fail, date, student and course. Admin can unlock a retake or reset attempts where permitted.

#### 21. Certificates

- Searchable/filterable list: student, course, certificate number, issue date, expiry date, status, View, Download, Reissue, Revoke, Email, Export CSV/XLS.
- From a student row or profile, clicking the certificate opens the actual certificate rather than merely displaying that it exists.

#### 22. Visual certificate template editor

- This is a key screen. Design a practical A4 landscape/portrait editor with a realistic canvas, zoom, layers, and a side properties panel.
- Upload PDF, PNG, JPEG background templates. Preserve A4 aspect ratio in the editor and in the downloaded PDF.
- Add, select, move, resize, and delete text fields and image elements. Drag-to-resize with handles, not only numeric arrows.
- Text supports font, size, color, alignment, weight, line breaks, and automatic text fitting. New lines entered in the editor must render as new lines in the certificate.
- Insert dynamic variables: student first/last name, date of birth, position, company, course title, certificate number, issue date, expiry date, QR code, student photo, signature/stamp, header, convention reference.
- Add custom static text fields and images. Images can be stretched/resized and set as background or foreground.
- Stamp must always render in the top visual layer.
- Apply a template to one course or all courses, show confirmation/result state.
- Import/export the entire template layout as a backup file so it can be restored later.

#### 23. Applications

- Course applications with applicant information, selected course, date, status (New, Contacted, Accepted, Rejected), notes, and action to convert an application to a user.

#### 24. Checks / invoices / reports

- Purpose: create billing reports and invoices for a user, company, manager, one student, multiple students, or all students for a selected period.
- Filters: creator/manager/company, students, period preset (current month, previous month, custom range), reporting basis (assigned, activated, paid, completed), course, training status, and grouping (student, course, company, creator, date, status).
- Detail rows can include student name, company/creator, course, assignment/start/completion dates, status, old price, new price, discount, total, certificate number, registration date, and other selectable fields.
- Let admin select which columns to include before generating the report. Checkboxes must be compact.
- Preview before finalisation; admin can exclude students/courses, edit a line amount, add discount/additional fee/comment, alter recipient details, issue date, and due date.
- Create Invoice Draft action, invoice detail, print, PDF download, email, Excel export, and saved invoice history.
- Invoice statuses: Draft, Generated, Sent, Viewed, Partially paid, Paid, Overdue, Cancelled.
- Include an editable invoice template/settings screen based on a professional maritime services invoice: issuer/recipient blocks, invoice number/date/due date, line-item table, subtotal, discount, tax/VAT, total, payment terms, comments.

#### 25. Notifications / SMTP

- Email queue dashboard: SMTP status, test email input, send pending queue button, searchable delivery log and status pills.
- Template list for automated emails: application received, account created, course assigned, password reset, certificate issued, certificate expiring, etc.

#### 26. Audit log

- Present human-readable event labels first: "Student created", "Course assigned", "Password reset", "Price updated", "Certificate issued".
- Each row has date, administrator, friendly action, and a **Details** button/drawer for technical data. Do not expose raw JSON as the main list experience.

### Important product rules

- Course completion can automatically issue a certificate only if the course setting is enabled and the student has a certificate photo.
- A manually issued certificate lets the administrator choose the issue date; automatic issuance uses the current date.
- Certificate expiry is always five years after the issue date.
- Every certificate has a unique serial number and QR verification.
- Instructors cannot delete anything, manually issue certificates, manage prices, reports, invoices, audit, or global settings.
- Prices remain configurable in admin, but are not currently visible on public course cards or public course pages.
- Preserve position/category filters and their relationships with each course.

### Deliverables

Create:

1. A reusable component library with variants and tokens.
2. A desktop public website flow.
3. A desktop student portal flow.
4. A desktop admin flow covering the highest-priority screens above.
5. Responsive mobile versions for public catalogue, student course player, student profile, and the most common admin list/detail screens.
6. Clickable prototype connections for: public course application, login, course learning, test completion, certificate download, new student creation, course editor, certificate template editing, and invoice creation.

Use representative maritime course imagery (ship bridge, ECDIS, radar, engine room, safety drills, cargo operations) that shows actual training subject matter. Use clear English labels throughout.

