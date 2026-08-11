/**
 * Remove o serviço MonitorProdutividade do Windows.
 * Executar como Administrador: node scripts/uninstall-service.js
 */

const path = require('path');

function main() {
  if (process.platform !== 'win32') {
    console.error('Só funciona no Windows.');
    process.exit(1);
  }

  let Service;
  try {
    Service = require('node-windows').Service;
  } catch (e) {
    console.error('Pacote node-windows não encontrado. npm install node-windows --save');
    process.exit(1);
  }

  const ROOT = path.join(__dirname, '..');
  const svc = new Service({
    name: 'MonitorProdutividade',
    script: path.join(ROOT, 'src', 'main.js'),
    workingDirectory: ROOT
  });

  svc.on('uninstall', () => {
    console.log('✅ Serviço MonitorProdutividade removido.');
  });

  svc.on('alreadyuninstalled', () => {
    console.log('ℹ️  Serviço não estava instalado.');
  });

  svc.on('error', (err) => {
    console.error('❌ Erro:', err);
  });

  console.log('Parando e desinstalando serviço...');
  svc.uninstall();
}

main();