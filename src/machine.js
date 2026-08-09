const os = require('os');
const { execSync } = require('child_process');

let cacheMetadados = null;

/**
 * Coleta metadados da máquina (uma vez, depois usa cache)
 * Esses dados vão em todo payload enviado ao servidor para
 * identificação, análise e busca futura.
 */
function obterMetadadosMaquina() {
  if (cacheMetadados) return cacheMetadados;

  const interfaces = os.networkInterfaces();
  const ips = [];

  for (const nome of Object.keys(interfaces)) {
    for (const iface of interfaces[nome] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push({ interface: nome, endereco: iface.address, mac: iface.mac });
      }
    }
  }

  let dominio = '';
  let usuarioWindows = '';
  try {
    // USERDOMAIN e USERNAME no Windows
    dominio = process.env.USERDOMAIN || '';
    usuarioWindows = process.env.USERNAME || os.userInfo().username || '';
  } catch (_) {
    usuarioWindows = os.userInfo().username || '';
  }

  let serialBios = null;
  let fabricante = null;
  let modelo = null;
  try {
    // WMI rápido (Windows)
    const wmi = execSync(
      'powershell -NoProfile -Command "Get-CimInstance Win32_ComputerSystemProduct | Select-Object Vendor,Name,IdentifyingNumber | ConvertTo-Json -Compress"',
      { encoding: 'utf8', timeout: 5000, windowsHide: true }
    ).trim();
    const info = JSON.parse(wmi);
    fabricante = info.Vendor || null;
    modelo = info.Name || null;
    serialBios = info.IdentifyingNumber || null;
  } catch (_) {
    // silencioso – nem sempre tem permissão
  }

  cacheMetadados = {
    // Identificação principal
    nomeMaquina: os.hostname(),
    nomeMaquinaCompleto: dominio ? `${dominio}\\${os.hostname()}` : os.hostname(),

    // Usuário
    usuario: usuarioWindows,
    dominio: dominio || null,
    usuarioCompleto: dominio ? `${dominio}\\${usuarioWindows}` : usuarioWindows,

    // Sistema
    plataforma: os.platform(),           // win32
    arquitetura: os.arch(),              // x64
    versaoSO: os.release(),
    tipoSO: os.type(),
    uptimeSegundos: Math.floor(os.uptime()),

    // Hardware resumido
    cpus: os.cpus()?.length || 0,
    memoriaTotalMB: Math.round(os.totalmem() / 1024 / 1024),
    memoriaLivreMB: Math.round(os.freemem() / 1024 / 1024),

    // Rede
    ips,
    ipPrincipal: ips[0]?.endereco || null,
    macPrincipal: ips[0]?.mac || null,

    // Hardware (quando disponível)
    fabricante,
    modelo,
    serialBios,

    // App
    versaoApp: '1.0.0',
    pid: process.pid,
    nodeVersion: process.version,

    // Timestamp de coleta dos metadados
    coletadoEm: new Date().toISOString()
  };

  return cacheMetadados;
}

/**
 * Atualiza apenas campos que mudam (memória, uptime)
 */
function obterMetadadosAtualizados() {
  const base = obterMetadadosMaquina();
  return {
    ...base,
    uptimeSegundos: Math.floor(os.uptime()),
    memoriaLivreMB: Math.round(os.freemem() / 1024 / 1024),
    coletadoEm: new Date().toISOString()
  };
}

module.exports = {
  obterMetadadosMaquina,
  obterMetadadosAtualizados
};