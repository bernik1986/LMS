import { UserRound } from "lucide-react";

export default function StudentProfilePage() {
  return (
    <section className="section">
      <div>
        <span className="eyebrow">Profile</span>
        <h1>Personal details</h1>
        <p className="lead">
          Students can view the details that an administrator uses
          for training and certificates here.
        </p>
      </div>
      <article className="panel">
        <span className="metric-icon">
          <UserRound size={20} />
        </span>
        <h2>Alex Student</h2>
        <p className="muted">E-mail: student@example.com</p>
        <p className="muted">Status: active</p>
      </article>
    </section>
  );
}
