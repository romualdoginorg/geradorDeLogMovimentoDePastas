const { exec } = require('child_process');
const winston = require('winston');

// Configurações do Servidor
const CONFIG = {
  INTERVALO_CHECAGEM_MS: 10000,
  JANELA_TEMPO_SEGUNDOS: 15,
  NOME_ARQUIVO_LOG: 'servidor-movimentacao.log',
  LIMITE_CACHE_MEMORIA: 1000,
  MINUTOS_PARA_OCIOSIDADE: 15,
  REGEX_ARQUIVOS_IGNORADOS: '\\$|\\.tmp$|Desktop\\.ini|~\\$'
};

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: CONFIG.NOME_ARQUIVO_LOG }),
    new winston.transports.Console({ format: winston.format.simple() })
  ],
});

const usuariosAtivos = new Map();
const ultimosEventos = new Set();

// PowerShell focado em acessos de rede (4663), Logon (4624) e Logoff (4634)
const scriptPowerShell = `
$startTime = (Get-Date).AddSeconds(-${CONFIG.JANELA_TEMPO_SEGUNDOS})
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

            if ($objectName -match "${CONFIG.REGEX_ARQUIVOS_IGNORADOS}") { continue }
        }

        [PSCustomObject]@{
            TimeCreated = $event.TimeCreated.ToString("o")
            Usuario     = "$dominio\\\\$usuario"
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
  const limiteOciosoMs = CONFIG.MINUTOS_PARA_OCIOSIDADE * 60 * 1000;

  for (const [usuario, dados] of usuariosAtivos.entries()) {
    const tempoInativoMs = agora - dados.ultimaAtividade;
    if (tempoInativoMs >= limiteOciosoMs && !dados.ociosoNotificado) {
      const minutosOcioso = Math.floor(tempoInativoMs / (1000 * 60));
      logger.info(`[OCIOSO_SERVIDOR] ${usuario} inativo na rede há ${minutosOcioso} min`, {
        origem: 'SERVIDOR',
        acao: 'OCIOSO_REDE',
        usuario: usuario,
        tempoOciosoMinutos: minutosOcioso
      });
      dados.ociosoNotificado = true;
    }
  }
}

function monitorarServidor() {
  const comando = `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encodedScript}`;

  exec(comando, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout) => {
    if (error || !stdout.trim()) {
      checarOciosidade();
      return;
    }

    try {
      const eventos = JSON.parse(stdout);
      const listaEventos = Array.isArray(eventos) ? eventos : [eventos];

      listaEventos.forEach(evento => {
        if (!evento.Usuario || evento.Usuario.endsWith('$')) return;

        const chaveUnica = `${evento.TimeCreated.substring(0, 19)}-${evento.Usuario}-${evento.Acao}-${evento.PastaArquivo}`;

        if (!ultimosEventos.has(chaveUnica)) {
          ultimosEventos.add(chaveUnica);
          if (ultimosEventos.size > CONFIG.LIMITE_CACHE_MEMORIA) {
            ultimosEventos.delete(ultimosEventos.values().next().value);
          }

          usuariosAtivos.set(evento.Usuario, { ultimaAtividade: Date.now(), ociosoNotificado: false });

          logger.info(`[${evento.Acao}] ${evento.Usuario} -> ${evento.PastaArquivo || 'Sessão'}`, {
            origem: 'SERVIDOR',
            acao: evento.Acao,
            usuario: evento.Usuario,
            caminhoRede: evento.PastaArquivo,
            dataHora: evento.TimeCreated
          });
        }
      });
    } catch (e) {}

    checarOciosidade();
  });
}

setInterval(monitorarServidor, CONFIG.INTERVALO_CHECAGEM_MS);
console.log('Monitoramento de Servidor (Pastas Compartilhadas + Conexões) iniciado...');