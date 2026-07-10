import Link from "next/link";
import {
  Anchor,
  ArrowRight,
  ClipboardPenLine,
  LockKeyhole,
  Route
} from "lucide-react";
import { demoCourses } from "@/lib/mock-data";
import { getCourseStatusLabel } from "@/lib/status";

export default function HomePage() {
  return (
    <main className="home-page">
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">Marine training platform</span>
          <h1>Marine LMS для обучения, тестов и сертификатов</h1>
          <p className="lead">
            Закрытая учебная платформа для морских курсов: администратор
            вручную создает студентов, назначает обучение, контролирует
            прогресс и выдает сертификаты.
          </p>
          <div className="actions">
            <Link className="button" href="/apply">
              <ClipboardPenLine size={18} />
              Зарегистрироваться на курс
            </Link>
            <Link className="button secondary" href="/login">
              <LockKeyhole size={18} />
              Войти в кабинет
            </Link>
          </div>
          <div className="hero-meta" aria-label="Ключевые возможности">
            <div className="hero-meta-item">
              <strong>Manual access</strong>
              <span>без самостоятельной регистрации</span>
            </div>
            <div className="hero-meta-item">
              <strong>Course control</strong>
              <span>материалы перед тестом</span>
            </div>
            <div className="hero-meta-item">
              <strong>Certificates</strong>
              <span>привязка к студенту и курсу</span>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Ключевая логика</span>
            <h2>Что входит в первый релиз</h2>
          </div>
          <Link className="button secondary" href="/admin">
            Открыть админ-панель
            <ArrowRight size={17} />
          </Link>
        </div>
        <div className="grid three">
          <article className="card">
            <span className="metric-icon">
              <Anchor size={20} />
            </span>
            <h3>Морская специализация</h3>
            <p className="muted">
              Интерфейс и структура заточены под курсы безопасности,
              экипажное обучение и сертификацию.
            </p>
          </article>
          <article className="card">
            <span className="metric-icon">
              <Route size={20} />
            </span>
            <h3>Материалы перед тестом</h3>
            <p className="muted">
              Тест открывается после завершения обязательных материалов курса.
            </p>
          </article>
          <article className="card">
            <span className="metric-icon">
              <LockKeyhole size={20} />
            </span>
            <h3>Роли и закрытый доступ</h3>
            <p className="muted">
              Минимум две роли: студент и администратор, с разными зонами
              интерфейса и правами.
            </p>
          </article>
        </div>
      </section>

      <section className="section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Демо-курсы</span>
            <h2>Основа каталога для формы заявки</h2>
          </div>
        </div>
        <div className="grid three">
          {demoCourses.map((course) => (
            <article className="card" key={course.id}>
              <span
                className={`badge ${course.status === "active" ? "success" : "warning"}`}
              >
                {getCourseStatusLabel(course.status)}
              </span>
              <h3>{course.title}</h3>
              <p className="muted">{course.shortDescription}</p>
              <p className="muted">
                {course.lessonsCount} уроков, {course.requiredMaterialsCount}{" "}
                обязательных материалов
              </p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
