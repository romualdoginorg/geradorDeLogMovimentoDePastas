const { exec } = require('child_process');
const winston = require('winston');

// ==============================================================================
// ⚙️ CONFIGURAÇÕES DO SISTEMA (Ajuste aqui)
// ==============================================================================
const CONFIG = {
  // Intervalo em milissegundos para rodar a checagem (10000 = 10 segundos)
  INTERVALO_CHECAGEM_MS: 10000,
  
  // Janela de tempo em segundos para buscar eventos no passado do Windows
  JANELA_TEMPO_SEGUNDOS: 15,
  
  // Nome do arquivo onde os logs serão salvos
  NOME_ARQUIVO_LOG: 'logs-movimentacao.log',
  
  // Limite máximo do cache de memória para evitar vazamento (quantidade de logs)
  LIMITE_CACHE_MEMORIA: 1000,
  
  // Expressão regular para ignorar arquivos temporários e do sistema
  // Adicione novas extensões separando com pipe (|). Exemplo: |\n.zip$
  REGEX_ARQUIVOS_IGNORADOS: '\\$|\\.tmp$|Desktop\\.ini|~\\$'
};

// ==============================================================================
// 📝 CONFIGURAÇÃO DO LOGGER (WINSTON)
// ==============================================================================
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

// ==============================================================================
// 📜 SCRIPT POWERSHELL DINÂMICO
// ==============================================================================
const scriptPowerShell = `
$startTime = (Get-Date).AddSeconds(-${CONFIG.JANELA_TEMPO_SEGUNDOS})
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

        # Ignora arquivos usando a regex configurada
        if ($objectName -notmatch "${CONFIG.REGEX_ARQUIVOS_IGNORADOS}") {
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

// ==============================================================================
// 🔄 LÓGICA DE EXECUÇÃO E MONITORAMENTO
// ==============================================================================
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

          // Limpeza periódica do cache de memória com base na variável CONFIG
          if (ultimosEventos.size > CONFIG.LIMITE_CACHE_MEMORIA) {
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

// Inicia o loop usando o intervalo configurado
setInterval(lerLogsWindows, CONFIG.INTERVALO_CHECAGEM_MS);
console.log('Monitoramento de auditoria de arquivos iniciado com configurações personalizadas...');