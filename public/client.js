const socket = io();

// Define um avatar padrão local para evitar erros
let selectedAvatar = 'images/avatars/adam.jpg'; 

// Lógica de seleção de avatar
document.querySelectorAll('.avatar-option').forEach(img => {
    img.onclick = () => {
        document.querySelectorAll('.avatar-option').forEach(i => i.classList.remove('selected'));
        img.classList.add('selected');
        // Pega o caminho relativo (ex: images/avatars/foto.jpg)
        selectedAvatar = img.getAttribute('src'); 
    };
});

function joinGame() {
    const name = document.getElementById('username').value;
    if(!name) return alert("Digite um nome!");
    socket.emit('join_game', { name, avatar: selectedAvatar });
    document.querySelector('.login-box').style.display = 'none';
    document.getElementById('waiting-area').style.display = 'block';
}

function toggleReady() { socket.emit('toggle_ready'); }
function requestRestart() { socket.emit('restart_game'); }

socket.on('error_msg', (msg) => alert(msg));

socket.on('game_update', (state) => {
    const myIdx = state.players.findIndex(p => p.id === socket.id);
    const me = state.players[myIdx];

    // --- LOBBY ---
    if (state.status === 'LOBBY') {
        document.getElementById('game-screen').style.display = 'none';
        document.getElementById('lobby-screen').style.display = 'flex';
        document.getElementById('game-over-screen').style.display = 'none';

        stopVictoryMusic();
        playBackgroundMusic(); 

        const list = document.getElementById('players-list');
        list.innerHTML = state.players.map(p => `
            <div class="lobby-player">
                ${p.isReady ? '✅' : '⏳'} 
                <img src="${p.avatar}" style="width:30px; border-radius:50%"> 
                ${p.name}
            </div>
        `).join('');
        
        if (me) {
            const btn = document.getElementById('btn-ready');
            btn.innerText = me.isReady ? "ESTOU PRONTO!" : "PRONTO?";
            btn.className = me.isReady ? "btn-ready-on" : "btn-secondary";
        }
    } 
    
    // --- GAME OVER ---
    else if (state.status === 'GAME_OVER') {
        document.getElementById('game-screen').style.display = 'none';
        document.getElementById('game-over-screen').style.display = 'flex';
        
        stopBackgroundMusic();
        playVictoryMusic();

        if (state.winner) {
            document.getElementById('winner-name').innerText = state.winner.name;
            document.getElementById('winner-avatar').src = state.winner.avatar;
            document.getElementById('winner-avatar').style.display = 'block';
        } else {
            document.getElementById('winner-name').innerText = "Ninguém";
            document.getElementById('winner-avatar').style.display = 'none';
        }
    }
    
    // --- JOGO ---
    else {
        document.getElementById('lobby-screen').style.display = 'none';
        document.getElementById('game-over-screen').style.display = 'none';
        document.getElementById('game-screen').style.display = 'block';
        
        stopVictoryMusic();
        playBackgroundMusic();
        
        renderTable(state);
        
        if (!me || me.isSpectator || me.isEliminated) {
            document.getElementById('my-hand').innerHTML = '';
            document.getElementById('bet-controls').style.display = 'none';
            document.getElementById('turn-notification').innerText = me && me.isSpectator ? "Modo Espectador" : "Você foi eliminado!";
        } else {
            const isMyTurnToPlay = (state.status === 'PLAYING' && state.currentTurnIndex === myIdx);
            renderHand(me.hand, isMyTurnToPlay);

            const betControls = document.getElementById('bet-controls');
            const isMyTurnToBet = (state.status === 'BETTING' && state.bettingTurnIndex === myIdx);
            
            if (isMyTurnToBet && me.bet === -1) {
                betControls.style.display = 'inline-block';
                renderBetButtons(state.round, state.forbiddenBet); 
                updateNotification("SUA VEZ DE APOSTAR!");
            } else {
                betControls.style.display = 'none';
                if (state.status === 'BETTING') {
                    const bettor = state.players[state.bettingTurnIndex];
                    updateNotification(`Apostando: ${bettor ? bettor.name : '...'}`);
                } else if (state.status === 'PLAYING') {
                    const player = state.players[state.currentTurnIndex];
                    if (isMyTurnToPlay) updateNotification("SUA VEZ DE JOGAR!");
                    else updateNotification(`Jogando: ${player ? player.name : '...'}`);
                }
            }
        }

        if (me) {
            document.getElementById('my-lives').innerText = "❤️ " + me.lives;
            document.getElementById('my-bet-status').innerText = me.isSpectator ? "(Espectador)" : `A: ${me.bet === -1 ? '?' : me.bet} / F: ${me.tricksWon}`;
        }
    }
});

// --- SISTEMA DE POSIÇÕES FIXAS ---
function getPlayerAngle(totalPlayers, index) {
    // index 0 é sempre VOCÊ (Base/Sul)
    
    // 2 JOGADORES: Frente a frente
    if (totalPlayers === 2) {
        if (index === 0) return Math.PI / 2;    // Baixo (90 graus)
        if (index === 1) return 3 * Math.PI / 2; // Topo (270 graus)
    }
    
    // 3 JOGADORES: Triângulo
    if (totalPlayers === 3) {
        if (index === 0) return Math.PI / 2;      // Baixo
        if (index === 1) return 5 * Math.PI / 4;  // Canto Superior Esquerdo (225 graus)
        if (index === 2) return 7 * Math.PI / 4;  // Canto Superior Direito (315 graus)
    }

    // 4 JOGADORES: Cruz
    if (totalPlayers === 4) {
        const angles = [
            Math.PI / 2,     // Baixo
            Math.PI,         // Esquerda
            3 * Math.PI / 2, // Topo
            0                // Direita
        ];
        return angles[index];
    }

    // 5+ JOGADORES: Círculo Genérico (Fallback)
    return (Math.PI / 2) + (index * (2 * Math.PI / totalPlayers));
}

function renderTable(state) {
    const container = document.getElementById('table-container');
    container.querySelectorAll('.player-slot, .played-card, .jackpot-warning').forEach(e => e.remove());
    
    if (state.jackpot > 0) {
        const div = document.createElement('div');
        div.className = 'jackpot-warning';
        div.innerText = `ACUMULADO: +${state.jackpot}`;
        div.style = "position:absolute; top:40%; left:50%; transform:translate(-50%, -50%); color:#ffd700; font-weight:bold; font-size:1.2em; text-shadow:1px 1px black; border:1px solid gold; padding:2px 10px; border-radius:5px; background:rgba(0,0,0,0.5); z-index: 5;";
        container.appendChild(div);
    }

    // Filtra para garantir que a gente desenhe só quem está jogando (opcional, mas bom pra evitar bugs)
    // Se quiser ver espectadores na mesa, tire o .filter
    const myIdx = state.players.findIndex(p => p.id === socket.id);
    const totalP = state.players.length;
    const baseIdx = myIdx >= 0 ? myIdx : 0; 

    state.players.forEach((p, i) => {
        // Calcula índice relativo: 0=Eu, 1=Próximo, 2=Outro...
        let relPos = (i - baseIdx + totalP) % totalP;
        
        // Pega o ângulo fixo perfeito
        const angle = getPlayerAngle(totalP, relPos);
        
        // Distância do centro
        const radius = (relPos === 0) ? 45 : 38;

        const x = 50 + radius * Math.cos(angle);
        const y = 50 + radius * Math.sin(angle);
        
        const slot = document.createElement('div');
        slot.className = `player-slot ${p.disconnected ? 'disconnected' : ''} ${p.isSpectator ? 'spectator' : ''}`;
        
        if(state.status === 'PLAYING' && i === state.currentTurnIndex) slot.classList.add('active-turn');
        if(state.status === 'BETTING' && i === state.bettingTurnIndex) slot.classList.add('active-turn');

        slot.style.left = x+'%'; slot.style.top = y+'%';
        
        const statsLine = (p.bet !== -1 && !p.isSpectator) 
            ? `<div class="stats-line">A: ${p.bet} | F: ${p.tricksWon}</div>` 
            : '';
        
        const specLabel = p.isSpectator ? '<div style="font-size:10px; color:cyan;">(Olhando)</div>' : '';

        let livesDisplay = '';
        if (!p.isSpectator) {
            if (p.isEliminated) livesDisplay = '<div class="mini-lives">💀</div>'; 
            else livesDisplay = `<div class="mini-lives">${'❤️'.repeat(p.lives)}</div>`;
        }

        slot.innerHTML = `
            ${livesDisplay} 
            <img src="${p.avatar}" class="avatar-img">
            <div style="text-shadow: 1px 1px 2px black; font-weight:bold; font-size: 14px;">${p.name}</div>
            ${statsLine}
            ${specLabel}
        `;
        container.appendChild(slot);
        
        // CARTA JOGADA
        const played = state.tableCards.find(tc => tc.playerId === p.id);
        if (played) {
            const c = document.createElement('div'); 
            c.className = 'card played-card';
            c.innerHTML = createCardInnerHTML(played.card);
            
            const cardRadius = radius - 17; 
            c.style.position = 'absolute';
            c.style.left = (50 + cardRadius * Math.cos(angle)) + '%';
            c.style.top = (50 + cardRadius * Math.sin(angle)) + '%';
            container.appendChild(c);
        }
    });

    const viraSlot = document.getElementById('vira-slot');
    if(state.vira) {
        viraSlot.innerHTML = `<div class="card">${createCardInnerHTML(state.vira)}</div>`;
    } else {
        viraSlot.innerHTML = '';
    }
}

// --- FUNÇÕES AUXILIARES ---
const suitSymbols = { 'ouros': '♦', 'espadas': '♠', 'copas': '♥', 'paus': '♣' };
const suitColors = { 'ouros': 'suit-red', 'copas': 'suit-red', 'espadas': 'suit-black', 'paus': 'suit-black' };

function createCardInnerHTML(card) {
    const imgPath = `images/${card.suit}_${card.value}.png`;
    const symbol = suitSymbols[card.suit] || '';
    const colorClass = suitColors[card.suit] || 'suit-black';
    return `
        <div class="card-fallback ${colorClass}">
            ${card.value}<br><span style="font-size:24px">${symbol}</span>
        </div>
        <img src="${imgPath}" class="card-img-layer" onerror="this.style.display='none'">
    `;
}

function renderBetButtons(maxBet, forbiddenVal) {
    const opts = document.getElementById('bet-options');
    opts.innerHTML = '';
    for(let i=0; i<=maxBet; i++) {
        const b = document.createElement('div'); 
        b.className = 'bet-btn';
        b.innerText = i;
        if (i === forbiddenVal) {
            b.classList.add('disabled-btn'); 
            b.title = "Aposta proibida (Sandwich)!";
        } else {
            b.onclick = () => socket.emit('place_bet', i);
        }
        opts.appendChild(b);
    }
}

function updateNotification(msg) {
    document.getElementById('turn-notification').innerText = msg;
}

function renderHand(hand, isInteractive) {
    const divHand = document.getElementById('my-hand');
    divHand.innerHTML = '';
    hand.forEach((card, index) => {
        const d = document.createElement('div'); 
        d.className = `card ${isInteractive ? 'interactive' : 'disabled'}`;
        d.innerHTML = createCardInnerHTML(card);
        if(isInteractive) d.onclick = () => socket.emit('play_card', index);
        divHand.appendChild(d);
    });
}

// --- ÁUDIO ---
let isMusicPlaying = false;

function toggleMusic() {
    const bgAudio = document.getElementById('bg-music');
    const btn = document.getElementById('music-control');
    if (isMusicPlaying) {
        stopBackgroundMusic();
        btn.innerText = "🔈";
        isMusicPlaying = false;
    } else {
        playBackgroundMusic();
        btn.innerText = "🔊";
        isMusicPlaying = true;
    }
}

function playBackgroundMusic() {
    if(!isMusicPlaying) return; 
    const bgAudio = document.getElementById('bg-music');
    if(bgAudio.paused) {
        bgAudio.volume = 0.3;
        bgAudio.play().catch(()=>{});
    }
}
function stopBackgroundMusic() {
    document.getElementById('bg-music').pause();
}
function playVictoryMusic() {
    const vic = document.getElementById('victory-music');
    vic.volume = 1.0;
    vic.play().catch(()=>{});
}
function stopVictoryMusic() {
    const vic = document.getElementById('victory-music');
    vic.pause();
    vic.currentTime = 0;
}