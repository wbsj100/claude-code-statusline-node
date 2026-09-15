---
name: statusline-setup
description: Skill de gerenciamento, auto-diagnóstico e instalação da Statusline Definitiva do Claude Code (ADR-015 / Node.js). Trigger com /statusline-setup ou /statusline-doctor.
---

# 📊 Skill: Statusline Manager & Doctor (ADR-015)

Esta skill permite gerenciar, reparar, testar a performance e reinstalar a **Statusline Definitiva do Claude Code** no Windows (`WILLMACHINE`).

---

## 📌 Comandos e Triggers

- `/statusline-setup`: Valida e reinstala o script em Node.js e sua vinculação no `settings.json`.
- `/statusline-doctor`: Executa benchmark de latência, checa a saúde do LiteLLM Proxy na porta `:4000`, valida a integridade da configuração **e o estado do badge de saldo**.

---

## 🛠️ Especificação de Arquitetura

1. **Script Principal:** [`C:\Users\wil_j\.claude\statusline.js`](file:///C:/Users/wil_j/.claude/statusline.js)
2. **Configuração Global:** [`C:\Users\wil_j\.claude\settings.json`](file:///C:/Users/wil_j/.claude/settings.json)
3. **Padrões Técnicos Cumpridos (ADR-015 / v2.1.268):**
   - **Zero Subprocessos:** Execução direta em Node.js nativo sem utilizar Shell pipelines (`jq`/`awk`).
   - **Buffer Reading:** Leitura de cauda de arquivo (`fs.readSync` nos últimos 4KB) para latência constante em qualquer tamanho de histórico.
   - **Suporte a Objetos v2.1.268:** Leitura resiliente do campo `workspace` (`current_dir` / `project_dir`) prevenindo `TypeError` no `path.basename`.
   - **Cálculo Nativo Anti-NaN:** Priorização de `total_input_tokens` com fallback seguro para `input_tokens + cache_read + cache_creation`.
   - **Saúde do Proxy:** Socket check não-bloqueante na porta `4000` (`127.0.0.1`).
   - **Mono-width Universais (`■/□`):** Eliminação de *flickering* (piscadas de layout).
   - **Zero-Crash Safety:** Bloco `try-catch` absoluto com fallback resiliente.

---

## 💵 Badge de Saldo (ADR-028 — adicionado 2026-09-15)

Layout atual:

```
🟢 :4000 │ 🤖 DeepSeek V4 │ [■□□□□□□□□□] 5% (50.0k) │ 💵 DS $2.46 · OR gasto $180 │ 📁 SecondBrain
```

**Arquitetura — o render NUNCA espera rede:**

| Componente | Mecanismo |
|---|---|
| Cache | `~/.claude/saldo-cache.json`, TTL **10 min** |
| Leitura | **Síncrona** do cache (sub-ms) — sempre no caminho crítico |
| Atualização | **Fire-and-forget** em background quando o TTL vence |
| Encerramento | Aguarda a gravação com teto de **4,5s** (`Promise.race`) |
| Segredos | Lê `~/.secrets/litellm.env` — parser próprio, sem dependências |

**Fontes consultadas:** `api.deepseek.com/user/balance` (saldo) · `openrouter.ai/api/v1/key` (`limit_remaining` ou `usage`).

**Semântica do badge:**
- `DS $X` → saldo restante DeepSeek.
- `OR $X` → saldo restante OpenRouter, quando há teto configurado.
- `OR gasto $Y` → OpenRouter **sem teto** (`limit_remaining: null`) — exibe gasto acumulado.
- Sufixo `(Nm)` aparece quando o cache tem mais de 15 min (rede indisponível).
- Ausência total do badge = cache frio ou consultas falhando.

**Dependência externa crítica — confiança TLS:**

A rede é inspecionada por SSL (Kaspersky Anti-Virus), que reassina certificados. O Node **não** lê o repositório de CAs do Windows. Sem:

```json
// settings.json
"NODE_EXTRA_CA_CERTS": "C:\\Users\\wil_j\\.secrets\\windows-roots.pem"
```

…as duas consultas retornam `null` e o badge **não aparece**. Sintoma: badge ausente com o proxy `🟢 :4000` saudável. Diagnóstico: `node -e "require('https').get('https://api.deepseek.com/',...)"` — se der `self-signed certificate in certificate chain`, é isto.

---

## 🧪 Procedimento de Diagnóstico Automatizado

Quando acionada pelo usuário:
1. Testa a execução do script: `node C:\Users\wil_j\.claude\statusline.js`.
2. Mede o tempo de execução. **Baseline real: ~166ms** — o alvo histórico de `<5ms` / `<10ms` **não é atingível** neste Windows (o piso é o startup do Node, ~160ms). Comparar contra 166ms, não contra 5ms.
3. Verifica se a porta `4000` do LiteLLM está respondendo.
4. Garante que `"statusLine"` está registrado corretamente no `settings.json`.
5. **Verifica o badge de saldo:** `NODE_EXTRA_CA_CERTS` presente em `settings.json`, `~/.secrets/windows-roots.pem` existente, e `~/.claude/saldo-cache.json` com `ts` recente.

> ⚠️ **Ao testar o script manualmente, gere o JSON de entrada com um parser, não com `echo` no shell.** O Git Bash consome barras invertidas em todas as camadas de escape, produzindo `"current_dir":"C:SecondBrain"` → `JSON.parse` lança → o `try-catch` retorna o fallback e o badge nunca é alcançado. Isto simula uma falha inexistente e já custou tempo de diagnóstico.
