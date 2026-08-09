const { exec } = require('child_process');
const winston = require('winston');

// ==============================================================================
// ⚙️ CONFIGURAÇÕES DE TELEMETRIA DO TERMINAL
// ==============================================================================
const CONFIG = {
  INTERVALO_CHECAGEM_MS: 5000,           // Checagem a cada 5 segundos
  NOME_ARQUIVO_LOG: 'terminal-produtividade.log',
  MINUTOS_PARA_OCIOSIDADE: 10,           // Tempo sem mexer para considerar "Pausa"
  
  // Programas e processos de segundo plano para ignorar
  PROCESSOS_IGNORADOS: [
    'svchost.exe', 'System', 'Idle', 'explorer.exe', 'conhost.exe', 
    'SearchHost.exe', 'StartMenuExperienceHost.exe', 'RuntimeBroker.exe',
    'Taskmgr.exe', 'SecurityHealthService.exe', 'node.exe', 'powershell.exe',
    'ApplicationFrameHost.exe'
  ]
};

// ==============================================================================
// 📝 LOGGER (WINSTON)
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

let ociosoNotificado = false;
let bootRegistrado = false;
let programasEmUsoAnterior = new Set();

// ==============================================================================
// 📜 SCRIPT POWERSHELL (LEITURA DIRETA DA SESSÃO E JANELA ATIVA)
// ==============================================================================
const scriptPowerShell = `
# 1. Obter usuário logado atual e tempo de Boot da máquina
$usuarioAtual = $env:USERNAME
$dominioAtual = $env:USERDOMAIN
$bootTime = (Get-CimInstance -ClassName Win32_OperatingSystem).LastBootUpTime.ToString("o")

# 2. Obter janelas abertas e visíveis do usuário
$processosComJanela = Get-Process | Where-Object {$_.MainWindowTitle -ne ""} | Select-Object ProcessName, MainWindowTitle

# 3. Obter tempo de inatividade física (Teclado/Mouse)
$memberDefinition = @'
[DllImport("user32.dll")]
public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
public struct LASTINPUTINFO {
    public uint cbSize;
    public uint dwTime;
}
'@
Add-Type -MemberDefinition $memberDefinition -Name User32 -Namespace Win32 -ErrorAction SilentlyContinue

$lastInputInfo = New-Object Win32.LASTINPUTINFO
$lastInputInfo.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($lastInputInfo)
[Win32.User32]::GetLastInputInfo([ref]$lastInputInfo) | Out-Null

$ticks = [Environment]::TickCount
$tempoInativoMs = $ticks - $lastInputInfo.dwTime

[PSCustomObject]@{
    Usuario       = "$dominioAtual\\$usuarioAtual"
    BootTime      = $bootTime
    InatividadeMs = $tempoInativoMs
    Processos     = $processosComJanela
} | ConvertTo-Json -Depth 3 -Compress
`;

const encodedScript = Buffer.from(scriptPowerShell, 'utf16le').toString('base64');

// ==============================================================================
// 🔄 LÓGICA DE EXECUÇÃO
// ==============================================================================
function monitorarTerminal() {
  const comando = `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encodedScript}`;

  exec(comando, { maxBuffer: 1024 * 1024 * 5 }, (error, stdout) => {
    if (error || !stdout.trim()) return;

    try {
      const dados = JSON.parse(stdout);
      const usuario = dados.Usuario;

      // --- 1. REGISTRAR BOOT / INÍCIO DE SESSÃO DO TERMINAL ---
      if (!bootRegistrado) {
        logger.info(`[SESSAO_INICIADA] Terminal ativo para o usuário ${usuario}`, {
          origem: 'TERMINAL',
          evento: 'SESSAO_INICIADA',
          usuario: usuario,
          dataHoraBoot: dados.BootTime,
          dataHoraInicioMonitoramento: new Date().toISOString()
        });
        bootRegistrado = true;
      }

      // --- 2. CONTROLE DE PAUSAS / INATIVIDADE ---
      const tempoInativoMs = dados.InatividadeMs || 0;
      const minutosInativo = Math.floor(tempoInativoMs / (1000 * 60));
      const limiteMs = CONFIG.MINUTOS_PARA_OCIOSIDADE * 60 * 1000;

      if (tempoInativoMs >= limiteMs) {
        if (!ociosoNotificado) {
          logger.info(`[PAUSA_INATIVIDADE] ${usuario} está sem interagir há ${minutosInativo} minutos`, {
            origem: 'TERMINAL',
            evento: 'PAUSA_INATIVIDADE',
            usuario: usuario,
            tempoPausaMinutos: minutosInativo,
            dataHoraInicioPausa: new Date(Date.now() - tempoInativoMs).toISOString()
          });
          ociosoNotificado = true;
        }
      } else {
        if (ociosoNotificado) {
          logger.info(`[RETORNO_PAUSA] ${usuario} voltou a interagir com o computador`, {
            origem: 'TERMINAL',
            evento: 'RETORNO_PAUSA',
            usuario: usuario,
            dataHora: new Date().toISOString()
          });
          ociosoNotificado = false;
        }
      }

      // --- 3. MONITORAMENTO DE PROGRAMAS UTILIZADOS ---
      if (dados.Processos) {
        const listaProcessos = Array.isArray(dados.Processos) ? dados.Processos : [dados.Processos];
        const programasAtuais = new Set();

        listaProcessos.forEach(p => {
          const nomeExe = `${p.ProcessName}.exe`;

          if (!CONFIG.PROCESSOS_IGNORADOS.includes(nomeExe)) {
            programasAtuais.add(nomeExe);

            // Loga quando um novo programa/janela é aberto
            if (!programasEmUsoAnterior.has(nomeExe)) {
              logger.info(`[PROGRAMA_EM_USO] ${usuario} abriu ${nomeExe} - ${p.MainWindowTitle}`, {
                origem: 'TERMINAL',
                evento: 'USO_PROGRAMA',
                usuario: usuario,
                programa: nomeExe,
                tituloJanela: p.MainWindowTitle,
                dataHora: new Date().toISOString()
              });
            }
          }
        });

        programasEmUsoAnterior = programasAtuais;
      }

    } catch (e) {
      // Ignora erros pontuais de JSON
    }
  });
}

// Inicia o monitoramento
setInterval(monitorarTerminal, CONFIG.INTERVALO_CHECAGEM_MS);
console.log('Monitoramento de Produtividade e Telemetria do Terminal iniciado...');