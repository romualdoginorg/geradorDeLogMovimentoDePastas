const { exec } = require('child_process');

/**
 * Monitor de movimentação de pastas no servidor Windows.
 * Baseado em eventos de Segurança:
 *   4663 – acesso a objeto (arquivo/pasta)
 *   4624 – logon
 *   4634 – logoff
 *
 * Requer: auditoria de acesso a objetos habilitada nas pastas compartilhadas.
 */
function iniciarMonitorPastas({ config, logger, store }) {
  const cfg = config.pastas || {};
  if (!cfg.habilitado) {
    console.log('ℹ️  Monitor de pastas desabilitado');
    return null;
  }

  if (process.platform !== 'win32') {
    console.warn('⚠️  Monitor de pastas só funciona no Windows (Security Event Log)');
    return null;
  }

  const janela = cfg.janelaTempoSegundos || 15;
  const regexIgnorados = cfg.regexArquivosIgnorados || '\\$|\\.tmp$|Desktop\\.ini|~\\$';
  const minutosOciosidade = cfg.minutosOciosidade || 15;
  const limiteCache = cfg.limiteCacheMemoria || 1000;
  const intervaloMs = cfg.intervaloChecagemMs || 10000;

  const usuariosAtivos = new Map();
  const ultimosEventos = new Set();

  const scriptPowerShell = `
$startTime = (Get-Date).AddSeconds(-${janela})
$events = Get-WinEvent -FilterHashtable @{LogName='Security'; Id=@(4663, 4624, 4634); StartTime=$startTime} -ErrorAction SilentlyContinue

if ($events) {
    $results = foreach ($event in $events) {
        $xml = [xml]$event.ToXml()
        $eventData = $xml.Event.EventData.Data

        $usuario = ($eventData | Where-Object {$_.Name -eq 'SubjectUserName'}).'#text'
        $dominio = ($eventData | Where-Object {$_.Name -eq 'SubjectDomainName'}).'#text'
        if ([string]::IsNullOrWhiteSpace($usuario) -or $usuario.EndsWith('$')) { continue }

        $eventId = $event.Id
        $acao = "OUTRO"
        $objectName = ""

        if ($eventId -eq 4624) {
            $logonType = ($eventData | Where-Object {$_.Name -eq 'LogonType'}).'#text'
            if ($logonType -in @('3', '10')) { $acao = "LOGIN_REDE" } else { continue }
        }
        elseif ($eventId -eq 4634) {
            $acao = "LOGOUT_REDE"
        }
        elseif ($eventId -eq 4663) {
            $rawMask = ($eventData | Where-Object {$_.Name -eq 'AccessMask'}).'#text'
            $objectName = ($eventData | Where-Object {$_.Name -eq 'ObjectName'}).'#text'
            if ([string]::IsNullOrWhiteSpace($rawMask)) { continue }

            $mask = [Convert]::ToUInt32($rawMask, 16)
            $acao = "ACESSO_PASTA"
            if (($mask -band 0x10000) -ne 0) { $acao = "EXCLUSAO_REDE" }
            elseif (($mask -band 0x6) -ne 0) { $acao = "MODIFICACAO_REDE" }
            elseif (($mask -band 0x100) -ne 0) { $acao = "CRIACAO_REDE" }

            if ($objectName -match '${regexIgnorados.replace(/\\/g, '\\\\')}') { continue }
        }

        [PSCustomObject]@{
            TimeCreated = $event.TimeCreated.ToString("o")
            Usuario     = "$dominio\\$usuario"
            Acao        = $acao
            PastaArquivo= $objectName
        }
    }
    $results | ConvertTo-Json -Compress
}
`;

  const encodedScript = Buffer.from(scriptPowerShell, 'utf16le').toString('base64');

  function checarOciosidade() {
    const agora = Date.now();
    const limiteMs = minutosOciosidade * 60 * 1000;

    for (const [usuario, dados] of usuariosAtivos.entries()) {
      const tempoInativoMs = agora - dados.ultimaAtividade;
      if (tempoInativoMs >= limiteMs && !dados.ociosoNotificado) {
        const minutos = Math.floor(tempoInativoMs / (1000 * 60));
        logger.info(`[OCIOSO_SERVIDOR] ${usuario} inativo na rede há ${minutos} min`, {
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

  function monitorar() {
    const comando = `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encodedScript}`;

    exec(comando, { maxBuffer: 1024 * 1024 * 10, windowsHide: true }, (error, stdout) => {
      if (error || !stdout.trim()) {
        checarOciosidade();
        return;
      }

      try {
        const eventos = JSON.parse(stdout);
        const lista = Array.isArray(eventos) ? eventos : [eventos];

        lista.forEach((evento) => {
          if (!evento.Usuario || evento.Usuario.endsWith('$')) return;

          const chave = `${evento.TimeCreated?.substring(0, 19)}-${evento.Usuario}-${evento.Acao}-${evento.PastaArquivo || ''}`;
          if (ultimosEventos.has(chave)) return;

          ultimosEventos.add(chave);
          if (ultimosEventos.size > limiteCache) {
            ultimosEventos.delete(ultimosEventos.values().next().value);
          }

          usuariosAtivos.set(evento.Usuario, {
            ultimaAtividade: Date.now(),
            ociosoNotificado: false
          });

          logger.info(`[${evento.Acao}] ${evento.Usuario} -> ${evento.PastaArquivo || 'Sessão'}`, {
            origem: 'SERVIDOR',
            acao: evento.Acao,
            usuario: evento.Usuario,
            caminhoRede: evento.PastaArquivo,
            dataHora: evento.TimeCreated
          });

          store.gravarEventoPasta({
            acao: evento.Acao,
            usuario: evento.Usuario,
            caminhoRede: evento.PastaArquivo || null,
            dataHora: evento.TimeCreated
          });
        });
      } catch (e) {
        // parse silencioso
      }

      checarOciosidade();
    });
  }

  const timer = setInterval(monitorar, intervaloMs);
  monitorar();

  console.log(
    `📁 Monitor de pastas iniciado (intervalo ${intervaloMs} ms, janela ${janela}s)`
  );

  return {
    stop: () => clearInterval(timer),
    usuariosAtivos
  };
}

module.exports = { iniciarMonitorPastas };