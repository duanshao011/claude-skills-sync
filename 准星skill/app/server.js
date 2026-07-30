import 'dotenv/config';
import app from './src/app.js';
import db from './src/db.js';

const port = Number(process.env.PORT || 3000);
const host = '127.0.0.1';
const server = app.listen(port, host, () => {
  console.log(`准星 running at http://${host}:${port}`);
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
