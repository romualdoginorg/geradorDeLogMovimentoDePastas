const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');
const winston = require('winston');

// ==============================================================================
// 🛠️ GARANTIR O BINÁRIO NO DISCO REAL
// ==============================================================================
const nomeBinario = 'tray_windows_release.exe';
const isPkg = typeof process.pkg !== 'undefined';
const pastaExecutavelReal = isPkg ? path.dirname(process.execPath) : __dirname;
const caminhoDestinoBinario = path.join(pastaExecutavelReal, nomeBinario);

// ==============================================================================
// 🛠️ PATCH NO SYSTRAY2 PARA USAR O CAMINHO CORRETO
// ==============================================================================
// Salvar o caminho do binário em uma variável global antes de importar o systray2
global.__SYSTRAY_BIN_PATH = caminhoDestinoBinario;

// Função para garantir que o binário existe
function garantirBinario() {
    if (fs.existsSync(caminhoDestinoBinario)) {
        console.log(`✅ Binário encontrado em: ${caminhoDestinoBinario}`);
        return true;
    }

    console.log(`🔍 Procurando binário em possíveis locais...`);
    
    // Copiar o binário para a pasta do executável
    const possiveisOrigens = [
        path.join(__dirname, '..', 'node_modules', 'systray2', 'traybin', nomeBinario),
        path.join(__dirname, 'node_modules', 'systray2', 'traybin', nomeBinario),
        path.join(process.cwd(), 'node_modules', 'systray2', 'traybin', nomeBinario),
        path.join(process.cwd(), '..', 'node_modules', 'systray2', 'traybin', nomeBinario),
    ];

    for (const origem of possiveisOrigens) {
        if (fs.existsSync(origem)) {
            try {
                console.log(`📁 Copiando de: ${origem}`);
                fs.copyFileSync(origem, caminhoDestinoBinario);
                console.log(`✅ Binário copiado para: ${caminhoDestinoBinario}`);
                return true;
            } catch (e) {
                console.error(`❌ Erro ao copiar de ${origem}:`, e.message);
            }
        }
    }

    console.error(`❌ Binário não encontrado em nenhum local!`);
    return false;
}

// Garantir que o binário existe
garantirBinario();

// ==============================================================================
// 🛠️ MONKEY PATCH NO SYSTRAY2 - SOBRESCREVER O SPAWN
// ==============================================================================
// Importar o systray2 após garantir o binário
const Systray2 = require('systray');

// Salvar o construtor original
const OriginalSystray = Systray2.default;

// Criar uma nova classe que sobrescreve o comportamento
class PatchedSystray extends OriginalSystray {
    constructor(options) {
        // Forçar o binPath para o caminho correto
        const patchedOptions = {
            ...options,
            binPath: caminhoDestinoBinario
        };
        super(patchedOptions);
        
        // Sobrescrever o método spawn para usar o caminho correto
        this._spawn = this.spawn;
        this.spawn = function() {
            const args = Array.from(arguments);
            // Substituir qualquer caminho do binário pelo correto
            if (args.length > 0 && typeof args[0] === 'string') {
                args[0] = caminhoDestinoBinario;
            }
            return this._spawn.apply(this, args);
        };
    }
}

// Substituir a exportação
Systray2.default = PatchedSystray;

// ==============================================================================
// ⚙️ CONFIGURAÇÕES DE TELEMETRIA
// ==============================================================================
const CONFIG = {
    INTERVALO_CHECAGEM_MS: 5000,
    NOME_ARQUIVO_LOG: 'terminal-produtividade.log',
    MINUTOS_PARA_OCIOSIDADE: 10,
    PROCESSOS_IGNORADOS: [
        'svchost.exe', 'System', 'Idle', 'explorer.exe', 'conhost.exe',
        'SearchHost.exe', 'StartMenuExperienceHost.exe', 'RuntimeBroker.exe',
        'Taskmgr.exe', 'SecurityHealthService.exe', 'node.exe', 'powershell.exe',
        'ApplicationFrameHost.exe'
    ]
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

let ociosoNotificado = false;
let bootRegistrado = false;
let programasEmUsoAnterior = new Set();

const ITEM_ICON = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAA3SURBVDhPY2AY3mAI4P8AAtMQ90ACGBilGf4fgmE0fLAbQLKBo2FAnIFAYmAYXmAI4P8AAtMQdwMAo+29a3pInCAAAAAASUVORK5CYII=';

// ==============================================================================
// 🟢 CRIAÇÃO DA BANDEJA DO SISTEMA
// ==============================================================================
let systray;

try {
    // Usar a classe patched
    const SysTray = Systray2.default;
    
    systray = new SysTray({
        menu: {
            icon: ITEM_ICON,
            title: "Monitor de Produtividade",
            tooltip: "Monitoramento Ativo em Segundo Plano",
            items: [
                {
                    title: "Status: Monitorando...",
                    tooltip: "O serviço está a registrar a atividade",
                    checked: false,
                    enabled: false
                },
                {
                    title: "Sair / Encerrar",
                    tooltip: "Encerrar monitoramento",
                    checked: false,
                    enabled: true
                }
            ]
        },
        debug: false,
        binPath: caminhoDestinoBinario
    });

    systray.onClick(action => {
        if (action.item.title === "Sair / Encerrar") {
            logger.info(`[SERVICO_ENCERRADO] O usuário encerrou a aplicação pela bandeja.`, {
                origem: 'TERMINAL',
                evento: 'SERVICO_ENCERRADO',
                dataHora: new Date().toISOString()
            });
            systray.kill();
            process.exit(0);
        }
    });
    
    console.log('✅ SysTray iniciado com sucesso!');
} catch (error) {
    console.error('❌ Erro ao iniciar SysTray:', error.message);
    logger.error(`Erro ao iniciar SysTray: ${error.message}`);
}

// ==============================================================================
// 📜 SCRIPT POWERSHELL E MONITORAMENTO
// ==============================================================================
const scriptPowerShell = `
$usuarioAtual = $env:USERNAME
$dominioAtual = $env:USERDOMAIN
$bootTime = (Get-CimInstance -ClassName Win32_OperatingSystem).LastBootUpTime.ToString("o")
$processosComJanela = Get-Process | Where-Object {$_.MainWindowTitle -ne ""} | Select-Object ProcessName, MainWindowTitle

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

function monitorarTerminal() {
    const comando = `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encodedScript}`;

    exec(comando, { maxBuffer: 1024 * 1024 * 5 }, (error, stdout) => {
        if (error || !stdout.trim()) return;

        try {
            const dados = JSON.parse(stdout);
            const usuario = dados.Usuario;

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

            if (dados.Processos) {
                const listaProcessos = Array.isArray(dados.Processos) ? dados.Processos : [dados.Processos];
                const programasAtuais = new Set();

                listaProcessos.forEach(p => {
                    const nomeExe = `${p.ProcessName}.exe`;
                    if (!CONFIG.PROCESSOS_IGNORADOS.includes(nomeExe)) {
                        programasAtuais.add(nomeExe);
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
            // Silenciosamente ignora erros de parsing
        }
    });
}

// Iniciar monitoramento
setInterval(monitorarTerminal, CONFIG.INTERVALO_CHECAGEM_MS);
monitorarTerminal();

console.log('🚀 Monitor de produtividade iniciado!');
console.log(`📁 Binário do systray: ${caminhoDestinoBinario}`);