import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import {cpSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
// @ts-ignore Build-time Babel plugin; UI text is localized without touching document content.
import localization from './scripts/i18n-plugin.mjs';
const pdfRoot=path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
const pdfAssets={name:'pdf-assets',closeBundle(){for(const folder of ['cmaps','standard_fonts','wasm'])cpSync(path.join(pdfRoot,folder),path.join('dist','pdf-assets',folder),{recursive:true});}};
export default defineConfig({ plugins: [react({babel:{plugins:[localization]}}),pdfAssets], base: './', build: { chunkSizeWarningLimit: 1500 } });
