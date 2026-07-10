import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { studentHighlights } from "@/lib/mock-data";

export default function StudentDashboardPage() {
  return (
    <section className="section">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Студент</span>
          <h1>Обзор обучения</h1>
          <p className="lead">
            Кабинет показывает назначенные курсы, прогресс, тесты и доступные
            сертификаты.
          </p>
        </div>
        <Link className="button" href="/dashboard/courses">
          Мои курсы
          <ArrowRight size={17} />
        </Link>
      </div>
      <div className="grid three">
        {studentHighlights.map((item) => {
          const Icon = item.icon;

          return (
            <article className="metric" key={item.label}>
              <div className="metric-top">
                <span className="muted">{item.label}</span>
                <span className="metric-icon">
                  <Icon size={20} />
                </span>
              </div>
              <strong className="metric-value">{item.value}</strong>
            </article>
          );
        })}
      </div>
    </section>
  );
}
