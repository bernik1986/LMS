import { UserRound } from "lucide-react";

export default function StudentProfilePage() {
  return (
    <section className="section">
      <div>
        <span className="eyebrow">Профиль</span>
        <h1>Персональные данные</h1>
        <p className="lead">
          Здесь студент будет видеть данные, которые администратор использует
          для обучения и сертификатов.
        </p>
      </div>
      <article className="panel">
        <span className="metric-icon">
          <UserRound size={20} />
        </span>
        <h2>Alex Student</h2>
        <p className="muted">E-mail: student@example.com</p>
        <p className="muted">Статус: активный</p>
      </article>
    </section>
  );
}
