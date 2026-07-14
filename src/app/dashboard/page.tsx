import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { studentHighlights } from "@/lib/mock-data";

export default function StudentDashboardPage() {
  return (
    <section className="section">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Student</span>
          <h1>Learning overview</h1>
          <p className="lead">
            Your account shows assigned courses, progress, tests, and available
            certificates.
          </p>
        </div>
        <Link className="button" href="/dashboard/courses">
          My courses
          <ArrowRight size={17} />
        </Link>
      </div>
      <div className="grid three">
        {studentHighlights.map((item) => {
          const Icon = item.icon;

          return (
            <article className="metric" key={item.label}>
              <div className="metric-top">
                <span className="muted">{item.label}</span>
                <span className="metric-icon">
                  <Icon size={20} />
                </span>
              </div>
              <strong className="metric-value">{item.value}</strong>
            </article>
          );
        })}
      </div>
    </section>
  );
}
