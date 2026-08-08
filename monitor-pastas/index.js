const { exec } = require('child_process');
const winston = require('winston');

// Configuração do Logger (exibição no console e persistência em arquivo)
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs-movimentacao.log' }),
    new winston.transports.Console({ format: winston.format.simple() })
  ],
});

// Script PowerShell otimizado com tradução de AccessMask e filtro temporal
const scriptPowerShell = `
$startTime = (Get-Date).AddSeconds(-15)
$events = Get-WinEvent -FilterHashtable @{LogName='Security'; Id=4663; StartTime=$startTime} -ErrorAction SilentlyContinue

if ($events) {
    $results = foreach ($event in $events) {
        $xml = [xml]$event.ToXml()
        $eventData = $xml.Event.EventData.Data

        $rawMask = ($eventData | Where-Object {$_.Name -eq 'AccessMask'}).'#text'
        $objectName = ($eventData | Where-Object {$_.Name -eq 'ObjectName'}).'#text'
        $processName = ($eventData | Where-Object {$_.Name -eq 'ProcessName'}).'#text'
        $usuario = ($eventData | Where-Object {$_.Name -eq 'SubjectUserName'}).'#text'
        $dominio = ($eventData | Where-Object {$_.Name -eq 'SubjectDomainName'}).'#text'

        if ([string]::IsNullOrWhiteSpace($rawMask)) { continue }
        
        $mask = [Convert]::ToUInt32($rawMask, 16)

        # Mapeamento binário das máscaras de permissão do Windows para ações CRUD
        $acao = "LEITURA"
        if (($mask -band 0x10000) -ne 0) { $acao = "EXCLUSAO" }
        elseif (($mask -band 0x6) -ne 0) { $acao = "MODIFICACAO" }
        elseif (($mask -band 0x100) -ne 0) { $acao = "CRIACAO" }
        elseif (($mask -band 0x1) -ne 0) { $acao = "LEITURA" }

        $processo = [System.IO.Path]::GetFileName($processName)

        # Filtra navegação genérica do Windows Explorer em diretórios
        if ($processo -eq "explorer.exe" -and $acao -eq "LEITURA" -and (Test-Path -Path $objectName -PathType Container)) {
            continue
        }

        # Ignora arquivos temporários e de sistema
        if ($objectName -notmatch "\\$|\\.tmp$|Desktop\\.ini|~\\$") {
            [PSCustomObject]@{
                TimeCreated = $event.TimeCreated.ToString("o")
                Usuario     = "$dominio\\\\$usuario"
                Acao        = $acao
                Arquivo     = $objectName
                Processo    = $processo
            }
        }
    }
    $results | ConvertTo-Json -Compress
}
`;

// Converte o script para UTF-16LE / Base64 para execução segura no PowerShell
const encodedScript = Buffer.from(scriptPowerShell, 'utf16le').toString('base64');
const ultimosEventos = new Set();

function lerLogsWindows() {
  const comando = `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encodedScript}`;

  exec(comando, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout) => {
    if (error || !stdout.trim()) return;

    try {
      const eventos = JSON.parse(stdout);
      const listaEventos = Array.isArray(eventos) ? eventos : [eventos];

      listaEventos.forEach(evento => {
        // Ignora contas locais de sistema (terminadas em $)
        if (!evento.Usuario || evento.Usuario.endsWith('$')) return;

        // Deduplicação: Agrupa ações idênticas no mesmo segundo
        const segundoAproximado = evento.TimeCreated.substring(0, 19); 
        const chaveUnica = `${segundoAproximado}-${evento.Usuario}-${evento.Acao}-${evento.Arquivo}`;

        if (!ultimosEventos.has(chaveUnica)) {
          ultimosEventos.add(chaveUnica);

          // Limpeza periódica do cache de memória
          if (ultimosEventos.size > 1000) {
            const primeiroItem = ultimosEventos.values().next().value;
            ultimosEventos.delete(primeiroItem);
          }

          logger.info(`[${evento.Acao}] ${evento.Usuario} -> ${evento.Arquivo}`, {
            acao: evento.Acao,
            usuario: evento.Usuario,
            arquivo: evento.Arquivo,
            programaUtilizado: evento.Processo,
            dataHora: evento.TimeCreated
          });
        }
      });
    } catch (e) {
      // Ignora falhas pontuais de interpretação de JSON
    }
  });
}

// Executa a verificação a cada 10 segundos
setInterval(lerLogsWindows, 10000);
console.log('Monitoramento de auditoria de arquivos iniciado...');