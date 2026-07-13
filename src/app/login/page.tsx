import Link from "next/link";
import { LogIn } from "lucide-react";

export default function LoginPage() {
  return (
    <main className="page">
      <section className="section">
        <div>
          <span className="eyebrow">Закрытый доступ</span>
          <h1>Вход в платформу</h1>
          <p className="lead">
            Самостоятельной регистрации нет. Доступ выдает администратор после
            обработки заявки.
          </p>
        </div>
        <form className="form-panel">
          <div className="field">
            <label htmlFor="email">E-mail</label>
            <input id="email" name="email" type="email" autoComplete="email" />
          </div>
          <div className="field">
            <label htmlFor="password">Пароль</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
            />
          </div>
          <button className="button" type="button" disabled>
            <LogIn size={17} />
            Войти
          </button>
          <p className="muted">
            Форма неактивна: это mock-страница Next.js-каркаса. Рабочий вход —
            на <a href="http://127.0.0.1:3000/login">127.0.0.1:3000/login</a> после{" "}
            <code>npm run dev</code>.
          </p>
          <Link className="nav-link" href="/apply">
            Еще нет доступа? Оставить заявку
          </Link>
        </form>
      </section>
    </main>
  );
}
