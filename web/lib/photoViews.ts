// Fotona som AI:n ber om när den ska rita upp matsalen: ett från mitten av varje vägg
// och ett från varje hörn. Väggen med entrén ligger längst ned på kartan.
// Namnen (id) måste vara samma som VIEWS i local_ai.py.

export type PhotoViewId =
  | 'wall-entrance'
  | 'wall-right'
  | 'wall-far'
  | 'wall-left'
  | 'corner-entrance-right'
  | 'corner-far-right'
  | 'corner-far-left'
  | 'corner-entrance-left';

export interface PhotoView {
  id: PhotoViewId;
  title: string;
  instruction: string;
  /** Var fotografen står på kartan (0–1) och vart kameran pekar (grader, 0 = uppåt) */
  x: number;
  y: number;
  angle: number;
}

export const PHOTO_VIEWS: PhotoView[] = [
  {
    id: 'wall-entrance',
    title: 'Vägg 1 – entréväggen',
    instruction: 'Ställ dig mitt vid väggen där entrén är. Rikta kameran rakt in i matsalen.',
    x: 0.5,
    y: 1,
    angle: 0,
  },
  {
    id: 'corner-entrance-right',
    title: 'Hörn 1 – höger hörn vid entrén',
    instruction: 'Ställ dig i hörnet till höger om entrén. Rikta kameran snett mot mitten av rummet.',
    x: 1,
    y: 1,
    angle: -45,
  },
  {
    id: 'wall-right',
    title: 'Vägg 2 – högra väggen',
    instruction: 'Ställ dig mitt vid väggen till höger (sett från entrén). Rikta kameran tvärs över matsalen.',
    x: 1,
    y: 0.5,
    angle: -90,
  },
  {
    id: 'corner-far-right',
    title: 'Hörn 2 – bortre högra hörnet',
    instruction: 'Ställ dig i hörnet längst bort till höger. Rikta kameran snett mot mitten av rummet.',
    x: 1,
    y: 0,
    angle: -135,
  },
  {
    id: 'wall-far',
    title: 'Vägg 3 – bortre väggen',
    instruction: 'Ställ dig mitt vid väggen mittemot entrén. Rikta kameran tillbaka mot entrén.',
    x: 0.5,
    y: 0,
    angle: 180,
  },
  {
    id: 'corner-far-left',
    title: 'Hörn 3 – bortre vänstra hörnet',
    instruction: 'Ställ dig i hörnet längst bort till vänster. Rikta kameran snett mot mitten av rummet.',
    x: 0,
    y: 0,
    angle: 135,
  },
  {
    id: 'wall-left',
    title: 'Vägg 4 – vänstra väggen',
    instruction: 'Ställ dig mitt vid väggen till vänster (sett från entrén). Rikta kameran tvärs över matsalen.',
    x: 0,
    y: 0.5,
    angle: 90,
  },
  {
    id: 'corner-entrance-left',
    title: 'Hörn 4 – vänster hörn vid entrén',
    instruction: 'Ställ dig i hörnet till vänster om entrén. Rikta kameran snett mot mitten av rummet.',
    x: 0,
    y: 1,
    angle: 45,
  },
];
