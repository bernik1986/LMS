import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";
const css = readFileSync(resolve("src/app/globals.css"), "utf8");

const courses = [
  {
    title: "Basic Maritime Safety",
    status: "Активен",
    description: "Базовый курс по безопасности на борту и обязательным процедурам.",
    lessons: 5,
    materials: 9
  },
  {
    title: "First Aid at Sea",
    status: "Активен",
    description: "Курс по первой помощи на море с финальным тестированием.",
    lessons: 6,
    materials: 12
  },
  {
    title: "Vessel Equipment Introduction",
    status: "Отключен",
    description: "Вводный курс по работе с судовым оборудованием.",
    lessons: 4,
    materials: 7
  }
];

const assignments = [
  {
    title: "Basic Maritime Safety",
    status: "В процессе",
    progress: 64,
    test: "Закрыт"
  },
  {
    title: "First Aid at Sea",
    status: "Тест доступен",
    progress: 100,
    test: "Доступен"
  },
  {
    title: "Vessel Fire Safety Annual Check",
    status: "Завершен",
    progress: 100,
    test: "92%"
  }
];

function layout(title, body) {
  return `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title} | Marine LMS Preview</title>
    <style>${css}</style>
  </head>
  <body>
    <div class="app-shell">
      <header class="topbar">
        <a class="brand" href="/">
          <span class="brand-mark">M</span>
          <span>Marine LMS</span>
        </a>
        <nav class="nav-links" aria-label="Основная навигация">
          <a class="nav-link" href="/dashboard">Кабинет</a>
          <a class="nav-link" href="/admin">Админ</a>
          <a class="button secondary" href="/login">Войти</a>
        </nav>
      </header>
      ${body}
    </div>
  </body>
</html>`;
}

function homePage() {
  return layout(
    "Главная",
    `<main class="home-page">
      <section class="hero">
        <div class="hero-copy">
          <span class="eyebrow">Marine training platform</span>
          <h1>Marine LMS для обучения, тестов и сертификатов</h1>
          <p class="lead">Закрытая учебная платформа для морских курсов: администратор вручную создает студентов, назначает обучение, контролирует прогресс и выдает сертификаты.</p>
          <div class="actions">
            <a class="button" href="/apply">Зарегистрироваться на курс</a>
            <a class="button secondary" href="/login">Войти в кабинет</a>
          </div>
          <div class="hero-meta">
            <div class="hero-meta-item"><strong>Manual access</strong><span>без самостоятельной регистрации</span></div>
            <div class="hero-meta-item"><strong>Course control</strong><span>материалы перед тестом</span></div>
            <div class="hero-meta-item"><strong>Certificates</strong><span>привязка к студенту и курсу</span></div>
          </div>
        </div>
      </section>
      <section class="section">
        <div class="section-heading">
          <div>
            <span class="eyebrow">Демо-курсы</span>
            <h2>Основа каталога для формы заявки</h2>
          </div>
        </div>
        <div class="grid three">
          ${courses
            .map(
              (course) => `<article class="card">
                <span class="badge ${course.status === "Активен" ? "success" : "warning"}">${course.status}</span>
                <h3>${course.title}</h3>
                <p class="muted">${course.description}</p>
                <p class="muted">${course.lessons} уроков, ${course.materials} обязательных материалов</p>
              </article>`
            )
            .join("")}
        </div>
      </section>
    </main>`
  );
}

function applyPage() {
  return layout(
    "Заявка",
    `<main class="page">
      <section class="section">
        <div>
          <span class="eyebrow">Заявка на курс</span>
          <h1>Оставить заявку</h1>
          <p class="lead">Отправка формы не создает аккаунт. Администратор обработает заявку и вручную создаст пользователя при необходимости.</p>
        </div>
        <form class="form-panel">
          <div class="field"><label>Фамилия</label><input /></div>
          <div class="field"><label>Имя</label><input /></div>
          <div class="field"><label>Номер телефона</label><input /></div>
          <div class="field"><label>E-mail</label><input type="email" /></div>
          <div class="field"><label>Курс</label><select>${courses
            .filter((course) => course.status === "Активен")
            .map((course) => `<option>${course.title}</option>`)
            .join("")}</select></div>
          <div class="field"><label>Комментарий</label><textarea></textarea></div>
          <button class="button" type="button">Отправить заявку</button>
        </form>
      </section>
    </main>`
  );
}

function loginPage() {
  return layout(
    "Вход",
    `<main class="page">
      <section class="section">
        <div>
          <span class="eyebrow">Закрытый доступ</span>
          <h1>Вход в платформу</h1>
          <p class="lead">Самостоятельной регистрации нет. Доступ выдает администратор после обработки заявки.</p>
        </div>
        <form class="form-panel">
          <div class="field"><label>E-mail</label><input type="email" /></div>
          <div class="field"><label>Пароль</label><input type="password" /></div>
          <button class="button" type="button">Войти</button>
          <p class="muted">Для Sprint 1 форма является интерфейсной заготовкой. Реальная авторизация запланирована на Sprint 2.</p>
        </form>
      </section>
    </main>`
  );
}

function adminPage() {
  return layout(
    "Админ",
    `<div class="split-layout">
      <aside class="sidebar">
        <span class="eyebrow">Админ-панель</span>
        <nav class="sidebar-nav">
          <a href="/admin">Дашборд</a>
          <a href="/apply">Заявки</a>
          <a href="/admin">Пользователи</a>
          <a href="/admin">Курсы</a>
          <a href="/admin">Сертификаты</a>
        </nav>
      </aside>
      <main class="content">
        <section class="section">
          <div class="section-heading">
            <div>
              <span class="eyebrow">Sprint 1</span>
              <h1>Админский дашборд</h1>
              <p class="lead">Рабочая зона администратора для заявок, пользователей, курсов, тестов и сертификатов.</p>
            </div>
            <div class="actions">
              <a class="button" href="/admin">Создать пользователя</a>
              <a class="button secondary" href="/admin">Курсы</a>
            </div>
          </div>
          <div class="grid four">
            ${[
              ["Новые заявки", "12", "ожидают обработки"],
              ["Активные студенты", "48", "имеют доступ к платформе"],
              ["Активные курсы", "7", "доступны для назначения"],
              ["Выданные сертификаты", "136", "за все время"]
            ]
              .map(
                ([label, value, hint]) => `<article class="metric">
                  <div class="metric-top"><span class="muted">${label}</span><span class="metric-icon">•</span></div>
                  <strong class="metric-value">${value}</strong>
                  <span class="muted">${hint}</span>
                </article>`
              )
              .join("")}
          </div>
        </section>
      </main>
    </div>`
  );
}

function dashboardPage() {
  return layout(
    "Кабинет",
    `<div class="split-layout">
      <aside class="sidebar">
        <span class="eyebrow">Личный кабинет</span>
        <nav class="sidebar-nav">
          <a href="/dashboard">Обзор</a>
          <a href="/dashboard">Мои курсы</a>
          <a href="/dashboard">Профиль</a>
          <a href="/dashboard">Сертификаты</a>
        </nav>
      </aside>
      <main class="content">
        <section class="section">
          <div>
            <span class="eyebrow">Мои курсы</span>
            <h1>Назначенные курсы</h1>
            <p class="lead">Тест открывается только после прохождения обязательных материалов.</p>
          </div>
          <div class="grid three">
            ${assignments
              .map(
                (assignment) => `<article class="card">
                  <span class="badge ${assignment.status === "Завершен" ? "success" : "warning"}">${assignment.status}</span>
                  <h3>${assignment.title}</h3>
                  <div class="progress-track"><div class="progress-bar" style="width: ${assignment.progress}%"></div></div>
                  <p class="muted">Тест: ${assignment.test}</p>
                </article>`
              )
              .join("")}
          </div>
        </section>
      </main>
    </div>`
  );
}

const routes = new Map([
  ["/", homePage],
  ["/apply", applyPage],
  ["/login", loginPage],
  ["/admin", adminPage],
  ["/dashboard", dashboardPage]
]);

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${host}:${port}`);
  const render = routes.get(url.pathname) ?? homePage;

  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8"
  });
  response.end(render());
});

server.listen(port, host, () => {
  console.log(`Preview server ready at http://${host}:${port}`);
});
