import type { IncomingMessage, ServerResponse } from 'node:http';

function pickPublicEnv(...keys: string[]): string {
  for (const key of keys) {
    const val = (process.env[key] || '').trim();
    if (val) return val;
  }
  return '';
}

export default function handler(
  _req: IncomingMessage,
  res: ServerResponse & { status?: (code: number) => any; json?: (body: unknown) => void }
) {
  const supabaseUrl = pickPublicEnv(
    'VITE_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_URL',
    'VITE_PUBLIC_SUPABASE_URL',
    'SUPABASE_URL'
  );
  const supabaseAnonKey = pickPublicEnv(
    'VITE_SUPABASE_ANON_KEY',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY',
    'VITE_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_ANON_KEY',
    'SUPABASE_PUBLISHABLE_KEY'
  );

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.statusCode = 200;
  res.end(
    JSON.stringify({
      supabaseUrl,
      supabaseAnonKey,
    })
  );
}
