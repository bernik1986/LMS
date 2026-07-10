import { demoCourses } from "@/lib/mock-data";
import { getCourseStatusLabel } from "@/lib/status";

export default function AdminCoursesPage() {
  return (
    <section className="section">
      <div>
        <span className="eyebrow">Курсы</span>
        <h1>Управление курсами</h1>
        <p className="lead">
          Здесь появятся редактор курса, уроки, материалы, тест и настройки
          последовательного прохождения.
        </p>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>Курс</th>
            <th>Статус</th>
            <th>Уроки</th>
            <th>Обязательные материалы</th>
            <th>Назначения</th>
          </tr>
        </thead>
        <tbody>
          {demoCourses.map((course) => (
            <tr key={course.id}>
              <td>{course.title}</td>
              <td>
                <span
                  className={`badge ${course.status === "active" ? "success" : "warning"}`}
                >
                  {getCourseStatusLabel(course.status)}
                </span>
              </td>
              <td>{course.lessonsCount}</td>
              <td>{course.requiredMaterialsCount}</td>
              <td>{course.assignmentsCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
