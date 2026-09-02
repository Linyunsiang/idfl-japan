// ESM view of the normaliser.
//
// The implementation lives in netlify/functions/_normalize.js because the
// functions runtime is CommonJS and the upload pipeline must use exactly the
// same code the offline tools do. Keeping one implementation is the point:
// a package built here and a package built by the server have to agree.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const impl = require(path.resolve(HERE, '../../netlify/functions/_normalize.js'));

export const LIMITS = impl.LIMITS;
export const extForMime = impl.extForMime;
export const findDataUris = impl.findDataUris;
export const splitBlocks = impl.splitBlocks;
export const normalize = impl.normalize;
export const needsNormalizing = impl.needsNormalizing;
