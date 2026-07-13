import { ClipboardList } from "lucide-react";

export default function AdminApplicationsPage() {
  return (
    <section className="section">
      <div>
        <span className="eyebrow">Заявки</span>
        <h1>Обработка заявок на курс</h1>
        <p className="lead">
          Mock-страница. В рабочем приложении заявки, статусы и создание
          пользователя уже доступны на{" "}
          <a href="http://127.0.0.1:3000/admin/applications">
            127.0.0.1:3000/admin/applications
          </a>{" "}
          после <code>npm run dev</code>.
        </p>
      </div>
      <article className="panel">
        <span className="metric-icon">
          <ClipboardList size={20} />
        </span>
        <h2>Mock-страница Next.js-каркаса</h2>
        <p className="muted">
          Сценарий уже закреплен в интерфейсе: заявка приходит администратору,
          но аккаунт автоматически не создается.
        </p>
      </article>
    </section>
  );
}
