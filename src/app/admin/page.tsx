import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";
import { platformStats } from "@/lib/mock-data";

export default function AdminDashboardPage() {
  return (
    <section className="section">
      <div className="section-heading">
        <div>
          <span className="eyebrow">UI-каркас</span>
          <h1>Админский дашборд</h1>
          <p className="lead">
            Макет будущей админ-панели на mock-данных. Рабочая админка — в
            standalone-сервере после <code>npm run dev</code>.
          </p>
        </div>
        <div className="actions">
          <Link className="button" href="/admin/users">
            <Plus size={17} />
            Создать пользователя
          </Link>
          <Link className="button secondary" href="/admin/courses">
            Курсы
            <ArrowRight size={17} />
          </Link>
        </div>
      </div>
      <div className="grid four">
        {platformStats.map((stat) => {
          const Icon = stat.icon;

          return (
            <article className="metric" key={stat.label}>
              <div className="metric-top">
                <span className="muted">{stat.label}</span>
                <span className="metric-icon">
                  <Icon size={20} />
                </span>
              </div>
              <strong className="metric-value">{stat.value}</strong>
              <span className="muted">{stat.hint}</span>
            </article>
          );
        })}
      </div>
      <article className="panel">
        <h2>Где смотреть реальную админку</h2>
        <p className="lead">
          Заявки, пользователи, курсы, тесты и сертификаты уже работают в{" "}
          <code>scripts/lms-server.mjs</code>. Откройте{" "}
          <a href="http://127.0.0.1:3000/admin">127.0.0.1:3000/admin</a> после
          запуска <code>npm run dev</code>.
        </p>
      </article>
    </section>
  );
}
