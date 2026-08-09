const { exec } = require('child_process');

const scriptPowerShell = `
$usuarioAtual = $env:USERNAME
$dominioAtual = $env:USERDOMAIN
$bootTime = (Get-CimInstance -ClassName Win32_OperatingSystem).LastBootUpTime.ToString("o")
$processosComJanela = Get-Process | Where-Object { $_.MainWindowTitle -ne "" } | Select-Object ProcessName, MainWindowTitle

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

/**
 * Coleta dados do sistema via PowerShell
 * @returns {Promise<object|null>}
 */
function coletarDados() {
  return new Promise((resolve) => {
    const comando = `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encodedScript}`;

    exec(comando, { maxBuffer: 1024 * 1024 * 5 }, (error, stdout, stderr) => {
      if (error || !stdout.trim()) {
        resolve(null);
        return;
      }

      try {
        const dados = JSON.parse(stdout);
        resolve(dados);
      } catch (e) {
        resolve(null);
      }
    });
  });
}

module.exports = { coletarDados };