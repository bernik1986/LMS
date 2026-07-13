export function ScaffoldNotice() {
  return (
    <div className="scaffold-notice" role="status">
      <p>
        <strong>Это UI-каркас Next.js, не рабочее приложение.</strong> Все функции
        уже реализованы в standalone-сервере: запустите{" "}
        <code>npm run dev</code> и откройте{" "}
        <a href="http://127.0.0.1:3000">http://127.0.0.1:3000</a>. Страницы в{" "}
        <code>src/app/</code> показывают mock-данные и не связаны с базой.
      </p>
    </div>
  );
}
