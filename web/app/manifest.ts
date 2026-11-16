import type { MetadataRoute } from 'next';

// Gör att Bordvakt kan läggas på mobilens hemskärm (krävs för mobil-larm på iPhone)
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Bordvakt',
    short_name: 'Bordvakt',
    description: 'Realtidsassistent för restauranger',
    start_url: '/matsal',
    display: 'standalone',
    background_color: '#061B2B',
    theme_color: '#061B2B',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
