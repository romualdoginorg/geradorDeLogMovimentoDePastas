# geradorDeLogMovimentoDePastas

```python
readme_content = """# Monitoramento de Auditoria de Arquivos (Windows Server + Node.js)

Sistema de monitoramento e registro de eventos de acesso, criação, modificação e exclusão de arquivos em servidores Windows, capturando a identidade do usuário logado (Active Directory / Windows Local) através dos logs de segurança do sistema operacional (`Event ID 4663`).

---

## 📌 Visão Geral

Ao utilizar o compartilhamento de arquivos nativo do Windows (SMB/Samba), o monitoramento simples no sistema de arquivos não consegue identificar **qual usuário da rede** realizou cada ação. 

Esta solução combina:
1. **Auditoria de Segurança NAvida do Windows Server**: Registra com precisão o login do usuário que interagiu com os arquivos.
2. **Serviço Node.js + PowerShell**: Captura os logs de eventos nativos em tempo real, filtra o ruído do sistema (consultas automáticas do `explorer.exe`), traduz as permissões do Windows em operações **CRUD** (`LEITURA`, `MODIFICACAO`, `CRIACAO`, `EXCLUSAO`) e gera registros limpos e estruturados em formato JSON.

---

## 📋 Pré-requisitos

- **Sistema Operacional**: Windows Server ou Windows 10/11 Professional/Enterprise.
- **Ambiente de Execução**: Node.js (v14 ou superior) instalado.
- **Permissões**: Privilégios de **Administrador** no servidor (necessário para ler o Log de Segurança do Windows).

---

## 🛠️ Passo 1: Configurar a Auditoria no Windows Server

Para que o Windows passe a registrar as ações dos usuários no Visualizador de Eventos (`Event Viewer`), é necessário habilitar a auditoria no sistema e na pasta que será monitorada.

### 1.1. Ativar a Política Global de Auditoria
1. Pressione `Win + R`, digite `secpol.msc` e pressione **Enter**.
2. Navegue até **Políticas Locais** > **Política de Auditoria**.
3. Dê um duplo clique em **Auditar Acesso a Objetos**.
4. Marque as opções **Sucesso** e **Falha**.
5. Clique em **Aplicar** e **OK**.

### 1.2. Ativar a Auditoria na Pasta do Servidor
1. Clique com o botão direito na pasta compartilhada que deseja monitorar e selecione **Propriedades**.
2. Acesse a aba **Segurança** e clique em **Avançadas**.
3. Selecione a aba **Auditoria** e clique em **Adicionar**.
4. Em **Principal**, clique em *Selecionar um principal* e digite `Todos` (ou `Todos os Usuários Autenticados`). Clique em **OK**.
5. Em **Tipo**, selecione **Tudo** (Sucesso e Falha).
6. Em **Permissões**, selecione as ações que deseja rastrear (ex: *Criar arquivos/gravar dados*, *Excluir*, *Gravar atributos*).
7. Clique em **OK**, **Aplicar** e confirme a alteração nas subpastas.

> ℹ️ *A partir deste momento, qualquer interação com os arquivos dentro da pasta gerará um evento de segurança **Event ID 4663** no Windows contendo o login do usuário.*

---

## 📦 Passo 2: Configurar o Projeto Node.js

### 2.1. Criar o Diretório e Instalar Dependências
Abra o terminal (PowerShell ou CMD) **como Administrador** e execute:


```

```text
FILE_CREATED

```bash
# Criar diretório do projeto
mkdir monitor-arquivos
cd monitor-arquivos

# Inicializar o projeto Node.js
npm init -y

# Instalar biblioteca de logging
npm install winston

```

### 2.2. Criar o Arquivo `index.js`

Crie o arquivo `index.js` na raiz do projeto com o seguinte código:

```javascript
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

```

---

## 🚀 Passo 3: Executando e Testando a Solução

1. Abra o Terminal/PowerShell **como Administrador**.
2. Navegue até a pasta do projeto:
```bash
cd monitor-arquivos

```


3. Inicie o monitoramento:
```bash
node index.js

```


4. Realize modificações, criações ou exclusões de arquivos na pasta auditada usando outro computador ou conta de usuário da rede.
5. Verifique as saídas no terminal e no arquivo `logs-movimentacao.log`.

---

## 📄 Formato do Log Gerado

Os registros são salvos no arquivo `logs-movimentacao.log` no formato JSON lines:

```json
{
  "level": "info",
  "message": "[MODIFICACAO] DOMINIO\\Usuario -> C:\\Compartilhado\\Relatorio.docx",
  "acao": "MODIFICACAO",
  "usuario": "DOMINIO\\Usuario",
  "arquivo": "C:\\Compartilhado\\Relatorio.docx",
  "programaUtilizado": "WINWORD.EXE",
  "dataHora": "2026-08-05T20:02:20.0200172-03:00",
  "timestamp": "2026-08-05 20:02:25"
}

```

---

## 🛡️ Principais Recursos e Filtros Aplicados

* **Tradução CRUD**: Converte os códigos de permissão binários (`AccessMask`) em ações compreensíveis: `CRIACAO`, `LEITURA`, `MODIFICACAO` e `EXCLUSAO`.
* **Deduplicação Inteligente**: Elimina disparos repetidos de logs em milissegundos causados por programas como Microsoft Office e Windows Explorer.
* **Filtro de Ruído**: Descarta acessos simples a diretórios pelo `explorer.exe` e arquivos temporários de sistema (`.tmp`, `~$`, `Desktop.ini`).
* **Codificação Base64**: O script PowerShell é codificado em UTF-16LE/Base64 para evitar erros de sintaxe e aspas no terminal.
"""

with open("README.md", "w", encoding="utf-8") as f:
f.write(readme_content)

print("FILE_CREATED")

```
Seu arquivo de documentação (README.md) está pronto!

[file-tag: code-generated-file-0-1786149882935951545]

### 📝 O que foi incluído no `README.md`:

1. **Visão Geral e Arquitetura:** Explicação clara do motivo de usar a Auditoria do Windows combinada com o Node.js.
2. **Passo a Passo de Configuração do Windows Server:**
   - Ativação da Política de Auditoria local (`secpol.msc`).
   - Configuração de auditoria na pasta compartilhada alvo.
3. **Passo a Passo de Instalação do Node.js:**
   - Comandos de inicialização e instalação do `winston`.
   - Código completo e atualizado do `index.js` (com codificação em Base64, mapeamento binário de CRUD, deduplicação e filtros de ruído do Explorer).
4. **Instruções de Execução e Teste:** Como rodar a aplicação em modo Administrador.
5. **Exemplo de Log Estruturado:** Exibição do formato em JSON gerado no arquivo `logs-movimentacao.log`.

```
