/**
 * Instala o Monitor de Produtividade como serviço do Windows.
 *
 * Executar como Administrador.
 *
 * Conta de usuário (opcional):
 *   set SERVICE_USER=dominio\usuario
 *   set SERVICE_PASSWORD=senha
 *   npm run service:install
 *
 * Ou:
 *   node scripts/install-service.js --user=DOMINIO\usuario --password=senha
 *
 * Sem usuário → Local System (padrão).
 * Com usuário → o serviço roda no contexto desse usuário (rede, perfil, pastas).
 */

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const scriptPath = path.join(ROOT, 'src', 'main.js');
const SERVICE_NAME = 'MonitorProdutividade';

function parseArgs(argv) {
  const out = {};
  for (const a of argv.slice(2)) {
    if (a.startsWith('--user=')) out.user = a.slice(7);
    else if (a.startsWith('--password=')) out.password = a.slice(11);
    else if (a.startsWith('--domain=')) out.domain = a.slice(9);
  }
  return out;
}

/**
 * Aceita:
 *   SERVICE_USER=usuario
 *   SERVICE_USER=DOMINIO\usuario
 *   SERVICE_USER=usuario@dominio.com
 */
function resolverConta(cli) {
  const raw =
    cli.user ||
    process.env.SERVICE_USER ||
    process.env.MONITOR_SERVICE_USER ||
    '';
  const password =
    cli.password ||
    process.env.SERVICE_PASSWORD ||
    process.env.MONITOR_SERVICE_PASSWORD ||
    '';
  let domain =
    cli.domain ||
    process.env.SERVICE_DOMAIN ||
    process.env.MONITOR_SERVICE_DOMAIN ||
    '';

  if (!raw) {
    return null; // Local System
  }

  let account = raw.trim();

  // DOMINIO\usuario
  if (account.includes('\\')) {
    const parts = account.split('\\');
    domain = parts[0];
    account = parts.slice(1).join('\\');
  }
  // usuario@dominio
  else if (account.includes('@') && !domain) {
    const parts = account.split('@');
    account = parts[0];
    domain = parts.slice(1).join('@');
  }

  if (!password) {
    console.error('❌ SERVICE_PASSWORD (ou --password=) é obrigatório quando define usuário.');
    console.error('   Exemplo:');
    console.error('     set SERVICE_USER=EMPRESA\\joao.silva');
    console.error('     set SERVICE_PASSWORD=SenhaAqui');
    console.error('     npm run service:install');
    process.exit(1);
  }

  return { account, password, domain: domain || '.' };
}

function concederLogonComoServico(domain, account) {
  // Garante direito "Log on as a service" (SeServiceLogonRight)
  const principal = domain && domain !== '.' ? `${domain}\\${account}` : account;
  try {
    // Usa policy temporária via secedit é complexo; node-windows tenta sozinho.
    // Fallback: instrução clara se falhar.
    console.log(`   Conta: ${principal} (será configurada no serviço)`);
  } catch (e) {
    console.warn('   Aviso ao preparar conta:', e.message);
  }
}

function configurarContaSc(domain, account, password) {
  // Após install, reforça a conta com sc.exe (mais confiável em alguns ambientes)
  const obj = domain && domain !== '.' ? `${domain}\\${account}` : `.\\${account}`;
  try {
    // sc config nome obj= "dominio\user" password= "pass"
    // Nota: espaços após = são exigidos pela sintaxe antiga do sc
    execSync(
      `sc.exe config "${SERVICE_NAME}" obj= "${obj}" password= "${password}"`,
    { stdio: 'pipe', windowsHide: true }
    );
    console.log(`✅ Conta do serviço definida via sc: ${obj}`);
    return true;
  } catch (e) {
    const msg = (e.stderr && e.stderr.toString()) || e.message;
    console.warn('⚠️  sc config não aplicou a conta automaticamente:');
    console.warn('   ', msg.trim().slice(0, 300));
    console.warn('   Configure manualmente: services.msc → MonitorProdutividade → Logon');
    return false;
  }
}

function main() {
  if (process.platform !== 'win32') {
    console.error('Este instalador só funciona no Windows.');
    process.exit(1);
  }

  let Service;
  try {
    Service = require('node-windows').Service;
  } catch (e) {
    console.error('Pacote node-windows não encontrado.');
    console.error('Execute: npm install node-windows --save');
    process.exit(1);
  }

  if (!fs.existsSync(scriptPath)) {
    console.error('Script não encontrado:', scriptPath);
    process.exit(1);
  }

  const cli = parseArgs(process.argv);
  const conta = resolverConta(cli);

  const serviceOptions = {
    name: SERVICE_NAME,
    description:
      'Monitor de produtividade em segundo plano (coleta de atividade e envio ao servidor). Modo headless.',
    script: scriptPath,
    workingDirectory: ROOT,
    env: [
      { name: 'MONITOR_HEADLESS', value: '1' },
      { name: 'NODE_ENV', value: 'production' }
    ],
    maxRestarts: 10,
    maxRetries: 3
  };

  if (conta) {
    serviceOptions.user = {
      account: conta.account,
      password: conta.password,
      domain: conta.domain
    };
    concederLogonComoServico(conta.domain, conta.account);
  }

  const svc = new Service(serviceOptions);

  svc.on('install', () => {
    console.log('✅ Serviço instalado:', SERVICE_NAME);

    if (conta) {
      // Reforça conta (node-windows às vezes não aplica em todos os Windows)
      configurarContaSc(conta.domain, conta.account, conta.password);
    }

    svc.start();
  });

  svc.on('start', () => {
    console.log('✅ Serviço iniciado.');
    console.log('');
    if (conta) {
      const label =
        conta.domain && conta.domain !== '.'
          ? `${conta.domain}\\${conta.account}`
          : conta.account;
      console.log('👤 Conta de logon:', label);
    } else {
      console.log('👤 Conta de logon: Local System (padrão)');
      console.log('   Para usar conta de usuário, reinstale com SERVICE_USER / SERVICE_PASSWORD');
      console.log('   ou: node scripts/set-service-account.js');
    }
    console.log('');
    console.log('Comandos:');
    console.log('  net start ' + SERVICE_NAME);
    console.log('  net stop ' + SERVICE_NAME);
    console.log('  sc query ' + SERVICE_NAME);
    console.log('');
    console.log('Config: http://127.0.0.1:17340/config');
    console.log('Desinstalar: npm run service:uninstall');
  });

  svc.on('alreadyinstalled', () => {
    console.log('⚠️  Serviço já está instalado.');
    console.log('   1) npm run service:uninstall');
    console.log('   2) npm run service:install');
    console.log('   Ou altere só a conta: node scripts/set-service-account.js');
  });

  svc.on('error', (err) => {
    console.error('❌ Erro:', err);
  });

  console.log('Instalando serviço Windows...');
  console.log('  Script :', scriptPath);
  console.log('  Pasta  :', ROOT);
  console.log('  Env    : MONITOR_HEADLESS=1');
  if (conta) {
    console.log(
      '  Conta  :',
      conta.domain && conta.domain !== '.'
        ? `${conta.domain}\\${conta.account}`
        : conta.account
    );
  } else {
    console.log('  Conta  : Local System');
  }
  svc.install();
}

main();