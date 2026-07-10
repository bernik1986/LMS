import { Award } from "lucide-react";

export default function StudentCertificatesPage() {
  return (
    <section className="section">
      <div>
        <span className="eyebrow">Сертификаты</span>
        <h1>Мои сертификаты</h1>
        <p className="lead">
          После успешного теста сертификат появится здесь и будет доступен для
          просмотра или скачивания.
        </p>
      </div>
      <article className="panel">
        <span className="metric-icon">
          <Award size={20} />
        </span>
        <h2>Vessel Fire Safety Annual Check</h2>
        <p className="muted">Номер сертификата: CERT-2026-0001</p>
        <p className="muted">Дата выдачи: 2026-06-01</p>
      </article>
    </section>
  );
}
