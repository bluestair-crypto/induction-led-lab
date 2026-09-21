(() => {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const state = {
    x: 0,
    previousX: 0,
    velocity: 0,
    commandedDirection: 0,
    autoOscillate: false,
    autoDirection: -1,
    speedMode: 'normal',
    dragging: false,
    dragSamples: [],
    emf: 0,
    flux: 1,
    fluxRate: 0,
    lastTime: performance.now(),
    graph: [],
    graphAccumulator: 0,
    slowMotion: false,
    currentQuestion: 0
  };

  const elements = {
    apparatus: $('#apparatus'), magnet: $('#magnet'), ledA: $('.led-a'), ledB: $('.led-b'),
    currentArrows: $('#currentArrows'), diodeSymbols: $('#diodeSymbols'), diodeExplanation: $('#diodeExplanation'),
    diodeAState: $('#diodeAState'), diodeBState: $('#diodeBState'), direction: $('#directionValue'),
    speed: $('#speedValue'), flux: $('#fluxValue'), emf: $('#emfValue'), current: $('#currentValue'),
    led: $('#ledValue'), lamp: $('#inductionLamp'), summary: $('#liveSummary'), energyFlow: $('#energyFlow'),
    energyStatus: $('#energyStatus'), chart: $('#emfChart'), graphSection: $('#graphSection')
  };

  const SPEEDS = { slow: 0.28, normal: 0.55, fast: 0.92 };
  const ACTIVE_THRESHOLD = 0.035;
  const MAX_X = 0.88;
  const questions = [
    ['자석을 코일 근처에서 움직이지 않고 가만히 두면 LED는 어떻게 될까요?', '자석이 코일 가까이에 있어도 움직이지 않으면 자기선속이 변하지 않습니다. 따라서 유도 기전력은 0에 가까워지고 두 LED 모두 꺼집니다.'],
    ['자석을 더 빠르게 움직이면 LED의 밝기는 어떻게 될까요?', '같은 구간에서 자석을 더 빠르게 움직이면 자기선속의 변화율이 커집니다. 유도 기전력의 크기가 커지므로 켜지는 LED가 더 밝아집니다.'],
    ['자석의 운동 방향을 반대로 하면 어떤 변화가 나타날까요?', '같은 위치에서 운동 방향을 반대로 하면 자기선속 변화의 부호가 바뀌어 유도 기전력과 전류의 방향이 반대가 됩니다. 따라서 반대 방향으로 연결된 다른 LED가 켜집니다.'],
    ['왜 자석의 운동 방향에 따라 서로 다른 LED가 켜질까요?', 'LED는 전류를 주로 한 방향으로 흐르게 하는 다이오드입니다. 두 LED를 서로 반대 방향으로 연결했기 때문에 유도 전류의 방향에 따라 순방향이 되는 LED 하나만 켜집니다.'],
    ['이 실험에서 일어나는 에너지 전환을 설명해 보세요.', '자석을 움직이는 역학적 에너지가 전자기 유도로 전기 에너지로 전환됩니다. 이 전기 에너지는 LED에서 빛 에너지와 열에너지로 전환됩니다. 에너지가 새로 생기는 것은 아닙니다.']
  ];

  function magneticFlux(x) {
    return Math.exp(-3.9 * x * x);
  }

  function setMagnetVisual() {
    const usable = elements.apparatus.clientWidth - elements.magnet.offsetWidth - 24;
    const left = 12 + ((state.x + 1) / 2) * usable;
    elements.magnet.style.left = `${left}px`;
    elements.magnet.setAttribute('aria-valuenow', Math.round((state.x + 1) * 50));
  }

  function classifySpeed(absVelocity) {
    if (absVelocity < 0.025) return '정지';
    if (absVelocity < 0.38) return '느림';
    if (absVelocity < 0.72) return '보통';
    return '빠름';
  }

  function updateReadouts() {
    const active = Math.abs(state.emf) >= ACTIVE_THRESHOLD;
    const direction = state.velocity > 0.025 ? '→' : state.velocity < -0.025 ? '←' : '정지';
    const fluxChange = state.fluxRate > 0.025 ? '증가' : state.fluxRate < -0.025 ? '감소' : '거의 변화 없음';
    const ledName = active ? (state.emf > 0 ? 'LED A' : 'LED B') : '없음';
    const currentDirection = active ? (state.emf > 0 ? '→' : '←') : '없음';
    const brightness = active ? clamp((Math.abs(state.emf) - ACTIVE_THRESHOLD) / 1.9, .12, 1) : 0;

    elements.direction.textContent = direction;
    elements.speed.textContent = classifySpeed(Math.abs(state.velocity));
    elements.flux.textContent = fluxChange;
    elements.emf.textContent = `${state.emf >= 0 ? '+' : '−'}${Math.abs(state.emf).toFixed(2)}`;
    elements.current.textContent = currentDirection;
    elements.led.textContent = ledName;
    elements.lamp.classList.toggle('active', active);
    elements.ledA.classList.toggle('on', active && state.emf > 0);
    elements.ledB.classList.toggle('on', active && state.emf < 0);
    elements.ledA.style.opacity = active && state.emf > 0 ? String(.55 + brightness * .45) : '1';
    elements.ledB.style.opacity = active && state.emf < 0 ? String(.55 + brightness * .45) : '1';
    elements.ledA.querySelector('.led-halo').style.opacity = active && state.emf > 0 ? String(.25 + brightness * .7) : '0';
    elements.ledB.querySelector('.led-halo').style.opacity = active && state.emf < 0 ? String(.25 + brightness * .7) : '0';

    const showingCurrent = $('#showCurrent').checked && active;
    elements.currentArrows.classList.toggle('is-hidden', !showingCurrent);
    elements.currentArrows.classList.toggle('forward', showingCurrent && state.emf > 0);
    elements.currentArrows.classList.toggle('reverse', showingCurrent && state.emf < 0);

    if (active) {
      elements.summary.textContent = `${ledName}가 켜졌습니다. 유도 기전력의 방향: ${state.emf > 0 ? '양(+)의 방향' : '음(−)의 방향'}`;
      elements.energyFlow.classList.add('active');
      elements.energyStatus.textContent = '에너지 전환 중';
    } else {
      elements.summary.textContent = Math.abs(state.velocity) > .025 ? '자기선속 변화가 작은 구간입니다.' : '자석이 정지하여 두 LED가 꺼져 있습니다.';
      elements.energyFlow.classList.toggle('active', Math.abs(state.velocity) > .025);
      elements.energyStatus.textContent = Math.abs(state.velocity) > .025 ? '에너지 전달 중' : '자석을 움직여 보세요';
    }

    if (!active) {
      elements.diodeAState.textContent = '전류가 거의 흐르지 않습니다.';
      elements.diodeBState.textContent = '전류가 거의 흐르지 않습니다.';
    } else if (state.emf > 0) {
      elements.diodeAState.textContent = '전류가 흐를 수 있습니다.';
      elements.diodeBState.textContent = '전류가 거의 흐르지 않습니다.';
    } else {
      elements.diodeAState.textContent = '전류가 거의 흐르지 않습니다.';
      elements.diodeBState.textContent = '전류가 흐를 수 있습니다.';
    }
  }

  function updatePhysics(now) {
    let dt = clamp((now - state.lastTime) / 1000, .001, .05);
    state.lastTime = now;
    const timeScale = state.slowMotion ? .32 : 1;

    if (!state.dragging && (state.commandedDirection !== 0 || state.autoOscillate)) {
      const movementDirection = state.autoOscillate ? state.autoDirection : state.commandedDirection;
      const commandedVelocity = movementDirection * SPEEDS[state.speedMode] * timeScale;
      state.x += commandedVelocity * dt;
      state.velocity = commandedVelocity;
      if (Math.abs(state.x) >= MAX_X) {
        state.x = clamp(state.x, -MAX_X, MAX_X);
        if (state.autoOscillate) {
          state.autoDirection *= -1;
          state.velocity = state.autoDirection * SPEEDS[state.speedMode] * timeScale;
        } else {
          state.commandedDirection = 0;
          state.velocity = 0;
        }
        updateControlButtons();
      }
    } else if (!state.dragging) {
      state.velocity *= Math.exp(-dt * 25);
      if (Math.abs(state.velocity) < .008) state.velocity = 0;
    }

    const newFlux = magneticFlux(state.x);
    state.fluxRate = (newFlux - state.flux) / dt;
    let calculatedEmf = -state.fluxRate * .72;
    if (Math.abs(state.velocity) < .008 || Math.abs(calculatedEmf) < .008) calculatedEmf = 0;
    state.emf += (calculatedEmf - state.emf) * Math.min(1, dt * 26);
    if (Math.abs(state.emf) < .006) state.emf = 0;
    state.flux = newFlux;

    state.graphAccumulator += dt;
    if (state.graphAccumulator >= .045) {
      state.graph.push(state.emf);
      if (state.graph.length > 180) state.graph.shift();
      state.graphAccumulator = 0;
      if (!elements.graphSection.classList.contains('is-hidden')) drawGraph();
    }
    setMagnetVisual();
    updateReadouts();
    requestAnimationFrame(updatePhysics);
  }

  function pointerToX(event) {
    const rect = elements.apparatus.getBoundingClientRect();
    const halfMagnet = elements.magnet.offsetWidth / 2;
    return clamp(((event.clientX - rect.left - halfMagnet) / (rect.width - elements.magnet.offsetWidth) * 2) - 1, -MAX_X, MAX_X);
  }

  elements.magnet.addEventListener('pointerdown', (event) => {
    stopAutoOscillation();
    state.dragging = true;
    state.commandedDirection = 0;
    state.dragSamples = [{ x: state.x, t: performance.now() }];
    elements.magnet.setPointerCapture(event.pointerId);
    updateControlButtons();
  });
  elements.magnet.addEventListener('pointermove', (event) => {
    if (!state.dragging) return;
    const now = performance.now();
    const newX = pointerToX(event);
    const latest = state.dragSamples[state.dragSamples.length - 1];
    const dt = Math.max((now - latest.t) / 1000, .006);
    state.velocity = clamp((newX - latest.x) / dt, -2.2, 2.2);
    state.x = newX;
    state.dragSamples.push({ x: newX, t: now });
    if (state.dragSamples.length > 4) state.dragSamples.shift();
  });
  const endDrag = () => { state.dragging = false; state.velocity = 0; state.dragSamples = []; };
  elements.magnet.addEventListener('pointerup', endDrag);
  elements.magnet.addEventListener('pointercancel', endDrag);
  elements.magnet.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    stopAutoOscillation();
    const oldX = state.x;
    state.x = clamp(state.x + (event.key === 'ArrowRight' ? .04 : -.04), -MAX_X, MAX_X);
    state.velocity = (state.x - oldX) / .04;
  });

  function updateControlButtons() {
    $('#moveLeft').classList.toggle('active', state.commandedDirection < 0);
    $('#moveRight').classList.toggle('active', state.commandedDirection > 0);
    $('#stopMove').classList.toggle('active', state.commandedDirection === 0);
  }
  function updateAutoButton() {
    const button = $('#autoOscillate');
    button.setAttribute('aria-pressed', String(state.autoOscillate));
    button.textContent = state.autoOscillate ? '■ 자동 왕복 정지' : '↔ 자동 왕복 시작';
  }
  function stopAutoOscillation() {
    state.autoOscillate = false;
    updateAutoButton();
  }
  $('#moveLeft').addEventListener('click', () => { stopAutoOscillation(); state.commandedDirection = -1; updateControlButtons(); });
  $('#moveRight').addEventListener('click', () => { stopAutoOscillation(); state.commandedDirection = 1; updateControlButtons(); });
  $('#stopMove').addEventListener('click', () => { stopAutoOscillation(); state.commandedDirection = 0; state.velocity = 0; updateControlButtons(); });
  $('#autoOscillate').addEventListener('click', () => {
    if (state.autoOscillate) {
      stopAutoOscillation();
      state.commandedDirection = 0;
      state.velocity = 0;
    } else {
      state.commandedDirection = 0;
      state.autoOscillate = true;
      state.autoDirection = state.x >= 0 ? -1 : 1;
      updateAutoButton();
    }
    updateControlButtons();
  });
  document.querySelectorAll('input[name="speed"]').forEach((input) => input.addEventListener('change', () => { state.speedMode = input.value; }));
  $('#showDiode').addEventListener('change', (event) => {
    elements.diodeSymbols.classList.toggle('is-hidden', !event.target.checked);
    elements.diodeExplanation.classList.toggle('is-hidden', !event.target.checked);
  });
  $('#showCurrent').addEventListener('change', updateReadouts);

  function resetExperiment() {
    Object.assign(state, { x: 0, previousX: 0, velocity: 0, commandedDirection: 0, autoOscillate: false, autoDirection: -1, speedMode: 'normal', dragging: false, emf: 0, flux: magneticFlux(0), fluxRate: 0, graph: [], graphAccumulator: 0, slowMotion: false });
    document.querySelector('input[name="speed"][value="normal"]').checked = true;
    $('#slowMotionBtn').setAttribute('aria-pressed', 'false');
    $('#slowMotionBtn').textContent = '◷ 천천히 보기';
    updateControlButtons();
    updateAutoButton();
    drawGraph();
  }
  $('#resetBtn').addEventListener('click', resetExperiment);
  $('#slowMotionBtn').addEventListener('click', (event) => {
    state.slowMotion = !state.slowMotion;
    event.currentTarget.setAttribute('aria-pressed', String(state.slowMotion));
    event.currentTarget.textContent = state.slowMotion ? '▶ 보통 속도로 보기' : '◷ 천천히 보기';
  });
  $('#toggleHelpBtn').addEventListener('click', (event) => {
    const hidden = document.body.classList.toggle('hide-help');
    event.currentTarget.textContent = hidden ? '설명 보기' : '설명 숨기기';
    event.currentTarget.setAttribute('aria-pressed', String(hidden));
  });
  $('#graphBtn').addEventListener('click', (event) => {
    const hidden = elements.graphSection.classList.toggle('is-hidden');
    event.currentTarget.textContent = hidden ? '그래프 보기' : '그래프 숨기기';
    event.currentTarget.setAttribute('aria-expanded', String(!hidden));
    if (!hidden) { drawGraph(); elements.graphSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
  });

  function drawGraph() {
    const canvas = elements.chart;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr; canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const width = rect.width, height = rect.height, mid = height / 2;
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = '#dce5ea'; ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) { const y = i * height / 4; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
    ctx.strokeStyle = '#708693'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(width, mid); ctx.stroke();
    ctx.fillStyle = '#71848f'; ctx.font = '12px system-ui'; ctx.fillText('+', 5, 14); ctx.fillText('0', 5, mid - 6); ctx.fillText('−', 5, height - 6);
    if (state.graph.length < 2) return;
    const range = 2.2; ctx.beginPath();
    state.graph.forEach((value, index) => {
      const x = index / 179 * width;
      const y = mid - clamp(value / range, -1, 1) * (mid - 10);
      if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = '#16a4be'; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.stroke();
  }
  window.addEventListener('resize', () => { setMagnetVisual(); drawGraph(); });

  function renderQuestion() {
    const index = state.currentQuestion;
    $('#questionCount').textContent = `${index + 1} / ${questions.length}`;
    $('#questionLabel').textContent = `문제 ${index + 1}.`;
    $('#questionText').textContent = questions[index][0];
    $('#answerText').textContent = questions[index][1];
    $('#answerBox').classList.add('is-hidden');
    $('#showAnswer').textContent = '정답 확인';
    $('#prevQuestion').disabled = index === 0;
    $('#nextQuestion').disabled = index === questions.length - 1;
  }
  $('#showAnswer').addEventListener('click', (event) => {
    const box = $('#answerBox'); const opening = box.classList.contains('is-hidden');
    box.classList.toggle('is-hidden'); event.currentTarget.textContent = opening ? '정답 숨기기' : '정답 확인';
  });
  $('#prevQuestion').addEventListener('click', () => { state.currentQuestion--; renderQuestion(); });
  $('#nextQuestion').addEventListener('click', () => { state.currentQuestion++; renderQuestion(); });

  state.flux = magneticFlux(state.x);
  updateControlButtons(); updateAutoButton(); renderQuestion(); setMagnetVisual(); updateReadouts(); requestAnimationFrame(updatePhysics);
})();
