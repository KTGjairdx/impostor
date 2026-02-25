import { useState, useEffect } from 'react'
import './App.css'
import { supabase } from './supabase.js'

// Base de datos de palabras con sus temas relacionados
const wordsDatabase = [
  { word: "jorge" },
  { word: "Laptop"},
  { word: "Fernando" },
  { word: "therian" },
  { word: "Jonathan" },
  { word: "Pincselin" },
  { word: "Posada" },
  { word: "Mike" },
  { word: "Arturo" },
  { word: "Microsoft" },
  { word: "Desy" },
  { word: "chatgpt" },
  { word: "juanito cafe" },
  { word: "Sarita" },
  { word: "cargador" }
];

function App() {
  // Estados principales
  const [gameState, setGameState] = useState('menu'); // menu, createRoom, joinRoom, lobby, playing, voting, finished
  const [roomCode, setRoomCode] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [isHost, setIsHost] = useState(false);
  const [gameData, setGameData] = useState(null);
  const [myRole, setMyRole] = useState(null);
  const [roomData, setRoomData] = useState(null);
  
  // Estados temporales para inputs
  const [inputRoomCode, setInputRoomCode] = useState('');
  const [inputPlayerName, setInputPlayerName] = useState('');
  
  // Estados para votación y puntuación
  const [myVote, setMyVote] = useState('');
  const [hasVoted, setHasVoted] = useState(false);
  const [votationResults, setVotationResults] = useState(null);
  const [roundNumber, setRoundNumber] = useState(1);
  const [usingCache, setUsingCache] = useState(false); // Indicador de modo caché
  const [lastCriticalChange, setLastCriticalChange] = useState(0); // Timestamp del último cambio crítico
  const [previousPlayerCount, setPreviousPlayerCount] = useState(0); // Para detectar nuevos jugadores

  // Funciones para manejar salas
  // Cache local para reducir peticiones
  const [localRoomCache, setLocalRoomCache] = useState(null);
  const [lastCacheUpdate, setLastCacheUpdate] = useState(0);

  // Función para actualizar caché local
  const updateLocalCache = (roomData) => {
    setLocalRoomCache(roomData);
    setLastCacheUpdate(Date.now());
    // Guardar en localStorage también
    if (roomCode && roomData) {
      localStorage.setItem(`cache_${roomCode}`, JSON.stringify({
        data: roomData,
        timestamp: Date.now()
      }));
    }
  };

  // ULTRA-CACHÉ: Durante el juego, usar datos locales por hasta 5 minutos (menos para host)
  const getCachedRoomData = () => {
    const cacheAge = Date.now() - lastCacheUpdate;
    // Host necesita datos más frescos para ver sus controles
    const maxCacheAge = gameState === 'lobby' ? 5000 : (isHost ? 30000 : 300000); // Host: 30s, otros: 5 min
    
    if (localRoomCache && cacheAge < maxCacheAge) {
      console.log('🎯 USANDO CACHÉ:', gameState, 'edad:', Math.round(cacheAge/1000), 's', isHost ? '(HOST)' : '(PLAYER)');
      setUsingCache(true);
      return localRoomCache;
    }
    
    // Intentar caché de localStorage con tolerancia diferente para host
    if (roomCode) {
      const cached = localStorage.getItem(`cache_${roomCode}`);
      if (cached) {
        try {
          const { data, timestamp } = JSON.parse(cached);
          const localAge = Date.now() - timestamp;
          // Host necesita datos más frescos
          const maxLocalAge = gameState === 'lobby' ? 10000 : (isHost ? 60000 : 600000); // Host: 1 min, otros: 10 min
          
          if (localAge < maxLocalAge) {
            console.log('🎯 USANDO CACHÉ STORAGE:', gameState, 'edad:', Math.round(localAge/1000), 's', isHost ? '(HOST)' : '(PLAYER)');
            setLocalRoomCache(data);
            setLastCacheUpdate(timestamp);
            setUsingCache(true);
            return data;
          }
        } catch (e) {}
      }
    }
    setUsingCache(false);
    return null;
  };

  // Función para marcar cambios críticos (cambios de gameState, etc.)
  const markCriticalChange = (reason = 'cambio de estado') => {
    setLastCriticalChange(Date.now());
    console.log(`🚨 CAMBIO CRÍTICO (${reason}): Acelerando por 30s - Durante juego SOLO para transiciones importantes`);
  };

  // Determinar intervalo de polling ULTRA-OPTIMIZADO
  const getPollingInterval = () => {
    const timeSinceCritical = Date.now() - lastCriticalChange;
    const isInCriticalWindow = timeSinceCritical < 30000; // 30 segundos para cambios críticos
    
    if (gameState === 'lobby') {
      // LOBBY: Actualización constante para ver jugadores uniéndose
      return 7000; // 7 segundos todos en lobby
    } else if (gameState === 'playing') {
      // PLAYING: MODO SILENCIOSO - solo heartbeat y cambios críticos
      if (isInCriticalWindow) {
        return isHost ? 3000 : 5000; // Rápido solo durante transiciones
      } else {
        return isHost ? 120000 : 300000; // Host: 2min, Jugadores: 5min (ULTRA-LENTO)
      }
    } else if (gameState === 'voting') {
      // VOTING: MODO SILENCIOSO - solo para detectar fin de votación
      if (isInCriticalWindow) {
        return isHost ? 3000 : 5000; // Rápido durante cambios
      } else {
        return isHost ? 60000 : 120000; // Host: 1min, Jugadores: 2min
      }
    } else {
      // FINISHED: MODO SILENCIOSO - solo para nueva ronda
      if (isInCriticalWindow) {
        return 5000; // Rápido para nueva ronda
      } else {
        return 180000; // 3 minutos (MUY LENTO)
      }
    }
  };

  // Generar código aleatorio de sala
  const generateRoomCode = () => {
    return Math.random().toString(36).substr(2, 6).toUpperCase();
  };

  // Funciones de encriptación simple para roles (anti-trampas)
  const encryptRole = (roleData) => {
    if (!roleData) return null;
    const encoded = btoa(JSON.stringify(roleData));
    return encoded.split('').reverse().join('');
  };

  const decryptRole = (encryptedData) => {
    if (!encryptedData) return null;
    try {
      const decoded = encryptedData.split('').reverse().join('');
      return JSON.parse(atob(decoded));
    } catch (error) {
      console.error('ERROR DECRYPT:', error);
      return null;
    }
  };

  const encryptRoles = (roles) => {
    if (!roles) return {};
    const encrypted = {};
    Object.entries(roles).forEach(([player, roleData]) => {
      encrypted[player] = encryptRole(roleData);
    });
    return encrypted;
  };

  const decryptRoles = (encryptedRoles) => {
    if (!encryptedRoles) return {};
    const decrypted = {};
    Object.entries(encryptedRoles).forEach(([player, encryptedData]) => {
      decrypted[player] = decryptRole(encryptedData);
    });
    return decrypted;
  };

  const saveRoomData = async (code, data) => {
    try {
      // Encriptar roles Y gameData antes de guardar
      const dataToSave = {
        ...data,
        roles: encryptRoles(data.roles),
        gameData: data.gameData ? encryptRole(data.gameData) : null
      };

      const { error } = await supabase
        .from('rooms')
        .upsert({ 
          code: code, 
          data: dataToSave,
          updated_at: new Date().toISOString()
        });
      
      if (error) {
        console.error('❌ Error saving room:', error);
        // Fallback a localStorage si falla Supabase
        localStorage.setItem(`room_${code}`, JSON.stringify(dataToSave));
      }
    } catch (err) {
      console.error('❌ Error connecting to Supabase:', err);
      // Fallback a localStorage
      const dataToSave = {
        ...data,
        roles: encryptRoles(data.roles),
        gameData: data.gameData ? encryptRole(data.gameData) : null
      };
      localStorage.setItem(`room_${code}`, JSON.stringify(dataToSave));
    }
  };

  const getRoomData = async (code) => {
    try {
      const { data, error } = await supabase
        .from('rooms')
        .select('data')
        .eq('code', code)
        .single();
      
      if (error || !data) {
        // Fallback a localStorage si no encuentra en Supabase
        const localData = localStorage.getItem(`room_${code}`);
        if (localData) {
          const parsedData = JSON.parse(localData);
          // Desencriptar roles y gameData si existen
          if (parsedData && parsedData.roles) {
            parsedData.roles = decryptRoles(parsedData.roles);
          }
          if (parsedData && parsedData.gameData) {
            parsedData.gameData = decryptRole(parsedData.gameData);
          }
          return parsedData;
        }
        return null;
      }
      
      const roomData = data.data;
      // Desencriptar roles y gameData si existen
      if (roomData && roomData.roles) {
        roomData.roles = decryptRoles(roomData.roles);
      }
      if (roomData && roomData.gameData) {
        roomData.gameData = decryptRole(roomData.gameData);
      }
      return roomData;
    } catch (err) {
      console.error('❌ Error fetching from Supabase:', err);
      // Fallback a localStorage
      const localData = localStorage.getItem(`room_${code}`);
      if (localData) {
        const parsedData = JSON.parse(localData);
        // Desencriptar roles y gameData si existen
        if (parsedData && parsedData.roles) {
          parsedData.roles = decryptRoles(parsedData.roles);
        }
        if (parsedData && parsedData.gameData) {
          parsedData.gameData = decryptRole(parsedData.gameData);
        }
        return parsedData;
      }
      return null;
    }
  };

  // Nueva función para obtener datos filtrados según el jugador (SEGURIDAD MÁXIMA)
  // Función optimizada para obtener datos de sala con caché
  const getRoomDataOptimized = async (code, forceRefresh = false) => {
    if (gameState === 'lobby') {
      console.log(`🔍 getRoomDataOptimized - forceRefresh: ${forceRefresh} | gameState: ${gameState}`);
    }
    
    // Usar caché si no se fuerza el refresh
    if (!forceRefresh) {
      const cached = getCachedRoomData();
      if (cached) {
        if (gameState === 'lobby') {
          console.log('📋 Usando datos del caché en lobby');
        }
        return cached;
      }
    }

    // Obtener datos frescos
    console.log('🌐 PETICIÓN A BASE DE DATOS:', gameState);
    setUsingCache(false);
    const freshData = await getRoomData(code);
    if (freshData) {
      updateLocalCache(freshData);
    }
    return freshData;
  };

  const getFilteredRoomData = async (code, currentPlayer) => {
    // Para el estado 'finished', necesitamos datos encriptados para seguridad
    // Obtenemos los datos raw sin desencriptar
    let rawRoomData = null;
    try {
      const { data, error } = await supabase
        .from('rooms')
        .select('data')
        .eq('code', code)
        .single();
      
      if (!error && data) {
        rawRoomData = data.data;
      } else {
        // Fallback a localStorage
        const localData = localStorage.getItem(`room_${code}`);
        if (localData) {
          rawRoomData = JSON.parse(localData);
        }
      }
    } catch (err) {
      // Fallback a localStorage
      const localData = localStorage.getItem(`room_${code}`);
      if (localData) {
        rawRoomData = JSON.parse(localData);
      }
    }

    if (!rawRoomData) return null;

    // Si el juego no ha empezado, mostrar información de lobby (sin roles/gameData)
    if (rawRoomData.gameState === 'lobby') {
      return {
        ...rawRoomData,
        roles: {}, // NUNCA exponer roles en lobby
        gameData: null // NUNCA exponer palabra en lobby
      };
    }
    
    // Si ya terminó, mostrar información completa pero MANTENER ENCRIPTACIÓN
    if (rawRoomData.gameState === 'finished') {
      return {
        ...rawRoomData,
        // Roles y gameData permanecen encriptados para seguridad en Network tab
        roles: rawRoomData.votationResults ? rawRoomData.roles : {},
        gameData: rawRoomData.votationResults ? rawRoomData.gameData : null
      };
    }

    // Durante el juego activo (playing/voting), NO ENVIAR ROLES EN ABSOLUTO
    const filteredData = {
      ...rawRoomData,
      roles: {}, // COMPLETAMENTE VACÍO - sin información de roles
      gameData: null, // NUNCA enviar palavra/tema durante juego activo
      votationResults: null, // No mostrar resultados hasta que termine
    };

    return filteredData;
  };

  const clearRoomData = async (code) => {
    try {
      const { error } = await supabase
        .from('rooms')
        .delete()
        .eq('code', code);
      
      if (error) {
        console.error('Error deleting room:', error);
      }
    } catch (err) {
      console.error('Error deleting from Supabase:', err);
    }
    
    // También limpiar localStorage
    localStorage.removeItem(`room_${code}`);
  };

  const initializeScores = (players) => {
    const scores = {};
    players.forEach(player => {
      scores[player] = 0;
    });
    return scores;
  };

  const calculateScores = (votationResults, currentScores, roles) => {
    const newScores = { ...currentScores };
    
    // Identificar impostores y aliados actuales
    const impostors = Object.entries(roles).filter(([_, data]) => data.role === 'impostor').map(([player, _]) => player);
    const allies = Object.entries(roles).filter(([_, data]) => data.role === 'ally').map(([player, _]) => player);
    
    // Verificar si el jugador más votado era impostor
    const votedPlayerWasImpostor = roles[votationResults.mostVoted]?.role === 'impostor';
    
    if (votationResults.impostorWins && !votedPlayerWasImpostor) {
      // Los impostores ganan: no eliminaron a ningún impostor
      impostors.forEach(impostor => {
        newScores[impostor] = (newScores[impostor] || 0) + 3;
      });
    } else if (votedPlayerWasImpostor) {
      // Los aliados ganan: eliminaron a un impostor
      // +2 puntos a cada aliado que votó por el impostor eliminado
      Object.entries(votationResults.playerVotes).forEach(([player, votedFor]) => {
        if (roles[player]?.role === 'ally' && votedFor === votationResults.mostVoted) {
          newScores[player] = (newScores[player] || 0) + 2;
        }
      });
      
      // +1 punto extra para todos los aliados por contribuir a la victoria
      allies.forEach(ally => {
        newScores[ally] = (newScores[ally] || 0) + 1;
      });
    }
    
    return newScores;
  };

  // Crear una nueva sala
  const createRoom = async () => {
    if (!inputPlayerName.trim()) {
      alert('Ingresa tu nombre');
      return;
    }

    const code = generateRoomCode();
    const players = [inputPlayerName.trim()];
    const newRoomData = {
      host: inputPlayerName.trim(),
      players: players,
      gameState: 'lobby',
      gameData: null,
      roles: {},
      scores: initializeScores(players),
      playerHeartbeats: {
        [inputPlayerName.trim()]: Date.now()
      },
      roundNumber: 1,
      gamesPlayed: 0,
      createdAt: Date.now()
    };

    await saveRoomData(code, newRoomData);
    setRoomCode(code);
    setPlayerName(inputPlayerName.trim());
    setIsHost(true);
    setRoomData(newRoomData);
    setGameState('lobby');
    setRoundNumber(1);
    setInputPlayerName('');
  };

  // Unirse a una sala existente
  const joinRoom = async () => {
    if (!inputPlayerName.trim()) {
      alert('Ingresa tu nombre');
      return;
    }
    if (!inputRoomCode.trim()) {
      alert('Ingresa el código de la sala');
      return;
    }

    const code = inputRoomCode.trim().toUpperCase();
    const room = await getRoomData(code);
    
    if (!room) {
      alert('Sala no encontrada');
      return;
    }

    if (room.players.includes(inputPlayerName.trim())) {
      alert('Ya hay un jugador con ese nombre en la sala');
      return;
    }

    if (room.gameState !== 'lobby') {
      alert('La partida ya está en curso');
      return;
    }

    const updatedPlayers = [...room.players, inputPlayerName.trim()];
    const updatedRoom = {
      ...room,
      players: updatedPlayers,
      scores: {
        ...room.scores,
        [inputPlayerName.trim()]: 0
      },
      playerHeartbeats: {
        ...room.playerHeartbeats,
        [inputPlayerName.trim()]: Date.now()
      }
    };

    await saveRoomData(code, updatedRoom);
    setRoomCode(code);
    setPlayerName(inputPlayerName.trim());
    setIsHost(false);
    setRoomData(updatedRoom);
    setGameState('lobby');
    setRoundNumber(updatedRoom.roundNumber || 1);
    setInputPlayerName('');
    setInputRoomCode('');
  };

  // Iniciar el juego (solo el host)
  const startGame = async () => {
    if (!isHost) return;
    
    const room = await getRoomData(roomCode);
    if (!room || room.players.length < 3) {
      alert('Necesitas al menos 3 jugadores para empezar');
      return;
    }

    // Seleccionar palabra aleatoria
    const selectedWordData = wordsDatabase[Math.floor(Math.random() * wordsDatabase.length)];
    
    // Asignar roles aleatoriamente con múltiples impostores
    const shuffledPlayers = [...room.players].sort(() => Math.random() - 0.5);
    
    // Determinar número de impostores según cantidad de jugadores
    let numImpostors;
    if (shuffledPlayers.length <= 6) {
      numImpostors = 1;
    } else if (shuffledPlayers.length <= 12) {
      numImpostors = 2;
    } else {
      numImpostors = 3;
    }
    
    const newRoles = {};
    shuffledPlayers.forEach((player, index) => {
      newRoles[player] = {
        role: index < numImpostors ? 'impostor' : 'ally',
        card: index < numImpostors ? '???' : selectedWordData.word // Impostor sin pista
      };
    });

    const updatedRoom = {
      ...room,
      gameState: 'playing',
      gameData: selectedWordData,
      roles: newRoles
    };

    // INSTANT LOCAL UPDATE + BACKGROUND SYNC
    setRoomData(updatedRoom);
    updateLocalCache(updatedRoom); // Cache inmediatamente
    setGameData(selectedWordData);
    setMyRole(newRoles[playerName]);
    setGameState('playing');
    markCriticalChange('HOST inicia nueva partida'); // ¡SEÑALAR CAMBIO CRÍTICO!
    
    console.log('🚀 INICIANDO JUEGO: Guardando en base de datos...');
    
    // BACKGROUND SAVE (no bloquea transición)
    try {
      await saveRoomData(roomCode, updatedRoom);
      console.log('✅ JUEGO INICIADO: Datos guardados correctamente');
    } catch (err) {
      console.error('❌ Error guardando inicio de juego:', err);
      alert('Error al iniciar juego, verifica tu conexión');
    }
  };

  // Salir de la sala
  const leaveRoom = async () => {
    if (roomCode) {
      const room = await getRoomData(roomCode);
      if (room) {
        if (isHost) {
          // Si es el host, eliminar toda la sala
          await clearRoomData(roomCode);
        } else {
          // Si no es host, solo quitar al jugador
          const updatedPlayers = room.players.filter(p => p !== playerName);
          const updatedScores = { ...room.scores };
          delete updatedScores[playerName];
          
          const updatedRoom = {
            ...room,
            players: updatedPlayers,
            scores: updatedScores
          };
          await saveRoomData(roomCode, updatedRoom);
        }
      }
    }
    
    // Reset local state
    setRoomCode('');
    setPlayerName('');
    setIsHost(false);
    setRoomData(null);
    setGameData(null);
    setMyRole(null);
    setMyVote('');
    setHasVoted(false);
    setVotationResults(null);
    setRoundNumber(1);
    setGameState('menu');
    setInputRoomCode('');
    setInputPlayerName('');
  };

  // Nueva función para actualizar heartbeat del jugador
  const updatePlayerHeartbeat = async () => {
    if (!roomCode || !playerName) return;
    
    try {
      const room = await getRoomData(roomCode);
      if (room && room.players.includes(playerName)) {
        const updatedRoom = {
          ...room,
          playerHeartbeats: {
            ...room.playerHeartbeats,
            [playerName]: Date.now()
          }
        };
        await saveRoomData(roomCode, updatedRoom);
      }
    } catch (error) {
      console.error('Error updating heartbeat:', error);
    }
  };

  // Nueva función para limpiar jugadores inactivos (solo para host)
  const cleanInactivePlayers = async () => {
    if (!isHost || !roomCode) return;
    
    try {
      const room = await getRoomData(roomCode);
      if (!room || !room.playerHeartbeats) return;
      
      const now = Date.now();
      const INACTIVE_THRESHOLD = 45000; // 45 segundos sin heartbeat (más tolerante)
      
      const activePlayers = room.players.filter(player => {
        const lastHeartbeat = room.playerHeartbeats[player] || 0;
        return (now - lastHeartbeat) < INACTIVE_THRESHOLD;
      });
      
      // Si algún jugador se desconectó, actualizar la sala
      if (activePlayers.length !== room.players.length) {
        const updatedScores = { ...room.scores };
        const updatedHeartbeats = { ...room.playerHeartbeats };
        
        // Limpiar datos de jugadores inactivos
        room.players.forEach(player => {
          if (!activePlayers.includes(player)) {
            delete updatedScores[player];
            delete updatedHeartbeats[player];
          }
        });
        
        const updatedRoom = {
          ...room,
          players: activePlayers,
          scores: updatedScores,
          playerHeartbeats: updatedHeartbeats
        };
        
        await saveRoomData(roomCode, updatedRoom);
      }
    } catch (error) {
      console.error('Error cleaning inactive players:', error);
    }
  };

  // Polling optimizado: dinámico basado en cambios críticos
  useEffect(() => {
    if (roomCode && gameState !== 'menu') {
      let interval;
      
      const updateInterval = () => {
        if (interval) clearInterval(interval);
        
        const pollingTime = getPollingInterval();
        console.log(`⏱️ POLLING OPTIMIZADO: ${pollingTime/1000}s - Estado: ${gameState} | Crítico: ${Date.now() - lastCriticalChange < 30000} | Host: ${isHost}`);
        if (gameState === 'lobby') {
          console.log('🏠 LOBBY ACTIVO: Actualizando cada 7s para detectar nuevos jugadores');
        }
        
        interval = setInterval(async () => {
        console.log('\ud83d\udd04 INICIANDO CICLO DE POLLING...', gameState);
        try {
          // SIEMPRE: Enviar heartbeat para indicar que el jugador sigue activo
          console.log('\ud83d\udc93 Enviando heartbeat...');
          try {
            await updatePlayerHeartbeat();
            console.log('\u2705 Heartbeat enviado correctamente');
          } catch (heartbeatError) {
            console.error('\u26a0\ufe0f Error en heartbeat:', heartbeatError);
            // Continuar a pesar del error de heartbeat
          }
          
          // Si es host, limpiar jugadores inactivos Y verificar auto-finish
          if (isHost) {
            await cleanInactivePlayers();
            
            // Verificar auto-finish después de limpiar jugadores
            const currentRoom = await getRoomDataOptimized(roomCode, true); // Forzar refresh
            if (currentRoom && (currentRoom.gameState === 'playing' || currentRoom.gameState === 'voting') && currentRoom.players.length < 3) {
              console.log('🔴 AUTO-FINISH: Menos de 3 jugadores detectados:', currentRoom.players.length);
              
              // Asignar puntos de supervivencia a jugadores restantes
              const newScores = { ...currentRoom.scores };
              currentRoom.players.forEach(player => {
                newScores[player] = (newScores[player] || 0) + 1; // +1 punto por supervivencia
              });

              const finishedRoom = {
                ...currentRoom,
                gameState: 'finished',
                scores: newScores,
                votationResults: {
                  votes: {},
                  mostVoted: null,
                  impostors: Object.entries(currentRoom.roles || {})
                    .filter(([_, data]) => data.role === 'impostor')
                    .map(([player, _]) => player),
                  impostorWins: false,
                  totalVotes: 0,
                  playerVotes: {},
                  autoFinish: true,
                  reason: 'Menos de 3 jugadores restantes'
                }
              };
              
              await saveRoomData(roomCode, finishedRoom);
              updateLocalCache(finishedRoom); // Actualizar caché inmediatamente
              return; // Salir para que el siguiente polling recoja el nuevo estado
            }
          }
          
          console.log('🎯 Llegando a sección de polling de datos...');
          // OBTENER DATOS ACTUALIZADOS siempre para lobby y host, otras veces según necesidad
          const needsRefresh = gameState === 'lobby' || isHost || (Date.now() - lastCriticalChange < 30000);
          if (gameState === 'lobby') {
            console.log(`🔄 LOBBY DEBUG - needsRefresh: ${needsRefresh} | gameState: ${gameState} | roomCode: ${roomCode}`);
          }
          const room = await getRoomDataOptimized(roomCode, needsRefresh);
          console.log('📊 Datos obtenidos:', room ? 'OK' : 'NULL', 'para gameState:', gameState);
          
          if (room) {
            // Detectar cambios en la cantidad de jugadores (nuevas uniones O SALIDAS)
            const currentPlayerCount = room.players ? room.players.length : 0;
            if (previousPlayerCount > 0 && currentPlayerCount !== previousPlayerCount) {
              if (currentPlayerCount > previousPlayerCount) {
                console.log('\ud83d\udc65 \u00a1NUEVO JUGADOR DETECTADO! (' + previousPlayerCount + ' \u2192 ' + currentPlayerCount + ') - Acelerando sincronizaci\u00f3n');
                markCriticalChange('nuevo jugador se une al lobby');
              } else {
                console.log('\ud83d\udeb6 \u00a1JUGADOR SALI\u00d3! (' + previousPlayerCount + ' \u2192 ' + currentPlayerCount + ') - Acelerando sincronizaci\u00f3n');
                markCriticalChange('jugador abandona la sala');
              }
            }
            setPreviousPlayerCount(currentPlayerCount);
            
            // Actualizar datos de la sala
            setRoomData(room);
            setRoundNumber(room.roundNumber || 1);
            
            // Transiciones de estado
            if (room.gameState === 'playing' && gameState === 'lobby') {
              const fullRoom = await getRoomDataOptimized(roomCode, true);
              if (fullRoom) {
                setGameData(fullRoom.gameData);
                if (fullRoom.roles && fullRoom.roles[playerName]) {
                  const roleData = fullRoom.roles[playerName];
                  if (roleData && roleData.role && roleData.card !== undefined) {
                    setMyRole(roleData);
                  }
                }
                setGameState('playing');
                markCriticalChange('jugadores detectan inicio del juego'); // ¡CRÍTICO! Acelerar sync cuando TODOS detecten inicio del juego
              }
            } else if (room.gameState === 'voting' && gameState === 'playing') {
              setGameState('voting');
              setHasVoted(false);
              setMyVote('');
              markCriticalChange('inicio de votación detectado'); // Marcar cambio crítico para acelerar sync
            } else if (room.gameState === 'finished' && (gameState === 'playing' || gameState === 'voting')) {
              const fullRoom = await getRoomDataOptimized(roomCode, true);
              if (fullRoom && fullRoom.votationResults) {
                setVotationResults(fullRoom.votationResults);
              }
              setGameState('finished');
              markCriticalChange('resultados finales mostrados'); // ¡CRÍTICO! Todos ven resultados instantáneamente
              setTimeout(() => {
                setMyRole(null);
                updateLocalCache(null);
              }, 100);
            } else if (room.gameState === 'lobby' && gameState === 'finished') {
              // NUEVA RONDA DETECTADA
              console.log('🔄 NUEVA RONDA DETECTADA por jugador');
              setGameData(null);
              setMyRole(null);
              setMyVote('');
              setHasVoted(false);
              setVotationResults(null);
              setRoundNumber(room.roundNumber || 1);
              setGameState('lobby');
              markCriticalChange('nueva ronda iniciada - jugador detecta'); // ¡CRÍTICO!
            } else if (room.gameState !== gameState) {
              // DETECCIÓN GENERAL DE CAMBIOS DE ESTADO
              console.log(`🔄 CAMBIO DE ESTADO DETECTADO: ${gameState} → ${room.gameState}`);
              setGameState(room.gameState);
              markCriticalChange(`cambio de estado: ${gameState} → ${room.gameState}`);
            }
            
            // Actualizar estado de votación si estamos votando
            if (gameState === 'voting' && room.votes) {
              const userVote = room.votes[playerName];
              if (userVote && !hasVoted) {
                setMyVote(userVote);
                setHasVoted(true);
              }
            }
          } else if (!room && !isHost) {
            alert('La sala fue cerrada por el host');
            await leaveRoom();
          }
          console.log('✅ CICLO DE POLLING COMPLETADO para gameState:', gameState);
        } catch (error) {
          console.error('❌ ERROR EN POLLING:', error, 'gameState:', gameState);
        }
        }, pollingTime);
        
        console.log('✅ INTERVAL CONFIGURADO CORRECTAMENTE para', pollingTime, 'ms');
      };
      
      updateInterval(); // Iniciar polling
      console.log('🚀 POLLING INICIADO para gameState:', gameState);
      
      return () => {
        console.log('🛑 LIMPIANDO POLLING para gameState:', gameState);
        if (interval) clearInterval(interval);
      };
    }
  }, [roomCode, gameState, playerName, isHost, hasVoted, lastCriticalChange]);

  // Limpiar salas viejas al cargar
  useEffect(() => {
    const cleanOldRooms = () => {
      const keys = Object.keys(localStorage);
      const roomKeys = keys.filter(key => key.startsWith('room_'));
      const now = Date.now();
      const maxAge = 24 * 60 * 60 * 1000; // 24 horas

      roomKeys.forEach(key => {
        const data = localStorage.getItem(key);
        if (data) {
          const room = JSON.parse(data);
          if (now - room.createdAt > maxAge) {
            localStorage.removeItem(key);
          }
        }
      });
    };

    cleanOldRooms();
  }, []);

  // Iniciar fase de votación (solo el host)
  const startVoting = async () => {
    if (!isHost) return;
    
    const room = await getRoomData(roomCode);
    const updatedRoom = {
      ...room,
      gameState: 'voting',
      votes: {},
      votingStarted: Date.now()
    };
    
    // INSTANT LOCAL UPDATE + CRITICAL CHANGE MARKER
    setRoomData(updatedRoom);
    updateLocalCache(updatedRoom);
    setGameState('voting');
    setHasVoted(false);
    setMyVote('');
    markCriticalChange('HOST inicia votación'); // ¡SEÑALAR CAMBIO CRÍTICO!
    
    // BACKGROUND SAVE (no bloquea la transición)
    saveRoomData(roomCode, updatedRoom).catch(err => {
      console.error('Error iniciando votación:', err);
      alert('Error al iniciar votación, intenta de nuevo');
    });
  };

  // Enviar voto
  const submitVote = async (votedPlayer) => {
    if (hasVoted || votedPlayer === playerName) return;
    
    // MEGA-OPTIMIZED: usar datos locales para votar (sin petición)
    const currentRoom = roomData || getCachedRoomData();
    if (!currentRoom) {
      console.log('⚠️ No hay datos de sala para votar, obteniendo...');
      const room = await getRoomDataOptimized(roomCode, true);
      if (!room) return;
      setRoomData(room);
      // Intentar de nuevo con los nuevos datos
      setTimeout(() => submitVote(votedPlayer), 100);
      return;
    }
    
    const updatedVotes = {
      ...currentRoom.votes,
      [playerName]: votedPlayer
    };
    
    const updatedRoom = {
      ...currentRoom,
      votes: updatedVotes
    };
    
    // INSTANT LOCAL UPDATE (sin esperar base de datos)
    setRoomData(updatedRoom);
    updateLocalCache(updatedRoom);
    setMyVote(votedPlayer);
    setHasVoted(true);
    
    // BACKGROUND SYNC (no bloquea la interfaz)
    saveRoomData(roomCode, updatedRoom).catch(err => {
      console.error('Error guardando voto:', err);
      // Revertir cambios locales si falla la sincronización
      setRoomData(currentRoom);
      setMyVote('');
      setHasVoted(false);
      alert('Error al votar, intenta de nuevo');
    });
    
    // Auto-finalizar si todos votaron y somos host
    if (Object.keys(updatedVotes).length === currentRoom.players.length && isHost) {
      setTimeout(() => finishVoting(), 1000);
    }
  };

  // Finalizar votación y mostrar resultados (solo host)
  const finishVoting = async () => {
    if (!isHost) return;
    
    // OPTIMIZED: usar datos locales actuales en lugar de nueva petición
    const currentRoom = roomData || getCachedRoomData();
    if (!currentRoom) {
      console.log('⚠️ No hay datos locales para finalizar votación');
      const room = await getRoomDataOptimized(roomCode, true);
      if (room) setRoomData(room);
      return;
    }
    
    const votes = currentRoom.votes || {};
    const voteCounts = {};
    
    // Contar votos
    Object.values(votes).forEach(votedPlayer => {
      voteCounts[votedPlayer] = (voteCounts[votedPlayer] || 0) + 1;
    });
    
    // Encontrar el jugador más votado
    let mostVotedPlayer = '';
    let maxVotes = 0;
    Object.entries(voteCounts).forEach(([player, count]) => {
      if (count > maxVotes) {
        maxVotes = count;
        mostVotedPlayer = player;
      }
    });
    
    // Obtener todos los impostores
    const impostors = Object.entries(currentRoom.roles).filter(([_, data]) => 
      data.role === 'impostor'
    ).map(([player, _]) => player);
    
    // Determinar si el jugador más votado era impostor
    const votedPlayerWasImpostor = currentRoom.roles[mostVotedPlayer]?.role === 'impostor';
    
    // Los impostores ganan si NO eliminaron a ningún impostor
    const impostorWins = !votedPlayerWasImpostor;
    const results = {
      votes: voteCounts,
      mostVoted: mostVotedPlayer,
      impostors: impostors, // Múltiples impostores
      impostorWins: impostorWins,
      totalVotes: Object.keys(votes).length,
      playerVotes: votes,
      votedPlayerWasImpostor: votedPlayerWasImpostor
    };
    
    // Calcular nuevas puntuaciones
    const newScores = calculateScores(results, currentRoom.scores, currentRoom.roles);
    
    // Calcular puntos ganados en esta ronda para mostrar
    const pointsThisRound = {};
    Object.keys(currentRoom.players).forEach(player => {
      pointsThisRound[player] = newScores[player] - (currentRoom.scores[player] || 0);
    });
    
    const updatedRoom = {
      ...currentRoom,
      gameState: 'finished',
      votationResults: results,
      scores: newScores,
      pointsThisRound: pointsThisRound,
      gamesPlayed: (currentRoom.gamesPlayed || 0) + 1
    };
    
    // INSTANT LOCAL UPDATE + BACKGROUND SYNC
    setRoomData(updatedRoom);
    updateLocalCache(updatedRoom);
    setVotationResults(results);
    setGameState('finished');
    markCriticalChange('HOST finaliza votación'); // ¡SEÑALAR CAMBIO CRÍTICO!
    
    // BACKGROUND SAVE (no bloquea la interfaz)
    saveRoomData(roomCode, updatedRoom).catch(err => {
      console.error('Error guardando resultados de votación:', err);
    });
  };

  // Manejar tecla Enter
  const handleKeyPress = (e, action) => {
    if (e.key === 'Enter') {
      action();
    }
  };

  return (
    <div className="App">
      {/* Pantalla principal del menú */}
      {gameState === 'menu' && (
        <div className="menu-screen">
          <h1>🕵️ JUEGO DEL IMPOSTOR 🕵️</h1>
          <p className="game-description">
            Únete a una sala con amigos. Los impostores deben descubrir la palabra secreta,
            <br />
            mientras que los aliados conocen la palabra y deben encontrar a los impostores.
          </p>
          <div className="menu-actions">
            <button 
              className="create-room-btn"
              onClick={() => setGameState('createRoom')}
            >
              CREAR SALA
            </button>
            <button 
              className="join-room-btn"
              onClick={() => setGameState('joinRoom')}
            >
              UNIRSE A SALA
            </button>
          </div>
        </div>
      )}

      {/* Pantalla crear sala */}
      {gameState === 'createRoom' && (
        <div className="create-room-screen">
          <h2>Crear Nueva Sala</h2>
          <p>Ingresa tu nombre para crear una sala</p>
          
          <div className="form-group">
            <input
              type="text"
              value={inputPlayerName}
              onChange={(e) => setInputPlayerName(e.target.value)}
              onKeyPress={(e) => handleKeyPress(e, createRoom)}
              placeholder="Tu nombre"
              maxLength={15}
            />
          </div>

          <div className="form-actions">
            <button 
              className="back-btn"
              onClick={() => setGameState('menu')}
            >
              Volver
            </button>
            <button 
              className="create-btn"
              onClick={createRoom}
              disabled={!inputPlayerName.trim()}
            >
              Crear Sala
            </button>
          </div>
        </div>
      )}

      {/* Pantalla unirse a sala */}
      {gameState === 'joinRoom' && (
        <div className="join-room-screen">
          <h2>Unirse a Sala</h2>
          <p>Ingresa el código de la sala y tu nombre</p>
          
          <div className="form-group">
            <input
              type="text"
              value={inputRoomCode}
              onChange={(e) => setInputRoomCode(e.target.value.toUpperCase())}
              placeholder="Código de sala (ej: ABC123)"
              maxLength={6}
            />
            <input
              type="text"
              value={inputPlayerName}
              onChange={(e) => setInputPlayerName(e.target.value)}
              onKeyPress={(e) => handleKeyPress(e, joinRoom)}
              placeholder="Tu nombre"
              maxLength={15}
            />
          </div>

          <div className="form-actions">
            <button 
              className="back-btn"
              onClick={() => setGameState('menu')}
            >
              Volver
            </button>
            <button 
              className="join-btn"
              onClick={joinRoom}
              disabled={!inputRoomCode.trim() || !inputPlayerName.trim()}
            >
              Unirse
            </button>
          </div>
        </div>
      )}

      {/* Lobby de espera */}
      {gameState === 'lobby' && (
        <div className="lobby-screen">
          <h2>Sala: {roomCode}</h2>
          {isHost && <p className="host-indicator">Eres el anfitrión</p>}
          
          <div className="room-info">
            <div className="room-code-display">
              <h3>Código de la sala:</h3>
              <div className="code">{roomCode}</div>
              <small>Comparte este código con tus amigos</small>
            </div>
          </div>

          {roomData && (
            <>
              <div className="game-stats">
                <span>Ronda: {roomData.roundNumber || 1}</span>
                <span>Partidas jugadas: {roomData.gamesPlayed || 0}</span>
              </div>

              <div className="scoreboard">
                <h3>🏆 Puntuaciones</h3>
                <div className="scores-grid">
                  {Object.entries(roomData.scores || {})
                    .sort(([,a], [,b]) => b - a)
                    .map(([player, score], index) => (
                    <div key={player} className={`score-item ${index === 0 && score > 0 ? 'leader' : ''}`}>
                      <span className="player-name">{player}</span>
                      <span className="score">{score} pts</span>
                      {player === roomData.host && <span className="host-badge">HOST</span>}
                      {index === 0 && score > 0 && <span className="leader-badge">👑</span>}
                    </div>
                  ))}
                </div>
              </div>

              <div className="players-lobby">
                <h3>Jugadores ({roomData.players.length})</h3>
                <div className="players-grid">
                  {roomData.players.map((player, index) => (
                    <div key={index} className="player-item-lobby">
                      <span>{player}</span>
                      <span className="player-score">{roomData.scores?.[player] || 0} pts</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          <div className="lobby-actions">
            <button 
              className="leave-btn"
              onClick={leaveRoom}
            >
              Salir de la sala
            </button>
            {isHost && (
              <button 
                className="start-game-btn"
                onClick={startGame}
                disabled={!roomData || roomData.players.length < 3}
              >
                Iniciar Juego ({roomData?.players.length || 0}/3+)
              </button>
            )}
          </div>

          {!isHost && (
            <p className="waiting-message">Esperando a que el anfitrión inicie el juego...</p>
          )}
        </div>
      )}

      {/* Pantalla de juego individual */}
      {gameState === 'playing' && myRole && (
        <div className="playing-screen">
          <div className="game-info">
            <h2>Tu Tarjeta</h2>
            <p>
              Sala: <strong>{roomCode}</strong> 
              {isHost && <span title="Anfitrión - Lobby:7s | Juego:Modo silencioso" style={{color: '#ff6b35', fontSize: '12px', marginLeft: '5px'}}>👑 HOST</span>}
              {usingCache && <span title="Trabajando con datos locales para mejor rendimiento" style={{color: '#28a745', fontSize: '12px'}}>🎯 ULTRA-RÁPIDO</span>}
              {Date.now() - lastCriticalChange < 30000 && <span title="Sincronización ULTRA-acelerada - transición crítica!" style={{color: '#007bff', fontSize: '12px', marginLeft: '5px'}}>⚡ ULTRA-SYNC</span>}
            </p>
            <p>Jugador: <strong>{playerName}</strong></p>
          </div>

          <div className="card-area">
            <div className={`game-card ${myRole.role}`}>
              <div className="card-header">
                {myRole.role === 'impostor' ? 
                  'ERES EL IMPOSTOR 🔥' : 'ERES UN ALIADO ✅'}
              </div>
              <div className="card-content">
                {myRole.role === 'impostor' ? 
                  'Debes descubrir la palabra secreta' : 
                  `Tu palabra: ${myRole.card}`}
              </div>
            </div>
          </div>

          <div className="game-instructions">
            <p>
              {myRole.role === 'impostor' 
                ? '¡Debes descubrir la palabra secreta escuchando a los demás sin que te descubran!'
                : '¡Busca al impostor! Ellos no conocen la palabra secreta.'}
            </p>
          </div>

          {isHost && (
            <div className="host-controls">
              <button 
                className="voting-btn"
                onClick={startVoting}
              >
                Iniciar Votación
              </button>
            </div>
          )}

          <div className="game-footer">
            <button 
              className="leave-btn"
              onClick={leaveRoom}
            >
              Abandonar Partida
            </button>
          </div>
        </div>
      )}

      {/* Pantalla de votación */}
      {gameState === 'voting' && roomData && (
        <div className="voting-screen">
          <div className="voting-header">
            <h2>🗳️ Fase de Votación</h2>
            <p>
              Sala: <strong>{roomCode}</strong> 
              {isHost && <span title="Anfitrión - Control con modo silencioso optimizado" style={{color: '#ff6b35', fontSize: '12px', marginLeft: '5px'}}>👑 HOST</span>}
              {usingCache && <span title="Trabajando con datos locales" style={{color: '#28a745', fontSize: '12px'}}>🎯 OFFLINE</span>}
              {Date.now() - lastCriticalChange < 30000 && <span title="ULTRA-Sync: cambios de juego/votación instantáneos!" style={{color: '#007bff', fontSize: '12px', marginLeft: '5px'}}>⚡ ULTRA-SYNC</span>}
            </p>
            <p>Vota por quien crees que es el impostor</p>
          </div>

          <div className="voting-info">
            <div className="voting-stats">
              <span>Votos recibidos: {Object.keys(roomData.votes || {}).length}/{roomData.players.length}</span>
              {hasVoted && <span className="voted-indicator">✅ Has votado</span>}
            </div>
          </div>

          <div className="voting-players">
            <h3>Selecciona a quien votar:</h3>
            <div className="players-voting-grid">
              {roomData.players.filter(player => player !== playerName).map((player) => {
                const voteCount = Object.values(roomData.votes || {}).filter(vote => vote === player).length;
                return (
                  <div 
                    key={player} 
                    className={`voting-player-card ${myVote === player ? 'selected' : ''} ${hasVoted && myVote !== player ? 'disabled' : ''}`}
                    onClick={() => !hasVoted && submitVote(player)}
                  >
                    <div className="player-name">{player}</div>
                    <div className="vote-count">{voteCount} voto{voteCount !== 1 ? 's' : ''}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {myVote && (
            <div className="my-vote-display">
              <p>Tu voto: <strong>{myVote}</strong></p>
            </div>
          )}

          {isHost && (
            <div className="voting-controls">
              <button 
                className="finish-voting-btn"
                onClick={finishVoting}
                disabled={Object.keys(roomData.votes || {}).length < roomData.players.length}
              >
                Finalizar Votación ({Object.keys(roomData.votes || {}).length}/{roomData.players.length})
              </button>
            </div>
          )}

          {!isHost && (
            <p className="waiting-message">
              {hasVoted 
                ? "Esperando a que termine la votación..." 
                : "¡Vota por quien crees que es el impostor!"}
            </p>
          )}

          <div className="voting-footer">
            <button 
              className="leave-btn"
              onClick={leaveRoom}
            >
              Abandonar Partida
            </button>
          </div>
        </div>
      )}

      {/* Pantalla de resultados */}
      {gameState === 'finished' && roomData && (
        <div className="finished-screen">
          <h2>🏆 ¡Partida Finalizada!</h2>
          <p>Sala: <strong>{roomCode}</strong></p>

          {/* Mostrar resultado de la votación si existe */}
          {votationResults && (
            <div className="voting-results">
              <div className={`game-result ${votationResults.impostorWins ? 'impostor-wins' : 'allies-win'}`}>
                <h3>
                  {votationResults.impostorWins ? 
                    '🔥 ¡EL IMPOSTOR GANÓ!' : 
                    '✅ ¡LOS ALIADOS GANARON!'}
                </h3>
                <p>
                  {votationResults.impostorWins ? 
                    'El impostor logró engañar a todos (+3 puntos)' : 
                    'Identificaron correctamente al impostor'}
                </p>
              </div>

              {/* Puntos ganados en esta ronda */}
              {roomData.pointsThisRound && (
                <div className="points-earned">
                  <h4>💎 Puntos ganados esta ronda:</h4>
                  <div className="points-grid">
                    {Object.entries(roomData.pointsThisRound).map(([player, points]) => (
                      <div key={player} className={`points-item ${points > 0 ? 'earned-points' : 'no-points'}`}>
                        <span className="player-name">{player}</span>
                        <span className="points-earned-text">
                          {points > 0 ? `+${points} pts` : '0 pts'}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="points-explanation">
                    <small>
                      {votationResults.impostorWins 
                        ? '🔥 Impostor: +3 pts por ganar' 
                        : '✅ Aliados que votaron correctamente: +2 pts | Todos los aliados: +1 pt extra'}
                    </small>
                  </div>
                </div>
              )}

              {/* Mostrar información diferente si terminó automáticamente */}
              {votationResults.autoFinish ? (
                <div className="auto-finish-results">
                  <div className="auto-finish-header">
                    <h3>🏁 Juego Terminado Automáticamente</h3>
                    <p className="auto-finish-reason"><strong>{votationResults.reason}</strong></p>
                    <p>✅ Todos los jugadores restantes recibieron +1 punto por supervivencia</p>
                  </div>
                  
                  <div className="final-roles-reveal">
                    <h4>Roles finales:</h4>
                    <p><strong>Los impostores eran:</strong> {votationResults.impostors?.join(', ') || 'Ninguno'}</p>
                  </div>
                </div>
              ) : (
                <div className="voting-breakdown">
                  <h4>Resultados de la votación:</h4>
                <div className="vote-results">
                  {Object.entries(votationResults.votes).map(([player, votes]) => (
                    <div 
                      key={player} 
                      className={`vote-result-item ${votationResults.impostors?.includes(player) ? 'real-impostor' : ''}`}
                    >
                      <span className="voted-player">{player}</span>
                      <span className="vote-count-result">{votes} voto{votes !== 1 ? 's' : ''}</span>
                      {player === votationResults.mostVoted && (
                        <span className="most-voted-badge">MÁS VOTADO</span>
                      )}
                    </div>
                  ))}
                </div>
                
                <div className="impostor-reveal">
                  <p><strong>Los impostores eran: {votationResults.impostors?.join(', ') || 'Ninguno'}</strong></p>
                  <p>Jugador más votado: {votationResults.mostVoted}</p>
                  <p>
                    {votationResults.votedPlayerWasImpostor ? 
                      '✅ ¡Los aliados eliminaron a un impostor!' : 
                      '❌ No se eliminó ningún impostor'}
                  </p>
                </div>
              </div>
              )}
            </div>
          )}

          {/* Scoreboard actualizado */}
          {roomData.scores && (
            <div className="final-scoreboard">
              <h3>🏆 Puntuaciones Totales</h3>
              <div className="final-scores-grid">
                {Object.entries(roomData.scores)
                  .sort(([,a], [,b]) => b - a)
                  .map(([player, score], index) => (
                  <div key={player} className={`final-score-item ${index === 0 ? 'winner' : ''} ${player === playerName ? 'my-score' : ''}`}>
                    <div className="rank">#{index + 1}</div>
                    <div className="player-info">
                      <span className="player-name">{player}</span>
                      {player === playerName && <span className="you-badge">TÚ</span>}
                    </div>
                    <div className="score">{score} pts</div>
                    {index === 0 && <div className="crown">👑</div>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Solo mostrar roles si el juego terminó Y tenemos roles completos Y hay resultados de votación */}
          {gameState === 'finished' && roomData.roles && Object.keys(roomData.roles).length > 1 && votationResults && (
            <div className="roles-summary">
              <h3>Roles de la partida:</h3>
              <div className="roles-list">
                {Object.entries(roomData.roles).map(([player, data]) => {
                  // Desencriptar rol si está encriptado (string) o usar directamente si ya está desencriptado (objeto)
                  const roleData = typeof data === 'string' ? decryptRole(data) : data;
                  
                  return (
                    <div key={player} className={`role-item ${roleData?.role}`}>
                      <span className="player-name">{player}</span>
                      <span className="role-badge">
                        {roleData?.role === 'impostor' ? '🔥 IMPOSTOR' : '✅ ALIADO'}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="word-reveal">
                <p><strong>Palabra secreta:</strong> {
                  gameState === 'finished' && roomData.gameData 
                    ? (typeof roomData.gameData === 'string' 
                        ? decryptRole(roomData.gameData)?.word // Si está encriptado
                        : roomData.gameData?.word) // Si ya está desencriptado
                    : roomData.gameData?.word
                }</p>
              </div>
            </div>
          )}

          <div className="finished-actions">
            {isHost ? (
              <>
                <button onClick={leaveRoom}>Nueva Sala</button>
                <button onClick={async () => {
                  console.log('🎮 HOST INICIA NUEVA RONDA...');
                  // Reset game state but keep room and scores
                  const resetRoom = {
                    ...roomData,
                    gameState: 'lobby',
                    gameData: null,
                    roles: {},
                    votes: {},
                    votationResults: null,
                    pointsThisRound: {},
                    roundNumber: (roomData.roundNumber || 1) + 1
                  };
                  
                  // INSTANT LOCAL UPDATE FIRST
                  setRoomData(resetRoom);
                  updateLocalCache(resetRoom);
                  setGameData(null);
                  setMyRole(null);
                  setMyVote('');
                  setHasVoted(false);
                  setVotationResults(null);
                  setRoundNumber(resetRoom.roundNumber);
                  setGameState('lobby');
                  markCriticalChange('HOST inicia nueva ronda'); // ¡CRÍTICO PARA SYNC!
                  
                  console.log('✅ Estado local actualizado, guardando en DB...');
                  // BACKGROUND SAVE
                  try {
                    await saveRoomData(roomCode, resetRoom);
                    console.log('💾 Nueva ronda guardada en BD correctamente');
                  } catch (error) {
                    console.error('❌ Error guardando nueva ronda:', error);
                  }
                }}>Nueva Ronda</button>
              </>
            ) : (
              <button onClick={leaveRoom}>Salir de la Sala</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;