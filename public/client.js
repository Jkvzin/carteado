const socket = io();
let selectedAvatar = 'https://api.dicebear.com/7.x/adventurer/svg?seed=Felix';

document.querySelectorAll('.avatar-option').forEach(img => {
    img.onclick = () => {
        document.querySelectorAll('.avatar-option').forEach(i => i.classList.remove('selected'));
        img.classList.add('selected');
        selectedAvatar = img.src;
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

    // LOBBY
    if (state.status === 'LOBBY') {
        document.getElementById('game-screen').style.display = 'none';
        document.getElementById('lobby-screen').style.display = 'flex';
        document.getElementById('game-over-screen').style.display = 'none';

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
    // GAME OVER
    else if (state.status === 'GAME_OVER') {
        document.getElementById('game-screen').style.display = 'none';
        document.getElementById('game-over-screen').style.display = 'flex';
        const winnerName = state.winner ? state.winner.name : "Ninguém";
        document.getElementById('winner-name').innerText = `Vencedor: ${winnerName} 🎉`;
    }
    // JOGO
    else {
        document.getElementById('lobby-screen').style.display = 'none';
        document.getElementById('game-over-screen').style.display = 'none';
        document.getElementById('game-screen').style.display = 'block';
        
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

function getCardContent(card) {
    const imgPath = `images/${card.suit}_${card.value}.png`;
    return { 
        style: `background-image: url('${imgPath}');`, 
        text: `<span style="font-size:10px; position:absolute; top:2px; left:2px;">${card.value}</span>` 
    };
}

function renderTable(state) {
    const container = document.getElementById('table-container');
    container.querySelectorAll('.player-slot, .played-card, .jackpot-warning').forEach(e => e.remove());
    
    // AVISO DE JACKPOT
    if (state.jackpot > 0) {
        const div = document.createElement('div');
        div.className = 'jackpot-warning';
        div.innerText = `ACUMULADO: +${state.jackpot}`;
        div.style = "position:absolute; top:35%; left:50%; transform:translate(-50%, -50%); color:#ffd700; font-weight:bold; font-size:1.2em; text-shadow:1px 1px black; border:1px solid gold; padding:2px 10px; border-radius:5px; background:rgba(0,0,0,0.5);";
        container.appendChild(div);
    }

    const myIdx = state.players.findIndex(p => p.id === socket.id);
    const totalP = state.players.length;
    const baseIdx = myIdx >= 0 ? myIdx : 0; 

    state.players.forEach((p, i) => {
        const relPos = (i - baseIdx + totalP) % totalP;
        const angle = (relPos * (2*Math.PI/totalP)) + (Math.PI/2);
        const x = 50 + 38 * Math.cos(angle);
        const y = 50 + 38 * Math.sin(angle);
        
        const slot = document.createElement('div');
        slot.className = `player-slot ${p.disconnected ? 'disconnected' : ''} ${p.isSpectator ? 'spectator' : ''} ${i === state.currentTurnIndex && state.status === 'PLAYING' ? 'active-turn' : ''}`;
        if(state.status === 'BETTING' && i === state.bettingTurnIndex) slot.classList.add('active-turn');

        slot.style.left = x+'%'; slot.style.top = y+'%';
        
        const statsLine = (p.bet !== -1 && !p.isSpectator) 
            ? `<div class="stats-line">A: ${p.bet} | F: ${p.tricksWon}</div>` 
            : '';
        
        const specLabel = p.isSpectator ? '<div style="font-size:10px; color:cyan;">(Olhando)</div>' : '';

        // --- NOVO: LÓGICA DAS VIDAS ---
        let livesDisplay = '';
        if (!p.isSpectator) {
            if (p.isEliminated) {
                livesDisplay = '<div class="mini-lives">💀</div>'; // Caveira se morreu
            } else {
                // Repete o coração baseado no número de vidas (ex: ❤️❤️❤️)
                livesDisplay = `<div class="mini-lives">${'❤️'.repeat(p.lives)}</div>`;
            }
        }
        // ------------------------------

        slot.innerHTML = `
            ${livesDisplay} <img src="${p.avatar}" class="avatar-img">
            <div style="text-shadow: 1px 1px 2px black; font-weight:bold; font-size: 14px;">${p.name}</div>
            ${statsLine}
            ${specLabel}
        `;
        container.appendChild(slot);
        
        // Renderiza carta jogada (igual antes)
        const played = state.tableCards.find(tc => tc.playerId === p.id);
        if (played) {
            const content = getCardContent(played.card);
            const c = document.createElement('div'); 
            c.className = 'card played-card';
            c.setAttribute('style', content.style + `position:absolute; left:${50 + 15 * Math.cos(angle)}%; top:${50 + 15 * Math.sin(angle)}%;`);
            if(!content.style.includes('http') && !content.style.includes('url')) c.innerHTML = played.card.value; 
            container.appendChild(c);
        }
    });

    // Renderiza Vira (igual antes)
    const viraSlot = document.getElementById('vira-slot');
    if(state.vira) {
        const content = getCardContent(state.vira);
        viraSlot.innerHTML = `<div class="card" style="${content.style}">${!content.style.includes('url') ? state.vira.value : ''}</div>`;
    } else {
        viraSlot.innerHTML = '';
    }
}

function renderHand(hand, isInteractive) {
    const divHand = document.getElementById('my-hand');
    divHand.innerHTML = '';
    hand.forEach((card, index) => {
        const content = getCardContent(card);
        const d = document.createElement('div'); 
        d.className = `card ${isInteractive ? 'interactive' : 'disabled'}`;
        d.style = content.style;
        d.innerHTML = !content.style.includes('url') ? card.value : ''; 
        
        if(isInteractive) {
            d.onclick = () => socket.emit('play_card', index);
        }
        divHand.appendChild(d);
    });
}