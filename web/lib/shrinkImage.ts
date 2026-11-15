// Krymper foton i webbläsaren innan de laddas upp.
// Vercel tar emot högst 4,5 MB per anrop, och mobilfoton är ofta 3–6 MB styck.

/** Så mycket som skickas i ett anrop (lite marginal under Vercels 4,5 MB). */
export const UPLOAD_BUDGET = 4 * 1024 * 1024;

/** Gör om fotot till en JPEG med längsta sidan högst maxSide. */
export async function shrinkImage(file: Blob, maxSide = 1600, quality = 0.85): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/jpeg', quality)
    );
  } catch {
    // Webbläsaren kunde inte läsa bilden (t.ex. HEIC i Chrome)
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return file;
    throw new Error('Bildformatet stöds inte. Använd JPG eller PNG.');
  }
}

/** Krymper fotona tills de tillsammans ryms i ett anrop. */
export async function fitUnder(blobs: Blob[], budget = UPLOAD_BUDGET, maxSide = 1600): Promise<Blob[]> {
  let out = blobs;
  for (let side = maxSide, q = 0.8; total(out) > budget && side >= 640; side = Math.round(side * 0.8), q = Math.max(0.6, q - 0.05)) {
    out = await Promise.all(out.map((b) => shrinkImage(b, side, q)));
  }
  if (total(out) > budget) throw new Error('Fotona är för stora. Ta färre foton och försök igen.');
  return out;
}

/** Delar upp fotona i grupper som var och en ryms i ett anrop. */
export function batches(blobs: Blob[], budget = UPLOAD_BUDGET): Blob[][] {
  const groups: Blob[][] = [];
  let size = Infinity;
  for (const b of blobs) {
    if (size + b.size > budget) {
      groups.push([]);
      size = 0;
    }
    groups[groups.length - 1].push(b);
    size += b.size;
  }
  return groups;
}

const total = (blobs: Blob[]) => blobs.reduce((n, b) => n + b.size, 0);
