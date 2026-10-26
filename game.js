// TFI Auction - Core Auction Game Engine & State Machine
// 100% Offline, pass-and-play logic, strict PRD rules compliance

(function () {
  const STORAGE_KEY_CURRENT = 'tfi_current_game';
  const STORAGE_KEY_HISTORY = 'tfi_past_games';
  const STORAGE_KEY_CUSTOM_TOPICS = 'tfi_custom_topics';

  class TFIAuctionEngine {
    constructor() {
      this.state = 'HOME'; // HOME, SETUP, AUCTION, SOLD, GAME_END
      this.players = [];
      this.budget = 50;
      this.topicId = 'any-tfi';
      this.topicIds = ['any-tfi'];
      this.topics = [];
      this.topic = null;
      this.skippedMovies = [];
      this.poolSize = 15;
      this.moviesPerPlayer = 3;
      this.moviePool = [];
      this.currentMovieIndex = -1;
      this.openerPlayerIndex = 0;
      this.auction = null;
      this.undoStack = [];
      this.timerDuration = 0; // 0 = off, 10, 15, 20, 30
      this.listeners = [];
    }

    // Subscribe to state updates
    subscribe(fn) {
      this.listeners.push(fn);
    }

    notify(event, payload) {
      this.listeners.forEach(fn => {
        try { fn(event, payload, this); } catch (e) { console.error(e); }
      });
      this.saveState();
    }

    // Load custom topics if any, merged with bundled topics
    getAllTopics() {
      const bundled = (window.TFI_DATA && window.TFI_DATA.topics) ? window.TFI_DATA.topics : [];
      try {
        const custom = JSON.parse(localStorage.getItem(STORAGE_KEY_CUSTOM_TOPICS) || '[]');
        return [...bundled, ...custom];
      } catch (e) {
        return bundled;
      }
    }

    getTopicById(id) {
      const all = this.getAllTopics();
      return all.find(t => t.id === id) || all[0];
    }

    // Resolve one or many topic ids into real topic objects
    resolveTopics(topicIds) {
      const all = this.getAllTopics();
      const ids = (Array.isArray(topicIds) ? topicIds : [topicIds]).filter(Boolean);
      const picked = [];
      const seen = new Set();
      ids.forEach(id => {
        const t = all.find(x => x.id === id);
        if (t && !seen.has(t.id)) {
          seen.add(t.id);
          picked.push(t);
        }
      });
      return picked.length ? picked : (all.length ? [all[0]] : []);
    }

    // Combined, de-duplicated movie list for one topic or many topics
    getAvailableMovies(topicIds) {
      const topics = this.resolveTopics(topicIds);
      const seen = new Set();
      const movies = [];
      topics.forEach(t => (t.movies || []).forEach(m => {
        const key = String(m.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        if (!key || seen.has(key)) return;
        seen.add(key);
        movies.push(m);
      }));
      return { topics, movies };
    }

    buildTopicLabel(topics) {
      if (!topics || topics.length === 0) return 'TFI Movies';
      if (topics.length === 1) return topics[0].name;
      if (topics.length === 2) return `${topics[0].name} + ${topics[1].name}`;
      return `${topics[0].name} + ${topics.length - 1} more topics`;
    }

    // Build the composite "topic" used by the arena UI
    applyTopicSelection(topicIds) {
      const { topics, movies } = this.getAvailableMovies(topicIds);
      this.topics = topics;
      this.topicIds = topics.map(t => t.id);
      if (this.topicIds.length === 0) this.topicIds = ['any-tfi'];
      this.topicId = this.topicIds[0];
      this.topic = {
        id: this.topicIds.join('+'),
        name: this.buildTopicLabel(topics),
        category: topics.length > 1 ? 'multi' : (topics[0] ? topics[0].category : 'general'),
        movies
      };
      return this.topic;
    }

    // Calculate maximum valid movies-per-player limit
    // PRD: players * limit <= poolSize AND limit <= budget
    static calculateMaxLimit(playersCount, poolSize, budget) {
      if (!playersCount || playersCount < 2) return 1;
      const byPool = Math.floor(poolSize / playersCount);
      return Math.max(1, Math.min(byPool, budget));
    }

    // Validation for setup (topicIds may be a single id or an array of ids)
    validateSetup(playerNames, budget, topicIdOrIds, poolSize, limit) {
      const errors = [];
      const names = Array.isArray(playerNames) ? playerNames : [];
      if (![2, 3, 4].includes(names.length)) {
        errors.push('Player count must be 2, 3, or 4.');
      }
      const trimmed = names.map(n => (n || '').trim());
      if (trimmed.some(n => n.length === 0)) {
        errors.push('All players must have a name.');
      }
      const lowerNames = trimmed.map(n => n.toLowerCase());
      const duplicates = lowerNames.filter((item, index) => lowerNames.indexOf(item) !== index);
      if (duplicates.length > 0) {
        errors.push('Player names must be unique (no duplicate names).');
      }
      if (typeof budget !== 'number' || budget < 20 || budget > 70) {
        errors.push('Budget must be between 20 and 70 coins.');
      }
      const { topics, movies } = this.getAvailableMovies(topicIdOrIds);
      const rawIds = (Array.isArray(topicIdOrIds) ? topicIdOrIds : [topicIdOrIds]).filter(Boolean);
      if (rawIds.length === 0 || topics.length === 0) {
        errors.push('Select at least one topic.');
      }
      if (movies.length < 6) {
        errors.push('Selected topics need at least 6 movies combined.');
      } else if (poolSize < 6 || poolSize > movies.length) {
        errors.push(`Pool size must be between 6 and ${movies.length}.`);
      }
      const maxLimit = TFIAuctionEngine.calculateMaxLimit(names.length, poolSize, budget);
      if (limit < 1 || limit > maxLimit) {
        errors.push(`Movies per player must be between 1 and ${maxLimit}.`);
      }
      return {
        isValid: errors.length === 0,
        errors,
        maxLimit,
        availableMovies: movies.length
      };
    }

    // Initialize new game from setup
    startNewGame(config) {
      const { playerNames, budget, topicId, topicIds, poolSize, limit, timerDuration } = config;
      const selection = (Array.isArray(topicIds) && topicIds.length)
        ? topicIds
        : (topicId ? [topicId] : ['any-tfi']);
      const validation = this.validateSetup(playerNames, budget, selection, poolSize, limit);
      if (!validation.isValid) {
        throw new Error(validation.errors.join(' '));
      }

      this.budget = budget;
      this.applyTopicSelection(selection);
      this.poolSize = Math.min(poolSize, this.topic.movies.length);
      this.moviesPerPlayer = limit;
      this.timerDuration = timerDuration || 0;
      this.skippedMovies = [];

      // Create players
      this.players = playerNames.map((name, idx) => ({
        id: `p_${idx + 1}`,
        name: name.trim(),
        coins: budget,
        wonMovies: []
      }));

      // Pick poolSize random movies from the combined topic pool
      const shuffledMovies = [...this.topic.movies].sort(() => Math.random() - 0.5);
      this.moviePool = shuffledMovies.slice(0, this.poolSize);
      this.currentMovieIndex = -1;

      // Random opener for the very first movie (PRD 5.1: Random for first movie)
      this.openerPlayerIndex = Math.floor(Math.random() * this.players.length);

      this.state = 'AUCTION';
      this.auction = null;
      this.undoStack = [];

      this.notify('GAME_STARTED');
      this.startNextMovie();
    }

    // Get list of players who still need movies
    getPlayersNeedingMovies() {
      return this.players.filter(p => p.wonMovies.length < this.moviesPerPlayer);
    }

    // Calculate reserve coins and max bid for a player
    // PRD 5.3: Reserve rule: a player must keep 1 coin for every OTHER movie they still need to win.
    // Maximum bid = coins left - (movies still needed - 1)
    calculatePlayerMaxBid(player) {
      const moviesStillNeeded = this.moviesPerPlayer - player.wonMovies.length;
      if (moviesStillNeeded <= 0) return 0;
      const reserve = Math.max(0, moviesStillNeeded - 1);
      const maxBid = player.coins - reserve;
      return Math.max(0, maxBid);
    }

    // Get minimum raise required given current bid
    // PRD 5.3: Minimum raise: 1 coin up to a bid of 20, then 2 coins above 20
    getMinimumRaise(currentBid) {
      return currentBid < 20 ? 1 : 2;
    }

    // Check if the whole game has concluded
    isGameOver() {
      // 1. Every player has reached their movie limit
      const allReached = this.players.every(p => p.wonMovies.length >= this.moviesPerPlayer);
      if (allReached) return true;

      // 2. Movie pool is exhausted
      if (this.currentMovieIndex >= this.moviePool.length) return true;

      return false;
    }

    // Start auction for next movie in the pool
    startNextMovie() {
      // Guard against double-clicks on "Next Movie" skipping a film
      if (this.state === 'AUCTION' && this.auction) return;

      if (this.isGameOver()) {
        this.endGame();
        return;
      }

      this.currentMovieIndex++;
      if (this.currentMovieIndex >= this.moviePool.length) {
        this.endGame();
        return;
      }

      const movie = this.moviePool[this.currentMovieIndex];
      const eligiblePlayers = this.getPlayersNeedingMovies();

      // EDGE CASE FR-8 & 12: If only one player still needs movies,
      // that player takes each remaining movie at base price (1 coin) with no bidding!
      if (eligiblePlayers.length === 1) {
        const solePlayer = eligiblePlayers[0];
        const cost = Math.min(1, Math.max(0, solePlayer.coins));
        solePlayer.coins -= cost;
        solePlayer.wonMovies.push({
          id: movie.id,
          title: movie.title,
          price: cost,
          topic: this.topic.name,
          autoAwarded: true
        });

        this.auction = {
          movieId: movie.id,
          movie,
          currentBid: cost,
          leaderId: solePlayer.id,
          activeBidders: [solePlayer.id],
          turnPlayerId: solePlayer.id,
          isOpen: true,
          isAutoAwarded: true
        };

        this.state = 'SOLD';
        this.notify('MOVIE_SOLD', {
          movie,
          buyer: solePlayer,
          price: cost,
          autoAwarded: true
        });
        return;
      }

      // Normal multi-player auction setup
      // Rotate opener among players who still need movies
      // Find candidate openers in circular order starting from openerPlayerIndex
      let opener = null;
      const numPlayers = this.players.length;
      for (let i = 0; i < numPlayers; i++) {
        const candidateIdx = (this.openerPlayerIndex + i) % numPlayers;
        const candidate = this.players[candidateIdx];
        if (candidate.wonMovies.length < this.moviesPerPlayer) {
          opener = candidate;
          this.openerPlayerIndex = (candidateIdx + 1) % numPlayers;
          break;
        }
      }

      if (!opener) {
        opener = eligiblePlayers[0];
      }

      // Order active bidders starting with opener, then clockwise
      const openerIdxInEligible = eligiblePlayers.findIndex(p => p.id === opener.id);
      const activeBidders = [];
      for (let i = 0; i < eligiblePlayers.length; i++) {
        const p = eligiblePlayers[(openerIdxInEligible + i) % eligiblePlayers.length];
        activeBidders.push(p.id);
      }

      this.undoStack = [];
      this.auction = {
        movieId: movie.id,
        movie,
        currentBid: 1, // base price is 1 coin
        leaderId: null, // unopened initially
        activeBidders,
        turnPlayerId: opener.id,
        openerId: opener.id,
        isOpen: false, // Opener must place opening bid
        history: [],
        skipVotes: [] // player IDs who voted to skip this movie
      };

      this.state = 'AUCTION';
      this.notify('AUCTION_STARTED', {
        movie,
        opener,
        basePrice: 1
      });
    }

    // Skip this movie: every eligible player gets asked in turn.
    // The movie is only discarded when ALL eligible players have passed.
    skipMovie(playerId) {
      if (!this.auction || this.auction.isOpen) return { status: 'invalid' };
      if (this.state === 'SKIPPED' || this.state === 'SOLD') return { status: 'invalid' };

      const currentVoterId = playerId || this.auction.turnPlayerId;
      if (!this.auction.skipVotes) {
        this.auction.skipVotes = [];
      }

      const eligiblePlayers = this.getPlayersNeedingMovies();
      const eligibleIds = eligiblePlayers.map(p => p.id);
      // Ignore stale votes from players who no longer need a movie
      this.auction.skipVotes = this.auction.skipVotes.filter(id => eligibleIds.includes(id));

      if (!eligibleIds.includes(currentVoterId)) return { status: 'invalid' };

      if (!this.auction.skipVotes.includes(currentVoterId)) {
        this.auction.skipVotes.push(currentVoterId);
      }

      const votesIn = this.auction.skipVotes.length;
      const votesNeeded = eligibleIds.length;

      // Check if ALL eligible players have voted to skip
      if (votesIn >= votesNeeded) {
        if (!this.skippedMovies) this.skippedMovies = [];
        this.skippedMovies.push(this.auction.movie);
        this.state = 'SKIPPED';
        this.notify('MOVIE_SKIPPED', {
          movie: this.auction.movie,
          skippedByAll: true,
          skipVotes: this.auction.skipVotes
        });
        return { status: 'all_skipped' };
      }

      // Find next eligible player who hasn't voted yet (clockwise order)
      const currentIdx = eligibleIds.indexOf(currentVoterId);
      let nextPlayer = null;
      for (let i = 1; i <= eligiblePlayers.length; i++) {
        const candidate = eligiblePlayers[(currentIdx + i) % eligiblePlayers.length];
        if (!this.auction.skipVotes.includes(candidate.id)) {
          nextPlayer = candidate;
          break;
        }
      }

      if (!nextPlayer) {
        if (!this.skippedMovies) this.skippedMovies = [];
        this.skippedMovies.push(this.auction.movie);
        this.state = 'SKIPPED';
        this.notify('MOVIE_SKIPPED', {
          movie: this.auction.movie,
          skippedByAll: true,
          skipVotes: this.auction.skipVotes
        });
        return { status: 'all_skipped' };
      }

      // Pass the opening decision to the next player who hasn't passed yet
      this.auction.turnPlayerId = nextPlayer.id;
      this.auction.openerId = nextPlayer.id;

      this.notify('PRE_AUCTION_TURN_CHANGED', {
        previousPlayerId: currentVoterId,
        turnPlayer: nextPlayer,
        votesIn,
        votesNeeded,
        skipVotes: this.auction.skipVotes
      });

      return { status: 'passed_to_next', nextPlayerId: nextPlayer.id, votesIn, votesNeeded };
    }

    // Opener places opening bid at base price (1 coin)
    openAuction() {
      if (!this.auction || this.auction.isOpen) return;
      if (this.state !== 'AUCTION') return;

      const opener = this.players.find(p => p.id === this.auction.openerId);
      if (!opener) return;
      if (opener.wonMovies.length >= this.moviesPerPlayer) return;
      if (this.calculatePlayerMaxBid(opener) < 1) return;

      // Re-order active bidders starting with the actual opener who opened it
      const eligiblePlayers = this.getPlayersNeedingMovies();
      const openerIdxInEligible = eligiblePlayers.findIndex(p => p.id === opener.id);
      const activeBidders = [];
      for (let i = 0; i < eligiblePlayers.length; i++) {
        const p = eligiblePlayers[(openerIdxInEligible + i) % eligiblePlayers.length];
        activeBidders.push(p.id);
      }

      this.auction.activeBidders = activeBidders;
      this.auction.turnPlayerId = opener.id;
      this.auction.isOpen = true;
      this.auction.currentBid = 1;
      this.auction.leaderId = opener.id;
      this.auction.history.push({
        type: 'OPEN',
        playerId: opener.id,
        playerName: opener.name,
        amount: 1,
        timestamp: Date.now()
      });

      // Turn moves clockwise to the next active bidder
      this.advanceTurn();
      this.notify('AUCTION_OPENED', {
        leader: opener,
        currentBid: 1
      });
    }

    // Save snapshot to undo stack before a bid/raise
    pushUndoSnapshot() {
      if (!this.auction) return;
      const snapshot = {
        currentBid: this.auction.currentBid,
        leaderId: this.auction.leaderId,
        activeBidders: [...this.auction.activeBidders],
        turnPlayerId: this.auction.turnPlayerId,
        history: [...this.auction.history],
        isOpen: this.auction.isOpen
      };
      this.undoStack.push(snapshot);
    }

    // Undo last bid (FR-13)
    canUndo() {
      return this.state === 'AUCTION' && this.undoStack.length > 0;
    }

    undoLastBid() {
      if (!this.canUndo()) return false;
      const snapshot = this.undoStack.pop();
      this.auction.currentBid = snapshot.currentBid;
      this.auction.leaderId = snapshot.leaderId;
      this.auction.activeBidders = snapshot.activeBidders;
      this.auction.turnPlayerId = snapshot.turnPlayerId;
      this.auction.history = snapshot.history;
      this.auction.isOpen = snapshot.isOpen;

      this.notify('BID_UNDONE');
      return true;
    }

    // Place a raise on current bid
    // amount is the addition (+1, +2, +5, etc.) or absolute new bid
    raiseBid(raiseAmount, isAbsolute = false) {
      if (!this.auction || !this.auction.isOpen) return false;

      const currentTurnPlayer = this.players.find(p => p.id === this.auction.turnPlayerId);
      if (!currentTurnPlayer) return false;

      const minRaise = this.getMinimumRaise(this.auction.currentBid);
      const newBid = isAbsolute ? raiseAmount : (this.auction.currentBid + raiseAmount);
      const delta = newBid - this.auction.currentBid;

      if (delta < minRaise) {
        throw new Error(`Minimum raise required is +${minRaise} coins.`);
      }

      const maxBid = this.calculatePlayerMaxBid(currentTurnPlayer);
      if (newBid > maxBid) {
        throw new Error(`Bid exceeds your max bid limit of ${maxBid} coins (Reserve rule).`);
      }

      this.pushUndoSnapshot();

      this.auction.currentBid = newBid;
      this.auction.leaderId = currentTurnPlayer.id;
      this.auction.history.push({
        type: 'RAISE',
        playerId: currentTurnPlayer.id,
        playerName: currentTurnPlayer.name,
        amount: newBid,
        raiseDelta: delta,
        timestamp: Date.now()
      });

      this.notify('BID_RAISED', {
        player: currentTurnPlayer,
        newBid,
        delta
      });

      this.advanceTurn();
      return true;
    }

    // Current turn player drops from bidding on this movie.
    // playerId is the player who confirmed the drop; it must still be their turn.
    dropPlayer(playerId) {
      if (!this.auction || !this.auction.isOpen) return false;

      const actingId = playerId || this.auction.turnPlayerId;
      if (actingId !== this.auction.turnPlayerId) return false;

      const currentTurnPlayer = this.players.find(p => p.id === actingId);
      if (!currentTurnPlayer) return false;

      // Opener cannot drop before opening
      if (this.auction.turnPlayerId === this.auction.openerId && !this.auction.isOpen) {
        return false;
      }

      // Leader cannot drop against their own lead
      if (this.auction.leaderId === currentTurnPlayer.id) {
        return false;
      }

      this.pushUndoSnapshot();

      // Remove from active bidders
      this.auction.activeBidders = this.auction.activeBidders.filter(id => id !== currentTurnPlayer.id);
      this.auction.history.push({
        type: 'DROP',
        playerId: currentTurnPlayer.id,
        playerName: currentTurnPlayer.name,
        timestamp: Date.now()
      });

      this.notify('PLAYER_DROPPED', {
        player: currentTurnPlayer
      });

      // Check if only one player remains (PRD 5.2 #5)
      if (this.auction.activeBidders.length <= 1) {
        this.concludeMovieSale();
      } else {
        this.advanceTurn();
      }

      return true;
    }

    // Move turn to the next active bidder.
    // A sale ONLY ends when a single bidder is left standing — the turn must
    // never jump straight past a player who is still in the auction.
    advanceTurn() {
      if (!this.auction) return;
      const active = this.auction.activeBidders;
      if (!active || active.length === 0) {
        this.concludeMovieSale();
        return;
      }
      if (active.length <= 1) {
        this.concludeMovieSale();
        return;
      }

      const activeWithPlayers = active.filter(id => this.players.some(p => p.id === id));
      if (activeWithPlayers.length === 0) {
        this.concludeMovieSale();
        return;
      }
      if (activeWithPlayers.length === 1) {
        this.concludeMovieSale();
        return;
      }

      const rawIdx = activeWithPlayers.indexOf(this.auction.turnPlayerId);
      const startIdx = rawIdx >= 0 ? rawIdx : activeWithPlayers.length - 1;

      // Walk clockwise and hand the turn to the next bidder who is NOT the
      // current leader (the leader has nothing to raise against).
      let nextId = null;
      for (let i = 1; i <= activeWithPlayers.length; i++) {
        const candidate = activeWithPlayers[(startIdx + i) % activeWithPlayers.length];
        if (candidate !== this.auction.leaderId) {
          nextId = candidate;
          break;
        }
      }

      if (!nextId) {
        // Only the leader is left → the movie is theirs
        this.concludeMovieSale();
        return;
      }

      this.auction.turnPlayerId = nextId;
      const nextPlayer = this.players.find(p => p.id === nextId);

      this.notify('TURN_CHANGED', {
        turnPlayer: nextPlayer
      });
    }

    // Conclude movie sale when all others dropped or leader unchallenged
    concludeMovieSale() {
      if (!this.auction) return;
      if (this.state === 'SOLD' || this.state === 'SKIPPED') return;

      const winnerId = this.auction.leaderId || (this.auction.activeBidders || [])[0];
      const winner = this.players.find(p => p.id === winnerId);
      const movie = this.auction.movie;
      const price = Math.max(0, Math.min(this.auction.currentBid, winner ? winner.coins : 0));

      if (winner) {
        winner.coins -= price;
        winner.wonMovies.push({
          id: movie.id,
          title: movie.title,
          price,
          topic: this.topic.name,
          bidsCount: this.auction.history ? this.auction.history.length : 0
        });
      } else {
        // Nobody is left to claim it (should never happen) → treat as skipped
        if (!this.skippedMovies) this.skippedMovies = [];
        this.skippedMovies.push(movie);
        this.state = 'SKIPPED';
        this.notify('MOVIE_SKIPPED', { movie, skippedByAll: true, skipVotes: [] });
        return;
      }

      this.state = 'SOLD';
      this.auction.turnPlayerId = winner.id;
      this.auction.activeBidders = [winner.id];
      this.notify('MOVIE_SOLD', {
        movie,
        buyer: winner,
        price,
        autoAwarded: false
      });
    }

    // End current game (when finished or host confirms early exit)
    endGame() {
      if (this.state === 'GAME_END') return;
      this.state = 'GAME_END';

      // Save to game history
      this.archiveCurrentGame();

      // Clear current saved game
      try { localStorage.removeItem(STORAGE_KEY_CURRENT); } catch (e) { /* storage blocked */ }

      this.notify('GAME_ENDED', {
        players: this.players,
        unplayedMovies: this.getUnplayedMovies(),
        highlights: this.generateGameHighlights()
      });
    }

    // Unplayed movies from pool
    getUnplayedMovies() {
      const wonMovieIds = new Set();
      this.players.forEach(p => p.wonMovies.forEach(m => wonMovieIds.add(m.id)));
      return this.moviePool.filter(m => !wonMovieIds.has(m.id));
    }

    // Fun highlights (no winner, but engaging film awards!)
    generateGameHighlights() {
      let maxSpent = -1;
      let boxOfficeKing = null;

      let minSpentTotal = Infinity;
      let thriftyProducer = null;

      let highestSingleBid = -1;
      let blockbusterMovie = null;
      let blockbusterBuyer = null;

      let lowestSingleBid = Infinity;
      let bargainMovie = null;
      let bargainBuyer = null;

      this.players.forEach(p => {
        const totalSpent = this.budget - p.coins;
        if (totalSpent > maxSpent) {
          maxSpent = totalSpent;
          boxOfficeKing = p;
        }
        if (totalSpent < minSpentTotal) {
          minSpentTotal = totalSpent;
          thriftyProducer = p;
        }
        p.wonMovies.forEach(m => {
          if (m.price > highestSingleBid) {
            highestSingleBid = m.price;
            blockbusterMovie = m.title;
            blockbusterBuyer = p.name;
          }
          if (m.price < lowestSingleBid) {
            lowestSingleBid = m.price;
            bargainMovie = m.title;
            bargainBuyer = p.name;
          }
        });
      });

      return {
        boxOfficeKing: boxOfficeKing ? { name: boxOfficeKing.name, spent: maxSpent } : null,
        thriftyProducer: thriftyProducer ? { name: thriftyProducer.name, left: thriftyProducer.coins } : null,
        blockbuster: blockbusterBuyer ? { movie: blockbusterMovie, buyer: blockbusterBuyer, price: highestSingleBid } : null,
        bargain: bargainBuyer ? { movie: bargainMovie, buyer: bargainBuyer, price: lowestSingleBid } : null
      };
    }

    // Save and resume (FR-14)
    saveState() {
      if (this.state === 'HOME' || this.state === 'GAME_END') {
        return;
      }
      try {
        const payload = {
          state: this.state,
          players: this.players,
          budget: this.budget,
          topicId: this.topicId,
          topicIds: this.topicIds,
          poolSize: this.poolSize,
          moviesPerPlayer: this.moviesPerPlayer,
          moviePool: this.moviePool,
          currentMovieIndex: this.currentMovieIndex,
          openerPlayerIndex: this.openerPlayerIndex,
          auction: this.auction,
          timerDuration: this.timerDuration,
          skippedMovies: this.skippedMovies || [],
          savedAt: Date.now()
        };
        localStorage.setItem(STORAGE_KEY_CURRENT, JSON.stringify(payload));
      } catch (e) {
        console.warn('Failed to save state to localStorage:', e);
      }
    }

    hasSavedGame() {
      try {
        const item = localStorage.getItem(STORAGE_KEY_CURRENT);
        if (!item) return false;
        const data = JSON.parse(item);
        return data && data.players && data.players.length >= 2 && data.state !== 'GAME_END';
      } catch (e) {
        return false;
      }
    }

    getSavedGameSummary() {
      try {
        const item = localStorage.getItem(STORAGE_KEY_CURRENT);
        if (!item) return null;
        const d = JSON.parse(item);
        const ids = (Array.isArray(d.topicIds) && d.topicIds.length)
          ? d.topicIds
          : [d.topicId].filter(Boolean);
        const savedTopics = this.resolveTopics(ids.length ? ids : ['any-tfi']);
        return {
          playersCount: d.players.length,
          playerNames: d.players.map(p => p.name).join(', '),
          topicName: this.buildTopicLabel(savedTopics),
          currentRound: (d.currentMovieIndex + 1),
          totalPool: d.poolSize,
          savedAt: d.savedAt
        };
      } catch (e) {
        return null;
      }
    }

    resumeSavedGame() {
      const item = localStorage.getItem(STORAGE_KEY_CURRENT);
      if (!item) return false;
      try {
        const data = JSON.parse(item);
        this.state = data.state;
        this.players = data.players;
        this.budget = data.budget;
        const savedIds = (Array.isArray(data.topicIds) && data.topicIds.length)
          ? data.topicIds
          : [data.topicId].filter(Boolean);
        this.applyTopicSelection(savedIds.length ? savedIds : ['any-tfi']);
        this.poolSize = data.poolSize;
        this.moviesPerPlayer = data.moviesPerPlayer;
        this.moviePool = data.moviePool;
        this.currentMovieIndex = data.currentMovieIndex;
        this.openerPlayerIndex = data.openerPlayerIndex;
        this.auction = data.auction;
        this.timerDuration = data.timerDuration || 0;
        this.skippedMovies = data.skippedMovies || [];
        this.undoStack = [];

        this.notify('GAME_RESUMED');
        return true;
      } catch (e) {
        console.error('Failed to parse saved game:', e);
        return false;
      }
    }

    clearSavedGame() {
      try { localStorage.removeItem(STORAGE_KEY_CURRENT); } catch (e) { /* storage blocked */ }
    }

    // Past Game History (FR-16)
    archiveCurrentGame() {
      try {
        const list = JSON.parse(localStorage.getItem(STORAGE_KEY_HISTORY) || '[]');
        const record = {
          id: 'game_' + Date.now(),
          date: new Date().toISOString(),
          topicName: this.topic ? this.topic.name : 'TFI Movies',
          budget: this.budget,
          moviesPerPlayer: this.moviesPerPlayer,
          players: this.players.map(p => ({
            name: p.name,
            coinsLeft: p.coins,
            totalSpent: this.budget - p.coins,
            movies: p.wonMovies
          })),
          skippedMovies: this.skippedMovies || []
        };
        list.unshift(record);
        // keep last 20 games
        const trimmed = list.slice(0, 20);
        localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(trimmed));
      } catch (e) {
        console.warn('Failed to archive game:', e);
      }
    }

    getPastGames() {
      try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY_HISTORY) || '[]');
      } catch (e) {
        return [];
      }
    }

    clearPastGames() {
      try { localStorage.removeItem(STORAGE_KEY_HISTORY); } catch (e) { /* storage blocked */ }
    }
  }

  window.TFIAuctionEngine = TFIAuctionEngine;
})();
