const fs = require('fs');
const path = require('path');

const root = __dirname;
const required = [
  'package.json',
  'backend/server.js',
  'backend/db.js',
  'backend/routes/integrations.js',
  'backend/routes/unified.js',
  'backend/integrations/index.js',
  'backend/integrations/mercadolivre/index.js',
  'backend/integrations/tiktok/index.js',
  'backend/integrations/shopee/index.js',
  'backend/services/syncService.js',
  'backend/services/normalization.js',
  'public/login.html',
  'public/dashboard.html'
];

const missingRequired = required.filter((file) => !fs.existsSync(path.join(root, file)));
if (missingRequired.length) {
  console.error('[deploy-check] Arquivos obrigatórios ausentes:');
  missingRequired.forEach((file) => console.error(` - ${file}`));
  process.exit(1);
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

function resolvesRelative(fromFile, request) {
  const base = path.resolve(path.dirname(fromFile), request);
  return [base, `${base}.js`, path.join(base, 'index.js')].some((candidate) => fs.existsSync(candidate));
}

const missingImports = [];
const requireRegex = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
for (const file of walk(root)) {
  const source = fs.readFileSync(file, 'utf8');
  let match;
  while ((match = requireRegex.exec(source))) {
    const request = match[1];
    if (request.startsWith('.') && !resolvesRelative(file, request)) {
      missingImports.push(`${path.relative(root, file)} -> ${request}`);
    }
  }
}

if (missingImports.length) {
  console.error('[deploy-check] Imports relativos apontam para arquivos inexistentes:');
  missingImports.forEach((item) => console.error(` - ${item}`));
  process.exit(1);
}

console.log('[deploy-check] Estrutura completa e imports relativos validados.');
