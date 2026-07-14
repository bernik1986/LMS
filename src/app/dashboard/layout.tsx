import Link from "next/link";
import { Award, BookOpenCheck, LayoutDashboard, UserRound } from "lucide-react";

export default function DashboardLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="split-layout">
      <aside className="sidebar">
        <span className="eyebrow">My account</span>
        <nav className="sidebar-nav" aria-label="Account navigation">
          <Link href="/dashboard">
            <LayoutDashboard size={18} />
            Overview
          </Link>
          <Link href="/dashboard/courses">
            <BookOpenCheck size={18} />
            My courses
          </Link>
          <Link href="/dashboard/profile">
            <UserRound size={18} />
            Profile
          </Link>
          <Link href="/dashboard/certificates">
            <Award size={18} />
            Certificates
          </Link>
        </nav>
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}
