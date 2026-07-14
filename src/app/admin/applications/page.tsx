import { ClipboardList } from "lucide-react";

export default function AdminApplicationsPage() {
  return (
    <section className="section">
      <div>
        <span className="eyebrow">Applications</span>
        <h1>Course application processing</h1>
        <p className="lead">
          Mock page. In the live application, applications, statuses, and user
          creation are available at{" "}
          <a href="http://127.0.0.1:3000/admin/applications">
            127.0.0.1:3000/admin/applications
          </a>{" "}
          running <code>npm run dev</code>.
        </p>
      </div>
      <article className="panel">
        <span className="metric-icon">
          <ClipboardList size={20} />
        </span>
        <h2>Next.js scaffold mock page</h2>
        <p className="muted">
          The workflow is already represented in the interface: an application reaches an administrator,
          but an account is not created automatically.
        </p>
      </article>
    </section>
  );
}
