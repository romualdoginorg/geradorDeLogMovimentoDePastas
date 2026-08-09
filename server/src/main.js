const { carregarConfig, baseDir } = require('./config');
const { criarLogger } = require('./logger');
const { criarStore } = require('./store');
const { iniciarApi } = require('./api');
const { iniciarMonitorPastas } = require('./folder-monitor');

const config = carregarConfig();
const logger = criarLogger(config);
const store = criarStore(config);

logger.info('[BOOT] Servidor de gestão iniciando...', {
  origem: 'MAIN',
  baseDir,
  dataDir: store.dataDir
});

const apiServer = iniciarApi({ config, logger, store });
const monitorPastas = iniciarMonitorPastas({ config, logger, store });

console.log('🚀 Monitor Servidor iniciado!');
console.log(`📁 Dados em: ${store.dataDir}`);
console.log(`📊 ${JSON.stringify(store.resumo())}`);

process.on('SIGINT', () => {
  logger.info('[SIGINT] Encerrando servidor...');
  if (monitorPastas) monitorPastas.stop();
  if (apiServer) apiServer.close();
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  logger.error(`Uncaught: ${err.message}`, { stack: err.stack });
});

process.on('unhandledRejection', (reason) => {
  logger.error(`UnhandledRejection: ${reason}`);
});