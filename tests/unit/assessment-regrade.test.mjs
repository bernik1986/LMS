import assert from "node:assert/strict";
import test from "node:test";
import { prepareAssessmentCorrection } from "../../scripts/assessment-regrade.mjs";

const asOf = "2026-11-06T12:30:00.000Z";
function fixture() {
  const questions = ["q1", "q2"].map((id) => ({ id, questionText: id, type: "single_choice", options: [{ id: `${id}a`, optionText: "A", isCorrect: true }, { id: `${id}b`, optionText: "B", isCorrect: false }] }));
  const database = { courses: [{ id: "course", autoIssueCertificate: false, test: { id: "test", passingPercent: 70, questions } }], assignments: [{ id: "assignment", userId: "student", courseId: "course", status: "test_failed", progressPercent: 50 }], testAttempts: [{ id: "attempt", assignmentId: "assignment", testId: "test", userId: "student", finishedAt: "2026-11-05T12:00:00.000Z", startedAt: "2026-11-05T11:50:00.000Z", scorePercent: 50, status: "failed", failureReason: "", answers: [{ questionId: "q1", selectedOptionIds: ["q1b"], isCorrect: false }, { questionId: "q2", selectedOptionId: "q2a", isCorrect: true }] }], auditEvents: [] };
  const q = questions[0];
  const plan = { version: "test-correction", corrections: [{ courseId: "course", questionId: q.id, oldQuestionText: q.questionText, oldType: q.type, oldOptions: structuredClone(q.options), newOptions: q.options.map((o) => ({ ...o, isCorrect: !o.isCorrect })), retrospective: "rekey" }] };
  return { database, plan };
}

test("corrected key awards a wrongly rejected answer and completes the assignment without altering certificate policy", () => {
  const { database, plan } = fixture();
  const original = structuredClone(database);
  const result = prepareAssessmentCorrection(database, plan, { asOf });
  assert.deepEqual(database, original);
  assert.equal(result.database.testAttempts[0].scorePercent, 100);
  assert.equal(result.database.testAttempts[0].status, "passed");
  assert.equal(result.database.assignments[0].status, "completed");
  assert.equal(result.database.courses[0].autoIssueCertificate, false);
  assert.deepEqual(result.report.eligibleAssignmentIds, ["assignment"]);
  assert.equal(result.database.testAttempts[0].source.assessmentCorrections[0].original.answers[0].isCorrect, false);
});

test("invalid questions are excluded, not graded using rewritten text", () => {
  const { database, plan } = fixture();
  plan.corrections[0].retrospective = "void";
  plan.corrections[0].newQuestionText = "A new unambiguous question";
  const result = prepareAssessmentCorrection(database, plan, { asOf });
  assert.equal(result.database.testAttempts[0].scorePercent, 100);
  assert.equal(result.report.attempts[0].excludedQuestions, 1);
  assert.equal(result.database.testAttempts[0].answers[0].assessmentCorrection.excluded, true);
});

test("expired attempts and other recorded failure reasons cannot become passes", () => {
  for (const expired of [{ status: "expired", failureReason: "time_expired" }, { status: "failed", failureReason: "time_expired" }]) {
    const { database, plan } = fixture();
    Object.assign(database.testAttempts[0], expired);
    const result = prepareAssessmentCorrection(database, plan, { asOf });
    assert.equal(result.database.testAttempts[0].scorePercent, 100);
    assert.equal(result.database.testAttempts[0].status, expired.status);
    assert.deepEqual(result.report.eligibleAssignmentIds, []);
  }
});

test("previously accepted answers and higher results are protected", () => {
  const { database, plan } = fixture();
  Object.assign(database.testAttempts[0], { scorePercent: 100, status: "passed" });
  Object.assign(database.testAttempts[0].answers[0], { selectedOptionIds: ["q1a"], isCorrect: true });
  const result = prepareAssessmentCorrection(database, plan, { asOf });
  assert.equal(result.database.testAttempts[0].scorePercent, 100);
  assert.equal(result.database.testAttempts[0].answers[0].isCorrect, true);
});

test("the seven-day window is inclusive and excludes older, future, and unfinished attempts", () => {
  for (const finishedAt of ["2026-10-30T12:29:59.999Z", "2026-11-06T12:30:00.001Z", ""]) {
    const { database, plan } = fixture();
    database.testAttempts[0].finishedAt = finishedAt;
    assert.equal(prepareAssessmentCorrection(database, plan, { asOf }).report.attempts.length, 0);
  }
  const { database, plan } = fixture();
  database.testAttempts[0].finishedAt = "2026-10-30T12:30:00.000Z";
  assert.equal(prepareAssessmentCorrection(database, plan, { asOf }).report.attempts.length, 1);
});

test("changed questions and incomplete historical papers fail closed", () => {
  const { database, plan } = fixture();
  database.courses[0].test.questions[0].questionText = "Changed";
  assert.throws(() => prepareAssessmentCorrection(database, plan, { asOf }), /changed since review/);
  const other = fixture();
  other.database.testAttempts[0].answers.pop();
  const result = prepareAssessmentCorrection(other.database, other.plan, { asOf });
  assert.equal(result.report.skipped.length, 1);
  assert.equal(result.database.testAttempts[0].scorePercent, 50);
});

test("a completed operation is idempotent even after the keys have changed", () => {
  const { database, plan } = fixture();
  const result = prepareAssessmentCorrection(database, plan, { asOf });
  result.database.auditEvents.push({ action: "assessment_correction", details: { version: plan.version, report: result.report } });
  const repeated = prepareAssessmentCorrection(result.database, plan, { asOf });
  assert.equal(repeated.report.alreadyApplied, true);
  assert.deepEqual(repeated.database, result.database);
});

test("multiple choice grading requires the exact set; empty valid denominator never auto-passes", () => {
  const { database, plan } = fixture();
  plan.corrections[0].newType = "multiple_choice";
  plan.corrections[0].oldType = "multiple_choice";
  database.courses[0].test.questions[0].type = "multiple_choice";
  plan.corrections[0].newOptions.forEach((o) => { o.isCorrect = true; });
  let result = prepareAssessmentCorrection(database, plan, { asOf });
  assert.equal(result.database.testAttempts[0].status, "failed");
  database.testAttempts[0].answers[0].selectedOptionIds = ["q1b", "q1a"];
  result = prepareAssessmentCorrection(database, plan, { asOf });
  assert.equal(result.database.testAttempts[0].status, "passed");
  database.courses[0].test.questions.pop();
  database.testAttempts[0].answers.pop();
  plan.corrections[0].retrospective = "void";
  result = prepareAssessmentCorrection(database, plan, { asOf });
  assert.equal(result.report.skipped[0].reason, "No valid questions remain");
  assert.equal(result.database.testAttempts[0].status, "failed");
});

test("rewritten stems cannot be rekeyed and mismatched saved question versions are not inferred", () => {
  const { database, plan } = fixture();
  plan.corrections[0].newQuestionText = "Different question";
  assert.throws(() => prepareAssessmentCorrection(database, plan, { asOf }), /rewritten question/);
  delete plan.corrections[0].newQuestionText;
  database.testAttempts[0].source = { questionSnapshots: structuredClone(database.courses[0].test.questions) };
  database.testAttempts[0].source.questionSnapshots[0].questionText = "An older version";
  const result = prepareAssessmentCorrection(database, plan, { asOf });
  assert.equal(result.report.skipped[0].reason, "Historical question snapshot does not match reviewed version");
  assert.equal(result.database.testAttempts[0].status, "failed");
});
