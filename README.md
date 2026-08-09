# Monitor de Produtividade (System Tray)

Aplicativo de bandeja do sistema (Windows) que roda em segundo plano, coleta informações de atividade e permite envio quando necessário.

## Estrutura

```
├── src/
│   ├── main.js          # Ponto de entrada
│   ├── config.js        # Carrega/salva configuração
│   ├── logger.js        # Winston + rotação diária
│   ├── collector.js     # Coleta via PowerShell
│   ├── sender.js        # Buffer local + envio HTTP
│   └── tray.js          # System tray + menu + ícone
├── config/
│   ├── config.default.json
│   └── config.json      # Configuração do usuário (editável)
├── assets/
│   ├── icon.ico         # Ícone principal (Windows)
│   ├── icon.png
│   └── icon-16.png
├── scripts/
│   └── build.js         # Script de build do .exe
├── logs/                # Gerado em tempo de execução
└── package.json
```

## Funcionalidades

- Ícone na bandeja do sistema
- Coleta:
  - Sessão iniciada (boot)
  - Inatividade (ociosidade)
  - Retorno da pausa
  - Abertura e fechamento de programas (com título da janela)
- Buffer local de eventos (`logs/eventos-pendentes.jsonl`)
- Envio manual pela bandeja ou automático por intervalo
- Configuração via `config/config.json`
- Logs diários com rotação

## Menu da bandeja

- Status atual (● Monitorando / ○ Ocioso / ⏸ Pausado)
- **Enviar dados agora**
- Abrir pasta de logs
- Pausar / Retomar monitoramento
- Sair / Encerrar

## Como rodar (desenvolvimento)

```bash
npm install
npm start
```

## Configuração

Edite `config/config.json`:

```json
{
  "intervaloChecagemMs": 5000,
  "minutosOciosidade": 10,
  "envio": {
    "habilitado": true,
    "url": "https://seu-servidor.com/api/eventos",
    "token": "seu-token-aqui",
    "intervaloEnvioMinutos": 15,
    "enviarAoSair": true
  }
}
```

## Build do .exe (Windows)

```bash
npm install
npm run build
```

Isso executa `scripts/build.js`, que:

1. Limpa a pasta `dist/`
2. Empacota o código com **pkg** (Node 18 + Windows x64)
3. Copia `assets/`, `config/` e o binário do systray2
4. Gera `dist/monitor-produtividade.exe` + arquivos de suporte

### Resultado esperado em `dist/`

```
dist/
├── monitor-produtividade.exe
├── tray_windows_release.exe   ← necessário para o tray
├── assets/
│   └── icon.ico (e outros)
├── config/
│   ├── config.json
│   └── config.default.json
├── logs/
└── LEIA-ME.txt
```

### Distribuição

Envie a pasta `dist/` completa (ou pelo menos o `.exe` + `tray_windows_release.exe` + pastas `assets` e `config`).

O usuário pode editar `config/config.json` sem recompilar.

### Alternativa rápida (só o pkg)

```bash
npm run build:pkg
```

## Observações importantes

- Funciona apenas no **Windows** (usa PowerShell + user32.dll).
- Coleta títulos de janelas — use com responsabilidade e aviso ao usuário.
- O envio só ocorre se `envio.habilitado = true` e a URL estiver configurada.
- Eventos ficam no buffer local até serem enviados com sucesso.
- Mantenha `tray_windows_release.exe` na mesma pasta do executável.