// Starts the local harness (see harness.mjs) and seeds it with real content.
//
//   node tests/media-feedback/serve.mjs [port] [path-to-unpacked-presentation]
import { createServer, setEnv } from './harness.mjs';
import { seedAll } from './seed.mjs';

setEnv();
const port = parseInt(process.argv[2], 10) || 8899;
const pkg = process.argv[3] || process.env.IDFL_TEST_PKG;
if (pkg) await seedAll(pkg);
createServer().listen(port, () => console.log('IDFL harness on http://localhost:' + port));
