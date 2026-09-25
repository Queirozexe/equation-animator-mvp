(() => {
  'use strict';

  const form = document.getElementById('equationForm');
  const input = document.getElementById('equationInput');
  const message = document.getElementById('message');
  const graphPanel = document.getElementById('graphPanel');
  const canvas = document.getElementById('graphCanvas');
  const ctx = canvas.getContext('2d');
  const actionRow = document.getElementById('actionRow');
  const shareButton = document.getElementById('shareButton');
  const restartButton = document.getElementById('restartButton');

  const DEFAULT_X_MIN = -10;
  const DEFAULT_X_MAX = 10;
  const SAMPLE_COUNT = 2400;
  const DRAW_DURATION_MS = 5000;
  const LOOP_PAUSE_MS = 900;
  const PURPLE = '#a855f7';
  const PURPLE_GLOW = '#c084fc';

  let compiledExpression = null;
  let currentExpression = '';
  let points = [];
  let animationFrame = null;
  let animationStart = 0;
  let resizeTimer = null;

  const knownNames = new Set([
    'x', 'pi', 'e',
    'sin', 'cos', 'tan', 'asin', 'acos', 'atan',
    'sinh', 'cosh', 'tanh',
    'sqrt', 'abs', 'exp', 'log', 'log10', 'ln',
    'floor', 'ceil', 'round', 'sign', 'min', 'max', 'pow'
  ]);

  function setMessage(text = '', type = '') {
    message.textContent = text;
    message.className = `message${type ? ` ${type}` : ''}`;
  }

  function normalizeEquation(raw) {
    let value = raw.trim();

    value = value
      .replace(/[−–—]/g, '-')
      .replace(/[×·]/g, '*')
      .replace(/÷/g, '/')
      .replace(/π/gi, 'pi')
      .replace(/²/g, '^2')
      .replace(/³/g, '^3')
      .replace(/\bsen\s*\(/gi, 'sin(')
      .replace(/\btg\s*\(/gi, 'tan(')
      .replace(/\bln\s*\(/gi, 'log(')
      .replace(/(\d),(\d)/g, '$1.$2');

    value = value.replace(/^\s*y\s*=\s*/i, '');
    value = value.replace(/^\s*f\s*\(\s*x\s*\)\s*=\s*/i, '');

    return value.trim();
  }

  function buildHelpfulError(raw, error) {
    const text = raw.trim();

    if (!text) {
      return 'Digite uma equação antes de desenhar.';
    }

    if (/√/.test(text)) {
      return 'Use sqrt(... ) no lugar de √. Ex.: sqrt(x).';
    }

    const open = (text.match(/\(/g) || []).length;
    const close = (text.match(/\)/g) || []).length;
    if (open !== close) {
      return open > close
        ? 'Há parêntese aberto sem fechamento. Verifique ")".'
        : 'Há parêntese de fechamento a mais. Verifique "(".';
    }

    if (/\*\*|\/\/|\^\^/.test(text)) {
      return 'Há operadores repetidos. Use apenas um operador por vez: +, -, *, / ou ^.';
    }

    if (/\b(sen)\b/i.test(text)) {
      return 'Use sin(x) para seno. O sistema também tenta corrigir "sen(" automaticamente.';
    }

    if (/\b(tg)\b/i.test(text)) {
      return 'Use tan(x) para tangente. O sistema também tenta corrigir "tg(" automaticamente.';
    }

    const detail = error?.message ? error.message.replace(/\s+/g, ' ').trim() : '';
    return detail ? `Não foi possível interpretar a equação: ${detail}` : 'Não foi possível interpretar a equação. Verifique a escrita.';
  }

  function validateSymbols(node) {
    const unknown = new Set();

    node.traverse((child, path, parent) => {
      if (child.type !== 'SymbolNode') return;

      const name = child.name;
      const isFunctionName = parent?.type === 'FunctionNode' && parent.fn === child;
      if (isFunctionName && knownNames.has(name)) return;
      if (!knownNames.has(name)) unknown.add(name);
    });

    if (unknown.size > 0) {
      const names = [...unknown].join(', ');
      throw new Error(`símbolo não reconhecido: ${names}`);
    }
  }

  function parseEquation(raw) {
    if (!window.math) {
      throw new Error('biblioteca matemática ainda não carregou');
    }

    const normalized = normalizeEquation(raw);
    if (!normalized) {
      throw new Error('equação vazia');
    }

    const node = math.parse(normalized);
    validateSymbols(node);
    const compiled = node.compile();

    let hasAtLeastOneRealPoint = false;
    for (let i = 0; i <= 20; i += 1) {
      const x = DEFAULT_X_MIN + (DEFAULT_X_MAX - DEFAULT_X_MIN) * (i / 20);
      try {
        const result = compiled.evaluate({ x });
        if (typeof result === 'number' && Number.isFinite(result)) {
          hasAtLeastOneRealPoint = true;
          break;
        }
      } catch (_) {
        // Algumas equações só possuem domínio real em parte do intervalo.
      }
    }

    if (!hasAtLeastOneRealPoint) {
      throw new Error('nenhum valor real foi encontrado no intervalo visível');
    }

    return { normalized, compiled };
  }

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (compiledExpression) {
      buildPoints();
      drawProgress(1);
    }
  }

  function safeEvaluate(x) {
    try {
      const y = compiledExpression.evaluate({ x });
      if (typeof y !== 'number' || !Number.isFinite(y)) return null;
      return y;
    } catch (_) {
      return null;
    }
  }

  function percentile(sorted, p) {
    if (!sorted.length) return 0;
    const index = (sorted.length - 1) * p;
    const lo = Math.floor(index);
    const hi = Math.ceil(index);
    if (lo === hi) return sorted[lo];
    const weight = index - lo;
    return sorted[lo] * (1 - weight) + sorted[hi] * weight;
  }

  function buildPoints() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const rawPoints = [];
    const yValues = [];

    for (let i = 0; i < SAMPLE_COUNT; i += 1) {
      const ratio = i / (SAMPLE_COUNT - 1);
      const x = DEFAULT_X_MIN + (DEFAULT_X_MAX - DEFAULT_X_MIN) * ratio;
      const y = safeEvaluate(x);
      rawPoints.push({ x, y });
      if (y !== null) yValues.push(y);
    }

    if (!yValues.length) {
      points = [];
      return;
    }

    const sorted = [...yValues].sort((a, b) => a - b);
    let yMin = percentile(sorted, 0.02);
    let yMax = percentile(sorted, 0.98);

    if (!Number.isFinite(yMin) || !Number.isFinite(yMax) || yMin === yMax) {
      yMin = Math.min(...yValues);
      yMax = Math.max(...yValues);
    }

    if (yMin === yMax) {
      yMin -= 1;
      yMax += 1;
    }

    const yPad = (yMax - yMin) * 0.12 || 1;
    yMin -= yPad;
    yMax += yPad;

    const paddingX = Math.max(18, width * 0.055);
    const paddingY = Math.max(18, height * 0.05);
    const graphWidth = width - paddingX * 2;
    const graphHeight = height - paddingY * 2;

    points = rawPoints.map((point) => {
      if (point.y === null || point.y < yMin || point.y > yMax) {
        return null;
      }

      const px = paddingX + ((point.x - DEFAULT_X_MIN) / (DEFAULT_X_MAX - DEFAULT_X_MIN)) * graphWidth;
      const py = paddingY + (1 - ((point.y - yMin) / (yMax - yMin))) * graphHeight;
      return { x: px, y: py };
    });
  }

  function clearCanvas() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#07070d';
    ctx.fillRect(0, 0, width, height);
  }

  function drawProgress(progress) {
    clearCanvas();
    if (!points.length) return;

    const maxIndex = Math.max(1, Math.floor(points.length * Math.max(0, Math.min(progress, 1))));

    ctx.save();
    ctx.strokeStyle = PURPLE;
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = PURPLE_GLOW;
    ctx.shadowBlur = 12;

    ctx.beginPath();
    let drawing = false;

    for (let i = 0; i < maxIndex; i += 1) {
      const point = points[i];
      if (!point) {
        drawing = false;
        continue;
      }

      if (!drawing) {
        ctx.moveTo(point.x, point.y);
        drawing = true;
      } else {
        const previous = points[i - 1];
        if (previous && Math.abs(point.y - previous.y) < canvas.clientHeight * 0.42) {
          ctx.lineTo(point.x, point.y);
        } else {
          ctx.moveTo(point.x, point.y);
        }
      }
    }

    ctx.stroke();

    let head = null;
    for (let i = maxIndex - 1; i >= 0; i -= 1) {
      if (points[i]) {
        head = points[i];
        break;
      }
    }

    if (head && progress < 1) {
      ctx.beginPath();
      ctx.arc(head.x, head.y, 4.2, 0, Math.PI * 2);
      ctx.fillStyle = '#e9d5ff';
      ctx.shadowBlur = 18;
      ctx.fill();
    }

    ctx.restore();
  }

  function startAnimation() {
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationStart = performance.now();

    const cycleDuration = DRAW_DURATION_MS + LOOP_PAUSE_MS;

    const step = (now) => {
      const elapsed = now - animationStart;
      const cycleElapsed = elapsed % cycleDuration;

      if (cycleElapsed <= DRAW_DURATION_MS) {
        const progress = Math.min(1, cycleElapsed / DRAW_DURATION_MS);
        const eased = 1 - Math.pow(1 - progress, 3);
        drawProgress(eased);
      } else {
        // Mantém a equação completa visível antes de reiniciar o loop.
        drawProgress(1);
      }

      animationFrame = requestAnimationFrame(step);
    };

    animationFrame = requestAnimationFrame(step);
  }

  function updateUrl(expression) {
    const url = new URL(window.location.href);
    url.searchParams.set('eq', expression);
    window.history.replaceState({}, '', url);
  }

  function clearUrlEquation() {
    const url = new URL(window.location.href);
    url.searchParams.delete('eq');
    window.history.replaceState({}, '', url);
  }

  async function shareCurrentEquation() {
    const url = window.location.href;

    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Equação animada',
          text: currentExpression,
          url
        });
        return;
      } catch (error) {
        if (error?.name === 'AbortError') return;
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      setMessage('Link copiado para a área de transferência.', 'success');
    } catch (_) {
      setMessage(`Copie este link: ${url}`, 'success');
    }
  }

  function renderEquation(raw, { updateHistory = true, animate = true } = {}) {
    try {
      const { normalized, compiled } = parseEquation(raw);
      compiledExpression = compiled;
      currentExpression = normalized;
      input.value = normalized;
      input.setAttribute('aria-invalid', 'false');
      setMessage('');

      graphPanel.hidden = false;
      actionRow.hidden = false;

      requestAnimationFrame(() => {
        resizeCanvas();
        buildPoints();
        if (!points.some(Boolean)) {
          setMessage('A equação foi aceita, mas não gerou pontos reais visíveis.', 'error');
          return;
        }
        if (animate) startAnimation();
      });

      if (updateHistory) updateUrl(normalized);
      return true;
    } catch (error) {
      input.setAttribute('aria-invalid', 'true');
      setMessage(buildHelpfulError(raw, error), 'error');
      graphPanel.hidden = true;
      actionRow.hidden = true;
      compiledExpression = null;
      points = [];
      if (updateHistory) clearUrlEquation();
      return false;
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    renderEquation(input.value);
  });

  input.addEventListener('input', () => {
    input.removeAttribute('aria-invalid');
    if (message.classList.contains('error')) setMessage('');
  });

  shareButton.addEventListener('click', shareCurrentEquation);
  restartButton.addEventListener('click', startAnimation);

  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resizeCanvas, 120);
  });

  window.addEventListener('load', () => {
    const params = new URLSearchParams(window.location.search);
    const equationFromUrl = params.get('eq');

    if (equationFromUrl) {
      input.value = equationFromUrl;
      renderEquation(equationFromUrl, { updateHistory: false, animate: true });
    }
  });
})();
