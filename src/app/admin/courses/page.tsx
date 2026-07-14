import { demoCourses } from "@/lib/mock-data";
import { getCourseStatusLabel } from "@/lib/status";

export default function AdminCoursesPage() {
  return (
    <section className="section">
      <div>
        <span className="eyebrow">Courses</span>
        <h1>Course management</h1>
        <p className="lead">
          This is where the course editor, lessons, materials, tests, and
          sequential learning settings will appear.
        </p>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>Course</th><th>Status</th><th>Lessons</th><th>Required materials</th><th>Assignments</th>
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
