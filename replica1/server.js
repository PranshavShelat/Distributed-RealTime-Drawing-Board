const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const PORT = 3000;
const REPLICA_ID = process.env.REPLICA_ID;
const PEERS = process.env.PEERS ? process.env.PEERS.split(',') : [];

// RAFT State Variables
let state = 'Follower'; 
let currentTerm = 0;
let votedFor = null;
let currentLeader = null;

// Log Variables
let log = []; 
let commitIndex = -1;

// Timers
let electionTimeout = null;
let heartbeatInterval = null;

// --- RAFT Core Functions ---
function resetElectionTimeout() {
    clearTimeout(electionTimeout);
    const timeout = Math.floor(Math.random() * (800 - 500 + 1) + 500);
    electionTimeout = setTimeout(startElection, timeout);
}

async function startElection() {
    state = 'Candidate';
    currentTerm++;
    votedFor = REPLICA_ID;
    currentLeader = null;
    console.log(`[${REPLICA_ID}] Term ${currentTerm}: Started election`);

    let votes = 1; 
    resetElectionTimeout();

    const votePromises = PEERS.map(async (peer) => {
        try {
            const res = await axios.post(`http://${peer}:3000/request-vote`, {
                term: currentTerm,
                candidateId: REPLICA_ID,
                lastLogIndex: log.length - 1
            }, { timeout: 300 });

            if (res.data.term > currentTerm) {
                stepDown(res.data.term);
            } else if (res.data.voteGranted) {
                votes++;
            }
        } catch (e) { /* Peer unreachable */ }
    });

    await Promise.all(votePromises);

    if (state === 'Candidate' && votes > (PEERS.length + 1) / 2) {
        becomeLeader();
    }
}

function becomeLeader() {
    state = 'Leader';
    currentLeader = REPLICA_ID;
    console.log(`[${REPLICA_ID}] Term ${currentTerm}: BECAME LEADER 👑`);
    clearTimeout(electionTimeout);
    
    sendHeartbeats();
    heartbeatInterval = setInterval(sendHeartbeats, 150);
}

function stepDown(newTerm, leaderId = null) {
    currentTerm = newTerm;
    state = 'Follower';
    votedFor = null;
    currentLeader = leaderId;
    clearInterval(heartbeatInterval);
    resetElectionTimeout();
}

async function sendHeartbeats() {
    PEERS.forEach(async (peer) => {
        try {
            const res = await axios.post(`http://${peer}:3000/heartbeat`, {
                term: currentTerm,
                leaderId: REPLICA_ID,
                leaderCommit: commitIndex
            }, { timeout: 100 });
            
            if (res.data.term > currentTerm) stepDown(res.data.term);
        } catch (e) { /* Peer down */ }
    });
}

// --- Catch-up Protocol ---
async function syncFollower(peer, followerLogLength) {
    if (state !== 'Leader') return;
    try {
        console.log(`[${REPLICA_ID}] Syncing peer ${peer} from index ${followerLogLength}`);
        const missingEntries = log.slice(followerLogLength);
        await axios.post(`http://${peer}:3000/sync-log`, {
            entries: missingEntries,
            leaderCommit: commitIndex
        });
    } catch (e) { console.error(`[${REPLICA_ID}] Failed to sync peer ${peer}`); }
}

// --- RPC Endpoints ---

// 1. Client Request (Receives stroke or command from Gateway)
app.post('/client-request', async (req, res) => {
    if (state !== 'Leader') return res.json({ success: false, leaderId: currentLeader });

    const stroke = req.body;
    const entry = { term: currentTerm, stroke };

    // Log Compaction: Wipe server memory if CLEAR command issued
    if (stroke.type === 'clear') {
        log = []; 
    }
    
    log.push(entry);
    const entryIndex = log.length - 1;
    let acks = 1; 

    // Phase 2: Replicate to followers
    const replicationPromises = PEERS.map(async (peer) => {
        try {
            const res = await axios.post(`http://${peer}:3000/append-entries`, {
                term: currentTerm,
                leaderId: REPLICA_ID,
                entry: entry,
                prevLogIndex: entryIndex - 1
            }, { timeout: 500 });

            if (res.data.success) {
                acks++;
            } else if (res.data.needsSync) {
                syncFollower(peer, res.data.logLength);
            }
        } catch (e) { /* Peer down */ }
    });

    await Promise.all(replicationPromises);

    // Phase 3: Commit
    if (acks > (PEERS.length + 1) / 2) {
        commitIndex = entryIndex;
        try { await axios.post('http://gateway:8081/broadcast', stroke); } 
        catch (e) { console.error(`[${REPLICA_ID}] Gateway broadcast failed`); }
        return res.json({ success: true });
    } else {
        return res.status(500).json({ success: false, error: "Consensus not reached" });
    }
});

// 2. Request Vote
app.post('/request-vote', (req, res) => {
    const { term, candidateId, lastLogIndex } = req.body;
    
    if (term > currentTerm) stepDown(term);

    const isLogUpToDate = lastLogIndex >= log.length - 1;
    let voteGranted = false;

    if (term === currentTerm && (votedFor === null || votedFor === candidateId) && isLogUpToDate) {
        voteGranted = true;
        votedFor = candidateId;
        resetElectionTimeout();
    }

    res.json({ term: currentTerm, voteGranted });
});

// 3. Heartbeat
app.post('/heartbeat', (req, res) => {
    const { term, leaderId, leaderCommit } = req.body;
    
    if (term >= currentTerm) {
        stepDown(term, leaderId);
        if (leaderCommit > commitIndex) {
            commitIndex = Math.min(leaderCommit, log.length - 1);
        }
    }
    res.json({ term: currentTerm });
});

// 4. Append Entries (Live replication & state enforcement)
app.post('/append-entries', (req, res) => {
    const { term, leaderId, entry, prevLogIndex } = req.body;
    
    if (term < currentTerm) return res.json({ success: false });
    stepDown(term, leaderId);

    // Consistency Check
    if (prevLogIndex >= log.length) {
        return res.json({ success: false, needsSync: true, logLength: log.length });
    }

    // Log Compaction for Followers
    if (entry.stroke && entry.stroke.type === 'clear') {
        log = []; 
    }

    log.push(entry);
    res.json({ success: true, term: currentTerm });
});

// 5. Sync Log (Catch-up protocol)
app.post('/sync-log', (req, res) => {
    const { entries, leaderCommit } = req.body;
    log = log.concat(entries);
    commitIndex = leaderCommit;
    console.log(`[${REPLICA_ID}] Caught up ${entries.length} missing strokes.`);
    res.json({ success: true });
});

// --- Utility & Telemetry Endpoints ---
app.get('/status', (req, res) => {
    res.json({ state: state, currentTerm: currentTerm, leaderId: currentLeader });
});

app.get('/full-log', (req, res) => {
    if (state !== 'Leader') return res.status(400).json({ error: "Not leader" });
    res.json({ log: log.slice(0, commitIndex + 1) });
});

app.listen(PORT, () => {
    console.log(`[${REPLICA_ID}] Started. Peers: ${PEERS.join(', ')}`);
    resetElectionTimeout();
});