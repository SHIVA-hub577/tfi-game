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
      this.topic = null;
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

    // Calculate maximum valid movies-per-player limit
    // PRD: players * limit <= poolSize AND limit <= budget
    static calculateMaxLimit(playersCount, poolSize, budget) {
      if (!playersCount || playersCount < 2) return 1;
      const byPool = Math.floor(poolSize / playersCount);
      return Math.max(1, Math.min(byPool, budget));
    }

    // Validation for setup
    validateSetup(playerNames, budget, topicId, poolSize, limit) {
      const errors = [];
      if (![2, 3, 4].includes(playerNames.length)) {
        errors.push('Player count must be 2, 3, or 4.');
      }
      const trimmed = playerNames.map(n => (n || '').trim());
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
      const topic = this.getTopicById(topicId);
      if (!topic || !topic.movies || topic.movies.length < 6) {
        errors.push('Selected topic must have at least 6 movies.');
      } else {
        if (poolSize < 6 || poolSize > topic.movies.length) {
          errors.push(`Pool size must be between 6 and ${topic.movies.length}.`);
        }
      }
      const maxLimit = TFIAuctionEngine.calculateMaxLimit(playerNames.length, poolSize, budget);
      if (limit < 1 || limit > maxLimit) {
        errors.push(`Movies per player must be between 1 and ${maxLimit}.`);
      }
      return {
        isValid: errors.length === 0,
        errors,
        maxLimit
      };
    }

    // Initialize new game from setup
    startNewGame(config) {
      const { playerNames, budget, topicId, poolSize, limit, timerDuration } = config;
      const validation = this.validateSetup(playerNames, budget, topicId, poolSize, limit);
      if (!validation.isValid) {
        throw new Error(validation.errors.join(' '));
      }

      this.budget = budget;
      this.topicId = topicId;
      this.topic = this.getTopicById(topicId);
      this.poolSize = poolSize;
      this.moviesPerPlayer = limit;
      this.timerDuration = timerDuration || 0;

      // Create players
      this.players = playerNames.map((name, idx) => ({
        id: `p_${idx + 1}`,
        name: name.trim(),
        coins: budget,
        wonMovies: []
      }));

      // Pick poolSize random movies from topic
      const shuffledMovies = [...this.topic.movies].sort(() => Math.random() - 0.5);
      this.moviePool = shuffledMovies.slice(0, poolSize);
      this.currentMovieIndex = -1;

      // Random opener for the very first movie (PRD 5.1: Random for first movie)
      this.openerPlayerIndex = Math.floor(Math.random() * this.players.length);

      this.state = 'AUCTION';
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
        const cost = 1;
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

    // Skip this movie: if a player selects skip before auction opens,
    // control moves to the next eligible player with the same skip option.
    // If all eligible players select skip, the movie is skipped and not picked by anyone.
    skipMovie(playerId) {
      if (!this.auction || this.auction.isOpen) return { status: 'invalid' };
      if (this.state === 'SKIPPED' || this.state === 'SOLD') return { status: 'invalid' };

      const currentVoterId = playerId || this.auction.turnPlayerId;
      if (!this.auction.skipVotes) {
        this.auction.skipVotes = [];
      }

      if (!this.auction.skipVotes.includes(currentVoterId)) {
        this.auction.skipVotes.push(currentVoterId);
      }

      const eligiblePlayers = this.getPlayersNeedingMovies();
      const votesIn = this.auction.skipVotes.length;
      const votesNeeded = eligiblePlayers.length;

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

      // Find next eligible player who hasn't skipped yet (clockwise order)
      const currentIdx = eligiblePlayers.findIndex(p => p.id === currentVoterId);
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

      // Pass opening turn & control to next eligible player
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

      const opener = this.players.find(p => p.id === this.auction.openerId);
      if (!opener) return;

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

    // Current turn player drops from bidding on this movie
    dropPlayer() {
      if (!this.auction || !this.auction.isOpen) return false;

      const currentTurnPlayer = this.players.find(p => p.id === this.auction.turnPlayerId);
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

    // Move turn to next active bidder
    advanceTurn() {
      if (!this.auction) return;
      const active = this.auction.activeBidders;
      if (active.length <= 1) {
        this.concludeMovieSale();
        return;
      }

      const currentIdx = active.indexOf(this.auction.turnPlayerId);
      let nextIdx = (currentIdx + 1) % active.length;

      // If next player is already the current leader, they have won!
      if (active[nextIdx] === this.auction.leaderId) {
        this.concludeMovieSale();
        return;
      }

      this.auction.turnPlayerId = active[nextIdx];
      const nextPlayer = this.players.find(p => p.id === this.auction.turnPlayerId);

      this.notify('TURN_CHANGED', {
        turnPlayer: nextPlayer
      });
    }

    // Conclude movie sale when all others dropped or leader unchallenged
    concludeMovieSale() {
      if (!this.auction) return;

      const winnerId = this.auction.leaderId || this.auction.activeBidders[0];
      const winner = this.players.find(p => p.id === winnerId);
      const price = this.auction.currentBid;
      const movie = this.auction.movie;

      if (winner) {
        winner.coins -= price;
        winner.wonMovies.push({
          id: movie.id,
          title: movie.title,
          price,
          topic: this.topic.name,
          bidsCount: this.auction.history.length
        });
      }

      this.state = 'SOLD';
      this.notify('MOVIE_SOLD', {
        movie,
        buyer: winner,
        price,
        autoAwarded: false
      });
    }

    // End current game (when finished or host confirms early exit)
    endGame() {
      this.state = 'GAME_END';

      // Save to game history
      this.archiveCurrentGame();

      // Clear current saved game
      localStorage.removeItem(STORAGE_KEY_CURRENT);

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
        const topic = this.getTopicById(d.topicId);
        return {
          playersCount: d.players.length,
          playerNames: d.players.map(p => p.name).join(', '),
          topicName: topic ? topic.name : 'Tollywood Movies',
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
        this.topicId = data.topicId;
        this.topic = this.getTopicById(data.topicId);
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
      localStorage.removeItem(STORAGE_KEY_CURRENT);
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
      localStorage.removeItem(STORAGE_KEY_HISTORY);
    }
  }

  window.TFIAuctionEngine = TFIAuctionEngine;
})();
