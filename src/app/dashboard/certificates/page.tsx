import { Award } from "lucide-react";

export default function StudentCertificatesPage() {
  return (
    <section className="section">
      <div>
        <span className="eyebrow">Certificates</span>
        <h1>My certificates</h1>
        <p className="lead">
          After a successful test, the certificate will appear here and be
          available to view or download.
        </p>
      </div>
      <article className="panel">
        <span className="metric-icon">
          <Award size={20} />
        </span>
        <h2>Vessel Fire Safety Annual Check</h2>
        <p className="muted">Certificate number: CERT-2026-0001</p>
        <p className="muted">Issue date: 2026-06-01</p>
      </article>
    </section>
  );
}
