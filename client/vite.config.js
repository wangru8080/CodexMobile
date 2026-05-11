import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backendPort = env.PORT || '3321';
  const backendHttp = `http://127.0.0.1:${backendPort}`;
  const backendWs = `ws://127.0.0.1:${backendPort}`;

  return {
    root: 'client',
    plugins: [react()],
    build: {
      outDir: 'dist',
      emptyOutDir: true
    },
    server: {
      port: 5173,
      proxy: {
        '/api': backendHttp,
        '/generated': backendHttp,
        '/ws': {
          target: backendWs,
          ws: true
        }
      }
    }
  };
});
