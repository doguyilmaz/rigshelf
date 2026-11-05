import { mkdir } from 'node:fs/promises';

const result = await Bun.build({
  entrypoints: ['design/library-preview.tsx'],
  target: 'browser',
  minify: true,
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [
    {
      name: 'isolate-preview-preferences',
      setup(build) {
        // The standalone comparison is English-only; do not duplicate the app's lazy locale asset.
        build.onLoad({ filter: /web\/locales\/tr\.json$/ }, () => ({
          loader: 'json',
          contents: '{}',
        }));
        build.onLoad({ filter: /web\/(?:library-preferences|i18n)\.ts$/ }, async (args) => ({
          loader: 'ts',
          contents: (await Bun.file(args.path).text())
            .replace('agent-setup.library.v1', 'agent-setup.library-preview.v1')
            .replace('agent-setup.language', 'agent-setup.library-preview.language')
            .replace(
              'filters: defaultLibraryFilters(),',
              "filters: { ...defaultLibraryFilters(), platforms: ['mobile'] },",
            ),
        }));
      },
    },
  ],
});
if (!result.success) throw new Error(result.logs.map(String).join('\n'));
const script = result.outputs.find((output) => output.path.endsWith('.js'));
const stylesheet = result.outputs.find((output) => output.path.endsWith('.css'));
if (!script || !stylesheet) throw new Error('Library preview is missing its script or stylesheet.');
const js = await script.text();
const css = (await stylesheet.text()).replace(/100d?vh/g, '1000px').replace(/8dvh/g, '64px');
const extra =
  'html,body{background:transparent!important;margin:0}body{font-size:13px}html::before{z-index:150}.preview-surface{background:#fff;border:1px solid #dedede;border-radius:10px;overflow:hidden}.preview-bar{display:flex;justify-content:space-between;align-items:center;gap:14px;border-bottom:1px solid #e7e7e7;padding:15px 22px;font-size:11px}.preview-bar span{color:#686868;font-size:10px}.preview-surface main{padding:24px}.preview-notice{position:fixed;bottom:15px;left:15px;right:15px;background:#fff;border:1px solid #ccc;padding:12px;z-index:1000;font-size:12px}.preview-notice button{margin-left:15px;text-decoration:underline}.preview-surface .page-header .button-row{gap:5px}.preview-surface .page-header .button{font-size:10px;padding:8px}.preview-surface .library-classification-note{font-size:11px}@media(max-width:500px){.preview-surface main{padding:17px}.preview-bar{padding:13px 17px;flex-wrap:wrap}}';
const head =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Library explorer — design preview</title>';
await mkdir('dist/prototypes', { recursive: true });
await mkdir('.local/qa', { recursive: true });
await Bun.write('dist/prototypes/library.js', js);
await Bun.write(
  'dist/prototypes/library.html',
  `${head}<style>${css}\n${extra}</style></head><body><div id="root"></div><script src="./library.js"></script></body></html>`,
);
await Bun.write(
  '.local/qa/library-preview.html',
  `${head}<style>${css}\n${extra}</style></head><body><div id="root"></div><script>
  (async()=>{const bytes=Uint8Array.from(atob('${Buffer.from(Bun.gzipSync(js)).toString('base64')}'),value=>value.charCodeAt(0));const code=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();const script=document.createElement('script');script.textContent=code;document.body.append(script);})().catch(error=>{document.getElementById('root').textContent='The preview could not load.';throw error;});
  </script></body></html>`,
);
