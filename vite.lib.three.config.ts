import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist/lib',
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, 'src/three/index.ts'),
      name: 'ParticleBeastThree',
      fileName: 'particle-beast-three',
      formats: ['es', 'umd'],
    },
    rollupOptions: {
      external: ['three'],
      output: {
        globals: { three: 'THREE' },
      },
    },
  },
});
