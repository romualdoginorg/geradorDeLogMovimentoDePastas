# Monitor Servidor – Gestão de terminais e pastas

Recebe dados dos agentes (terminais), registra máquinas/usuários e monitora movimentação de pastas compartilhadas no Windows Server.

## Estrutura

```
server/
├── src/
│   ├── main.js            # entrada
│   ├── api.js             # HTTP – recebe lotes dos terminais
│   ├── store.js           # persistência (JSON / JSONL)
│   ├── folder-monitor.js  # eventos Security 4663/4624/4634
│   ├── config.js
│   └── logger.js
├── config/
│   └── config.default.json
├── data/                  # gerado em runtime
│   ├── maquinas.json
│   ├── usuarios.json
│   └── eventos/YYYY-MM-DD.jsonl
└── logs/
```

## Como rodar

```bash
cd server
npm install
npm start
```

API padrão: `http://0.0.0.0:3847`

## Configuração do agente (terminal)

Em `config/config.json` do agente:

```json
"envio": {
  "habilitado": true,
  "url": "http://IP_DO_SERVIDOR:3847/api/eventos",
  "token": "",
  "intervaloEnvioMinutos": 15,
  "heartbeatMinutos": 30
}
```

Se definir `api.token` no servidor, use o mesmo valor em `envio.token` no agente.

## Endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/api/eventos` | Recebe lote do terminal (contrato v1) |
| GET | `/api/health` | Status + resumo |
| GET | `/api/resumo` | Totais de máquinas/usuários |
| GET | `/api/maquinas` | Cadastro de máquinas |
| GET | `/api/usuarios` | Cadastro de usuários |
| GET | `/api/eventos?data=&nomeMaquina=&usuario=&fonte=&limite=` | Consulta eventos |

### Exemplos

```bash
# Health
curl http://localhost:3847/api/health

# Máquinas
curl http://localhost:3847/api/maquinas

# Eventos de hoje de uma máquina
curl "http://localhost:3847/api/eventos?nomeMaquina=PC-01&limite=50"

# Só movimentação de pastas
curl "http://localhost:3847/api/eventos?fonte=SERVIDOR_PASTAS"
```

## Monitor de pastas (Windows Server)

Usa o log de Segurança:

- **4624** – logon de rede (tipos 3 e 10)
- **4634** – logoff
- **4663** – acesso a arquivo/pasta (criação, modificação, exclusão, acesso)

**Pré-requisito:** auditoria de acesso a objetos habilitada nas pastas compartilhadas (GPO / propriedades da pasta → Auditoria).

Eventos gravados com `fonte: "SERVIDOR_PASTAS"` e ações:

- `LOGIN_REDE`, `LOGOUT_REDE`
- `CRIACAO_REDE`, `MODIFICACAO_REDE`, `EXCLUSAO_REDE`, `ACESSO_PASTA`
- `OCIOSO_REDE`

## Dados persistidos

| Arquivo | Conteúdo |
|---------|----------|
| `data/maquinas.json` | Último contato, IP, usuário, hardware |
| `data/usuarios.json` | Última atividade, máquina, contagem |
| `data/eventos/YYYY-MM-DD.jsonl` | Todos os eventos (terminal + pastas) |

## Gestão

- **Máquinas online:** `ultimoContato` < 45 minutos no resumo
- **Busca futura:** filtre por `nomeMaquina`, `usuario`, `fonte`, `data`
- **Forçar envio no terminal:** chame o endpoint local do agente (`POST http://IP_AGENTE:17340/enviar`)
EOF