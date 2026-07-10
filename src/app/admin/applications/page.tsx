import { ClipboardList } from "lucide-react";

export default function AdminApplicationsPage() {
  return (
    <section className="section">
      <div>
        <span className="eyebrow">Заявки</span>
        <h1>Обработка заявок на курс</h1>
        <p className="lead">
          В Sprint 2 форма заявки будет сохранять данные в базе, а здесь
          появятся статусы, заметки администратора и действие создания
          пользователя из заявки.
        </p>
      </div>
      <article className="panel">
        <span className="metric-icon">
          <ClipboardList size={20} />
        </span>
        <h2>Пока это рабочая заготовка</h2>
        <p className="muted">
          Сценарий уже закреплен в интерфейсе: заявка приходит администратору,
          но аккаунт автоматически не создается.
        </p>
      </article>
    </section>
  );
}
