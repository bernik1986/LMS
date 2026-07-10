import { Award } from "lucide-react";

export default function AdminCertificatesPage() {
  return (
    <section className="section">
      <div>
        <span className="eyebrow">Сертификаты</span>
        <h1>Управление сертификатами</h1>
        <p className="lead">
          Раздел для просмотра, скачивания, повторной отправки и перевыпуска
          сертификатов после успешного завершения курса.
        </p>
      </div>
      <article className="panel">
        <span className="metric-icon">
          <Award size={20} />
        </span>
        <h2>Связь сертификата</h2>
        <p className="muted">
          Каждый сертификат будет связан с конкретным пользователем, курсом и
          назначением, а также сохранит снимок данных на момент выдачи.
        </p>
      </article>
    </section>
  );
}
