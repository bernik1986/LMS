# Rightship Inspection Cover

- Created: 26 October 2026.
- Generator: built-in image generation tool, reference-image edit.
- Course: `course_0bbe1e76`, `Rightship Inspection`.
- Asset: `assets/course-covers/course_0bbe1e76.png`.
- Reference: `assets/course-covers/course_4c9584bf.png`.
- Background: opaque white, matching the existing cover series.

## Generation Prompt

Edit this book cover into a new course-cover variant. Preserve the exact portrait composition, complete uncropped book, white background, navy spine, maritime emblem, MARITIME PORTAL branding, typography and OPERATIONAL MANUAL subtitle. Replace the title on front and spine with RIGHTSHIP INSPECTION. Replace the lower photograph with a realistic maritime inspector in helmet and safety clothing checking a bulk carrier deck with a clipboard. No additional text or logos.

## Deployment

The targeted migration `20261026120000_apply_rightship_inspection_cover` changes
only the matching course's image URL and update timestamp. It does not alter
course materials, students, prices, or certificate settings. The deployment
workflow creates a database and source backup before applying migrations.
