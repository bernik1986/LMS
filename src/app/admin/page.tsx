import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";
import { platformStats } from "@/lib/mock-data";

export default function AdminDashboardPage() {
  return (
    <section className="section">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Sprint 1</span>
          <h1>Админский дашборд</h1>
          <p className="lead">
            Рабочая зона администратора для заявок, пользователей, курсов,
            тестов и сертификатов.
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
        <h2>Что будет подключено дальше</h2>
        <p className="lead">
          В Sprint 2 эта зона получит авторизацию, реальные заявки из базы,
          ручное создание пользователей и защиту по роли администратора.
        </p>
      </article>
    </section>
  );
}
