# Assessment Correction Review

Date: 2026-11-06. Independent content review of exactly the 90 findings marked `status=error` in `assessment-audit-2026-11-06.json`. No other findings, pass thresholds or course completion requirements are in scope.

## Decision

- 79 corrections: 40 pure rekeys and 39 future repairs with retrospective voiding.
- 11 deferred findings: no automated content or score change authorized by those entries.
- All 90 audit numbers and question IDs are represented exactly once. Audit numbers are one-based positions in the flattened list of actual questions (499); courses without questions do not occupy a position.
- The companion JSON is the authoritative machine-readable plan. It includes exact old snapshots, all new options in original order with unchanged IDs, per-item reasons and source URLs. Old non-English text is preserved only as exact matching evidence; all future question/option content is English.

## Priority Items

| Audit | Question | Past treatment | Future answer / repair | Primary support |
| --- | --- | --- | --- | --- |
| 422 | wp_question_122 | rekey | A: initial inspection | [Paris MoU inspection types](https://parismou.org/inspection-type/) |
| 427 | wp_question_127 | void | B: unresolved-disagreement complaints procedure; explicitly scope the stem to Paris MoU | [IMO A.1206(34), appendix 1 annex, paragraphs 20-22](https://wwwcdn.imo.org/localresources/en/OurWork/IIIS/Documents/A%2034-Res.1206%20-%20PROCEDURES%20FOR%20PORT%20STATE%20CONTROL%2C%202025%20%28Secretariat%29.pdf); [Paris MoU PSCC59/2026/02, sections 1.1 and 4.1](https://parismou.org/download/pscc59-2026-02-general-principles-to-be-applied-in-an-inspection/) |
| 485 | wp_question_546 | void | B: No; replace Russian yes/no labels with English | [IMO MSC.556(108), IMDG amendment42-24](https://wwwcdn.imo.org/localresources/en/KnowledgeCentre/IndexofIMOResolutions/MSCResolutions/MSC.556(108).pdf) |
| 498 | wp_question_559 | void | A+B; specify actual/likely loss into the sea and permit two selections | [IMO A.851(20), dangerous-goods reporting](https://wwwcdn.imo.org/localresources/en/KnowledgeCentre/IndexofIMOResolutions/AssemblyDocuments/A.851(20).pdf) |

PSC 427 is not a statement that every jurisdiction has identical complaint procedures. DG 485 has a verified false key, but its non-English choices justify conservative exclusion instead of assuming past comprehension. DG 498 cannot be repaired retrospectively by choosing a single inferred answer. Other incident-reporting duties may still apply even where the narrowly defined overboard-loss trigger is absent.

## Retrospective Contract

- `rekey`: only correctness flags change. Preserve the original wording, type and option text. Match stored option IDs against the corrected key using the normal assessment scoring policy.
- `void`: apply the new content only to future questions. Exclude the old item from both earned/possible-score calculations; do not score historic selections against the replacement answer or convert the void into a new answer credit.
- Snapshot guards must compare the old stem, type, ordered IDs, texts and correctness flags before applying a correction. A mismatch requires investigation, not a forced overwrite. Historical attempts must also be matched to the applicable old question version where snapshots exist.
- An attempt with no remaining scorable questions requires explicit handling; division by zero or automatic certification is not authorized here.
- Certificate issuance belongs to the separate normal-rule maintenance workflow. If corrected results establish eligibility after a platform error, issue/reuse the normal certificate only after all ordinary completion, payment and other policy checks. This review neither creates certificates nor waives requirements.
- This package does not authorize lowering existing awarded outcomes or revoking certificates. The main workflow must preserve the requested student-benefit policy and make any score-delta handling explicit.

## Evidence Standard

A verified rule means the cited primary text supports the specific proposition, not that the entire course or every national implementation is certified. Manufacturer documentation supports the documented equipment behavior, not all implementations. Communication, conflict classification, safety-culture choices, basic arithmetic and direct answer-count defects are explicitly identified as reviewer judgment, logic or structure in the JSON, rather than invented regulations. The table below uses broad evidence categories; the item reason controls.

Important scope decisions:

- Enclosed-space items 135/136 now name MSC.581(110); its numerical recommendations are not mislabeled as universal SOLAS minima. National atmospheric ranges may differ. Neither gas measurement alone authorizes entry. [IMO MSC.581(110), revised enclosed-space recommendations](https://wwwcdn.imo.org/localresources/en/KnowledgeCentre/IndexofIMOResolutions/MSCResolutions/MSC.581(110).pdf).
- The audit's older GMDSS source is not sufficient for an A3 carriage rekey. Item 193 remains deferred under the post-2024 framework. Items 186/189 repair missing qualifiers and are voided. [IMO MSC.496(105), modernized SOLAS IV](https://wwwcdn.imo.org/localresources/en/KnowledgeCentre/IndexofIMOResolutions/MSCResolutions/MSC.496(105).pdf); [IMO COMSAR.1/Circ.32/Rev.3, GMDSS harmonization](https://wwwcdn.imo.org/localresources/en/OurWork/Safety/Documents/IMO%20Documents%20related%20to/COMSAR.1-Circ.32-Rev.3.pdf).
- Pilot-transfer changes use the applicable SOLAS V/23 foundation. The 2025-adopted replacement regime is expected from 2028, not retrospectively treated as mandatory in November 2026. Height instructions depend on the pilot/port and transfer conditions. [IMO MSC.308(88), SOLAS V/23](https://wwwcdn.imo.org/localresources/en/KnowledgeCentre/IndexofIMOResolutions/MSCResolutions/MSC.308(88).pdf); [IMO pilotage overview, 2028 effective-date distinction](https://www.imo.org/en/ourwork/safety/pages/pilotage.aspx).
- Item 205 excludes polar/local exceptions from its future stem and supplies missing food-waste conditions. This is not blanket permission to discharge in every special area. [IMO MEPC.201(62), Annex V definitions and discharge conditions](https://wwwcdn.imo.org/localresources/en/KnowledgeCentre/IndexofIMOResolutions/MEPCDocuments/MEPC.201(62).pdf).
- Duplicate answers 242/324 and count/type defects 298/301/366 receive void treatment. Item 302's defect is confirmed but a safe forensic replacement remains unsupported, so it is deferred.
- Several audit source links failed or redirected. The plan uses accessible primary replacements where available: Furuno's Italian-hosted manual, current eCFR sections, Paris MoU's inspection/code pages, the Hong Kong Marine Department's 2026 COSWP copy and original IMO resolutions. No claim rests solely on an inaccessible audit URL.

## Complete Disposition Register

Letters refer to the original option order, preserved in the JSON. For void items the letters describe future content only, never a historic answer key. Detailed justification and exact replacement wording are in each JSON `reason`/`newOptions` entry.

| Audit | Question ID | Treatment | Future key | Evidence basis | Sources |
| --- | --- | --- | --- | --- | --- |
| 3 | wp_question_254 | rekey | D | Equipment / supplier evidence | [radar](https://www.furunousa.com/-/media/sites/furuno/document_library/documents/manuals/public_manuals/far3xxx_operators_manual.pdf) |
| 4 | wp_question_255 | deferred | - | Deferred | Local content / reviewer judgment |
| 5 | wp_question_256 | rekey | B | Equipment / supplier evidence | [radar](https://www.furunousa.com/-/media/sites/furuno/document_library/documents/manuals/public_manuals/far3xxx_operators_manual.pdf) |
| 16 | wp_question_267 | rekey | A | Verified rule / official guidance | [rule19](https://www.gov.uk/government/publications/mgn-369-mf-amendment-1-navigation-safety-navigation-practices-relevant-to-restricted-visibility/mgn-369-mf-amendment-1-navigation-safety-navigation-practices-relevant-to-restricted-visibility) |
| 17 | wp_question_268 | void | C | Judgment / logic / structure | [radar](https://www.furunousa.com/-/media/sites/furuno/document_library/documents/manuals/public_manuals/far3xxx_operators_manual.pdf) |
| 24 | wp_question_13 | rekey | A | Verified rule / official guidance | [lifeboatMAIB](https://assets.publishing.service.gov.uk/media/547c7130ed915d4c100000e3/european-highway.pdf) |
| 31 | wp_question_20 | rekey | D | Verified rule / official guidance | [lifeboat](https://www.legislation.gov.uk/uksi/2020/501/pdfs/uksiod_20200501_en.pdf) |
| 35 | wp_question_330 | void | A | Verified rule / official guidance | [bwm](https://www.imo.org/en/about/conventions/pages/international-convention-for-the-control-and-management-of-ships%27-ballast-water-and-sediments-%28bwm%29.aspx) |
| 37 | wp_question_332 | rekey | A | Verified rule / official guidance | [sediment](https://www.ecfr.gov/current/title-33/chapter-I/subchapter-O/part-151/subpart-D/section-151.2050) |
| 39 | wp_question_334 | rekey | A | Verified rule / official guidance | [bwcompare](https://www.news.uscg.mil/maritime-commons/Article/4345296/us-coast-guard-updates-ballast-water-faqs-key-insights-for-maritime-professiona/) |
| 41 | wp_question_336 | rekey | A | Verified rule / official guidance | [bwmbook](https://imocompendium.imo.org/public/IMO-Compendium/Current/DS/files/BWM.2-Circ.80.pdf) |
| 42 | wp_question_337 | rekey | A | Verified rule / official guidance | [bwmbook](https://imocompendium.imo.org/public/IMO-Compendium/Current/DS/files/BWM.2-Circ.80.pdf) |
| 51 | wp_question_137 | deferred | - | Deferred | Local content / reviewer judgment |
| 55 | wp_question_141 | deferred | - | Deferred | Local content / reviewer judgment |
| 59 | wp_question_145 | void | A | Judgment / logic / structure | Local content / reviewer judgment |
| 60 | wp_question_146 | rekey | B | Judgment / logic / structure | [feedback](https://www.otago.ac.nz/buildrespect/step-3-direct-feedback-fact-or-judgement.html) |
| 62 | wp_question_148 | void | B | Judgment / logic / structure | [feedback](https://www.otago.ac.nz/buildrespect/step-3-direct-feedback-fact-or-judgement.html) |
| 63 | wp_question_149 | rekey | C | Judgment / logic / structure | [feedback](https://www.otago.ac.nz/buildrespect/step-3-direct-feedback-fact-or-judgement.html) |
| 72 | wp_question_427 | void | A | Judgment / logic / structure | [feedback](https://www.otago.ac.nz/buildrespect/step-3-direct-feedback-fact-or-judgement.html) |
| 80 | wp_question_191 | rekey | A | Judgment / logic / structure | Local content / reviewer judgment |
| 84 | wp_question_198 | deferred | - | Deferred | Local content / reviewer judgment |
| 94 | wp_question_381 | rekey | B | Equipment / supplier evidence | [ecdism](https://www.furuno.it/docs/OPERATOR_MANUAL/FMD3200_3300_Ver5-xx-OME-B4.pdf) |
| 95 | wp_question_382 | void | D | Verified rule / official guidance | [mark](https://handbook.safetransport.vic.gov.au/boating-rules/buoyage-types/isolated-danger-marks/) |
| 97 | wp_question_384 | rekey | B | Equipment / supplier evidence | [ecdism](https://www.furuno.it/docs/OPERATOR_MANUAL/FMD3200_3300_Ver5-xx-OME-B4.pdf) |
| 101 | wp_question_388 | rekey | B | Equipment / supplier evidence | [ecdism](https://www.furuno.it/docs/OPERATOR_MANUAL/FMD3200_3300_Ver5-xx-OME-B4.pdf) |
| 102 | wp_question_389 | rekey | A | Judgment / logic / structure | Local content / reviewer judgment |
| 107 | wp_question_394 | deferred | - | Deferred | Local content / reviewer judgment |
| 111 | wp_question_398 | deferred | - | Deferred | Local content / reviewer judgment |
| 135 | question_343327d4 | void | D | Verified rule / official guidance | [enclosed](https://wwwcdn.imo.org/localresources/en/KnowledgeCentre/IndexofIMOResolutions/MSCResolutions/MSC.581(110).pdf) |
| 136 | question_e48b5923 | void | A | Verified rule / official guidance | [enclosed](https://wwwcdn.imo.org/localresources/en/KnowledgeCentre/IndexofIMOResolutions/MSCResolutions/MSC.581(110).pdf) |
| 150 | question_4f11d16b | rekey | A | Judgment / logic / structure | [enclosed](https://wwwcdn.imo.org/localresources/en/KnowledgeCentre/IndexofIMOResolutions/MSCResolutions/MSC.581(110).pdf) |
| 151 | question_8bff5612 | rekey | D | Verified rule / official guidance | [enclosed](https://wwwcdn.imo.org/localresources/en/KnowledgeCentre/IndexofIMOResolutions/MSCResolutions/MSC.581(110).pdf) |
| 153 | wp_question_49 | void | D | Judgment / logic / structure | Local content / reviewer judgment |
| 155 | wp_question_51 | void | C | Verified rule / official guidance | [hv](https://www.mardep.gov.hk/filemanager/en/share/aboutus/pdf/sab/sabp2_26anx2.pdf) |
| 168 | wp_question_451 | void | A | Verified rule / official guidance | [sampling](https://wwwcdn.imo.org/localresources/en/KnowledgeCentre/IndexofIMOResolutions/MEPCDocuments/MEPC.182(59).pdf) |
| 173 | wp_question_456 | rekey | D | Judgment / logic / structure | Local content / reviewer judgment |
| 186 | wp_question_459 | void | C | Verified rule / official guidance | [radiomodern](https://wwwcdn.imo.org/localresources/en/KnowledgeCentre/IndexofIMOResolutions/MSCResolutions/MSC.496(105).pdf) |
| 187 | wp_question_460 | rekey | C | Verified rule / official guidance | [radiomodern](https://wwwcdn.imo.org/localresources/en/KnowledgeCentre/IndexofIMOResolutions/MSCResolutions/MSC.496(105).pdf), [gmdss](https://www.gov.uk/government/publications/msn-1903-m-the-global-maritime-distress-and-safety-system-gmdss-ship-requirements/msn-1903-m-gmdss-ship-requirements) |
| 189 | wp_question_462 | void | C | Verified rule / official guidance | [gmdss](https://www.gov.uk/government/publications/msn-1903-m-the-global-maritime-distress-and-safety-system-gmdss-ship-requirements/msn-1903-m-gmdss-ship-requirements) |
| 193 | wp_question_466 | deferred | - | Deferred | Local content / reviewer judgment |
| 198 | wp_question_59 | rekey | B | Verified rule / official guidance | [annexV](https://wwwcdn.imo.org/localresources/en/KnowledgeCentre/IndexofIMOResolutions/MEPCDocuments/MEPC.201(62).pdf) |
| 205 | wp_question_66 | void | B | Verified rule / official guidance | [annexV](https://wwwcdn.imo.org/localresources/en/KnowledgeCentre/IndexofIMOResolutions/MEPCDocuments/MEPC.201(62).pdf), [garbage](https://www.imo.org/en/ourwork/environment/pages/garbage-default.aspx) |
| 232 | wp_question_99 | rekey | B | Verified rule / official guidance | [ism](https://wwwcdn.imo.org/localresources/en/KnowledgeCentre/IndexofIMOResolutions/AssemblyDocuments/A.741(18).pdf) |
| 234 | wp_question_101 | rekey | D | Verified rule / official guidance | [ism](https://wwwcdn.imo.org/localresources/en/KnowledgeCentre/IndexofIMOResolutions/AssemblyDocuments/A.741(18).pdf) |
| 236 | wp_question_103 | rekey | A | Verified rule / official guidance | [ism](https://wwwcdn.imo.org/localresources/en/KnowledgeCentre/IndexofIMOResolutions/AssemblyDocuments/A.741(18).pdf) |
| 240 | wp_question_107 | rekey | A | Verified rule / official guidance | [ismIntro](https://www.imo.org/en/ourwork/humanelement/pages/ismcode.aspx) |
| 241 | wp_question_108 | void | B | Verified rule / official guidance | [ism](https://wwwcdn.imo.org/localresources/en/KnowledgeCentre/IndexofIMOResolutions/AssemblyDocuments/A.741(18).pdf) |
| 242 | wp_question_109 | void | D | Judgment / logic / structure | Local content / reviewer judgment |
| 261 | wp_question_471 | rekey | C | Verified rule / official guidance | [hv](https://www.mardep.gov.hk/filemanager/en/share/aboutus/pdf/sab/sabp2_26anx2.pdf) |
| 271 | wp_question_481 | deferred | - | Deferred | Local content / reviewer judgment |
| 294 | question_8371a0c0 | void | A+D | Judgment / logic / structure | [hse](https://www.hse.gov.uk/foi/internalops/og/ogprocedures/investigation/coreobjectives.htm) |
| 298 | question_6246ffe6 | void | C+D | Verified rule / official guidance | [hse](https://www.hse.gov.uk/foi/internalops/og/ogprocedures/investigation/coreobjectives.htm) |
| 301 | question_d9fb891b | void | A+D | Judgment / logic / structure | [hse](https://www.hse.gov.uk/foi/internalops/og/ogprocedures/investigation/coreobjectives.htm) |
| 302 | question_df236e69 | deferred | - | Deferred | Local content / reviewer judgment |
| 311 | wp_question_522 | void | A+B+C+D | Judgment / logic / structure | [mentalstudy](https://pmc.ncbi.nlm.nih.gov/articles/PMC10966976/) |
| 313 | wp_question_524 | void | A+B+C+D | Health guidance | [mental](https://www.nimh.nih.gov/health/publications/post-traumatic-stress-disorder-ptsd) |
| 324 | wp_question_3164 | void | A | Judgment / logic / structure | [moor](https://prosertek.com/blog/most-common-mooring-methods/) |
| 340 | wp_question_178 | rekey | A | Verified rule / official guidance | [vrpreview](https://www.ecfr.gov/current/title-33/chapter-I/subchapter-O/part-155/subpart-D/section-155.1070) |
| 341 | wp_question_179 | rekey | C | Verified rule / official guidance | [vrpvalid](https://www.ecfr.gov/current/title-33/chapter-I/subchapter-O/part-155/subpart-D/section-155.1065) |
| 342 | wp_question_180 | deferred | - | Deferred | Local content / reviewer judgment |
| 345 | wp_question_183 | rekey | B | Verified rule / official guidance | [opaHull](https://www.dco.uscg.mil/Portals/9/DCO%20Documents/5p/5ps/NVIC/1992/n4-92.pdf) |
| 361 | wp_question_92 | rekey | A | Verified rule / official guidance | [lsa](https://wwwcdn.imo.org/localresources/en/KnowledgeCentre/IndexofIMOResolutions/MSCResolutions/MSC.48(66).pdf) |
| 365 | wp_question_96 | void | D | Verified rule / official guidance | [lifeboat](https://www.legislation.gov.uk/uksi/2020/501/pdfs/uksiod_20200501_en.pdf) |
| 366 | wp_question_97 | void | C+D | Verified rule / official guidance | [lifeboat](https://www.legislation.gov.uk/uksi/2020/501/pdfs/uksiod_20200501_en.pdf) |
| 368 | wp_question_311 | deferred | - | Deferred | Local content / reviewer judgment |
| 369 | wp_question_312 | rekey | D | Equipment / supplier evidence | [ecdism](https://www.furuno.it/docs/OPERATOR_MANUAL/FMD3200_3300_Ver5-xx-OME-B4.pdf) |
| 370 | wp_question_313 | void | A | Equipment / supplier evidence | [radar](https://www.furunousa.com/-/media/sites/furuno/document_library/documents/manuals/public_manuals/far3xxx_operators_manual.pdf) |
| 373 | wp_question_316 | rekey | C | Equipment / supplier evidence | [ecdism](https://www.furuno.it/docs/OPERATOR_MANUAL/FMD3200_3300_Ver5-xx-OME-B4.pdf) |
| 374 | wp_question_317 | void | A | Equipment / supplier evidence | [ecdism](https://www.furuno.it/docs/OPERATOR_MANUAL/FMD3200_3300_Ver5-xx-OME-B4.pdf) |
| 375 | wp_question_318 | rekey | B | Equipment / supplier evidence | [ecdism](https://www.furuno.it/docs/OPERATOR_MANUAL/FMD3200_3300_Ver5-xx-OME-B4.pdf) |
| 379 | wp_question_367 | void | A+D | Judgment / logic / structure | [controls](https://www.hse.gov.uk/ppe/managing-risk-using-ppe.htm) |
| 393 | wp_question_74 | void | A | Equipment / supplier evidence | [secumar](https://www.secumar.com/wp-content/uploads/2016/08/bedienungsanleitung4001_401.pdf) |
| 411 | wp_question_111 | void | A | Verified rule / official guidance | [pilotsolas](https://wwwcdn.imo.org/localresources/en/KnowledgeCentre/IndexofIMOResolutions/MSCResolutions/MSC.308(88).pdf), [pilotreg](https://www.gov.uk/government/publications/mgn-610-mf-amendment-1-solas-chapter-v-guidance-on-the-merchant-shipping-safety-of-navigation-regulations-2020/mgn-610-mf-amendment-1-navigation-solas-chapter-v-guidance-on-the-merchant-shipping-safety-of-navigation-regulations-2020) |
| 412 | wp_question_112 | void | D | Verified rule / official guidance | [pilotsolas](https://wwwcdn.imo.org/localresources/en/KnowledgeCentre/IndexofIMOResolutions/MSCResolutions/MSC.308(88).pdf), [pilotreg](https://www.gov.uk/government/publications/mgn-610-mf-amendment-1-solas-chapter-v-guidance-on-the-merchant-shipping-safety-of-navigation-regulations-2020/mgn-610-mf-amendment-1-navigation-solas-chapter-v-guidance-on-the-merchant-shipping-safety-of-navigation-regulations-2020), [pilotres](https://wwwcdn.imo.org/localresources/en/KnowledgeCentre/IndexofIMOResolutions/AssemblyDocuments/A.1045(27).pdf) |
| 414 | wp_question_114 | void | C | Verified rule / official guidance | [pilotheightUK](https://assets.publishing.service.gov.uk/government/uploads/system/uploads/attachment_data/file/1053007/20220103-ECP_MSMS_V7_Public_Final.pdf), [pilotheight](https://www.southernports.com.au/in-port/local-marine-notices/pilot-ladder-requirements) |
| 418 | wp_question_118 | void | C | Verified rule / official guidance | [pilotheightUK](https://assets.publishing.service.gov.uk/government/uploads/system/uploads/attachment_data/file/1053007/20220103-ECP_MSMS_V7_Public_Final.pdf), [pilotheight](https://www.southernports.com.au/in-port/local-marine-notices/pilot-ladder-requirements) |
| 417 | wp_question_117 | rekey | A | Verified rule / official guidance | [pilotsolas](https://wwwcdn.imo.org/localresources/en/KnowledgeCentre/IndexofIMOResolutions/MSCResolutions/MSC.308(88).pdf), [pilotreg](https://www.gov.uk/government/publications/mgn-610-mf-amendment-1-solas-chapter-v-guidance-on-the-merchant-shipping-safety-of-navigation-regulations-2020/mgn-610-mf-amendment-1-navigation-solas-chapter-v-guidance-on-the-merchant-shipping-safety-of-navigation-regulations-2020), [pilotres](https://wwwcdn.imo.org/localresources/en/KnowledgeCentre/IndexofIMOResolutions/AssemblyDocuments/A.1045(27).pdf) |
| 419 | wp_question_119 | void | D | Verified rule / official guidance | [pilotsolas](https://wwwcdn.imo.org/localresources/en/KnowledgeCentre/IndexofIMOResolutions/MSCResolutions/MSC.308(88).pdf), [pilotreg](https://www.gov.uk/government/publications/mgn-610-mf-amendment-1-solas-chapter-v-guidance-on-the-merchant-shipping-safety-of-navigation-regulations-2020/mgn-610-mf-amendment-1-navigation-solas-chapter-v-guidance-on-the-merchant-shipping-safety-of-navigation-regulations-2020), [pilotres](https://wwwcdn.imo.org/localresources/en/KnowledgeCentre/IndexofIMOResolutions/AssemblyDocuments/A.1045(27).pdf) |
| 422 | wp_question_122 | rekey | A | Verified rule / official guidance | [pscinitial](https://parismou.org/inspection-type/) |
| 427 | wp_question_127 | void | B | Verified rule / official guidance | [psccomplaint: IMO A.1206(34)](https://wwwcdn.imo.org/localresources/en/OurWork/IIIS/Documents/A%2034-Res.1206%20-%20PROCEDURES%20FOR%20PORT%20STATE%20CONTROL%2C%202025%20%28Secretariat%29.pdf); [Paris MoU PSCC59/2026/02](https://parismou.org/download/pscc59-2026-02-general-principles-to-be-applied-in-an-inspection/) |
| 442 | wp_question_209 | void | A+B+C+D+F | Verified rule / official guidance | [controls](https://www.hse.gov.uk/ppe/managing-risk-using-ppe.htm) |
| 463 | wp_question_168 | rekey | B | Verified rule / official guidance | [sopep](https://www.imo.org/en/ourwork/environment/pages/shipboard-marine-pollution-emergency-plans.aspx) |
| 464 | wp_question_169 | void | A | Judgment / logic / structure | Local content / reviewer judgment |
| 465 | wp_question_170 | rekey | A | Verified rule / official guidance | [ism](https://wwwcdn.imo.org/localresources/en/KnowledgeCentre/IndexofIMOResolutions/AssemblyDocuments/A.741(18).pdf) |
| 468 | wp_question_173 | rekey | A | Judgment / logic / structure | Local content / reviewer judgment |
| 469 | wp_question_174 | rekey | C | Judgment / logic / structure | Local content / reviewer judgment |
| 470 | wp_question_175 | rekey | A | Judgment / logic / structure | Local content / reviewer judgment |
| 481 | wp_question_300 | void | D | Equipment / supplier evidence | [becker](https://becker-marine-systems.com/products/manoeuvring-systems/becker-flap-rudder) |
| 485 | wp_question_546 | void | B | Verified rule / official guidance | [imdg](https://wwwcdn.imo.org/localresources/en/KnowledgeCentre/IndexofIMOResolutions/MSCResolutions/MSC.556(108).pdf) |
| 498 | wp_question_559 | void | A+B | Verified rule / official guidance | [reporting](https://wwwcdn.imo.org/localresources/en/KnowledgeCentre/IndexofIMOResolutions/AssemblyDocuments/A.851(20).pdf) |

## Deferred Findings

- **4 (wp_question_255)**: Equipment-dependent display cue: an own-ship vector can be hidden or zero length. The alarm key is wrong, but the proposed own-vector answer is not a reliable universal identifier. Obtain the course radar model and teach its true/relative mode indication before replacement.
- **51 (wp_question_137)**: Professional-judgment item, not a verified norm: focusing on past events can be necessary for fact-finding. 'Stick to the facts' is constructive, but the proposed replacement is not unambiguously wrong without defining backward-looking blame. Obtain the course framework or approve a rewritten scenario.
- **55 (wp_question_141)**: No universally specified conflict taxonomy is named. Technical, values, interests and personal conflict classifications vary. Do not rekey 'complicated' solely because it sounds less conventional; obtain the module's primary taxonomy.
- **84 (wp_question_198)**: Company-policy dependent: official app stores are not inherently forbidden, but installations may require authorization on managed devices. No fleet policy is supplied. Defer rather than assume unrestricted App Store use.
- **107 (wp_question_394)**: The stem asks why a plan 'might' be incomplete: time pressure, missing data and limited local knowledge are all possible. The audit's preferred explanation is plausible, not a uniquely verified answer. Needs a course-specific or scenario-based replacement.
- **111 (wp_question_398)**: Unsupported generalization about pilots: unfamiliarity and pilotage-authority procedures can both explain non-use. Do not replace one unverified universal explanation with another; require local procedure or explicit scenario.
- **193 (wp_question_466)**: Outdated regulatory framing: post-2024 SOLAS IV uses recognized mobile satellite services; the old Inmarsat-or-HF choice cannot be safely rekeyed to A3. Require a complete modernized question scoped to the applicable carriage rules and flag implementation. Sources: https://wwwcdn.imo.org/localresources/en/KnowledgeCentre/IndexofIMOResolutions/MSCResolutions/MSC.496(105).pdf ; https://wwwcdn.imo.org/localresources/en/OurWork/Safety/Documents/IMO%20Documents%20related%20to/COMSAR.1-Circ.32-Rev.3.pdf
- **271 (wp_question_481)**: The general holding-brake explanation is plausible, but 'hauling' is unclear and slewing-brake behavior can depend on crane design. No crane manual or model is supplied. Do not make a universal power-off safety claim from the audit alone.
- **302 (question_df236e69)**: Confirmed selection-count defect (asks THREE, keys TWO), but handwriting, pen changes or author identity do not establish when an entry was amended. Do not invent a third forensic indicator or teach these clues as proof; obtain the source investigation exercise and corroborating records.
- **342 (wp_question_180)**: Confirmed conflation of financial-responsibility and response-plan thresholds, but none of the options captures tank/nontank applicability, tonnage convention, operating waters and exemptions. No inferred 300/400 GT rekey. Requires a scoped regulatory replacement, checked against current 33 CFR 155 subparts D/J.
- **368 (wp_question_311)**: The audit conflates a predictive vector/turn predictor with the separate look-ahead anti-grounding check area. Both grounding awareness and close-quarters turning may be plausible. Obtain the ECDIS model and course definition; do not rekey to the 'closest' answer.

Deferral does not endorse the existing key. It means this review cannot supply a sufficiently supported automated replacement. In particular, confirmed but deferred defects should be resolved with the source module or an independently approved replacement before future use; no additional files or course settings were changed here.

## Validation

The local validation checks JSON shape, exact 90-candidate coverage, unique question IDs/audit numbers, original course mapping, exact old snapshots, original option order/IDs, one correct choice for single-choice items, explicit two/three-selection counts, nonempty reasons, source URL syntax, English future content, and strictly flag-only changes for rekeys. Validation does not simulate production attempts or assert certificate eligibility.

Only `scripts/assessment-corrections-2026-11-06.json` and this review file are authored by this task. No production access, data mutation, commit or push was performed. The separate regrade and certificate implementation was not edited or executed.
