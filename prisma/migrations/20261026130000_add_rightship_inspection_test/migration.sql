-- User-provided assessment; question 8 intentionally retains the earlier RISQ answer.
DO $migration$
DECLARE
  target_test_id TEXT;
BEGIN
  SELECT t."id" INTO target_test_id
  FROM "Test" t
  JOIN "Course" c ON c."id" = t."courseId"
  WHERE c."id" = 'course_0bbe1e76'
    AND lower(trim(c."title")) = lower('Rightship Inspection')
  FOR UPDATE OF t;

  -- Fresh installations may not contain this administrator-created course.
  IF target_test_id IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM "TestQuestion" WHERE "testId" = target_test_id)
     OR EXISTS (SELECT 1 FROM "TestAttempt" WHERE "testId" = target_test_id) THEN
    RAISE EXCEPTION 'Rightship Inspection test is no longer empty; manual review is required.';
  END IF;

  UPDATE "Test"
  SET "passingPercent" = 70, "timeLimitMinutes" = 0
  WHERE "id" = target_test_id;

  INSERT INTO "TestQuestion" ("id", "testId", "type", "questionText", "sortOrder", "source")
  SELECT question_id, target_test_id, 'single_choice', question_text, question_order,
    jsonb_build_object('origin', 'user-provided', 'questionNumber', question_order)
  FROM (VALUES
    ('rightship_q01', 'What is the scope of RightShip''s Dry Bulk inspections?', 1),
    ('rightship_q02', 'RISQ has been designed to help, guide and support shipowners, operators and managers in the pursuit of improvement and efficiency.', 2),
    ('rightship_q03', 'The inspector is obliged to access the ballast tanks, void spaces, duct keel, or cofferdam.', 3),
    ('rightship_q04', 'It is not too important to focus on giving a good first impression.', 4),
    ('rightship_q05', 'Will a RightShip inspector check if there is a Ship Energy Efficiency Management Plan on board?', 5),
    ('rightship_q06', 'How should the inspection of ballast tanks, void spaces, and cofferdam be conducted?', 6),
    ('rightship_q07', 'Are night-time inspections allowed?', 7),
    ('rightship_q08', 'The inspection is to be completed within a maximum timeframe of...', 8),
    ('rightship_q09', 'There is no provision in RISQ3 to check if there is training to recognize signs of mental health problems.', 9),
    ('rightship_q10', 'RightShip suggests conducting additional audits, such as navigation assessments, in addition to those mandated by the ISM Code.', 10)
  ) AS questions(question_id, question_text, question_order);

  UPDATE "TestQuestion"
  SET "source" = "source" || '{"assessmentVersion":"Earlier RISQ version supplied by the administrator; expected answer: 14 hours"}'::jsonb
  WHERE "id" = 'rightship_q08';

  INSERT INTO "TestOption" ("id", "questionId", "optionText", "isCorrect", "sortOrder")
  VALUES
    ('rightship_q01_a', 'rightship_q01', 'To assess officers'' and ratings'' familiarization with the SMS', false, 1),
    ('rightship_q01_b', 'rightship_q01', 'To assess the state of maintenance of the vessel according to the SMS', false, 2),
    ('rightship_q01_c', 'rightship_q01', 'To assess a ship''s safety, quality, and the effectiveness of its Safety Management System (SMS)', true, 3),
    ('rightship_q02_a', 'rightship_q02', 'True', true, 1),
    ('rightship_q02_b', 'rightship_q02', 'False', false, 2),
    ('rightship_q03_a', 'rightship_q03', 'True', false, 1),
    ('rightship_q03_b', 'rightship_q03', 'False', true, 2),
    ('rightship_q04_a', 'rightship_q04', 'True', false, 1),
    ('rightship_q04_b', 'rightship_q04', 'False', true, 2),
    ('rightship_q05_a', 'rightship_q05', 'Yes', true, 1),
    ('rightship_q05_b', 'rightship_q05', 'No', false, 2),
    ('rightship_q06_a', 'rightship_q06', 'The inspection should be conducted from the deck', true, 1),
    ('rightship_q06_b', 'rightship_q06', 'The inspector should enter the spaces', false, 2),
    ('rightship_q06_c', 'rightship_q06', 'The inspector should request the ship''s crew to enter the spaces', false, 3),
    ('rightship_q07_a', 'rightship_q07', 'Yes, they are expected', false, 1),
    ('rightship_q07_b', 'rightship_q07', 'No, they are strictly forbidden', false, 2),
    ('rightship_q07_c', 'rightship_q07', 'No, unless approved by RightShip and agreed upon by the vessel manager', true, 3),
    ('rightship_q07_d', 'rightship_q07', 'No, unless approved by RightShip', false, 4),
    ('rightship_q08_a', 'rightship_q08', '12 hours', false, 1),
    ('rightship_q08_b', 'rightship_q08', '14 hours', true, 2),
    ('rightship_q08_c', 'rightship_q08', '8 hours', false, 3),
    ('rightship_q09_a', 'rightship_q09', 'True', false, 1),
    ('rightship_q09_b', 'rightship_q09', 'False', true, 2),
    ('rightship_q10_a', 'rightship_q10', 'True', true, 1),
    ('rightship_q10_b', 'rightship_q10', 'False', false, 2);
END
$migration$;
