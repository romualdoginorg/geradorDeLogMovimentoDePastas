/**
 * Gera a página HTML de configuração.
 * Pode ser aberta, fechada e reaberta a qualquer momento pelo menu da bandeja.
 */
function gerarPaginaConfig(config, maquina) {
  const c = config || {};
  const envio = c.envio || {};
  const remoto = c.comandoRemoto || {};
  const log = c.log || {};

  const esc = (v) =>
    String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/"/g, '&quot;');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Configurações – Monitor de Produtividade</title>
  <style>
    :root {
      --bg: #0f172a;
      --card: #1e293b;
      --border: #334155;
      --text: #e2e8f0;
      --muted: #94a3b8;
      --accent: #3b82f6;
      --accent-hover: #2563eb;
      --ok: #22c55e;
      --warn: #f59e0b;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", system-ui, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      padding: 24px;
    }
    .wrap { max-width: 720px; margin: 0 auto; }
    h1 { font-size: 1.4rem; margin: 0 0 4px; }
    .sub { color: var(--muted); font-size: 0.9rem; margin-bottom: 20px; }
    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 18px 20px;
      margin-bottom: 16px;
    }
    .card h2 {
      font-size: 0.95rem;
      margin: 0 0 14px;
      color: var(--accent);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    label {
      display: block;
      font-size: 0.85rem;
      color: var(--muted);
      margin-bottom: 4px;
      margin-top: 12px;
    }
    label:first-of-type { margin-top: 0; }
    input[type="text"], input[type="number"], input[type="password"], select {
      width: 100%;
      padding: 9px 12px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: var(--bg);
      color: var(--text);
      font-size: 0.95rem;
    }
    input:focus, select:focus {
      outline: none;
      border-color: var(--accent);
    }
    .row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    .check {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 12px;
      font-size: 0.95rem;
    }
    .check input { width: auto; }
    .actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      margin-top: 8px;
    }
    button {
      border: none;
      border-radius: 8px;
      padding: 10px 18px;
      font-size: 0.95rem;
      cursor: pointer;
      font-weight: 600;
    }
    .btn-primary { background: var(--accent); color: #fff; }
    .btn-primary:hover { background: var(--accent-hover); }
    .btn-secondary { background: var(--border); color: var(--text); }
    .btn-secondary:hover { background: #475569; }
    .btn-danger { background: #7f1d1d; color: #fecaca; }
    .msg {
      margin-top: 12px;
      padding: 10px 14px;
      border-radius: 8px;
      display: none;
      font-size: 0.9rem;
    }
    .msg.ok { display: block; background: #14532d; color: #bbf7d0; }
    .msg.err { display: block; background: #7f1d1d; color: #fecaca; }
    .info-grid {
      display: grid;
      grid-template-columns: 120px 1fr;
      gap: 6px 12px;
      font-size: 0.9rem;
    }
    .info-grid span:nth-child(odd) { color: var(--muted); }
    .footer {
      text-align: center;
      color: var(--muted);
      font-size: 0.8rem;
      margin-top: 20px;
    }
    @media (max-width: 560px) {
      .row { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>⚙ Configurações</h1>
    <p class="sub">Monitor de Produtividade — feche esta aba quando quiser; reabra pelo ícone da bandeja.</p>

    <div class="card">
      <h2>Máquina</h2>
      <div class="info-grid">
        <span>Nome</span><span>${esc(maquina?.nomeMaquina)}</span>
        <span>Usuário</span><span>${esc(maquina?.usuarioCompleto)}</span>
        <span>IP</span><span>${esc(maquina?.ipPrincipal || '—')}</span>
        <span>SO</span><span>${esc(maquina?.tipoSO)} ${esc(maquina?.versaoSO)}</span>
      </div>
    </div>

    <form id="formConfig">
      <div class="card">
        <h2>Monitoramento</h2>
        <div class="row">
          <div>
            <label>Intervalo de checagem (ms)</label>
            <input type="number" name="intervaloChecagemMs" min="2000" step="1000"
              value="${esc(c.intervaloChecagemMs || 5000)}" />
          </div>
          <div>
            <label>Minutos para ociosidade</label>
            <input type="number" name="minutosOciosidade" min="1" max="240"
              value="${esc(c.minutosOciosidade || 10)}" />
          </div>
        </div>
      </div>

      <div class="card">
        <h2>Envio ao servidor</h2>
        <div class="check">
          <input type="checkbox" id="envioHabilitado" name="envioHabilitado"
            ${envio.habilitado ? 'checked' : ''} />
          <label for="envioHabilitado" style="margin:0">Envio habilitado</label>
        </div>
        <label>URL do servidor</label>
        <input type="text" name="envioUrl" placeholder="https://seu-servidor.com/api/eventos"
          value="${esc(envio.url || '')}" />
        <label>Token (Bearer)</label>
        <input type="password" name="envioToken" placeholder="opcional"
          value="${esc(envio.token || '')}" />
        <div class="row">
          <div>
            <label>Intervalo de envio (minutos)</label>
            <input type="number" name="intervaloEnvioMinutos" min="1"
              value="${esc(envio.intervaloEnvioMinutos || 15)}" />
          </div>
          <div>
            <label>Heartbeat (minutos, 0 = off)</label>
            <input type="number" name="heartbeatMinutos" min="0"
              value="${esc(envio.heartbeatMinutos ?? 30)}" />
          </div>
        </div>
        <div class="check">
          <input type="checkbox" id="enviarAoSair" name="enviarAoSair"
            ${envio.enviarAoSair !== false ? 'checked' : ''} />
          <label for="enviarAoSair" style="margin:0">Enviar ao sair</label>
        </div>
      </div>

      <div class="card">
        <h2>Comando remoto (forçar envio)</h2>
        <div class="check">
          <input type="checkbox" id="remotoHabilitado" name="remotoHabilitado"
            ${remoto.habilitado !== false ? 'checked' : ''} />
          <label for="remotoHabilitado" style="margin:0">Habilitado</label>
        </div>
        <div class="row">
          <div>
            <label>Host</label>
            <input type="text" name="remotoHost" value="${esc(remoto.host || '127.0.0.1')}" />
          </div>
          <div>
            <label>Porta</label>
            <input type="number" name="remotoPort" min="1024" max="65535"
              value="${esc(remoto.port || 17340)}" />
          </div>
        </div>
        <label>Token do comando remoto</label>
        <input type="password" name="remotoToken" placeholder="recomendado se host ≠ 127.0.0.1"
          value="${esc(remoto.token || '')}" />
      </div>

      <div class="card">
        <h2>Logs</h2>
        <div class="row">
          <div>
            <label>Nível</label>
            <select name="logNivel">
              <option value="info" ${log.nivel === 'info' || !log.nivel ? 'selected' : ''}>info</option>
              <option value="debug" ${log.nivel === 'debug' ? 'selected' : ''}>debug</option>
              <option value="warn" ${log.nivel === 'warn' ? 'selected' : ''}>warn</option>
              <option value="error" ${log.nivel === 'error' ? 'selected' : ''}>error</option>
            </select>
          </div>
          <div>
            <label>Retenção (ex: 14d)</label>
            <input type="text" name="logMaxArquivos" value="${esc(log.maxArquivos || '14d')}" />
          </div>
        </div>
      </div>

      <div class="actions">
        <button type="submit" class="btn-primary">Salvar configuração</button>
        <button type="button" class="btn-secondary" id="btnEnviar">Enviar dados agora</button>
        <button type="button" class="btn-secondary" id="btnFechar">Fechar esta janela</button>
      </div>
      <div id="msg" class="msg"></div>
    </form>

    <p class="footer">
      Alterações de host/porta do comando remoto exigem reiniciar o aplicativo.<br />
      Intervalos de envio/heartbeat passam a valer no próximo ciclo (ou após reinício).
    </p>
  </div>

  <script>
    const msg = document.getElementById('msg');
    function show(text, ok) {
      msg.textContent = text;
      msg.className = 'msg ' + (ok ? 'ok' : 'err');
    }

    document.getElementById('formConfig').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = {
        intervaloChecagemMs: Number(fd.get('intervaloChecagemMs')),
        minutosOciosidade: Number(fd.get('minutosOciosidade')),
        envio: {
          habilitado: document.getElementById('envioHabilitado').checked,
          url: fd.get('envioUrl'),
          token: fd.get('envioToken'),
          intervaloEnvioMinutos: Number(fd.get('intervaloEnvioMinutos')),
          heartbeatMinutos: Number(fd.get('heartbeatMinutos')),
          enviarAoSair: document.getElementById('enviarAoSair').checked,
          maxTentativas: 3
        },
        comandoRemoto: {
          habilitado: document.getElementById('remotoHabilitado').checked,
          host: fd.get('remotoHost'),
          port: Number(fd.get('remotoPort')),
          token: fd.get('remotoToken')
        },
        log: {
          nivel: fd.get('logNivel'),
          maxArquivos: fd.get('logMaxArquivos')
        }
      };

      try {
        const res = await fetch('/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const data = await res.json();
        if (data.ok) show('Configuração salva com sucesso.', true);
        else show(data.erro || 'Falha ao salvar', false);
      } catch (err) {
        show('Erro de rede: ' + err.message, false);
      }
    });

    document.getElementById('btnEnviar').addEventListener('click', async () => {
      try {
        const res = await fetch('/enviar', { method: 'POST' });
        const data = await res.json();
        show(data.mensagem || (data.ok ? 'Enviado' : 'Falha'), data.ok);
      } catch (err) {
        show('Erro: ' + err.message, false);
      }
    });

    document.getElementById('btnFechar').addEventListener('click', () => {
      window.close();
      // Se o browser bloquear window.close(), mostra aviso
      setTimeout(() => show('Pode fechar esta aba normalmente. Reabra pelo ícone da bandeja.', true), 300);
    });
  </script>
</body>
</html>`;
}

module.exports = { gerarPaginaConfig };