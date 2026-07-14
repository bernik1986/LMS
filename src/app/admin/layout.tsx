import Link from "next/link";
import {
  Award,
  BookOpen,
  ClipboardList,
  LayoutDashboard,
  UsersRound
} from "lucide-react";

export default function AdminLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="split-layout">
      <aside className="sidebar">
        <span className="eyebrow">Administration</span>
        <nav className="sidebar-nav" aria-label="Admin navigation">
          <Link href="/admin">
            <LayoutDashboard size={18} />
            Dashboard
          </Link>
          <Link href="/admin/applications">
            <ClipboardList size={18} />
            Applications
          </Link>
          <Link href="/admin/users">
            <UsersRound size={18} />
            Users
          </Link>
          <Link href="/admin/courses">
            <BookOpen size={18} />
            Courses
          </Link>
          <Link href="/admin/certificates">
            <Award size={18} />
            Certificates
          </Link>
        </nav>
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}
