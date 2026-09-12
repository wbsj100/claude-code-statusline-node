---
name: statusline-setup
description: Skill de gerenciamento, auto-diagnóstico e instalação da Statusline Definitiva do Claude Code (ADR-015 / Node.js). Trigger com /statusline-setup ou /statusline-doctor.
---

# 📊 Skill: Statusline Manager & Doctor (ADR-015)

Esta skill permite gerenciar, reparar, testar a performance e reinstalar a **Statusline Definitiva do Claude Code** no Windows (`WILLMACHINE`).

---

## 📌 Comandos e Triggers

- `/statusline-setup`: Valida e reinstala o script em Node.js e sua vinculação no `settings.json`.
- `/statusline-doctor`: Executa um teste de benchmark de latência (garantindo `<5ms`), checa a saúde do LiteLLM Proxy na porta `:4000` e valida a integridade da configuração.

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

## 🧪 Procedimento de Diagnóstico Automatizado

Quando acionada pelo usuário:
1. Testa a execução do script: `node C:\Users\wil_j\.claude\statusline.js`.
2. Mede o tempo de execução (garantindo `<10ms`).
3. Verifica se a porta `4000` do LiteLLM está respondendo.
4. Garante que `"statusLine"` está registrado corretamente no `settings.json`.
