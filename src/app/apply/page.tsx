import { Send } from "lucide-react";
import { demoCourses } from "@/lib/mock-data";

export default function ApplyPage() {
  const activeCourses = demoCourses.filter((course) => course.status === "active");

  return (
    <main className="page">
      <section className="section">
        <div>
          <span className="eyebrow">Course application</span>
          <h1>Apply for a course</h1>
          <p className="lead">
            Submitting this form does not create an account. An administrator
            will process the application and create a user when needed.
          </p>
        </div>
        <form className="form-panel">
          <div className="field">
            <label htmlFor="lastName">Last name</label>
            <input id="lastName" name="lastName" autoComplete="family-name" />
          </div>
          <div className="field">
            <label htmlFor="firstName">First name</label>
            <input id="firstName" name="firstName" autoComplete="given-name" />
          </div>
          <div className="field">
            <label htmlFor="phone">Phone number</label>
            <input id="phone" name="phone" autoComplete="tel" />
          </div>
          <div className="field">
            <label htmlFor="email">E-mail</label>
            <input id="email" name="email" type="email" autoComplete="email" />
          </div>
          <div className="field">
            <label htmlFor="course">Course</label>
            <select id="course" name="course">
              {activeCourses.map((course) => (
                <option key={course.id}>{course.title}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="comment">Comment</label>
            <textarea id="comment" name="comment" />
          </div>
          <button className="button" type="button" disabled>
            <Send size={17} />
            Send application
          </button>
          <p className="muted">
            This form is inactive: it is a mock page in the Next.js scaffold. The live application is
            at <a href="http://127.0.0.1:3000/apply">127.0.0.1:3000/apply</a> after{" "}
            <code>npm run dev</code>.
          </p>
        </form>
      </section>
    </main>
  );
}
