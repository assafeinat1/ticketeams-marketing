import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/trigger-ad-monitor': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/trigger-proactive-scan': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/trigger-rima-campaign': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
