import { demoAssignments } from "@/lib/mock-data";
import { getAssignmentStatusLabel } from "@/lib/status";

export default function StudentCoursesPage() {
  return (
    <section className="section">
      <div>
        <span className="eyebrow">Мои курсы</span>
        <h1>Назначенные курсы</h1>
        <p className="lead">
          Тест открывается только после прохождения обязательных материалов.
          Здесь уже заложена будущая логика статусов и прогресса.
        </p>
      </div>
      <div className="grid three">
        {demoAssignments.map((assignment) => (
          <article className="card" key={assignment.id}>
            <span
              className={`badge ${
                assignment.status === "completed" ? "success" : "warning"
              }`}
            >
              {getAssignmentStatusLabel(assignment.status)}
            </span>
            <h3>{assignment.courseTitle}</h3>
            <p className="muted">Назначен: {assignment.assignedAt}</p>
            <div className="progress-track">
              <div
                className="progress-bar"
                style={{ width: `${assignment.progressPercent}%` }}
              />
            </div>
            <p className="muted">
              Тест: {assignment.testAvailable ? "доступен" : "закрыт"}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
