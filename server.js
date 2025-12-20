const express = require('express');
const http = require('http');
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// NAIPES: Ouros (0) < Espadas (1) < Copas (2) < Paus (3)
const SUITS = ['ouros', 'espadas', 'copas', 'paus']; 
const VALUES = ['4', '5', '6', '7', 'Q', 'J', 'K', 'A', '2', '3']; 

let gameState = {
    players: [], 
    deck: [],
    round: 0,
    vira: null,
    manilhaValue: null,
    currentTurnIndex: 0,
    bettingTurnIndex: 0,
    roundStarterIndex: 0,
    tableCards: [],
    status: 'LOBBY',
    winner: null,
    jackpot: 0, // Acumulado DA RODADA ATUAL
    roundHasWinner: false 
};

function createDeck() {
    let deck = [];
    for (let s of SUITS) for (let v of VALUES) deck.push({ value: v, suit: s });
    return deck;
}
function shuffle(deck) {
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
}
function getNextManilha(viraValue) {
    let idx = VALUES.indexOf(viraValue);
    return VALUES[(idx + 1) % VALUES.length];
}

function getCardStrength(card, manilhaVal) {
    if (card.value === manilhaVal) {
        return 100 + SUITS.indexOf(card.suit); 
    }
    return VALUES.indexOf(card.value); 
}

io.on('connection', (socket) => {
    
    // 1. Entrada / Reconexão
    socket.on('join_game', (data) => {
        const existingPlayer = gameState.players.find(p => p.name === data.name);
        
        if (existingPlayer) {
            existingPlayer.id = socket.id;
            existingPlayer.avatar = data.avatar;
            existingPlayer.disconnected = false;
            broadcastState();
            return;
        }

        const isGameRunning = gameState.status !== 'LOBBY' && gameState.status !== 'GAME_OVER';
        
        gameState.players.push({
            id: socket.id,
            name: data.name,
            avatar: data.avatar,
            lives: 5,
            isReady: false,
            hand: [],
            bet: -1,
            tricksWon: 0,
            isEliminated: false,
            disconnected: false,
            isSpectator: isGameRunning 
        });
        broadcastState();
    });

    socket.on('toggle_ready', () => {
        const p = gameState.players.find(p => p.id === socket.id);
        if (p && !p.isSpectator) { 
            p.isReady = !p.isReady; 
            broadcastState(); 
            checkAllReady(); 
        }
    });

    socket.on('place_bet', (amount) => {
        if (gameState.status !== 'BETTING') return;
        const pIdx = gameState.players.findIndex(p => p.id === socket.id);
        if (pIdx !== gameState.bettingTurnIndex) return;

        const activePlayers = gameState.players.filter(p => !p.isEliminated && !p.disconnected && !p.isSpectator);
        const playersBettingNow = activePlayers.filter(p => p.bet === -1);
        
        // Regra Sandwich
        if (playersBettingNow.length === 1) {
            const currentSum = activePlayers.reduce((sum, p) => sum + (p.bet === -1 ? 0 : p.bet), 0);
            const forbidden = gameState.round - currentSum;
            if (amount === forbidden && amount >= 0) return;
        }

        gameState.players[pIdx].bet = amount;
        advanceBettingTurn();
    });

    socket.on('play_card', (cardIndex) => {
        if (gameState.status !== 'PLAYING') return;
        const pIdx = gameState.players.findIndex(p => p.id === socket.id);
        if (pIdx !== gameState.currentTurnIndex) return;

        const player = gameState.players[pIdx];
        const card = player.hand.splice(cardIndex, 1)[0];
        gameState.tableCards.push({ playerId: player.id, name: player.name, card: card });

        advancePlayTurn();
    });

    socket.on('restart_game', () => {
        if (gameState.status === 'GAME_OVER') resetGameForNewMatch();
    });

    socket.on('disconnect', () => {
        const p = gameState.players.find(p => p.id === socket.id);
        if (!p) return;

        if (gameState.status === 'LOBBY') {
            gameState.players = gameState.players.filter(p => p.id !== socket.id);
        } else {
            p.disconnected = true;
        }
        
        const onlineCount = gameState.players.filter(p => !p.disconnected).length;
        if (onlineCount === 0) hardResetServer();

        broadcastState();
    });
});

function advanceBettingTurn() {
    let nextBet = (gameState.bettingTurnIndex + 1) % gameState.players.length;
    let count = 0;
    while((gameState.players[nextBet].isEliminated || gameState.players[nextBet].disconnected || gameState.players[nextBet].isSpectator) && count < gameState.players.length) {
        nextBet = (nextBet + 1) % gameState.players.length;
        count++;
    }
    gameState.bettingTurnIndex = nextBet;

    const active = gameState.players.filter(p => !p.isEliminated && !p.disconnected && !p.isSpectator);
    if (active.every(p => p.bet !== -1)) {
        gameState.status = 'PLAYING';
        gameState.currentTurnIndex = gameState.roundStarterIndex;
        while(gameState.players[gameState.currentTurnIndex].isEliminated || gameState.players[gameState.currentTurnIndex].disconnected || gameState.players[gameState.currentTurnIndex].isSpectator) {
            gameState.currentTurnIndex = (gameState.currentTurnIndex + 1) % gameState.players.length;
        }
    }
    broadcastState();
}

function advancePlayTurn() {
    let next = (gameState.currentTurnIndex + 1) % gameState.players.length;
    let count = 0;
    while((gameState.players[next].isEliminated || gameState.players[next].disconnected || gameState.players[next].isSpectator) && count < gameState.players.length) {
        next = (next + 1) % gameState.players.length;
        count++;
    }
    gameState.currentTurnIndex = next;

    const activeCount = gameState.players.filter(p => !p.isEliminated && !p.disconnected && !p.isSpectator).length;

    if (gameState.tableCards.length >= activeCount && activeCount > 0) {
        broadcastState();
        setTimeout(resolveTrick, 2500); 
    } else {
        broadcastState();
    }
}

// --- RESOLUÇÃO DA VAZA (LÓGICA CORRIGIDA) ---
function resolveTrick() {
    if (gameState.tableCards.length === 0) return;

    // 1. Calcula força
    let plays = gameState.tableCards.map(play => {
        return { ...play, strength: getCardStrength(play.card, gameState.manilhaValue) };
    });

    // Ordena da maior força para a menor
    plays.sort((a, b) => b.strength - a.strength);

    let winnerId = null;

    // 2. Lógica de Eliminação em Pares
    // Enquanto houver cartas para verificar...
    while (plays.length > 0) {
        // Se só sobrou uma carta, ela é a vencedora absoluta
        if (plays.length === 1) {
            winnerId = plays[0].playerId;
            break;
        }

        // Se tem pelo menos duas, comparamos a primeira com a segunda
        if (plays[0].strength === plays[1].strength) {
            // EMPATE! 
            // Removemos EXATAMENTE DUAS cartas (o par que se anulou)
            // .shift() remove o primeiro elemento do array
            plays.shift(); // Tira a primeira
            plays.shift(); // Tira a segunda
            
            // O loop continua agora com as cartas que sobraram (se sobraram)
        } else {
            // A primeira é maior que a segunda e não empatou.
            // Ela vence!
            winnerId = plays[0].playerId;
            break;
        }
    }

    // 3. Aplica Resultado
    if (winnerId) {
        const winner = gameState.players.find(p => p.id === winnerId);
        if (winner) {
            winner.tricksWon += (1 + gameState.jackpot);
            gameState.jackpot = 0; 
            gameState.roundHasWinner = true;
        }
        
        const wIdx = gameState.players.findIndex(p => p.id === winnerId);
        gameState.currentTurnIndex = wIdx;
    } else {
        // Se o loop zerou as cartas (todas se anularam em pares)
        gameState.jackpot += 1;
        
        // Quem começa a próxima? O dono da maior carta ORIGINAL da mesa
        const originalBest = gameState.tableCards.map(p => ({...p, s: getCardStrength(p.card, gameState.manilhaValue)}))
                                                 .sort((a, b) => b.s - a.s)[0];
        const wIdx = gameState.players.findIndex(p => p.id === originalBest.playerId);
        gameState.currentTurnIndex = wIdx;
    }

    gameState.tableCards = [];

    const active = gameState.players.filter(p => !p.isEliminated && !p.disconnected && !p.isSpectator);
    if (active.length > 0 && active[0].hand.length === 0) {
        calculateLives();
    } else {
        broadcastState();
    }
}

function calculateLives() {
    // AQUI MUDOU: Não incrementamos jackpot globalmente. 
    // Se a rodada acabou e sobrou jackpot, ele morre (reseta no startRound).

    gameState.players.forEach(p => {
        if (!p.isEliminated && !p.disconnected && !p.isSpectator) {
            const damage = Math.abs(p.bet - p.tricksWon);
            p.lives -= damage;
            if (p.lives <= 0) { p.lives = 0; p.isEliminated = true; }
        }
    });

    const survivors = gameState.players.filter(p => !p.isEliminated && !p.disconnected && !p.isSpectator);
    
    if (survivors.length <= 1 && gameState.players.length > 1) {
        gameState.status = 'GAME_OVER';
        gameState.winner = survivors.length === 1 ? survivors[0] : null;
        broadcastState();
    } else {
        broadcastState();
        setTimeout(() => startRound(gameState.round + 1), 3000);
    }
}

function startRound(num) {
    gameState.status = 'BETTING';
    gameState.round = num;
    gameState.roundHasWinner = false;
    gameState.jackpot = 0; // RESET DO ACUMULADO A CADA NOVA DISTRIBUIÇÃO

    gameState.deck = createDeck();
    shuffle(gameState.deck);
    gameState.tableCards = [];
    
    gameState.vira = gameState.deck.pop();
    gameState.manilhaValue = getNextManilha(gameState.vira.value);
    
    let starter = (num - 1) % gameState.players.length;
    let safeCount = 0;
    while((gameState.players[starter].isEliminated || gameState.players[starter].disconnected || gameState.players[starter].isSpectator) && safeCount < gameState.players.length * 2) {
        starter = (starter + 1) % gameState.players.length;
        safeCount++;
    }
    gameState.roundStarterIndex = starter; 
    gameState.bettingTurnIndex = starter;  

    gameState.players.forEach(p => {
        p.bet = -1; 
        p.tricksWon = 0; 
        p.hand = [];
        if (!p.isEliminated && !p.disconnected && !p.isSpectator) {
            for(let i=0; i<num; i++) {
                if(gameState.deck.length > 0) p.hand.push(gameState.deck.pop());
            }
        }
    });
    broadcastState();
}

function checkAllReady() {
    const players = gameState.players.filter(p => !p.disconnected && !p.isSpectator);
    if (players.length >= 2 && players.every(p => p.isReady)) {
        startRound(1);
    }
}

function resetGameForNewMatch() {
    gameState.status = 'LOBBY';
    gameState.round = 0;
    gameState.jackpot = 0;
    gameState.winner = null;
    gameState.tableCards = [];
    
    gameState.players.forEach(p => {
        p.lives = 5;
        p.isEliminated = false;
        p.isReady = false;
        p.hand = [];
        p.bet = -1;
        p.tricksWon = 0;
        p.isSpectator = false;
    });
    broadcastState();
}

function hardResetServer() {
    gameState = {
        players: [], deck: [], round: 0, vira: null, manilhaValue: null,
        currentTurnIndex: 0, bettingTurnIndex: 0, roundStarterIndex: 0,
        tableCards: [], status: 'LOBBY', winner: null, jackpot: 0, roundHasWinner: false
    };
}

function broadcastState() { 
    let forbiddenBet = -1;
    const active = gameState.players.filter(p => !p.isEliminated && !p.disconnected && !p.isSpectator);
    const betting = active.filter(p => p.bet === -1);

    if (betting.length === 1 && gameState.status === 'BETTING') {
        const currentSum = active.reduce((sum, p) => sum + (p.bet === -1 ? 0 : p.bet), 0);
        forbiddenBet = gameState.round - currentSum;
    }

    const payload = { ...gameState, forbiddenBet };
    io.emit('game_update', payload); 
}

server.listen(3000, () => console.log('Servidor ON 3000'));