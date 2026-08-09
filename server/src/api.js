const http = require('http');
const { URL } = require('url');
const { gerarPainel } = require('./painel');

/**
 * API HTTP do servidor de gestão.
 *
 * POST /api/eventos          → recebe lote dos terminais (contrato monitor-produtividade/v1)
 * GET  /api/health           → healthcheck
 * GET  /api/resumo           → totais máquinas/usuários
 * GET  /api/maquinas         → lista máquinas
 * GET  /api/usuarios         → lista usuários
 * GET  /api/eventos?data=&nomeMaquina=&usuario=&fonte=&limite=
 */
function iniciarApi({ config, logger, store }) {
  const host = config.api?.host || '0.0.0.0';
  const port = config.api?.port || 3847;
  const tokenEsperado = config.api?.token || '';

  function autenticado(req) {
    if (!tokenEsperado) return true;
    const header = req.headers['authorization'] || req.headers['x-token'] || '';
    const bearer = header.startsWith('Bearer ') ? header.slice(7) : header;
    return bearer === tokenEsperado;
  }

  function json(res, status, body) {
    const data = JSON.stringify(body);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(data),
      'Access-Control-Allow-Origin': '*'
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
      let size = 0;
      const max = 20 * 1024 * 1024; // 20 MB
      req.on('data', (c) => {
        size += c.length;
        if (size > max) {
          reject(new Error('Payload muito grande'));
          req.destroy();
          return;
        }
        chunks.push(c);
      });
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
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Token, X-Monitor-Hostname'
      });
      res.end();
      return;
    }

    const urlObj = new URL(req.url || '/', `http://${host}:${port}`);
    const path = urlObj.pathname;

    try {
      // Painel web
      if ((path === '/' || path === '/painel') && req.method === 'GET') {
        return html(res, 200, gerarPainel());
      }

      // Health público
      if (path === '/api/health' || path === '/health') {
        return json(res, 200, {
          ok: true,
          servico: 'monitor-servidor',
          versao: '1.0.0',
          ...store.resumo(),
          timestamp: new Date().toISOString()
        });
      }

      if (!autenticado(req)) {
        return json(res, 401, { ok: false, erro: 'Token inválido' });
      }

      // Recebe lote dos terminais
      if (path === '/api/eventos' && req.method === 'POST') {
        const payload = await lerBody(req);

        if (!payload || typeof payload !== 'object') {
          return json(res, 400, { ok: false, erro: 'JSON inválido' });
        }

        const nome = payload.maquina?.nome || req.headers['x-monitor-hostname'] || 'desconhecida';
        const resultado = store.gravarLoteTerminal(payload);

        logger.info(
          `[LOTE] ${nome} enviou ${resultado.eventos} eventos (${payload.motivoEnvio || 'n/a'})`,
          {
            origem: 'API',
            evento: 'LOTE_RECEBIDO',
            nomeMaquina: nome,
            quantidade: resultado.eventos,
            motivo: payload.motivoEnvio,
            schema: payload.schema
          }
        );

        return json(res, 200, {
          ok: true,
          recebidos: resultado.eventos,
          nomeMaquina: resultado.maquina,
          mensagem: 'OK'
        });
      }

      if (path === '/api/resumo' && req.method === 'GET') {
        return json(res, 200, { ok: true, ...store.resumo() });
      }

      if (path === '/api/maquinas' && req.method === 'GET') {
        return json(res, 200, { ok: true, maquinas: store.listarMaquinas() });
      }

      if (path === '/api/usuarios' && req.method === 'GET') {
        return json(res, 200, { ok: true, usuarios: store.listarUsuarios() });
      }

      if (path === '/api/eventos' && req.method === 'GET') {
        const eventos = store.buscarEventos({
          data: urlObj.searchParams.get('data') || undefined,
          nomeMaquina: urlObj.searchParams.get('nomeMaquina') || undefined,
          usuario: urlObj.searchParams.get('usuario') || undefined,
          fonte: urlObj.searchParams.get('fonte') || undefined,
          limite: Number(urlObj.searchParams.get('limite') || 200)
        });
        return json(res, 200, { ok: true, quantidade: eventos.length, eventos });
      }

      json(res, 404, {
        ok: false,
        erro: 'Endpoint não encontrado',
        endpoints: [
          'POST /api/eventos',
          'GET /api/health',
          'GET /api/resumo',
          'GET /api/maquinas',
          'GET /api/usuarios',
          'GET /api/eventos'
        ]
      });
    } catch (e) {
      logger.error(`[API] ${e.message}`, { stack: e.stack });
      json(res, 500, { ok: false, erro: e.message });
    }
  });

  server.listen(port, host, () => {
    console.log(`🌐 API do servidor em http://${host}:${port}`);
    console.log(`   🖥  Painel: http://127.0.0.1:${port}/painel`);
    console.log(`   POST /api/eventos  ← terminais enviam aqui`);
    console.log(`   GET  /api/maquinas | /api/usuarios | /api/eventos | /api/resumo`);
    logger.info('[API] Servidor HTTP iniciado', { host, port });
  });

  server.on('error', (err) => {
    console.error(`❌ Erro na API: ${err.message}`);
    logger.error(`[API] ${err.message}`);
  });

  return server;
}

module.exports = { iniciarApi };