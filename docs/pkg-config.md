# Configuração do `pkg` – Monitor de Produtividade

## Visão geral

O **pkg** (vercel/pkg) transforma o app Node.js em um único `.exe` Windows, embutindo o runtime do Node + seu código.

```json
"pkg": {
  "scripts":  [ "src/**/*.js" ],
  "assets":   [ "assets/**/*", "config/**/*", "node_modules/systray2/traybin/**/*" ],
  "targets":  [ "node18-win-x64" ],
  "outputPath": "dist",
  "compress": "GZip"
}
```

---

## Campos explicados

| Campo | O que faz | Nosso valor |
|-------|-----------|-------------|
| **scripts** | Arquivos JS compilados para bytecode V8 e embutidos | `src/**/*.js` |
| **assets** | Arquivos embutidos como dados brutos (não executados) | ícones, configs e binário do systray2 |
| **targets** | Plataforma/Node/arch de destino | `node18-win-x64` |
| **outputPath** | Pasta de saída padrão | `dist` |
| **compress** | Algoritmo de compressão do payload | `GZip` (bom equilíbrio) |

### scripts vs assets

- **scripts** → código que o Node executa (é “compilado”).
- **assets** → arquivos lidos em runtime com `fs.readFileSync`, `path.join(__dirname, ...)` etc.

O `pkg` só embute automaticamente arquivos referenciados com `path.join(__dirname, 'algo-literal')`.  
Por isso listamos explicitamente `assets/**/*` e `config/**/*`.

---

## Target

Formato: `node{versão}-{plataforma}-{arch}`

| Target | Significado |
|--------|-------------|
| `node18-win-x64` | Node 18 + Windows 64-bit (recomendado) |
| `node16-win-x64` | Node 16 (legado) |
| `node18-win-arm64` | Windows ARM (Surface, etc.) |

Usamos **node18-win-x64** porque:
- Node 18 ainda tem boa cobertura no pkg
- Windows x64 é o público-alvo do monitor

---

## Compressão

| Opção | Tamanho | Velocidade de build | Startup |
|-------|---------|---------------------|---------|
| `None` | maior | mais rápido | mais rápido |
| `GZip` | bom | médio | bom |
| `Brotli` | menor | mais lento | bom |

Recomendação: **GZip** (padrão do nosso build).

Para testar Brotli (pode reduzir ~10-20% o tamanho):

```bash
npx pkg . -t node18-win-x64 -o dist/monitor.exe --compress Brotli
```

---

## systray2 + pkg (ponto crítico)

O `systray2` usa um binário Go externo (`tray_windows_release.exe`).

### Problemas comuns

1. O binário não é encontrado dentro do `.exe` empacotado.
2. O caminho resolvido pelo systray2 aponta para o snapshot virtual do pkg.

### Soluções aplicadas no projeto

1. **`copyDir: true`** no construtor do SysTray (já está em `src/tray.js`):

```js
new SysTray({
  menu: { ... },
  debug: false,
  copyDir: true   // ← essencial para pkg
})
```

2. **Incluir o binário em `assets`**:

```json
"assets": [
  "node_modules/systray2/traybin/**/*"
]
```

3. **Copiar o binário para ao lado do .exe** no `scripts/build.js`  
   (o systray2 procura o arquivo no disco real, não só no snapshot).

4. **`garantirBinarioSystray()`** em `tray.js` tenta vários caminhos e copia se necessário.

### Resultado esperado na pasta `dist/`

```
dist/
├── monitor-produtividade.exe
├── tray_windows_release.exe   ← deve estar aqui
├── assets/
├── config/
└── logs/
```

---

## Comandos úteis

```bash
# Build completo (recomendado)
npm run build

# Só o pkg (sem copiar assets/config/binário)
npm run build:pkg

# Build com logs detalhados do pkg
npm run build:debug

# Manual
npx pkg . -t node18-win-x64 -o dist/monitor-produtividade.exe --compress GZip
```

---

## Detectar se está rodando empacotado

No código já usamos:

```js
const isPkg = typeof process.pkg !== 'undefined';
const baseDir = isPkg ? path.dirname(process.execPath) : path.join(__dirname, '..');
```

- `process.pkg` existe → estamos dentro do `.exe`
- `process.execPath` → caminho do próprio `.exe`
- Arquivos de config/logs/ícones ficam **ao lado** do executável (não dentro do snapshot)

---

## Limitações conhecidas do pkg

| Limitação | Impacto no nosso app | Mitigação |
|-----------|----------------------|-----------|
| Binários nativos externos | systray2 precisa do `.exe` ao lado | `copyDir` + cópia no build.js |
| `__dirname` aponta para snapshot | paths de config/logs errados | usar `baseDir` baseado em `execPath` |
| Dynamic require | alguns módulos quebram | listar em `scripts`/`assets` |
| Tamanho (~30-50 MB) | normal com Node embutido | compressão GZip/Brotli |
| Antivirus | às vezes flag o binário Go | assinar o .exe (opcional) |

---

## Alternativas ao pkg (se precisar)

| Ferramenta | Prós | Contras |
|------------|------|---------|
| **pkg** | simples, 1 arquivo | binários externos manuais |
| **nexe** | similar | menos manutenção |
| **Electron + electron-builder** | tray nativo estável, UI fácil | bem maior (~100 MB+) |
| **node-sea** (Node 20+) | oficial | ainda experimental, menos docs |

Para este monitor, **pkg + copyDir** é a melhor relação tamanho/complexidade.

---

## Checklist de build

- [ ] `npm install` (garante traybin)
- [ ] `assets/icon.ico` existe
- [ ] `config/config.default.json` existe
- [ ] `src/tray.js` tem `copyDir: true`
- [ ] `npm run build`
- [ ] `dist/tray_windows_release.exe` presente
- [ ] Testar o `.exe` em máquina Windows limpa
EOF