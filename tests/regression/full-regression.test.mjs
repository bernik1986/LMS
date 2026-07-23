import test from "node:test";
import { runRegressionTest } from "../../scripts/regression-test.mjs";

test("complete Marine LMS regression workflow", async () => {
  await runRegressionTest();
});
