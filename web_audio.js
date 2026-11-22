(() => {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;

  const cues = {
    jump: [[280, 580, 0.13]],
    slash: [[480, 150, 0.07], [880, 430, 0.055]],
    level: [[494, 494, 0.12], [622, 622, 0.12], [740, 740, 0.12], [988, 988, 0.28]],
    surge: [[180, 270, 0.15], [360, 540, 0.12], [720, 1000, 0.30]],
    death: [[392, 329, 0.19], [261, 160, 0.24]],
    coin: [[900, 920, 0.075], [1300, 1300, 0.14]],
    select: [[510, 620, 0.07]],
  };
  const playing = new Set();
  const lastCombatCue = new Map();
  const combatCueGap = 0.045;
  let context;
  let resume;
  let pending;

  function unlock(event) {
    if (!event.isTrusted) return;
    try {
      context ??= new AudioContext();
      if (context.state === "running" || resume) return;
      resume = context.resume().then(() => {
        const name = pending;
        pending = undefined;
        if (name) schedule(name);
      }).catch(() => {}).finally(() => { resume = null; });
    } catch {
      context = undefined;
    }
  }

  // iOS grants audio playback during the trusted touch gesture.
  for (const type of ["touchend", "pointerup", "keydown"]) {
    window.addEventListener(type, unlock, { capture: true, passive: true });
  }

  function schedule(name) {
    if (!context || context.state !== "running") return;
    const now = context.currentTime;
    // Several kills or coins can land together during a Limit Break.
    if (name === "slash" || name === "coin") {
      if (now - (lastCombatCue.get(name) ?? -Infinity) < combatCueGap) return;
      lastCombatCue.set(name, now);
    }
    let time = now + 0.007;
    for (const [start, finish, duration] of cues[name]) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "triangle";
      oscillator.frequency.setValueAtTime(start, time);
      oscillator.frequency.exponentialRampToValueAtTime(finish, time + duration);
      gain.gain.setValueAtTime(0.001, time);
      gain.gain.linearRampToValueAtTime(0.14, time + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
        playing.delete(oscillator);
      };
      playing.add(oscillator);
      oscillator.start(time);
      oscillator.stop(time + duration);
      time += duration;
    }
  }

  let generation = 0;
  window.levelClimberSfx = {
    play(name) {
      if (!cues[name]) return;
      if (context?.state === "running") {
        schedule(name);
        return;
      }
      // Godot may process the gesture just before Safari finishes resuming.
      const currentGeneration = generation;
      if (resume) {
        resume.then(() => {
          if (generation === currentGeneration) schedule(name);
        });
      } else {
        pending = name;
      }
    },
    stop() {
      generation += 1;
      pending = undefined;
      lastCombatCue.clear();
      for (const oscillator of playing) oscillator.stop();
      playing.clear();
    },
  };
})();
