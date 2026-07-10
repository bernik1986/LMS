import type { Metadata } from "next";
import Link from "next/link";
import { LogIn, ShieldCheck } from "lucide-react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Marine LMS",
  description: "Закрытая морская учебная платформа с личным кабинетом и админ-панелью"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body>
        <div className="app-shell">
          <header className="topbar">
            <Link className="brand" href="/">
              <span className="brand-mark">M</span>
              <span>Marine LMS</span>
            </Link>
            <nav className="nav-links" aria-label="Основная навигация">
              <Link className="nav-link" href="/dashboard">
                Кабинет
              </Link>
              <Link className="nav-link" href="/admin">
                <ShieldCheck size={17} />
                Админ
              </Link>
              <Link className="button secondary" href="/login">
                <LogIn size={17} />
                Войти
              </Link>
            </nav>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
