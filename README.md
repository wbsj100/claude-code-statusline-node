# 🤖 Claude Code Statusline Node (ADR-015)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)
[![Latency](https://img.shields.io/badge/Latency-~166ms-blue.svg)]()
[![Architecture](https://img.shields.io/badge/ADR-015%20%2F%20ADR-028-purple.svg)]()

> **Statusline de alta performance, resiliente e nativa em Node.js para a CLI do Claude Code.**  
> Criada para eliminar congelamentos de terminal (*flickering*), parsing síncrono pesado e estourar de contexto desapercebido.

---

## 👨‍💻 Autor

- **Wilson B. S. Junior** ([@wbsj100](https://github.com/wbsj100))

---

## 📌 Problema Resolvido

Nas versões anteriores e em scripts baseados em Shell (`Bash` / `jq` / `awk`), a leitura síncrona dos arquivos de histórico (`transcript.jsonl`) em conversas longas (>10 MB) causava:
1. **Flickering e Piscadas no Terminal:** Repaints constantes da biblioteca Ink.
2. **Congelamento da Barra (Timeout de 10s):** Bloqueio da CLI devido ao parsing pesado de arquivos JSON grandes.
3. **Cegueira de Janela de Contexto:** Erros de estimativa quando ferramentas retornavam grandes volumes de dados (`tool_result`).

---

## ⚡ Solução Arquitetural (ADR-015)

Esta implementação resolve todos os gargalos através dos seguintes pilares:

- 🚀 **Leitura por Cauda de Buffer (`fs.readSync`)**: Em vez de carregar o arquivo inteiro, lê apenas os últimos **4 KB** do arquivo de log, mantendo a leitura constante independentemente de o arquivo ter 1 KB ou 1 GB.
- 🔄 **Compatibilidade v2.1.268+**: Suporte completo ao novo esquema JSON da CLI do Claude Code (resolvendo objetos no campo `workspace` e protegendo o cálculo de porcentagem contra `NaN`).
- 🟢 **Check de Saúde do Proxy em Tempo Real (<15ms)**: Monitoramento socket da porta local `:4000` (LiteLLM Proxy / DeepSeek), alertando visualmente se a conexão com o provedor estiver ativa ou offline.
- 💵 **Badge de Saldo dos Provedores (ADR-028)**: Exibe saldo DeepSeek e gasto/saldo OpenRouter. Cache em disco com TTL de 10 min — a atualização ocorre em background e o render **nunca** espera rede.
- 🌿 **Detecção Automática de Git Branch**: Identifica de forma não-bloqueante em qual branch o desenvolvedor está trabalhando.
- 🛡️ **Zero-Crash Safety**: Tratamento de exceções absoluto (`try-catch` com fallback), garantindo que falhas de leitura no Windows nunca emitam tracebacks no terminal.
- 📐 **Barras Mono-width Universais (`■/□`)**: Layout limpo, sem caracteres com largura variável.

### ⏱️ Nota sobre latência

O alvo histórico de `<3ms` / `<5ms` **não é atingível** nesta implementação no Windows: o piso é o próprio *startup* do Node.js, medido em **~160ms**. O ganho real da leitura por cauda de buffer está em **manter a latência constante** (não crescer com o tamanho do transcript), não em atingir poucos milissegundos.

**Baseline de referência: ~166ms.** Compare contra este valor; um número muito abaixo indica que o script falhou e caiu no `catch` de fallback.

### 🔐 Dependência de confiança TLS (badge de saldo)

O badge consulta `api.deepseek.com` e `openrouter.ai`. Se a rede local usar **inspeção SSL** (antivírus com *SSL scanning*, proxy corporativo), o Node rejeitará os certificados — ele não lê o repositório de CAs do Windows. Sintoma: **badge ausente com o proxy saudável**.

Solução: exportar as CAs raiz do Windows e apontar `NODE_EXTRA_CA_CERTS` para o bundle (mantém a verificação TLS **ativa**).

```bash
# Exportar (PowerShell)
$store = New-Object System.Security.Cryptography.X509Certificates.X509Store('Root','LocalMachine')
$store.Open('ReadOnly'); $store.Certificates | % { $_.RawData } # ver script no ADR-028
```

```json
// settings.json
"NODE_EXTRA_CA_CERTS": "C:\\Users\\<usuario>\\.secrets\\windows-roots.pem"
```

---

## 🧙‍♂️ Skill de Gerenciamento Automatizado

O projeto inclui uma **Skill nativa para Claude Code / Antigravity**: [`skills/statusline-setup/SKILL.md`](./skills/statusline-setup/SKILL.md).

Ao instalar a skill em `~/.claude/skills/statusline-setup`, você ganha acesso aos comandos:
- `/statusline-setup`: Validação e instalação automática da statusline no `settings.json`.
- `/statusline-doctor`: Diagnóstico de latência (<10ms), verificação da porta `:4000` e integridade.

---

## ⚙️ Instalação e Configuração

### 1. Clonar ou Baixar os Arquivos
Copie o script [`statusline.js`](./statusline.js) para o seu diretório de configurações do Claude Code:

- **Windows:** `%USERPROFILE%\.claude\statusline.js`
- **Linux / macOS:** `~/.claude/statusline.js`

### 2. Registrar no `settings.json` do Claude Code
Adicione o comando no seu arquivo global `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node \"C:\\Users\\wil_j\\.claude\\statusline.js\""
  }
}
```

---

## 📄 Licença

Este projeto está licenciado sob a Licença MIT — consulte o arquivo [LICENSE](./LICENSE) para obter detalhes.
