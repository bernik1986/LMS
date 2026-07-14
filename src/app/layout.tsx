import type { Metadata } from "next";
import Link from "next/link";
import { LogIn, ShieldCheck } from "lucide-react";
import { ScaffoldNotice } from "@/components/scaffold-notice";
import "./globals.css";

export const metadata: Metadata = {
  title: "Marine LMS",
  description: "Private maritime learning platform with student and admin accounts"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <div className="app-shell">
          <ScaffoldNotice />
          <header className="topbar">
            <Link className="brand" href="/">
              <span className="brand-mark">M</span>
              <span>Marine LMS</span>
            </Link>
            <nav className="nav-links" aria-label="Main navigation">
              <Link className="nav-link" href="/dashboard">
                My account
              </Link>
              <Link className="nav-link" href="/admin">
                <ShieldCheck size={17} />
                Admin
              </Link>
              <Link className="button secondary" href="/login">
                <LogIn size={17} />
                Sign in
              </Link>
            </nav>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
