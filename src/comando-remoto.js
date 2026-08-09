const http = require('http');
const { obterMetadadosMaquina } = require('./machine');

/**
 * Servidor HTTP local que permite ao servidor (ou admin) forçar o envio.
 *
 * Endpoints:
 *   GET  /health          → status + nome da máquina
 *   POST /enviar          → força envio imediato dos eventos pendentes
 *   GET  /enviar          → idem (para facilitar testes)
 *   GET  /maquina         → retorna metadados da máquina
 *
 * Segurança básica:
 *   - Escuta só em 127.0.0.1 por padrão (ou IP configurado)
 *   - Header opcional X-Token ou ?token= deve bater com config.comandoRemoto.token
 */
function iniciarServidorComando({ config, logger, onForcarEnvio }) {
  const cfg = config.comandoRemoto || {};
  if (!cfg.habilitado) {
    console.log('ℹ️  Comando remoto desabilitado (config.comandoRemoto.habilitado = false)');
    return null;
  }

  const host = cfg.host || '127.0.0.1';
  const port = cfg.port || 17340;
  const tokenEsperado = cfg.token || '';

  function autenticado(req, urlObj) {
    if (!tokenEsperado) return true; // sem token configurado = aberto (só use em rede confiável)
    const header = req.headers['x-token'] || req.headers['authorization'] || '';
    const bearer = header.startsWith('Bearer ') ? header.slice(7) : header;
    const queryToken = urlObj.searchParams.get('token') || '';
    return bearer === tokenEsperado || queryToken === tokenEsperado;
  }

  function json(res, status, body) {
    const data = JSON.stringify(body);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(data)
    });
    res.end(data);
  }

  const server = http.createServer(async (req, res) => {
    const urlObj = new URL(req.url || '/', `http://${host}:${port}`);
    const path = urlObj.pathname;

    // CORS simples (útil se o servidor chamar de outro host na mesma rede)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Token, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      if (path === '/health' || path === '/') {
        const maquina = obterMetadadosMaquina();
        return json(res, 200, {
          ok: true,
          servico: 'monitor-produtividade',
          nomeMaquina: maquina.nomeMaquina,
          usuario: maquina.usuarioCompleto,
          uptimeSegundos: maquina.uptimeSegundos,
          timestamp: new Date().toISOString()
        });
      }

      if (path === '/maquina') {
        if (!autenticado(req, urlObj)) {
          return json(res, 401, { ok: false, erro: 'Token inválido' });
        }
        return json(res, 200, {
          ok: true,
          maquina: obterMetadadosMaquina()
        });
      }

      if (path === '/enviar' && (req.method === 'POST' || req.method === 'GET')) {
        if (!autenticado(req, urlObj)) {
          logger?.warn('[COMANDO_REMOTO] Tentativa de envio sem token válido', {
            origem: 'COMANDO_REMOTO',
            ip: req.socket.remoteAddress
          });
          return json(res, 401, { ok: false, erro: 'Token inválido' });
        }

        logger?.info('[COMANDO_REMOTO] Solicitação de envio recebida', {
          origem: 'COMANDO_REMOTO',
          evento: 'FORCAR_ENVIO',
          ip: req.socket.remoteAddress,
          dataHora: new Date().toISOString()
        });

        if (typeof onForcarEnvio !== 'function') {
          return json(res, 500, { ok: false, erro: 'Handler de envio não configurado' });
        }

        const resultado = await onForcarEnvio('solicitacao_servidor');
        return json(res, resultado.sucesso ? 200 : 502, {
          ok: resultado.sucesso,
          enviados: resultado.enviados,
          mensagem: resultado.mensagem,
          nomeMaquina: obterMetadadosMaquina().nomeMaquina,
          timestamp: new Date().toISOString()
        });
      }

      json(res, 404, {
        ok: false,
        erro: 'Endpoint não encontrado',
        endpoints: ['/health', '/maquina', '/enviar']
      });
    } catch (e) {
      logger?.error(`[COMANDO_REMOTO] Erro: ${e.message}`);
      json(res, 500, { ok: false, erro: e.message });
    }
  });

  server.listen(port, host, () => {
    console.log(`📡 Comando remoto escutando em http://${host}:${port}`);
    console.log(`   POST/GET /enviar  → força envio`);
    console.log(`   GET /health       → status`);
    console.log(`   GET /maquina      → metadados`);
    logger?.info('[COMANDO_REMOTO] Servidor local iniciado', {
      origem: 'COMANDO_REMOTO',
      host,
      port
    });
  });

  server.on('error', (err) => {
    console.error(`❌ Erro no servidor de comando remoto: ${err.message}`);
    logger?.error(`[COMANDO_REMOTO] ${err.message}`);
  });

  return server;
}

module.exports = { iniciarServidorComando };