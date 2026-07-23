import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test, { after, before } from "node:test";
import { chromium } from "playwright-core";
import { startTestServer } from "../helpers/test-server.mjs";

const chromeCandidates = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"
].filter(Boolean);
const chromePath = chromeCandidates.find((candidate) => existsSync(candidate));
let app;
let browser;

function trackBrowserErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !/favicon/i.test(message.text())) {
      errors.push(`console: ${message.text()}`);
    }
  });
  return errors;
}

before(async () => {
  if (!chromePath) {
    throw new Error("Google Chrome was not found. Set CHROME_PATH before running npm run test:e2e.");
  }
  app = await startTestServer({ inProcess: true });
  const adminCookie = await app.login("admin@example.com", "Admin123!");
  await app.cacheCsrf("/admin", adminCookie);
  for (let index = 1; index <= 13; index += 1) {
    const created = await app.postForm(
      "/admin/courses/create",
      {
        title: `Browser catalogue course ${String(index).padStart(2, "0")}`,
        shortDescription: `Browser test course ${index}`,
        goals: "Browser regression coverage",
        oldPrice: "150 USD",
        newPrice: "100 USD",
        showOnHome: "on",
        homeSortOrder: String(index + 2),
        catalogCategory: index % 2 ? "Safety" : "Navigation",
        catalogPositions: ["All Seafarers"]
      },
      adminCookie
    );
    assert.equal(created.response.status, 303);
  }

  const studentCookie = await app.login("student@example.com", "Student123!");
  await app.cacheCsrf("/dashboard", studentCookie);
  for (const materialId of ["material_intro_text", "material_intro_video", "material_emergency_text"]) {
    const completed = await app.postForm(
      "/dashboard/materials/complete",
      { assignmentId: "assign_demo", materialId },
      studentCookie
    );
    assert.equal(completed.response.status, 303);
  }
  browser = await chromium.launch({
    headless: true,
    executablePath: chromePath,
    args: ["--disable-gpu"]
  });
});

after(async () => {
  await browser?.close();
  await app?.stop();
});

test("desktop public catalogue has a three-column home grid, 12-course pagination, filters, and a three-second hero cadence", async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const browserErrors = trackBrowserErrors(page);
  await page.goto(app.baseUrl, { waitUntil: "networkidle" });
  await page.locator("h1").filter({ hasText: "Learn Today." }).waitFor();

  const slides = page.locator(".figma-hero-slide");
  assert.equal(await slides.count(), 6);
  const animation = await slides.first().evaluate((element) => {
    const style = getComputedStyle(element);
    return { name: style.animationName, duration: style.animationDuration };
  });
  assert.match(animation.name, /figma-hero-slide/);
  assert.equal(animation.duration, "18s");

  const featuredGrid = page.locator(".home-page > .section .grid.three").first();
  const columns = await featuredGrid.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length);
  assert.equal(columns, 3);
  assert.equal(await featuredGrid.locator(":scope > .card").count(), 15);
  assert.doesNotMatch(await featuredGrid.innerText(), /\bUSD\b|\$/);

  await page.getByRole("link", { name: "View all courses" }).click();
  await page.waitForURL("**/courses");
  const firstPageCards = page.locator(".course-catalog .grid.three > .card");
  assert.equal(await firstPageCards.count(), 12);
  await page.getByRole("link", { name: /Next/ }).click();
  await page.waitForURL(/page=2/);
  assert.equal(await page.locator(".course-catalog .grid.three > .card").count(), 3);

  await page.selectOption('select[name="sort"]', "title_desc");
  await page.getByRole("button", { name: "Apply filters" }).click();
  const titles = await page.locator(".course-catalog .card h3").allTextContents();
  assert.deepEqual(titles, [...titles].sort((a, b) => b.localeCompare(a, "en")));
  assert.deepEqual(browserErrors, []);
  await context.close();
});

test("student browser flow opens a compact course cover and shows one test question per screen", async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const browserErrors = trackBrowserErrors(page);
  await page.goto(`${app.baseUrl}/login`);
  await page.getByLabel("E-mail").fill("student@example.com");
  await page.getByLabel("Password").fill("Student123!");
  await Promise.all([
    page.waitForURL("**/dashboard"),
    page.getByRole("button", { name: "Sign in" }).click()
  ]);

  await page.goto(`${app.baseUrl}/dashboard/courses/assign_demo`);
  const cover = page.locator(".student-course-cover");
  await cover.waitFor();
  const coverBox = await cover.boundingBox();
  assert.ok(coverBox.width <= 261, `Student course cover is too wide: ${coverBox.width}px`);
  assert.ok(coverBox.height <= 350, `Student course cover is too tall: ${coverBox.height}px`);
  assert.ok(await page.getByText("Completion rules").isVisible());

  await page.goto(`${app.baseUrl}/dashboard/tests/assign_demo`);
  const steps = page.locator("[data-test-step]");
  assert.equal(await steps.count(), 2);
  assert.equal(await steps.locator(":visible").count(), 1);
  assert.equal(await page.locator("[data-test-progress]").innerText(), "Question 1 of 2");
  await steps.nth(0).locator("input").nth(1).check();
  await page.getByRole("button", { name: "Next" }).click();
  assert.equal(await steps.locator(":visible").count(), 1);
  assert.equal(await page.locator("[data-test-progress]").innerText(), "Question 2 of 2");
  assert.ok(await page.getByRole("button", { name: "Submit test" }).isVisible());
  assert.deepEqual(browserErrors, []);
  await context.close();
});

test("admin browser screens expose New Course on demand and allow selecting an administrator role", async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const browserErrors = trackBrowserErrors(page);
  await page.goto(`${app.baseUrl}/login`);
  await page.getByLabel("E-mail").fill("admin@example.com");
  await page.getByLabel("Password").fill("Admin123!");
  await Promise.all([
    page.waitForURL("**/admin"),
    page.getByRole("button", { name: "Sign in" }).click()
  ]);

  await page.goto(`${app.baseUrl}/admin/courses`);
  assert.ok(await page.getByRole("link", { name: "New Course" }).isVisible());
  assert.equal(await page.locator('form[action="/admin/courses/create"]').count(), 0);
  await page.getByRole("link", { name: "New Course" }).click();
  assert.equal(await page.locator('form[action="/admin/courses/create"]').count(), 1);

  await page.goto(`${app.baseUrl}/admin/users`);
  const roleSelect = page.locator('form[action="/admin/users/create"] select[name="role"]');
  assert.ok(await roleSelect.isVisible());
  assert.deepEqual(await roleSelect.locator("option").allTextContents(), ["Student", "Instructor", "Administrator"]);
  assert.deepEqual(browserErrors, []);
  await context.close();
});

test("mobile public and student pages do not overflow the viewport or hide primary actions", async () => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    deviceScaleFactor: 1
  });
  const page = await context.newPage();
  const browserErrors = trackBrowserErrors(page);
  await page.goto(app.baseUrl, { waitUntil: "networkidle" });
  const homeOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(homeOverflow <= 1, `Home page overflows by ${homeOverflow}px`);
  assert.ok(await page.getByRole("link", { name: "View courses" }).isVisible());
  const mobileColumns = await page.locator(".home-page > .section .grid.three").first().evaluate(
    (element) => getComputedStyle(element).gridTemplateColumns.split(" ").length
  );
  assert.equal(mobileColumns, 1);

  await page.goto(`${app.baseUrl}/courses`);
  const catalogueOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(catalogueOverflow <= 1, `Catalogue overflows by ${catalogueOverflow}px`);
  assert.equal(await page.locator(".course-catalog .grid.three > .card").count(), 12);

  await page.goto(`${app.baseUrl}/login`);
  await page.getByLabel("E-mail").fill("student@example.com");
  await page.getByLabel("Password").fill("Student123!");
  await Promise.all([
    page.waitForURL("**/dashboard"),
    page.getByRole("button", { name: "Sign in" }).click()
  ]);
  await page.goto(`${app.baseUrl}/dashboard/courses/assign_demo`);
  const dashboardOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(dashboardOverflow <= 1, `Student course page overflows by ${dashboardOverflow}px`);
  assert.ok(await page.getByText("Materials", { exact: true }).isVisible());
  assert.deepEqual(browserErrors, []);
  await context.close();
});
