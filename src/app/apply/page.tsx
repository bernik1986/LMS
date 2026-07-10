import { Send } from "lucide-react";
import { demoCourses } from "@/lib/mock-data";

export default function ApplyPage() {
  const activeCourses = demoCourses.filter((course) => course.status === "active");

  return (
    <main className="page">
      <section className="section">
        <div>
          <span className="eyebrow">Заявка на курс</span>
          <h1>Оставить заявку</h1>
          <p className="lead">
            Отправка формы не создает аккаунт. Администратор обработает заявку
            и вручную создаст пользователя при необходимости.
          </p>
        </div>
        <form className="form-panel">
          <div className="field">
            <label htmlFor="lastName">Фамилия</label>
            <input id="lastName" name="lastName" autoComplete="family-name" />
          </div>
          <div className="field">
            <label htmlFor="firstName">Имя</label>
            <input id="firstName" name="firstName" autoComplete="given-name" />
          </div>
          <div className="field">
            <label htmlFor="phone">Номер телефона</label>
            <input id="phone" name="phone" autoComplete="tel" />
          </div>
          <div className="field">
            <label htmlFor="email">E-mail</label>
            <input id="email" name="email" type="email" autoComplete="email" />
          </div>
          <div className="field">
            <label htmlFor="course">Курс</label>
            <select id="course" name="course">
              {activeCourses.map((course) => (
                <option key={course.id}>{course.title}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="comment">Комментарий</label>
            <textarea id="comment" name="comment" />
          </div>
          <button className="button" type="button">
            <Send size={17} />
            Отправить заявку
          </button>
        </form>
      </section>
    </main>
  );
}
