import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { pbkdf2Sync, randomBytes } from "node:crypto";

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const copyFiles = args.has("--copy-files");
const includeDrafts = args.has("--include-drafts");
const importAttempts = !args.has("--skip-attempts");

const dbPath = resolve("data/db.json");
const outputDir = resolve("imports/wordpress/output");
const sqlPath = process.env.WP_SQL_PATH || join(process.env.USERPROFILE ?? "", "Downloads", "maritimelearning.sql");
const siteRoot = process.env.WP_SITE_ROOT || join(process.env.USERPROFILE ?? "", "Downloads", "maritimelearning.store");
const uploadsRoot = process.env.WP_UPLOADS_ROOT || join(siteRoot, "wp-content", "uploads");
const extraVideoRoot = process.env.WP_VIDEO_ROOT || join(process.env.USERPROFILE ?? "", "Downloads", "video");
const importedUploadsDir = resolve("data/uploads/imported-wordpress");
const wordpressUploadUrl = "http://maritimelearning.store/wp-content/uploads/";
const wordpressUploadHttpsUrl = "https://maritimelearning.store/wp-content/uploads/";
const defaultCertificateTemplateHtml = `<span class="eyebrow">Marine LMS Certificate</span>
<h1>Certificate of Completion</h1>
<p class="muted">This certifies that</p>
<div class="certificate-name">{{firstName}} {{lastName}}</div>
{{photoImage}}
<p class="muted">{{position}}</p>
<p>Date of birth: {{birthDate}}</p>
<p>successfully completed</p>
<h2>{{courseTitle}}</h2>
<p>Issued: {{issuedAt}} · Valid until: {{expiresAt}}</p>
<p>Certificate number: {{certificateNumber}}</p>
{{qrCode}}`;

function now() {
  return new Date().toISOString();
}

function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const hash = pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex");
  return `${salt}:${hash}`;
}

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function writeJson(path, value) {
  ensureDir(dirname(path));
  writeFileSync(path, JSON.stringify(value, null, 2), "utf8");
}

function decodeSqlString(value) {
  if (value === null) return "";
  return String(value)
    .replace(/\\0/g, "\0")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\b/g, "\b")
    .replace(/\\Z/g, "\x1a")
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, "\\");
}

function stripHtml(value) {
  return String(value ?? "")
    .replace(/\[(\/)?(video|audio)[^\]]*\]/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#039;/gi, "'")
    .replace(/&rsquo;/gi, "'")
    .replace(/&lsquo;/gi, "'")
    .replace(/&rdquo;/gi, '"')
    .replace(/&ldquo;/gi, '"')
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function normalizeDate(value) {
  const raw = String(value ?? "").trim();
  if (!raw || raw === "0000-00-00 00:00:00") return "";
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  const dotted = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (dotted) return `${dotted[3]}-${dotted[2].padStart(2, "0")}-${dotted[1].padStart(2, "0")}`;
  return "";
}

function datetimeToIso(value) {
  const raw = String(value ?? "").trim();
  if (!raw || raw === "0000-00-00 00:00:00") return now();
  const parsed = new Date(raw.replace(" ", "T") + "Z");
  return Number.isNaN(parsed.getTime()) ? now() : parsed.toISOString();
}

function parseRows(values) {
  const rows = [];
  let inString = false;
  let escaped = false;
  let depth = 0;
  let start = -1;

  for (let index = 0; index < values.length; index += 1) {
    const char = values[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "'") inString = false;
      continue;
    }

    if (char === "'") inString = true;
    else if (char === "(") {
      if (depth === 0) start = index + 1;
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0 && start >= 0) rows.push(values.slice(start, index));
    }
  }
  return rows;
}

function parseRow(row) {
  const fields = [];
  let inString = false;
  let escaped = false;
  let current = "";

  for (let index = 0; index <= row.length; index += 1) {
    const char = row[index];
    if (index === row.length || (!inString && char === ",")) {
      const raw = current.trim();
      if (raw === "NULL") fields.push(null);
      else if (raw.startsWith("'") && raw.endsWith("'")) fields.push(decodeSqlString(raw.slice(1, -1)));
      else fields.push(raw);
      current = "";
      continue;
    }

    current += char;
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "'") inString = false;
    } else if (char === "'") {
      inString = true;
    }
  }
  return fields;
}

function extractInsertValueBlocks(sql, table) {
  const blocks = [];
  const pattern = new RegExp(`INSERT INTO \`${table}\` VALUES\\s*`, "g");
  while (pattern.exec(sql)) {
    let index = pattern.lastIndex;
    const start = index;
    let inString = false;
    let escaped = false;
    let depth = 0;
    for (; index < sql.length; index += 1) {
      const char = sql[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === "'") inString = false;
      } else if (char === "'") {
        inString = true;
      } else if (char === "(") {
        depth += 1;
      } else if (char === ")") {
        depth -= 1;
      } else if (char === ";" && depth === 0) {
        break;
      }
    }
    blocks.push(sql.slice(start, index));
    pattern.lastIndex = index + 1;
  }
  return blocks;
}

function tableRows(sql, table, columns) {
  const rows = [];
  for (const block of extractInsertValueBlocks(sql, table)) {
    for (const rawRow of parseRows(block)) {
      const values = parseRow(rawRow);
      rows.push(Object.fromEntries(columns.map((column, index) => [column, values[index]])));
    }
  }
  return rows;
}

function createMetaMap(rows, idColumn, keyColumn, valueColumn) {
  const map = new Map();
  for (const row of rows) {
    const id = Number(row[idColumn]);
    if (!map.has(id)) map.set(id, new Map());
    const meta = map.get(id);
    const key = row[keyColumn];
    if (!meta.has(key)) meta.set(key, []);
    meta.get(key).push(row[valueColumn] ?? "");
  }
  return map;
}

function metaValue(metaMap, id, key) {
  return metaMap.get(Number(id))?.get(key)?.[0] ?? "";
}

function serializedNumber(value, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const raw = String(value ?? "");
  const stringMatch = raw.match(new RegExp(`s:\\d+:\\"${escaped}\\";s:\\d+:\\"([^\\"]*)\\";`));
  if (stringMatch) return Number(stringMatch[1]) || 0;
  const intMatch = raw.match(new RegExp(`s:\\d+:\\"${escaped}\\";i:(\\d+);`));
  if (intMatch) return Number(intMatch[1]) || 0;
  return 0;
}

function userRoles(capabilities) {
  return [...String(capabilities ?? "").matchAll(/s:\d+:\\"([^\\"]+)\\";b:1/g)].map((match) => match[1]);
}

function extractUrls(text) {
  const value = String(text ?? "");
  const urls = new Set();
  for (const match of value.matchAll(/(?:mp4|mov|webm|m4v|mp3|wav|src|href)=["']([^"']+)["']/gi)) {
    urls.add(match[1]);
  }
  for (const match of value.matchAll(/https?:\/\/[^\s"'<>\\\]]+/gi)) {
    urls.add(match[0]);
  }
  return [...urls].map((url) => url.replace(/&amp;/g, "&"));
}

function urlToUploadRelative(url) {
  const decoded = decodeURIComponent(String(url).replace(/\+/g, "%20"));
  if (decoded.startsWith(wordpressUploadUrl)) return decoded.slice(wordpressUploadUrl.length);
  if (decoded.startsWith(wordpressUploadHttpsUrl)) return decoded.slice(wordpressUploadHttpsUrl.length);
  const marker = "/wp-content/uploads/";
  const index = decoded.indexOf(marker);
  return index >= 0 ? decoded.slice(index + marker.length) : "";
}

function cleanTargetName(relative) {
  return String(relative)
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.replace(/[^a-zA-Z0-9._ -]/g, "_").trim() || "_")
    .join("/");
}

function materialTypeForPath(pathOrUrl, fallback = "text") {
  const extension = extname(String(pathOrUrl).split("?")[0]).toLowerCase();
  if ([".mp4", ".mov", ".m4v", ".webm", ".avi", ".mkv"].includes(extension)) return "video";
  if ([".mp3", ".wav", ".m4a"].includes(extension)) return "video";
  if (extension === ".pdf") return "pdf";
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp"].includes(extension)) return "image";
  return fallback;
}

function findLocalFileForUrl(url, attachmentByRelative) {
  const relative = urlToUploadRelative(url);
  if (!relative) return null;
  const normalizedRelative = relative.replace(/\\/g, "/");
  const candidates = [
    join(uploadsRoot, normalizedRelative),
    join(extraVideoRoot, basename(normalizedRelative)),
    join(extraVideoRoot, basename(normalizedRelative).replace(/%20/g, " "))
  ];

  const attachment = attachmentByRelative.get(normalizedRelative.toLowerCase());
  if (attachment?.sourcePath) candidates.unshift(attachment.sourcePath);

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function targetUploadForSource(sourcePath) {
  const uploadsPrefix = uploadsRoot.toLowerCase();
  const normalizedSource = sourcePath.toLowerCase();
  const base = normalizedSource.startsWith(uploadsPrefix)
    ? relative(uploadsRoot, sourcePath).replace(/\\/g, "/")
    : basename(sourcePath);
  const safeBase = cleanTargetName(base).replace(/ /g, "_");
  return {
    absolute: join(importedUploadsDir, safeBase),
    publicUrl: `/uploads/imported-wordpress/${safeBase}`
  };
}

function trackFile(fileMap, sourcePath, reason, fallbackUrl = "") {
  if (!sourcePath) return "";
  const target = targetUploadForSource(sourcePath);
  const key = sourcePath.toLowerCase();
  let entry;
  if (!fileMap.has(key)) {
    let size = 0;
    let exists = false;
    try {
      const stats = statSync(sourcePath);
      size = stats.size;
      exists = stats.isFile();
    } catch {
      exists = false;
    }
    entry = {
      sourcePath,
      targetPath: target.absolute,
      publicUrl: target.publicUrl,
      size,
      exists,
      reasons: [reason]
    };
    fileMap.set(key, entry);
  } else {
    entry = fileMap.get(key);
    entry.reasons.push(reason);
  }
  return copyFiles && entry.exists && entry.size > 0 ? target.publicUrl : fallbackUrl || target.publicUrl;
}

function importUrlAsMaterial(fileMap, attachmentByRelative, url, title, reason) {
  const sourcePath = findLocalFileForUrl(url, attachmentByRelative);
  if (sourcePath) {
    return {
      type: materialTypeForPath(sourcePath, materialTypeForPath(url, "pdf")),
      content: trackFile(fileMap, sourcePath, reason, url),
      sourcePath
    };
  }
  return {
    type: materialTypeForPath(url, "video"),
    content: url,
    sourcePath: ""
  };
}

function courseImageFromThumbnail(fileMap, postsById, attachmentByRelative, postMetaById, wpCourseId) {
  const thumbnailId = Number(metaValue(postMetaById, wpCourseId, "_thumbnail_id")) || 0;
  if (!thumbnailId) return { imageUrl: "", thumbnailId: 0 };

  const attachment = postsById.get(thumbnailId);
  const relativePath = attachment ? metaValue(postMetaById, attachment.ID, "_wp_attached_file") : "";
  const relativeSourcePath = relativePath ? join(uploadsRoot, relativePath) : "";
  const sourcePath =
    relativeSourcePath && existsSync(relativeSourcePath)
      ? relativeSourcePath
      : findLocalFileForUrl(attachment?.guid ?? "", attachmentByRelative);
  if (sourcePath && existsSync(sourcePath)) {
    return {
      imageUrl: trackFile(fileMap, sourcePath, `course cover ${wpCourseId}`, attachment?.guid ?? ""),
      thumbnailId
    };
  }

  return {
    imageUrl: attachment?.guid ?? "",
    thumbnailId
  };
}

function parseTutorQuizOptions(value) {
  return {
    attemptsLimit: Math.max(1, serializedNumber(value, "attempts_allowed") || 3),
    passingPercent: Math.max(1, serializedNumber(value, "passing_grade") || 80),
    timeLimitMinutes: serializedNumber(value, "time_value") || 0,
    showResultToUser: true,
    allowRetake: true
  };
}

function computeScorePercent(attempt) {
  const total = Number(attempt.total_marks) || Number(attempt.total_questions) || 0;
  const earned = Number(attempt.earned_marks) || 0;
  if (total <= 0) return 0;
  return Math.round((earned / total) * 100);
}

function answersForAttempt(attemptAnswerRows, questionIdToImportedId, answerIdToImportedId) {
  return attemptAnswerRows.map((row) => {
    const rawGiven = String(row.given_answer ?? "");
    const answerIds = [
      ...rawGiven.matchAll(/s:\d+:"(\d+)"/g),
      ...rawGiven.matchAll(/i:(\d+);/g)
    ]
      .map((match) => Number(match[1]))
      .filter((answerId) => answerIdToImportedId.has(answerId));
    const selectedOptionIds = [...new Set(answerIds)].map((answerId) => answerIdToImportedId.get(answerId));
    return {
      questionId: questionIdToImportedId.get(Number(row.question_id)) ?? `wp_question_${row.question_id}`,
      selectedOptionId: selectedOptionIds[0] ?? "",
      selectedOptionIds,
      isCorrect: Number(row.is_correct) === 1
    };
  });
}

function loadSource() {
  const sql = readFileSync(sqlPath, "utf8");
  const posts = tableRows(sql, "wp_posts", [
    "ID",
    "post_author",
    "post_date",
    "post_date_gmt",
    "post_content",
    "post_title",
    "post_excerpt",
    "post_status",
    "comment_status",
    "ping_status",
    "post_password",
    "post_name",
    "to_ping",
    "pinged",
    "post_modified",
    "post_modified_gmt",
    "post_content_filtered",
    "post_parent",
    "guid",
    "menu_order",
    "post_type",
    "post_mime_type",
    "comment_count"
  ]);
  const postMeta = tableRows(sql, "wp_postmeta", ["meta_id", "post_id", "meta_key", "meta_value"]);
  const users = tableRows(sql, "wp_users", [
    "ID",
    "user_login",
    "user_pass",
    "user_nicename",
    "user_email",
    "user_url",
    "user_registered",
    "user_activation_key",
    "user_status",
    "display_name"
  ]);
  const userMeta = tableRows(sql, "wp_usermeta", ["umeta_id", "user_id", "meta_key", "meta_value"]);
  const questions = tableRows(sql, "wp_tutor_quiz_questions", [
    "question_id",
    "quiz_id",
    "question_title",
    "question_description",
    "answer_explanation",
    "question_type",
    "question_mark",
    "question_settings",
    "question_order"
  ]);
  const questionAnswers = tableRows(sql, "wp_tutor_quiz_question_answers", [
    "answer_id",
    "belongs_question_id",
    "belongs_question_type",
    "answer_title",
    "is_correct",
    "image_id",
    "answer_two_gap_match",
    "answer_view_format",
    "answer_settings",
    "answer_order"
  ]);
  const quizAttempts = tableRows(sql, "wp_tutor_quiz_attempts", [
    "attempt_id",
    "course_id",
    "quiz_id",
    "user_id",
    "total_questions",
    "total_answered_questions",
    "total_marks",
    "earned_marks",
    "attempt_info",
    "attempt_status",
    "attempt_ip",
    "attempt_started_at",
    "attempt_ended_at",
    "is_manually_reviewed",
    "manually_reviewed_at"
  ]);
  const attemptAnswers = tableRows(sql, "wp_tutor_quiz_attempt_answers", [
    "attempt_answer_id",
    "user_id",
    "quiz_id",
    "question_id",
    "quiz_attempt_id",
    "given_answer",
    "question_mark",
    "achieved_mark",
    "minus_mark",
    "is_correct"
  ]);

  return {
    posts,
    postMeta,
    users,
    userMeta,
    questions,
    questionAnswers,
    quizAttempts,
    attemptAnswers,
    postMetaById: createMetaMap(postMeta, "post_id", "meta_key", "meta_value"),
    userMetaById: createMetaMap(userMeta, "user_id", "meta_key", "meta_value")
  };
}

function buildImport(source) {
  const fileMap = new Map();
  const postsById = new Map(source.posts.map((post) => [Number(post.ID), post]));
  const childrenByParent = new Map();
  for (const post of source.posts) {
    const parent = Number(post.post_parent) || 0;
    if (!childrenByParent.has(parent)) childrenByParent.set(parent, []);
    childrenByParent.get(parent).push(post);
  }
  for (const children of childrenByParent.values()) {
    children.sort((a, b) => Number(a.menu_order) - Number(b.menu_order) || Number(a.ID) - Number(b.ID));
  }

  const attachmentByRelative = new Map();
  for (const attachment of source.posts.filter((post) => post.post_type === "attachment")) {
    const relative = metaValue(source.postMetaById, attachment.ID, "_wp_attached_file");
    const sourcePath = relative ? join(uploadsRoot, relative) : "";
    if (relative) {
      attachmentByRelative.set(relative.toLowerCase().replace(/\\/g, "/"), {
        post: attachment,
        relative,
        sourcePath
      });
    }
  }

  const passwordRows = [];
  const importedUsers = [];
  const sourceUserIdToImportedId = new Map();
  const skippedUsers = [];

  for (const wpUser of source.users) {
    const wpUserId = Number(wpUser.ID);
    const roles = userRoles(metaValue(source.userMetaById, wpUserId, "wp_capabilities"));
    const isAdmin = roles.includes("administrator") || roles.includes("tutor_instructor");
    const isStudent =
      roles.includes("subscriber") ||
      metaValue(source.userMetaById, wpUserId, "_is_tutor_student") ||
      source.posts.some((post) => post.post_type === "tutor_enrolled" && Number(post.post_author) === wpUserId);

    if (!isStudent || isAdmin) {
      skippedUsers.push({ wpUserId, email: wpUser.user_email, roles, reason: isAdmin ? "admin/instructor" : "not student" });
      continue;
    }

    const displayParts = String(wpUser.display_name ?? "").trim().split(/\s+/).filter(Boolean);
    const tempPassword = `Temp-${wpUserId}-${randomBytes(3).toString("hex")}`;
    const photoMeta = metaValue(source.userMetaById, wpUserId, "_tutor_profile_photo");
    let photoUrl = "";
    if (photoMeta) {
      const photoPost = postsById.get(Number(photoMeta));
      const relative = photoPost ? metaValue(source.postMetaById, photoPost.ID, "_wp_attached_file") : "";
      const sourcePath = relative ? join(uploadsRoot, relative) : findLocalFileForUrl(photoMeta, attachmentByRelative);
      if (sourcePath) photoUrl = trackFile(fileMap, sourcePath, `student photo ${wpUserId}`, photoPost?.guid ?? "");
    }

    const importedId = `wp_user_${wpUserId}`;
    sourceUserIdToImportedId.set(wpUserId, importedId);
    importedUsers.push({
      id: importedId,
      role: "student",
      email: String(wpUser.user_email || `wp-user-${wpUserId}@example.local`).toLowerCase(),
      passwordHash: hashPassword(tempPassword),
      firstNameEn: metaValue(source.userMetaById, wpUserId, "first_name") || displayParts[0] || wpUser.user_login || "Student",
      lastNameEn: metaValue(source.userMetaById, wpUserId, "last_name") || displayParts.slice(1).join(" ") || "Imported",
      birthDate: normalizeDate(metaValue(source.userMetaById, wpUserId, "birthday")),
      company: metaValue(source.userMetaById, wpUserId, "companyname") || metaValue(source.userMetaById, wpUserId, "billing_company"),
      position: metaValue(source.userMetaById, wpUserId, "_tutor_profile_job_title") || "Student",
      phone: metaValue(source.userMetaById, wpUserId, "phone_number") || metaValue(source.userMetaById, wpUserId, "billing_phone"),
      photoUrl,
      status: "active",
      createdAt: datetimeToIso(wpUser.user_registered),
      source: { system: "wordpress_tutor", wpUserId, roles }
    });
    passwordRows.push({
      wpUserId,
      email: String(wpUser.user_email || "").toLowerCase(),
      firstName: metaValue(source.userMetaById, wpUserId, "first_name"),
      lastName: metaValue(source.userMetaById, wpUserId, "last_name"),
      tempPassword
    });
  }

  const answersByQuestion = new Map();
  for (const answer of source.questionAnswers) {
    const questionId = Number(answer.belongs_question_id);
    if (!answersByQuestion.has(questionId)) answersByQuestion.set(questionId, []);
    answersByQuestion.get(questionId).push(answer);
  }
  for (const answers of answersByQuestion.values()) {
    answers.sort((a, b) => Number(a.answer_order) - Number(b.answer_order) || Number(a.answer_id) - Number(b.answer_id));
  }

  const questionsByQuiz = new Map();
  for (const question of source.questions) {
    const quizId = Number(question.quiz_id);
    if (!questionsByQuiz.has(quizId)) questionsByQuiz.set(quizId, []);
    questionsByQuiz.get(quizId).push(question);
  }
  for (const questions of questionsByQuiz.values()) {
    questions.sort((a, b) => Number(a.question_order) - Number(b.question_order) || Number(a.question_id) - Number(b.question_id));
  }

  const questionIdToImportedId = new Map();
  const answerIdToImportedId = new Map();

  const importedCourses = [];
  const sourceCourseIdToImportedId = new Map();
  const sourceQuizIdToCourseId = new Map();
  const mediaReferences = [];
  const missingMedia = [];
  const skippedCourses = [];
  const skippedQuestions = [];

  const courseStatuses = includeDrafts ? new Set(["publish", "pending", "draft"]) : new Set(["publish"]);
  const sourceCourses = source.posts
    .filter((post) => post.post_type === "courses")
    .sort((a, b) => Number(a.ID) - Number(b.ID));

  for (const wpCourse of sourceCourses) {
    const wpCourseId = Number(wpCourse.ID);
    if (!courseStatuses.has(wpCourse.post_status)) {
      skippedCourses.push({ wpCourseId, title: wpCourse.post_title, status: wpCourse.post_status });
      continue;
    }

    const courseId = `wp_course_${wpCourseId}`;
    sourceCourseIdToImportedId.set(wpCourseId, courseId);
    const courseChildren = childrenByParent.get(wpCourseId) ?? [];
    const topics = courseChildren.filter((post) => post.post_type === "topics" && post.post_status === "publish");
    const lessons = [];
    const quizPosts = [];

    for (const topic of topics) {
      const topicChildren = childrenByParent.get(Number(topic.ID)) ?? [];
      for (const child of topicChildren) {
        if (child.post_type === "lesson" && child.post_status === "publish") lessons.push(child);
        if (child.post_type === "tutor_quiz" && child.post_status === "publish") quizPosts.push(child);
      }
    }

    if (lessons.length === 0) {
      const directLessons = courseChildren.filter((post) => post.post_type === "lesson" && post.post_status === "publish");
      lessons.push(...directLessons);
    }

    const importedLessons = lessons.map((lesson, lessonIndex) => {
      const materials = [];
      const text = stripHtml(lesson.post_content);
      if (text) {
        materials.push({
          id: `wp_material_text_${lesson.ID}`,
          type: "text",
          title: lesson.post_title || `Lesson ${lessonIndex + 1}`,
          content: text,
          isRequired: true,
          sortOrder: materials.length + 1,
          source: { wpPostId: Number(lesson.ID), kind: "lesson_text" }
        });
      }

      for (const [urlIndex, url] of extractUrls(lesson.post_content).entries()) {
        const imported = importUrlAsMaterial(
          fileMap,
          attachmentByRelative,
          url,
          lesson.post_title,
          `lesson ${lesson.ID} media`
        );
        if (imported.sourcePath) {
          mediaReferences.push({ wpPostId: Number(lesson.ID), url, sourcePath: imported.sourcePath, publicUrl: imported.content });
        } else if (urlToUploadRelative(url)) {
          missingMedia.push({ wpPostId: Number(lesson.ID), url, expectedRelative: urlToUploadRelative(url) });
        }
        materials.push({
          id: `wp_material_media_${lesson.ID}_${urlIndex + 1}`,
          type: imported.type,
          title: `${lesson.post_title || "Media"} ${urlIndex + 1}`,
          content: imported.content,
          isRequired: true,
          sortOrder: materials.length + 1,
          source: { wpPostId: Number(lesson.ID), url }
        });
      }

      const lessonAttachments = (childrenByParent.get(Number(lesson.ID)) ?? []).filter((post) => post.post_type === "attachment");
      for (const attachment of lessonAttachments) {
        const relative = metaValue(source.postMetaById, attachment.ID, "_wp_attached_file");
        const sourcePath = relative ? join(uploadsRoot, relative) : "";
        const publicUrl = sourcePath ? trackFile(fileMap, sourcePath, `lesson ${lesson.ID} attachment`, attachment.guid) : attachment.guid;
        materials.push({
          id: `wp_material_attachment_${attachment.ID}`,
          type: materialTypeForPath(relative || attachment.guid, "pdf"),
          title: attachment.post_title || basename(relative || attachment.guid),
          content: publicUrl,
          isRequired: true,
          sortOrder: materials.length + 1,
          source: { wpPostId: Number(lesson.ID), wpAttachmentId: Number(attachment.ID), relative }
        });
      }

      if (materials.length === 0) {
        materials.push({
          id: `wp_material_empty_${lesson.ID}`,
          type: "text",
          title: lesson.post_title || `Lesson ${lessonIndex + 1}`,
          content: "Imported lesson. Original lesson content did not contain text or attached media.",
          isRequired: true,
          sortOrder: 1,
          source: { wpPostId: Number(lesson.ID), kind: "empty_placeholder" }
        });
      }

      return {
        id: `wp_lesson_${lesson.ID}`,
        title: lesson.post_title || `Lesson ${lessonIndex + 1}`,
        description: stripHtml(lesson.post_excerpt) || "",
        sortOrder: lessonIndex + 1,
        isRequired: true,
        status: "active",
        materials
      };
    });

    const importedQuestions = [];
    const courseImage = courseImageFromThumbnail(fileMap, postsById, attachmentByRelative, source.postMetaById, wpCourseId);
    let testSettings = {
      attemptsLimit: 3,
      passingPercent: 80,
      timeLimitMinutes: 0,
      showResultToUser: true,
      allowRetake: true
    };
    const testTitle = quizPosts[0]?.post_title || `Final test: ${wpCourse.post_title}`;

    for (const [quizIndex, quiz] of quizPosts.entries()) {
      sourceQuizIdToCourseId.set(Number(quiz.ID), courseId);
      if (quizIndex === 0) {
        testSettings = parseTutorQuizOptions(metaValue(source.postMetaById, quiz.ID, "tutor_quiz_option"));
      }
      const quizQuestions = questionsByQuiz.get(Number(quiz.ID)) ?? [];
      for (const question of quizQuestions) {
        const importedQuestionId = `wp_question_${question.question_id}`;
        questionIdToImportedId.set(Number(question.question_id), importedQuestionId);
        const allQuestionAnswers = answersByQuestion.get(Number(question.question_id)) ?? [];
        const typeMatchedAnswers = allQuestionAnswers.filter((answer) => answer.belongs_question_type === question.question_type);
        const sourceAnswers = typeMatchedAnswers.length > 0 ? typeMatchedAnswers : allQuestionAnswers;
        const options = sourceAnswers.slice(0, 6).map((answer, index) => {
          const optionId = `wp_option_${answer.answer_id}`;
          answerIdToImportedId.set(Number(answer.answer_id), optionId);
          return {
            id: optionId,
            optionText: answer.answer_title || answer.answer_two_gap_match || `Option ${index + 1}`,
            isCorrect: Number(answer.is_correct) === 1,
            sortOrder: index + 1
          };
        });
        const importedQuestionType = question.question_type === "multiple_choice" ? "multiple_choice" : "single_choice";
        const correctOptions = options.filter((option) => option.isCorrect).length;
        const isValidQuestion =
          options.length >= 2 && (importedQuestionType === "multiple_choice" ? correctOptions >= 1 : correctOptions === 1);
        if (isValidQuestion) {
          importedQuestions.push({
            id: importedQuestionId,
            type: importedQuestionType,
            questionText: question.question_title || `Question ${question.question_id}`,
            sortOrder: importedQuestions.length + 1,
            options,
            source: {
              wpQuizId: Number(quiz.ID),
              wpQuestionId: Number(question.question_id),
              questionType: question.question_type
            }
          });
        } else {
          skippedQuestions.push({
            wpQuizId: Number(quiz.ID),
            wpQuestionId: Number(question.question_id),
            questionType: question.question_type,
            title: question.question_title,
            sourceAnswers: sourceAnswers.length,
            importedOptions: options.length,
            correctOptions,
            reason: options.length < 2 ? "less than 2 options" : "expected exactly one correct answer"
          });
        }
      }
    }

    importedCourses.push({
      id: courseId,
      title: wpCourse.post_title || `Course ${wpCourseId}`,
      shortDescription: stripHtml(wpCourse.post_excerpt) || stripHtml(metaValue(source.postMetaById, wpCourseId, "_tutor_course_benefits")).slice(0, 240),
      fullDescription: stripHtml(wpCourse.post_content),
      goals: stripHtml(metaValue(source.postMetaById, wpCourseId, "_tutor_course_benefits")),
      requirements: "Complete all required materials and pass the final test.",
      status: wpCourse.post_status === "publish" ? "active" : "inactive",
      isSequential: true,
      imageUrl: courseImage.imageUrl,
      showOnHome: false,
      homeSortOrder: 999,
      certificateTemplateHtml: defaultCertificateTemplateHtml,
      lessons: importedLessons,
      test: {
        id: `wp_test_${wpCourseId}`,
        title: testTitle,
        description: "",
        ...testSettings,
        status: importedQuestions.length > 0 ? "active" : "inactive",
        questions: importedQuestions
      },
      createdAt: datetimeToIso(wpCourse.post_date),
      source: {
        system: "wordpress_tutor",
        wpCourseId,
        wpStatus: wpCourse.post_status,
        wpSlug: wpCourse.post_name,
        wpThumbnailId: courseImage.thumbnailId,
        wpQuizIds: quizPosts.map((quiz) => Number(quiz.ID))
      }
    });
  }

  const importedAssignments = [];
  const assignmentByUserCourse = new Map();
  for (const enrollment of source.posts.filter((post) => post.post_type === "tutor_enrolled")) {
    const wpUserId = Number(enrollment.post_author);
    const wpCourseId = Number(enrollment.post_parent);
    const userId = sourceUserIdToImportedId.get(wpUserId);
    const courseId = sourceCourseIdToImportedId.get(wpCourseId);
    if (!userId || !courseId) continue;
    const key = `${userId}:${courseId}`;
    if (assignmentByUserCourse.has(key)) continue;
    const course = importedCourses.find((item) => item.id === courseId);
    const materialProgress = {};
    for (const lesson of course?.lessons ?? []) {
      for (const material of lesson.materials ?? []) {
        if (enrollment.post_status === "completed") {
          materialProgress[material.id] = {
            status: "completed",
            viewPercent: 100,
            openedAt: datetimeToIso(enrollment.post_date),
            completedAt: datetimeToIso(enrollment.post_modified)
          };
        }
      }
    }
    const assignment = {
      id: `wp_assign_${enrollment.ID}`,
      userId,
      courseId,
      assignedById: "user_admin",
      status: enrollment.post_status === "completed" ? "completed" : "not_started",
      assignedAt: datetimeToIso(enrollment.post_date),
      startedAt: enrollment.post_status === "completed" ? datetimeToIso(enrollment.post_date) : "",
      completedAt: enrollment.post_status === "completed" ? datetimeToIso(enrollment.post_modified) : "",
      progressPercent: enrollment.post_status === "completed" ? 100 : 0,
      materialProgress,
      source: {
        system: "wordpress_tutor",
        wpEnrollmentId: Number(enrollment.ID),
        wpStatus: enrollment.post_status
      }
    };
    assignmentByUserCourse.set(key, assignment);
    importedAssignments.push(assignment);
  }

  const importedAttempts = [];
  if (importAttempts) {
    const attemptAnswersByAttempt = new Map();
    for (const row of source.attemptAnswers) {
      const attemptId = Number(row.quiz_attempt_id);
      if (!attemptAnswersByAttempt.has(attemptId)) attemptAnswersByAttempt.set(attemptId, []);
      attemptAnswersByAttempt.get(attemptId).push(row);
    }

    for (const wpAttempt of source.quizAttempts) {
      const userId = sourceUserIdToImportedId.get(Number(wpAttempt.user_id));
      const courseId = sourceCourseIdToImportedId.get(Number(wpAttempt.course_id));
      if (!userId || !courseId) continue;
      const assignment = assignmentByUserCourse.get(`${userId}:${courseId}`);
      if (!assignment) continue;
      const course = importedCourses.find((item) => item.id === courseId);
      const scorePercent = computeScorePercent(wpAttempt);
      importedAttempts.push({
        id: `wp_attempt_${wpAttempt.attempt_id}`,
        assignmentId: assignment.id,
        testId: course?.test?.id ?? `wp_test_${wpAttempt.course_id}`,
        userId,
        attemptNumber: importedAttempts.filter((attempt) => attempt.assignmentId === assignment.id).length + 1,
        startedAt: datetimeToIso(wpAttempt.attempt_started_at),
        finishedAt: datetimeToIso(wpAttempt.attempt_ended_at),
        scorePercent,
        status: scorePercent >= (course?.test?.passingPercent ?? 80) ? "passed" : "failed",
        failureReason: "",
        answers: answersForAttempt(
          attemptAnswersByAttempt.get(Number(wpAttempt.attempt_id)) ?? [],
          questionIdToImportedId,
          answerIdToImportedId
        ),
        source: {
          system: "wordpress_tutor",
          wpAttemptId: Number(wpAttempt.attempt_id),
          wpStatus: wpAttempt.attempt_status
        }
      });
    }
  }

  return {
    importedUsers,
    importedCourses,
    importedAssignments,
    importedAttempts,
    importedCertificates: [],
    importedNotifications: [],
    passwordRows,
    fileEntries: [...fileMap.values()].sort((a, b) => b.size - a.size),
    mediaReferences,
    missingMedia,
    skippedUsers,
    skippedCourses,
    skippedQuestions,
    stats: {
      sourceUsers: source.users.length,
      sourceCourses: source.posts.filter((post) => post.post_type === "courses").length,
      sourcePublishedCourses: source.posts.filter((post) => post.post_type === "courses" && post.post_status === "publish").length,
      sourceLessons: source.posts.filter((post) => post.post_type === "lesson").length,
      sourceQuizzes: source.posts.filter((post) => post.post_type === "tutor_quiz").length,
      sourceQuestions: source.questions.length,
      sourceAnswers: source.questionAnswers.length,
      sourceEnrollments: source.posts.filter((post) => post.post_type === "tutor_enrolled").length,
      sourceAttempts: source.quizAttempts.length
    }
  };
}

function mergeIntoDb(currentDb, imported) {
  const withoutImported = {
    ...currentDb,
    users: (currentDb.users ?? []).filter((item) => !String(item.id).startsWith("wp_user_")),
    courses: (currentDb.courses ?? []).filter((item) => !String(item.id).startsWith("wp_course_")),
    assignments: (currentDb.assignments ?? []).filter((item) => !String(item.id).startsWith("wp_assign_")),
    testAttempts: (currentDb.testAttempts ?? []).filter((item) => !String(item.id).startsWith("wp_attempt_")),
    certificates: (currentDb.certificates ?? []).filter((item) => !String(item.id).startsWith("wp_cert_")),
    notifications: (currentDb.notifications ?? []).filter((item) => !String(item.id).startsWith("wp_note_"))
  };

  return {
    ...withoutImported,
    users: [...withoutImported.users, ...imported.importedUsers],
    courses: [...withoutImported.courses, ...imported.importedCourses],
    assignments: [...withoutImported.assignments, ...imported.importedAssignments],
    testAttempts: [...withoutImported.testAttempts, ...imported.importedAttempts],
    certificates: [...withoutImported.certificates, ...imported.importedCertificates],
    notifications: [...withoutImported.notifications, ...imported.importedNotifications]
  };
}

function copyImportedFiles(fileEntries) {
  const copied = [];
  const failed = [];
  ensureDir(importedUploadsDir);
  for (const entry of fileEntries) {
    if (!entry.exists || entry.size === 0) {
      failed.push({ ...entry, error: entry.exists ? "empty file" : "missing source" });
      continue;
    }
    try {
      ensureDir(dirname(entry.targetPath));
      if (existsSync(entry.targetPath)) {
        const targetStats = statSync(entry.targetPath);
        if (targetStats.isFile() && targetStats.size === entry.size) {
          copied.push({ ...entry, skippedExisting: true });
          continue;
        }
      }
      copyFileSync(entry.sourcePath, entry.targetPath);
      copied.push(entry);
    } catch (error) {
      failed.push({ ...entry, error: error.message });
    }
  }
  return { copied, failed };
}

function csvEscape(value) {
  const raw = String(value ?? "");
  return /[",\n\r;]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

function writeReports(imported, copyReport = null) {
  const totalFileBytes = imported.fileEntries.reduce((sum, entry) => sum + (entry.size || 0), 0);
  const summary = {
    generatedAt: now(),
    mode: apply ? "apply" : "dry-run",
    copyFiles,
    paths: {
      sqlPath,
      siteRoot,
      uploadsRoot,
      extraVideoRoot,
      dbPath,
      outputDir
    },
    source: imported.stats,
    imported: {
      users: imported.importedUsers.length,
      courses: imported.importedCourses.length,
      lessons: imported.importedCourses.reduce((sum, course) => sum + course.lessons.length, 0),
      materials: imported.importedCourses.reduce(
        (sum, course) => sum + course.lessons.reduce((lessonSum, lesson) => lessonSum + lesson.materials.length, 0),
        0
      ),
      activeTests: imported.importedCourses.filter((course) => course.test?.status === "active").length,
      questions: imported.importedCourses.reduce((sum, course) => sum + (course.test?.questions?.length ?? 0), 0),
      assignments: imported.importedAssignments.length,
      attempts: imported.importedAttempts.length,
      filesReferenced: imported.fileEntries.length,
      filesReferencedSizeGb: Math.round((totalFileBytes / 1024 / 1024 / 1024) * 100) / 100,
      mediaReferences: imported.mediaReferences.length,
      missingMedia: imported.missingMedia.length
    },
    skipped: {
      users: imported.skippedUsers.length,
      courses: imported.skippedCourses.length,
      questions: imported.skippedQuestions.length
    },
    copied: copyReport
      ? {
          files: copyReport.copied.length,
          failed: copyReport.failed.length,
          sizeGb: Math.round((copyReport.copied.reduce((sum, entry) => sum + entry.size, 0) / 1024 / 1024 / 1024) * 100) / 100
        }
      : null
  };

  writeJson(resolve(outputDir, "summary.json"), summary);
  writeJson(resolve(outputDir, "files.json"), imported.fileEntries);
  writeJson(resolve(outputDir, "missing-media.json"), imported.missingMedia);
  writeJson(resolve(outputDir, "skipped-users.json"), imported.skippedUsers);
  writeJson(resolve(outputDir, "skipped-courses.json"), imported.skippedCourses);
  writeJson(resolve(outputDir, "skipped-questions.json"), imported.skippedQuestions);
  writeFileSync(
    resolve(outputDir, "temporary-passwords.csv"),
    ["wpUserId,email,firstName,lastName,tempPassword", ...imported.passwordRows.map((row) => [row.wpUserId, row.email, row.firstName, row.lastName, row.tempPassword].map(csvEscape).join(","))].join("\n"),
    "utf8"
  );
  if (copyReport) {
    writeJson(resolve(outputDir, "copied-files.json"), copyReport);
  }
  return summary;
}

function printSummary(summary) {
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Reports written to: ${outputDir}`);
  if (!apply) {
    console.log("Dry-run complete. No data was changed.");
  } else {
    console.log("Import apply complete.");
  }
}

if (!existsSync(sqlPath)) {
  throw new Error(`SQL dump not found: ${sqlPath}`);
}
if (!existsSync(dbPath)) {
  throw new Error(`LMS database not found: ${dbPath}`);
}

ensureDir(outputDir);
const source = loadSource();
const imported = buildImport(source);
let copyReport = null;

if (apply) {
  const currentDb = JSON.parse(readFileSync(dbPath, "utf8"));
  const nextDb = mergeIntoDb(currentDb, imported);
  writeFileSync(dbPath, JSON.stringify(nextDb, null, 2), "utf8");
  if (copyFiles) {
    copyReport = copyImportedFiles(imported.fileEntries);
  }
}

const summary = writeReports(imported, copyReport);
printSummary(summary);
