const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Monitor de movimentação de pastas (Windows Security Log).
 * Eventos: 4663 (objeto), 4624 (logon), 4634 (logoff)
 *
 * O script PowerShell é gravado em arquivo temporário para evitar
 * "Linha de comando muito longa" do -EncodedCommand.
 */
function iniciarMonitorPastas({ config, logger, store }) {
  const cfg = config.pastas || {};
  const status = {
    habilitado: !!cfg.habilitado,
    plataformaOk: process.platform === 'win32',
    rodando: false,
    ultimaExecucao: null,
    ultimoErro: null,
    ultimoStdoutBytes: 0,
    eventosCapturadosTotal: 0,
    ultimaQtdBruta: 0,
    avisos: []
  };

  if (!cfg.habilitado) {
    status.avisos.push('Monitor de pastas desabilitado em config.pastas.habilitado');
    console.log('ℹ️  Monitor de pastas desabilitado');
    return { stop: () => {}, status: () => status, usuariosAtivos: new Map() };
  }

  if (process.platform !== 'win32') {
    status.avisos.push('Só funciona no Windows (Security Event Log)');
    console.warn('⚠️  Monitor de pastas só funciona no Windows (Security Event Log)');
    return { stop: () => {}, status: () => status, usuariosAtivos: new Map() };
  }

  const janela = cfg.janelaTempoSegundos || 30;
  const minutosOciosidade = cfg.minutosOciosidade || 15;
  const limiteCache = cfg.limiteCacheMemoria || 1000;
  const intervaloMs = cfg.intervaloChecagemMs || 10000;
  const regexIgnorados = cfg.regexArquivosIgnorados || '\\$|\\.tmp$|Desktop\\.ini|~\\$';

  const usuariosAtivos = new Map();
  const ultimosEventos = new Set();
  let errosSequenciais = 0;

  const scriptPath = path.join(os.tmpdir(), 'monitor-pastas-servidor.ps1');

  const scriptPowerShell = `
$ErrorActionPreference = 'Continue'
$startTime = (Get-Date).AddSeconds(-${Number(janela)})
$out = @{ ok = $true; erro = $null; quantidade = 0; eventos = @(); diagnostico = @{} }

try {
  $null = Get-WinEvent -FilterHashtable @{LogName='Security'; Id=4624; StartTime=(Get-Date).AddMinutes(-5)} -MaxEvents 1 -ErrorAction Stop
  $out.diagnostico.logSecurityOk = $true
} catch {
  $out.ok = $false
  $out.erro = "Sem acesso ao log Security: $($_.Exception.Message). Execute o servidor como Administrador."
  $out.diagnostico.logSecurityOk = $false
  $out | ConvertTo-Json -Compress -Depth 6
  exit 0
}

try {
  $events = @(Get-WinEvent -FilterHashtable @{LogName='Security'; Id=@(4663, 4624, 4634); StartTime=$startTime} -ErrorAction SilentlyContinue)
  $out.diagnostico.eventosBrutos = $events.Count

  $results = foreach ($event in $events) {
    try {
      $xml = [xml]$event.ToXml()
      $eventData = @($xml.Event.EventData.Data)

      function Get-Data([string]$name) {
        ($eventData | Where-Object { $_.Name -eq $name } | Select-Object -First 1).'#text'
      }

      $usuario = Get-Data 'SubjectUserName'
      $dominio = Get-Data 'SubjectDomainName'
      if ([string]::IsNullOrWhiteSpace($usuario)) { $usuario = Get-Data 'TargetUserName' }
      if ([string]::IsNullOrWhiteSpace($dominio)) { $dominio = Get-Data 'TargetDomainName' }
      if ([string]::IsNullOrWhiteSpace($usuario) -or $usuario.EndsWith('$')) { continue }

      $eventId = $event.Id
      $acao = 'OUTRO'
      $objectName = ''

      if ($eventId -eq 4624) {
        $logonType = Get-Data 'LogonType'
        if ($logonType -in @('2','3','7','10','11')) {
          $acao = if ($logonType -in @('3','10')) { 'LOGIN_REDE' } else { 'LOGIN_LOCAL' }
        } else { continue }
      }
      elseif ($eventId -eq 4634) {
        $acao = 'LOGOUT_REDE'
      }
      elseif ($eventId -eq 4663) {
        $rawMask = Get-Data 'AccessMask'
        $objectName = Get-Data 'ObjectName'
        if ([string]::IsNullOrWhiteSpace($objectName)) { continue }
        if ($objectName -match '${regexIgnorados.replace(/'/g, "''")}') { continue }

        $mask = [uint32]0
        if (-not [string]::IsNullOrWhiteSpace($rawMask)) {
          try {
            if ($rawMask -match '^0x') { $mask = [Convert]::ToUInt32($rawMask, 16) }
            else { $mask = [Convert]::ToUInt32($rawMask, 16) }
          } catch {
            try { $mask = [uint32]$rawMask } catch { $mask = [uint32]0 }
          }
        }

        $acao = 'ACESSO_PASTA'
        if (($mask -band 0x10000) -ne 0) { $acao = 'EXCLUSAO_REDE' }
        elseif (($mask -band 0x6) -ne 0) { $acao = 'MODIFICACAO_REDE' }
        elseif ((($mask -band 0x100) -ne 0) -or (($mask -band 0x2) -ne 0)) { $acao = 'CRIACAO_REDE' }
        elseif ((($mask -band 0x1) -ne 0) -or (($mask -band 0x20) -ne 0) -or (($mask -band 0x80) -ne 0)) { $acao = 'LEITURA_REDE' }
      }
      else { continue }

      [PSCustomObject]@{
        TimeCreated  = $event.TimeCreated.ToString('o')
        Usuario      = ($dominio + '\\' + $usuario)
        Acao         = $acao
        PastaArquivo = $objectName
        EventId      = $eventId
      }
    } catch { }
  }

  $lista = @($results)
  $out.quantidade = $lista.Count
  $out.eventos = $lista
} catch {
  $out.ok = $false
  $out.erro = $_.Exception.Message
}

$out | ConvertTo-Json -Compress -Depth 6
`;

  try {
    fs.writeFileSync(scriptPath, scriptPowerShell, 'utf8');
  } catch (e) {
    status.ultimoErro = 'Nao foi possivel gravar script temporario: ' + e.message;
    logger.error('[PASTAS] ' + status.ultimoErro);
    return { stop: () => {}, status: () => status, usuariosAtivos };
  }

  function checarOciosidade() {
    const agora = Date.now();
    const limiteMs = minutosOciosidade * 60 * 1000;

    for (const [usuario, dados] of usuariosAtivos.entries()) {
      const tempoInativoMs = agora - dados.ultimaAtividade;
      if (tempoInativoMs >= limiteMs && !dados.ociosoNotificado) {
        const minutos = Math.floor(tempoInativoMs / (1000 * 60));
        logger.info('[OCIOSO_SERVIDOR] ' + usuario + ' inativo na rede ha ' + minutos + ' min', {
          origem: 'SERVIDOR',
          acao: 'OCIOSO_REDE',
          usuario,
          tempoOciosoMinutos: minutos
        });
        store.gravarEventoPasta({
          acao: 'OCIOSO_REDE',
          usuario,
          dataHora: new Date().toISOString(),
          caminhoRede: null
        });
        dados.ociosoNotificado = true;
      }
    }
  }

  function processarEventos(lista) {
    let novos = 0;
    for (const evento of lista) {
      if (!evento || !evento.Usuario || String(evento.Usuario).endsWith('$')) continue;

      const chave = (evento.TimeCreated || '').substring(0, 19) + '-' + evento.Usuario + '-' + evento.Acao + '-' + (evento.PastaArquivo || '');
      if (ultimosEventos.has(chave)) continue;

      ultimosEventos.add(chave);
      if (ultimosEventos.size > limiteCache) {
        ultimosEventos.delete(ultimosEventos.values().next().value);
      }

      usuariosAtivos.set(evento.Usuario, {
        ultimaAtividade: Date.now(),
        ociosoNotificado: false
      });

      logger.info('[' + evento.Acao + '] ' + evento.Usuario + ' -> ' + (evento.PastaArquivo || 'Sessao'), {
        origem: 'SERVIDOR',
        fonte: 'SERVIDOR_PASTAS',
        acao: evento.Acao,
        usuario: evento.Usuario,
        caminhoRede: evento.PastaArquivo,
        dataHora: evento.TimeCreated,
        eventId: evento.EventId
      });

      store.gravarEventoPasta({
        acao: evento.Acao,
        usuario: evento.Usuario,
        caminhoRede: evento.PastaArquivo || null,
        dataHora: evento.TimeCreated
      });
      novos++;
      status.eventosCapturadosTotal++;
    }
    return novos;
  }

  function monitorar() {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      { maxBuffer: 1024 * 1024 * 20, windowsHide: true },
      (error, stdout, stderr) => {
        status.ultimaExecucao = new Date().toISOString();
        status.ultimoStdoutBytes = (stdout || '').length;

        if (error && !(stdout && stdout.trim())) {
          errosSequenciais++;
          status.ultimoErro = error.message;
          if (errosSequenciais <= 3 || errosSequenciais % 10 === 0) {
            logger.warn('[PASTAS] Falha ao executar PowerShell: ' + error.message, {
              origem: 'SERVIDOR_PASTAS',
              stderr: (stderr || '').slice(0, 400),
              errosSequenciais
            });
          }
          checarOciosidade();
          return;
        }

        if (!stdout || !stdout.trim()) {
          status.ultimoErro = null;
          checarOciosidade();
          return;
        }

        try {
          const texto = stdout.trim().replace(/^\uFEFF/, '');
          const jsonStart = texto.indexOf('{');
          const jsonText = jsonStart >= 0 ? texto.slice(jsonStart) : texto;
          const parsed = JSON.parse(jsonText);

          if (parsed.ok === false) {
            errosSequenciais++;
            status.ultimoErro = parsed.erro || 'erro desconhecido';
            status.avisos = [status.ultimoErro];
            if (errosSequenciais <= 3 || errosSequenciais % 10 === 0) {
              logger.warn('[PASTAS] ' + status.ultimoErro, {
                origem: 'SERVIDOR_PASTAS',
                diagnostico: parsed.diagnostico
              });
            }
            checarOciosidade();
            return;
          }

          errosSequenciais = 0;
          status.ultimoErro = null;
          status.avisos = [];

          const lista = Array.isArray(parsed.eventos)
            ? parsed.eventos
            : parsed.eventos
              ? [parsed.eventos]
              : [];

          status.ultimaQtdBruta = (parsed.diagnostico && parsed.diagnostico.eventosBrutos != null)
            ? parsed.diagnostico.eventosBrutos
            : lista.length;
          const novos = processarEventos(lista);

          if (novos > 0) {
            logger.info('[PASTAS] ' + novos + ' novo(s) evento(s) gravado(s)', {
              origem: 'SERVIDOR_PASTAS',
              brutos: status.ultimaQtdBruta,
              novos
            });
          }
        } catch (e) {
          status.ultimoErro = 'Parse JSON: ' + e.message;
          logger.warn('[PASTAS] Erro ao interpretar saida: ' + e.message, {
            origem: 'SERVIDOR_PASTAS',
            preview: (stdout || '').slice(0, 300)
          });
        }

        checarOciosidade();
      }
    );
  }

  const timer = setInterval(monitorar, intervaloMs);
  status.rodando = true;
  monitorar();

  console.log('Monitor de pastas iniciado (intervalo ' + intervaloMs + ' ms, janela ' + janela + 's)');
  console.log('   Script: ' + scriptPath);
  console.log('   Requer: Administrador + auditoria nas pastas compartilhadas');
  logger.info('[PASTAS] Monitor iniciado', {
    origem: 'SERVIDOR_PASTAS',
    intervaloMs,
    janelaSegundos: janela,
    scriptPath
  });

  return {
    stop: () => {
      clearInterval(timer);
      status.rodando = false;
      try {
        if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath);
      } catch (_) {}
    },
    status: () => Object.assign({}, status, { usuariosAtivos: usuariosAtivos.size, scriptPath }),
    usuariosAtivos
  };
}

module.exports = { iniciarMonitorPastas };