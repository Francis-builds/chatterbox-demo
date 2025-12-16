import { NextRequest, NextResponse } from 'next/server';
import { checkModalHealth } from '@/lib/modal-client';

export const runtime = 'edge';

/**
 * Health check endpoint
 *
 * GET /api/health
 *
 * Returns the health status of the Vercel control plane and Modal backend.
 */
export async function GET(request: NextRequest) {
  const modalHealth = await checkModalHealth();

  const response = {
    status: modalHealth.status === 'healthy' ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    services: {
      vercel_control_plane: {
        status: 'healthy',
      },
      modal_tts_backend: modalHealth,
    },
  };

  const statusCode = modalHealth.status === 'healthy' ? 200 : 503;

  return NextResponse.json(response, { status: statusCode });
}
