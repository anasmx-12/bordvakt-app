import { BRANDS } from '@/lib/cameras';
import { cameraEngine } from '@/lib/cameraEngine';
import { errorResponse, UserError } from '@/lib/server';

const IP = /^\d{1,3}(\.\d{1,3}){3}$/;

// POST /api/setup/cameras/connect { ip, username, password, brand?, onvif_url? }
// AI-datorn hittar kamerans videoadress(er) och skickar förhandsbild och placeringskoll.
// Sparar ingenting: det gör POST /api/setup/cameras när ägaren trycker på Spara.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const ip = typeof body?.ip === 'string' ? body.ip.trim() : '';
    const username = typeof body?.username === 'string' ? body.username.trim() : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    const brand = typeof body?.brand === 'string' && BRANDS.some((b) => b.id === body.brand) ? body.brand : null;
    const onvif = typeof body?.onvif_url === 'string' ? body.onvif_url.trim() : '';
    if (!IP.test(ip)) throw new UserError('Ogiltig IP-adress');
    if (!username || username.length > 64) throw new UserError('Skriv kamerans användarnamn');
    if (password.length > 128) throw new UserError('Lösenordet är för långt');
    if (onvif && (!onvif.startsWith('http://') || onvif.length > 300)) throw new UserError('Ogiltig ONVIF-adress');
    return await cameraEngine('/connect-camera', { ip, username, password, brand, onvif_url: onvif || null }, 120_000);
  } catch (err) {
    return errorResponse(err);
  }
}
