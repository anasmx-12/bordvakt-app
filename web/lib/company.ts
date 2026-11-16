// Företagsuppgifterna som står i villkoren, integritetspolicyn och PUB-avtalet.
// FYLL I innan publicering. Så länge något är tomt visas texterna som utkast.
export const COMPANY = {
  name: '', // t.ex. Bordvakt AB
  orgNr: '', // t.ex. 559xxx-xxxx
  address: '', // gatuadress, postnummer och ort
  email: '', // t.ex. hej@bordvakt.se
  /** Var databasen ligger (Supabase-projektets region), t.ex. "EU (Irland)" */
  dataRegion: 'EU (Irland, eu-west-1)',
  updated: '2026-11-06',
};

export const companyReady = () => Boolean(COMPANY.name && COMPANY.orgNr && COMPANY.address && COMPANY.email && COMPANY.dataRegion);
export const field = (value: string, label: string) => value || `[${label}]`;
