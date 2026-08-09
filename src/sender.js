const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { baseDir } = require('./config');
const { obterMetadadosAtualizados } = require('./machine');

const BUFFER_FILE = path.join(baseDir, 'logs', 'eventos-pendentes.jsonl');

/**
 * Adiciona um evento ao buffer local (arquivo JSONL)
 */
function adicionarAoBuffer(evento) {
  try {
    fs.mkdirSync(path.dirname(BUFFER_FILE), { recursive: true });
    fs.appendFileSync(BUFFER_FILE, JSON.stringify(evento) + '\n', 'utf8');
  } catch (e) {
    console.error('Erro ao gravar no buffer:', e.message);
  }
}

/**
 * Lê todos os eventos pendentes do buffer
 */
function lerBuffer() {
  try {
    if (!fs.existsSync(BUFFER_FILE)) return [];
    const conteudo = fs.readFileSync(BUFFER_FILE, 'utf8');
    return conteudo
      .split('\n')
      .filter(linha => linha.trim())
      .map(linha => {
        try {
          return JSON.parse(linha);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch (e) {
    console.error('Erro ao ler buffer:', e.message);
    return [];
  }
}

/**
 * Limpa o buffer após envio bem-sucedido
 */
function limparBuffer() {
  try {
    if (fs.existsSync(BUFFER_FILE)) {
      fs.writeFileSync(BUFFER_FILE, '', 'utf8');
    }
  } catch (e) {
    console.error('Erro ao limpar buffer:', e.message);
  }
}

/**
 * Monta o payload completo com metadados da máquina
 * para o servidor poder registrar, analisar e buscar depois.
 */
function montarPayload(eventos, motivo = 'periodico') {
  const maquina = obterMetadadosAtualizados();

  return {
    // Identificação do pacote
    schema: 'monitor-produtividade/v1',
    origem: 'monitor-produtividade',
    versaoApp: maquina.versaoApp || '1.0.0',
    motivoEnvio: motivo, // periodico | manual | ao_sair | solicitacao_servidor | heartbeat
    timestampEnvio: new Date().toISOString(),

    // === MÁQUINA (chave para busca e registro no servidor) ===
    maquina: {
      nome: maquina.nomeMaquina,
      nomeCompleto: maquina.nomeMaquinaCompleto,
      usuario: maquina.usuario,
      usuarioCompleto: maquina.usuarioCompleto,
      dominio: maquina.dominio,
      plataforma: maquina.plataforma,
      arquitetura: maquina.arquitetura,
      versaoSO: maquina.versaoSO,
      tipoSO: maquina.tipoSO,
      uptimeSegundos: maquina.uptimeSegundos,
      cpus: maquina.cpus,
      memoriaTotalMB: maquina.memoriaTotalMB,
      memoriaLivreMB: maquina.memoriaLivreMB,
      ipPrincipal: maquina.ipPrincipal,
      macPrincipal: maquina.macPrincipal,
      ips: maquina.ips,
      fabricante: maquina.fabricante,
      modelo: maquina.modelo,
      serialBios: maquina.serialBios,
      pid: maquina.pid,
      nodeVersion: maquina.nodeVersion,
      coletadoEm: maquina.coletadoEm
    },

    // Eventos de produtividade
    quantidade: eventos.length,
    eventos
  };
}

/**
 * Envia os eventos pendentes para o servidor configurado
 * @param {object} configEnvio - config.envio
 * @param {object} logger
 * @param {string} motivo - motivo do envio (para log e análise)
 * @returns {Promise<{sucesso: boolean, enviados: number, mensagem: string, payload?: object}>}
 */
async function enviarEventos(configEnvio, logger, motivo = 'periodico') {
  if (!configEnvio?.habilitado || !configEnvio?.url) {
    return { sucesso: false, enviados: 0, mensagem: 'Envio desabilitado ou URL não configurada' };
  }

  const eventos = lerBuffer();
  // Mesmo sem eventos, se for solicitação do servidor ou heartbeat, podemos enviar só metadados
  const permitirVazio =
    motivo === 'solicitacao_servidor' ||
    motivo === 'heartbeat' ||
    motivo === 'manual';

  if (eventos.length === 0 && !permitirVazio) {
    return { sucesso: true, enviados: 0, mensagem: 'Nenhum evento pendente' };
  }

  const payload = montarPayload(eventos, motivo);
  const maxTentativas = configEnvio.maxTentativas || 3;
  let ultimaErro = null;

  for (let tentativa = 1; tentativa <= maxTentativas; tentativa++) {
    try {
      const resultado = await postJson(configEnvio.url, payload, configEnvio.token);
      if (resultado.ok) {
        if (eventos.length > 0) limparBuffer();
        logger?.info(
          `[ENVIO] ${eventos.length} eventos enviados (${motivo}) – máquina: ${payload.maquina.nome}`,
          {
            origem: 'SENDER',
            evento: 'ENVIO_SUCESSO',
            quantidade: eventos.length,
            motivo,
            nomeMaquina: payload.maquina.nome,
            tentativa
          }
        );
        return {
          sucesso: true,
          enviados: eventos.length,
          mensagem: 'Enviado com sucesso',
          payload
        };
      }
      ultimaErro = resultado.erro || `HTTP ${resultado.status}`;
    } catch (e) {
      ultimaErro = e.message;
    }

    if (tentativa < maxTentativas) {
      await new Promise((r) => setTimeout(r, 2000 * tentativa));
    }
  }

  logger?.error(`[ENVIO] Falha após ${maxTentativas} tentativas: ${ultimaErro}`, {
    origem: 'SENDER',
    evento: 'ENVIO_FALHA',
    erro: ultimaErro,
    motivo,
    nomeMaquina: payload.maquina?.nome
  });

  return { sucesso: false, enviados: 0, mensagem: ultimaErro };
}

/**
 * POST JSON simples (sem dependências externas)
 */
function postJson(url, body, token) {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(url);
      const isHttps = parsed.protocol === 'https:';
      const lib = isHttps ? https : http;

      const data = JSON.stringify(body);
      const options = {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          'X-Monitor-Hostname': body.maquina?.nome || '',
          'X-Monitor-Version': body.versaoApp || '1.0.0',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        timeout: 20000
      };

      const req = lib.request(options, (res) => {
        let responseData = '';
        res.on('data', (chunk) => (responseData += chunk));
        res.on('end', () => {
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            body: responseData
          });
        });
      });

      req.on('error', (e) => resolve({ ok: false, erro: e.message }));
      req.on('timeout', () => {
        req.destroy();
        resolve({ ok: false, erro: 'Timeout' });
      });

      req.write(data);
      req.end();
    } catch (e) {
      resolve({ ok: false, erro: e.message });
    }
  });
}

module.exports = {
  adicionarAoBuffer,
  lerBuffer,
  limparBuffer,
  enviarEventos,
  montarPayload
};