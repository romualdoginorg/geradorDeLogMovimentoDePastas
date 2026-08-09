const http = require('http');
const { obterMetadadosMaquina } = require('./machine');
const { gerarPaginaConfig } = require('./ui-config');

/**
 * Servidor HTTP local:
 *   - Tela de configuração (abrir / fechar / reabrir a qualquer momento)
 *   - Comando remoto para o servidor forçar envio
 *
 * Endpoints:
 *   GET  /config          → página HTML de configuração
 *   POST /config          → salva configuração
 *   GET  /health          → status + nome da máquina
 *   POST /enviar          → força envio imediato
 *   GET  /maquina         → metadados da máquina
 */
function iniciarServidorComando({ config, logger, onForcarEnvio, onSalvarConfig, getConfig }) {
  const cfg = config.comandoRemoto || {};
  // Sempre sobe o servidor local para a tela de config (no mínimo em 127.0.0.1)
  const host = cfg.host || '127.0.0.1';
  const port = cfg.port || 17340;
  const tokenEsperado = cfg.token || '';

  function autenticado(req, urlObj) {
    if (!tokenEsperado) return true;
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

  function html(res, status, body) {
    res.writeHead(status, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': Buffer.byteLength(body)
    });
    res.end(body);
  }

  function lerBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        try {
          const raw = Buffer.concat(chunks).toString('utf8');
          resolve(raw ? JSON.parse(raw) : {});
        } catch (e) {
          reject(e);
        }
      });
      req.on('error', reject);
    });
  }

  const server = http.createServer(async (req, res) => {
    const urlObj = new URL(req.url || '/', `http://${host}:${port}`);
    const pathname = urlObj.pathname;

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Token, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      // ---- Tela de configuração (pode fechar e reabrir) ----
      if (pathname === '/config' && req.method === 'GET') {
        const cfgAtual = typeof getConfig === 'function' ? getConfig() : config;
        const pagina = gerarPaginaConfig(cfgAtual, obterMetadadosMaquina());
        return html(res, 200, pagina);
      }

      if (pathname === '/config' && req.method === 'POST') {
        // Config só pela máquina local (sem exigir token se vier de 127.0.0.1)
        const remoto = req.socket.remoteAddress || '';
        const isLocal =
          remoto === '127.0.0.1' ||
          remoto === '::1' ||
          remoto === '::ffff:127.0.0.1';
        if (!isLocal && !autenticado(req, urlObj)) {
          return json(res, 401, { ok: false, erro: 'Token inválido' });
        }

        const body = await lerBody(req);
        if (typeof onSalvarConfig !== 'function') {
          return json(res, 500, { ok: false, erro: 'Handler de salvar não configurado' });
        }
        const resultado = onSalvarConfig(body);
        if (resultado?.ok) {
          logger?.info('[CONFIG] Configuração salva pela tela', {
            origem: 'UI_CONFIG',
            evento: 'CONFIG_SALVA'
          });
          return json(res, 200, { ok: true, mensagem: 'Configuração salva' });
        }
        return json(res, 400, { ok: false, erro: resultado?.erro || 'Falha ao salvar' });
      }

      // ---- Health ----
      if (pathname === '/health' || pathname === '/') {
        const maquina = obterMetadadosMaquina();
        return json(res, 200, {
          ok: true,
          servico: 'monitor-produtividade',
          nomeMaquina: maquina.nomeMaquina,
          usuario: maquina.usuarioCompleto,
          uptimeSegundos: maquina.uptimeSegundos,
          configUrl: `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}/config`,
          timestamp: new Date().toISOString()
        });
      }

      if (pathname === '/maquina') {
        if (!autenticado(req, urlObj)) {
          return json(res, 401, { ok: false, erro: 'Token inválido' });
        }
        return json(res, 200, { ok: true, maquina: obterMetadadosMaquina() });
      }

      if (pathname === '/enviar' && (req.method === 'POST' || req.method === 'GET')) {
        const remoto = req.socket.remoteAddress || '';
        const isLocal =
          remoto === '127.0.0.1' ||
          remoto === '::1' ||
          remoto === '::ffff:127.0.0.1';
        if (!isLocal && !autenticado(req, urlObj)) {
          logger?.warn('[COMANDO_REMOTO] Tentativa de envio sem token válido', {
            origem: 'COMANDO_REMOTO',
            ip: remoto
          });
          return json(res, 401, { ok: false, erro: 'Token inválido' });
        }

        logger?.info('[COMANDO_REMOTO] Solicitação de envio recebida', {
          origem: 'COMANDO_REMOTO',
          evento: 'FORCAR_ENVIO',
          ip: remoto,
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
        endpoints: ['/config', '/health', '/maquina', '/enviar']
      });
    } catch (e) {
      logger?.error(`[COMANDO_REMOTO] Erro: ${e.message}`);
      json(res, 500, { ok: false, erro: e.message });
    }
  });

  server.listen(port, host, () => {
    const urlConfig = `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}/config`;
    console.log(`📡 Servidor local em http://${host}:${port}`);
    console.log(`   ⚙  Configurações: ${urlConfig}`);
    console.log(`   📤 POST/GET /enviar  → força envio`);
    console.log(`   ❤  GET /health`);
    logger?.info('[COMANDO_REMOTO] Servidor local iniciado', {
      origem: 'COMANDO_REMOTO',
      host,
      port,
      urlConfig
    });
  });

  server.on('error', (err) => {
    console.error(`❌ Erro no servidor local: ${err.message}`);
    logger?.error(`[COMANDO_REMOTO] ${err.message}`);
  });

  return {
    server,
    port,
    host,
    urlConfig: `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}/config`
  };
}

module.exports = { iniciarServidorComando };