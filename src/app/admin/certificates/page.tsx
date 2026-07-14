import { Award } from "lucide-react";

export default function AdminCertificatesPage() {
  return (
    <section className="section">
      <div>
        <span className="eyebrow">Certificates</span>
        <h1>Certificate management</h1>
        <p className="lead">
          A section for viewing, downloading, resending, and reissuing
          certificates after successful course completion.
        </p>
      </div>
      <article className="panel">
        <span className="metric-icon">
          <Award size={20} />
        </span>
        <h2>Certificate linkage</h2>
        <p className="muted">
          Each certificate is linked to a specific user, course, and assignment,
          and preserves a snapshot of the issued data.
        </p>
      </article>
    </section>
  );
}
