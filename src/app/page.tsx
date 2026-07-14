import Link from "next/link";
import {
  Anchor,
  ArrowRight,
  ClipboardPenLine,
  LockKeyhole,
  Route
} from "lucide-react";
import { demoCourses } from "@/lib/mock-data";
import { getCourseStatusLabel } from "@/lib/status";

export default function HomePage() {
  return (
    <main className="home-page">
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">Marine training platform</span>
          <h1>Marine LMS for training, tests, and certificates</h1>
          <p className="lead">
            A private maritime learning platform where administrators create
            students, assign training, track progress, and issue certificates.
          </p>
          <div className="actions">
            <Link className="button" href="/apply">
              <ClipboardPenLine size={18} />
              Apply for a course
            </Link>
            <Link className="button secondary" href="/login">
              <LockKeyhole size={18} />
              Sign in to your account
            </Link>
          </div>
          <div className="hero-meta" aria-label="Key features">
            <div className="hero-meta-item">
              <strong>Manual access</strong>
              <span>no self-registration</span>
            </div>
            <div className="hero-meta-item">
              <strong>Course control</strong>
              <span>materials before the test</span>
            </div>
            <div className="hero-meta-item">
              <strong>Certificates</strong>
              <span>linked to student and course</span>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Core workflow</span>
            <h2>What the first release includes</h2>
          </div>
          <Link className="button secondary" href="/admin">
            Open admin panel
            <ArrowRight size={17} />
          </Link>
        </div>
        <div className="grid three">
          <article className="card">
            <span className="metric-icon">
              <Anchor size={20} />
            </span>
            <h3>Maritime specialization</h3>
            <p className="muted">
              The interface and structure are tailored for safety courses,
              crew training, and certification.
            </p>
          </article>
          <article className="card">
            <span className="metric-icon">
              <Route size={20} />
            </span>
            <h3>Materials before the test</h3>
            <p className="muted">
              The test becomes available after the required course materials are completed.
            </p>
          </article>
          <article className="card">
            <span className="metric-icon">
              <LockKeyhole size={20} />
            </span>
            <h3>Roles and private access</h3>
            <p className="muted">
              At least two roles are available: student and administrator, with
              separate interface areas and permissions.
            </p>
          </article>
        </div>
      </section>

      <section className="section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Demo courses</span>
            <h2>Catalogue foundation for course applications</h2>
          </div>
        </div>
        <div className="grid three">
          {demoCourses.map((course) => (
            <article className="card" key={course.id}>
              <span
                className={`badge ${course.status === "active" ? "success" : "warning"}`}
              >
                {getCourseStatusLabel(course.status)}
              </span>
              <h3>{course.title}</h3>
              <p className="muted">{course.shortDescription}</p>
              <p className="muted">
                {course.lessonsCount} lessons, {course.requiredMaterialsCount}{" "}
                required materials
              </p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
