// Visas medan sidan laddas (gästens mobil kan ha långsamt nät)
export default function Loading() {
  return <div className="min-h-dvh bg-paper" aria-busy="true" />;
}
