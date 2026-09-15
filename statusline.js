/**
 * Statusline Definitiva de Produção (ADR-015 — Node.js Nativo)
 *
 * Recursos:
 * 1. Leitura de Contexto Real (context_window + Auto-Discovery de Transcripts de Projeto).
 * 2. Suporte total a Windows (Path Normalization sem bugs de barras).
 * 3. Check de saúde do Proxy LiteLLM (:4000) em tempo real (<15ms socket check).
 * 4. Detecção leve de Git Branch (🌿 main).
 * 5. Proteção Anti-Crash Absoluta com visual mono-width (■/□).
 * 6. Saldo dos provedores (DeepSeek / OpenRouter) com cache em disco.
 */

const fs = require('fs');
const path = require('path');
const net = require('net');
const https = require('https');

const MAX_CONTEXT_TOKENS = 1000000;
const BAR_WIDTH = 10;

// --- Saldo de provedores (cache em disco, TTL longo) -------------------------
// O statusline roda a cada mensagem: consultar as APIs de saldo no caminho
// critico adicionaria latencia inaceitavel. Estrategia: ler SEMPRE do cache
// (sincrono, sub-ms) e disparar a atualizacao em background (fire-and-forget)
// quando o TTL vence, de modo que o render atual nunca espera rede.
const SALDO_TTL_MS = 10 * 60 * 1000; // 10 min
const HOME_DIR = process.env.USERPROFILE || process.env.HOME || '.';
const SALDO_CACHE = path.join(HOME_DIR, '.claude', 'saldo-cache.json');
const SEGREDOS = path.join(HOME_DIR, '.secrets', 'litellm.env');

function lerSegredos() {
  try {
    const txt = fs.readFileSync(SEGREDOS, 'utf8');
    const out = {};
    for (const linha of txt.split(/\r?\n/)) {
      const m = linha.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
    return out;
  } catch (e) {
    return {};
  }
}

function lerCacheSaldo() {
  try {
    return JSON.parse(fs.readFileSync(SALDO_CACHE, 'utf8'));
  } catch (e) {
    return null;
  }
}

function httpGetJson(url, headers, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    try {
      const req = https.get(url, { headers, timeout: timeoutMs }, (res) => {
        let body = '';
        res.on('data', (d) => { body += d; });
        res.on('end', () => {
          try { finish(JSON.parse(body)); } catch (e) { finish(null); }
        });
      });
      req.on('timeout', () => { req.destroy(); finish(null); });
      req.on('error', () => finish(null));
    } catch (e) {
      finish(null);
    }
  });
}

// Promises de atualizacao de saldo, aguardadas SOMENTE no encerramento do
// processo (ver finish). Declaradas antes de quem as usa.
const pendentesSaldo = [];

// Fire-and-forget: nunca aguardado pelo render. Se falhar, o cache anterior
// permanece valido e o badge continua exibindo o ultimo valor conhecido.
function atualizarSaldoBackground() {
  const seg = lerSegredos();
  if (!seg.DEEPSEEK_API_KEY && !seg.OPENROUTER_API_KEY) return;

  const dsJob = seg.DEEPSEEK_API_KEY
    ? httpGetJson('https://api.deepseek.com/user/balance',
        { Authorization: `Bearer ${seg.DEEPSEEK_API_KEY}` }, 4000)
        .then((d) => {
          if (!d || !Array.isArray(d.balance_infos)) return null;
          const b = d.balance_infos[0] || {};
          const n = parseFloat(b.total_balance);
          return isNaN(n) ? null : { usd: n, cur: b.currency || 'USD' };
        })
    : Promise.resolve(null);

  const orJob = seg.OPENROUTER_API_KEY
    ? httpGetJson('https://openrouter.ai/api/v1/key',
        { Authorization: `Bearer ${seg.OPENROUTER_API_KEY}` }, 4000)
        .then((d) => {
          const k = d && d.data;
          if (!k) return null;
          const rem = k.limit_remaining;
          const used = parseFloat(k.usage);
          const temTeto = rem !== null && rem !== undefined && !isNaN(parseFloat(rem));
          return {
            usd: temTeto ? parseFloat(rem) : null,
            usado: isNaN(used) ? null : used
          };
        })
    : Promise.resolve(null);

  const gravacao = Promise.all([dsJob, orJob])
    .then(([ds, orr]) => {
      try {
        fs.writeFileSync(SALDO_CACHE,
          JSON.stringify({ ts: Date.now(), deepseek: ds, openrouter: orr }));
      } catch (e) {}
    })
    .catch(() => {});

  // O processo nao pode encerrar antes da gravacao: sem esta espera explicita,
  // o statusline imprime e chama process.exit(0), matando as requisicoes em voo
  // e deixando o cache permanentemente frio. O render NAO aguarda este promise -
  // apenas o encerramento do processo aguarda (ver finish()).
  pendentesSaldo.push(gravacao);
}

function badgeSaldo() {
  const c = lerCacheSaldo();
  if (!c) {
    atualizarSaldoBackground(); // cache frio: dispara e omite o badge neste render
    return '';
  }
  if (Date.now() - (c.ts || 0) >= SALDO_TTL_MS) atualizarSaldoBackground();

  const ds = c.deepseek, orr = c.openrouter;
  const partes = [];
  if (ds && typeof ds.usd === 'number') {
    partes.push(`💵 DS $${ds.usd < 1 ? ds.usd.toFixed(2) : ds.usd.toFixed(1)}`);
  }
  if (orr) {
    // Sem teto configurado, limit_remaining vem null: exibe o gasto acumulado.
    if (typeof orr.usd === 'number') {
      partes.push(`OR $${orr.usd < 1 ? orr.usd.toFixed(2) : orr.usd.toFixed(1)}`);
    } else if (typeof orr.usado === 'number') {
      partes.push(`OR gasto $${orr.usado.toFixed(0)}`);
    }
  }
  if (!partes.length) return '';
  const idade = Math.round((Date.now() - (c.ts || 0)) / 60000);
  return ` │ ${partes.join(' · ')}${idade > 15 ? ` (${idade}m)` : ''}`;
}


function formatModelName(rawModel) {
  if (!rawModel) return 'DeepSeek V4';
  const modelStr = String(rawModel).toLowerCase();
  if (modelStr.includes('deepseek') || modelStr.includes('opus') || modelStr.includes('sonnet') || modelStr.includes('haiku')) {
    return 'DeepSeek V4';
  }
  return rawModel;
}

function renderProgressBar(percentage) {
  const filledLength = Math.min(BAR_WIDTH, Math.max(0, Math.round((percentage / 100) * BAR_WIDTH)));
  const emptyLength = BAR_WIDTH - filledLength;
  return '■'.repeat(filledLength) + '□'.repeat(emptyLength);
}

function getGitBranch(cwd) {
  try {
    const headPath = path.join(cwd, '.git', 'HEAD');
    if (fs.existsSync(headPath)) {
      const content = fs.readFileSync(headPath, 'utf8').trim();
      if (content.startsWith('ref: refs/heads/')) {
        return content.replace('ref: refs/heads/', '');
      }
    }
  } catch (e) {}
  return null;
}

function checkPort(port, host, callback) {
  const socket = new net.Socket();
  socket.setTimeout(15);
  socket.on('connect', () => {
    socket.destroy();
    callback(true);
  });
  socket.on('timeout', () => {
    socket.destroy();
    callback(false);
  });
  socket.on('error', () => {
    socket.destroy();
    callback(false);
  });
  socket.connect(port, host);
}

function findLatestProjectTranscript(cwd) {
  try {
    const userHome = process.env.USERPROFILE || process.env.HOME || 'C:\\Users\\wil_j';
    const targetCwd = cwd || process.cwd();
    const folderName = targetCwd.replace(/[:\\\/]+/g, '-');
    const projDir = path.join(userHome, '.claude', 'projects', folderName);
    if (!fs.existsSync(projDir)) return null;

    const files = fs.readdirSync(projDir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => ({
        path: path.join(projDir, f),
        mtime: fs.statSync(path.join(projDir, f)).mtimeMs
      }))
      .sort((a, b) => b.mtime - a.mtime);

    return files.length > 0 ? files[0].path : null;
  } catch (e) {
    return null;
  }
}

function estimateTokensFromTranscript(transcriptPath, cwd) {
  let targetFile = transcriptPath;
  const userHome = process.env.USERPROFILE || process.env.HOME || 'C:\\Users\\wil_j';

  if (targetFile && targetFile.startsWith('~')) {
    targetFile = path.join(userHome, targetFile.replace(/^~[\\\/]/, ''));
  }

  if (!targetFile || !fs.existsSync(targetFile)) {
    targetFile = findLatestProjectTranscript(cwd);
  }

  if (!targetFile || !fs.existsSync(targetFile)) return 0;

  try {
    const content = fs.readFileSync(targetFile, 'utf8');
    const lines = content.split('\n');
    let totalChars = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line || (!line.includes('"user"') && !line.includes('"assistant"'))) continue;
      try {
        const d = JSON.parse(line);
        if (d.type === 'user' || d.type === 'assistant') {
          const msg = d.message;
          if (msg && msg.content) {
            if (typeof msg.content === 'string') {
              totalChars += msg.content.length;
            } else if (Array.isArray(msg.content)) {
              for (let j = 0; j < msg.content.length; j++) {
                const part = msg.content[j];
                if (part) {
                  if (part.text) totalChars += part.text.length;
                  if (part.input) totalChars += JSON.stringify(part.input).length;
                }
              }
            }
          }
        }
      } catch (e) {}
    }

    return Math.round(totalChars / 3.5);
  } catch (e) {
    return 0;
  }
}

function buildStatusLine(inputData, proxyOnline) {
  try {
    let modelName = 'DeepSeek V4';
    let tokenCount = 0;
    let cwd = process.cwd();
    let workspace = path.basename(cwd) || 'SecondBrain';
    let maxContextWindow = MAX_CONTEXT_TOKENS;

    if (inputData) {
      const parsed = typeof inputData === 'string' ? JSON.parse(inputData) : inputData;
      if (parsed.model) modelName = formatModelName(parsed.model.display_name || parsed.model.id || parsed.model);

      if (typeof parsed.cwd === 'string' && parsed.cwd) {
        cwd = parsed.cwd;
      } else if (typeof parsed.workspace === 'string' && parsed.workspace) {
        cwd = parsed.workspace;
      } else if (parsed.workspace && typeof parsed.workspace === 'object') {
        cwd = parsed.workspace.current_dir || parsed.workspace.project_dir || cwd;
      }

      if (typeof cwd === 'string' && cwd) {
        workspace = path.basename(cwd) || 'SecondBrain';
      } else {
        cwd = process.cwd();
        workspace = path.basename(cwd) || 'SecondBrain';
      }

      const ctxObj = parsed.context_window || {};
      if (ctxObj.context_window_size) {
        maxContextWindow = Number(ctxObj.context_window_size) || MAX_CONTEXT_TOKENS;
      }

      let rawNativeTokens = 0;
      if (typeof ctxObj.total_input_tokens === 'number' && !isNaN(ctxObj.total_input_tokens)) {
        rawNativeTokens = ctxObj.total_input_tokens;
      } else if (typeof ctxObj.used_percentage === 'number' && !isNaN(ctxObj.used_percentage) && ctxObj.used_percentage > 0) {
        rawNativeTokens = Math.round((ctxObj.used_percentage / 100) * maxContextWindow);
      } else if (ctxObj.current_usage && typeof ctxObj.current_usage === 'object') {
        const inTok = Number(ctxObj.current_usage.input_tokens || 0) || 0;
        const cacheTok = Number(ctxObj.current_usage.cache_read_input_tokens || 0) || 0;
        const createTok = Number(ctxObj.current_usage.cache_creation_input_tokens || 0) || 0;
        rawNativeTokens = inTok + cacheTok + createTok;
      } else if (typeof ctxObj.input_tokens === 'number' && !isNaN(ctxObj.input_tokens)) {
        rawNativeTokens = ctxObj.input_tokens;
      } else {
        rawNativeTokens = Number(
          parsed.tokens ||
          parsed.total_tokens ||
          parsed.context_tokens ||
          0
        ) || 0;
      }

      if (isNaN(rawNativeTokens)) rawNativeTokens = 0;

      const transcriptTokens = estimateTokensFromTranscript(parsed.transcript_path, cwd);
      tokenCount = Math.max(rawNativeTokens, transcriptTokens);
    } else {
      tokenCount = estimateTokensFromTranscript(null, cwd);
    }

    const percentage = Math.min(100, Math.max(0, Math.round((tokenCount / maxContextWindow) * 100)));
    const progressBar = renderProgressBar(percentage);
    const formattedTokens = tokenCount >= 1000 ? `${(tokenCount / 1000).toFixed(1)}k` : `${tokenCount}`;
    const gitBranch = getGitBranch(cwd);

    // ANSI Colors
    const cyan = '\x1b[36m';
    const green = '\x1b[32m';
    const red = '\x1b[31m';
    const yellow = '\x1b[33m';
    const magenta = '\x1b[35m';
    const reset = '\x1b[0m';

    const proxyBadge = proxyOnline ? `${green}🟢 :4000${reset}` : `${red}🔴 :4000${reset}`;
    const branchBadge = gitBranch ? ` │ ${magenta}🌿 ${gitBranch}${reset}` : '';
    const saldoBadge = badgeSaldo();

    return `${proxyBadge} │ ${cyan}🤖 ${modelName}${reset} │ ${green}[${progressBar}] ${percentage}%${reset} (${formattedTokens})${branchBadge}${saldoBadge} │ ${yellow}📁 ${workspace}${reset}`;
  } catch (e) {
    return `🟢 :4000 │ 🤖 DeepSeek V4 │ [□□□□□□□□□□] 0% │ 📁 SecondBrain`;
  }
}

let rawInput = '';
let processed = false;

function finish(input, online) {
  if (processed) return;
  processed = true;

  // 1. Imprime IMEDIATAMENTE: o render nunca espera rede.
  const linha = buildStatusLine(input, online);
  console.log(linha);

  // 2. So o encerramento aguarda as gravacoes de saldo pendentes. Teto de
  //    seguranca para nao segurar o statusline caso a rede esteja lenta.
  if (!pendentesSaldo.length) {
    process.exit(0);
    return;
  }
  Promise.race([
    Promise.all(pendentesSaldo),
    new Promise((r) => setTimeout(r, 4500))
  ]).finally(() => process.exit(0));
}

if (process.stdin.isTTY) {
  checkPort(4000, '127.0.0.1', (online) => {
    finish(null, online);
  });
} else {
  process.stdin.setEncoding('utf8');

  process.stdin.on('data', (chunk) => {
    rawInput += chunk;
  });

  process.stdin.on('end', () => {
    checkPort(4000, '127.0.0.1', (online) => {
      finish(rawInput, online);
    });
  });

  setTimeout(() => {
    checkPort(4000, '127.0.0.1', (online) => {
      finish(rawInput, online);
    });
  }, 500);
}
