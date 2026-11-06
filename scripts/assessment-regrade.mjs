import { isDeepStrictEqual } from "node:util";

function questionState(question) {
  return {
    text: question.questionText,
    type: question.type,
    options: question.options.map(({ id, optionText, isCorrect }) => ({ id, optionText, isCorrect }))
  };
}

export function prepareAssessmentCorrection(database, plan, { asOf } = {}) {
  const end = new Date(asOf);
  if (!plan.version || !Array.isArray(plan.corrections) || !Number.isFinite(end.getTime())) {
    throw new Error("A versioned correction plan and explicit asOf date are required.");
  }
  const start = new Date(end.getTime() - 7 * 86400000);
  const report = { version: plan.version, from: start.toISOString(), through: end.toISOString(), questions: [], attempts: [], skipped: [], eligibleAssignmentIds: [], reviewedAttempts: 0 };
  const previousEvent = database.auditEvents?.find((event) => event.action === "assessment_correction" && event.details?.version === plan.version);
  if (previousEvent?.details.planSha256 && plan.sha256 && previousEvent.details.planSha256 !== plan.sha256) throw new Error("An operation with this version was already applied using a different plan.");
  if (previousEvent) return { database: structuredClone(database), report: { ...report, alreadyApplied: true, previousReport: previousEvent.details.report } };
  const next = structuredClone(database);
  const corrections = new Map();
  for (const correction of plan.corrections) {
    if (corrections.has(correction.questionId) || !["rekey", "void"].includes(correction.retrospective)) throw new Error("Duplicate question or invalid retrospective policy.");
    const course = next.courses.find((item) => item.id === correction.courseId);
    const question = course?.test?.questions.find((item) => item.id === correction.questionId);
    if (!question) throw new Error(`Missing question: ${correction.questionId}`);
    const old = { text: correction.oldQuestionText, type: correction.oldType, options: correction.oldOptions };
    if (!isDeepStrictEqual(questionState(question), old)) throw new Error(`Question changed since review: ${question.id}`);
    const options = correction.newOptions;
    const type = correction.newType ?? question.type;
    if (!Array.isArray(options) || !isDeepStrictEqual(options.map((o) => o.id), question.options.map((o) => o.id)) || !options.some((o) => o.isCorrect) || options.some((o) => typeof o.isCorrect !== "boolean" || !o.optionText?.trim()) || (type === "single_choice" && options.filter((o) => o.isCorrect).length !== 1) || !["single_choice", "multiple_choice"].includes(type)) throw new Error(`Invalid corrected key: ${question.id}`);
    if (correction.retrospective === "rekey" && ((correction.newQuestionText ?? question.questionText) !== question.questionText || type !== question.type || options.some((option, index) => option.optionText !== question.options[index].optionText))) throw new Error(`A rewritten question cannot be retrospectively rekeyed: ${question.id}`);
    question.questionText = correction.newQuestionText ?? question.questionText;
    question.type = type;
    question.options = question.options.map((option, index) => ({ ...option, ...options[index] }));
    course.source = { ...course.source, assessmentCorrectionVersion: plan.version };
    corrections.set(question.id, correction);
    report.questions.push({ questionId: question.id, courseId: course.id, retrospective: correction.retrospective });
  }
  for (const attempt of next.testAttempts) {
    const finished = new Date(attempt.finishedAt).getTime();
    if (!attempt.finishedAt || !Number.isFinite(finished) || finished < start.getTime() || finished > end.getTime() || attempt.status === "in_progress") continue;
    report.reviewedAttempts += 1;
    const course = next.courses.find((item) => item.test?.id === attempt.testId);
    if (!course?.test.questions.some((q) => corrections.has(q.id))) continue;
    const questions = course.test.questions;
    const answers = attempt.answers;
    // Incomplete or structurally changed historical papers need human review, not inferred marks.
    if (!Array.isArray(answers) || answers.length !== questions.length || new Set(answers.map((a) => a.questionId)).size !== questions.length || questions.some((q) => !answers.some((a) => a.questionId === q.id))) {
      report.skipped.push({ attemptId: attempt.id, reason: "Historical paper does not match current questions" });
      continue;
    }
    const snapshots = attempt.source?.questionSnapshots;
    if (snapshots && questions.some((question) => {
      const correction = corrections.get(question.id);
      const snapshot = snapshots.find((item) => item.id === question.id);
      return correction && (!snapshot || !isDeepStrictEqual(questionState(snapshot), { text: correction.oldQuestionText, type: correction.oldType, options: correction.oldOptions }));
    })) {
      report.skipped.push({ attemptId: attempt.id, reason: "Historical question snapshot does not match reviewed version" });
      continue;
    }
    const before = structuredClone(attempt);
    let denominator = 0;
    let correct = 0;
    for (const question of questions) {
      const answer = answers.find((a) => a.questionId === question.id);
      const correction = corrections.get(question.id);
      if (correction?.retrospective === "void") {
        answer.assessmentCorrection = { version: plan.version, excluded: true, originalIsCorrect: answer.isCorrect };
        continue;
      }
      denominator += 1;
      if (correction) {
        const selected = [...(answer.selectedOptionIds ?? (answer.selectedOptionId ? [answer.selectedOptionId] : []))].sort();
        const expected = question.options.filter((o) => o.isCorrect).map((o) => o.id).sort();
        const corrected = isDeepStrictEqual(selected, expected);
        answer.assessmentCorrection = { version: plan.version, originalIsCorrect: answer.isCorrect, correctedIsCorrect: corrected };
        answer.isCorrect = Boolean(answer.isCorrect || corrected);
      }
      if (answer.isCorrect) correct += 1;
    }
    if (!denominator) {
      Object.assign(attempt, before);
      report.skipped.push({ attemptId: attempt.id, reason: "No valid questions remain" });
      continue;
    }
    const recalculatedScore = Math.round(correct / denominator * 100);
    attempt.scorePercent = Math.max(before.scorePercent, recalculatedScore);
    const expired = before.status === "expired" || Boolean(before.failureReason);
    const passingPercent = attempt.source?.passingPercent ?? course.test.passingPercent;
    if (!expired && attempt.scorePercent >= passingPercent) attempt.status = "passed";
    attempt.source = { ...attempt.source, assessmentCorrections: [...(attempt.source?.assessmentCorrections ?? []), { version: plan.version, appliedAt: end.toISOString(), original: { scorePercent: before.scorePercent, status: before.status, failureReason: before.failureReason, answers: before.answers }, recalculatedScore, denominator }] };
    const assignment = next.assignments.find((item) => item.id === attempt.assignmentId && item.userId === attempt.userId && item.courseId === course.id);
    if (!assignment) throw new Error(`Missing assignment: ${attempt.id}`);
    if (attempt.status === "passed" && !expired) {
      assignment.status = "completed";
      assignment.completedAt ||= attempt.finishedAt;
      assignment.progressPercent = 100;
      assignment.activeTestStartedAt = "";
      if (!report.eligibleAssignmentIds.includes(assignment.id)) report.eligibleAssignmentIds.push(assignment.id);
    }
    report.attempts.push({ attemptId: attempt.id, userId: attempt.userId, courseId: course.id, oldScore: before.scorePercent, newScore: attempt.scorePercent, oldStatus: before.status, newStatus: attempt.status, recalculatedScore, excludedQuestions: questions.length - denominator });
  }
  return { database: next, report };
}
