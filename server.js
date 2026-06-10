/* Minimal static server for Heroku. Serves the Vite build output. */
import express from 'express';
import compression from 'compression';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dist = join(__dirname, 'dist');
const app = express();

app.use(compression());
app.use(
  express.static(dist, {
    maxAge: '1h',
    setHeaders(res, path) {
      // Hashed assets can be cached aggressively
      if (/assets[\\/].+-[\w-]{8,}\./.test(path)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  })
);

app.use((req, res) => {
  res.status(404).sendFile(join(dist, 'index.html'));
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`ParticleBeast serving on :${port}`);
});
