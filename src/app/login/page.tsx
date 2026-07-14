import Link from "next/link";
import { LogIn } from "lucide-react";

export default function LoginPage() {
  return (
    <main className="page">
      <section className="section">
        <div>
          <span className="eyebrow">Private access</span>
          <h1>Sign in to the platform</h1>
          <p className="lead">
            Self-registration is not available. An administrator grants access
            after processing an application.
          </p>
        </div>
        <form className="form-panel">
          <div className="field">
            <label htmlFor="email">E-mail</label>
            <input id="email" name="email" type="email" autoComplete="email" />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
            />
          </div>
          <button className="button" type="button" disabled>
            <LogIn size={17} />
            Sign in
          </button>
          <p className="muted">
            This form is inactive: it is a mock page in the Next.js scaffold. The live sign-in is
            at <a href="http://127.0.0.1:3000/login">127.0.0.1:3000/login</a> after{" "}
            <code>npm run dev</code>.
          </p>
          <Link className="nav-link" href="/apply">
            Need access? Submit an application
          </Link>
        </form>
      </section>
    </main>
  );
}
