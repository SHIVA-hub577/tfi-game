// TFI Auction - UI Controller & Application Orchestration
// Connects Engine, Web Audio Synthesizer, Confetti, and DOM

(function () {
  const engine = new TFIAuctionEngine();

  // DOM Elements Cache
  const screens = {
    home: document.getElementById('screen-home'),
    setup: document.getElementById('screen-setup'),
    auction: document.getElementById('screen-auction'),
    results: document.getElementById('screen-results'),
    rules: document.getElementById('screen-rules')
  };

  const modals = {
    sold: document.getElementById('modal-sold'),
    skipped: document.getElementById('modal-skipped'),
    collections: document.getElementById('modal-collections'),
    history: document.getElementById('modal-history'),
    settings: document.getElementById('modal-settings'),
    catalog: document.getElementById('modal-catalog'),
    dropConfirm: document.getElementById('modal-drop-confirm'),
    endConfirm: document.getElementById('modal-end-confirm')
  };

  // Turn Timer state
  let timerInterval = null;
  let timerRemaining = 0;
  let timerPaused = false;

  // Sound alias
  const sound = window.TFI_SOUND;
  const confetti = window.TFI_CONFETTI;

  // Setup screen local state
  const setupState = {
    playersCount: 3,
    playerNames: ['Mahesh', 'Charan', 'Bunny', 'Prabhas'],
    budget: 50,
    topicId: 'any-tfi',
    categoryFilter: 'all',
    poolSize: 15,
    limit: 3,
    timerDuration: 15 // seconds (0 = off)
  };

  // Tollywood Fan Name Presets
  const TFI_NAMES_PRESETS = [
    'Mahesh', 'Charan', 'Bunny', 'Prabhas', 'NTR', 'Chiru',
    'Pawan', 'Balayya', 'Venky', 'Nag', 'Samantha', 'Anushka',
    'Pushpa', 'Devara', 'Murari', 'Billa', 'Athadu', 'Chanti', 'Kushi'
  ];

  function getRandomTfiName(excludeList = []) {
    const candidates = TFI_NAMES_PRESETS.filter(n => !excludeList.includes(n));
    if (candidates.length === 0) return 'Fan ' + Math.floor(Math.random() * 99 + 1);
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  // Navigation
  function showScreen(name) {
    Object.keys(screens).forEach(key => {
      if (screens[key]) {
        if (key === name) {
          screens[key].classList.remove('hidden');
        } else {
          screens[key].classList.add('hidden');
        }
      }
    });

    // Control visibility of header and bottom scoreboard dock
    const scoreboardDock = document.getElementById('scoreboard-dock');
    if (name === 'auction') {
      if (scoreboardDock) scoreboardDock.classList.remove('hidden');
    } else {
      if (scoreboardDock) scoreboardDock.classList.add('hidden');
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openModal(modalEl) {
    if (modalEl) modalEl.classList.remove('hidden');
  }

  function closeModal(modalEl) {
    if (modalEl) modalEl.classList.add('hidden');
  }

  // --- ENGINE EVENT SUBSCRIPTION ---
  engine.subscribe((event, payload) => {
    switch (event) {
      case 'GAME_STARTED':
      case 'GAME_RESUMED':
        renderScoreboard();
        showScreen('auction');
        break;

      case 'AUCTION_STARTED':
        renderAuctionArena();
        renderScoreboard();
        startTurnTimer();
        break;

      case 'AUCTION_OPENED':
        sound.hammer();
        renderAuctionArena();
        renderScoreboard();
        startTurnTimer();
        break;

      case 'BID_RAISED':
        sound.raise();
        renderAuctionArena();
        renderScoreboard();
        startTurnTimer();
        break;

      case 'PLAYER_DROPPED':
        sound.drop();
        renderAuctionArena();
        renderScoreboard();
        startTurnTimer();
        break;

      case 'TURN_CHANGED':
        renderAuctionArena();
        renderScoreboard();
        startTurnTimer();
        break;

      case 'BID_UNDONE':
        sound.click();
        renderAuctionArena();
        renderScoreboard();
        startTurnTimer();
        break;

      case 'MOVIE_SOLD':
        stopTurnTimer();
        sound.sold();
        confetti.fire(70);
        showSoldCelebration(payload);
        renderScoreboard();
        break;

      case 'PRE_AUCTION_TURN_CHANGED':
        stopTurnTimer();
        sound.click();
        renderAuctionArena();
        renderScoreboard();
        startTurnTimer();
        break;

      case 'MOVIE_SKIPPED':
        stopTurnTimer();
        sound.drop();
        showSkippedCelebration(payload);
        renderScoreboard();
        break;

      case 'GAME_ENDED':
        stopTurnTimer();
        renderResults(payload);
        showScreen('results');
        confetti.fire(120, 0.5, 0.3);
        break;
    }
  });

  // --- HOME SCREEN LOGIC ---
  function initHomeScreen() {
    const resumeContainer = document.getElementById('home-resume-container');
    if (engine.hasSavedGame()) {
      const summary = engine.getSavedGameSummary();
      if (summary && resumeContainer) {
        resumeContainer.innerHTML = `
          <div class="resume-banner">
            <div class="resume-header">
              <span class="resume-tag">Saved Game Found</span>
              <small style="color:var(--text-dim);">${new Date(summary.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>
            </div>
            <div class="resume-details">
              <strong>${escapeHtml(summary.topicName)}</strong><br>
              Round ${summary.currentRound} of ${summary.totalPool} • Players: ${escapeHtml(summary.playerNames)}
            </div>
            <div class="resume-actions">
              <button class="btn btn-primary btn-sm" id="btn-resume-game" style="flex:1;">▶ Resume Game</button>
              <button class="btn btn-ghost btn-sm" id="btn-discard-saved" style="padding:4px 8px;" title="Discard">✕</button>
            </div>
          </div>
        `;

        document.getElementById('btn-resume-game')?.addEventListener('click', () => {
          sound.click();
          engine.resumeSavedGame();
        });

        document.getElementById('btn-discard-saved')?.addEventListener('click', () => {
          sound.click();
          if (confirm('Discard the saved game and start fresh?')) {
            engine.clearSavedGame();
            resumeContainer.innerHTML = '';
          }
        });
      }
    } else if (resumeContainer) {
      resumeContainer.innerHTML = '';
    }
  }

  // --- SETUP SCREEN LOGIC ---
  function initSetupScreen() {
    renderPlayerCountControls();
    renderPlayerNameInputs();
    renderBudgetControls();
    renderTopicFilterPills();
    renderTopicCards();
    updatePoolAndLimitControls();
    renderTimerSettingControls();
  }

  function renderPlayerCountControls() {
    const countContainer = document.getElementById('player-count-control');
    if (!countContainer) return;

    countContainer.innerHTML = [2, 3, 4].map(count => `
      <button type="button" class="segment-btn ${setupState.playersCount === count ? 'active' : ''}" data-count="${count}">
        👥 ${count} Players
      </button>
    `).join('');

    countContainer.querySelectorAll('.segment-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        sound.click();
        setupState.playersCount = parseInt(btn.dataset.count, 10);
        renderPlayerCountControls();
        renderPlayerNameInputs();
        updatePoolAndLimitControls();
      });
    });
  }

  function renderPlayerNameInputs() {
    const grid = document.getElementById('player-names-grid');
    if (!grid) return;

    let html = '';
    for (let i = 0; i < setupState.playersCount; i++) {
      const currentName = setupState.playerNames[i] || `Player ${i + 1}`;
      html += `
        <div class="player-input-wrap">
          <div class="player-input-label">
            <span>Player ${i + 1} Name</span>
            <button type="button" class="random-name-btn" data-player-index="${i}">🎲 Tollywood Name</button>
          </div>
          <input type="text" class="text-input player-name-input" data-player-index="${i}" value="${escapeHtml(currentName)}" maxlength="16" placeholder="Enter name">
        </div>
      `;
    }
    grid.innerHTML = html;

    // Attach listeners
    grid.querySelectorAll('.player-name-input').forEach(input => {
      input.addEventListener('input', (e) => {
        const idx = parseInt(input.dataset.playerIndex, 10);
        setupState.playerNames[idx] = input.value;
      });
    });

    grid.querySelectorAll('.random-name-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        sound.click();
        const idx = parseInt(btn.dataset.playerIndex, 10);
        const newName = getRandomTfiName(setupState.playerNames.filter((_, i) => i !== idx));
        setupState.playerNames[idx] = newName;
        const input = grid.querySelector(`.player-name-input[data-player-index="${idx}"]`);
        if (input) input.value = newName;
      });
    });
  }

  function renderBudgetControls() {
    // Slider Bar (20 to 70 coins)
    const budgetSlider = document.getElementById('budget-slider');
    const budgetValBadge = document.getElementById('budget-val-badge');

    if (budgetSlider) {
      budgetSlider.min = 20;
      budgetSlider.max = 70;
      budgetSlider.value = setupState.budget;

      if (!budgetSlider.dataset.bound) {
        budgetSlider.dataset.bound = 'true';
        budgetSlider.addEventListener('input', (e) => {
          setupState.budget = parseInt(e.target.value, 10);
          if (budgetValBadge) budgetValBadge.textContent = `${setupState.budget} 🪙`;
          renderBudgetChips();
          updatePoolAndLimitControls();
        });
      }
    }

    if (budgetValBadge) {
      budgetValBadge.textContent = `${setupState.budget} 🪙`;
    }

    renderBudgetChips();
  }

  function renderBudgetChips() {
    const container = document.getElementById('budget-chips-container');
    if (!container) return;

    // Quick presets from 20 to 70
    const presets = [20, 30, 40, 50, 60, 70];
    container.innerHTML = presets.map(b => `
      <button type="button" class="chip-btn ${setupState.budget === b ? 'active' : ''}" data-budget="${b}">
        🪙 ${b}
      </button>
    `).join('');

    container.querySelectorAll('.chip-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        sound.click();
        setupState.budget = parseInt(btn.dataset.budget, 10);
        const budgetSlider = document.getElementById('budget-slider');
        const budgetValBadge = document.getElementById('budget-val-badge');
        if (budgetSlider) budgetSlider.value = setupState.budget;
        if (budgetValBadge) budgetValBadge.textContent = `${setupState.budget} 🪙`;
        renderBudgetChips();
        updatePoolAndLimitControls();
      });
    });
  }

  function renderTopicFilterPills() {
    const filterContainer = document.getElementById('topic-filter-bar');
    if (!filterContainer) return;

    const categories = [
      { id: 'all', label: 'All Topics' },
      { id: 'general', label: 'General' },
      { id: 'hero', label: 'Hero Films' },
      { id: 'heroine', label: 'Heroine Films' },
      { id: 'director', label: 'Director' }
    ];

    filterContainer.innerHTML = categories.map(cat => `
      <button type="button" class="filter-pill ${setupState.categoryFilter === cat.id ? 'active' : ''}" data-cat="${cat.id}">
        ${cat.label}
      </button>
    `).join('');

    filterContainer.querySelectorAll('.filter-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        sound.click();
        setupState.categoryFilter = pill.dataset.cat;
        renderTopicFilterPills();
        renderTopicCards();
      });
    });
  }

  function renderTopicCards() {
    const grid = document.getElementById('topic-cards-grid');
    if (!grid) return;

    const allTopics = engine.getAllTopics();
    const filtered = allTopics.filter(t => {
      if (setupState.categoryFilter === 'all') return true;
      return t.category === setupState.categoryFilter;
    });

    grid.innerHTML = filtered.map(topic => {
      const isSelected = setupState.topicId === topic.id;
      return `
        <div class="topic-card ${isSelected ? 'selected' : ''}" data-topic-id="${topic.id}">
          <div class="topic-name">${escapeHtml(topic.name)}</div>
          <div class="topic-meta">
            <span class="topic-badge-type">${topic.category}</span>
            <span>🎬 ${topic.movies.length}</span>
          </div>
        </div>
      `;
    }).join('');

    grid.querySelectorAll('.topic-card').forEach(card => {
      card.addEventListener('click', () => {
        sound.click();
        setupState.topicId = card.dataset.topicId;
        renderTopicCards();
        updatePoolAndLimitControls();
      });
    });
  }

  function updatePoolAndLimitControls() {
    const topic = engine.getTopicById(setupState.topicId);
    if (!topic) return;

    const totalInTopic = topic.movies.length;
    const poolSlider = document.getElementById('pool-size-slider');
    const poolValBadge = document.getElementById('pool-val-badge');
    const poolMaxLabel = document.getElementById('pool-max-label');

    if (poolSlider) {
      poolSlider.min = 6;
      poolSlider.max = totalInTopic;
      if (setupState.poolSize > totalInTopic) setupState.poolSize = totalInTopic;
      if (setupState.poolSize < 6) setupState.poolSize = Math.min(6, totalInTopic);
      poolSlider.value = setupState.poolSize;
      if (poolValBadge) poolValBadge.textContent = setupState.poolSize;
      if (poolMaxLabel) poolMaxLabel.textContent = totalInTopic;
    }

    // Limit calculation (movies per player)
    // Formula: players * limit <= poolSize AND limit <= budget
    const maxLimit = TFIAuctionEngine.calculateMaxLimit(setupState.playersCount, setupState.poolSize, setupState.budget);
    if (setupState.limit > maxLimit) {
      setupState.limit = maxLimit;
    }

    const limitContainer = document.getElementById('limit-chips-container');
    const formulaHint = document.getElementById('setup-formula-hint');

    if (limitContainer) {
      let chipsHtml = '';
      for (let i = 1; i <= Math.max(15, maxLimit + 2); i++) {
        const isValid = i <= maxLimit;
        const isSelected = setupState.limit === i;
        chipsHtml += `
          <button type="button" class="chip-btn ${isSelected ? 'active' : ''}" 
                  data-limit="${i}" ${isValid ? '' : 'disabled'}>
            ${i}
          </button>
        `;
      }
      limitContainer.innerHTML = chipsHtml;

      limitContainer.querySelectorAll('.chip-btn:not(:disabled)').forEach(btn => {
        btn.addEventListener('click', () => {
          sound.click();
          setupState.limit = parseInt(btn.dataset.limit, 10);
          updatePoolAndLimitControls();
        });
      });
    }

    if (formulaHint) {
      const soldMoviesCount = setupState.playersCount * setupState.limit;
      const unplayedCount = setupState.poolSize - soldMoviesCount;
      formulaHint.innerHTML = `
        <strong>Rule Check:</strong> ${setupState.playersCount} players × ${setupState.limit} movies = <strong>${soldMoviesCount} movies won</strong>. 
        Pool has ${setupState.poolSize} movies (${unplayedCount} will be unplayed). Valid limits: <strong>1 to ${maxLimit}</strong>.
      `;
    }
  }

  function renderTimerSettingControls() {
    const container = document.getElementById('timer-setting-chips');
    if (!container) return;

    const options = [
      { val: 0, label: 'Off' },
      { val: 10, label: '10s' },
      { val: 15, label: '15s' },
      { val: 20, label: '20s' },
      { val: 30, label: '30s' }
    ];

    container.innerHTML = options.map(opt => `
      <button type="button" class="chip-btn ${setupState.timerDuration === opt.val ? 'active' : ''}" data-val="${opt.val}">
        ⏱️ ${opt.label}
      </button>
    `).join('');

    container.querySelectorAll('.chip-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        sound.click();
        setupState.timerDuration = parseInt(btn.dataset.val, 10);
        renderTimerSettingControls();
      });
    });
  }

  // --- AUCTION ARENA LOGIC ---
  function renderAuctionArena() {
    const auction = engine.auction;
    if (!auction) return;

    // Top progress
    const roundNumber = engine.currentMovieIndex + 1;
    const totalPool = engine.poolSize;
    const unplayedLeft = totalPool - roundNumber;

    const roundEl = document.getElementById('auction-round-text');
    if (roundEl) {
      roundEl.textContent = `Movie ${roundNumber} of ${totalPool} (${unplayedLeft} remaining)`;
    }

    const topicPill = document.getElementById('auction-topic-pill');
    if (topicPill && engine.topic) {
      topicPill.textContent = engine.topic.name;
    }

    // Movie Spotlight
    const movieTitleEl = document.getElementById('spotlight-movie-title');
    const movieBadgeEl = document.getElementById('spotlight-movie-badge');
    if (movieTitleEl) movieTitleEl.textContent = auction.movie.title;
    if (movieBadgeEl && engine.topic) {
      movieBadgeEl.innerHTML = `🎬 ${engine.topic.name}`;
    }

    // Bidding Podium
    const currentBidEl = document.getElementById('current-bid-display');
    if (currentBidEl) {
      currentBidEl.textContent = auction.currentBid;
    }

    // Leader Spotlight
    const leaderContainer = document.getElementById('leader-badge-container');
    if (leaderContainer) {
      if (auction.leaderId) {
        const leader = engine.players.find(p => p.id === auction.leaderId);
        leaderContainer.innerHTML = `
          <div class="leader-badge">
            <span>👑 Current Leader:</span>
            <strong>${escapeHtml(leader ? leader.name : 'Unknown')}</strong>
            <span>(${auction.currentBid} 🪙)</span>
          </div>
        `;
      } else {
        leaderContainer.innerHTML = `
          <div class="leader-badge no-leader">
            <span>Waiting for opening bid (Base: 1 🪙)</span>
          </div>
        `;
      }
    }

    // Turn Spotlight & "Pass the Device" prompt
    const turnPlayer = engine.players.find(p => p.id === auction.turnPlayerId);
    const turnNameEl = document.getElementById('turn-player-name');
    const turnAvatarEl = document.getElementById('turn-avatar-initial');
    const passPromptEl = document.getElementById('pass-device-prompt');

    if (turnPlayer) {
      if (turnNameEl) turnNameEl.textContent = `${turnPlayer.name}'s Turn`;
      if (turnAvatarEl) turnAvatarEl.textContent = turnPlayer.name.charAt(0).toUpperCase();
      if (passPromptEl) {
        if (!auction.isOpen) {
          const skipVotes = auction.skipVotes || [];
          passPromptEl.textContent = skipVotes.length > 0 ? 'PASS DEVICE TO NEXT PLAYER' : 'PASS DEVICE TO OPENER';
        } else {
          passPromptEl.textContent = 'PASS DEVICE TO CURRENT BIDDER';
        }
      }
    }

    // Reserve Rule HUD
    const maxBidEl = document.getElementById('reserve-max-bid-val');
    const reserveCoinsEl = document.getElementById('reserve-coins-locked');
    if (turnPlayer) {
      const maxBid = engine.calculatePlayerMaxBid(turnPlayer);
      const needed = engine.moviesPerPlayer - turnPlayer.wonMovies.length;
      const locked = Math.max(0, needed - 1);
      if (maxBidEl) maxBidEl.textContent = `${maxBid} 🪙`;
      if (reserveCoinsEl) reserveCoinsEl.textContent = `${locked} 🪙 locked for ${locked} other movie${locked === 1 ? '' : 's'}`;
    }

    // Action Controls Area
    const controlsContainer = document.getElementById('auction-controls-container');
    if (!controlsContainer) return;

    if (!auction.isOpen) {
      // Pre-Auction Opener / Skip decision view
      const skipVotes = auction.skipVotes || [];
      const eligiblePlayers = engine.getPlayersNeedingMovies();
      const eligibleCount = eligiblePlayers.length;

      let skipHintHtml = '';
      if (skipVotes.length > 0) {
        // Build names of who voted to skip
        const voterNames = skipVotes.map(vid => {
          const vp = engine.players.find(p => p.id === vid);
          return vp ? escapeHtml(vp.name) : 'A player';
        }).join(', ');
        skipHintHtml = `
          <div class="skip-vote-hint" style="margin-top:12px; padding:8px 12px; background:rgba(239,68,68,0.12); border:1px solid rgba(239,68,68,0.3); border-radius:8px; font-size:0.85rem; color:#fca5a5; text-align:center;">
            ⏭️ ${voterNames} passed on opening &nbsp;•&nbsp; ${skipVotes.length}/${eligibleCount} skipped
          </div>
        `;
      }

      controlsContainer.innerHTML = `
        <div class="opener-action-box">
          <p class="opener-hint" style="margin-bottom:14px; font-size:0.95rem;">
            <strong>${escapeHtml(turnPlayer?.name || 'Player')}</strong>, do you want to open the auction or pass/skip?
          </p>
          <div style="display:flex; flex-direction:column; gap:10px; width:100%;">
            <button type="button" class="btn btn-primary btn-lg" id="btn-open-auction" style="animation: pulseGoldBorder 2s infinite; font-size:1.05rem;">
              🔨 Open Auction (1 Coin)
            </button>
            <button type="button" class="btn btn-secondary btn-md skip-movie-btn" id="btn-skip-movie"
              style="border: 1px solid rgba(239, 68, 68, 0.45); color: #fca5a5; font-size:0.95rem; font-weight:600; padding:10px 16px;">
              ⏭️ Skip This Movie (Pass Turn)
            </button>
          </div>
          ${skipHintHtml}
        </div>
      `;
      document.getElementById('btn-open-auction')?.addEventListener('click', () => {
        engine.openAuction();
      });
      document.getElementById('btn-skip-movie')?.addEventListener('click', () => {
        if (!turnPlayer) return;
        sound.click();
        engine.skipMovie(turnPlayer.id);
      });
    } else {
      // Active Bidding Controls
      const currentBid = auction.currentBid;
      const minRaise = engine.getMinimumRaise(currentBid);
      const maxBid = turnPlayer ? engine.calculatePlayerMaxBid(turnPlayer) : 0;

      // Quick raise amounts based on PRD:
      // Minimum raise: 1 coin up to a bid of 20, then 2 coins above 20
      // Quick-raise buttons (+1, +2, +5)
      const raiseOptions = currentBid < 20 ? [1, 2, 5] : [2, 3, 5];

      const raiseButtonsHtml = raiseOptions.map(amount => {
        const targetBid = currentBid + amount;
        const canRaise = targetBid <= maxBid;
        return `
          <button type="button" class="quick-raise-btn" data-raise="${amount}" ${canRaise ? '' : 'disabled'}>
            +${amount} <small style="font-weight:400; font-size:0.8rem; opacity:0.8;">(${targetBid}🪙)</small>
          </button>
        `;
      }).join('');

      controlsContainer.innerHTML = `
        <div class="quick-raise-row">
          ${raiseButtonsHtml}
        </div>
        <button type="button" class="drop-btn" id="btn-action-drop">
          ❌ Drop from Movie
        </button>
      `;

      controlsContainer.querySelectorAll('.quick-raise-btn:not(:disabled)').forEach(btn => {
        btn.addEventListener('click', () => {
          const amount = parseInt(btn.dataset.raise, 10);
          engine.raiseBid(amount);
        });
      });

      document.getElementById('btn-action-drop')?.addEventListener('click', () => {
        // Drop safety confirmation modal (FR-12 & Edge cases)
        const dropModal = modals.dropConfirm;
        const dropText = document.getElementById('drop-confirm-text');
        if (dropText && turnPlayer) {
          dropText.textContent = `${turnPlayer.name}, are you sure you want to drop out of bidding for "${auction.movie.title}"? You cannot re-enter this auction.`;
        }
        openModal(dropModal);
      });
    }

    // Undo button state
    const undoBtn = document.getElementById('btn-undo-bid');
    if (undoBtn) {
      undoBtn.disabled = !engine.canUndo();
    }
  }

  // --- SCOREBOARD DOCK (FR-9) ---
  function renderScoreboard() {
    const grid = document.getElementById('scoreboard-players-grid');
    if (!grid) return;

    const auction = engine.auction;
    grid.innerHTML = engine.players.map(player => {
      const isTurn = auction && auction.turnPlayerId === player.id;
      const isLeader = auction && auction.leaderId === player.id;
      const isDropped = auction && auction.activeBidders && !auction.activeBidders.includes(player.id);
      const isLimitReached = player.wonMovies.length >= engine.moviesPerPlayer;
      const needed = engine.moviesPerPlayer - player.wonMovies.length;

      let cardClass = 'player-score-card';
      if (isTurn) cardClass += ' is-turn';
      if (isLeader) cardClass += ' is-leader';
      if (isDropped && !isLimitReached) cardClass += ' is-dropped';
      if (isLimitReached) cardClass += ' limit-reached';

      return `
        <div class="${cardClass}" data-player-id="${player.id}">
          <div class="card-top-row">
            <span class="score-player-name">${escapeHtml(player.name)}</span>
            <span class="score-player-coins">🪙 ${player.coins}</span>
          </div>
          <div class="card-bottom-row">
            <span class="won-count-badge">${player.wonMovies.length}/${engine.moviesPerPlayer} won</span>
            <span>${isLimitReached ? '✅ Done' : `${needed} need`}</span>
          </div>
        </div>
      `;
    }).join('');

    grid.querySelectorAll('.player-score-card').forEach(card => {
      card.addEventListener('click', () => {
        sound.click();
        const pId = card.dataset.playerId;
        openCollectionsModal(pId);
      });
    });
  }

  // --- TURN TIMER (FR-12) ---
  function startTurnTimer() {
    stopTurnTimer();
    const duration = engine.timerDuration;
    if (!duration || duration <= 0) {
      const widget = document.getElementById('turn-timer-widget');
      if (widget) widget.classList.add('hidden');
      return;
    }

    const widget = document.getElementById('turn-timer-widget');
    const timerText = document.getElementById('turn-timer-text');
    if (widget) {
      widget.classList.remove('hidden');
      widget.classList.remove('warning');
    }

    timerRemaining = duration;
    if (timerText) timerText.textContent = `${timerRemaining}s`;

    timerInterval = setInterval(() => {
      if (timerPaused) return;

      timerRemaining--;
      if (timerText) timerText.textContent = `${timerRemaining}s`;

      if (timerRemaining <= 3 && timerRemaining > 0) {
        if (widget) widget.classList.add('warning');
        sound.warning();
      } else if (timerRemaining <= 5 && timerRemaining > 3) {
        sound.tick();
      }

      if (timerRemaining <= 0) {
        stopTurnTimer();
        onTimerExpired();
      }
    }, 1000);
  }

  function stopTurnTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  function onTimerExpired() {
    const auction = engine.auction;
    if (!auction) return;

    if (!auction.isOpen) {
      // Player timed out before opening: auto-skip and pass turn to next player
      engine.skipMovie(auction.turnPlayerId);
    } else {
      // Active bidder timed out: auto-drop
      engine.dropPlayer();
    }
  }

  // Pause timer when document is hidden (sleep / tab switch)
  document.addEventListener('visibilitychange', () => {
    timerPaused = document.hidden;
  });

  // --- SOLD CELEBRATION MODAL ---
  function showSoldCelebration(payload) {
    const modal = modals.sold;
    if (!modal) return;

    const movieTitleEl = document.getElementById('sold-movie-title');
    const buyerNameEl = document.getElementById('sold-buyer-name');
    const pricePaidEl = document.getElementById('sold-price-paid');
    const autoBadgeEl = document.getElementById('sold-auto-award-badge');

    if (movieTitleEl) movieTitleEl.textContent = payload.movie.title;
    if (buyerNameEl) buyerNameEl.textContent = payload.buyer.name;
    if (pricePaidEl) pricePaidEl.textContent = `${payload.price} 🪙`;

    if (autoBadgeEl) {
      if (payload.autoAwarded) {
        autoBadgeEl.classList.remove('hidden');
        autoBadgeEl.textContent = '🌟 Sole remaining bidder! Auto-awarded at base price 1 coin.';
      } else {
        autoBadgeEl.classList.add('hidden');
      }
    }

    openModal(modal);
  }

  // --- SKIPPED CELEBRATION MODAL ---
  function showSkippedCelebration(payload) {
    const modal = modals.skipped;
    if (!modal) return;

    const movieTitleEl = document.getElementById('skipped-movie-title');
    const reasonEl = document.getElementById('skipped-movie-reason');
    if (movieTitleEl && payload.movie) {
      movieTitleEl.textContent = payload.movie.title;
    }
    if (reasonEl) {
      const skipCount = payload.skipVotes ? payload.skipVotes.length : (payload.movie ? engine.getPlayersNeedingMovies().length : 0);
      reasonEl.textContent = `All eligible players (${skipCount}) voted to skip. This movie was not picked by anyone!`;
    }

    openModal(modal);
  }

  // --- RESULTS SCREEN LOGIC (FR-10) ---
  function renderResults(payload) {
    const { players, unplayedMovies, highlights } = payload;

    // Highlights
    const hlContainer = document.getElementById('results-highlights-grid');
    if (hlContainer && highlights) {
      hlContainer.innerHTML = `
        ${highlights.boxOfficeKing ? `
          <div class="highlight-card">
            <span class="highlight-label">👑 Box Office King</span>
            <span class="highlight-player">${escapeHtml(highlights.boxOfficeKing.name)}</span>
            <span class="highlight-desc">Spent most coins: ${highlights.boxOfficeKing.spent} 🪙</span>
          </div>
        ` : ''}
        ${highlights.thriftyProducer ? `
          <div class="highlight-card">
            <span class="highlight-label">💼 Smart Producer</span>
            <span class="highlight-player">${escapeHtml(highlights.thriftyProducer.name)}</span>
            <span class="highlight-desc">Most leftover coins: ${highlights.thriftyProducer.left} 🪙</span>
          </div>
        ` : ''}
        ${highlights.blockbuster ? `
          <div class="highlight-card">
            <span class="highlight-label">💎 Blockbuster Deal</span>
            <span class="highlight-player">${escapeHtml(highlights.blockbuster.movie)}</span>
            <span class="highlight-desc">Won by ${escapeHtml(highlights.blockbuster.buyer)} for ${highlights.blockbuster.price} 🪙</span>
          </div>
        ` : ''}
        ${highlights.bargain ? `
          <div class="highlight-card">
            <span class="highlight-label">🎯 Bargain Striker</span>
            <span class="highlight-player">${escapeHtml(highlights.bargain.movie)}</span>
            <span class="highlight-desc">Won by ${escapeHtml(highlights.bargain.buyer)} for ${highlights.bargain.price} 🪙</span>
          </div>
        ` : ''}
      `;
    }

    // Players collection cards
    const playersGrid = document.getElementById('results-players-grid');
    if (playersGrid) {
      playersGrid.innerHTML = players.map(p => {
        const totalSpent = engine.budget - p.coins;
        const moviesHtml = p.wonMovies.map(m => `
          <div class="result-movie-item">
            <span>🎬 ${escapeHtml(m.title)}</span>
            <span class="price-paid">${m.price} 🪙</span>
          </div>
        `).join('');

        return `
          <div class="player-result-card">
            <div class="result-card-header">
              <span class="result-player-name">${escapeHtml(p.name)}</span>
              <span class="result-coins-left">Leftover: ${p.coins} 🪙 (Spent: ${totalSpent} 🪙)</span>
            </div>
            <div class="result-movies-list">
              ${moviesHtml.length > 0 ? moviesHtml : '<div style="color:var(--text-dim);font-size:0.85rem;">No movies won.</div>'}
            </div>
          </div>
        `;
      }).join('');
    }

    // Unplayed Movies
    const unplayedContainer = document.getElementById('unplayed-movies-container');
    const unplayedCountEl = document.getElementById('unplayed-count-badge');
    if (unplayedCountEl) unplayedCountEl.textContent = unplayedMovies.length;
    if (unplayedContainer) {
      if (unplayedMovies.length > 0) {
        unplayedContainer.innerHTML = unplayedMovies.map(m => `
          <span class="unplayed-pill">${escapeHtml(m.title)}</span>
        `).join('');
      } else {
        unplayedContainer.innerHTML = '<span style="color:var(--text-dim);font-size:0.85rem;">All movies in pool were played!</span>';
      }
    }
  }

  // --- COLLECTION DRAWER MODAL ---
  function openCollectionsModal(highlightPlayerId = null) {
    const modal = modals.collections;
    const body = document.getElementById('collections-modal-body');
    if (!body) return;

    body.innerHTML = engine.players.map(p => {
      const isSelected = p.id === highlightPlayerId;
      const moviesHtml = p.wonMovies.map(m => `
        <div class="result-movie-item">
          <span>🎬 ${escapeHtml(m.title)}</span>
          <span class="price-paid">${m.price} 🪙</span>
        </div>
      `).join('');

      return `
        <div class="player-result-card" style="${isSelected ? 'border-color:var(--gold-primary);' : ''}">
          <div class="result-card-header">
            <span class="result-player-name">${escapeHtml(p.name)}</span>
            <span class="result-coins-left">${p.coins} 🪙 Left</span>
          </div>
          <div class="result-movies-list">
            ${moviesHtml.length > 0 ? moviesHtml : '<div style="color:var(--text-dim);font-size:0.85rem;">No movies won yet.</div>'}
          </div>
        </div>
      `;
    }).join('');

    openModal(modal);
  }

  // --- PAST GAME HISTORY MODAL (FR-16) ---
  function openHistoryModal() {
    const modal = modals.history;
    const container = document.getElementById('history-modal-body');
    if (!container) return;

    const list = engine.getPastGames();
    if (list.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:30px 10px; color:var(--text-dim);">
          🎬 No past games recorded on this device yet. Play an auction to see game logs!
        </div>
      `;
    } else {
      container.innerHTML = list.map(g => `
        <div class="setup-card" style="padding:14px; gap:8px;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <strong>${escapeHtml(g.topicName)}</strong>
            <small style="color:var(--text-dim);">${new Date(g.date).toLocaleDateString()} ${new Date(g.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>
          </div>
          <div style="font-size:0.85rem; color:var(--text-muted);">
            Budget: ${g.budget} 🪙 • Target: ${g.moviesPerPlayer} movies/player
          </div>
          <div style="display:flex; flex-direction:column; gap:8px; margin-top:6px;">
            ${g.players.map(p => {
              const moviesHtml = (p.movies && p.movies.length > 0)
                ? p.movies.map(m => `
                    <div style="display:flex; justify-content:space-between; font-size:0.78rem; padding:2px 0; border-bottom:1px solid rgba(255,255,255,0.05);">
                      <span style="color:var(--text-muted);">🎬 ${escapeHtml(m.title)}</span>
                      <span style="color:var(--gold-primary);">${m.price} 🪙</span>
                    </div>
                  `).join('')
                : '<div style="font-size:0.78rem; color:var(--text-dim); padding:2px 0;">No movies won</div>';

              const skippedSection = (g.skippedMovies && g.skippedMovies.length > 0) ? '' : '';

              return `
                <div style="background:rgba(0,0,0,0.25); padding:8px 10px; border-radius:6px;">
                  <div style="display:flex; justify-content:space-between; font-size:0.85rem; margin-bottom:4px;">
                    <span style="font-weight:600;">${escapeHtml(p.name)}</span>
                    <span style="color:var(--gold-primary);">${p.coinsLeft} 🪙 left (spent ${p.totalSpent} 🪙)</span>
                  </div>
                  ${moviesHtml}
                </div>
              `;
            }).join('')}
          </div>
          ${g.skippedMovies && g.skippedMovies.length > 0 ? `
            <div style="font-size:0.8rem; color:var(--text-dim); margin-top:6px;">
              ⏭️ Skipped: ${g.skippedMovies.map(m => escapeHtml(m.title)).join(', ')}
            </div>
          ` : ''}
        </div>
      `).join('');
    }

    openModal(modal);
  }

  // --- CATALOGUE MODAL (FR-17) ---
  function openCatalogModal() {
    const modal = modals.catalog;
    const container = document.getElementById('catalog-modal-body');
    if (!container) return;

    const allTopics = engine.getAllTopics();
    container.innerHTML = allTopics.map(t => `
      <div class="setup-card" style="padding:14px; gap:10px;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <h3 style="font-size:1.1rem; color:var(--gold-primary);">${escapeHtml(t.name)}</h3>
          <span class="topic-badge-type">${t.category} (${t.movies.length})</span>
        </div>
        <div style="display:flex; flex-wrap:wrap; gap:6px;">
          ${t.movies.map(m => `<span class="unplayed-pill">${escapeHtml(m.title)}</span>`).join('')}
        </div>
      </div>
    `).join('');

    openModal(modal);
  }

  // --- UTILS ---
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // --- EVENT ATTACHMENTS & INITIALIZATION ---
  function setupDOMEvents() {
    // Brand click -> Home
    document.getElementById('brand-header-link')?.addEventListener('click', (e) => {
      e.preventDefault();
      sound.click();
      if (engine.state === 'AUCTION') {
        if (confirm('Leave current auction arena and return to Home? Your game progress is saved.')) {
          showScreen('home');
          initHomeScreen();
        }
      } else {
        showScreen('home');
        initHomeScreen();
      }
    });

    // Audio Mute toggle button
    const muteBtn = document.getElementById('btn-toggle-sound');
    const settingsSoundBtn = document.getElementById('btn-settings-sound-toggle');
    function updateMuteIcon() {
      const isMuted = sound.isMuted();
      if (muteBtn) {
        muteBtn.textContent = isMuted ? '🔇' : '🔊';
        muteBtn.title = isMuted ? 'Unmute Sound Effects' : 'Mute Sound Effects';
      }
      if (settingsSoundBtn) {
        settingsSoundBtn.textContent = isMuted ? 'Sound: Muted (🔇)' : 'Sound: Enabled (🔊)';
      }
    }
    updateMuteIcon();
    muteBtn?.addEventListener('click', () => {
      sound.toggleMute();
      updateMuteIcon();
    });
    settingsSoundBtn?.addEventListener('click', () => {
      sound.toggleMute();
      updateMuteIcon();
    });

    // Settings button
    document.getElementById('btn-open-settings')?.addEventListener('click', () => {
      sound.click();
      openModal(modals.settings);
    });

    // Home buttons
    document.getElementById('btn-home-play')?.addEventListener('click', () => {
      sound.click();
      initSetupScreen();
      showScreen('setup');
    });

    document.getElementById('btn-home-rules')?.addEventListener('click', () => {
      sound.click();
      showScreen('rules');
    });

    document.getElementById('btn-home-history')?.addEventListener('click', () => {
      sound.click();
      openHistoryModal();
    });

    document.getElementById('btn-home-catalog')?.addEventListener('click', () => {
      sound.click();
      openCatalogModal();
    });

    // Rules screen Back button
    document.getElementById('btn-rules-back')?.addEventListener('click', () => {
      sound.click();
      showScreen('home');
    });

    // Setup screen Back button
    document.getElementById('btn-setup-back')?.addEventListener('click', () => {
      sound.click();
      showScreen('home');
      initHomeScreen();
    });

    // Pool size slider
    document.getElementById('pool-size-slider')?.addEventListener('input', (e) => {
      setupState.poolSize = parseInt(e.target.value, 10);
      updatePoolAndLimitControls();
    });

    // Setup screen "Start Auction" button
    document.getElementById('btn-start-game')?.addEventListener('click', () => {
      sound.click();
      const errBox = document.getElementById('setup-error-msg');
      try {
        const names = setupState.playerNames.slice(0, setupState.playersCount);
        engine.startNewGame({
          playerNames: names,
          budget: setupState.budget,
          topicId: setupState.topicId,
          poolSize: setupState.poolSize,
          limit: setupState.limit,
          timerDuration: setupState.timerDuration
        });
        if (errBox) errBox.classList.add('hidden');
      } catch (err) {
        if (errBox) {
          errBox.textContent = err.message;
          errBox.classList.remove('hidden');
        }
      }
    });

    // Auction top actions
    document.getElementById('btn-end-game-early')?.addEventListener('click', () => {
      sound.click();
      openModal(modals.endConfirm);
    });

    document.getElementById('btn-open-collections-hud')?.addEventListener('click', () => {
      sound.click();
      openCollectionsModal();
    });

    // Undo Last Bid (FR-13)
    document.getElementById('btn-undo-bid')?.addEventListener('click', () => {
      if (!engine.canUndo()) return;
      if (confirm('Host Action: Undo the last bid and return turn to previous bidder?')) {
        engine.undoLastBid();
      }
    });

    // Sold Modal Next Movie button
    document.getElementById('btn-sold-next-movie')?.addEventListener('click', () => {
      sound.click();
      closeModal(modals.sold);
      confetti.clear();
      engine.startNextMovie();
    });

    // Skipped Modal Next Movie button
    document.getElementById('btn-skipped-next-movie')?.addEventListener('click', () => {
      sound.click();
      closeModal(modals.skipped);
      engine.startNextMovie();
    });

    // Drop Confirmation Modal buttons
    document.getElementById('btn-drop-confirm-yes')?.addEventListener('click', () => {
      sound.click();
      closeModal(modals.dropConfirm);
      engine.dropPlayer();
    });

    document.getElementById('btn-drop-confirm-cancel')?.addEventListener('click', () => {
      sound.click();
      closeModal(modals.dropConfirm);
    });

    // End Game Confirmation Modal buttons
    document.getElementById('btn-end-confirm-yes')?.addEventListener('click', () => {
      sound.click();
      closeModal(modals.endConfirm);
      engine.endGame();
    });

    document.getElementById('btn-end-confirm-cancel')?.addEventListener('click', () => {
      sound.click();
      closeModal(modals.endConfirm);
    });

    // Results screen buttons
    document.getElementById('btn-play-again-same')?.addEventListener('click', () => {
      sound.click();
      const names = engine.players.map(p => p.name);
      engine.startNewGame({
        playerNames: names,
        budget: engine.budget,
        topicId: engine.topicId,
        poolSize: engine.poolSize,
        limit: engine.moviesPerPlayer,
        timerDuration: engine.timerDuration
      });
    });

    document.getElementById('btn-play-again-setup')?.addEventListener('click', () => {
      sound.click();
      initSetupScreen();
      showScreen('setup');
    });

    document.getElementById('btn-share-results')?.addEventListener('click', () => {
      sound.click();
      let text = `🎬 TFI Auction Results - Topic: ${engine.topic ? engine.topic.name : 'TFI Movies'}\n\n`;
      engine.players.forEach(p => {
        text += `👤 ${p.name}: Leftover ${p.coins} 🪙 | Won ${p.wonMovies.length} movies\n`;
        p.wonMovies.forEach(m => {
          text += `  - ${m.title} (${m.price} 🪙)\n`;
        });
      });
      navigator.clipboard?.writeText(text).then(() => {
        alert('TFI Auction summary copied to clipboard! Paste and share with friends!');
      }).catch(() => {
        alert(text);
      });
    });

    // Toggle unplayed movies accordion in results
    document.getElementById('btn-toggle-unplayed')?.addEventListener('click', () => {
      sound.click();
      const wrap = document.getElementById('unplayed-movies-container');
      if (wrap) wrap.classList.toggle('hidden');
    });

    // Generic Modal Close Buttons
    document.querySelectorAll('[data-close-modal]').forEach(btn => {
      btn.addEventListener('click', () => {
        sound.click();
        const targetModalId = btn.getAttribute('data-close-modal');
        const modalEl = document.getElementById(targetModalId);
        if (modalEl) closeModal(modalEl);
      });
    });

    // Clear History Button in Settings
    document.getElementById('btn-clear-history')?.addEventListener('click', () => {
      sound.click();
      if (confirm('Clear all past game history logs from this device?')) {
        engine.clearPastGames();
        alert('History cleared.');
      }
    });

    // Keyboard Shortcuts for power pass-and-play:
    // Space or 1: +1 raise / Open
    // 2: +2 raise
    // 5: +5 raise
    // D: Drop
    // U: Undo
    window.addEventListener('keydown', (e) => {
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
      if (engine.state !== 'AUCTION' || !engine.auction) return;

      if (!engine.auction.isOpen) {
        if (e.code === 'Space' || e.key === 'Enter') {
          e.preventDefault();
          engine.openAuction();
        }
      } else {
        if (e.key === '1') {
          try { engine.raiseBid(1); } catch (err) {}
        } else if (e.key === '2') {
          try { engine.raiseBid(2); } catch (err) {}
        } else if (e.key === '5') {
          try { engine.raiseBid(5); } catch (err) {}
        } else if (e.key.toLowerCase() === 'd') {
          document.getElementById('btn-action-drop')?.click();
        } else if (e.key.toLowerCase() === 'u') {
          document.getElementById('btn-undo-bid')?.click();
        }
      }
    });
  }

  // --- SERVICE WORKER REGISTRATION (FR-11) ---
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').then(reg => {
        console.log('TFI Auction Service Worker registered with scope:', reg.scope);
      }).catch(err => {
        console.log('Service Worker registration skipped or failed:', err);
      });
    });
  }

  // Bootstrap
  window.addEventListener('DOMContentLoaded', () => {
    setupDOMEvents();
    initHomeScreen();
    showScreen('home');
  });
})();
