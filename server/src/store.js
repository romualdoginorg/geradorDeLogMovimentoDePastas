const fs = require('fs');
const path = require('path');
const { baseDir } = require('./config');

/**
 * Armazenamento em arquivos JSON / JSONL.
 * Estrutura:
 *   data/maquinas.json          → registro de máquinas (última visão)
 *   data/usuarios.json          → registro de usuários
 *   data/eventos/YYYY-MM-DD.jsonl  → eventos de terminais + pastas
 */

function garantirDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function lerJson(arquivo, fallback) {
  try {
    if (!fs.existsSync(arquivo)) return fallback;
    return JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  } catch {
    return fallback;
  }
}

function gravarJson(arquivo, dados) {
  garantirDir(path.dirname(arquivo));
  fs.writeFileSync(arquivo, JSON.stringify(dados, null, 2), 'utf8');
}

function criarStore(config) {
  const dataDir = path.join(baseDir, config.armazenamento?.diretorio || 'data');
  const eventosDir = path.join(dataDir, 'eventos');
  const maquinasPath = path.join(dataDir, 'maquinas.json');
  const usuariosPath = path.join(dataDir, 'usuarios.json');

  garantirDir(eventosDir);

  function caminhoEventosHoje() {
    const dia = new Date().toISOString().slice(0, 10);
    return path.join(eventosDir, `${dia}.jsonl`);
  }

  function registrarMaquina(maquina, extra = {}) {
    if (!maquina?.nome) return;
    const todas = lerJson(maquinasPath, {});
    const anterior = todas[maquina.nome] || {};
    todas[maquina.nome] = {
      ...anterior,
      ...maquina,
      ...extra,
      ultimoContato: new Date().toISOString(),
      primeiroRegistro: anterior.primeiroRegistro || new Date().toISOString()
    };
    gravarJson(maquinasPath, todas);
    return todas[maquina.nome];
  }

  function registrarUsuario(usuarioCompleto, extra = {}) {
    if (!usuarioCompleto) return;
    const todos = lerJson(usuariosPath, {});
    const anterior = todos[usuarioCompleto] || {};
    todos[usuarioCompleto] = {
      ...anterior,
      usuario: usuarioCompleto,
      ...extra,
      ultimaAtividade: new Date().toISOString(),
      primeiroRegistro: anterior.primeiroRegistro || new Date().toISOString(),
      totalEventos: (anterior.totalEventos || 0) + (extra.incrementarEventos || 0)
    };
    delete todos[usuarioCompleto].incrementarEventos;
    gravarJson(usuariosPath, todos);
    return todos[usuarioCompleto];
  }

  function gravarEvento(evento) {
    const linha = JSON.stringify({
      ...evento,
      recebidoEm: new Date().toISOString()
    });
    fs.appendFileSync(caminhoEventosHoje(), linha + '\n', 'utf8');
  }

  function gravarLoteTerminal(payload) {
    const maquina = payload.maquina || {};
    registrarMaquina(maquina, {
      ultimoMotivoEnvio: payload.motivoEnvio,
      versaoApp: payload.versaoApp,
      quantidadeUltimoLote: payload.quantidade || 0
    });

    const eventos = Array.isArray(payload.eventos) ? payload.eventos : [];
    for (const ev of eventos) {
      const usuario = ev.usuario || maquina.usuarioCompleto || maquina.usuario;
      if (usuario) {
        registrarUsuario(usuario, {
          ultimaMaquina: maquina.nome,
          incrementarEventos: 1,
          ultimoTipoEvento: ev.evento
        });
      }
      gravarEvento({
        fonte: 'TERMINAL',
        nomeMaquina: maquina.nome,
        motivoEnvio: payload.motivoEnvio,
        ...ev
      });
    }

    // Heartbeat sem eventos ainda atualiza máquina
    if (eventos.length === 0 && maquina.nome) {
      gravarEvento({
        fonte: 'TERMINAL',
        evento: 'HEARTBEAT',
        nomeMaquina: maquina.nome,
        usuario: maquina.usuarioCompleto,
        motivoEnvio: payload.motivoEnvio
      });
    }

    return { maquina: maquina.nome, eventos: eventos.length };
  }

  function gravarEventoPasta(evento) {
    if (evento.usuario) {
      registrarUsuario(evento.usuario, {
        incrementarEventos: 1,
        ultimoTipoEvento: evento.acao,
        origemUltimaAtividade: 'SERVIDOR_PASTAS'
      });
    }
    gravarEvento({
      fonte: 'SERVIDOR_PASTAS',
      evento: evento.acao,
      usuario: evento.usuario,
      caminhoRede: evento.caminhoRede,
      dataHora: evento.dataHora
    });
  }

  function listarMaquinas() {
    return lerJson(maquinasPath, {});
  }

  function listarUsuarios() {
    return lerJson(usuariosPath, {});
  }

  function buscarEventos({ data, nomeMaquina, usuario, fonte, limite = 200 } = {}) {
    const dia = data || new Date().toISOString().slice(0, 10);
    const arquivo = path.join(eventosDir, `${dia}.jsonl`);
    if (!fs.existsSync(arquivo)) return [];

    const linhas = fs.readFileSync(arquivo, 'utf8').split('\n').filter(Boolean);
    const resultado = [];
    for (let i = linhas.length - 1; i >= 0 && resultado.length < limite; i--) {
      try {
        const ev = JSON.parse(linhas[i]);
        if (nomeMaquina && ev.nomeMaquina !== nomeMaquina) continue;
        if (usuario && ev.usuario !== usuario) continue;
        if (fonte && ev.fonte !== fonte) continue;
        resultado.push(ev);
      } catch {
        // ignore linha inválida
      }
    }
    return resultado;
  }

  function resumo() {
    const maquinas = listarMaquinas();
    const usuarios = listarUsuarios();
    const agora = Date.now();
    let online = 0;
    for (const m of Object.values(maquinas)) {
      if (m.ultimoContato) {
        const diff = agora - new Date(m.ultimoContato).getTime();
        if (diff < 45 * 60 * 1000) online++; // 45 min
      }
    }
    return {
      totalMaquinas: Object.keys(maquinas).length,
      maquinasOnline: online,
      totalUsuarios: Object.keys(usuarios).length,
      timestamp: new Date().toISOString()
    };
  }

  return {
    registrarMaquina,
    registrarUsuario,
    gravarLoteTerminal,
    gravarEventoPasta,
    listarMaquinas,
    listarUsuarios,
    buscarEventos,
    resumo,
    dataDir
  };
}

module.exports = { criarStore };