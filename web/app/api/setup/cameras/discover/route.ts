import { cameraEngine } from '@/lib/cameraEngine';
import { errorResponse } from '@/lib/server';

// POST /api/setup/cameras/discover — AI-datorn söker efter kameror i restaurangens nät (≈5–10 s)
export async function POST() {
  try {
    return await cameraEngine('/discover-cameras', {}, 25_000);
  } catch (err) {
    return errorResponse(err);
  }
}
