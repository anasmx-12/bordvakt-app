// Liten versal rubrik, t.ex. "BORDSKARTA" och "ATT GÖRA NU"
export default function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h2 className="eyebrow">{children}</h2>;
}
