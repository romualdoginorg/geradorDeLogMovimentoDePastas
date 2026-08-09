# Contrato da API – Monitor de Produtividade

Documento para o **servidor backend** que recebe os dados das máquinas.

---

## 1. Endpoint que o agente chama (cliente → servidor)

O agente faz `POST` na URL configurada em `config.envio.url`.

### Headers

| Header | Valor |
|--------|--------|
| `Content-Type` | `application/json` |
| `Authorization` | `Bearer {token}` (se configurado) |
| `X-Monitor-Hostname` | Nome da máquina |
| `X-Monitor-Version` | Versão do app (ex: `1.0.0`) |

### Body (JSON)

```json
{
  "schema": "monitor-produtividade/v1",
  "origem": "monitor-produtividade",
  "versaoApp": "1.0.0",
  "motivoEnvio": "periodico",
  "timestampEnvio": "2026-08-09T19:00:00.000Z",

  "maquina": {
    "nome": "PC-FINANCEIRO-01",
    "nomeCompleto": "EMPRESA\\PC-FINANCEIRO-01",
    "usuario": "joao.silva",
    "usuarioCompleto": "EMPRESA\\joao.silva",
    "dominio": "EMPRESA",
    "plataforma": "win32",
    "arquitetura": "x64",
    "versaoSO": "10.0.22631",
    "tipoSO": "Windows_NT",
    "uptimeSegundos": 86400,
    "cpus": 8,
    "memoriaTotalMB": 16384,
    "memoriaLivreMB": 4200,
    "ipPrincipal": "192.168.1.45",
    "macPrincipal": "AA:BB:CC:DD:EE:FF",
    "ips": [
      { "interface": "Ethernet", "endereco": "192.168.1.45", "mac": "AA:BB:CC:DD:EE:FF" }
    ],
    "fabricante": "Dell Inc.",
    "modelo": "OptiPlex 7090",
    "serialBios": "ABC123XYZ",
    "pid": 12345,
    "nodeVersion": "v18.20.0",
    "coletadoEm": "2026-08-09T19:00:00.000Z"
  },

  "quantidade": 3,
  "eventos": [
    {
      "origem": "TERMINAL",
      "evento": "SESSAO_INICIADA",
      "usuario": "EMPRESA\\joao.silva",
      "nomeMaquina": "PC-FINANCEIRO-01",
      "dataHoraBoot": "2026-08-09T08:00:00.000Z",
      "dataHoraInicioMonitoramento": "2026-08-09T08:05:00.000Z"
    },
    {
      "origem": "TERMINAL",
      "evento": "USO_PROGRAMA",
      "usuario": "EMPRESA\\joao.silva",
      "nomeMaquina": "PC-FINANCEIRO-01",
      "programa": "excel.exe",
      "tituloJanela": "Planilha.xlsx - Excel",
      "dataHora": "2026-08-09T10:15:00.000Z"
    },
    {
      "origem": "TERMINAL",
      "evento": "PAUSA_INATIVIDADE",
      "usuario": "EMPRESA\\joao.silva",
      "nomeMaquina": "PC-FINANCEIRO-01",
      "tempoPausaMinutos": 12,
      "dataHoraInicioPausa": "2026-08-09T11:00:00.000Z"
    }
  ]
}
```

### Valores de `motivoEnvio`

| Valor | Quando ocorre |
|-------|----------------|
| `periodico` | Timer de envio automático |
| `manual` | Usuário clicou “Enviar dados agora” na bandeja |
| `ao_sair` | App sendo encerrado |
| `solicitacao_servidor` | Servidor chamou o endpoint local `/enviar` |
| `heartbeat` | Heartbeat periódico (pode ter `quantidade: 0`) |

### Tipos de `eventos[].evento`

| Evento | Descrição |
|--------|-----------|
| `SESSAO_INICIADA` | Monitor começou a observar a sessão |
| `PAUSA_INATIVIDADE` | Usuário ficou ocioso além do limite |
| `RETORNO_PAUSA` | Usuário voltou a interagir |
| `USO_PROGRAMA` | Programa com janela foi aberto |
| `PROGRAMA_FECHADO` | Programa com janela foi fechado |

### Resposta esperada do servidor

O agente considera sucesso qualquer status **2xx**.

Sugestão de resposta:

```json
{
  "ok": true,
  "recebidos": 3,
  "idLote": "lote-uuid-opcional",
  "mensagem": "OK"
}
```

Em caso de erro (4xx/5xx), o agente **mantém** os eventos no buffer e tenta de novo depois.

---

## 2. Chaves sugeridas para indexação / busca no servidor

Use estas chaves para registrar e pesquisar depois:

| Campo | Uso |
|-------|-----|
| `maquina.nome` | Identificador principal da máquina |
| `maquina.serialBios` | Identidade física (quando disponível) |
| `maquina.macPrincipal` | Identidade de rede |
| `maquina.usuarioCompleto` | Quem estava logado |
| `maquina.ipPrincipal` | Rede no momento do envio |
| `motivoEnvio` | Tipo do lote |
| `timestampEnvio` | Ordenação temporal |
| `eventos[].evento` | Filtro por tipo de atividade |
| `eventos[].programa` | Apps mais usados |

Exemplo de documento em banco:

```
maquinas/{nomeMaquina}
  - ultimoHeartbeat
  - usuarioAtual
  - ipAtual
  - serialBios
  - ...

eventos/{id}
  - nomeMaquina
  - usuario
  - tipo
  - programa
  - dataHora
  - loteId
```

---

## 3. Endpoint local no agente (servidor → cliente)

O agente sobe um HTTP local (padrão `127.0.0.1:17340`).

### Configuração

```json
"comandoRemoto": {
  "habilitado": true,
  "host": "127.0.0.1",
  "port": 17340,
  "token": "SEU_TOKEN_SECRETO"
}
```

- `127.0.0.1` → só a própria máquina
- `0.0.0.0` → acessível na rede (use **sempre** com `token`)

### Rotas

#### `GET /health`

Sem autenticação obrigatória.

```json
{
  "ok": true,
  "servico": "monitor-produtividade",
  "nomeMaquina": "PC-FINANCEIRO-01",
  "usuario": "EMPRESA\\joao.silva",
  "uptimeSegundos": 86400,
  "timestamp": "2026-08-09T19:00:00.000Z"
}
```

#### `GET /maquina`

Requer token (se configurado).

Retorna o objeto completo `maquina`.

#### `POST /enviar` ou `GET /enviar`

**Força o envio imediato** dos eventos pendentes (+ metadados).

Headers:
```
X-Token: SEU_TOKEN_SECRETO
```
ou query: `?token=SEU_TOKEN_SECRETO`

Resposta:

```json
{
  "ok": true,
  "enviados": 12,
  "mensagem": "Enviado com sucesso",
  "nomeMaquina": "PC-FINANCEIRO-01",
  "timestamp": "2026-08-09T19:05:00.000Z"
}
```

### Exemplos (do servidor ou de um script admin)

```bash
# Descobrir se a máquina está online
curl http://192.168.1.45:17340/health

# Forçar coleta/envio agora
curl -X POST http://192.168.1.45:17340/enviar \
  -H "X-Token: SEU_TOKEN_SECRETO"

# Metadados
curl http://192.168.1.45:17340/maquina \
  -H "X-Token: SEU_TOKEN_SECRETO"
```

---

## 4. Fluxos típicos no servidor

### A) Registro contínuo
1. Agente envia periodicamente / heartbeat
2. Servidor atualiza `maquinas[nome].ultimoContato`
3. Se `ultimoContato` > X minutos → máquina offline

### B) Solicitação sob demanda
1. Admin clica “Atualizar agora” no painel
2. Servidor chama `POST http://{ip}:17340/enviar` com token
3. Agente envia o lote na hora
4. Servidor processa e grava

### C) Pesquisa histórica
```
WHERE maquina.nome = 'PC-FINANCEIRO-01'
  AND eventos.evento = 'USO_PROGRAMA'
  AND eventos.programa LIKE '%excel%'
  AND timestamp BETWEEN ... AND ...
```

---

## 5. Segurança recomendada

1. Defina `comandoRemoto.token` forte
2. Em rede interna, use `host: "0.0.0.0"` só se necessário
3. Preferir HTTPS no `envio.url`
4. Token de envio (`envio.token`) diferente do token de comando remoto
5. Firewall: liberar a porta 17340 só para IPs do servidor de gestão
EOF