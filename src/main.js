const path = require('path');
const { exec } = require('child_process');
const { carregarConfig, salvarConfig, baseDir } = require('./config');
const { criarLogger } = require('./logger');
const { coletarDados } = require('./collector');
const { adicionarAoBuffer, enviarEventos } = require('./sender');
const { criarTray } = require('./tray');
const { obterMetadadosMaquina } = require('./machine');
const { iniciarServidorComando } = require('./comando-remoto');

// ==============================================================================
// 🚀 INICIALIZAÇÃO
// ==============================================================================
let config = carregarConfig();
const logger = criarLogger(config);
const maquina = obterMetadadosMaquina();

let ociosoNotificado = false;
let bootRegistrado = false;
let programasEmUsoAnterior = new Set();
let intervaloMonitor = null;
let intervaloEnvio = null;
let trayInstance = null;
let servidorComando = null;
let monitorando = true;

logger.info('[BOOT] Monitor de produtividade iniciando...', {
  origem: 'MAIN',
  evento: 'BOOT',
  dataHora: new Date().toISOString(),
  baseDir,
  nomeMaquina: maquina.nomeMaquina,
  usuario: maquina.usuarioCompleto,
  ipPrincipal: maquina.ipPrincipal
});

/**
 * Wrapper de envio usado pelo tray, timer e comando remoto
 */
async function dispararEnvio(motivo = 'periodico') {
  const resultado = await enviarEventos(config.envio, logger, motivo);
  console.log(`[ENVIO:${motivo}] ${resultado.mensagem} (${resultado.enviados} eventos)`);
  return resultado;
}

// ==============================================================================
// 🟢 SYSTEM TRAY
// ==============================================================================
try {
  trayInstance = criarTray({
    config,
    onSair: async () => {
      logger.info('[SERVICO_ENCERRADO] Usuário encerrou pela bandeja', {
        origem: 'TRAY',
        evento: 'SERVICO_ENCERRADO',
        nomeMaquina: maquina.nomeMaquina,
        dataHora: new Date().toISOString()
      });

      if (config.envio?.enviarAoSair) {
        await dispararEnvio('ao_sair');
      }

      if (intervaloMonitor) clearInterval(intervaloMonitor);
      if (intervaloEnvio) clearInterval(intervaloEnvio);
      if (intervaloHeartbeat) clearInterval(intervaloHeartbeat);
      if (servidorComando?.server) {
        try {
          servidorComando.server.close();
        } catch (_) {}
      }
      trayInstance?.kill();
      process.exit(0);
    },
    onEnviarAgora: async () => {
      logger.info('[ENVIO_MANUAL] Solicitado envio manual', {
        origem: 'TRAY',
        nomeMaquina: maquina.nomeMaquina
      });
      await dispararEnvio('manual');
    },
    onAbrirLogs: () => {
      const logDir = path.join(baseDir, config.log?.diretorio || 'logs');
      exec(`explorer "${logDir}"`);
    },
    onTogglePausa: (pausado) => {
      monitorando = !pausado;
      logger.info(`[MONITOR] ${pausado ? 'Pausado' : 'Retomado'} pelo usuário`, {
        origem: 'TRAY',
        evento: pausado ? 'MONITOR_PAUSADO' : 'MONITOR_RETOMADO',
        nomeMaquina: maquina.nomeMaquina
      });
      trayInstance?.atualizarStatus(pausado ? 'Pausado' : 'Monitorando...');
    },
    onAbrirConfig: () => {
      const url =
        (servidorComando && servidorComando.urlConfig) ||
        `http://127.0.0.1:${config.comandoRemoto?.port || 17340}/config`;
      // Abre no navegador padrão (pode fechar e reabrir quando quiser)
      exec(`start "" "${url}"`, { windowsHide: true });
      logger.info('[CONFIG] Tela de configuração aberta', { origem: 'TRAY', url });
    }
  });
  console.log('✅ System tray iniciado');
} catch (err) {
  console.error('❌ Erro ao iniciar tray:', err.message);
  logger.error(`Erro ao iniciar tray: ${err.message}`);
}

// ==============================================================================
// 📡 COMANDO REMOTO (servidor força o envio)
// ==============================================================================
servidorComando = iniciarServidorComando({
  config,
  logger,
  onForcarEnvio: (motivo) => dispararEnvio(motivo || 'solicitacao_servidor'),
  getConfig: () => config,
  onSalvarConfig: (parcial) => {
    try {
      // merge superficial nas seções principais
      if (parcial.intervaloChecagemMs != null) config.intervaloChecagemMs = parcial.intervaloChecagemMs;
      if (parcial.minutosOciosidade != null) config.minutosOciosidade = parcial.minutosOciosidade;
      if (parcial.envio) config.envio = { ...(config.envio || {}), ...parcial.envio };
      if (parcial.comandoRemoto) config.comandoRemoto = { ...(config.comandoRemoto || {}), ...parcial.comandoRemoto };
      if (parcial.log) config.log = { ...(config.log || {}), ...parcial.log };
      const ok = salvarConfig(config);
      return ok ? { ok: true } : { ok: false, erro: 'Não foi possível gravar config.json' };
    } catch (e) {
      return { ok: false, erro: e.message };
    }
  }
});

const urlConfig =
  (servidorComando && servidorComando.urlConfig) ||
  `http://127.0.0.1:${config.comandoRemoto?.port || 17340}/config`;

// ==============================================================================
// 📊 LÓGICA DE MONITORAMENTO
// ==============================================================================
async function cicloMonitoramento() {
  if (!monitorando) return;

  const dados = await coletarDados();
  if (!dados) return;

  const usuario = dados.Usuario;
  const agora = new Date().toISOString();

  // --- Sessão iniciada (só uma vez) ---
  if (!bootRegistrado) {
    const evento = {
      origem: 'TERMINAL',
      evento: 'SESSAO_INICIADA',
      usuario,
      nomeMaquina: maquina.nomeMaquina,
      dataHoraBoot: dados.BootTime,
      dataHoraInicioMonitoramento: agora
    };
    logger.info(`[SESSAO_INICIADA] Terminal ativo para ${usuario} @ ${maquina.nomeMaquina}`, evento);
    adicionarAoBuffer(evento);
    bootRegistrado = true;
  }

  // --- Inatividade ---
  const tempoInativoMs = dados.InatividadeMs || 0;
  const minutosInativo = Math.floor(tempoInativoMs / (1000 * 60));
  const limiteMs = (config.minutosOciosidade || 10) * 60 * 1000;

  if (tempoInativoMs >= limiteMs) {
    if (!ociosoNotificado) {
      const evento = {
        origem: 'TERMINAL',
        evento: 'PAUSA_INATIVIDADE',
        usuario,
        nomeMaquina: maquina.nomeMaquina,
        tempoPausaMinutos: minutosInativo,
        dataHoraInicioPausa: new Date(Date.now() - tempoInativoMs).toISOString()
      };
      logger.info(`[PAUSA_INATIVIDADE] ${usuario} inativo há ${minutosInativo} min`, evento);
      adicionarAoBuffer(evento);
      ociosoNotificado = true;
      trayInstance?.atualizarStatus(`Ocioso (${minutosInativo} min)`);
    }
  } else {
    if (ociosoNotificado) {
      const evento = {
        origem: 'TERMINAL',
        evento: 'RETORNO_PAUSA',
        usuario,
        nomeMaquina: maquina.nomeMaquina,
        dataHora: agora
      };
      logger.info(`[RETORNO_PAUSA] ${usuario} voltou a interagir`, evento);
      adicionarAoBuffer(evento);
      ociosoNotificado = false;
      trayInstance?.atualizarStatus('Monitorando...');
    }
  }

  // --- Programas em uso ---
  if (dados.Processos) {
    const lista = Array.isArray(dados.Processos) ? dados.Processos : [dados.Processos];
    const programasAtuais = new Set();
    const ignorados = new Set((config.processosIgnorados || []).map((p) => p.toLowerCase()));

    lista.forEach((p) => {
      const nomeExe = `${p.ProcessName}.exe`.toLowerCase();
      if (ignorados.has(nomeExe)) return;

      programasAtuais.add(nomeExe);

      if (!programasEmUsoAnterior.has(nomeExe)) {
        const evento = {
          origem: 'TERMINAL',
          evento: 'USO_PROGRAMA',
          usuario,
          nomeMaquina: maquina.nomeMaquina,
          programa: `${p.ProcessName}.exe`,
          tituloJanela: p.MainWindowTitle,
          dataHora: agora
        };
        logger.info(
          `[PROGRAMA_EM_USO] ${usuario} abriu ${p.ProcessName}.exe - ${p.MainWindowTitle}`,
          evento
        );
        adicionarAoBuffer(evento);
      }
    });

    for (const prog of programasEmUsoAnterior) {
      if (!programasAtuais.has(prog)) {
        const evento = {
          origem: 'TERMINAL',
          evento: 'PROGRAMA_FECHADO',
          usuario,
          nomeMaquina: maquina.nomeMaquina,
          programa: prog,
          dataHora: agora
        };
        logger.info(`[PROGRAMA_FECHADO] ${usuario} fechou ${prog}`, evento);
        adicionarAoBuffer(evento);
      }
    }

    programasEmUsoAnterior = programasAtuais;
  }
}

// ==============================================================================
// ⏱️ TIMERS
// ==============================================================================
const intervaloMs = config.intervaloChecagemMs || 5000;
intervaloMonitor = setInterval(cicloMonitoramento, intervaloMs);
cicloMonitoramento();

let intervaloHeartbeat = null;

if (config.envio?.habilitado && config.envio?.intervaloEnvioMinutos > 0) {
  const msEnvio = config.envio.intervaloEnvioMinutos * 60 * 1000;
  intervaloEnvio = setInterval(() => {
    dispararEnvio('periodico');
  }, msEnvio);
  console.log(`📤 Envio automático a cada ${config.envio.intervaloEnvioMinutos} minutos`);
}

// Heartbeat: envia metadados da máquina mesmo sem eventos (para o servidor saber que está online)
if (config.envio?.habilitado && config.envio?.heartbeatMinutos > 0) {
  const msHb = config.envio.heartbeatMinutos * 60 * 1000;
  intervaloHeartbeat = setInterval(() => {
    dispararEnvio('heartbeat');
  }, msHb);
  console.log(`💓 Heartbeat a cada ${config.envio.heartbeatMinutos} minutos`);
}

// ==============================================================================
// 🛡️ TRATAMENTO DE SAÍDA
// ==============================================================================
process.on('SIGINT', async () => {
  logger.info('[SIGINT] Encerrando...');
  if (intervaloMonitor) clearInterval(intervaloMonitor);
  if (intervaloEnvio) clearInterval(intervaloEnvio);
  if (typeof intervaloHeartbeat !== 'undefined' && intervaloHeartbeat) clearInterval(intervaloHeartbeat);
  if (config.envio?.enviarAoSair) {
    await dispararEnvio('ao_sair');
  }
  if (servidorComando?.server) {
    try {
      servidorComando.server.close();
    } catch (_) {}
  }
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  logger.error(`Uncaught Exception: ${err.message}`, { stack: err.stack });
});

process.on('unhandledRejection', (reason) => {
  logger.error(`Unhandled Rejection: ${reason}`);
});

console.log('🚀 Monitor de produtividade iniciado!');
console.log(`💻 Máquina: ${maquina.nomeMaquina} | Usuário: ${maquina.usuarioCompleto}`);
console.log(`📁 Base: ${baseDir}`);
console.log(`⏱️  Intervalo de checagem: ${intervaloMs} ms`);
console.log(`💤 Ociosidade: ${config.minutosOciosidade} minutos`);
console.log(`📤 Envio: ${config.envio?.habilitado ? 'habilitado' : 'desabilitado'}`);
console.log(`⚙  Configurações: ${urlConfig || 'http://127.0.0.1:17340/config'}`);