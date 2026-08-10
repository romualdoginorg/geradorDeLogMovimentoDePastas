/**
 * Painel web de monitoramento – HTML + JS embutido.
 * Servido em GET /painel e GET /
 */
function gerarPainel() {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Painel – Monitor de Produtividade</title>
  <style>
    :root {
      --bg: #0b1220;
      --panel: #111827;
      --card: #1f2937;
      --border: #374151;
      --text: #e5e7eb;
      --muted: #9ca3af;
      --accent: #3b82f6;
      --ok: #22c55e;
      --warn: #f59e0b;
      --danger: #ef4444;
      --purple: #a78bfa;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", system-ui, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 22px;
      background: var(--panel);
      border-bottom: 1px solid var(--border);
      position: sticky;
      top: 0;
      z-index: 10;
      gap: 12px;
      flex-wrap: wrap;
    }
    header h1 {
      margin: 0;
      font-size: 1.15rem;
      font-weight: 600;
    }
    header .meta { color: var(--muted); font-size: 0.85rem; }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; }
    button, .btn {
      background: var(--card);
      border: 1px solid var(--border);
      color: var(--text);
      border-radius: 8px;
      padding: 7px 12px;
      cursor: pointer;
      font-size: 0.85rem;
    }
    button:hover, .btn:hover { border-color: var(--accent); color: #fff; }
    button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
    main { padding: 18px 22px 40px; max-width: 1400px; margin: 0 auto; }
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 12px;
      margin-bottom: 18px;
    }
    .card-stat {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 14px 16px;
    }
    .card-stat .label { color: var(--muted); font-size: 0.8rem; }
    .card-stat .value { font-size: 1.6rem; font-weight: 700; margin-top: 4px; }
    .card-stat .value.ok { color: var(--ok); }
    .card-stat .value.warn { color: var(--warn); }
    .layout {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
    }
    @media (max-width: 960px) {
      .layout { grid-template-columns: 1fr; }
    }
    .panel {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 12px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      min-height: 320px;
      max-height: 520px;
    }
    .panel.wide { grid-column: 1 / -1; max-height: 480px; }
    .panel-h {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      border-bottom: 1px solid var(--border);
      gap: 8px;
      flex-wrap: wrap;
    }
    .panel-h h2 { margin: 0; font-size: 0.95rem; }
    .panel-b { overflow: auto; flex: 1; }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.85rem;
    }
    th, td {
      text-align: left;
      padding: 8px 12px;
      border-bottom: 1px solid var(--border);
      vertical-align: top;
    }
    th {
      color: var(--muted);
      font-weight: 600;
      position: sticky;
      top: 0;
      background: var(--panel);
      z-index: 1;
    }
    tr:hover td { background: rgba(59, 130, 246, 0.06); }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 0.75rem;
      font-weight: 600;
    }
    .badge.online { background: rgba(34,197,94,.15); color: var(--ok); }
    .badge.offline { background: rgba(239,68,68,.15); color: var(--danger); }
    .badge.fonte-t { background: rgba(59,130,246,.15); color: #93c5fd; }
    .badge.fonte-s { background: rgba(167,139,250,.15); color: var(--purple); }
    .badge.evt { background: rgba(245,158,11,.12); color: var(--warn); }
    .filters {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: center;
    }
    input, select {
      background: var(--card);
      border: 1px solid var(--border);
      color: var(--text);
      border-radius: 8px;
      padding: 6px 10px;
      font-size: 0.85rem;
    }
    .muted { color: var(--muted); }
    .empty { padding: 24px; text-align: center; color: var(--muted); }
    .mono { font-family: ui-monospace, Consolas, monospace; font-size: 0.8rem; }
    .path { max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .token-bar {
      display: none;
      gap: 8px;
      align-items: center;
      padding: 8px 22px;
      background: #1e1b4b;
      border-bottom: 1px solid var(--border);
    }
    .token-bar.show { display: flex; }
    .token-bar input { flex: 1; max-width: 320px; }
    #statusDot {
      width: 8px; height: 8px; border-radius: 50%;
      display: inline-block; margin-right: 6px;
      background: var(--ok);
    }
    #statusDot.err { background: var(--danger); }
  </style>
</head>
<body>
  <header>
    <div>
      <h1><span id="statusDot"></span> Monitor de Produtividade</h1>
      <div class="meta" id="headerMeta">Carregando…</div>
    </div>
    <div class="actions">
      <button type="button" id="btnRefresh">Atualizar</button>
      <button type="button" id="btnToken">Token API</button>
      <button type="button" class="primary" id="btnAuto">Auto: ON</button>
    </div>
  </header>

  <div class="token-bar" id="tokenBar">
    <label class="muted">Authorization Bearer:</label>
    <input type="password" id="tokenInput" placeholder="token do servidor (se configurado)" />
    <button type="button" id="btnSaveToken">Salvar</button>
  </div>

  <main>
    <div class="cards" id="cards">
      <div class="card-stat"><div class="label">Máquinas</div><div class="value" id="sTotalM">—</div></div>
      <div class="card-stat"><div class="label">Online (&lt;45min)</div><div class="value ok" id="sOnline">—</div></div>
      <div class="card-stat"><div class="label">Usuários</div><div class="value" id="sUsers">—</div></div>
      <div class="card-stat"><div class="label">Pastas (monitor)</div><div class="value" style="font-size:1rem" id="sPastas">—</div></div>
      <div class="card-stat"><div class="label">Última atualização</div><div class="value" style="font-size:1rem" id="sTime">—</div></div>
    </div>

    <div id="pastasWarn" class="empty" style="display:none;text-align:left;background:#1e1b4b;border:1px solid #4c1d95;border-radius:12px;margin-bottom:14px;padding:12px 16px"></div>

    <div class="layout">
      <section class="panel">
        <div class="panel-h">
          <h2>Máquinas</h2>
          <input type="search" id="filtroMaquina" placeholder="Filtrar…" />
        </div>
        <div class="panel-b">
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>Nome</th>
                <th>Usuário</th>
                <th>IP</th>
                <th>Último contato</th>
              </tr>
            </thead>
            <tbody id="tbMaquinas"></tbody>
          </table>
          <div class="empty" id="emptyM" style="display:none">Nenhuma máquina registrada ainda.</div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-h">
          <h2>Usuários</h2>
          <input type="search" id="filtroUsuario" placeholder="Filtrar…" />
        </div>
        <div class="panel-b">
          <table>
            <thead>
              <tr>
                <th>Usuário</th>
                <th>Última máquina</th>
                <th>Último evento</th>
                <th>Eventos</th>
                <th>Atividade</th>
              </tr>
            </thead>
            <tbody id="tbUsuarios"></tbody>
          </table>
          <div class="empty" id="emptyU" style="display:none">Nenhum usuário registrado ainda.</div>
        </div>
      </section>

      <section class="panel wide">
        <div class="panel-h">
          <h2>Eventos recentes</h2>
          <div class="filters">
            <input type="date" id="filtroData" />
            <select id="filtroFonte">
              <option value="">Todas as fontes</option>
              <option value="TERMINAL">TERMINAL</option>
              <option value="SERVIDOR_PASTAS">SERVIDOR_PASTAS</option>
            </select>
            <input type="search" id="filtroEvtMaq" placeholder="Máquina" style="width:120px" />
            <input type="search" id="filtroEvtUser" placeholder="Usuário" style="width:140px" />
            <button type="button" id="btnFiltrarEvt">Filtrar</button>
          </div>
        </div>
        <div class="panel-b">
          <table>
            <thead>
              <tr>
                <th>Quando</th>
                <th>Fonte</th>
                <th>Evento</th>
                <th>Usuário</th>
                <th>Máquina</th>
                <th>Detalhe</th>
              </tr>
            </thead>
            <tbody id="tbEventos"></tbody>
          </table>
          <div class="empty" id="emptyE" style="display:none">Nenhum evento encontrado.</div>
        </div>
      </section>
    </div>
  </main>

  <script>
    const state = {
      token: localStorage.getItem('monitor_api_token') || '',
      auto: true,
      timer: null,
      maquinas: {},
      usuarios: {}
    };

    const $ = (id) => document.getElementById(id);

    function headers() {
      const h = { 'Accept': 'application/json' };
      if (state.token) h['Authorization'] = 'Bearer ' + state.token;
      return h;
    }

    async function api(path) {
      const res = await fetch(path, { headers: headers() });
      if (res.status === 401) throw new Error('Token inválido ou necessário');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }

    function fmtTime(iso) {
      if (!iso) return '—';
      try {
        const d = new Date(iso);
        return d.toLocaleString('pt-BR');
      } catch { return iso; }
    }

    function isOnline(ultimoContato) {
      if (!ultimoContato) return false;
      return (Date.now() - new Date(ultimoContato).getTime()) < 45 * 60 * 1000;
    }

    function relTime(iso) {
      if (!iso) return '—';
      const diff = Date.now() - new Date(iso).getTime();
      const m = Math.floor(diff / 60000);
      if (m < 1) return 'agora';
      if (m < 60) return m + ' min';
      const h = Math.floor(m / 60);
      if (h < 24) return h + ' h';
      return Math.floor(h / 24) + ' d';
    }

    function detalheEvento(ev) {
      if (ev.caminhoRede) return ev.caminhoRede;
      if (ev.programa) return (ev.programa + (ev.tituloJanela ? ' — ' + ev.tituloJanela : ''));
      if (ev.tempoPausaMinutos != null) return ev.tempoPausaMinutos + ' min ocioso';
      if (ev.motivoEnvio) return 'motivo: ' + ev.motivoEnvio;
      return '—';
    }

    function renderMaquinas() {
      const filtro = ($('filtroMaquina').value || '').toLowerCase();
      const lista = Object.values(state.maquinas).sort((a, b) =>
        (b.ultimoContato || '').localeCompare(a.ultimoContato || '')
      );
      const filtrada = lista.filter(m => {
        const t = (m.nome + ' ' + (m.usuarioCompleto || m.usuario || '') + ' ' + (m.ipPrincipal || '')).toLowerCase();
        return !filtro || t.includes(filtro);
      });
      const tb = $('tbMaquinas');
      tb.innerHTML = filtrada.map(m => {
        const on = isOnline(m.ultimoContato);
        return '<tr>' +
          '<td><span class="badge ' + (on ? 'online' : 'offline') + '">' + (on ? 'online' : 'offline') + '</span></td>' +
          '<td class="mono">' + esc(m.nome) + '</td>' +
          '<td>' + esc(m.usuarioCompleto || m.usuario || '—') + '</td>' +
          '<td class="mono">' + esc(m.ipPrincipal || '—') + '</td>' +
          '<td title="' + esc(fmtTime(m.ultimoContato)) + '">' + esc(relTime(m.ultimoContato)) + '</td>' +
          '</tr>';
      }).join('');
      $('emptyM').style.display = filtrada.length ? 'none' : 'block';
    }

    function renderUsuarios() {
      const filtro = ($('filtroUsuario').value || '').toLowerCase();
      const lista = Object.values(state.usuarios).sort((a, b) =>
        (b.ultimaAtividade || '').localeCompare(a.ultimaAtividade || '')
      );
      const filtrada = lista.filter(u => {
        const t = (u.usuario + ' ' + (u.ultimaMaquina || '')).toLowerCase();
        return !filtro || t.includes(filtro);
      });
      const tb = $('tbUsuarios');
      tb.innerHTML = filtrada.map(u => {
        return '<tr>' +
          '<td>' + esc(u.usuario) + '</td>' +
          '<td class="mono">' + esc(u.ultimaMaquina || '—') + '</td>' +
          '<td><span class="badge evt">' + esc(u.ultimoTipoEvento || '—') + '</span></td>' +
          '<td>' + (u.totalEventos || 0) + '</td>' +
          '<td title="' + esc(fmtTime(u.ultimaAtividade)) + '">' + esc(relTime(u.ultimaAtividade)) + '</td>' +
          '</tr>';
      }).join('');
      $('emptyU').style.display = filtrada.length ? 'none' : 'block';
    }

    function renderEventos(eventos) {
      const tb = $('tbEventos');
      if (!eventos || !eventos.length) {
        tb.innerHTML = '';
        $('emptyE').style.display = 'block';
        return;
      }
      $('emptyE').style.display = 'none';
      tb.innerHTML = eventos.map(ev => {
        const fonte = ev.fonte || '—';
        const fonteCls = fonte === 'SERVIDOR_PASTAS' ? 'fonte-s' : 'fonte-t';
        const quando = ev.dataHora || ev.recebidoEm || '';
        return '<tr>' +
          '<td title="' + esc(fmtTime(quando)) + '">' + esc(relTime(quando)) + '</td>' +
          '<td><span class="badge ' + fonteCls + '">' + esc(fonte) + '</span></td>' +
          '<td><span class="badge evt">' + esc(ev.evento || '—') + '</span></td>' +
          '<td>' + esc(ev.usuario || '—') + '</td>' +
          '<td class="mono">' + esc(ev.nomeMaquina || '—') + '</td>' +
          '<td class="path" title="' + esc(detalheEvento(ev)) + '">' + esc(detalheEvento(ev)) + '</td>' +
          '</tr>';
      }).join('');
    }

    function esc(s) {
      return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/"/g, '&quot;');
    }

    async function carregarEventos() {
      const params = new URLSearchParams();
      const data = $('filtroData').value;
      const fonte = $('filtroFonte').value;
      const maq = $('filtroEvtMaq').value.trim();
      const user = $('filtroEvtUser').value.trim();
      if (data) params.set('data', data);
      if (fonte) params.set('fonte', fonte);
      if (maq) params.set('nomeMaquina', maq);
      if (user) params.set('usuario', user);
      params.set('limite', '150');
      const q = params.toString();
      const dataEvt = await api('/api/eventos' + (q ? '?' + q : ''));
      renderEventos(dataEvt.eventos || []);
    }

    async function refresh() {
      try {
        const [resumo, maquinas, usuarios] = await Promise.all([
          api('/api/resumo'),
          api('/api/maquinas'),
          api('/api/usuarios')
        ]);
        $('statusDot').classList.remove('err');
        state.maquinas = maquinas.maquinas || {};
        state.usuarios = usuarios.usuarios || {};
        $('sTotalM').textContent = resumo.totalMaquinas ?? Object.keys(state.maquinas).length;
        $('sOnline').textContent = resumo.maquinasOnline ?? '—';
        $('sUsers').textContent = resumo.totalUsuarios ?? Object.keys(state.usuarios).length;
        $('sTime').textContent = new Date().toLocaleTimeString('pt-BR');
        $('headerMeta').textContent =
          'Servidor ok · ' + (resumo.timestamp ? fmtTime(resumo.timestamp) : '');

        // Status monitor de pastas
        let pastas = resumo.pastas;
        if (!pastas) {
          try {
            const ps = await api('/api/pastas/status');
            pastas = ps.pastas;
          } catch (_) {}
        }
        if (pastas) {
          const parts = [];
          if (!pastas.plataformaOk) parts.push('não-Windows');
          else if (!pastas.rodando) parts.push('parado');
          else parts.push('ativo');
          if (pastas.eventosCapturadosTotal != null) parts.push(pastas.eventosCapturadosTotal + ' evt');
          if (pastas.ultimoErro) parts.push('ERRO');
          $('sPastas').textContent = parts.join(' · ');
          $('sPastas').className = 'value' + (pastas.ultimoErro ? ' warn' : pastas.rodando ? ' ok' : '');
          const warn = $('pastasWarn');
          if (pastas.ultimoErro || (pastas.avisos && pastas.avisos.length)) {
            warn.style.display = 'block';
            warn.innerHTML = '<strong>Monitor de pastas:</strong> ' +
              esc(pastas.ultimoErro || (pastas.avisos || []).join(' | ')) +
              '<br><span class="muted">Dica: rode o servidor como Administrador e habilite auditoria nas pastas compartilhadas. Filtro do painel: fonte SERVIDOR_PASTAS.</span>';
          } else {
            warn.style.display = 'none';
          }
        }
        renderMaquinas();
        renderUsuarios();
        await carregarEventos();
      } catch (e) {
        $('statusDot').classList.add('err');
        $('headerMeta').textContent = 'Erro: ' + e.message;
      }
    }

    // UI bindings
    $('btnRefresh').onclick = refresh;
    $('btnFiltrarEvt').onclick = carregarEventos;
    $('filtroMaquina').oninput = renderMaquinas;
    $('filtroUsuario').oninput = renderUsuarios;

    $('btnToken').onclick = () => $('tokenBar').classList.toggle('show');
    $('tokenInput').value = state.token;
    $('btnSaveToken').onclick = () => {
      state.token = $('tokenInput').value.trim();
      localStorage.setItem('monitor_api_token', state.token);
      $('tokenBar').classList.remove('show');
      refresh();
    };

    $('btnAuto').onclick = () => {
      state.auto = !state.auto;
      $('btnAuto').textContent = 'Auto: ' + (state.auto ? 'ON' : 'OFF');
      if (state.auto) startAuto();
      else stopAuto();
    };

    function startAuto() {
      stopAuto();
      state.timer = setInterval(refresh, 10000);
    }
    function stopAuto() {
      if (state.timer) clearInterval(state.timer);
      state.timer = null;
    }

    // data padrão = hoje
    $('filtroData').value = new Date().toISOString().slice(0, 10);

    refresh();
    startAuto();
  </script>
</body>
</html>`;
}

module.exports = { gerarPainel };