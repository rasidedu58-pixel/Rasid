/**
 * Minimal status/health page proving apps/web builds and renders.
 * Not a product screen — Phase 0 is infrastructure only.
 */
export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2 p-8 text-center">
      <h1 className="text-2xl font-semibold">Academic Precision — Web is running</h1>
      <p className="text-slate-500">تأسيس الحزمة البرمجية — المرحلة صفر (Phase 0 foundation)</p>
    </main>
  );
}
