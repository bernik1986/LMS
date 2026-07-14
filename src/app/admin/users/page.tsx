import { demoAssignments } from "@/lib/mock-data";
import { getAssignmentStatusLabel } from "@/lib/status";

export default function AdminUsersPage() {
  return (
    <section className="section">
      <div>
        <span className="eyebrow">Users</span>
        <h1>Profiles and learning history</h1>
        <p className="lead">
          A section scaffold for manually creating students, changing status,
          resetting passwords, and viewing progress.
        </p>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>Student</th><th>Course</th><th>Status</th><th>Progress</th><th>Test</th>
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
                    ? "Available"
                    : "Locked"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
