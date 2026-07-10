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
        <span className="eyebrow">Админ-панель</span>
        <nav className="sidebar-nav" aria-label="Админская навигация">
          <Link href="/admin">
            <LayoutDashboard size={18} />
            Дашборд
          </Link>
          <Link href="/admin/applications">
            <ClipboardList size={18} />
            Заявки
          </Link>
          <Link href="/admin/users">
            <UsersRound size={18} />
            Пользователи
          </Link>
          <Link href="/admin/courses">
            <BookOpen size={18} />
            Курсы
          </Link>
          <Link href="/admin/certificates">
            <Award size={18} />
            Сертификаты
          </Link>
        </nav>
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}
