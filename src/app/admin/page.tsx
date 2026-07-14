import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";
import { platformStats } from "@/lib/mock-data";

export default function AdminDashboardPage() {
  return (
    <section className="section">
      <div className="section-heading">
        <div>
          <span className="eyebrow">UI scaffold</span>
          <h1>Admin dashboard</h1>
          <p className="lead">
            A future admin panel layout using mock data. The live admin panel is in
            the standalone server after <code>npm run dev</code>.
          </p>
        </div>
        <div className="actions">
          <Link className="button" href="/admin/users">
            <Plus size={17} />
            Create user
          </Link>
          <Link className="button secondary" href="/admin/courses">
            Courses
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
        <h2>Where to access the live admin panel</h2>
        <p className="lead">
          Applications, users, courses, tests, and certificates already work in{" "}
          <code>scripts/lms-server.mjs</code>. Open{" "}
          <a href="http://127.0.0.1:3000/admin">127.0.0.1:3000/admin</a> after
          running <code>npm run dev</code>.
        </p>
      </article>
    </section>
  );
}
