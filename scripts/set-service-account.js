/**
 * Define/altera a conta de logon do serviço já instalado.
 *
 * Admin:
 *   set SERVICE_USER=EMPRESA\joao.silva
 *   set SERVICE_PASSWORD=SenhaAqui
 *   node scripts/set-service-account.js
 *
 * Ou:
 *   node scripts/set-service-account.js --user=EMPRESA\joao.silva --password=Senha
 *
 * Voltar para Local System:
 *   node scripts/set-service-account.js --system
 */

const { execSync } = require('child_process');

const SERVICE_NAME = 'MonitorProdutividade';

function parseArgs(argv) {
  const out = { system: false };
  for (const a of argv.slice(2)) {
    if (a === '--system' || a === '--localsystem') out.system = true;
    else if (a.startsWith('--user=')) out.user = a.slice(7);
    else if (a.startsWith('--password=')) out.password = a.slice(11);
    else if (a.startsWith('--domain=')) out.domain = a.slice(9);
  }
  return out;
}

function parseUser(raw, domainHint) {
  let account = (raw || '').trim();
  let domain = domainHint || '';
  if (account.includes('\\')) {
    const p = account.split('\\');
    domain = p[0];
    account = p.slice(1).join('\\');
  } else if (account.includes('@') && !domain) {
    const p = account.split('@');
    account = p[0];
    domain = p.slice(1).join('@');
  }
  return { account, domain: domain || '.' };
}

function run(cmd) {
  return execSync(cmd, { encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
}

function main() {
  if (process.platform !== 'win32') {
    console.error('Só funciona no Windows.');
    process.exit(1);
  }

  const cli = parseArgs(process.argv);

  try {
    run(`sc.exe query "${SERVICE_NAME}"`);
  } catch {
    console.error(`Serviço "${SERVICE_NAME}" não encontrado. Instale antes: npm run service:install`);
    process.exit(1);
  }

  // Parar se estiver rodando
  try {
    run(`sc.exe stop "${SERVICE_NAME}"`);
    console.log('Serviço parado...');
  } catch {
    // já parado
  }

  if (cli.system) {
    try {
      run(`sc.exe config "${SERVICE_NAME}" obj= LocalSystem`);
      console.log('✅ Conta definida: Local System');
    } catch (e) {
      console.error('❌ Falha:', e.message);
      process.exit(1);
    }
  } else {
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
    const domainEnv =
      cli.domain ||
      process.env.SERVICE_DOMAIN ||
      process.env.MONITOR_SERVICE_DOMAIN ||
      '';

    if (!raw || !password) {
      console.error('Uso:');
      console.error('  set SERVICE_USER=DOMINIO\\usuario');
      console.error('  set SERVICE_PASSWORD=senha');
      console.error('  node scripts/set-service-account.js');
      console.error('');
      console.error('  node scripts/set-service-account.js --user=DOMINIO\\user --password=senha');
      console.error('  node scripts/set-service-account.js --system');
      process.exit(1);
    }

    const { account, domain } = parseUser(raw, domainEnv);
    const obj = domain && domain !== '.' ? `${domain}\\${account}` : `.\\${account}`;

    try {
      // Sintaxe sc: espaço após =
      run(`sc.exe config "${SERVICE_NAME}" obj= "${obj}" password= "${password}"`);
      console.log('✅ Conta definida:', obj);
    } catch (e) {
      const err = (e.stderr && e.stderr.toString()) || e.message;
      console.error('❌ sc config falhou:', err.trim().slice(0, 400));
      console.error('');
      console.error('Faça manualmente:');
      console.error('  1. services.msc');
      console.error('  2. MonitorProdutividade → Propriedades → Logon');
      console.error('  3. "Esta conta" → informe usuário e senha');
      console.error('  4. Conceda "Logon as a service" se o Windows pedir');
      process.exit(1);
    }
  }

  try {
    run(`sc.exe start "${SERVICE_NAME}"`);
    console.log('✅ Serviço iniciado.');
  } catch (e) {
    console.warn('⚠️  Não foi possível iniciar automaticamente.');
    console.warn('   Verifique a senha e o direito "Log on as a service".');
    console.warn('   net start ' + SERVICE_NAME);
  }

  console.log('');
  console.log('Consulta: sc qc ' + SERVICE_NAME);
}

main();