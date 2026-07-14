export function ScaffoldNotice() {
  return (
    <div className="scaffold-notice" role="status">
      <p>
        <strong>This is a Next.js UI scaffold, not the live application.</strong> All functions
        are already implemented in the standalone server: run{" "}
        <code>npm run dev</code> and open{" "}
        <a href="http://127.0.0.1:3000">http://127.0.0.1:3000</a>. Pages in{" "}
        <code>src/app/</code> show mock data and are not connected to the database.
      </p>
    </div>
  );
}
