import {readFile, writeFile} from 'node:fs/promises';

const [, , bundledScriptPath] = process.argv;

if (bundledScriptPath === undefined) {
    throw new TypeError('Pass the bundled prototype script path as the first argument.');
}

const bundledScript = await readFile(bundledScriptPath, 'utf8');
const safeBundledScript = bundledScript.replaceAll('</script', '<\\/script');
const outputUrl = new URL('./PROTOTYPE-public-interface.html', import.meta.url);

const html = `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Prototype: public HTML extractor interface</title>
</head>
<body>
    <div id="app"></div>
    <script>${safeBundledScript}</script>
</body>
</html>
`;

await writeFile(outputUrl, html, 'utf8');
