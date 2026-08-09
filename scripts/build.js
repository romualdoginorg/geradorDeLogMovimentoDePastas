/**
 * Script de build para gerar o .exe Windows
 * Uso: node scripts/build.js
 *
 * O que faz:
 * 1. Limpa a pasta dist/
 * 2. Garante que o binário do systray2 está disponível
 * 3. Empacota com pkg
 * 4. Copia assets, config e binário do tray para ao lado do .exe
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const EXE_NAME = 'monitor-produtividade.exe';

function log(msg) {
  console.log(`\n➤ ${msg}`);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    ensureDir(dest);
    for (const item of fs.readdirSync(src)) {
      copyRecursive(path.join(src, item), path.join(dest, item));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

function main() {
  console.log('========================================');
  console.log('  Build – Monitor de Produtividade');
  console.log('========================================');

  // 1. Limpar dist
  log('Limpando pasta dist/...');
  if (fs.existsSync(DIST)) {
    fs.rmSync(DIST, { recursive: true, force: true });
  }
  ensureDir(DIST);

  // 2. Verificar se pkg está instalado
  try {
    execSync('npx pkg --version', { stdio: 'pipe' });
  } catch {
    console.error('❌ pkg não encontrado. Execute: npm install');
    process.exit(1);
  }

  // 3. Empacotar
  log('Empacotando com pkg (pode demorar)...');
  try {
    execSync(
      `npx pkg . --targets node18-win-x64 --output "${path.join(DIST, EXE_NAME)}" --compress GZip`,
      {
        cwd: ROOT,
        stdio: 'inherit',
        env: { ...process.env }
      }
    );
  } catch (e) {
    console.error('❌ Falha no pkg. Veja o erro acima.');
    process.exit(1);
  }

  // 4. Copiar assets
  log('Copiando assets...');
  copyRecursive(path.join(ROOT, 'assets'), path.join(DIST, 'assets'));

  // 5. Copiar config (default + exemplo)
  log('Copiando configuração...');
  ensureDir(path.join(DIST, 'config'));
  const defaultCfg = path.join(ROOT, 'config', 'config.default.json');
  if (fs.existsSync(defaultCfg)) {
    fs.copyFileSync(defaultCfg, path.join(DIST, 'config', 'config.default.json'));
    // Cria um config.json inicial a partir do default (sem sobrescrever se já existir no futuro)
    fs.copyFileSync(defaultCfg, path.join(DIST, 'config', 'config.json'));
  }

  // 6. Copiar binário do systray2 para ao lado do .exe
  log('Copiando binário do systray2...');
  const trayBinName = 'tray_windows_release.exe';
  const possiveis = [
    path.join(ROOT, 'node_modules', 'systray2', 'traybin', trayBinName),
    path.join(ROOT, 'node_modules', 'systray2', 'traybin', 'windows', trayBinName),
    path.join(ROOT, trayBinName)
  ];

  let copiado = false;
  for (const origem of possiveis) {
    if (fs.existsSync(origem)) {
      fs.copyFileSync(origem, path.join(DIST, trayBinName));
      console.log(`   → ${trayBinName} copiado`);
      copiado = true;
      break;
    }
  }

  if (!copiado) {
    console.warn('⚠️  Binário tray_windows_release.exe não encontrado em node_modules.');
    console.warn('   O tray pode falhar. Rode "npm install" e tente novamente.');
    // Tenta listar o que existe
    const traybinDir = path.join(ROOT, 'node_modules', 'systray2', 'traybin');
    if (fs.existsSync(traybinDir)) {
      console.warn('   Conteúdo de traybin/:');
      console.warn('   ', fs.readdirSync(traybinDir).join(', ') || '(vazio)');
    }
  }

  // 7. Criar pasta logs vazia
  ensureDir(path.join(DIST, 'logs'));

  // 8. README de distribuição
  const readmeDist = `# Monitor de Produtividade

## Como usar

1. Execute \`${EXE_NAME}\`
2. O ícone aparece na bandeja do sistema (canto inferior direito)
3. Clique com o botão direito para ver o menu

## Configuração

Edite o arquivo \`config/config.json\` para alterar:
- Intervalo de checagem
- Minutos de ociosidade
- URL e token de envio
- Processos ignorados

## Logs

Os logs ficam em \`logs/\`.
Eventos pendentes de envio ficam em \`logs/eventos-pendentes.jsonl\`.

## Observação

Mantenha o arquivo \`${trayBinName}\` na mesma pasta do .exe.
`;

  fs.writeFileSync(path.join(DIST, 'LEIA-ME.txt'), readmeDist, 'utf8');

  // Resumo
  console.log('\n========================================');
  console.log('  Build concluído!');
  console.log('========================================');
  console.log(`\nArquivos em: ${DIST}\n`);

  const arquivos = fs.readdirSync(DIST);
  arquivos.forEach((f) => {
    const full = path.join(DIST, f);
    const stat = fs.statSync(full);
    const size = stat.isFile() ? ` (${(stat.size / 1024 / 1024).toFixed(1)} MB)` : '/';
    console.log(`  • ${f}${size}`);
  });

  console.log(`\nPara testar:  dist\\${EXE_NAME}`);
  console.log('');
}

main();