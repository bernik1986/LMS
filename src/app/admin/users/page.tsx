import { demoAssignments } from "@/lib/mock-data";
import { getAssignmentStatusLabel } from "@/lib/status";

export default function AdminUsersPage() {
  return (
    <section className="section">
      <div>
        <span className="eyebrow">Пользователи</span>
        <h1>Карточки и история обучения</h1>
        <p className="lead">
          Заготовка раздела для ручного создания студентов, смены статуса,
          сброса пароля и просмотра прогресса.
        </p>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>Студент</th>
            <th>Курс</th>
            <th>Статус</th>
            <th>Прогресс</th>
            <th>Тест</th>
          </tr>
        </thead>
        <tbody>
          {demoAssignments.map((assignment) => (
            <tr key={assignment.id}>
              <td>Alex Student</td>
              <td>{assignment.courseTitle}</td>
              <td>{getAssignmentStatusLabel(assignment.status)}</td>
              <td>
                <div className="progress-track">
                  <div
                    className="progress-bar"
                    style={{ width: `${assignment.progressPercent}%` }}
                  />
                </div>
              </td>
              <td>
                {assignment.testResult
                  ? `${assignment.testResult}%`
                  : assignment.testAvailable
                    ? "Доступен"
                    : "Закрыт"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
