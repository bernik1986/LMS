import { demoAssignments } from "@/lib/mock-data";
import { getAssignmentStatusLabel } from "@/lib/status";

export default function StudentCoursesPage() {
  return (
    <section className="section">
      <div>
        <span className="eyebrow">My courses</span>
        <h1>Assigned courses</h1>
        <p className="lead">
          The test becomes available only after the required materials are completed.
          This page already models the future status and progress workflow.
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
            <p className="muted">Assigned: {assignment.assignedAt}</p>
            <div className="progress-track">
              <div
                className="progress-bar"
                style={{ width: `${assignment.progressPercent}%` }}
              />
            </div>
            <p className="muted">
              Test: {assignment.testAvailable ? "available" : "locked"}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
